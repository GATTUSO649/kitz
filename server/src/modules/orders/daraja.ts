import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'

type DarajaResponse = Record<string, unknown>
type DarajaConfiguration = Pick<typeof env, 'DARAJA_ENV' | 'DARAJA_CONSUMER_KEY' | 'DARAJA_CONSUMER_SECRET' | 'DARAJA_PASSKEY' | 'DARAJA_CALLBACK_BASE_URL' | 'DARAJA_CALLBACK_TOKEN' | 'DARAJA_TRANSACTION_TYPE' | 'MPESA_ACCOUNT_REFERENCE' | 'MPESA_TRANSACTION_DESC'>
type DarajaRequestDependencies = { configuration?: DarajaConfiguration; fetcher?: typeof fetch; now?: Date }

export class DarajaRequestError extends Error {
  constructor(
    readonly stage: 'oauth' | 'stk_push' | 'stk_query',
    readonly outcome: 'not_submitted' | 'rejected' | 'unknown',
    readonly providerCode?: string,
    readonly httpStatus?: number,
  ) {
    super(`Daraja ${stage.replaceAll('_', ' ')} ${outcome}.`)
    this.name = 'DarajaRequestError'
  }
}

export type ParsedStkCallback = {
  checkoutRequestId: string
  merchantRequestId: string
  resultCode: number
  resultDescription: string
  metadata: Record<string, unknown>
}

export function parseStkCallback(body: unknown): ParsedStkCallback | null {
  if (!body || typeof body !== 'object') return null
  const callback = (body as { Body?: { stkCallback?: unknown } }).Body?.stkCallback
  if (!callback || typeof callback !== 'object') return null
  const value = callback as {
    CheckoutRequestID?: unknown
    MerchantRequestID?: unknown
    ResultCode?: unknown
    ResultDesc?: unknown
    CallbackMetadata?: { Item?: unknown }
  }
  if (typeof value.CheckoutRequestID !== 'string' || !value.CheckoutRequestID
    || typeof value.MerchantRequestID !== 'string' || !value.MerchantRequestID) return null
  const resultCodeValue = value.ResultCode
  if (!(typeof resultCodeValue === 'number' || (typeof resultCodeValue === 'string' && /^\d+$/.test(resultCodeValue)))) return null
  const resultCode = Number(resultCodeValue)
  if (!Number.isSafeInteger(resultCode) || resultCode < 0) return null
  const metadata: Record<string, unknown> = {}
  if (Array.isArray(value.CallbackMetadata?.Item)) {
    for (const item of value.CallbackMetadata.Item) {
      if (!item || typeof item !== 'object') continue
      const entry = item as { Name?: unknown; Value?: unknown }
      if (typeof entry.Name === 'string' && entry.Name.length <= 80) metadata[entry.Name] = entry.Value
    }
  }
  return {
    checkoutRequestId: value.CheckoutRequestID,
    merchantRequestId: value.MerchantRequestID,
    resultCode,
    resultDescription: typeof value.ResultDesc === 'string' ? value.ResultDesc : '',
    metadata,
  }
}

export function callbackFailureStatus(resultCode: number): 'cancelled' | 'expired' | 'failed' {
  if (resultCode === 1032) return 'cancelled'
  if (resultCode === 1037) return 'expired'
  return 'failed'
}

export const darajaCallbackRoute = '/orders/mpesa/callback/:token'

function safeProviderCode(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : undefined
}

