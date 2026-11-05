import { createHash, timingSafeEqual } from 'node:crypto'

export class DarajaUnavailableError extends Error {
  constructor(message = 'Marketplace M-Pesa payments are not configured.') {
    super(message)
    this.name = 'DarajaUnavailableError'
  }
}

export class DarajaRequestError extends DarajaUnavailableError {
  constructor(readonly stage: 'oauth' | 'stk_push' | 'stk_query', readonly outcome: 'rejected' | 'unknown') {
    super('Marketplace M-Pesa request could not be verified.')
    this.name = 'DarajaRequestError'
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
type DarajaDependencies = { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; now?: () => number }

const cachedTokens = new Map<string, { value: string; expiresAt: number }>()

function getConfig(env: NodeJS.ProcessEnv = process.env): DarajaConfig {
  const mode = env.MARKETPLACE_DARAJA_ENVIRONMENT
  if (mode !== 'sandbox' && mode !== 'production') throw new DarajaUnavailableError()
  const consumerKey = env.MARKETPLACE_DARAJA_CONSUMER_KEY
  const consumerSecret = env.MARKETPLACE_DARAJA_CONSUMER_SECRET
  const passkey = env.MARKETPLACE_DARAJA_PASSKEY
  const shortcode = env.MARKETPLACE_DARAJA_SHORTCODE
  const transactionType = env.MARKETPLACE_DARAJA_TRANSACTION_TYPE
  const callbackUrl = env.MARKETPLACE_DARAJA_CALLBACK_URL
  const callbackToken = env.MARKETPLACE_DARAJA_CALLBACK_TOKEN
  if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl || !callbackToken
    || (transactionType !== 'CustomerPayBillOnline' && transactionType !== 'CustomerBuyGoodsOnline')) {
    throw new DarajaUnavailableError('Marketplace M-Pesa configuration is incomplete.')
  }
  if (!/^\d{5,20}$/.test(shortcode) || !/^[A-Za-z0-9_-]{32,128}$/.test(callbackToken)) {
    throw new DarajaUnavailableError('Marketplace M-Pesa configuration is invalid.')
  }
  const parsedCallbackUrl = new URL(callbackUrl)
  const expectedCallbackPath = `/api/v1/marketplace/payments/callback/${encodeURIComponent(callbackToken)}`
  if (parsedCallbackUrl.protocol !== 'https:' || parsedCallbackUrl.username || parsedCallbackUrl.password
    || parsedCallbackUrl.pathname !== expectedCallbackPath || parsedCallbackUrl.search || parsedCallbackUrl.hash) {
    throw new DarajaUnavailableError('The M-Pesa callback URL must be HTTPS and match the configured marketplace callback route exactly.')
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

async function getAccessToken(config: DarajaConfig, fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<string> {
  const cacheKey = createHash('sha256').update(`${config.baseUrl}:${config.consumerKey}:${config.consumerSecret}`).digest('hex')
  const cachedToken = cachedTokens.get(cacheKey)
  if (cachedToken && cachedToken.expiresAt > now() + 60_000) return cachedToken.value
  const authorization = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')
  let response: Response
  try {
    response = await fetcher(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new DarajaRequestError('oauth', 'unknown')
  }
  if (!response.ok) throw new DarajaRequestError('oauth', response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected')
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: string } | null
  if (!body?.access_token) throw new DarajaRequestError('oauth', 'unknown')
  const expiresIn = Number(body.expires_in || 3600)
  cachedTokens.set(cacheKey, { value: body.access_token, expiresAt: now() + Math.max(30, expiresIn - 60) * 1000 })
  return body.access_token
}

function darajaTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  return `${values.get('year')}${values.get('month')}${values.get('day')}${values.get('hour')}${values.get('minute')}${values.get('second')}`
}

export function parseDarajaTimestamp(value: unknown): Date | null {
  const digits = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^\d{14}$/.test(digits)) return null
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  const hour = Number(digits.slice(8, 10))
  const minute = Number(digits.slice(10, 12))
  const second = Number(digits.slice(12, 14))
  const nairobiTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (nairobiTime.getUTCFullYear() !== year || nairobiTime.getUTCMonth() !== month - 1 || nairobiTime.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return null
  return new Date(nairobiTime.getTime() - 3 * 60 * 60 * 1000)
}

export function verifyMarketplaceStkCallback(input: {
  callbackResultCode: string
  callbackCheckoutRequestId: string
  callbackMerchantRequestId: string
  queryCheckoutRequestId?: string
  queryMerchantRequestId?: string
  queryResultCode: string
  callbackAmount: number
  expectedAmount: number
  callbackPhone: string | null
  expectedPhone: string
  receipt: string
  transactionAt: Date | null
  paymentCreatedAt: Date
  now?: Date
}): boolean {
  const now = input.now ?? new Date()
  const validTime = input.transactionAt !== null
    && input.transactionAt.getTime() >= input.paymentCreatedAt.getTime() - 2 * 60_000
    && input.transactionAt.getTime() <= now.getTime() + 5 * 60_000
  return input.callbackResultCode === '0'
    && input.queryResultCode === '0'
    && input.callbackCheckoutRequestId === input.queryCheckoutRequestId
    && input.callbackMerchantRequestId === input.queryMerchantRequestId
    && Number.isSafeInteger(input.callbackAmount)
    && input.callbackAmount === input.expectedAmount
    && input.callbackPhone !== null
    && input.callbackPhone === input.expectedPhone
    && /^[A-Z0-9]{6,32}$/.test(input.receipt)
    && validTime
}

export function callbackFailureStatus(resultCode: string): 'failed' | 'cancelled' | 'expired' {
  return resultCode === '1032' ? 'cancelled' : resultCode === '1037' ? 'expired' : 'failed'
}

function darajaPassword(config: DarajaConfig, timestamp: string): string {
  return Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64')
}

export async function initiateStkPush(input: {
  phone: string
  amountKes: number
  paymentReference: string
  description: string
}, dependencies: DarajaDependencies = {}): Promise<StkResult> {
  if (!/^254[17]\d{8}$/.test(input.phone) || !Number.isSafeInteger(input.amountKes) || input.amountKes < 1) {
    throw new DarajaUnavailableError('M-Pesa payment details are invalid.')
  }
  const config = getConfig(dependencies.env)
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const accessToken = await getAccessToken(config, fetcher, now)
  const timestamp = darajaTimestamp(new Date(now()))
  const response = await fetcher(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
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
      AccountReference: input.paymentReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new DarajaRequestError('stk_push', 'unknown') })
  if (!response.ok) throw new DarajaRequestError('stk_push', response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected')
  const result = await response.json().catch(() => null) as Partial<StkResult> | null
  if (!result) throw new DarajaRequestError('stk_push', 'unknown')
  if (result.ResponseCode !== '0' || !result.CheckoutRequestID || !result.MerchantRequestID) {
    throw new DarajaRequestError('stk_push', 'rejected')
  }
  return result as StkResult
}

export async function queryStkPayment(checkoutRequestId: string, dependencies: DarajaDependencies = {}): Promise<{ resultCode: string; resultDescription: string; checkoutRequestId?: string; merchantRequestId?: string }> {
  const config = getConfig(dependencies.env)
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const accessToken = await getAccessToken(config, fetcher, now)
  const timestamp = darajaTimestamp(new Date(now()))
  const response = await fetcher(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: darajaPassword(config, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => { throw new DarajaRequestError('stk_query', 'unknown') })
  if (!response.ok) throw new DarajaRequestError('stk_query', response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected')
  const result = await response.json().catch(() => null) as { ResultCode?: string | number; ResultDesc?: string; CheckoutRequestID?: string; MerchantRequestID?: string } | null
  if (!result || result.ResultCode === undefined) throw new DarajaRequestError('stk_query', 'unknown')
  return {
    resultCode: String(result.ResultCode),
    resultDescription: result.ResultDesc ?? '',
    checkoutRequestId: result.CheckoutRequestID,
    merchantRequestId: result.MerchantRequestID,
  }
}

export function paymentCallbackFingerprint(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function verifyCallbackToken(received: string, expected: string): boolean {
  const receivedHash = createHash('sha256').update(received).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(receivedHash, expectedHash)
}
