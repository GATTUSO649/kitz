import { z } from 'zod'
import { areSameDatabaseTarget } from './database-target.js'

export function resolveDatabaseUrl(primaryKey: 'DATABASE_URL' | 'ADMIN_DATABASE_URL', fallbackKeys: readonly string[] = []): string | undefined {
  const configuredValue = process.env[primaryKey]?.trim()
  if (configuredValue) return configuredValue
  if (primaryKey === 'ADMIN_DATABASE_URL') return undefined

  for (const candidate of fallbackKeys) {
    const value = process.env[candidate]?.trim()
    if (value) return value
  }

  const directFromRailway = primaryKey === 'DATABASE_URL'
    ? process.env.MYSQL_URL ?? process.env.MYSQL_URI ?? process.env.MYSQL_PUBLIC_URL
    : process.env.ADMIN_MYSQL_URL ?? process.env.MYSQL_URL ?? process.env.MYSQL_PUBLIC_URL
  if (directFromRailway && directFromRailway.trim()) return directFromRailway.trim()

  const host = process.env.MYSQLHOST ?? process.env.MYSQL_HOST
  const port = process.env.MYSQLPORT ?? process.env.MYSQL_PORT ?? '3306'
  const databaseName = process.env.MYSQLDATABASE ?? process.env.MYSQL_DB ?? process.env.MYSQL_DATABASE
  const username = process.env.MYSQLUSER ?? process.env.MYSQL_USER ?? process.env.MYSQL_USERNAME
  const password = process.env.MYSQLPASSWORD ?? process.env.MYSQL_PASSWORD

  if (host && username && password && databaseName) {
    return `mysql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${databaseName}`
  }

  return undefined
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).optional(),
  ADMIN_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().url().optional(),
  WAF_MODE: z.enum(['disabled', 'detect', 'block']).default('detect'),
  OPERATIONS_IDENTITY_BRIDGE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SUPABASE_CA_CERT_FILE: z.string().trim().min(1).optional(),
  SUPABASE_CA_CERT: z.string().trim().min(1).optional(),
  ADMIN_SUPABASE_CA_CERT_FILE: z.string().trim().min(1).optional(),
  ADMIN_SUPABASE_CA_CERT: z.string().trim().min(1).optional(),
  ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE: z.string().trim().min(1).optional(),
  ADMIN_MIGRATION_SUPABASE_CA_CERT: z.string().trim().min(1).optional(),
  ADMIN_SIGNUP_SECRET: z.string().min(32).max(512).optional(),
  ADMIN_SECRET_KEY: z.string().min(32).max(512).optional(),
  ORIGIN_AUTH_TOKEN: z.string().min(32).max(256).optional(),
  MARKETHUB_SERVICE_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).optional(),
  MARKETHUB_PUBLIC_URL: z.string().url().optional(),
  MARKETHUB_SECURITY_FEED_URL: z.string().url().optional(),
  MYSQL_URL: z.string().min(1).optional(),
  MYSQL_PUBLIC_URL: z.string().min(1).optional(),
  ADMIN_MYSQL_URL: z.string().min(1).optional(),
  MYSQL_SSL_CA: z.string().min(1).optional(),
  MYSQL_SSL_VERIFY: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  APP_URL: z.string().url().optional(),
  EMAIL_PROVIDER: z.enum(['disabled', 'resend', 'smtp']).default('disabled'),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_REPLY_TO: z.string().min(1).optional(),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().trim().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  SMTP_REQUIRE_TLS: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  APP_BASE_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  ADMIN_NOTIFICATION_EMAIL: z.string().email().optional(),
  EMAIL_VERIFICATION_REQUIRED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  DARAJA_ENV: z.enum(['sandbox', 'production']).optional(),
  DARAJA_CONSUMER_KEY: z.string().trim().min(1).optional(),
  DARAJA_CONSUMER_SECRET: z.string().trim().min(1).optional(),
  DARAJA_PASSKEY: z.string().trim().min(1).optional(),
  DARAJA_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).optional(),
  DARAJA_SHORTCODE: z.string().regex(/^\d{5,20}$/).optional(),
  DARAJA_CALLBACK_BASE_URL: z.string().url().optional(),
  DARAJA_CALLBACK_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).optional(),
  MPESA_ACCOUNT_REFERENCE: z.string().trim().min(1).max(64).default('KitCulture'),
  MPESA_TRANSACTION_DESC: z.string().trim().min(1).max(64).default('Jersey Purchase'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_SLOW_QUERY_WARNING_MS: z.coerce.number().int().min(1).max(60000).default(100),
  DATABASE_SLOW_QUERY_ERROR_MS: z.coerce.number().int().min(2).max(120000).default(500),
  DATABASE_SLOW_QUERY_CRITICAL_MS: z.coerce.number().int().min(3).max(300000).default(1000),
  MONITORING_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
}).superRefine((configuration, context) => {
  if (configuration.DATABASE_SLOW_QUERY_WARNING_MS >= configuration.DATABASE_SLOW_QUERY_ERROR_MS) {
    context.addIssue({ code: 'custom', path: ['DATABASE_SLOW_QUERY_ERROR_MS'], message: 'Must exceed DATABASE_SLOW_QUERY_WARNING_MS.' })
  }
  if (configuration.DATABASE_SLOW_QUERY_ERROR_MS >= configuration.DATABASE_SLOW_QUERY_CRITICAL_MS) {
    context.addIssue({ code: 'custom', path: ['DATABASE_SLOW_QUERY_CRITICAL_MS'], message: 'Must exceed DATABASE_SLOW_QUERY_ERROR_MS.' })
  }
  if (configuration.MARKETHUB_SECURITY_FEED_URL) {
    const feedUrl = new URL(configuration.MARKETHUB_SECURITY_FEED_URL)
    const marketplaceUrl = configuration.MARKETHUB_PUBLIC_URL ? new URL(configuration.MARKETHUB_PUBLIC_URL) : null
    if (feedUrl.pathname !== '/api/v1/admin/marketplace/security-payments'
      || feedUrl.username || feedUrl.password || feedUrl.search || feedUrl.hash || !marketplaceUrl || feedUrl.origin !== marketplaceUrl.origin
      || (configuration.NODE_ENV === 'production' && feedUrl.protocol !== 'https:')) {
      context.addIssue({ code: 'custom', path: ['MARKETHUB_SECURITY_FEED_URL'], message: 'The MarketHub security feed URL must be the exact same-origin service endpoint; production requires HTTPS.' })
    }
  }
  if (configuration.NODE_ENV === 'production') {
    if (!configuration.ADMIN_DATABASE_URL) {
      context.addIssue({ code: 'custom', path: ['ADMIN_DATABASE_URL'], message: 'ADMIN_DATABASE_URL is required in production; administrator services do not fall back to DATABASE_URL.' })
    } else if (configuration.DATABASE_URL) {
      if (areSameDatabaseTarget(configuration.ADMIN_DATABASE_URL, configuration.DATABASE_URL)) {
        context.addIssue({ code: 'custom', path: ['ADMIN_DATABASE_URL'], message: 'ADMIN_DATABASE_URL must point to a database project separate from DATABASE_URL.' })
      }
    }
    if (process.env.NODE_TEST_CONTEXT === undefined
      && (!configuration.REDIS_URL || !['redis:', 'rediss:'].includes(new URL(configuration.REDIS_URL).protocol))) {
      context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'A redis:// or rediss:// URL is required in production for shared request rate limiting.' })
    }
    if (configuration.MARKETHUB_PUBLIC_URL) {
      const marketHubUrl = new URL(configuration.MARKETHUB_PUBLIC_URL)
      if (marketHubUrl.protocol !== 'https:' || marketHubUrl.username || marketHubUrl.password || marketHubUrl.search || marketHubUrl.hash) {
        context.addIssue({ code: 'custom', path: ['MARKETHUB_PUBLIC_URL'], message: 'MARKETHUB_PUBLIC_URL must be a public HTTPS origin.' })
      }
    }
    if (configuration.EMAIL_PROVIDER !== 'smtp') context.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'Production email must use the shared Brevo SMTP account.' })
    if (!configuration.SMTP_HOST || !configuration.SMTP_PORT || !configuration.SMTP_USER || !configuration.SMTP_PASS || !configuration.EMAIL_FROM) {
      context.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'Complete Brevo SMTP settings are required in production.' })
    }
  }
})

