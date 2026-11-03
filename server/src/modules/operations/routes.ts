import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hash } from 'bcryptjs'
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { adminDb, adminPool, pool } from '../../config/database.js'
import { inspectDatabaseError } from '../../config/database-diagnostics.js'
import { isAllowedClientOrigin } from '../../config/env.js'
import { bcryptPasswordSchema, verifyPassword } from '../../config/password-policy.js'
import { nextSessionExpiry, operationsSessionAbsoluteLifetimeMs, operationsSessionIdleTimeoutMs } from '../../config/session-policy.js'
import { adminUsers, monitoringAlerts, monitoringDetectionRules, monitoringEvents, monitoringWorkerState, operationsAuditEvents, operationsIncidentEvents, operationsIncidents, operationsSessions, operationsUsers } from '../../database/admin-schema.js'
import { getTelemetryQueueState } from './telemetry-store.js'
import { cancelSecurityScan, getSecurityOverview, getSecurityScan, listSecurityFindings, listSecurityScans, startSecurityScan, updateSecurityFinding, type ScannerModule } from '../security/scanner-engine.js'
import { getRequestMetrics } from '../../middleware/request-metrics.js'
import { summarizeDatabaseAggregates } from './database-performance.js'

export const operationsRouter = Router()
const operationsCookieName = 'kc_ops_session'
const operationsLoginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const operationsSignupLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })

type OperationsUser = { id: number; email: string; fullName: string }
type OperationsRequest = Request & { operationsUser?: OperationsUser }

function hashOperationsToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function matchesOperationsSignupSecret(candidate: string, configuredSecret = env.OPERATIONS_SIGNUP_SECRET) {
  if (!configuredSecret) return false
  const candidateDigest = createHash('sha256').update(candidate).digest()
  const configuredDigest = createHash('sha256').update(configuredSecret).digest()
  return timingSafeEqual(candidateDigest, configuredDigest)
}

