import 'dotenv/config'
import { z } from 'zod'

export function resolveDatabaseUrl(primaryKey: 'DATABASE_URL' | 'ADMIN_DATABASE_URL', fallbackKeys: readonly string[] = []): string | undefined {
  const configuredValue = process.env[primaryKey]?.trim()
  if (configuredValue) return configuredValue

  for (const candidate of fallbackKeys) {
    const value = process.env[candidate]?.trim()
    if (value) return value
  }

  const directFromRailway = primaryKey === 'DATABASE_URL'
    ? process.env.MYSQL_URL ?? process.env.MYSQL_URI
    : process.env.ADMIN_MYSQL_URL ?? process.env.MYSQL_URL
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
  MYSQL_URL: z.string().min(1).optional(),
  ADMIN_MYSQL_URL: z.string().min(1).optional(),
  MYSQL_SSL_CA: z.string().min(1).optional(),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  DARAJA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  DARAJA_CONSUMER_KEY: z.string().min(1).optional(),
  DARAJA_CONSUMER_SECRET: z.string().min(1).optional(),
  DARAJA_PASSKEY: z.string().min(1).optional(),
  DARAJA_SHORTCODE: z.string().regex(/^\d{5,20}$/).optional(),
  DARAJA_CALLBACK_BASE_URL: z.string().url().optional(),
  DARAJA_CALLBACK_TOKEN: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const legacyCallbackBaseUrl = (() => {
  if (!process.env.MPESA_CALLBACK_URL) return undefined
  try { return new URL(process.env.MPESA_CALLBACK_URL).origin } catch { return undefined }
})()

const parsed = schema.safeParse({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? resolveDatabaseUrl('DATABASE_URL', ['MYSQL_URL', 'MYSQL_URI']),
  ADMIN_DATABASE_URL: process.env.ADMIN_DATABASE_URL ?? resolveDatabaseUrl('ADMIN_DATABASE_URL', ['ADMIN_MYSQL_URL', 'MYSQL_URL']),
  DARAJA_ENV: process.env.DARAJA_ENV ?? process.env.MPESA_ENV,
  DARAJA_CONSUMER_KEY: process.env.DARAJA_CONSUMER_KEY ?? process.env.MPESA_CONSUMER_KEY,
  DARAJA_CONSUMER_SECRET: process.env.DARAJA_CONSUMER_SECRET ?? process.env.MPESA_CONSUMER_SECRET,
  DARAJA_PASSKEY: process.env.DARAJA_PASSKEY ?? process.env.MPESA_PASSKEY,
  DARAJA_SHORTCODE: process.env.DARAJA_SHORTCODE ?? process.env.MPESA_SHORTCODE,
  DARAJA_CALLBACK_BASE_URL: process.env.DARAJA_CALLBACK_BASE_URL ?? legacyCallbackBaseUrl,
  DARAJA_CALLBACK_TOKEN: process.env.DARAJA_CALLBACK_TOKEN ?? process.env.MPESA_CALLBACK_TOKEN,
})
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; ')}`)
}

export const env = parsed.data

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