export function productionDatabaseTlsConfigurationErrors(configuration: { NODE_ENV: string; MYSQL_SSL_VERIFY: boolean }): string[] {
  return configuration.NODE_ENV === 'production' && !configuration.MYSQL_SSL_VERIFY
    ? ['MYSQL_SSL_VERIFY must be true in production']
    : []
}

const legacyCallbackBaseUrl = (() => {
  if (!process.env.MPESA_CALLBACK_URL) return undefined
  try { return new URL(process.env.MPESA_CALLBACK_URL).origin } catch { return undefined }
})()

const parsed = schema.safeParse({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? resolveDatabaseUrl('DATABASE_URL', ['MYSQL_URL', 'MYSQL_URI', 'MYSQL_PUBLIC_URL']),
  ADMIN_DATABASE_URL: process.env.ADMIN_DATABASE_URL ?? resolveDatabaseUrl('ADMIN_DATABASE_URL'),
  DARAJA_ENV: process.env.DARAJA_ENV ?? process.env.MPESA_ENV,
  DARAJA_CONSUMER_KEY: process.env.DARAJA_CONSUMER_KEY ?? process.env.MPESA_CONSUMER_KEY,
  DARAJA_CONSUMER_SECRET: process.env.DARAJA_CONSUMER_SECRET ?? process.env.MPESA_CONSUMER_SECRET,
  DARAJA_PASSKEY: process.env.DARAJA_PASSKEY ?? process.env.MPESA_PASSKEY,
  DARAJA_TRANSACTION_TYPE: process.env.DARAJA_TRANSACTION_TYPE ?? process.env.MPESA_TRANSACTION_TYPE,
  DARAJA_SHORTCODE: process.env.DARAJA_SHORTCODE ?? process.env.MPESA_SHORTCODE,
  DARAJA_CALLBACK_BASE_URL: process.env.DARAJA_CALLBACK_BASE_URL ?? legacyCallbackBaseUrl ?? process.env.APP_URL,
  DARAJA_CALLBACK_TOKEN: process.env.DARAJA_CALLBACK_TOKEN ?? process.env.MPESA_CALLBACK_TOKEN,
  APP_BASE_URL: process.env.APP_BASE_URL ?? process.env.APP_URL,
})
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; ')}`)
}
export function resolveDarajaEnvironment(nodeEnvironment: string, configuredEnvironment?: 'sandbox' | 'production') {
  if (configuredEnvironment) return configuredEnvironment
  return nodeEnvironment === 'development' || nodeEnvironment === 'test' ? 'sandbox' : undefined
}

