import compression from 'compression'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { marketplaceDatabaseConnectionState, pool } from './database/connection.js'
import { databaseErrorResponseCode } from './database/diagnostics.js'
import { getMarketplaceEmailProviderStatus } from './modules/email/service.js'
import { getKitzAdminServiceStatus, marketplaceAdminRouter } from './modules/admin/marketplace-auth.js'
import { marketplaceAdminDataRouter } from './modules/admin/marketplace-routes.js'
import { marketplaceSellerPasswordRecoveryRouter } from './modules/marketplace/seller-password-recovery.js'
import { marketplaceSellerAuthRouter, marketplaceSellerDataRouter } from './modules/marketplace/seller-portal.js'
import { submissionRouter } from './modules/marketplace/submission.js'
import { marketplaceRouter } from './modules/marketplace/routes.js'
import { paymentRouter } from './modules/payments/routes.js'
import { safeWorkerError, workerHealthSnapshot } from './workers/health.js'

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'blob:'] } } }))
app.use(compression())
const platformOrigin = process.env.PLATFORM_ORIGIN || 'http://127.0.0.1:5173'
const allowedOrigins = new Set([platformOrigin])
if (process.env.NODE_ENV !== 'production') {
  for (const host of ['127.0.0.1', 'localhost']) for (const port of [5173, 5174]) allowedOrigins.add(`http://${host}:${port}`)
}
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }))
app.use(express.json({ limit: '100kb', strict: true }))
app.use((request, response, next) => {
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next()
  if (request.path.startsWith('/api/v1/marketplace/payments/callback/')) return next()
  if (!allowedOrigins.has(request.get('Origin') ?? '')) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'The request origin is not allowed.' } })
    return
  }
  next()
})
app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: process.env.NODE_ENV === 'production' ? 120 : 600, standardHeaders: 'draft-8', legacyHeaders: false }))

