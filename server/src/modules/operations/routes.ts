import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { and, asc, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { Router, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { adminDb, adminPool, pool } from '../../config/database.js'
import { inspectDatabaseError } from '../../config/database-diagnostics.js'
import { isAllowedClientOrigin } from '../../config/env.js'
import { bcryptPasswordSchema } from '../../config/password-policy.js'
import { nextSessionExpiry, operationsSessionAbsoluteLifetimeMs, operationsSessionIdleTimeoutMs } from '../../config/session-policy.js'
import { adminUsers, operationsAuditEvents, operationsIncidentEvents, operationsIncidents, operationsSessions, operationsUsers } from '../../database/admin-schema.js'
import { getRequestMetrics } from '../../middleware/request-metrics.js'

export const operationsRouter = Router()
const operationsCookieName = 'kc_ops_session'
const operationsLoginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const operationsSignupLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })
const dummyPasswordHash = '$2b$12$dMQb0c5TSqrGqBnLsWHg7OY1lpzjgTO9NlpziFmTtctDZ1deHspxi'

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

const authenticateOperations = async (request: Request, response: Response, next: (error?: unknown) => void) => {
  const token = operationsCookieToken(request)
  if (!token) {
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'OPERATIONS_UNAVAILABLE', message: 'Operations authentication is unavailable.' } })
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
    if (inspectDatabaseError(error).category === 'missing_table') {
      operationsUnavailable(response)
      return
    }
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

operationsRouter.get('/registration-status', async (_request, response) => {
  if (!env.OPERATIONS_SIGNUP_SECRET) {
    response.json({ data: { available: false } })
    return
  }
  if (!adminDb) return operationsUnavailable(response)
  try {
    await adminDb.select({ id: operationsUsers.id }).from(operationsUsers).limit(1)
  } catch (error) {
    if (inspectDatabaseError(error).category === 'missing_table') return operationsUnavailable(response)
    throw error
  }
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
  if (!adminDb) return operationsUnavailable(response)

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
    }).$returningId()
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
  const passwordMatches = await compare(input.data.password, user?.passwordHash ?? dummyPasswordHash)
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
  const [updated] = await adminDb.update(operationsSessions).set({ expiresAt: expiry })
    .where(and(eq(operationsSessions.id, session.id), gt(operationsSessions.expiresAt, now)))
  if (updated.affectedRows !== 1) {
    clearOperationsCookie(response)
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
    return
  }
  setOperationsCookie(response, token, expiry.getTime() - now.getTime())
  response.status(204).end()
})
operationsRouter.use(authenticateOperations)

function operationsUnavailable(response: import('express').Response) {
  return response.status(503).json({ error: { code: 'OPERATIONS_UNAVAILABLE', message: 'Operations data is unavailable until its database migration has been applied.' } })
}

async function probeDatabase(database: typeof pool, name: string) {
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

operationsRouter.get('/operators', async (_request, response) => {
  if (!adminDb) return operationsUnavailable(response)
  const operators = await adminDb.select({ id: operationsUsers.id, fullName: operationsUsers.fullName })
    .from(operationsUsers)
    .where(isNull(operationsUsers.disabledAt))
    .orderBy(asc(operationsUsers.fullName))
  response.json({ data: operators })
})

operationsRouter.get('/overview', async (_request, response) => {
  if (!adminDb) return operationsUnavailable(response)
  const [storeDatabase, adminDatabase, [openIncidentCount], [investigatingIncidentCount]] = await Promise.all([
    probeDatabase(pool, 'store'),
    adminPool === pool ? Promise.resolve({ name: 'admin', status: 'healthy' as const, latencyMs: null }) : probeDatabase(adminPool, 'admin'),
    adminDb.select({ total: count() }).from(operationsIncidents).where(eq(operationsIncidents.status, 'open')),
    adminDb.select({ total: count() }).from(operationsIncidents).where(eq(operationsIncidents.status, 'investigating')),
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
    requests: getRequestMetrics(),
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
  if (!adminDb) return operationsUnavailable(response)
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
  if (!adminDb) return operationsUnavailable(response)
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
    }).$returningId()
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
  if (!adminDb) return operationsUnavailable(response)
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
  if (!adminDb) return operationsUnavailable(response)
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