export function resolveDarajaTransactionType(nodeEnvironment: string, configuredType?: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline') {
  if (configuredType) return configuredType
  return nodeEnvironment === 'development' || nodeEnvironment === 'test' ? 'CustomerPayBillOnline' : undefined
}

type ProductionDarajaConfiguration = {
  NODE_ENV: string
  DARAJA_ENV?: 'sandbox' | 'production'
  DARAJA_CONSUMER_KEY?: string
  DARAJA_CONSUMER_SECRET?: string
  DARAJA_PASSKEY?: string
  DARAJA_TRANSACTION_TYPE?: 'CustomerPayBillOnline' | 'CustomerBuyGoodsOnline'
  DARAJA_SHORTCODE?: string
  DARAJA_CALLBACK_BASE_URL?: string
  DARAJA_CALLBACK_TOKEN?: string
  APP_URL?: string
  MPESA_CALLBACK_URL?: string
}

export function productionDarajaConfigurationErrors(configuration: ProductionDarajaConfiguration): string[] {
  if (configuration.NODE_ENV !== 'production') return []

  const errors: string[] = []
  if (configuration.DARAJA_ENV !== 'production') errors.push('MPESA_ENV or DARAJA_ENV must be production')
  if (!configuration.DARAJA_CONSUMER_KEY) errors.push('MPESA_CONSUMER_KEY or DARAJA_CONSUMER_KEY is required')
  if (!configuration.DARAJA_CONSUMER_SECRET) errors.push('MPESA_CONSUMER_SECRET or DARAJA_CONSUMER_SECRET is required')
  if (!configuration.DARAJA_PASSKEY) errors.push('MPESA_PASSKEY or DARAJA_PASSKEY is required')
  if (!configuration.DARAJA_TRANSACTION_TYPE) errors.push('MPESA_TRANSACTION_TYPE or DARAJA_TRANSACTION_TYPE is required')
  if (!configuration.DARAJA_SHORTCODE) errors.push('MPESA_SHORTCODE or DARAJA_SHORTCODE is required')
  if (!configuration.DARAJA_CALLBACK_TOKEN) errors.push('MPESA_CALLBACK_TOKEN or DARAJA_CALLBACK_TOKEN is required')

  const callbackValue = configuration.MPESA_CALLBACK_URL
    ?? configuration.DARAJA_CALLBACK_BASE_URL
    ?? configuration.APP_URL
  if (!callbackValue) {
    errors.push('MPESA_CALLBACK_URL, DARAJA_CALLBACK_BASE_URL, or APP_URL is required')
  } else {
    try {
      const callbackUrl = new URL(callbackValue)
      const token = configuration.DARAJA_CALLBACK_TOKEN ?? ''
      const expectedPath = `/api/v1/orders/mpesa/callback/${token}`
      const hostIsPlaceholder = /localhost|127\.0\.0\.1|example\.com|your[-.]|\.local$/i.test(callbackUrl.hostname)
      const pathIsValid = configuration.MPESA_CALLBACK_URL
        ? callbackUrl.pathname === expectedPath
        : callbackUrl.pathname === '/' || callbackUrl.pathname === expectedPath
      if (callbackUrl.protocol !== 'https:' || hostIsPlaceholder || !pathIsValid || callbackUrl.search || callbackUrl.hash || callbackUrl.username || callbackUrl.password) {
        errors.push('the production callback must be a public HTTPS KitCulture callback URL')
      }
    } catch {
      errors.push('the production callback URL is invalid')
    }
  }

  return errors
}