function apiBase(configuration: DarajaConfiguration) {
  if (!configuration.DARAJA_ENV) throw new DarajaRequestError('oauth', 'not_submitted')
  return configuration.DARAJA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>()

export function normalizeKenyanPhone(value: string) {
  const input = value.trim()
  if (!/^\+?[0-9\s()-]+$/.test(input) || (input.includes('+') && !input.startsWith('+'))) return null
  const digits = input.replace(/\D/g, '')
  const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null
}

export function parseDarajaTimestamp(value: string | number) {
  const digits = String(value)
  if (!/^\d{14}$/.test(digits)) return null
  const year = Number(digits.slice(0, 4))
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  const hour = Number(digits.slice(8, 10))
  const minute = Number(digits.slice(10, 12))
  const second = Number(digits.slice(12, 14))
  const calendarDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return null
  return new Date(calendarDate.getTime() - 3 * 60 * 60 * 1000)
}

export function isDarajaConfigured(shortcode: string) {
  const effectiveShortcode = shortcode || env.DARAJA_SHORTCODE || ''
  if (!env.DARAJA_ENV || !env.DARAJA_TRANSACTION_TYPE || !env.DARAJA_CONSUMER_KEY || !env.DARAJA_CONSUMER_SECRET || !env.DARAJA_PASSKEY
    || !env.DARAJA_CALLBACK_BASE_URL || !env.DARAJA_CALLBACK_TOKEN || !/^\d{5,20}$/.test(effectiveShortcode)) return false
  try {
    const callbackUrl = new URL(buildDarajaCallbackUrl(env.DARAJA_CALLBACK_BASE_URL, env.DARAJA_CALLBACK_TOKEN))
    return !/your-public-domain|example\.com|localhost/i.test(callbackUrl.hostname)
  } catch {
    return false
  }
}

export function resolveDarajaShortcodes(
  environment: 'sandbox' | 'production' | undefined,
  transactionType: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline' | undefined,
  configuredBusinessShortcode: string | undefined,
  receivingTill: string | undefined,
) {
  const businessShortcode = configuredBusinessShortcode?.trim() ?? ''
  const partyB = environment === 'production' && transactionType === 'CustomerBuyGoodsOnline'
    ? receivingTill?.trim() ?? ''
    : businessShortcode
  return { businessShortcode, partyB }
}

export function buildDarajaCallbackUrl(baseOrCallbackUrl: string, token: string) {
  if (token.length < 32) throw new Error('The callback token must be at least 32 characters.')
  const callbackUrl = new URL(baseOrCallbackUrl)
  if (callbackUrl.protocol !== 'https:') throw new Error('The Daraja callback URL must use HTTPS.')
  const expectedPath = `/api/v1${darajaCallbackRoute.replace(':token', token)}`
  if (callbackUrl.pathname !== '/' && callbackUrl.pathname !== expectedPath) {
    throw new Error('The Daraja callback URL path does not match the application route.')
  }
  callbackUrl.pathname = expectedPath
  callbackUrl.search = ''
  callbackUrl.hash = ''
  return callbackUrl.toString()
}

export function darajaCallbackUrl(configuration: DarajaConfiguration = env) {
  if (!configuration.DARAJA_CALLBACK_BASE_URL || !configuration.DARAJA_CALLBACK_TOKEN) throw new Error('M-Pesa callback configuration is missing.')
  return buildDarajaCallbackUrl(configuration.DARAJA_CALLBACK_BASE_URL, configuration.DARAJA_CALLBACK_TOKEN)
}

export function isValidCallbackToken(candidate: string) {
  const expected = env.DARAJA_CALLBACK_TOKEN
  return matchesCallbackToken(candidate, expected)
}

export function matchesCallbackToken(candidate: string, expected: string | undefined) {
  if (!expected) return false
  const providedBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

export function isFinalDarajaPaymentStatus(status: string) {
  return ['succeeded', 'failed', 'cancelled', 'expired', 'requires_review', 'refunded'].includes(status)
}

export function isValidDarajaPaymentAmount(currency: string, callbackAmount: number, paymentAmount: string | number, orderTotal: string | number) {
  return currency === 'KES'
    && Math.round(callbackAmount * 100) === Math.round(Number(paymentAmount) * 100)
    && Math.round(Number(paymentAmount) * 100) === Math.round(Number(orderTotal) * 100)
}

export function canVerifySuccessfulStkPayment(input: {
  orderStatus: string
  currency: string
  callbackAmount: number
  paymentAmount: string | number
  orderTotal: string | number
  callbackPhone: string
  payerPhone: string | null
  transactionAt: Date
  paymentCreatedAt: Date
  now?: Date
}) {
  const now = input.now ?? new Date()
  const validTime = input.transactionAt.getTime() >= input.paymentCreatedAt.getTime() - 2 * 60 * 1000
    && input.transactionAt.getTime() <= now.getTime() + 5 * 60 * 1000
  return input.orderStatus === 'pending_payment'
    && input.currency === 'KES'
    && input.payerPhone !== null
    && input.callbackPhone === input.payerPhone
    && isValidDarajaPaymentAmount(input.currency, input.callbackAmount, input.paymentAmount, input.orderTotal)
    && validTime
}

async function accessToken(configuration: DarajaConfiguration, fetcher: typeof fetch) {
  if (!configuration.DARAJA_CONSUMER_KEY || !configuration.DARAJA_CONSUMER_SECRET) {
    throw new DarajaRequestError('oauth', 'not_submitted')
  }
  const tokenKey = createHash('sha256').update(`${configuration.DARAJA_ENV}:${configuration.DARAJA_CONSUMER_KEY}:${configuration.DARAJA_CONSUMER_SECRET}`).digest('hex')
  const cached = accessTokens.get(tokenKey)
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token
  const credentials = Buffer.from(`${configuration.DARAJA_CONSUMER_KEY}:${configuration.DARAJA_CONSUMER_SECRET}`).toString('base64')
  let response: Response
  try {
    response = await fetcher(`${apiBase(configuration)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new DarajaRequestError('oauth', 'not_submitted')
  }
  let result: DarajaResponse
  try { result = await response.json() as DarajaResponse } catch { throw new DarajaRequestError('oauth', 'not_submitted') }
  if (!response.ok || typeof result.access_token !== 'string') {
    throw new DarajaRequestError('oauth', 'not_submitted', safeProviderCode(result.errorCode), response.status)
  }
  const expiresIn = Number(result.expires_in ?? 3600)
  const token = result.access_token
  accessTokens.set(tokenKey, { token, expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000 })
  return token
}

function timestampNairobi(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`
}

function stkPassword(shortcode: string, timestamp: string, passkey?: string) {
  if (!passkey) throw new DarajaRequestError('stk_push', 'not_submitted')
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
}

async function authenticatedPost(path: string, body: Record<string, unknown>, configuration: DarajaConfiguration, fetcher: typeof fetch, stage: 'stk_push' | 'stk_query') {
  const token = await accessToken(configuration, fetcher)
  let response: Response
  try {
    response = await fetcher(`${apiBase(configuration)}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new DarajaRequestError(stage, 'unknown')
  }
  let result: DarajaResponse
  try { result = await response.json() as DarajaResponse } catch { throw new DarajaRequestError(stage, 'unknown') }
  if (!response.ok) {
    const outcome = response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected'
    throw new DarajaRequestError(stage, outcome, safeProviderCode(result.errorCode), response.status)
  }
  return result
}

export async function initiateStkPush(input: { businessShortcode: string; partyB: string; phone: string; amount: number; accountReference: string }, dependencies: DarajaRequestDependencies = {}) {
  const configuration = dependencies.configuration ?? env
  const fetcher = dependencies.fetcher ?? fetch
  const timestamp = timestampNairobi(dependencies.now)
  const result = await authenticatedPost('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: input.businessShortcode,
    Password: stkPassword(input.businessShortcode, timestamp, configuration.DARAJA_PASSKEY),
    Timestamp: timestamp,
    TransactionType: configuration.DARAJA_TRANSACTION_TYPE,
    Amount: input.amount,
    PartyA: input.phone,
    PartyB: input.partyB,
    PhoneNumber: input.phone,
    CallBackURL: darajaCallbackUrl(configuration),
    AccountReference: configuration.MPESA_ACCOUNT_REFERENCE.slice(0, 12),
    TransactionDesc: configuration.MPESA_TRANSACTION_DESC.slice(0, 13),
  }, configuration, fetcher, 'stk_push')
  if (result.ResponseCode !== '0') {
    throw new DarajaRequestError('stk_push', 'rejected', safeProviderCode(result.ResponseCode))
  }
  if (typeof result.CheckoutRequestID !== 'string' || typeof result.MerchantRequestID !== 'string') {
    throw new DarajaRequestError('stk_push', 'unknown')
  }
  return {
    checkoutRequestId: result.CheckoutRequestID,
    merchantRequestId: result.MerchantRequestID,
    customerMessage: 'Payment prompt sent.',
  }
}

export async function queryStkPush(shortcode: string, checkoutRequestId: string, dependencies: DarajaRequestDependencies = {}) {
  const configuration = dependencies.configuration ?? env
  const timestamp = timestampNairobi(dependencies.now)
  const result = await authenticatedPost('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: shortcode,
    Password: stkPassword(shortcode, timestamp, configuration.DARAJA_PASSKEY),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  }, configuration, dependencies.fetcher ?? fetch, 'stk_query')
  if (result.ResponseCode !== '0') throw new DarajaRequestError('stk_query', 'rejected', safeProviderCode(result.ResponseCode))
  return result
}