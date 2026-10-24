import cors from 'cors'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isAllowedClientOrigin } from './config/env.js'
import { adminPool, pool } from './config/database.js'
import { inspectDatabaseError } from './config/database-diagnostics.js'
import { logger } from './config/logger.js'
import { authRouter } from './modules/auth/routes.js'
import { catalogueRouter } from './modules/catalogue/routes.js'
import { ordersRouter } from './modules/orders/routes.js'
import { accountRouter } from './modules/account/routes.js'
import { adminAuthRouter } from './modules/admin/auth.js'
import { adminRouter } from './modules/admin/routes.js'

export const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 3)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", 'data:', 'https:'],
      frameSrc: ["'self'", 'https://maps.google.com', 'https://www.google.com'],
    },
  },
}))
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || isAllowedClientOrigin(origin)),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use(express.json({ limit: '100kb', strict: true }))
app.use(pinoHttp({ logger, autoLogging: { ignore: (request) => request.url.startsWith('/health/') || request.url === '/health' } }))

app.get('/health', async (request, response) => {
  const databaseQuery = pool ? pool.query('SELECT 1 AS ok') : Promise.reject(new Error('Store database is not configured'))
  const adminQuery = adminPool && adminPool !== pool
    ? adminPool.query('SELECT 1 AS ok')
    : databaseQuery

  const [storeResult, adminResult] = await Promise.allSettled([databaseQuery, adminQuery])
  logDatabaseCheckFailure(request, storeResult, 'health.store-database')
  if (adminPool !== pool) logDatabaseCheckFailure(request, adminResult, 'health.admin-database')

  response.json({
    status: 'ok',
    service: 'kitculture-api',
    databaseConfigured: Boolean(pool),
    adminDatabaseConfigured: Boolean(adminPool),
    databaseConnected: storeResult.status === 'fulfilled',
    adminDatabaseConnected: adminResult.status === 'fulfilled',
  })
})

app.get('/health/live', (_request, response) => {
  response.json({ status: 'ok', service: 'kitculture-api' })
})

app.get('/health/ready', async (request, response) => {
  const databaseQuery = pool ? pool.query('SELECT 1') : Promise.reject(new Error('Store database is not configured'))
  const adminQuery = adminPool && adminPool !== pool
    ? adminPool.query('SELECT 1')
    : databaseQuery

  const [storeResult, adminResult] = await Promise.allSettled([databaseQuery, adminQuery])
  logDatabaseCheckFailure(request, storeResult, 'health.store-database')
  if (adminPool !== pool) logDatabaseCheckFailure(request, adminResult, 'health.admin-database')
  const checks = {
    storeDatabase: storeResult.status === 'fulfilled' ? 'ok' : 'unavailable',
    adminDatabase: adminResult.status === 'fulfilled' ? 'ok' : 'unavailable',
  }
  const ready = checks.storeDatabase === 'ok' && checks.adminDatabase === 'ok'
  response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks })
})

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === 'production' ? 120 : 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (request) => request.method === 'GET' || request.path === '/logout' || request.path === '/session/activity',
})
app.use('/api/v1', apiLimiter)
app.use('/api/v1/auth', authLimiter, authRouter)
app.use('/api/v1/account', accountRouter)
app.use('/api/v1/admin', authLimiter, adminAuthRouter)
app.use('/api/v1/admin', adminRouter)
app.use('/api/v1', catalogueRouter)
app.use('/api/v1', ordersRouter)

const clientDist = fileURLToPath(new URL('../../dist', import.meta.url))
if (existsSync(clientDist)) {
  const serveClientAssets = express.static(clientDist, { index: false })
  app.use((request, response, next) => {
    if (request.path === '/api' || request.path.startsWith('/api/')
      || request.path === '/health' || request.path.startsWith('/health/')) {
      next()
      return
    }
    serveClientAssets(request, response, next)
  })
  const serveSpaShell: RequestHandler = (request, response, next) => {
    if (request.path !== '/' && !request.get('accept')?.includes('text/html')) {
      next()
      return
    }
    response.sendFile('index.html', { root: clientDist }, (error) => {
      if (error) next(error)
    })
  }
  app.get('/', serveSpaShell)
  app.get(/^(?!\/api(?:\/|$)|\/health(?:\/|$)).*/, serveSpaShell)
}

app.use((_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } })
})

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (response.headersSent) return
  const databaseError = inspectDatabaseError(error)
  if (databaseError.category) {
    request.log.error({
      requestId: request.id,
      operation: response.locals.databaseOperation ?? 'http.request',
      category: databaseError.category,
      errors: databaseError.errors,
    }, 'Database operation failed')
    if (databaseError.category === 'connection') {
      response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database services are temporarily unavailable. Please try again shortly.' } })
      return
    }
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
    return
  }
  request.log.error({ err: error, requestId: request.id }, 'Request failed')
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded file exceeds the 8 MB limit.' } })
    return
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
}
app.use(errorHandler)

function logDatabaseCheckFailure(
  request: express.Request,
  result: PromiseSettledResult<unknown>,
  operation: string,
): void {
  if (result.status === 'fulfilled') return
  const diagnostics = inspectDatabaseError(result.reason)
  request.log.error({
    requestId: request.id,
    operation,
    category: diagnostics.category ?? 'query',
    errors: diagnostics.errors,
  }, 'Database health check failed')
}