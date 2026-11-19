import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { createAccountRateLimiter } from '../../security/distributed-rate-limit.js'
import { adminDb, adminPool, db, pool } from '../../config/database.js'
import { inspectDatabaseError } from '../../config/database-diagnostics.js'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { verifyPassword } from '../../config/password-policy.js'
import { nextSessionExpiry, operationsSessionAbsoluteLifetimeMs, operationsSessionIdleTimeoutMs } from '../../config/session-policy.js'
import { adminSessions, adminUsers, monitoringAlerts, monitoringDetectionRules, monitoringEvents, monitoringWorkerState, operationsAuditEvents, operationsIncidentEvents, operationsIncidents, operationsSessions, operationsUsers, securityScanSchedules } from '../../database/admin-schema.js'
import { getTelemetryQueueState } from './telemetry-store.js'
import { getWafStatus } from '../../security/waf.js'
import { addIpPolicy, listIpPolicies, removeIpPolicy, updateIpPolicy } from '../../security/ip-policy.js'
import { securityNotificationStatus } from '../security/security-notifications.js'
import { generateCycloneDxSbom } from '../security/sbom.js'
import { cancelSecurityScan, dependencyScannerAvailability, getSecurityOverview, getSecurityScan, listSecurityFindings, listSecurityScans, startSecurityScan, updateSecurityFinding, type ScannerModule } from '../security/scanner-engine.js'
import { getRequestMetrics } from '../../middleware/request-metrics.js'
import { getRateLimitStoreStatus } from '../../security/distributed-rate-limit.js'
import { loadPersistedSecurityScans, persistSecurityScan } from '../security/scanner-persistence.js'
import { dependencyScanScheduleId, nextDailyRunAt } from '../security/scheduled-scanner.js'
import { summarizeDatabaseAggregates } from './database-performance.js'
import { canUseOperationsIdentityBridge, hasItPermission, hasOperationsRoutePermission, itPermissions, operationsRoleForIdentityBridge, type ItPermission } from '../admin/it-access.js'
import { itAccessRoles, type ItAccessRole } from '../../database/admin-schema.js'
import { orders, payments } from '../../database/schema.js'

export const operationsRouter = Router()
const operationsCookieName = 'kc_ops_session'
const operationsLoginLimiter = createAccountRateLimiter('operations.login.account', { windowMs: 15 * 60_000, limit: 8 }, (request) => request.body?.email)

type OperationsUser = { id: number; email: string; fullName: string; role: ItAccessRole; adminUserId?: number; adminSessionId?: number }
type OperationsRequest = Request & { operationsUser?: OperationsUser }

function hashOperationsToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function probeMarketHub() {
  const checkedAt = new Date().toISOString()
  if (!env.MARKETHUB_PUBLIC_URL) return { status: 'unknown', checkedAt, reason: 'MARKETHUB_PUBLIC_URL is not configured.' }
  const startedAt = performance.now()
  try {
    const healthUrl = new URL(env.MARKETHUB_PUBLIC_URL)
    const [readyResponse, workersResponse] = await Promise.all([
      fetch(new URL('/health/ready', healthUrl), { signal: AbortSignal.timeout(3000) }),
      fetch(new URL('/health/workers', healthUrl), { signal: AbortSignal.timeout(3000) }),
    ])
    const [ready, workerHealth] = await Promise.all([
      readyResponse.json().catch(() => null) as Promise<{ status?: string; database?: string } | null>,
      workersResponse.json().catch(() => null) as Promise<{ workers?: Record<string, { enabled?: boolean; consecutiveFailures?: number }> } | null>,
    ])
    const failedWorkers = Object.values(workerHealth?.workers ?? {}).filter((worker) => worker.enabled && (worker.consecutiveFailures ?? 0) > 0).length
    const status = !readyResponse.ok || ready?.status === 'not_ready' ? 'down'
      : ready?.status !== 'ready' || !workersResponse.ok || failedWorkers > 0 ? 'degraded' : 'healthy'
    return {
      status,
      checkedAt,
      latencyMs: Math.round(performance.now() - startedAt),
      readiness: ready?.status ?? 'unknown',
      database: ready?.database ?? 'unknown',
      workerHealth: workersResponse.ok ? 'available' : 'unavailable',
      failedWorkers,
    }
  } catch {
    return { status: 'down', checkedAt, latencyMs: Math.round(performance.now() - startedAt), reason: 'MarketHub health endpoints could not be reached.' }
  }
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

export function operationsAuditIdentity(actor: OperationsUser | undefined) {
  return {
    actorAdminUserId: actor?.adminUserId ?? null,
    actorOperationsUserId: actor?.id ?? null,
    actorType: actor?.adminUserId === undefined ? 'operations_user' as const : 'admin' as const,
  }
}

export function operationsAuditDetails(actor: OperationsUser | undefined, details?: unknown) {
  const values = actor?.adminSessionId === undefined
    ? details
    : { sourceSessionId: actor.adminSessionId, ...(details === undefined ? {} : { details }) }
  return values === undefined ? undefined : JSON.stringify(values)
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
      adminUserId: operationsSessions.adminUserId,
      adminSessionId: operationsSessions.adminSessionId,
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
    const expiry = nextSessionExpiry(session.createdAt, now, operationsSessionIdleTimeoutMs, operationsSessionAbsoluteLifetimeMs)
    if (!expiry) {
      await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
      clearOperationsCookie(response)
      response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
      return
    }

    if (session.adminUserId === null && session.adminSessionId === null && session.operationsUserId !== null) {
      const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, role: operationsUsers.role, disabledAt: operationsUsers.disabledAt })
        .from(operationsUsers).where(eq(operationsUsers.id, session.operationsUserId)).limit(1)
      if (!user || user.disabledAt) {
        await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
        clearOperationsCookie(response)
        response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
        return
      }
      ;(request as OperationsRequest).operationsUser = { id: user.id, email: user.email, fullName: user.fullName, role: user.role }
      next()
      return
    }

    if (session.adminUserId !== null && session.adminSessionId !== null) {
      const [identity] = await adminDb.select({
        id: operationsUsers.id,
        adminUserId: adminUsers.id,
        email: operationsUsers.email,
        fullName: operationsUsers.fullName,
        status: adminUsers.status,
        emailVerifiedAt: adminUsers.emailVerifiedAt,
        administratorRole: adminUsers.role,
      }).from(adminSessions)
        .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
        .innerJoin(operationsUsers, and(eq(operationsUsers.adminUserId, adminUsers.id), isNull(operationsUsers.disabledAt)))
        .where(and(
          eq(adminSessions.id, session.adminSessionId),
          eq(adminUsers.id, session.adminUserId),
          eq(operationsUsers.id, session.operationsUserId!),
          gt(adminSessions.expiresAt, now),
        )).limit(1)
      const operationsRole = operationsRoleForIdentityBridge(identity?.administratorRole ?? null)
      if (identity && operationsRole && canUseOperationsIdentityBridge(operationsRole, identity.status, identity.emailVerifiedAt !== null)) {
        ;(request as OperationsRequest).operationsUser = { id: identity.id, adminUserId: identity.adminUserId, adminSessionId: session.adminSessionId, email: identity.email, fullName: identity.fullName, role: operationsRole }
        next()
        return
      }
      await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
      await adminDb.insert(operationsAuditEvents).values({
        actorAdminUserId: session.adminUserId,
        actorOperationsUserId: session.operationsUserId,
        actorType: 'admin',
        action: 'operations.session.authorization_denied',
        targetType: 'operations_session',
        targetId: String(session.id),
        details: JSON.stringify({ sourceSessionId: session.adminSessionId }),
      })
    } else {
      await adminDb.delete(operationsSessions).where(eq(operationsSessions.id, session.id))
    }
    clearOperationsCookie(response)
    response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations authorization is no longer active.' } })
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
operationsRouter.get('/registration-status', (_request, response) => response.json({ data: { available: false } }))
operationsRouter.post('/register', (_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Operations registration is not available.' } }))

operationsRouter.post('/login', operationsLoginLimiter, async (request, response) => {
  if (!adminDb) return operationsUnavailable(response)
  const input = loginSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_OPERATIONS_LOGIN', message: 'Enter a valid operations email and password.' } })
  const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, role: operationsUsers.role, passwordHash: operationsUsers.passwordHash, adminUserId: operationsUsers.adminUserId, disabledAt: operationsUsers.disabledAt })
    .from(operationsUsers).where(eq(operationsUsers.email, input.data.email)).limit(1)
  const passwordMatches = await verifyPassword(input.data.password, user?.passwordHash ?? undefined)
  if (!user || user.adminUserId !== null || user.disabledAt || !passwordMatches) {
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
  response.json({ data: { user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } } })
})

operationsRouter.post('/logout', authenticateOperations, async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  const token = operationsCookieToken(request)
  if (token && adminDb) {
    await adminDb.transaction(async (transaction) => {
      await transaction.delete(operationsSessions).where(eq(operationsSessions.tokenHash, hashOperationsToken(token)))
      if (actor) await transaction.insert(operationsAuditEvents).values({
        ...operationsAuditIdentity(actor),
        action: 'operations.logout',
        targetType: 'operations_user',
        targetId: String(actor.id),
        details: operationsAuditDetails(actor),
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
  const [session] = await adminDb.select({ id: operationsSessions.id, adminSessionId: operationsSessions.adminSessionId, createdAt: operationsSessions.createdAt, expiresAt: operationsSessions.expiresAt })
    .from(operationsSessions).where(and(eq(operationsSessions.tokenHash, hashOperationsToken(token)), gt(operationsSessions.expiresAt, now))).limit(1)
  const sessionExpiry = session ? nextSessionExpiry(session.createdAt, now, operationsSessionIdleTimeoutMs, operationsSessionAbsoluteLifetimeMs) : null
  let sourceExpiry: Date | null = null
  if (session?.adminSessionId !== null && session?.adminSessionId !== undefined) {
    const [sourceSession] = await adminDb.select({ expiresAt: adminSessions.expiresAt }).from(adminSessions)
      .where(and(eq(adminSessions.id, session.adminSessionId), gt(adminSessions.expiresAt, now))).limit(1)
    sourceExpiry = sourceSession?.expiresAt ?? null
  }
  const expiry = sessionExpiry && (session.adminSessionId === null || sourceExpiry)
    ? sourceExpiry && sourceExpiry < sessionExpiry ? sourceExpiry : sessionExpiry
    : null
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
operationsRouter.use((request, response, next) => {
  const actor = authenticatedOperationsUser(request)
  if (!actor) return response.status(401).json({ error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' } })
  if (!hasOperationsRoutePermission(actor.role, request.method, request.path)) {
    return response.status(403).json({ error: { code: 'OPERATIONS_PERMISSION_REQUIRED', message: 'This operations role cannot access the requested resource.' } })
  }
  next()
})

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

operationsRouter.get('/me', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  if (!actor || !adminDb) return operationsUnavailable(response)
  const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, role: operationsUsers.role }).from(operationsUsers).where(eq(operationsUsers.id, actor.id)).limit(1)
  response.json({ data: { user: user ?? null } })
})

operationsRouter.get('/operators', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const operators = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, role: operationsUsers.role, disabledAt: operationsUsers.disabledAt, lastLoginAt: operationsUsers.lastLoginAt })
    .from(operationsUsers)
    .where(isNull(operationsUsers.disabledAt))
    .orderBy(asc(operationsUsers.fullName))
  response.json({ data: operators })
})

const roleDescriptions: Record<ItAccessRole, string> = {
  super_admin: 'Full IT operations access and role administration.',
  chief_security_operator: 'Security operations, investigations, vulnerability scans, infrastructure visibility, and audit review without role administration.',
  security_analyst: 'Security monitoring, incidents, audit review, and scanner operations.',
  it_support: 'Operations, incidents, and incident workflow access.',
  database_admin: 'Database operations plus incidents and audit review.',
  infrastructure_admin: 'Infrastructure operations plus incidents and audit review.',
  viewer: 'Read-only operations overview.',
}

operationsRouter.get('/permissions', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  if (!actor || !adminDb) return operationsUnavailable(response)
  const users = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email, fullName: operationsUsers.fullName, role: operationsUsers.role, disabledAt: operationsUsers.disabledAt, lastLoginAt: operationsUsers.lastLoginAt })
    .from(operationsUsers).where(isNull(operationsUsers.disabledAt)).orderBy(asc(operationsUsers.fullName))
  response.json({ data: {
    roles: itAccessRoles.map((role) => ({ role, description: roleDescriptions[role], permissions: itPermissions.filter((permission) => hasItPermission(role, permission)) })),
    permissions: itPermissions,
    users,
  } })
})

const operationsRoleUpdateSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(itAccessRoles),
}).strict()

operationsRouter.patch('/permissions/users/:id/role', async (request, response) => {
  const actor = authenticatedOperationsUser(request)
  if (!actor || !adminDb) return operationsUnavailable(response)
  const input = operationsRoleUpdateSchema.safeParse({ ...request.body, userId: Number(request.params.id) })
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_OPERATIONS_ROLE', message: 'The user and role are invalid.' } })
  const result = await adminDb.transaction(async (transaction) => {
    const [grantor] = await transaction.select({ role: operationsUsers.role }).from(operationsUsers).where(eq(operationsUsers.id, actor.id)).for('update').limit(1)
    if (grantor?.role !== 'super_admin') return { status: 403 as const, code: 'OPERATIONS_PERMISSION_REQUIRED', message: 'Only an IT super-admin can manage roles.' }
    const [target] = await transaction.select({ id: operationsUsers.id, fullName: operationsUsers.fullName, role: operationsUsers.role, adminUserId: operationsUsers.adminUserId }).from(operationsUsers)
      .where(and(eq(operationsUsers.id, input.data.userId), isNull(operationsUsers.disabledAt))).for('update').limit(1)
    if (!target) return { status: 404 as const, code: 'OPERATIONS_USER_NOT_FOUND', message: 'Active operations user not found.' }
    if (target.adminUserId !== null) return { status: 409 as const, code: 'CENTRAL_ROLE_MANAGED', message: 'This linked identity is managed by central IT role assignment.' }
    if (target.role === 'super_admin' && input.data.role !== 'super_admin') {
      const [{ total }] = await transaction.select({ total: count() }).from(operationsUsers).where(and(eq(operationsUsers.role, 'super_admin'), isNull(operationsUsers.disabledAt)))
      if (Number(total) <= 1) return { status: 409 as const, code: 'LAST_OPERATIONS_SUPER_ADMIN', message: 'The last operations super-admin cannot be changed.' }
    }
    await transaction.update(operationsUsers).set({ role: input.data.role }).where(eq(operationsUsers.id, target.id))
    await transaction.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: 'operations.role_changed',
      targetType: 'operations_user',
      targetId: String(target.id),
      details: operationsAuditDetails(actor, { fromRole: target.role, toRole: input.data.role }),
    })
    return { status: 200 as const, code: 'OPERATIONS_ROLE_UPDATED', data: { userId: target.id, fullName: target.fullName, role: input.data.role } }
  })
  if (result.status !== 200) return response.status(result.status).json({ error: { code: result.code, message: result.message } })
  response.json({ data: result.data })
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
  const [storeDatabase, [worker], marketHub] = await Promise.all([
    probeDatabase(pool, 'store'),
    adminDb ? adminDb.select({ lastHeartbeatAt: monitoringWorkerState.lastHeartbeatAt, failureCount: monitoringWorkerState.failureCount })
      .from(monitoringWorkerState).where(eq(monitoringWorkerState.workerName, 'monitoring-detection')).limit(1)
      : Promise.resolve([]),
    probeMarketHub(),
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
      { name: 'markethub-platform', state: marketHub.status, latencyMs: 'latencyMs' in marketHub ? marketHub.latencyMs : null, source: 'live-health-endpoints' },
      { name: 'monitoring-collection', state: collectionState, source: 'last-successful-persistence' },
      { name: 'monitoring-processing', state: workerState, source: 'persisted-worker-heartbeat' },
      { name: 'external-integrations', state: 'unknown', source: 'no-authorized-provider-probes-configured' },
    ],
    telemetryFreshness: queue.freshness,
    queue,
    distributedRateLimiting: getRateLimitStoreStatus(),
  } })
})

