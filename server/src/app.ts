import cors from 'cors'
import compression from 'compression'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isAllowedClientOrigin, isAllowedSiteImageOrigin } from './config/env.js'
import { adminPool, pool } from './config/database.js'
import { inspectDatabaseError } from './config/database-diagnostics.js'
import { logger } from './config/logger.js'
import { authRouter } from './modules/auth/routes.js'
import { catalogueRouter } from './modules/catalogue/routes.js'
import { ordersRouter } from './modules/orders/routes.js'
import { accountRouter } from './modules/account/routes.js'
import { adminAuthRouter } from './modules/admin/auth.js'
import { adminBiometricsRouter } from './modules/admin/biometrics.js'
import { adminRouter } from './modules/admin/routes.js'
import { operationsRouter } from './modules/operations/routes.js'
import { adminEcosystemRouter } from './modules/admin/ecosystem.js'
import { publicLaundryRouter } from './modules/laundry/routes.js'
import { publicApiCache } from './middleware/public-cache.js'
import { createOriginAuthentication } from './middleware/origin-auth.js'
import { requestMetrics } from './middleware/request-metrics.js'
import { recordMonitoringEvent } from './modules/operations/monitoring-recorder.js'
import { createWafMiddleware } from './security/waf.js'
import { loadPersistedIpPolicies } from './security/ip-policy.js'
import { createAccountRateLimiter, createSecurityRateLimiter, isRateLimitStorageUnavailable } from './security/distributed-rate-limit.js'

export const app = express()

const marketHubFrameOrigin = (() => {
  try { return env.MARKETHUB_PUBLIC_URL ? new URL(env.MARKETHUB_PUBLIC_URL).origin : null } catch { return null }
})()

app.disable('x-powered-by')
app.set('trust proxy', 3)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      frameSrc: ["'self'", ...(marketHubFrameOrigin ? [marketHubFrameOrigin] : []), 'https://maps.google.com', 'https://www.google.com'],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'sameorigin' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
}))
app.use(compression())
app.use(cors((request, callback) => {
  const origin = request.get('origin')
  const publicLaundryRequest = /^\/api\/v1\/laundry(?:\/|$)/.test(request.path)
  const allowedClient = isAllowedClientOrigin(origin)
  const allowedLaundryClient = publicLaundryRequest && isAllowedSiteImageOrigin(origin)
  callback(null, {
    origin: allowedClient || allowedLaundryClient ? origin : false,
    credentials: allowedClient,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
}))
app.use(['/api/v1/store/site-images', '/api/v1/store/site-content'], (request, response, next) => {
  const origin = request.get('origin')
  if (request.method === 'GET' && origin && isAllowedSiteImageOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.vary('Origin')
  }
  next()
})
app.use(pinoHttp({ logger, autoLogging: { ignore: (request) => request.url.startsWith('/health/') || request.url === '/health' } }))
app.use(requestMetrics)
app.use(express.json({ limit: '100kb', strict: true }))
app.use((error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (!(error instanceof Error) || !('type' in error) || error.type !== 'entity.parse.failed') {
    next(error)
    return
  }
  const routeGroup = request.path.startsWith('/api/v1/admin') ? '/api/v1/admin'
    : request.path.startsWith('/api/v1/operations') ? '/api/v1/operations'
      : request.path.startsWith('/api/v1/marketplace') ? '/api/v1/marketplace' : '/api/v1/other'
  const requestId = String(request.id)
  request.log.warn({ requestId, method: request.method, routeGroup }, 'Malformed JSON request rejected')
  recordMonitoringEvent({
    eventType: 'security.request.malformed',
    category: 'security',
    severity: 'warning',
    sourceService: 'kitculture-api',
    instanceId: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local',
    requestId,
    metadata: { method: request.method, routeGroup, reason: 'invalid_json' },
  })
  response.setHeader('Cache-Control', 'no-store')
  response.status(400).json({ error: { code: 'INVALID_JSON_BODY', message: 'The request body must be valid JSON.' } })
})
void loadPersistedIpPolicies().catch(() => undefined)
app.use(createWafMiddleware(env.WAF_MODE))
app.use(createOriginAuthentication(env.ORIGIN_AUTH_TOKEN))

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'kitculture-api' })
})

