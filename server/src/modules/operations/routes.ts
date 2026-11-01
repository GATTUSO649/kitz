import { randomBytes } from 'node:crypto'
import { and, count, desc, eq, inArray, lt } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { adminDb, adminPool, pool } from '../../config/database.js'
import { inspectDatabaseError } from '../../config/database-diagnostics.js'
import { isAllowedClientOrigin } from '../../config/env.js'
import { operationsAuditEvents, operationsIncidentEvents, operationsIncidents, operationsOperators, adminUsers } from '../../database/admin-schema.js'
import { authenticateAdmin, authenticatedAdmin } from '../../middleware/authenticate.js'
import { getRequestMetrics } from '../../middleware/request-metrics.js'

export const operationsRouter = Router()
operationsRouter.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || isAllowedClientOrigin(request.get('origin'))) {
    next()
    return
  }
  response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
})
operationsRouter.use(authenticateAdmin)
operationsRouter.use(async (request, response, next) => {
  const actor = authenticatedAdmin(request)
  if (!actor) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'OPERATIONS_UNAVAILABLE', message: 'Operations access cannot be verified.' } })
    return
  }
  try {
    const [grant] = await adminDb.select({ adminUserId: operationsOperators.adminUserId })
      .from(operationsOperators).where(eq(operationsOperators.adminUserId, actor.id)).limit(1)
    if (!grant) {
      response.status(403).json({ error: { code: 'OPERATIONS_ACCESS_REQUIRED', message: 'This account is not authorized for IT operations.' } })
      return
    }
  } catch (error) {
    if (inspectDatabaseError(error).category === 'missing_table') {
      operationsUnavailable(response)
      return
    }
    next(error)
    return
  }
  response.locals.operationsAdminId = actor.id
  next()
})

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
  response.json({ data: { operator: authenticatedAdmin(request) } })
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
    assignedAdminUserId: operationsIncidents.assignedAdminUserId,
    assigneeName: adminUsers.fullName,
    rootCause: operationsIncidents.rootCause,
    resolutionNotes: operationsIncidents.resolutionNotes,
    detectedAt: operationsIncidents.detectedAt,
    resolvedAt: operationsIncidents.resolvedAt,
    createdAt: operationsIncidents.createdAt,
    updatedAt: operationsIncidents.updatedAt,
  }).from(operationsIncidents)
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
  const actor = authenticatedAdmin(request)
  const input = createIncidentSchema.safeParse(request.body)
  if (!actor) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
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
      createdByAdminUserId: actor.id,
      detectedAt: now,
    }).$returningId()
    await transaction.insert(operationsIncidentEvents).values({
      incidentId: id,
      actorAdminUserId: actor.id,
      eventType: 'created',
      message: `Incident opened: ${input.data.title}`,
    })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: actor.id,
      actorType: 'admin',
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
    actorName: adminUsers.fullName,
  }).from(operationsIncidentEvents)
    .innerJoin(adminUsers, eq(operationsIncidentEvents.actorAdminUserId, adminUsers.id))
    .where(eq(operationsIncidentEvents.incidentId, id.data))
    .orderBy(desc(operationsIncidentEvents.createdAt))
    .limit(100)
  response.json({ data: rows.reverse() })
})

const patchIncidentSchema = z.object({
  severity: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
  assignedAdminUserId: z.number().int().positive().nullable().optional(),
  rootCause: z.string().trim().max(4000).nullable().optional(),
  resolutionNotes: z.string().trim().max(4000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

operationsRouter.patch('/incidents/:id', async (request, response) => {
  const actor = authenticatedAdmin(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = patchIncidentSchema.safeParse(request.body)
  if (!actor) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_UPDATE', message: 'Incident update is invalid.' } })
  if (!adminDb) return operationsUnavailable(response)
  if (input.data.assignedAdminUserId) {
    const [assignee] = await adminDb.select({ id: adminUsers.id }).from(adminUsers)
      .where(and(eq(adminUsers.id, input.data.assignedAdminUserId), inArray(adminUsers.id, adminDb.select({ adminUserId: operationsOperators.adminUserId }).from(operationsOperators)))).limit(1)
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
    await transaction.insert(operationsIncidentEvents).values({ incidentId: id.data, actorAdminUserId: actor.id, eventType: 'updated', message: details })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: actor.id,
      actorType: 'admin',
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
  const actor = authenticatedAdmin(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = noteSchema.safeParse(request.body)
  if (!actor) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_NOTE', message: 'Incident note is invalid.' } })
  if (!adminDb) return operationsUnavailable(response)
  const [incident] = await adminDb.select({ incidentNumber: operationsIncidents.incidentNumber })
    .from(operationsIncidents).where(eq(operationsIncidents.id, id.data)).limit(1)
  if (!incident) return response.status(404).json({ error: { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found.' } })
  await adminDb.transaction(async (transaction) => {
    await transaction.insert(operationsIncidentEvents).values({ incidentId: id.data, actorAdminUserId: actor.id, eventType: 'note', message: input.data.message })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: actor.id,
      actorType: 'admin',
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
    actorType: operationsAuditEvents.actorType,
    actorName: adminUsers.fullName,
    action: operationsAuditEvents.action,
    targetType: operationsAuditEvents.targetType,
    targetId: operationsAuditEvents.targetId,
    details: operationsAuditEvents.details,
    createdAt: operationsAuditEvents.createdAt,
  }).from(operationsAuditEvents)
    .leftJoin(adminUsers, eq(operationsAuditEvents.actorAdminUserId, adminUsers.id))
    .where(query.data.cursor ? lt(operationsAuditEvents.id, query.data.cursor) : undefined)
    .orderBy(desc(operationsAuditEvents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})