const productionDarajaErrors = productionDarajaConfigurationErrors({
  ...parsed.data,
  MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL,
})
if (productionDarajaErrors.length) {
  throw new Error(`Invalid production M-Pesa configuration: ${productionDarajaErrors.join('; ')}`)
}

export const env = {
  ...parsed.data,
  DARAJA_ENV: resolveDarajaEnvironment(parsed.data.NODE_ENV, parsed.data.DARAJA_ENV),
  DARAJA_TRANSACTION_TYPE: resolveDarajaTransactionType(parsed.data.NODE_ENV, parsed.data.DARAJA_TRANSACTION_TYPE),
}

export function isAllowedClientOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const configuredOrigin = new URL(env.CLIENT_ORIGIN)
    const requestOrigin = new URL(origin)
    if (requestOrigin.origin === configuredOrigin.origin) return true
    // Vite may fall back to 5174 or 5175 when its default development port is occupied.
    return env.NODE_ENV === 'development'
      && configuredOrigin.protocol === 'http:'
      && configuredOrigin.hostname === 'localhost'
      && configuredOrigin.port === '5173'
      && requestOrigin.protocol === configuredOrigin.protocol
      && requestOrigin.hostname === configuredOrigin.hostname
      && ['5174', '5175'].includes(requestOrigin.port)
  } catch {
    return false
  }
}

export function isAllowedSiteImageOrigin(origin: string | undefined): boolean {
  if (isAllowedClientOrigin(origin)) return true
  if (!origin || !env.MARKETHUB_PUBLIC_URL) return false
  try {
    return new URL(origin).origin === new URL(env.MARKETHUB_PUBLIC_URL).origin
  } catch {
    return false
  }
}