app.get('/health/live', (_request, response) => {
  response.json({ status: 'ok', service: 'kitculture-api' })
})

app.get('/health/ready', async (request, response) => {
  const databaseQuery = pool ? pool.query('SELECT 1') : Promise.reject(new Error('Store database is not configured'))
  const adminQuery = adminPool
    ? adminPool.query('SELECT 1')
    : Promise.reject(new Error('Admin database is not configured'))

  const [storeResult, adminResult] = await Promise.allSettled([databaseQuery, adminQuery])
  logDatabaseCheckFailure(request, storeResult, 'health.store-database')
  logDatabaseCheckFailure(request, adminResult, 'health.admin-database')
  const ready = storeResult.status === 'fulfilled' && adminResult.status === 'fulfilled'
  response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' })
})

const apiLimiter = createSecurityRateLimiter('api.global', {
  windowMs: 60_000,
  limit: env.NODE_ENV === 'production' ? 120 : 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})
const authLimiter = createAccountRateLimiter('auth.account', {
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (request) => request.method === 'GET' || request.path === '/logout' || request.path === '/session/activity',
}, (request) => request.body?.email ?? request.body?.identity ?? request.body?.roleNumber)
app.use('/api/v1', apiLimiter)
app.use('/api/v1', publicApiCache)
app.use('/api/v1/auth', authLimiter, authRouter)
app.use('/api/v1/account', accountRouter)
app.use('/api/v1/admin', createSecurityRateLimiter('admin.api', { windowMs: 60_000, limit: 120 }))
app.use('/api/v1/admin', (request, response, next) => {
  if (request.method === 'POST' && /^\/api\/v1\/admin\/(?:verify|login|operations-login|(?:super-admin|finance-admin|inventory-admin|marketing-admin|content-admin|laundry-admin)\/login)\/?(?:\?|$)/.test(request.originalUrl)) {
    authLimiter(request, response, next)
    return
  }
  next()
}, adminAuthRouter)
app.use('/api/v1/super-admin/biometrics', adminBiometricsRouter)
app.use('/api/v1/admin', adminEcosystemRouter)
app.use('/api/v1/operations', operationsRouter)
app.use('/api/v1/admin', adminRouter)
app.use('/api/v1/laundry', publicLaundryRouter)
app.use('/api/v1', catalogueRouter)
app.use('/api/v1', ordersRouter)

const clientDist = fileURLToPath(new URL('../../dist', import.meta.url))
if (existsSync(clientDist)) {
  const serveClientAssets = express.static(clientDist, {
    index: false,
    setHeaders: (response, filePath) => {
      const immutableAsset = /[\\/]assets[\\/]/.test(filePath)
      response.setHeader('Cache-Control', immutableAsset
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600')
    },
  })
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
    response.sendFile('index.html', { root: clientDist, headers: { 'Cache-Control': 'no-cache' } }, (error) => {
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
  const requestLogger = request.log ?? logger
  if (isRateLimitStorageUnavailable(error)) {
    requestLogger.error({ requestId: String(request.id), code: 'RATE_LIMIT_STORE_UNAVAILABLE' }, 'Shared rate-limit storage failed; request rejected')
    response.status(503).json({ error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Request protection is temporarily unavailable.', requestId: String(request.id) } })
    return
  }
  const databaseError = inspectDatabaseError(error)
  if (databaseError.category) {
    requestLogger.error({
      requestId: request.id,
      operation: response.locals.databaseOperation ?? 'http.request',
      category: databaseError.category,
      errors: databaseError.errors,
    }, 'Database operation failed')
    if (databaseError.category === 'connection') {
      response.status(503).json({ error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database services are temporarily unavailable. Please try again shortly.',
        requestId: String(request.id),
      } })
      return
    }
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId: String(request.id) } })
    return
  }
  requestLogger.error({
    requestId: String(request.id),
    errorType: error instanceof Error ? error.name : 'UnknownError',
  }, 'Request failed')
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body exceeds the 100 KB limit.' } })
    return
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId: String(request.id) } })
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