function operationsCookieToken(request: Request) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${operationsCookieName}=`))
  if (!cookie) return null
  try { return decodeURIComponent(cookie.slice(operationsCookieName.length + 1)) } catch { return null }
}

function setOperationsCookie(response: Response, token: string, maxAge = operationsSessionIdleTimeoutMs) {
  response.cookie(operationsCookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/operations',
    maxAge,
  })
}

function clearOperationsCookie(response: Response) {
  response.clearCookie(operationsCookieName, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/operations',
  })
}

function authenticatedOperationsUser(request: Request) {
  return (request as OperationsRequest).operationsUser
}

export function classifyOperationsDatabaseFailure(error: unknown) {
  const diagnostics = inspectDatabaseError(error)
  if (diagnostics.category === 'missing_table' || diagnostics.category === 'missing_column') {
    return {
      status: 503,
      code: 'OPERATIONS_SCHEMA_UNAVAILABLE',
      message: 'Operations data is temporarily unavailable because its database schema is incomplete.',
      diagnostics,
    }
  }
  if (diagnostics.category === 'connection') {
    return {
      status: 503,
      code: 'OPERATIONS_DATABASE_UNAVAILABLE',
      message: 'Operations data is temporarily unavailable. Please try again shortly.',
      diagnostics,
    }
  }
  return null
}

const authenticateOperations = async (request: Request, response: Response, next: (error?: unknown) => void) => {
  const token = operationsCookieToken(request)
  if (!token) {
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
    return
  }
  if (!adminDb) {
    operationsUnavailable(response, String(request.id))
    return
  }
  try {
    const now = new Date()
    const [session] = await adminDb.select({
      id: operationsSessions.id,
      operationsUserId: operationsSessions.operationsUserId,
      createdAt: operationsSessions.createdAt,
      expiresAt: operationsSessions.expiresAt,
    }).from(operationsSessions)
      .where(and(eq(operationsSessions.tokenHash, hashOperationsToken(token)), gt(operationsSessions.expiresAt, now)))
      .limit(1)
    if (!session || session.expiresAt <= now) {
      if (session) await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
      clearOperationsCookie(response)
      response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
      return
    }
    const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, disabledAt: operationsUsers.disabledAt })
      .from(operationsUsers).where(eq(operationsUsers.id, session.operationsUserId)).limit(1)
    if (!user || user.disabledAt) {
      await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
      clearOperationsCookie(response)
      response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
      return
    }
    const expiry = nextSessionExpiry(session.createdAt, now, operationsSessionIdleTimeoutMs, operationsSessionAbsoluteLifetimeMs)
    if (!expiry) {
      await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
      clearOperationsCookie(response)
      response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
      return
    }
    ;(request as OperationsRequest).operationsUser = { id: user.id, email: user.email, fullName: user.fullName }
    next()
  } catch (error) {
    next(error)
  }
}

operationsRouter.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || isAllowedClientOrigin(request.get('origin'))) {
    next()
    return
  }
  response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
})

const loginSchema = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) }).strict()
const operationsRegisterSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: bcryptPasswordSchema(14),
  fullName: z.string().trim().min(2).max(160),
  secretKey: z.string().min(1).max(512),
}).strict()

operationsRouter.get('/registration-status', async (request, response) => {
  if (!env.OPERATIONS_SIGNUP_SECRET) {
    response.json({ data: { available: false } })
    return
  }
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  await adminDb.select({ id: operationsUsers.id }).from(operationsUsers).limit(1)
  response.json({ data: { available: true } })
})

operationsRouter.post('/register', operationsSignupLimiter, async (request, response) => {
  if (!env.OPERATIONS_SIGNUP_SECRET) {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'IT operator signup is not available.' } })
    return
  }
  const input = operationsRegisterSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_OPERATIONS_REGISTRATION', message: 'Check the account details and use a password of at least 14 characters.' } })
    return
  }
  if (!matchesOperationsSignupSecret(input.data.secretKey)) {
    response.status(403).json({ error: { code: 'INVALID_OPERATIONS_SIGNUP_KEY', message: 'The IT signup key is invalid.' } })
    return
  }
  if (!adminDb) return operationsUnavailable(response, String(request.id))

  const passwordHash = await hash(input.data.password, 12)
  const token = randomBytes(32).toString('base64url')
  const createdAt = new Date()
  const expiresAt = nextSessionExpiry(createdAt, createdAt, operationsSessionIdleTimeoutMs, operationsSessionAbsoluteLifetimeMs)!
  const user = await adminDb.transaction(async (transaction) => {
    const [existing] = await transaction.select({ id: operationsUsers.id }).from(operationsUsers)
      .where(eq(operationsUsers.email, input.data.email)).limit(1)
    if (existing) return null
    const [created] = await transaction.insert(operationsUsers).values({
      email: input.data.email,
      fullName: input.data.fullName,
      passwordHash,
    }).returning({ id: operationsUsers.id })
    await transaction.insert(operationsSessions).values({
      operationsUserId: created.id,
      tokenHash: hashOperationsToken(token),
      createdAt,
      expiresAt,
    })
    await transaction.insert(operationsAuditEvents).values({
      actorOperationsUserId: created.id,
      actorType: 'operations_user',
      action: 'operations.signup',
      targetType: 'operations_user',
      targetId: String(created.id),
    })
    return { id: created.id, email: input.data.email, fullName: input.data.fullName }
  })
  if (!user) {
    response.status(409).json({ error: { code: 'OPERATIONS_ACCOUNT_UNAVAILABLE', message: 'Unable to create an IT account with those details.' } })
    return
  }
  setOperationsCookie(response, token)
  response.status(201).json({ data: { user } })
})

operationsRouter.post('/login', operationsLoginLimiter, async (request, response) => {
  if (!adminDb) return operationsUnavailable(response)
  const input = loginSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_OPERATIONS_LOGIN', message: 'Enter a valid operations email and password.' } })
  const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, passwordHash: operationsUsers.passwordHash, disabledAt: operationsUsers.disabledAt })
    .from(operationsUsers).where(eq(operationsUsers.email, input.data.email)).limit(1)
  const passwordMatches = await verifyPassword(input.data.password, user?.passwordHash)
  if (!user || user.disabledAt || !passwordMatches) {
    response.status(401).json({ error: { code: 'INVALID_OPERATIONS_CREDENTIALS', message: 'The operations email or password is incorrect.' } })
    return
  }
  const token = randomBytes(32).toString('base64url')
  const createdAt = new Date()
  const expiresAt = nextSessionExpiry(createdAt, createdAt, operationsSessionIdleTimeoutMs, operationsSessionAbsoluteLifetimeMs)!
  await adminDb.transaction(async (transaction) => {
    await transaction.insert(operationsSessions).values({ operationsUserId: user.id, tokenHash: hashOperationsToken(token), createdAt, expiresAt })
    await transaction.update(operationsUsers).set({ lastLoginAt: createdAt }).where(eq(operationsUsers.id, user.id))
    await transaction.insert(operationsAuditEvents).values({
      actorOperationsUserId: user.id,
      actorType: 'operations_user',
      action: 'operations.login',
      targetType: 'operations_user',
      targetId: String(user.id),
    })
  })
  setOperationsCookie(response, token)
  response.json({ data: { user: { id: user.id, email: user.email, fullName: user.fullName } } })
})

operationsRouter.post('/logout', authenticateOperations, async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  const token = operationsCookieToken(request)
  if (token && adminDb) {
    await adminDb.transaction(async (transaction) => {
      await transaction.delete(operationsSessions).where(eq(operationsSessions.tokenHash, hashOperationsToken(token)))
      if (actor) await transaction.insert(operationsAuditEvents).values({
        actorOperationsUserId: actor.id,
        actorType: 'operations_user',
        action: 'operations.logout',
        targetType: 'operations_user',
        targetId: String(actor.id),
      })
    })
  }
  clearOperationsCookie(response)
  response.status(204).end()
})

operationsRouter.post('/session/activity', authenticateOperations, async (request, response) => {
  const token = operationsCookieToken(request)
  const actor = authenticatedOperationsUser(request)
  if (!token || !actor || !adminDb) {
    clearOperationsCookie(response)
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
    return
  }
  const now = new Date()
  const [session] = await adminDb.select({ id: operationsSessions.id, createdAt: operationsSessions.createdAt, expiresAt: operationsSessions.expiresAt })
    .from(operationsSessions).where(and(eq(operationsSessions.tokenHash, hashOperationsToken(token)), gt(operationsSessions.expiresAt, now))).limit(1)
  const expiry = session ? nextSessionExpiry(session.createdAt, now, operationsSessionIdleTimeoutMs, operationsSessionAbsoluteLifetimeMs) : null
  if (!session || !expiry) {
    if (session) await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
    clearOperationsCookie(response)
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
    return
  }
  const updated = await adminDb.update(operationsSessions).set({ expiresAt: expiry })
    .where(and(eq(operationsSessions.id, session.id), gt(operationsSessions.expiresAt, now)))
    .returning({ id: operationsSessions.id })
  if (updated.length !== 1) {
    clearOperationsCookie(response)
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
    return
  }
  setOperationsCookie(response, token, expiry.getTime() - now.getTime())
  response.status(204).end()
})
operationsRouter.use(authenticateOperations)

function operationsUnavailable(response: import('express').Response, requestId?: string) {
  return response.status(503).json({ error: {
    code: 'OPERATIONS_DATABASE_NOT_CONFIGURED',
    message: 'Operations database is not configured. Contact the site administrator.',
    ...(requestId ? { requestId } : {}),
  } })
}

export async function probeDatabase(database: { query: (sql: string) => Promise<unknown> } | null, name: string) {
  if (!database) return { name, status: 'unavailable' as const, latencyMs: null }
  const startedAt = performance.now()
  try {
    await database.query('SELECT 1 AS ok')
    return { name, status: 'healthy' as const, latencyMs: Number((performance.now() - startedAt).toFixed(1)) }
  } catch {
    return { name, status: 'unavailable' as const, latencyMs: null }
  }
}

operationsRouter.get('/me', (request, response) => {
  response.json({ data: { user: authenticatedOperationsUser(request) } })
})

operationsRouter.get('/operators', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const operators = await adminDb.select({ id: operationsUsers.id, fullName: operationsUsers.fullName })
    .from(operationsUsers)
    .where(isNull(operationsUsers.disabledAt))
    .orderBy(asc(operationsUsers.fullName))
  response.json({ data: operators })
})

const monitoringRangeQuery = z.object({
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
}).strict().refine((value) => !value.start || !value.end || value.start < value.end, 'Start must precede end.')
  .refine((value) => !value.start || !value.end || value.end.getTime() - value.start.getTime() <= 31 * 24 * 60 * 60_000, 'Date range cannot exceed 31 days.')

operationsRouter.get('/telemetry', (_request, response) => {
  const queue = getTelemetryQueueState()
  response.json({ data: {
    ...queue,
  } })
})

operationsRouter.get('/detections', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const rules = await adminDb.select({
    ruleId: monitoringDetectionRules.ruleId,
    name: monitoringDetectionRules.name,
    description: monitoringDetectionRules.description,
    condition: monitoringDetectionRules.condition,
    threshold: monitoringDetectionRules.threshold,
    windowSeconds: monitoringDetectionRules.windowSeconds,
    severity: monitoringDetectionRules.severity,
    cooldownSeconds: monitoringDetectionRules.cooldownSeconds,
    enabled: monitoringDetectionRules.enabled,
    recommendedResponse: monitoringDetectionRules.recommendedResponse,
  }).from(monitoringDetectionRules).orderBy(asc(monitoringDetectionRules.ruleId))
  response.json({ data: rules })
})

operationsRouter.get('/workers', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const workers = await adminDb.select({
    workerName: monitoringWorkerState.workerName,
    lastHeartbeatAt: monitoringWorkerState.lastHeartbeatAt,
    lastSuccessAt: monitoringWorkerState.lastSuccessAt,
    lastFailureAt: monitoringWorkerState.lastFailureAt,
    failureCount: monitoringWorkerState.failureCount,
    lastErrorCode: monitoringWorkerState.lastErrorCode,
  }).from(monitoringWorkerState).orderBy(asc(monitoringWorkerState.workerName))
  response.json({ data: workers.map((worker) => ({
    ...worker,
    status: !worker.lastHeartbeatAt ? 'unknown' : Date.now() - worker.lastHeartbeatAt.getTime() > 2 * 60_000 ? 'down' : worker.failureCount > 0 ? 'degraded' : 'healthy',
  })) })
})

operationsRouter.get('/health', async (_request, response) => {
  const queue = getTelemetryQueueState()
  const [storeDatabase, [worker]] = await Promise.all([
    probeDatabase(pool, 'store'),
    adminDb ? adminDb.select({ lastHeartbeatAt: monitoringWorkerState.lastHeartbeatAt, failureCount: monitoringWorkerState.failureCount })
      .from(monitoringWorkerState).where(eq(monitoringWorkerState.workerName, 'monitoring-detection')).limit(1)
      : Promise.resolve([]),
  ])
  const workerState = !worker?.lastHeartbeatAt ? 'unknown'
    : Date.now() - worker.lastHeartbeatAt.getTime() > 2 * 60_000 ? 'down'
      : worker.failureCount > 0 ? 'degraded' : 'healthy'
  const collectionState = queue.freshness === 'available' ? 'healthy'
    : queue.freshness === 'stale' ? 'degraded' : 'unknown'
  response.json({ data: {
    checkedAt: new Date().toISOString(),
    services: [
      { name: 'backend-api', state: 'healthy', source: 'current-request' },
      { name: 'postgresql', state: storeDatabase.status === 'healthy' ? 'healthy' : 'down', latencyMs: storeDatabase.latencyMs, source: 'live-select-1' },
      { name: 'monitoring-collection', state: collectionState, source: 'last-successful-persistence' },
      { name: 'monitoring-processing', state: workerState, source: 'persisted-worker-heartbeat' },
      { name: 'external-integrations', state: 'unknown', source: 'no-authorized-provider-probes-configured' },
    ],
    telemetryFreshness: queue.freshness,
    queue,
  } })
})

operationsRouter.get('/events', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const query = incidentListQuery.extend({ category: z.enum(['request', 'application', 'security', 'business', 'system']).optional() }).strict().safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Event pagination or category is invalid.' } })
  const rows = await adminDb.select({
    id: monitoringEvents.id,
    eventId: monitoringEvents.eventId,
    eventType: monitoringEvents.eventType,
    category: monitoringEvents.category,
    severity: monitoringEvents.severity,
    occurredAt: monitoringEvents.occurredAt,
    sourceService: monitoringEvents.sourceService,
    instanceId: monitoringEvents.instanceId,
    requestId: monitoringEvents.requestId,
    correlationId: monitoringEvents.correlationId,
    relatedResourceId: monitoringEvents.relatedResourceId,
    metadata: monitoringEvents.metadata,
  }).from(monitoringEvents)
    .where(and(
      query.data.cursor ? lt(monitoringEvents.id, query.data.cursor) : undefined,
      query.data.category ? eq(monitoringEvents.category, query.data.category) : undefined,
    ))
    .orderBy(desc(monitoringEvents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

operationsRouter.get('/alerts', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const query = incidentListQuery.extend({ status: z.enum(['new', 'acknowledged', 'investigating', 'resolved', 'closed']).optional() }).strict().safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Alert pagination or status is invalid.' } })
  const rows = await adminDb.select({
    id: monitoringAlerts.id,
    severity: monitoringAlerts.severity,
    description: monitoringAlerts.description,
    affectedService: monitoringAlerts.affectedService,
    status: monitoringAlerts.status,
    firstOccurrence: monitoringAlerts.firstOccurrence,
    lastOccurrence: monitoringAlerts.lastOccurrence,
    occurrenceCount: monitoringAlerts.occurrenceCount,
    assignedOperationsUserId: monitoringAlerts.assignedOperationsUserId,
    resolutionInformation: monitoringAlerts.resolutionInformation,
    ruleId: monitoringDetectionRules.ruleId,
    ruleName: monitoringDetectionRules.name,
  }).from(monitoringAlerts).innerJoin(monitoringDetectionRules, eq(monitoringAlerts.detectionRuleId, monitoringDetectionRules.id))
    .where(and(
      query.data.cursor ? lt(monitoringAlerts.id, query.data.cursor) : undefined,
      query.data.status ? eq(monitoringAlerts.status, query.data.status) : undefined,
    )).orderBy(desc(monitoringAlerts.id)).limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

const updateAlertSchema = z.object({
  status: z.enum(['acknowledged', 'investigating', 'resolved', 'closed']).optional(),
  assignedOperationsUserId: z.number().int().positive().nullable().optional(),
  resolutionInformation: z.string().trim().max(4000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

operationsRouter.patch('/alerts/:id', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = updateAlertSchema.safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_ALERT_UPDATE', message: 'Alert update is invalid.' } })
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  if (input.data.assignedOperationsUserId !== undefined && input.data.assignedOperationsUserId !== null) {
    const [assignee] = await adminDb.select({ id: operationsUsers.id }).from(operationsUsers)
      .where(and(eq(operationsUsers.id, input.data.assignedOperationsUserId), isNull(operationsUsers.disabledAt))).limit(1)
    if (!assignee) return response.status(400).json({ error: { code: 'INVALID_ASSIGNEE', message: 'The assignee is not an authorized operations operator.' } })
  }
  const updated = await adminDb.transaction(async (transaction) => {
    const [alert] = await transaction.update(monitoringAlerts).set({ ...input.data, updatedAt: new Date() })
      .where(eq(monitoringAlerts.id, id.data)).returning({ id: monitoringAlerts.id, deduplicationKey: monitoringAlerts.deduplicationKey })
    if (!alert) return null
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: null,
      actorOperationsUserId: actor?.id ?? null,
      actorType: 'operations_user',
      action: 'monitoring_alert.updated',
      targetType: 'monitoring_alert',
      targetId: String(alert.id),
      details: JSON.stringify(Object.keys(input.data)),
    })
    return alert
  })
  if (!updated) return response.status(404).json({ error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found.' } })
  response.json({ data: { id: updated.id } })
})

operationsRouter.get('/metrics', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const parsed = monitoringRangeQuery.safeParse(request.query)
  if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Metric date range is invalid.' } })
  const end = parsed.data.end ?? new Date()
  const start = parsed.data.start ?? new Date(end.getTime() - 60 * 60_000)
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60_000) {
    return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Metric date range cannot exceed 31 days.' } })
  }
  const metrics = await persistentRequestMetrics(start, end)
  if (!metrics) return response.status(503).json({ error: { code: 'TELEMETRY_UNAVAILABLE', message: 'Persistent request telemetry is not available.' } })
  response.json({ data: { ...metrics, windowStartedAt: start.toISOString(), windowEndedAt: end.toISOString(), collectedAt: new Date().toISOString() } })
})

operationsRouter.get('/database-performance', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const parsed = monitoringRangeQuery.safeParse(request.query)
  if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Database metric date range is invalid.' } })
  const end = parsed.data.end ?? new Date()
  const start = parsed.data.start ?? new Date(end.getTime() - 60 * 60_000)
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60_000) {
    return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Database metric date range cannot exceed 31 days.' } })
  }
  const bucketExpressions = Array.from({ length: 12 }, (_, index) => sql`sum(split_part(${monitoringEvents.metadata}->>'latencyBucketCounts', ',', ${index + 1})::bigint)`)
  const mergedBuckets = sql<string>`array_to_string(ARRAY[${sql.join(bucketExpressions)}], ',')`
  const databaseSampleEnd = sql<Date>`(${monitoringEvents.metadata}->>'windowEndedAt')::timestamptz`
  try {
    const rows = await adminDb.select({
      metricType: sql<string>`(${monitoringEvents.metadata}->>'metricType')`,
      operation: sql<string>`(${monitoringEvents.metadata}->>'operation')`,
      sampleCount: sql<number>`sum((${monitoringEvents.metadata}->>'sampleCount')::bigint)`,
      successCount: sql<number>`sum((${monitoringEvents.metadata}->>'successCount')::bigint)`,
      failureCount: sql<number>`sum((${monitoringEvents.metadata}->>'failureCount')::bigint)`,
      slowCount: sql<number>`sum((${monitoringEvents.metadata}->>'slowCount')::bigint)`,
      durationTotalMs: sql<number>`sum((${monitoringEvents.metadata}->>'durationTotalMs')::double precision)`,
      minDurationMs: sql<number>`min((${monitoringEvents.metadata}->>'minDurationMs')::double precision)`,
      maxDurationMs: sql<number>`max((${monitoringEvents.metadata}->>'maxDurationMs')::double precision)`,
      latencyBucketCounts: mergedBuckets,
      instanceCount: sql<number>`count(distinct ${monitoringEvents.instanceId})`,
      windowStartedAt: sql<string>`min(${monitoringEvents.metadata}->>'windowStartedAt')`,
      windowEndedAt: sql<string>`max(${monitoringEvents.metadata}->>'windowEndedAt')`,
    }).from(monitoringEvents).where(and(
      eq(monitoringEvents.eventType, 'database.performance.aggregate'),
      gte(databaseSampleEnd, start),
      lte(databaseSampleEnd, end),
    )).groupBy(sql`(${monitoringEvents.metadata}->>'metricType')`, sql`(${monitoringEvents.metadata}->>'operation')`)
    const data = rows.map((row) => {
      const [summary] = summarizeDatabaseAggregates([{
        instanceId: 'merged',
        occurredAt: row.windowEndedAt,
        metadata: {
          metricType: row.metricType,
          operation: row.operation,
          sampleCount: Number(row.sampleCount),
          successCount: Number(row.successCount),
          failureCount: Number(row.failureCount),
          slowCount: Number(row.slowCount),
          durationTotalMs: Number(row.durationTotalMs),
          minDurationMs: Number(row.minDurationMs),
          maxDurationMs: Number(row.maxDurationMs),
          latencyBucketCounts: row.latencyBucketCounts,
          windowStartedAt: row.windowStartedAt,
          windowEndedAt: row.windowEndedAt,
        },
      }])
      return { ...summary, instanceCount: Number(row.instanceCount) }
    })
    response.json({ data: { windowStartedAt: start.toISOString(), windowEndedAt: end.toISOString(), collectedAt: new Date().toISOString(), metrics: data, telemetryAvailable: data.length > 0 } })
  } catch {
    response.status(503).json({ error: { code: 'DATABASE_METRICS_UNAVAILABLE', message: 'Persisted database performance metrics are not available.' } })
  }
})

operationsRouter.get('/database-performance/events', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const query = incidentListQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Database event pagination is invalid.' } })
  const rows = await adminDb.select({
    id: monitoringEvents.id,
    eventType: monitoringEvents.eventType,
    severity: monitoringEvents.severity,
    occurredAt: monitoringEvents.occurredAt,
    instanceId: monitoringEvents.instanceId,
    requestId: monitoringEvents.requestId,
    correlationId: monitoringEvents.correlationId,
    metadata: monitoringEvents.metadata,
  }).from(monitoringEvents).where(and(
    query.data.cursor ? lt(monitoringEvents.id, query.data.cursor) : undefined,
    inArray(monitoringEvents.eventType, ['database.query.slow', 'database.operation.failed']),
  )).orderBy(desc(monitoringEvents.id)).limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

operationsRouter.get('/runtime-performance', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const parsed = monitoringRangeQuery.safeParse(request.query)
  if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Runtime metric date range is invalid.' } })
  const end = parsed.data.end ?? new Date()
  const start = parsed.data.start ?? new Date(end.getTime() - 60 * 60_000)
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60_000) {
    return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Runtime metric date range cannot exceed 31 days.' } })
  }
  try {
    const [summary] = await adminDb.select({
      sampleCount: count(),
      instanceCount: sql<number>`count(distinct ${monitoringEvents.instanceId})`,
      processCpuAveragePercent: sql<number | null>`avg((${monitoringEvents.metadata}->>'processCpuPercentOfAvailableCapacity')::double precision)`,
      processCpuP95Percent: sql<number | null>`percentile_cont(0.95) within group (order by (${monitoringEvents.metadata}->>'processCpuPercentOfAvailableCapacity')::double precision)`,
      rssAverageBytes: sql<number | null>`avg((${monitoringEvents.metadata}->>'processRssBytes')::double precision)`,
      rssMaxBytes: sql<number | null>`max((${monitoringEvents.metadata}->>'processRssBytes')::bigint)`,
      heapAverageBytes: sql<number | null>`avg((${monitoringEvents.metadata}->>'processHeapUsedBytes')::double precision)`,
      heapMaxBytes: sql<number | null>`max((${monitoringEvents.metadata}->>'processHeapUsedBytes')::bigint)`,
      externalAverageBytes: sql<number | null>`avg((${monitoringEvents.metadata}->>'processExternalBytes')::double precision)`,
      runtimeAvailableMemoryBytes: sql<number | null>`min(nullif(${monitoringEvents.metadata}->>'runtimeAvailableMemoryBytes', 'null')::bigint)`,
      runtimeConstrainedMemoryBytes: sql<number | null>`max(nullif(${monitoringEvents.metadata}->>'runtimeConstrainedMemoryBytes', 'null')::bigint)`,
      eventLoopUtilizationAveragePercent: sql<number | null>`avg((${monitoringEvents.metadata}->>'eventLoopUtilizationPercent')::double precision)`,
      eventLoopP95DelaySampleMaxMs: sql<number | null>`max((${monitoringEvents.metadata}->>'eventLoopP95DelayMs')::double precision)`,
    }).from(monitoringEvents).where(and(
      eq(monitoringEvents.eventType, 'runtime.performance.sampled'),
      eq(sql<string>`${monitoringEvents.metadata}->>'sampleType'`, 'process_performance'),
      gte(monitoringEvents.occurredAt, start),
      lte(monitoringEvents.occurredAt, end),
    ))
    const samples = Number(summary.sampleCount)
    const round = (value: number | null, digits = 2) => value === null ? null : Number(Number(value).toFixed(digits))
    response.json({ data: {
      windowStartedAt: start.toISOString(),
      windowEndedAt: end.toISOString(),
      collectedAt: new Date().toISOString(),
      telemetryAvailable: samples > 0,
      sampleCount: samples,
      instanceCount: Number(summary.instanceCount),
      processCpuAveragePercent: round(summary.processCpuAveragePercent),
      processCpuP95Percent: round(summary.processCpuP95Percent),
      processRssAverageBytes: round(summary.rssAverageBytes, 0),
      processRssMaxBytes: summary.rssMaxBytes === null ? null : Number(summary.rssMaxBytes),
      processHeapAverageBytes: round(summary.heapAverageBytes, 0),
      processHeapMaxBytes: summary.heapMaxBytes === null ? null : Number(summary.heapMaxBytes),
      processExternalAverageBytes: round(summary.externalAverageBytes, 0),
      runtimeAvailableMemoryBytes: summary.runtimeAvailableMemoryBytes === null ? null : Number(summary.runtimeAvailableMemoryBytes),
      runtimeConstrainedMemoryBytes: summary.runtimeConstrainedMemoryBytes === null ? null : Number(summary.runtimeConstrainedMemoryBytes),
      eventLoopUtilizationAveragePercent: round(summary.eventLoopUtilizationAveragePercent),
      eventLoopP95DelaySampleMaxMs: round(summary.eventLoopP95DelaySampleMaxMs),
      hostCpuUtilizationPercent: null,
      hostMemoryBytes: null,
      hostMetricsStatus: 'unavailable_without_host_or_provider_telemetry',
      eventLoopDelayDescription: 'Maximum of per-sample event-loop P95 delay values; not a merged global P95.',
    } })
  } catch {
    response.status(503).json({ error: { code: 'RUNTIME_METRICS_UNAVAILABLE', message: 'Persisted runtime performance metrics are not available.' } })
  }
})

operationsRouter.get('/provider-performance', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const parsed = monitoringRangeQuery.safeParse(request.query)
  if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Provider metric date range is invalid.' } })
  const end = parsed.data.end ?? new Date()
  const start = parsed.data.start ?? new Date(end.getTime() - 24 * 60 * 60_000)
  if (end.getTime() - start.getTime() > 31 * 24 * 60 * 60_000) {
    return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Provider metric date range cannot exceed 31 days.' } })
  }
  try {
    const rows = await adminDb.select({
      provider: sql<string>`(${monitoringEvents.metadata}->>'provider')`,
      operation: sql<string>`(${monitoringEvents.metadata}->>'operation')`,
      requestCount: count(),
      rejectedCount: sql<number>`count(*) filter (where (${monitoringEvents.metadata}->>'outcome') IN ('rejected', 'network_error', 'timeout'))`,
      acceptedByProviderCount: sql<number>`count(*) filter (where (${monitoringEvents.metadata}->>'outcome') = 'accepted_by_provider')`,
      averageDurationMs: sql<number>`avg((${monitoringEvents.metadata}->>'durationMs')::double precision)`,
      p95DurationMs: sql<number | null>`percentile_cont(0.95) within group (order by (${monitoringEvents.metadata}->>'durationMs')::double precision)`,
      p99DurationMs: sql<number | null>`percentile_cont(0.99) within group (order by (${monitoringEvents.metadata}->>'durationMs')::double precision)`,
      lastAttemptAt: sql<Date>`max(${monitoringEvents.occurredAt})`,
    }).from(monitoringEvents).where(and(
      eq(monitoringEvents.eventType, 'provider.request.completed'),
      gte(monitoringEvents.occurredAt, start),
      lte(monitoringEvents.occurredAt, end),
    )).groupBy(sql`(${monitoringEvents.metadata}->>'provider')`, sql`(${monitoringEvents.metadata}->>'operation')`)
    const measuredProviders = new Set(rows.map(({ provider }) => provider))
    const configuredProviders = [
      { provider: 'daraja', health: 'unknown', reason: 'Only application-issued requests are measured; no non-transaction health probe is configured.' },
      { provider: 'cloudinary', health: 'unknown', reason: 'Only application-issued upload/delete requests are measured; no non-mutating health probe is configured.' },
      { provider: 'resend', health: 'unknown', reason: 'Submission acceptance is measured; delivery/bounce status requires provider webhook data.' },
      { provider: 'render', health: 'unknown', reason: 'No authorized Render metrics API integration is configured.' },
      { provider: 'cloudflare', health: 'unknown', reason: 'No authorized Cloudflare metrics API integration is configured.' },
    ]
    response.json({ data: {
      windowStartedAt: start.toISOString(),
      windowEndedAt: end.toISOString(),
      collectedAt: new Date().toISOString(),
      metrics: rows.map((row) => ({
        provider: row.provider,
        operation: row.operation,
        requestCount: Number(row.requestCount),
        rejectedCount: Number(row.rejectedCount),
        acceptedByProviderCount: Number(row.acceptedByProviderCount),
        averageDurationMs: Number(Number(row.averageDurationMs).toFixed(2)),
        p95DurationMs: row.p95DurationMs === null ? null : Number(Number(row.p95DurationMs).toFixed(2)),
        p99DurationMs: row.p99DurationMs === null ? null : Number(Number(row.p99DurationMs).toFixed(2)),
        lastAttemptAt: row.lastAttemptAt,
      })),
      integrations: configuredProviders.map((integration) => ({
        ...integration,
        state: measuredProviders.has(integration.provider) ? 'measured_requests_only' : 'unknown',
      })),
    } })
  } catch {
    response.status(503).json({ error: { code: 'PROVIDER_METRICS_UNAVAILABLE', message: 'Persisted provider performance metrics are not available.' } })
  }
})

async function persistentRequestMetrics(start: Date, end: Date) {
  if (!adminDb) return null
  try {
    const bucketCount = 12
    const bucketDurationMs = (end.getTime() - start.getTime()) / bucketCount
    const bucketSeconds = bucketDurationMs / 1000
    const requestConditions = and(
      eq(monitoringEvents.eventType, 'http.request.completed'),
      gte(monitoringEvents.occurredAt, start),
      lte(monitoringEvents.occurredAt, end),
    )
    const status = sql<number>`(${monitoringEvents.metadata}->>'status')::integer`
    const duration = sql<number>`(${monitoringEvents.metadata}->>'durationMs')::double precision`
    const [[aggregate], endpointRows, methodRows, distribution, bucketRows] = await Promise.all([
      adminDb.select({
        requestCount: count(),
        requestsLastMinute: sql<number>`count(*) filter (where ${monitoringEvents.occurredAt} >= ${new Date(end.getTime() - 60_000)})`,
        errorCount: sql<number>`count(*) filter (where ${status} >= 400)`,
        serverErrorCount: sql<number>`count(*) filter (where ${status} >= 500)`,
        clientErrorCount: sql<number>`count(*) filter (where ${status} between 400 and 499)`,
        successfulRequestCount: sql<number>`count(*) filter (where ${status} < 400)`,
        securitySignalCount: sql<number>`count(*) filter (where ${status} in (401, 403, 429))`,
        securitySignalsLastMinute: sql<number>`count(*) filter (where ${status} in (401, 403, 429) and ${monitoringEvents.occurredAt} >= ${new Date(end.getTime() - 60_000)})`,
        averageResponseMs: sql<number | null>`avg(${duration})`,
        minResponseMs: sql<number | null>`min(${duration})`,
        maxResponseMs: sql<number | null>`max(${duration})`,
        p50ResponseMs: sql<number | null>`percentile_cont(0.50) within group (order by ${duration})`,
        p95ResponseMs: sql<number | null>`percentile_cont(0.95) within group (order by ${duration})`,
        p99ResponseMs: sql<number | null>`percentile_cont(0.99) within group (order by ${duration})`,
      }).from(monitoringEvents).where(requestConditions),
      adminDb.select({
        method: sql<string>`(${monitoringEvents.metadata}->>'method')`,
        endpoint: sql<string>`(${monitoringEvents.metadata}->>'route')`,
        requests: count(),
        errors: sql<number>`count(*) filter (where ${status} >= 400)`,
        averageResponseMs: sql<number>`avg(${duration})`,
      }).from(monitoringEvents).where(requestConditions)
        .groupBy(sql`(${monitoringEvents.metadata}->>'method')`, sql`(${monitoringEvents.metadata}->>'route')`)
        .orderBy(desc(count())).limit(50),
      adminDb.select({ method: sql<string>`(${monitoringEvents.metadata}->>'method')`, requests: count() })
        .from(monitoringEvents).where(requestConditions).groupBy(sql`(${monitoringEvents.metadata}->>'method')`).orderBy(desc(count())),
      adminDb.select({
        success: sql<number>`count(*) filter (where ${status} < 300)`,
        redirect: sql<number>`count(*) filter (where ${status} between 300 and 399)`,
        clientError: sql<number>`count(*) filter (where ${status} between 400 and 499)`,
        serverError: sql<number>`count(*) filter (where ${status} >= 500)`,
      }).from(monitoringEvents).where(requestConditions),
      adminDb.select({
        bucketIndex: sql<number>`floor(extract(epoch from (${monitoringEvents.occurredAt} - ${start})) / ${bucketSeconds})::integer`,
        requestCount: count(),
        errorCount: sql<number>`count(*) filter (where ${status} >= 400)`,
        serverErrorCount: sql<number>`count(*) filter (where ${status} >= 500)`,
        securitySignalCount: sql<number>`count(*) filter (where ${status} in (401, 403, 429))`,
        averageResponseMs: sql<number | null>`avg(${duration})`,
        p95ResponseMs: sql<number | null>`percentile_cont(0.95) within group (order by ${duration})`,
      }).from(monitoringEvents).where(requestConditions)
        .groupBy(sql`floor(extract(epoch from (${monitoringEvents.occurredAt} - ${start})) / ${bucketSeconds})::integer`),
    ])
    const bucketMap = new Map(bucketRows.map((row) => [Number(row.bucketIndex), row]))
    const timeline = Array.from({ length: bucketCount }, (_, index) => {
      const row = bucketMap.get(index)
      return {
        bucketStartedAt: new Date(start.getTime() + index * bucketDurationMs).toISOString(),
        requestCount: Number(row?.requestCount ?? 0),
        errorCount: Number(row?.errorCount ?? 0),
        serverErrorCount: Number(row?.serverErrorCount ?? 0),
        securitySignalCount: Number(row?.securitySignalCount ?? 0),
        averageResponseMs: row?.averageResponseMs === null || row?.averageResponseMs === undefined ? null : Number(Number(row.averageResponseMs).toFixed(1)),
        p95ResponseMs: row?.p95ResponseMs === null || row?.p95ResponseMs === undefined ? null : Number(Number(row.p95ResponseMs).toFixed(1)),
      }
    })
    const distributionCounts = distribution[0]
    return {
      requestCount: Number(aggregate.requestCount),
      requestsLastMinute: Number(aggregate.requestsLastMinute),
      errorCount: Number(aggregate.errorCount),
      serverErrorCount: Number(aggregate.serverErrorCount),
      clientErrorCount: Number(aggregate.clientErrorCount),
      successfulRequestCount: Number(aggregate.successfulRequestCount),
      securitySignalCount: Number(aggregate.securitySignalCount),
      securitySignalsLastMinute: Number(aggregate.securitySignalsLastMinute),
      requestRatePerSecond: Number((Number(aggregate.requestCount) / Math.max(1, (end.getTime() - start.getTime()) / 1000)).toFixed(2)),
      averageResponseMs: aggregate.averageResponseMs === null ? null : Number(Number(aggregate.averageResponseMs).toFixed(1)),
      minResponseMs: aggregate.minResponseMs === null ? null : Number(Number(aggregate.minResponseMs).toFixed(1)),
      maxResponseMs: aggregate.maxResponseMs === null ? null : Number(Number(aggregate.maxResponseMs).toFixed(1)),
      p50ResponseMs: aggregate.p50ResponseMs === null ? null : Number(Number(aggregate.p50ResponseMs).toFixed(1)),
      p95ResponseMs: aggregate.p95ResponseMs === null ? null : Number(Number(aggregate.p95ResponseMs).toFixed(1)),
      p99ResponseMs: aggregate.p99ResponseMs === null ? null : Number(Number(aggregate.p99ResponseMs).toFixed(1)),
      endpoints: endpointRows.map((row) => ({ method: row.method, endpoint: row.endpoint, requests: Number(row.requests), errors: Number(row.errors), averageResponseMs: Number(Number(row.averageResponseMs).toFixed(1)) })),
      methods: methodRows.map((row) => ({ method: row.method, requests: Number(row.requests) })),
      responseDistribution: {
        success: Number(distributionCounts.success),
        redirect: Number(distributionCounts.redirect),
        clientError: Number(distributionCounts.clientError),
        serverError: Number(distributionCounts.serverError),
      },
      timeline,
      telemetryFreshness: getTelemetryQueueState().freshness,
    }
  } catch {
    return null
  }
}

operationsRouter.get('/overview', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const metricEnd = new Date()
  const metricStart = new Date(metricEnd.getTime() - 60 * 60_000)
  const [storeDatabase, adminDatabase, [openIncidentCount], [investigatingIncidentCount], requestMetrics] = await Promise.all([
    probeDatabase(pool, 'store'),
    adminPool === pool ? Promise.resolve({ name: 'admin', status: 'healthy' as const, latencyMs: null }) : probeDatabase(adminPool, 'admin'),
    adminDb.select({ total: count() }).from(operationsIncidents).where(eq(operationsIncidents.status, 'open')),
    adminDb.select({ total: count() }).from(operationsIncidents).where(eq(operationsIncidents.status, 'investigating')),
    persistentRequestMetrics(metricStart, metricEnd),
  ])
  const memory = process.memoryUsage()
  response.json({ data: {
    application: {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryRssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    databases: [storeDatabase, adminDatabase],
    databasePool: pool ? {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
      maxConnections: pool.options.max ?? null,
    } : null,
    requests: requestMetrics ? {
      ...requestMetrics,
      windowStartedAt: metricStart.toISOString(),
      collectedAt: metricEnd.toISOString(),
      telemetryFreshness: getTelemetryQueueState().freshness,
    } : {
      ...getRequestMetrics(),
      telemetryFreshness: 'process_local_fallback',
      reason: 'Persistent request telemetry is unavailable; these values are process-local only.',
    },
    incidents: { open: Number(openIncidentCount.total), investigating: Number(investigatingIncidentCount.total) },
    externalServices: {
      render: { status: 'unknown', reason: 'Provider API credentials are not configured.' },
      railwayBackups: { status: 'unknown', reason: 'No backup verification feed is configured.' },
      cloudflare: { status: 'unknown', reason: 'No authorized Cloudflare account integration is configured.' },
      daraja: { status: 'unknown', reason: 'No safe provider health check is configured; no payment request was sent.' },
      emailDelivery: { status: 'unknown', reason: 'Email provider delivery health is not exposed as a live check.' },
    },
  } })
})

const incidentListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().positive().optional(),
})

operationsRouter.get('/incidents', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const query = incidentListQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Incident pagination is invalid.' } })
  const rows = await adminDb.select({
    id: operationsIncidents.id,
    incidentNumber: operationsIncidents.incidentNumber,
    severity: operationsIncidents.severity,
    status: operationsIncidents.status,
    title: operationsIncidents.title,
    description: operationsIncidents.description,
    affectedComponent: operationsIncidents.affectedComponent,
    assignedOperationsUserId: operationsIncidents.assignedOperationsUserId,
    assigneeName: sql<string | null>`COALESCE(${operationsUsers.fullName}, ${adminUsers.fullName})`,
    rootCause: operationsIncidents.rootCause,
    resolutionNotes: operationsIncidents.resolutionNotes,
    detectedAt: operationsIncidents.detectedAt,
    resolvedAt: operationsIncidents.resolvedAt,
    createdAt: operationsIncidents.createdAt,
    updatedAt: operationsIncidents.updatedAt,
  }).from(operationsIncidents)
    .leftJoin(operationsUsers, eq(operationsIncidents.assignedOperationsUserId, operationsUsers.id))
    .leftJoin(adminUsers, eq(operationsIncidents.assignedAdminUserId, adminUsers.id))
    .where(query.data.cursor ? lt(operationsIncidents.id, query.data.cursor) : undefined)
    .orderBy(desc(operationsIncidents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

const createIncidentSchema = z.object({
  severity: z.enum(['P1', 'P2', 'P3', 'P4']),
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().min(10).max(4000),
  affectedComponent: z.enum(['website', 'api', 'database', 'payments', 'email', 'security', 'other']),
}).strict()

operationsRouter.post('/incidents', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  const input = createIncidentSchema.safeParse(request.body)
  if (!actor) return response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT', message: 'Incident details are invalid.' } })
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const incidentNumber = `OPS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`
  const now = new Date()
  const incidentId = await adminDb.transaction(async (transaction) => {
    const [{ id }] = await transaction.insert(operationsIncidents).values({
      incidentNumber,
      severity: input.data.severity,
      status: 'open',
      title: input.data.title,
      description: input.data.description,
      affectedComponent: input.data.affectedComponent,
      createdByOperationsUserId: actor.id,
      detectedAt: now,
    }).returning({ id: operationsIncidents.id })
    await transaction.insert(operationsIncidentEvents).values({
      incidentId: id,
      actorAdminUserId: null,
      actorOperationsUserId: actor.id,
      eventType: 'created',
      message: `Incident opened: ${input.data.title}`,
    })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: null,
      actorOperationsUserId: actor.id,
      actorType: 'operations_user',
      action: 'incident.created',
      targetType: 'incident',
      targetId: incidentNumber,
      details: JSON.stringify({ severity: input.data.severity, affectedComponent: input.data.affectedComponent }),
    })
    return id
  })
  response.status(201).json({ data: { id: incidentId, incidentNumber } })
})

operationsRouter.get('/incidents/:id/events', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_ID', message: 'Incident ID is invalid.' } })
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const rows = await adminDb.select({
    id: operationsIncidentEvents.id,
    eventType: operationsIncidentEvents.eventType,
    message: operationsIncidentEvents.message,
    createdAt: operationsIncidentEvents.createdAt,
    actorName: sql<string | null>`COALESCE(${operationsUsers.fullName}, ${adminUsers.fullName})`,
  }).from(operationsIncidentEvents)
    .leftJoin(operationsUsers, eq(operationsIncidentEvents.actorOperationsUserId, operationsUsers.id))
    .leftJoin(adminUsers, eq(operationsIncidentEvents.actorAdminUserId, adminUsers.id))
    .where(eq(operationsIncidentEvents.incidentId, id.data))
    .orderBy(desc(operationsIncidentEvents.createdAt))
    .limit(100)
  response.json({ data: rows.reverse() })
})

const patchIncidentSchema = z.object({
  severity: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
  assignedOperationsUserId: z.number().int().positive().nullable().optional(),
  rootCause: z.string().trim().max(4000).nullable().optional(),
  resolutionNotes: z.string().trim().max(4000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

operationsRouter.patch('/incidents/:id', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = patchIncidentSchema.safeParse(request.body)
  if (!actor) return response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_UPDATE', message: 'Incident update is invalid.' } })
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  if (input.data.assignedOperationsUserId) {
    const [assignee] = await adminDb.select({ id: operationsUsers.id }).from(operationsUsers)
      .where(and(eq(operationsUsers.id, input.data.assignedOperationsUserId), isNull(operationsUsers.disabledAt))).limit(1)
    if (!assignee) return response.status(400).json({ error: { code: 'INVALID_ASSIGNEE', message: 'The assignee is not an authorized operations operator.' } })
  }
  const result = await adminDb.transaction(async (transaction) => {
    const [existing] = await transaction.select({ id: operationsIncidents.id, incidentNumber: operationsIncidents.incidentNumber })
      .from(operationsIncidents).where(eq(operationsIncidents.id, id.data)).limit(1)
    if (!existing) return null
    const changes = input.data
    const patch = {
      ...changes,
      ...(changes.status ? { resolvedAt: ['resolved', 'closed'].includes(changes.status) ? new Date() : null } : {}),
    }
    await transaction.update(operationsIncidents).set(patch).where(eq(operationsIncidents.id, id.data))
    const details = Object.entries(changes).map(([field, value]) => `${field} changed to ${value ?? 'unassigned'}`).join('; ')
    await transaction.insert(operationsIncidentEvents).values({ incidentId: id.data, actorAdminUserId: null, actorOperationsUserId: actor.id, eventType: 'updated', message: details })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: null,
      actorOperationsUserId: actor.id,
      actorType: 'operations_user',
      action: 'incident.updated',
      targetType: 'incident',
      targetId: existing.incidentNumber,
      details: JSON.stringify(Object.keys(changes)),
    })
    return existing.incidentNumber
  })
  if (!result) return response.status(404).json({ error: { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found.' } })
  response.json({ data: { id: id.data, incidentNumber: result } })
})

const noteSchema = z.object({ message: z.string().trim().min(1).max(4000) }).strict()

operationsRouter.post('/incidents/:id/events', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = noteSchema.safeParse(request.body)
  if (!actor) return response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_NOTE', message: 'Incident note is invalid.' } })
  if (!adminDb) return operationsUnavailable(response)
  const [incident] = await adminDb.select({ incidentNumber: operationsIncidents.incidentNumber })
    .from(operationsIncidents).where(eq(operationsIncidents.id, id.data)).limit(1)
  if (!incident) return response.status(404).json({ error: { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found.' } })
  await adminDb.transaction(async (transaction) => {
    await transaction.insert(operationsIncidentEvents).values({ incidentId: id.data, actorAdminUserId: null, actorOperationsUserId: actor.id, eventType: 'note', message: input.data.message })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: null,
      actorOperationsUserId: actor.id,
      actorType: 'operations_user',
      action: 'incident.note_added',
      targetType: 'incident',
      targetId: incident.incidentNumber,
    })
  })
  response.status(201).json({ data: { id: id.data } })
})

operationsRouter.get('/audit', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response)
  const query = incidentListQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Audit pagination is invalid.' } })
  const rows = await adminDb.select({
    id: operationsAuditEvents.id,
    actorAdminUserId: operationsAuditEvents.actorAdminUserId,
    actorOperationsUserId: operationsAuditEvents.actorOperationsUserId,
    actorType: operationsAuditEvents.actorType,
    actorName: sql<string | null>`COALESCE(${operationsUsers.fullName}, ${adminUsers.fullName})`,
    action: operationsAuditEvents.action,
    targetType: operationsAuditEvents.targetType,
    targetId: operationsAuditEvents.targetId,
    details: operationsAuditEvents.details,
    createdAt: operationsAuditEvents.createdAt,
  }).from(operationsAuditEvents)
    .leftJoin(operationsUsers, eq(operationsAuditEvents.actorOperationsUserId, operationsUsers.id))
    .leftJoin(adminUsers, eq(operationsAuditEvents.actorAdminUserId, adminUsers.id))
    .where(query.data.cursor ? lt(operationsAuditEvents.id, query.data.cursor) : undefined)
    .orderBy(desc(operationsAuditEvents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

const securityScanScopeSchema = z.object({
  scope: z.array(z.enum(['dependency', 'secrets', 'source', 'api', 'database', 'configuration', 'infrastructure', 'web'])).max(8).optional(),
  timeoutSeconds: z.number().int().min(30).max(900).optional(),
}).strict()

const findingLifecycleSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'ACCEPTED_RISK', 'FALSE_POSITIVE']),
  note: z.string().max(2000).trim().optional(),
  verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED_FIXED', 'VERIFIED_NOT_FIXED']).optional(),
}).strict()

async function requireSecurityAction(request: Request, response: Response) {
  const actor = authenticatedOperationsUser(request)
  if (!actor || !adminDb) return false
  const [operator] = await adminDb.select({ role: operationsUsers.role }).from(operationsUsers).where(eq(operationsUsers.id, actor.id)).limit(1)
  if (!operator || !['super_admin', 'security_analyst'].includes(operator.role)) {
    response.status(403).json({ error: { code: 'SECURITY_PERMISSION_REQUIRED', message: 'A security administrator role is required.' } })
    return false
  }
  return actor
}

operationsRouter.get('/security/overview', (_request, response) => {
  response.json({ data: getSecurityOverview() })
})

operationsRouter.get('/security/scanners', (_request, response) => {
  response.json({ data: [
    { scanner: 'npm-audit', status: 'healthy', coverage: 'dependency', source: 'local fixed-command' },
    { scanner: 'semgrep', status: 'not_configured', coverage: 'source', source: 'not installed' },
    { scanner: 'gitleaks', status: 'not_configured', coverage: 'secrets', source: 'not installed' },
    { scanner: 'database-readonly', status: 'not_configured', coverage: 'database', source: 'credentials not configured for assessment' },
    { scanner: 'trivy', status: 'not_configured', coverage: 'infrastructure', source: 'not installed' },
    { scanner: 'zap', status: 'not_configured', coverage: 'web', source: 'not installed' },
  ] })
})

operationsRouter.get('/security/scans', (_request, response) => {
  response.json({ data: listSecurityScans() })
})

operationsRouter.post('/security/scans', async (request, response) => {
  const actor = await requireSecurityAction(request, response)
  if (!actor) return
  const input = securityScanScopeSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_SECURITY_SCAN', message: 'The security scan scope or timeout is invalid.' } })
  try {
    const scan = await startSecurityScan((input.data.scope ?? ['dependency']) as ScannerModule[], process.cwd(), (input.data.timeoutSeconds ?? 120) * 1000)
    await adminDb!.insert(operationsAuditEvents).values({
      actorOperationsUserId: actor.id,
      actorType: 'operations_user',
      action: 'security.scan.started',
      targetType: 'security_scan',
      targetId: scan.id,
      details: JSON.stringify({ scope: scan.scope }),
    })
    response.status(202).json({ data: scan })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as Error & { code?: string }).code) : 'SECURITY_SCAN_FAILED'
    response.status(code === 'SECURITY_SCAN_CONFLICT' ? 409 : 500).json({ error: { code, message: 'The security scan could not be started.' } })
  }
})

operationsRouter.get('/security/scans/:id', (request, response) => {
  const scan = getSecurityScan(request.params.id)
  if (!scan) return response.status(404).json({ error: { code: 'SECURITY_SCAN_NOT_FOUND', message: 'The security scan was not found.' } })
  response.json({ data: scan })
})

operationsRouter.post('/security/scans/:id/cancel', async (request, response) => {
  const actor = await requireSecurityAction(request, response)
  if (!actor) return
  const scan = getSecurityScan(request.params.id)
  if (!scan) return response.status(404).json({ error: { code: 'SECURITY_SCAN_NOT_FOUND', message: 'The security scan was not found.' } })
  if (!cancelSecurityScan(scan.id)) return response.status(409).json({ error: { code: 'SECURITY_SCAN_NOT_RUNNING', message: 'The security scan is not running.' } })
  await adminDb!.insert(operationsAuditEvents).values({
    actorOperationsUserId: actor.id,
    actorType: 'operations_user',
    action: 'security.scan.cancelled',
    targetType: 'security_scan',
    targetId: scan.id,
  })
  response.status(204).end()
})

operationsRouter.get('/security/findings', (request, response) => {
  const severity = typeof request.query.severity === 'string' ? request.query.severity.toUpperCase() : null
  const query = typeof request.query.search === 'string' ? request.query.search.trim().toLowerCase() : ''
  const findings = listSecurityFindings().filter((finding) => (!severity || finding.severity === severity) && (!query || `${finding.title} ${finding.affectedComponent}`.toLowerCase().includes(query)))
  response.json({ data: findings })
})

operationsRouter.patch('/security/findings/:id/status', async (request, response) => {
  const actor = await requireSecurityAction(request, response)
  if (!actor) return
  const input = findingLifecycleSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_FINDING_STATUS', message: 'The finding lifecycle update is invalid.' } })
  const finding = listSecurityFindings().find((item) => item.id === request.params.id)
  if (!finding) return response.status(404).json({ error: { code: 'SECURITY_FINDING_NOT_FOUND', message: 'The finding was not found.' } })
  await adminDb!.insert(operationsAuditEvents).values({
    actorOperationsUserId: actor.id,
    actorType: 'operations_user',
    action: 'security.finding.status_changed',
    targetType: 'security_finding',
    targetId: finding.id,
    details: JSON.stringify({ status: input.data.status, verificationStatus: input.data.verificationStatus ?? 'UNVERIFIED', note: input.data.note ?? null }),
  })
  const updated = updateSecurityFinding(finding.id, input.data.status, input.data.verificationStatus ?? 'UNVERIFIED')
  response.json({ data: updated })
})

operationsRouter.get('/security/reports', (_request, response) => {
  response.json({ data: { generatedAt: new Date().toISOString(), overview: getSecurityOverview(), findings: listSecurityFindings(), limitations: [
    'Unconfigured scanner modules are not counted as successful coverage.',
    'Production infrastructure and external-provider configuration require provider-side verification.',
  ] } })
})

operationsRouter.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  const failure = classifyOperationsDatabaseFailure(error)
  if (!failure) {
    next(error)
    return
  }
  request.log.error({
    requestId: String(request.id),
    operation: `operations.${request.method.toLowerCase()}`,
    category: failure.diagnostics.category,
    errors: failure.diagnostics.errors,
  }, 'Operations database operation failed')
  response.status(failure.status).json({ error: {
    code: failure.code,
    message: failure.message,
    requestId: String(request.id),
  } })
})