app.get('/health/live', (_request, response) => response.json({ status: 'ok', service: 'markethub-platform' }))
app.get('/health/workers', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json({ workers: workerHealthSnapshot(), emailProvider: getMarketplaceEmailProviderStatus(), centralAdminAuth: getKitzAdminServiceStatus() })
})
app.get('/health/ready', async (_request, response) => {
  const workers = workerHealthSnapshot()
  const emailProvider = getMarketplaceEmailProviderStatus()
  const centralAdminAuth = getKitzAdminServiceStatus()
  if (!pool) {
    response.status(503).json({ status: 'not_ready', database: 'not_configured', workers, emailProvider, centralAdminAuth })
    return
  }
  try {
    const result = await pool.query(`
      WITH required_tables(name) AS (VALUES
        ('marketplace_admin_invitations'), ('marketplace_admin_sessions'), ('marketplace_admin_users'),
        ('marketplace_admin_verification_tokens'), ('marketplace_audit_logs'), ('marketplace_categories'),
        ('marketplace_contact_unlocks'), ('marketplace_counties'), ('marketplace_email_events'),
        ('marketplace_featured_products'), ('marketplace_notifications'), ('marketplace_payment_callbacks'),
        ('marketplace_payments'), ('marketplace_product_access'), ('marketplace_product_images'),
        ('marketplace_product_reports'), ('marketplace_product_views'), ('marketplace_products'),
        ('marketplace_seller_accounts'), ('marketplace_seller_password_reset_tokens'), ('marketplace_seller_sessions'),
        ('marketplace_seller_verification_tokens'), ('marketplace_sellers'), ('marketplace_settings'),
        ('marketplace_subcategories')
      ), required_privileges(name, privilege) AS (VALUES
        ('marketplace_admin_invitations', 'SELECT'), ('marketplace_admin_invitations', 'INSERT'), ('marketplace_admin_invitations', 'UPDATE'),
        ('marketplace_admin_users', 'SELECT'), ('marketplace_admin_users', 'INSERT'), ('marketplace_admin_users', 'UPDATE'),
        ('marketplace_admin_sessions', 'SELECT'), ('marketplace_admin_sessions', 'INSERT'), ('marketplace_admin_sessions', 'DELETE'),
        ('marketplace_admin_verification_tokens', 'SELECT'), ('marketplace_admin_verification_tokens', 'INSERT'), ('marketplace_admin_verification_tokens', 'UPDATE'),
        ('marketplace_audit_logs', 'SELECT'), ('marketplace_audit_logs', 'INSERT'),
        ('marketplace_categories', 'SELECT'), ('marketplace_categories', 'INSERT'), ('marketplace_categories', 'UPDATE'),
        ('marketplace_subcategories', 'SELECT'), ('marketplace_subcategories', 'INSERT'), ('marketplace_subcategories', 'UPDATE'),
        ('marketplace_counties', 'SELECT'),
        ('marketplace_contact_unlocks', 'SELECT'), ('marketplace_contact_unlocks', 'INSERT'),
        ('marketplace_email_events', 'SELECT'), ('marketplace_email_events', 'INSERT'), ('marketplace_email_events', 'UPDATE'),
        ('marketplace_featured_products', 'SELECT'), ('marketplace_featured_products', 'INSERT'), ('marketplace_featured_products', 'UPDATE'), ('marketplace_featured_products', 'DELETE'),
        ('marketplace_notifications', 'SELECT'), ('marketplace_notifications', 'INSERT'), ('marketplace_notifications', 'UPDATE'),
        ('marketplace_payments', 'SELECT'), ('marketplace_payments', 'INSERT'), ('marketplace_payments', 'UPDATE'),
        ('marketplace_payment_callbacks', 'SELECT'), ('marketplace_payment_callbacks', 'INSERT'), ('marketplace_payment_callbacks', 'UPDATE'),
        ('marketplace_product_access', 'SELECT'), ('marketplace_product_access', 'INSERT'), ('marketplace_product_access', 'DELETE'),
        ('marketplace_product_images', 'SELECT'), ('marketplace_product_images', 'INSERT'), ('marketplace_product_images', 'DELETE'),
        ('marketplace_product_reports', 'SELECT'), ('marketplace_product_reports', 'INSERT'), ('marketplace_product_reports', 'UPDATE'),
        ('marketplace_product_views', 'INSERT'),
        ('marketplace_products', 'SELECT'), ('marketplace_products', 'INSERT'), ('marketplace_products', 'UPDATE'),
        ('marketplace_seller_accounts', 'SELECT'), ('marketplace_seller_accounts', 'INSERT'), ('marketplace_seller_accounts', 'UPDATE'),
        ('marketplace_seller_sessions', 'SELECT'), ('marketplace_seller_sessions', 'INSERT'), ('marketplace_seller_sessions', 'DELETE'),
        ('marketplace_seller_verification_tokens', 'SELECT'), ('marketplace_seller_verification_tokens', 'INSERT'), ('marketplace_seller_verification_tokens', 'UPDATE'),
        ('marketplace_seller_password_reset_tokens', 'SELECT'), ('marketplace_seller_password_reset_tokens', 'INSERT'), ('marketplace_seller_password_reset_tokens', 'UPDATE'),
        ('marketplace_sellers', 'SELECT'), ('marketplace_sellers', 'INSERT'), ('marketplace_sellers', 'UPDATE'),
        ('marketplace_settings', 'SELECT'), ('marketplace_settings', 'INSERT'), ('marketplace_settings', 'UPDATE')
      )
      SELECT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'marketplace'
          AND has_schema_privilege(current_user, oid, 'USAGE')
      ) AS schema_access,
      ARRAY(
        SELECT name FROM required_tables
        WHERE to_regclass(format('%I.%I', 'marketplace', name)) IS NULL
        ORDER BY name
      ) AS missing_relations,
      ARRAY(
        SELECT name || ':' || privilege FROM required_privileges
        WHERE to_regclass(format('%I.%I', 'marketplace', name)) IS NOT NULL
          AND NOT has_table_privilege(current_user, format('%I.%I', 'marketplace', name), privilege)
        ORDER BY name, privilege
      ) AS missing_privileges
    `)
    const schemaState = result.rows[0]
    if (schemaState?.schema_access !== true) throw Object.assign(new Error('Required marketplace schema is missing or not accessible.'), { code: '3F000', schema: 'marketplace' })
    const missingRelations = schemaState?.missing_relations as string[] | undefined
    if (missingRelations?.length) throw Object.assign(new Error(`Required marketplace relations are missing: ${missingRelations.join(', ')}.`), { code: '42P01', table: missingRelations.join(',') })
    const missingPrivileges = schemaState?.missing_privileges as string[] | undefined
    if (missingPrivileges?.length) throw Object.assign(new Error(`Required marketplace privileges are unavailable: ${missingPrivileges.join(', ')}.`), { code: '42501', table: missingPrivileges.join(',') })
    const workerFailure = Object.values(workers).some((worker) => worker.enabled && worker.consecutiveFailures > 0)
    const status = emailProvider.configured && centralAdminAuth.configured && !workerFailure ? 'ready' : 'degraded'
    response.json({ status, database: 'ok', workers, emailProvider, centralAdminAuth })
  } catch (error) {
    console.error('MarketHub readiness check failed', { operation: 'health.ready.database_check', ...safeWorkerError(error) })
    response.status(503).json({ status: 'not_ready', database: 'unavailable', workers, emailProvider, centralAdminAuth })
  }
})

app.use('/api/v1/marketplace', marketplaceRouter)
app.use('/api/v1/marketplace', marketplaceSellerAuthRouter)
app.use('/api/v1/marketplace', marketplaceSellerPasswordRecoveryRouter)
app.use('/api/v1/marketplace', marketplaceSellerDataRouter)
app.use('/api/v1/marketplace', submissionRouter)
app.use('/api/v1/marketplace/payments', paymentRouter)
app.use('/api/v1/admin/marketplace', marketplaceAdminRouter)
app.use('/api/v1/admin/marketplace', marketplaceAdminDataRouter)
app.use('/api', (_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested API resource was not found.' } }))
const clientDist = fileURLToPath(new URL('../../dist', import.meta.url))
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    index: false,
    setHeaders: (response, filePath) => {
      const immutableAsset = /[\\/]assets[\\/]/.test(filePath)
      response.setHeader('Cache-Control', immutableAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
    },
  }))
  app.get(/^(?!\/api(?:\/|$)|\/health(?:\/|$)).*/, (_request, response, next) => {
    response.sendFile('index.html', { root: clientDist, headers: { 'Cache-Control': 'no-cache' } }, (error) => { if (error) next(error) })
  })
}
app.use((_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } }))

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file exceeds the 8 MB limit.' } })
    return
  }
  const diagnostics = safeWorkerError(error)
  const databaseFailure = diagnostics.category === 'database'
  console.error('Unhandled MarketHub request error', {
    method: request.method,
    route: request.route?.path ?? 'unknown',
    ...diagnostics,
    databaseConnection: marketplaceDatabaseConnectionState(),
  })
  if (databaseFailure) {
    response.status(503).json({ error: { code: databaseErrorResponseCode(diagnostics.databaseError), message: 'Marketplace database is temporarily unavailable.' } })
    return
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
}
app.use(errorHandler)