operationsRouter.get('/events', async (request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const query = incidentListQuery.extend({
    category: z.enum(['request', 'application', 'security', 'business', 'system']).optional(),
    severity: z.enum(['debug', 'info', 'warning', 'error', 'critical']).optional(),
    eventType: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/).optional(),
    sourceService: z.string().min(2).max(40).optional(),
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
  }).strict().refine((value) => !value.start || !value.end || value.start <= value.end, 'Start must not follow end.').safeParse(request.query)
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
      query.data.severity ? eq(monitoringEvents.severity, query.data.severity) : undefined,
      query.data.eventType ? eq(monitoringEvents.eventType, query.data.eventType) : undefined,
      query.data.sourceService ? eq(monitoringEvents.sourceService, query.data.sourceService) : undefined,
      query.data.start ? gte(monitoringEvents.occurredAt, query.data.start) : undefined,
      query.data.end ? lte(monitoringEvents.occurredAt, query.data.end) : undefined,
    ))
    .orderBy(desc(monitoringEvents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

operationsRouter.get('/security/waf', (_request, response) => {
  response.json({ data: getWafStatus(env.WAF_MODE) })
})

const ipPolicySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  action: z.enum(['allow', 'block', 'challenge']).optional(),
  type: z.enum(['ip', 'cidr']).optional(),
  value: z.string().trim().min(3).max(128).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  reason: z.string().trim().max(240).optional(),
  expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

operationsRouter.get('/security/ip-policies', (_request, response) => {
  response.json({
    data: listIpPolicies().map((policy) => ({
      ...policy,
      expiresAt: policy.expiresAt ? policy.expiresAt.toISOString() : null,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    })),
  })
})

operationsRouter.post('/security/ip-policies', (request, response) => {
  const parsed = ipPolicySchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: { code: 'INVALID_IP_POLICY', message: 'The IP policy payload is invalid.' } })
  }

  try {
    const policy = addIpPolicy({
      type: parsed.data.type ?? (parsed.data.value?.includes('/') ? 'cidr' : 'ip'),
      value: parsed.data.value ?? '',
      name: parsed.data.name,
      action: parsed.data.action ?? 'block',
      enabled: parsed.data.enabled ?? true,
      priority: parsed.data.priority ?? 50,
      reason: parsed.data.reason,
      expiresAt: parsed.data.expiresAt ?? null,
    })
    response.status(201).json({ data: { ...policy, expiresAt: policy.expiresAt ? policy.expiresAt.toISOString() : null, createdAt: policy.createdAt.toISOString(), updatedAt: policy.updatedAt.toISOString() } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The IP policy could not be created.'
    response.status(400).json({ error: { code: 'INVALID_IP_POLICY', message } })
  }
})

operationsRouter.patch('/security/ip-policies/:id', (request, response) => {
  const id = z.string().trim().min(1).safeParse(request.params.id)
  const parsed = ipPolicySchema.safeParse(request.body)
  if (!id.success || !parsed.success) {
    return response.status(400).json({ error: { code: 'INVALID_IP_POLICY', message: 'The IP policy update is invalid.' } })
  }

  const policy = updateIpPolicy(id.data, {
    ...parsed.data,
  })
  if (!policy) {
    return response.status(404).json({ error: { code: 'IP_POLICY_NOT_FOUND', message: 'The requested IP policy does not exist.' } })
  }

  response.json({ data: { ...policy, expiresAt: policy.expiresAt ? policy.expiresAt.toISOString() : null, createdAt: policy.createdAt.toISOString(), updatedAt: policy.updatedAt.toISOString() } })
})

operationsRouter.delete('/security/ip-policies/:id', (request, response) => {
  const id = z.string().trim().min(1).safeParse(request.params.id)
  if (!id.success) {
    return response.status(400).json({ error: { code: 'INVALID_IP_POLICY', message: 'The IP policy identifier is invalid.' } })
  }
  const removed = removeIpPolicy(id.data)
  if (!removed) {
    return response.status(404).json({ error: { code: 'IP_POLICY_NOT_FOUND', message: 'The requested IP policy does not exist.' } })
  }
  response.status(204).end()
})

operationsRouter.get('/security/sbom', async (request, response) => {
  try {
    const actor = authenticatedOperationsUser(request)
    if (!actor || !adminDb) return operationsUnavailable(response, String(request.id))
    const bom = generateCycloneDxSbom(process.cwd())
    await adminDb.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: 'security.sbom.generated',
      targetType: 'software_bill_of_materials',
      targetId: String(bom.serialNumber),
      details: operationsAuditDetails(actor, { format: bom.bomFormat, specVersion: bom.specVersion, componentCount: bom.components.length }),
    })
    response.setHeader('Cache-Control', 'no-store')
    response.type('application/vnd.cyclonedx+json')
    response.json(bom)
  } catch {
    response.status(503).json({ error: { code: 'SBOM_UNAVAILABLE', message: 'A software bill of materials could not be generated from the repository lockfiles.' } })
  }
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
      ...operationsAuditIdentity(actor),
      action: 'monitoring_alert.updated',
      targetType: 'monitoring_alert',
      targetId: String(alert.id),
      details: operationsAuditDetails(actor, Object.keys(input.data)),
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
    response.json({ data: { windowStartedAt: start.toISOString(), windowEndedAt: end.toISOString(), collectedAt: new Date().toISOString(), metrics: [], telemetryAvailable: false } })
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
  const [storeDatabase, adminDatabase, [openIncidentCount], [investigatingIncidentCount], requestMetrics, marketHub] = await Promise.all([
    probeDatabase(pool, 'store'),
    adminPool === pool ? Promise.resolve({ name: 'admin', status: 'healthy' as const, latencyMs: null }) : probeDatabase(adminPool, 'admin'),
    adminDb.select({ total: count() }).from(operationsIncidents).where(eq(operationsIncidents.status, 'open')),
    adminDb.select({ total: count() }).from(operationsIncidents).where(eq(operationsIncidents.status, 'investigating')),
    persistentRequestMetrics(metricStart, metricEnd),
    probeMarketHub(),
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
      markethub: marketHub,
      render: { status: 'unknown', reason: 'Provider API credentials are not configured.' },
      railwayBackups: { status: 'unknown', reason: 'No backup verification feed is configured.' },
      cloudflare: { status: 'unknown', reason: 'No authorized Cloudflare account integration is configured.' },
      daraja: { status: 'unknown', reason: 'No safe provider health check is configured; no payment request was sent.' },
      emailDelivery: { status: 'unknown', reason: 'Email provider delivery health is not exposed as a live check.' },
    },
  } })
})

