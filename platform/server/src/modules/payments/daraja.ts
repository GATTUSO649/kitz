import { createHash, timingSafeEqual } from 'node:crypto'

export class DarajaUnavailableError extends Error {
  constructor(message = 'Marketplace M-Pesa payments are not configured.') {
    super(message)
    this.name = 'DarajaUnavailableError'
  }
}

type DarajaConfig = {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  passkey: string
  shortcode: string
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'
  callbackUrl: string
}

type StkResult = {
  CheckoutRequestID: string
  MerchantRequestID: string
  ResponseCode: string
  ResponseDescription?: string
  CustomerMessage?: string
}

let cachedToken: { value: string; expiresAt: number } | null = null

function getConfig(): DarajaConfig {
  const mode = process.env.MPESA_ENV
  if (mode !== 'sandbox' && mode !== 'production') throw new DarajaUnavailableError()
  const consumerKey = process.env.MPESA_CONSUMER_KEY
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET
  const passkey = process.env.MPESA_PASSKEY
  const shortcode = process.env.MPESA_SHORTCODE
  const transactionType = process.env.MPESA_TRANSACTION_TYPE
  const callbackUrl = process.env.MPESA_CALLBACK_URL
  const callbackToken = process.env.MPESA_CALLBACK_TOKEN
  if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl || !callbackToken
    || (transactionType !== 'CustomerPayBillOnline' && transactionType !== 'CustomerBuyGoodsOnline')) {
    throw new DarajaUnavailableError('Marketplace M-Pesa configuration is incomplete.')
  }
  const parsedCallbackUrl = new URL(callbackUrl)
  if (mode === 'production' && parsedCallbackUrl.protocol !== 'https:') {
    throw new DarajaUnavailableError('Production M-Pesa callbacks require HTTPS.')
  }
  if (!parsedCallbackUrl.pathname.includes(`/callback/${encodeURIComponent(callbackToken)}`)) {
    throw new DarajaUnavailableError('The callback URL must contain the configured callback token path.')
  }
  return {
    baseUrl: mode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    consumerKey,
    consumerSecret,
    passkey,
    shortcode,
    transactionType,
    callbackUrl,
  }
}

export function assertDarajaConfigured(): void {
  getConfig()
}

async function getAccessToken(config: DarajaConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const authorization = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')
  const response = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new DarajaUnavailableError('M-Pesa authentication could not be completed.')
  const body = await response.json() as { access_token?: string; expires_in?: string }
  if (!body.access_token) throw new DarajaUnavailableError('M-Pesa authentication response was invalid.')
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Math.max(30, Number(body.expires_in || 3600) - 30) * 1000 }
  return body.access_token
}

function darajaTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  return `${values.get('year')}${values.get('month')}${values.get('day')}${values.get('hour')}${values.get('minute')}${values.get('second')}`
}

function darajaPassword(config: DarajaConfig, timestamp: string): string {
  return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64')
}

export async function initiateStkPush(input: {
  phone: string
  amountKes: number
  paymentReference: string
  description: string
}): Promise<StkResult> {
  const config = getConfig()
  const accessToken = await getAccessToken(config)
  const timestamp = darajaTimestamp()
  const response = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: darajaPassword(config, timestamp),
      Timestamp: timestamp,
      TransactionType: config.transactionType,
      Amount: input.amountKes,
      PartyA: input.phone,
      PartyB: config.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: config.callbackUrl,
      AccountReference: input.paymentReference,
      TransactionDesc: input.description.slice(0, 20),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new DarajaUnavailableError('M-Pesa could not accept the payment request.')
  const result = await response.json() as Partial<StkResult>
  if (result.ResponseCode !== '0' || !result.CheckoutRequestID || !result.MerchantRequestID) {
    throw new DarajaUnavailableError('M-Pesa did not accept the payment request.')
  }
  return result as StkResult
}

export async function queryStkPayment(checkoutRequestId: string): Promise<{ resultCode: string; resultDescription: string }> {
  const config = getConfig()
  const accessToken = await getAccessToken(config)
  const timestamp = darajaTimestamp()
  const response = await fetch(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: darajaPassword(config, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new DarajaUnavailableError('M-Pesa payment status is not yet verifiable.')
  const result = await response.json() as { ResultCode?: string | number; ResultDesc?: string }
  if (result.ResultCode === undefined) throw new DarajaUnavailableError('M-Pesa payment status response was incomplete.')
  return { resultCode: String(result.ResultCode), resultDescription: result.ResultDesc ?? '' }
}

export function paymentCallbackFingerprint(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function verifyCallbackToken(received: string, expected: string): boolean {
  const receivedHash = createHash('sha256').update(received).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(receivedHash, expectedHash)
}
