import compression from 'compression'
import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { pool } from './database/connection.js'
import { marketplaceAdminRouter } from './modules/admin/marketplace-auth.js'
import { marketplaceAdminDataRouter } from './modules/admin/marketplace-routes.js'
import { submissionRouter } from './modules/marketplace/submission.js'
import { marketplaceRouter } from './modules/marketplace/routes.js'
import { paymentRouter } from './modules/payments/routes.js'

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet())
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
app.get('/health/ready', async (_request, response) => {
  if (!pool) {
    response.status(503).json({ status: 'not_ready', database: 'not_configured' })
    return
  }
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'marketplace'
          AND has_schema_privilege(current_user, oid, 'USAGE')
      ) AS schema_access
    `)
    if (result.rows[0]?.schema_access !== true) throw new Error('Marketplace schema access is unavailable.')
    response.json({ status: 'ready', database: 'ok' })
  } catch {
    response.status(503).json({ status: 'not_ready', database: 'unavailable' })
  }
})

app.use('/api/v1/marketplace', marketplaceRouter)
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

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file exceeds the 8 MB limit.' } })
    return
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
}
app.use(errorHandler)