const operationsPaymentQuery = z.object({
  application: z.enum(['KITZ', 'MARKETHUB']).default('KITZ'),
  status: z.enum(['initiated', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'ambiguous', 'requires_review', 'reversed', 'refunded']).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(80).optional(),
}).strict()
const kitzPaymentStatuses = ['initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'expired', 'requires_review', 'refunded'] as const
type KitzPaymentStatus = typeof kitzPaymentStatuses[number]

operationsRouter.get('/payments', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const query = operationsPaymentQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_QUERY', message: 'Payment filters are invalid.' } })
  const actor = authenticatedOperationsUser(request)
  if (!actor || !adminDb) return response.status(503).json({ error: { code: 'PAYMENT_AUDIT_UNAVAILABLE', message: 'Payment inspections cannot be audited.' } })

  if (query.data.application === 'MARKETHUB') {
    if (!env.MARKETHUB_SECURITY_FEED_URL || !env.MARKETHUB_SERVICE_TOKEN) {
      await adminDb.insert(operationsAuditEvents).values({
        ...operationsAuditIdentity(actor), action: 'payment.monitoring.inspected', targetType: 'payment_monitoring', targetId: 'MARKETHUB',
        details: operationsAuditDetails(actor, { outcome: 'not_configured', status: query.data.status ?? 'all' }),
      })
      return response.status(503).json({ error: { code: 'MARKETHUB_PAYMENT_FEED_NOT_CONFIGURED', message: 'MarketHub payment monitoring is not configured.' } })
    }
    try {
      const feedUrl = new URL(env.MARKETHUB_SECURITY_FEED_URL)
      feedUrl.searchParams.set('limit', String(query.data.limit))
      if (query.data.status) feedUrl.searchParams.set('status', query.data.status)
      if (query.data.search) feedUrl.searchParams.set('search', query.data.search)
      if (query.data.cursor) feedUrl.searchParams.set('cursor', query.data.cursor)
      const feedResponse = await fetch(feedUrl, {
        headers: {
          'x-markethub-service-token': env.MARKETHUB_SERVICE_TOKEN,
          'x-operations-actor-id': String(actor.adminUserId ?? actor.id),
          'x-operations-actor-type': actor.adminUserId === undefined ? 'legacy_operations_user' : 'central_admin',
        },
        signal: AbortSignal.timeout(8_000),
      })
      if (!feedResponse.ok) throw new Error('MARKETHUB_PAYMENT_FEED_FAILED')
      const payload = await feedResponse.json() as { data?: { application?: string; records?: unknown[]; pagination?: { nextCursor: string | null; hasMore: boolean } } }
      const validated = z.object({
        data: z.object({
          application: z.literal('MARKETHUB'),
          records: z.array(z.object({
            id: z.string().uuid(), reference: z.string(), relatedListingReference: z.string().nullable(), purpose: z.string(),
            amount: z.number(), currency: z.literal('KES'), status: z.string(), provider: z.literal('daraja'),
            transactionReference: z.string().nullable(), merchantRequestId: z.string().nullable(), checkoutRequestId: z.string().nullable(),
            payerPhoneMasked: z.string(), providerResponseCode: z.string().nullable(), failureCategory: z.string().nullable(), failureReason: z.string().nullable(),
            createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }), transactionAt: z.string().datetime({ offset: true }).nullable(),
            callback: z.object({ status: z.string(), count: z.number(), lastReceivedAt: z.string().datetime({ offset: true }).nullable(), lastProcessedAt: z.string().datetime({ offset: true }).nullable(), outcomes: z.array(z.string()) }),
            verification: z.object({ status: z.string(), completedAt: z.string().datetime({ offset: true }).nullable(), verifiedAt: z.string().datetime({ offset: true }).nullable() }),
            reconciliation: z.object({ status: z.string(), lastAttemptAt: z.string().datetime({ offset: true }).nullable(), attempts: z.number() }),
          }).strict()),
          pagination: z.object({ nextCursor: z.string().uuid().nullable(), hasMore: z.boolean() }),
        }).strict(),
      }).safeParse(payload)
      if (!validated.success) throw new Error('MARKETHUB_PAYMENT_FEED_INVALID')
      const marketData = validated.data.data
      await adminDb.insert(operationsAuditEvents).values({
        ...operationsAuditIdentity(actor), action: 'payment.monitoring.inspected', targetType: 'payment_monitoring', targetId: 'MARKETHUB',
        details: operationsAuditDetails(actor, { outcome: 'success', status: query.data.status ?? 'all', returnedCount: marketData.records.length }),
      })
      response.setHeader('Cache-Control', 'no-store')
      return response.json({ data: {
        application: 'MARKETHUB',
        records: marketData.records.map((payment) => ({
          id: payment.id,
          orderReference: payment.relatedListingReference ?? payment.reference,
          provider: payment.provider,
          providerRequestId: payment.checkoutRequestId,
          merchantRequestId: payment.merchantRequestId,
          providerReceipt: payment.transactionReference,
          amount: String(payment.amount),
          currency: payment.currency,
          status: payment.status,
          providerResultCode: payment.providerResponseCode,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          transactionAt: payment.transactionAt,
          callback: payment.callback,
          verification: payment.verification,
          reconciliation: payment.reconciliation,
        })),
        pagination: marketData.pagination,
        limitations: ['Payer phone numbers are masked by MarketHub.', 'This view is read-only and cannot settle or change payment state.'],
      } })
    } catch {
      await adminDb.insert(operationsAuditEvents).values({
        ...operationsAuditIdentity(actor), action: 'payment.monitoring.inspected', targetType: 'payment_monitoring', targetId: 'MARKETHUB',
        details: operationsAuditDetails(actor, { outcome: 'unavailable', status: query.data.status ?? 'all' }),
      })
      return response.status(503).json({ error: { code: 'MARKETHUB_PAYMENT_FEED_UNAVAILABLE', message: 'MarketHub payment monitoring is temporarily unavailable.' } })
    }
  }
  if (!db) return response.status(503).json({ error: { code: 'PAYMENT_DATABASE_UNAVAILABLE', message: 'Kitz payment records are unavailable.' } })
  if (query.data.status && !kitzPaymentStatuses.includes(query.data.status as KitzPaymentStatus)) {
    return response.status(400).json({ error: { code: 'INVALID_KITZ_PAYMENT_STATUS', message: 'This payment status is not supported by Kitz.' } })
  }
  if (query.data.cursor && (!/^\d+$/.test(query.data.cursor) || !Number.isSafeInteger(Number(query.data.cursor)) || Number(query.data.cursor) < 1)) {
    return response.status(400).json({ error: { code: 'INVALID_PAYMENT_CURSOR', message: 'Payment pagination is invalid.' } })
  }
  const rows = await db.select({
    id: payments.id,
    orderReference: orders.orderNumber,
    provider: payments.provider,
    providerRequestId: payments.providerRequestId,
    merchantRequestId: payments.merchantRequestId,
    providerReceipt: payments.providerReceipt,
    amount: payments.amount,
    status: payments.status,
    providerResultCode: payments.providerResultCode,
    verificationMessage: payments.verificationMessage,
    createdAt: payments.createdAt,
    updatedAt: payments.updatedAt,
    transactionAt: payments.transactionAt,
  }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id)).where(and(
    eq(payments.applicationId, 'KITZ'),
    query.data.status ? eq(payments.status, query.data.status as KitzPaymentStatus) : undefined,
    query.data.cursor ? lt(payments.id, Number(query.data.cursor)) : undefined,
    query.data.search ? or(
      ilike(orders.orderNumber, `%${query.data.search}%`),
      ilike(payments.providerRequestId, `%${query.data.search}%`),
      ilike(payments.merchantRequestId, `%${query.data.search}%`),
      ilike(payments.providerReceipt, `%${query.data.search}%`),
    ) : undefined,
  )).orderBy(desc(payments.id)).limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const records = rows.slice(0, query.data.limit)
  await adminDb.insert(operationsAuditEvents).values({
    ...operationsAuditIdentity(actor), action: 'payment.monitoring.inspected', targetType: 'payment_monitoring', targetId: 'KITZ',
    details: operationsAuditDetails(actor, { outcome: 'success', status: query.data.status ?? 'all', returnedCount: records.length }),
  })
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: {
    application: 'KITZ',
    records: records.map((payment) => ({
      ...payment,
      amount: payment.amount,
      currency: 'KES',
      callback: { status: 'not_recorded_in_kitz_payment_schema', count: 0, lastReceivedAt: null, lastProcessedAt: null, outcomes: [] },
      verification: { status: payment.status === 'succeeded' && payment.providerResultCode === '0' ? 'provider_code_success_recorded' : payment.status === 'requires_review' ? 'requires_review' : 'not_recorded', completedAt: payment.updatedAt.toISOString(), verifiedAt: payment.transactionAt?.toISOString() ?? null, message: payment.verificationMessage },
      reconciliation: { status: payment.status === 'requires_review' ? 'required' : 'not_implemented', lastAttemptAt: null, attempts: 0 },
    })),
    pagination: { nextCursor: hasMore ? String(records.at(-1)?.id ?? '') : null, hasMore },
    limitations: ['Kitz callback lifecycle is not separately persisted in the current payment schema.', 'Payer phone numbers and callback payloads are not exposed.', 'This view is read-only and cannot settle or change payment state.'],
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
      createdByAdminUserId: actor.adminUserId ?? null,
      createdByOperationsUserId: actor.id,
      detectedAt: now,
    }).returning({ id: operationsIncidents.id })
    await transaction.insert(operationsIncidentEvents).values({
      incidentId: id,
      actorAdminUserId: actor.adminUserId ?? null,
      actorOperationsUserId: actor.id,
      eventType: 'created',
      message: `Incident opened: ${input.data.title}`,
    })
    await transaction.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: 'incident.created',
      targetType: 'incident',
      targetId: incidentNumber,
      details: operationsAuditDetails(actor, { severity: input.data.severity, affectedComponent: input.data.affectedComponent }),
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
    await transaction.insert(operationsIncidentEvents).values({ incidentId: id.data, actorAdminUserId: actor.adminUserId ?? null, actorOperationsUserId: actor.id, eventType: 'updated', message: details })
    await transaction.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: 'incident.updated',
      targetType: 'incident',
      targetId: existing.incidentNumber,
      details: operationsAuditDetails(actor, Object.keys(changes)),
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
    await transaction.insert(operationsIncidentEvents).values({ incidentId: id.data, actorAdminUserId: actor.adminUserId ?? null, actorOperationsUserId: actor.id, eventType: 'note', message: input.data.message })
    await transaction.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: 'incident.note_added',
      targetType: 'incident',
      targetId: incident.incidentNumber,
      details: operationsAuditDetails(actor),
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
  scope: z.array(z.enum(['dependency', 'osv', 'secrets', 'source', 'api', 'database', 'configuration', 'infrastructure', 'web'])).max(8).optional(),
  timeoutSeconds: z.number().int().min(30).max(900).optional(),
}).strict()

const findingLifecycleSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'ACCEPTED_RISK', 'FALSE_POSITIVE']),
  note: z.string().max(2000).trim().optional(),
  verificationStatus: z.enum(['UNVERIFIED', 'VERIFIED_FIXED', 'VERIFIED_NOT_FIXED']).optional(),
}).strict()

async function requireSecurityAction(request: Request, response: Response, permission: ItPermission) {
  const actor = authenticatedOperationsUser(request)
  if (!actor || !adminDb) return false
  if (!hasItPermission(actor.role, permission)) {
    response.status(403).json({ error: { code: 'SECURITY_PERMISSION_REQUIRED', message: 'A security administrator role is required.' } })
    return false
  }
  return actor
}

operationsRouter.get('/security/overview', async (_request, response) => {
  const overview = getSecurityOverview()
  if (!adminDb) return response.json({ data: overview })
  try {
    const persisted = await loadPersistedSecurityScans(adminDb)
    const liveKeys = new Set(listSecurityScans().flatMap((scan) => scan.findings.map((finding) => finding.deduplicationKey)))
    const persistedFindings = persisted.flatMap((scan) => scan.findings).filter((finding) => !liveKeys.has(finding.deduplicationKey))
    const severityCounts = { ...overview.severityCounts }
    for (const finding of persistedFindings) {
      if (!finding.severity) severityCounts.UNASSESSED++
      else severityCounts[finding.severity]++
    }
    const latest = [...persisted, ...listSecurityScans()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    response.json({ data: { ...overview, findings: overview.findings + persistedFindings.length, severityCounts, latestScan: latest ? { id: latest.id, status: latest.status, completedAt: latest.completedAt ?? null } : null } })
  } catch {
    response.json({ data: overview })
  }
})

operationsRouter.get('/security/scanners', (_request, response) => {
  response.json({ data: [
    { scanner: 'npm-audit', status: dependencyScannerAvailability(), coverage: 'dependency', source: 'npm audit runner; findings require an executed scan' },
    { scanner: 'osv', status: 'available', coverage: 'dependency', source: 'OSV public batch API; scans lockfile package names and exact versions' },
    { scanner: 'repository-secret-scanner', status: 'available', coverage: 'secrets', source: 'bounded local source scan; values masked; no third-party service' },
    { scanner: 'semgrep', status: 'not_configured', coverage: 'source', source: 'not installed' },
    { scanner: 'database-readonly', status: 'not_configured', coverage: 'database', source: 'credentials not configured for assessment' },
    { scanner: 'trivy', status: 'not_configured', coverage: 'infrastructure', source: 'not installed' },
    { scanner: 'zap', status: 'not_configured', coverage: 'web', source: 'not installed' },
  ] })
})

operationsRouter.get('/security/scans', async (_request, response) => {
  try {
    const persisted = adminDb ? await loadPersistedSecurityScans(adminDb) : []
    const liveIds = new Set(listSecurityScans().map((scan) => scan.id))
    response.json({ data: [...listSecurityScans(), ...persisted.filter((scan) => !liveIds.has(scan.id))].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) })
  } catch {
    response.json({ data: listSecurityScans() })
  }
})

