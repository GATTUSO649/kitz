import { timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'

type DarajaResponse = Record<string, unknown>

export const darajaCallbackRoute = '/orders/mpesa/callback/:token'

const apiBase = env.DARAJA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

let cachedAccessToken: string | undefined
let accessTokenExpiresAt = 0

export function normalizeKenyanPhone(value: string) {
  const digits = value.replace(/[^0-9]/g, '')
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
  if (!env.DARAJA_CONSUMER_KEY || !env.DARAJA_CONSUMER_SECRET || !env.DARAJA_PASSKEY
    || !env.DARAJA_CALLBACK_BASE_URL || !env.DARAJA_CALLBACK_TOKEN || !/^\d{5,20}$/.test(effectiveShortcode)) return false
  try {
    const callbackUrl = new URL(buildDarajaCallbackUrl(env.DARAJA_CALLBACK_BASE_URL, env.DARAJA_CALLBACK_TOKEN))
    return !/your-public-domain|example\.com|localhost/i.test(callbackUrl.hostname)
  } catch {
    return false
  }
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

export function darajaCallbackUrl() {
  if (!env.DARAJA_CALLBACK_BASE_URL || !env.DARAJA_CALLBACK_TOKEN) throw new Error('M-Pesa callback configuration is missing.')
  return buildDarajaCallbackUrl(env.DARAJA_CALLBACK_BASE_URL, env.DARAJA_CALLBACK_TOKEN)
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
  return status === 'succeeded' || status === 'failed'
}

export function isValidDarajaPaymentAmount(currency: string, callbackAmount: number, paymentAmount: string | number, orderTotal: string | number) {
  return currency === 'KES'
    && Math.round(callbackAmount * 100) === Math.round(Number(paymentAmount) * 100)
    && Math.round(Number(paymentAmount) * 100) === Math.round(Number(orderTotal) * 100)
}

async function accessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) return cachedAccessToken
  if (!env.DARAJA_CONSUMER_KEY || !env.DARAJA_CONSUMER_SECRET) throw new Error('Daraja API credentials are not configured.')
  const credentials = Buffer.from(`${env.DARAJA_CONSUMER_KEY}:${env.DARAJA_CONSUMER_SECRET}`).toString('base64')
  const response = await fetch(`${apiBase}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(12_000),
  })
  const result = await response.json() as DarajaResponse
  if (!response.ok || typeof result.access_token !== 'string') throw new Error('Daraja authentication failed.')
  const expiresIn = Number(result.expires_in ?? 3600)
  cachedAccessToken = result.access_token
  accessTokenExpiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000
  return cachedAccessToken
}

function timestampNairobi(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`
}

function stkPassword(shortcode: string, timestamp: string) {
  if (!env.DARAJA_PASSKEY) throw new Error('Daraja passkey is not configured.')
  return Buffer.from(`${shortcode}${env.DARAJA_PASSKEY}${timestamp}`).toString('base64')
}

async function authenticatedPost(path: string, body: Record<string, unknown>) {
  const token = await accessToken()
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const result = await response.json() as DarajaResponse
  if (!response.ok) throw new Error('Daraja payment service rejected the request.')
  return result
}

export async function initiateStkPush(input: { shortcode: string; phone: string; amount: number; accountReference: string }) {
  const timestamp = timestampNairobi()
  const result = await authenticatedPost('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: input.shortcode,
    Password: stkPassword(input.shortcode, timestamp),
    Timestamp: timestamp,
    TransactionType: 'CustomerBuyGoodsOnline',
    Amount: input.amount,
    PartyA: input.phone,
    PartyB: input.shortcode,
    PhoneNumber: input.phone,
    CallBackURL: darajaCallbackUrl(),
    AccountReference: input.accountReference.slice(0, 12),
    TransactionDesc: `KitCulture ${input.accountReference}`.slice(0, 13),
  })
  if (result.ResponseCode !== '0' || typeof result.CheckoutRequestID !== 'string' || typeof result.MerchantRequestID !== 'string') {
    throw new Error(typeof result.ResponseDescription === 'string' ? result.ResponseDescription : 'Daraja could not start the payment prompt.')
  }
  return {
    checkoutRequestId: result.CheckoutRequestID,
    merchantRequestId: result.MerchantRequestID,
    customerMessage: typeof result.CustomerMessage === 'string' ? result.CustomerMessage : 'Payment prompt sent.',
  }
}

export async function queryStkPush(shortcode: string, checkoutRequestId: string) {
  const timestamp = timestampNairobi()
  const result = await authenticatedPost('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: shortcode,
    Password: stkPassword(shortcode, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  })
  if (result.ResponseCode !== '0') throw new Error('Daraja could not verify the payment request.')
  return result
}