operationsRouter.post('/security/scans', async (request, response) => {
  const actor = await requireSecurityAction(request, response, 'security.scan')
  if (!actor) return
  const input = securityScanScopeSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_SECURITY_SCAN', message: 'The security scan scope or timeout is invalid.' } })
  try {
    const scan = await startSecurityScan((input.data.scope ?? ['dependency']) as ScannerModule[], process.cwd(), (input.data.timeoutSeconds ?? 120) * 1000, async (current) => {
      await persistSecurityScan(adminDb!, current, actor.id)
    })
    await adminDb!.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: 'security.scan.started',
      targetType: 'security_scan',
      targetId: scan.id,
      details: operationsAuditDetails(actor, { scope: scan.scope }),
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
  const actor = await requireSecurityAction(request, response, 'security.scan')
  if (!actor) return
  const scan = getSecurityScan(request.params.id)
  if (!scan) return response.status(404).json({ error: { code: 'SECURITY_SCAN_NOT_FOUND', message: 'The security scan was not found.' } })
  if (!cancelSecurityScan(scan.id)) return response.status(409).json({ error: { code: 'SECURITY_SCAN_NOT_RUNNING', message: 'The security scan is not running.' } })
  await adminDb!.insert(operationsAuditEvents).values({
    ...operationsAuditIdentity(actor),
    action: 'security.scan.cancelled',
    targetType: 'security_scan',
    targetId: scan.id,
    details: operationsAuditDetails(actor),
  })
  response.status(204).end()
})

operationsRouter.get('/security/findings', async (request, response) => {
  const severity = typeof request.query.severity === 'string' ? request.query.severity.toUpperCase() : null
  const query = typeof request.query.search === 'string' ? request.query.search.trim().toLowerCase() : ''
  let findings = listSecurityFindings()
  if (adminDb) {
    try {
      const persisted = await loadPersistedSecurityScans(adminDb)
      const liveKeys = new Set(findings.map((finding) => finding.deduplicationKey))
      findings = [...findings, ...persisted.flatMap((scan) => scan.findings).filter((finding) => !liveKeys.has(finding.deduplicationKey))]
    } catch { /* Live findings remain authoritative when database history is unavailable. */ }
  }
  findings = findings.filter((finding) => (!severity || finding.severity === severity) && (!query || `${finding.title} ${finding.affectedComponent}`.toLowerCase().includes(query)))
  response.json({ data: findings })
})

operationsRouter.patch('/security/findings/:id/status', async (request, response) => {
  const actor = await requireSecurityAction(request, response, 'security.findings.write')
  if (!actor) return
  const input = findingLifecycleSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_FINDING_STATUS', message: 'The finding lifecycle update is invalid.' } })
  const finding = listSecurityFindings().find((item) => item.id === request.params.id)
  if (!finding) return response.status(404).json({ error: { code: 'SECURITY_FINDING_NOT_FOUND', message: 'The finding was not found.' } })
  await adminDb!.insert(operationsAuditEvents).values({
    ...operationsAuditIdentity(actor),
    action: 'security.finding.status_changed',
    targetType: 'security_finding',
    targetId: finding.id,
    details: operationsAuditDetails(actor, { status: input.data.status, verificationStatus: input.data.verificationStatus ?? 'UNVERIFIED', note: input.data.note ?? null }),
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

operationsRouter.get('/security/schedule', async (_request, response) => {
  if (!adminDb) return operationsUnavailable(response, String(_request.id))
  const [schedule] = await adminDb.select({
    enabled: securityScanSchedules.enabled,
    cronExpression: securityScanSchedules.cronExpression,
    nextRunAt: securityScanSchedules.nextRunAt,
    lastRunAt: securityScanSchedules.lastRunAt,
  }).from(securityScanSchedules).where(eq(securityScanSchedules.scheduleId, dependencyScanScheduleId)).limit(1)
  const dailyAt = schedule?.cronExpression.match(/^daily@(\d{2}:\d{2})Z$/)?.[1] ?? '02:00'
  response.json({ data: {
    enabled: schedule?.enabled ?? false,
    dailyAt,
    nextRunAt: schedule?.nextRunAt?.toISOString() ?? null,
    lastRunAt: schedule?.lastRunAt?.toISOString() ?? null,
    worker: 'dependency-scanner',
  } })
})

const securityScheduleSchema = z.object({ enabled: z.boolean(), dailyAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict()
operationsRouter.put('/security/schedule', async (request, response) => {
  const actor = await requireSecurityAction(request, response, 'dependencies.manage')
  if (!actor) return
  const input = securityScheduleSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_SECURITY_SCHEDULE', message: 'Provide a valid UTC time for the daily dependency scan.' } })
  if (!adminDb) return operationsUnavailable(response, String(request.id))
  const expression = `daily@${input.data.dailyAt}Z`
  const now = new Date()
  const nextRunAt = input.data.enabled ? nextDailyRunAt(expression, now) : null
  const schedule = await adminDb.transaction(async (transaction) => {
    const [saved] = await transaction.insert(securityScanSchedules).values({
      scheduleId: dependencyScanScheduleId,
      enabled: input.data.enabled,
      scope: 'dependency',
      cronExpression: expression,
      nextRunAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: securityScanSchedules.scheduleId,
      set: { enabled: input.data.enabled, scope: 'dependency', cronExpression: expression, nextRunAt, updatedAt: now },
    }).returning({ enabled: securityScanSchedules.enabled, nextRunAt: securityScanSchedules.nextRunAt })
    await transaction.insert(operationsAuditEvents).values({
      ...operationsAuditIdentity(actor),
      action: input.data.enabled ? 'security.dependency_scan.scheduled' : 'security.dependency_scan.schedule_disabled',
      targetType: 'security_scan_schedule',
      targetId: dependencyScanScheduleId,
      details: operationsAuditDetails(actor, { dailyAt: input.data.dailyAt, enabled: input.data.enabled }),
    })
    return saved
  })
  response.json({ data: { enabled: schedule.enabled, dailyAt: input.data.dailyAt, nextRunAt: schedule.nextRunAt?.toISOString() ?? null } })
})

operationsRouter.get('/security/notifications/status', (_request, response) => {
  response.json({ data: securityNotificationStatus() })
})