import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hash } from 'bcryptjs'
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { adminDb, db } from '../../config/database.js'
import { env } from '../../config/env.js'
import { bcryptPasswordSchema } from '../../config/password-policy.js'
import { buildAbsoluteUrl, customerEmailTemplate, sendTransactionalEmail } from '../../config/email.js'
import { adminAuditLogs, adminInvitations, adminLoginAttempts, adminRolePermissions, adminSessions, adminSetupLocks, adminUserPermissions, adminUsers, adminVerificationTokens, administratorRoles, monitoringAlerts, monitoringDetectionRules, monitoringEvents } from '../../database/admin-schema.js'
import { categories, expenses, homepageSlides, inventoryMovements, notificationCampaigns, orders, payments, productVariants, products, supportRequests, users } from '../../database/schema.js'
import { authenticateAdmin, authenticatedAdmin } from '../../middleware/authenticate.js'
import { allocateAdministratorRoleNumber } from './role-number.js'
import { administratorPermissions as permissionKeys, administratorPortal, administratorRoles as roles, defaultAdministratorPermissions, hasAdministratorPermission, type AdministratorPermission } from './administration.js'
import { loadAdministratorPermissions, permissionDescriptions, validatePermissionSelection } from './permissions.js'

export const adminEcosystemRouter = Router()
const bootstrapLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false })
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const secretMatches = (candidate: string, configured?: string) => {
  if (!configured) return false
  const left = createHash('sha256').update(candidate).digest()
  const right = createHash('sha256').update(configured).digest()
  return left.length === right.length && timingSafeEqual(left, right)
}

const bootstrapSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: bcryptPasswordSchema(14),
  confirmPassword: z.string(),
  secretKey: z.string().min(32).max(512),
}).strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })

adminEcosystemRouter.post('/bootstrap', bootstrapLimiter, async (request, response) => {
  const input = bootstrapSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_BOOTSTRAP', message: 'Check the account details and passwords.' } })
  const configuredSecret = env.ADMIN_SECRET_KEY ?? env.ADMIN_SIGNUP_SECRET
  if (!secretMatches(input.data.secretKey, configuredSecret)) return response.status(403).json({ error: { code: 'INVALID_ADMIN_SECRET', message: 'Administrator bootstrap key is invalid.' } })
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is unavailable.' } })

  const passwordHash = await hash(input.data.password, 12)
  const verificationToken = randomBytes(32).toString('base64url')
  const result = await adminDb.transaction(async (transaction) => {
    const [existing] = await transaction.select({ id: adminUsers.id, role: adminUsers.role, status: adminUsers.status }).from(adminUsers).where(eq(adminUsers.email, input.data.email)).limit(1)
    if (existing?.role === 'super_admin' && existing.status === 'pending') {
      await transaction.update(adminUsers).set({ passwordHash, fullName: input.data.fullName }).where(eq(adminUsers.id, existing.id))
      await transaction.insert(adminVerificationTokens).values({ adminUserId: existing.id, tokenHash: tokenHash(verificationToken), expiresAt: new Date(Date.now() + 60 * 60_000) })
      await transaction.insert(adminAuditLogs).values({ adminUserId: existing.id, action: 'super_admin.verification_resent', targetType: 'admin_user', targetId: String(existing.id) })
      return { status: 201 as const, adminId: existing.id }
    }
    if (existing) return { status: 409 as const, code: 'ADMIN_EMAIL_EXISTS', message: 'An administrator with that email already exists.' }

    const [{ total }] = await transaction.select({ total: count() }).from(adminUsers).where(eq(adminUsers.role, 'super_admin'))
    if (Number(total) > 0) return { status: 409 as const, code: 'SUPER_ADMIN_EXISTS', message: 'Super Administrator bootstrap is disabled.' }
    const [lock] = await transaction.select({ id: adminSetupLocks.id }).from(adminSetupLocks).where(eq(adminSetupLocks.purpose, 'super_admin_bootstrap')).for('update').limit(1)
    if (lock) return { status: 409 as const, code: 'BOOTSTRAP_CONSUMED', message: 'Super Administrator bootstrap is already complete.' }
    const [created] = await transaction.insert(adminUsers).values({
      email: input.data.email,
      fullName: input.data.fullName,
      passwordHash,
      roleNumber: 'SUPER-0001',
      role: 'super_admin',
      status: 'pending',
    }).returning({ id: adminUsers.id })
    await transaction.insert(adminVerificationTokens).values({ adminUserId: created.id, tokenHash: tokenHash(verificationToken), expiresAt: new Date(Date.now() + 60 * 60_000) })
    await transaction.insert(adminSetupLocks).values({ id: 1, purpose: 'super_admin_bootstrap' })
    await transaction.insert(adminAuditLogs).values({ adminUserId: created.id, action: 'super_admin.bootstrap_created', targetType: 'admin_user', targetId: String(created.id) })
    return { status: 201 as const, adminId: created.id }
  })
  if (result.status !== 201) return response.status(result.status).json({ error: { code: result.code, message: result.message } })

  const verificationUrl = buildAbsoluteUrl(`/super-admin/verify?token=${encodeURIComponent(verificationToken)}`)
  const delivery = await sendTransactionalEmail({
    to: input.data.email,
    subject: 'Verify your KitCulture Super Administrator account',
    text: `Verify the account using this secure link: ${verificationUrl}\n\nThis link expires in 60 minutes.`,
    html: customerEmailTemplate({ title: 'Verify Super Administrator account', intro: 'Confirm your email address to activate the KitCulture Super Administrator account.', actionLabel: 'Verify administrator account', actionUrl: verificationUrl, footer: 'This link expires in 60 minutes.' }),
    notificationType: 'email_verification',
  })
  if (delivery.status !== 'accepted') return response.status(202).json({ data: { pendingVerification: true, deliveryStatus: delivery.status, deliveryErrorCode: delivery.reason }, message: delivery.reason === 'SMTP_AUTH_FAILED'
    ? 'Account created, but Brevo rejected the SMTP credentials.'
    : delivery.reason === 'SMTP_CONNECTION_FAILED'
      ? 'Account created, but the server could not connect to Brevo SMTP.'
      : delivery.reason === 'SMTP_RECIPIENT_REJECTED'
        ? 'Account created, but Brevo rejected the recipient or sender.'
        : 'Account created, but the verification email could not be delivered.' })
  response.status(201).json({ data: { pendingVerification: true, deliveryStatus: 'accepted' } })
})

const onboardingSchema = z.object({
  token: z.string().min(32).max(128),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  roleNumber: z.string().trim().min(4).max(40),
  password: bcryptPasswordSchema(14),
  confirmPassword: z.string(),
}).strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })

adminEcosystemRouter.post('/onboarding', async (request, response) => {
  const input = onboardingSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_ONBOARDING', message: 'Invitation details are invalid.' } })
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is unavailable.' } })
  const [invitation] = await adminDb.select({ id: adminInvitations.id, adminUserId: adminInvitations.adminUserId, email: adminInvitations.email, expiresAt: adminInvitations.expiresAt, consumedAt: adminInvitations.consumedAt })
    .from(adminInvitations).where(eq(adminInvitations.tokenHash, tokenHash(input.data.token))).limit(1)
  if (!invitation || invitation.consumedAt || invitation.expiresAt.getTime() <= Date.now() || invitation.email !== input.data.email) return response.status(400).json({ error: { code: 'INVALID_INVITATION', message: 'Invitation is invalid, expired, or already used.' } })
  const [admin] = await adminDb.select({ roleNumber: adminUsers.roleNumber, status: adminUsers.status }).from(adminUsers).where(eq(adminUsers.id, invitation.adminUserId)).limit(1)
  if (!admin || admin.status !== 'pending' || admin.roleNumber !== input.data.roleNumber) return response.status(403).json({ error: { code: 'INVITATION_ACCOUNT_MISMATCH', message: 'Invitation does not belong to this role number or email.' } })
  const pendingPasswordHash = await hash(input.data.password, 12)
  await adminDb.update(adminInvitations).set({ passwordHash: pendingPasswordHash }).where(eq(adminInvitations.id, invitation.id))
  const verificationUrl = buildAbsoluteUrl(`/admin/verify?token=${encodeURIComponent(input.data.token)}&invitation=1`)
  const delivery = await sendTransactionalEmail({
    to: input.data.email,
    subject: 'Verify your KitCulture administrator account',
    text: `Verify this administrator account: ${verificationUrl}\n\nThis link expires with the invitation.`,
    html: customerEmailTemplate({ title: 'Verify administrator account', intro: 'Confirm your email address to activate your administrator account.', actionLabel: 'Activate administrator account', actionUrl: verificationUrl, footer: 'Use this link once. It expires with the invitation.' }),
    notificationType: 'email_verification',
  })
  if (delivery.status !== 'accepted') return response.status(202).json({ data: { pendingVerification: true, deliveryStatus: delivery.status } })
  response.status(202).json({ data: { pendingVerification: true, deliveryStatus: 'accepted' } })
})

adminEcosystemRouter.post('/verify-invitation', async (request, response) => {
  const input = z.object({ token: z.string().min(32).max(128) }).strict().safeParse(request.body)
  if (!input.success || !adminDb) return response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'Verification token is invalid.' } })
  const verification = await adminDb.transaction(async (transaction) => {
    const [invitation] = await transaction.select({ id: adminInvitations.id, adminUserId: adminInvitations.adminUserId, passwordHash: adminInvitations.passwordHash, expiresAt: adminInvitations.expiresAt, consumedAt: adminInvitations.consumedAt })
      .from(adminInvitations).where(eq(adminInvitations.tokenHash, tokenHash(input.data.token))).for('update').limit(1)
    if (!invitation || invitation.consumedAt || !invitation.passwordHash || invitation.expiresAt.getTime() <= Date.now()) return false
    const consumed = await transaction.update(adminInvitations).set({ consumedAt: new Date() }).where(and(eq(adminInvitations.id, invitation.id), isNull(adminInvitations.consumedAt))).returning({ id: adminInvitations.id })
    if (consumed.length !== 1) return false
    await transaction.update(adminUsers).set({ passwordHash: invitation.passwordHash, status: 'active', emailVerifiedAt: new Date(), passwordUpdatedAt: new Date() }).where(eq(adminUsers.id, invitation.adminUserId))
    await transaction.insert(adminAuditLogs).values({ adminUserId: invitation.adminUserId, action: 'administrator.email_verified', targetType: 'admin_user', targetId: String(invitation.adminUserId) })
    return true
  })
  if (!verification) return response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'Invitation is invalid, expired, or already used.' } })
  response.json({ data: { verified: true } })
})

adminEcosystemRouter.use((request, response, next) => {
  if (request.path.startsWith('/ecosystem')) {
    authenticateAdmin(request, response, next)
    return
  }
  next()
})

async function requireSuperAdmin(permission: AdministratorPermission, request: Parameters<typeof authenticateAdmin>[0], response: Parameters<typeof authenticateAdmin>[1]) {
  const actor = authenticatedAdmin(request)
  if (!actor || !adminDb) return false
  const [admin] = await adminDb.select({ role: adminUsers.role, status: adminUsers.status }).from(adminUsers).where(eq(adminUsers.id, actor.id)).limit(1)
  if (!admin || admin.status !== 'active' || admin.role !== 'super_admin' || !hasAdministratorPermission(admin.role, permission)) {
    response.status(403).json({ error: { code: 'SUPER_ADMIN_PERMISSION_REQUIRED', message: 'Super Administrator permission is required.' } })
    return false
  }
  return { actor, role: admin.role }
}

adminEcosystemRouter.get('/ecosystem', async (request, response) => {
  if (!await requireSuperAdmin('analytics.system', request, response)) return
  if (!adminDb) return
  const [total, active, suspended, pending, invitations] = await Promise.all([
    adminDb.select({ total: count() }).from(adminUsers),
    adminDb.select({ total: count() }).from(adminUsers).where(eq(adminUsers.status, 'active')),
    adminDb.select({ total: count() }).from(adminUsers).where(eq(adminUsers.status, 'suspended')),
    adminDb.select({ total: count() }).from(adminUsers).where(eq(adminUsers.status, 'pending')),
    adminDb.select({ total: count() }).from(adminInvitations).where(and(eq(adminInvitations.deliveryStatus, 'accepted'), isNull(adminInvitations.consumedAt))),
  ])
  const recentActivity = await adminDb.select({ id: adminAuditLogs.id, action: adminAuditLogs.action, targetType: adminAuditLogs.targetType, targetId: adminAuditLogs.targetId, createdAt: adminAuditLogs.createdAt }).from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(25)
  const recentLogins = await adminDb.select({ id: adminLoginAttempts.id, identity: adminLoginAttempts.identity, success: adminLoginAttempts.success, failureCode: adminLoginAttempts.failureCode, createdAt: adminLoginAttempts.createdAt }).from(adminLoginAttempts).orderBy(desc(adminLoginAttempts.createdAt)).limit(25)
  response.json({ data: { total: total[0]?.total ?? 0, active: active[0]?.total ?? 0, suspended: suspended[0]?.total ?? 0, pending: pending[0]?.total ?? 0, pendingInvitations: invitations[0]?.total ?? 0, recentActivity, recentLogins } })
})

adminEcosystemRouter.get('/ecosystem/alerts', async (request, response) => {
  if (!await requireSuperAdmin('analytics.system', request, response)) return
  if (!adminDb) return
  const [failedLogins, invitationDelivery, monitoring, systemEvents] = await Promise.all([
    adminDb.select({ id: adminLoginAttempts.id, identity: adminLoginAttempts.identity, failureCode: adminLoginAttempts.failureCode, createdAt: adminLoginAttempts.createdAt })
      .from(adminLoginAttempts).where(eq(adminLoginAttempts.success, false)).orderBy(desc(adminLoginAttempts.createdAt)).limit(50),
    adminDb.select({ id: adminInvitations.id, email: adminInvitations.email, role: adminInvitations.role, deliveryStatus: adminInvitations.deliveryStatus, deliveryErrorCode: adminInvitations.deliveryErrorCode, createdAt: adminInvitations.createdAt })
      .from(adminInvitations).where(inArray(adminInvitations.deliveryStatus, ['failed', 'skipped', 'queued'])).orderBy(desc(adminInvitations.createdAt)).limit(50),
    adminDb.select({ id: monitoringAlerts.id, severity: monitoringAlerts.severity, description: monitoringAlerts.description, affectedService: monitoringAlerts.affectedService, status: monitoringAlerts.status, firstOccurrence: monitoringAlerts.firstOccurrence, lastOccurrence: monitoringAlerts.lastOccurrence, occurrenceCount: monitoringAlerts.occurrenceCount, ruleName: monitoringDetectionRules.name })
      .from(monitoringAlerts).innerJoin(monitoringDetectionRules, eq(monitoringAlerts.detectionRuleId, monitoringDetectionRules.id)).orderBy(desc(monitoringAlerts.lastOccurrence)).limit(100),
    adminDb.select({ id: monitoringEvents.id, eventType: monitoringEvents.eventType, category: monitoringEvents.category, severity: monitoringEvents.severity, sourceService: monitoringEvents.sourceService, relatedResourceId: monitoringEvents.relatedResourceId, occurredAt: monitoringEvents.occurredAt })
      .from(monitoringEvents).where(inArray(monitoringEvents.category, ['security', 'system'])).orderBy(desc(monitoringEvents.occurredAt)).limit(100),
  ])
  const data = [
    ...failedLogins.map((event) => ({ id: `login-${event.id}`, category: 'authentication', severity: 'warning', title: 'Administrator sign-in failed', detail: `${event.identity} · ${event.failureCode ?? 'Unknown failure'}`, status: 'recorded', createdAt: event.createdAt })),
    ...invitationDelivery.map((event) => ({ id: `invitation-${event.id}`, category: 'email_delivery', severity: event.deliveryStatus === 'failed' ? 'error' : 'warning', title: `Administrator invitation ${event.deliveryStatus}`, detail: `${event.email} · ${event.role} · ${event.deliveryErrorCode ?? 'Delivery status pending'}`, status: event.deliveryStatus, createdAt: event.createdAt })),
    ...monitoring.map((event) => ({ id: `monitoring-${event.id}`, category: 'monitoring', severity: event.severity, title: event.ruleName, detail: `${event.affectedService} · ${event.description} · ${event.occurrenceCount} occurrence(s)`, status: event.status, createdAt: event.lastOccurrence })),
    ...systemEvents.map((event) => ({ id: `event-${event.id}`, category: event.category, severity: event.severity, title: event.eventType, detail: `${event.sourceService}${event.relatedResourceId ? ` · ${event.relatedResourceId}` : ''}`, status: 'recorded', createdAt: event.occurredAt })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 100)
  response.json({ data })
})

adminEcosystemRouter.get('/ecosystem/administrators', async (request, response) => {
  if (!await requireSuperAdmin('administrators.view', request, response)) return
  if (!adminDb) return
  const rows = await adminDb.select({ id: adminUsers.id, email: adminUsers.email, fullName: adminUsers.fullName, roleNumber: adminUsers.roleNumber, role: adminUsers.role, status: adminUsers.status, emailVerifiedAt: adminUsers.emailVerifiedAt, suspendedAt: adminUsers.suspendedAt, lastLoginAt: adminUsers.lastLoginAt, createdAt: adminUsers.createdAt }).from(adminUsers).orderBy(asc(adminUsers.fullName))
  response.json({ data: rows })
})

const inviteSchema = z.object({ fullName: z.string().trim().min(2).max(160), email: z.string().trim().email().max(254), role: z.enum(administratorRoles) }).strict().superRefine((value, context) => {
  if (value.role === 'super_admin') context.addIssue({ code: 'custom', path: ['role'], message: 'Use the dedicated authorized Super Administrator workflow.' })
})

adminEcosystemRouter.post('/ecosystem/administrators/invite', async (request, response) => {
  const authorization = await requireSuperAdmin('invitations.manage', request, response)
  if (!authorization || !adminDb) return
  const input = inviteSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_ADMIN_INVITATION', message: 'Administrator invitation is invalid.' } })
  const email = input.data.email.toLowerCase()
  const rawToken = randomBytes(32).toString('base64url')
  const created = await adminDb.transaction(async (transaction) => {
    const existing = await transaction.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1)
    if (existing.length) return null
    const [dummy] = await transaction.insert(adminUsers).values({
      email,
      fullName: input.data.fullName,
      passwordHash: await hash(randomBytes(32).toString('base64url'), 12),
      role: input.data.role,
      status: 'pending',
    }).returning({ id: adminUsers.id, roleNumber: adminUsers.roleNumber })
    const roleNumber = await allocateAdministratorRoleNumber(transaction, input.data.role)
    await transaction.update(adminUsers).set({ roleNumber }).where(eq(adminUsers.id, dummy.id))
    await transaction.insert(adminInvitations).values({
      invitationId: randomBytes(16).toString('hex'), email, adminUserId: dummy.id, role: input.data.role, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 72 * 60 * 60_000), deliveryStatus: 'queued',
    })
    await transaction.insert(adminAuditLogs).values({ adminUserId: authorization.actor.id, action: 'administrator.invitation_created', targetType: 'admin_user', targetId: String(dummy.id) })
    return { id: dummy.id, roleNumber }
  })
  if (!created) return response.status(409).json({ error: { code: 'ADMIN_EMAIL_EXISTS', message: 'An administrator with that email already exists.' } })
  const url = buildAbsoluteUrl(`/admin/onboarding?token=${encodeURIComponent(rawToken)}&role=${encodeURIComponent(created.roleNumber ?? '')}`)
  const delivery = await sendTransactionalEmail({ to: email, subject: 'Your KitCulture administrator invitation', text: `Open this secure onboarding link: ${url}`, html: customerEmailTemplate({ title: 'Administrator invitation', intro: `Your role number is ${created.roleNumber}. Complete secure onboarding before activation.`, actionLabel: 'Complete administrator onboarding', actionUrl: url, footer: 'This invitation expires in 72 hours.' }), notificationType: 'email_verification' })
  await adminDb.update(adminInvitations).set({ deliveredAt: delivery.status === 'accepted' ? new Date() : null, deliveryStatus: delivery.status === 'accepted' ? 'accepted' : delivery.status }).where(eq(adminInvitations.adminUserId, created.id))
  response.status(201).json({ data: { id: created.id, roleNumber: created.roleNumber, deliveryStatus: delivery.status === 'accepted' ? 'accepted' : delivery.status } })
})

const roleChangeSchema = z.object({ role: z.enum(administratorRoles), reason: z.string().trim().max(500).optional() }).strict()
adminEcosystemRouter.patch('/ecosystem/administrators/:id/role', async (request, response) => {
  const authorization = await requireSuperAdmin('roles.manage', request, response)
  if (!authorization || !adminDb) return
  const input = roleChangeSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ROLE', message: 'Administrator role is invalid.' } })
  const adminId = Number(request.params.id)
  if (!Number.isInteger(adminId) || adminId < 1) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ID', message: 'Administrator ID is invalid.' } })
  if (input.data.role === 'super_admin') return response.status(403).json({ error: { code: 'SUPER_ADMIN_ASSIGNMENT_PROTECTED', message: 'Super Administrator assignment requires the dedicated workflow.' } })
  const [target] = await adminDb.select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1)
  if (!target) return response.status(404).json({ error: { code: 'ADMIN_NOT_FOUND', message: 'Administrator was not found.' } })
  await adminDb.transaction(async (transaction) => {
    await transaction.update(adminUsers).set({ role: input.data.role }).where(eq(adminUsers.id, adminId))
    await transaction.insert(adminAuditLogs).values({ adminUserId: authorization.actor.id, action: 'administrator.role_changed', targetType: 'admin_user', targetId: String(adminId) })
  })
  response.json({ data: { updated: true } })
})

const statusSchema = z.object({ action: z.enum(['activate', 'suspend', 'disable']), reason: z.string().trim().max(500).optional() }).strict()
adminEcosystemRouter.post('/ecosystem/administrators/:id/status', async (request, response) => {
  const authorization = await requireSuperAdmin('administrators.manage', request, response)
  if (!authorization || !adminDb) return
  const input = statusSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_ADMIN_STATUS', message: 'Account status action is invalid.' } })
  const adminId = Number(request.params.id)
  const [target] = await adminDb.select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1)
  if (!target) return response.status(404).json({ error: { code: 'ADMIN_NOT_FOUND', message: 'Administrator was not found.' } })
  if (target.role === 'super_admin') {
    const [{ total }] = await adminDb.select({ total: count() }).from(adminUsers).where(and(eq(adminUsers.role, 'super_admin'), eq(adminUsers.status, 'active')))
    if (Number(total) <= 1 && input.data.action !== 'activate') return response.status(409).json({ error: { code: 'LAST_SUPER_ADMIN', message: 'The last active Super Administrator cannot be suspended or disabled.' } })
  }
  await adminDb.transaction(async (transaction) => {
    const now = new Date()
    await transaction.update(adminUsers).set(input.data.action === 'activate'
      ? { status: 'active', suspendedAt: null, suspendedReason: null }
      : { status: input.data.action === 'suspend' ? 'suspended' : 'disabled', suspendedAt: now, suspendedReason: input.data.reason ?? null }).where(eq(adminUsers.id, adminId))
    if (input.data.action !== 'activate') await transaction.delete(adminSessions).where(eq(adminSessions.adminUserId, adminId))
    await transaction.insert(adminAuditLogs).values({ adminUserId: authorization.actor.id, action: `administrator.${input.data.action}ed`, targetType: 'admin_user', targetId: String(adminId) })
  })
  response.json({ data: { updated: true } })
})

adminEcosystemRouter.get('/portal/:role', authenticateAdmin, async (request, response) => {
  const actor = authenticatedAdmin(request)
  const requestedRole = request.params.role
  if (!roles.includes(requestedRole as (typeof roles)[number])) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ROLE', message: 'Administrator role is invalid.' } })
  if (!actor || (actor.role !== 'super_admin' && actor.role !== requestedRole)) return response.status(403).json({ error: { code: 'ADMIN_PORTAL_FORBIDDEN', message: 'This administrator cannot access the requested portal.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Portal data is unavailable.' } })

  let metrics: Record<string, number | string> = {}
  let records: Record<string, unknown>[] = []
  let series: { label: string; value: number }[] = []

  if (requestedRole === 'sales_admin' || requestedRole === 'super_admin') {
    const [orderCount, customerCount, supportCount] = await Promise.all([
      db.select({ total: count() }).from(orders),
      db.select({ total: count() }).from(users),
      db.select({ total: count() }).from(supportRequests),
    ])
    metrics = { totalOrders: orderCount[0]?.total ?? 0, customers: customerCount[0]?.total ?? 0, supportRequests: supportCount[0]?.total ?? 0 }
    records = (await db.select({ orderNumber: orders.orderNumber, status: orders.status, total: orders.total, createdAt: orders.createdAt }).from(orders).orderBy(desc(orders.createdAt)).limit(10)).map((record) => ({ ...record }))
    series = await db.select({ label: orders.status, value: count() }).from(orders).groupBy(orders.status).then((rows) => rows.map((row) => ({ label: row.label, value: Number(row.value) })))
  } else if (requestedRole === 'finance_admin') {
    const [paymentCount, expenseCount, successful] = await Promise.all([
      db.select({ total: count() }).from(payments),
      db.select({ total: count() }).from(expenses),
      db.select({ amount: payments.amount }).from(payments).where(eq(payments.status, 'succeeded')).limit(1000),
    ])
    const revenue = successful.reduce((total, payment) => total + Number(payment.amount || 0), 0)
    metrics = { payments: paymentCount[0]?.total ?? 0, expenses: expenseCount[0]?.total ?? 0, collectedRevenue: revenue }
    records = (await db.select({ id: payments.id, provider: payments.provider, amount: payments.amount, status: payments.status, createdAt: payments.createdAt }).from(payments).orderBy(desc(payments.createdAt)).limit(10)).map((record) => ({ ...record }))
    series = await db.select({ label: payments.status, value: count() }).from(payments).groupBy(payments.status).then((rows) => rows.map((row) => ({ label: row.label, value: Number(row.value) })))
  } else if (requestedRole === 'inventory_admin') {
    const [variantCount, movementCount, stockRows] = await Promise.all([
      db.select({ total: count() }).from(productVariants),
      db.select({ total: count() }).from(inventoryMovements),
      db.select({ stock: productVariants.stock }).from(productVariants),
    ])
    metrics = { variants: variantCount[0]?.total ?? 0, stockUnits: stockRows.reduce((total, row) => total + Number(row.stock || 0), 0), movements: movementCount[0]?.total ?? 0 }
    records = (await db.select({ id: inventoryMovements.id, movementType: inventoryMovements.movementType, quantityChange: inventoryMovements.quantityChange, note: inventoryMovements.note, createdAt: inventoryMovements.createdAt }).from(inventoryMovements).orderBy(desc(inventoryMovements.createdAt)).limit(10)).map((record) => ({ ...record }))
    series = await db.select({ label: inventoryMovements.movementType, value: count() }).from(inventoryMovements).groupBy(inventoryMovements.movementType).then((rows) => rows.map((row) => ({ label: row.label, value: Number(row.value) })))
  } else if (requestedRole === 'marketing_admin') {
    const [campaignCount] = await Promise.all([db.select({ total: count() }).from(notificationCampaigns)])
    metrics = { campaigns: campaignCount[0]?.total ?? 0 }
    records = (await db.select({ id: notificationCampaigns.id, title: notificationCampaigns.title, audienceType: notificationCampaigns.audienceType, createdAt: notificationCampaigns.createdAt }).from(notificationCampaigns).orderBy(desc(notificationCampaigns.createdAt)).limit(10)).map((record) => ({ ...record }))
    series = records.map((record) => ({ label: String(record.audienceType ?? 'campaign'), value: 1 }))
  } else if (requestedRole === 'content_admin') {
    const [productCount, categoryCount, slideCount] = await Promise.all([
      db.select({ total: count() }).from(products),
      db.select({ total: count() }).from(categories),
      db.select({ total: count() }).from(homepageSlides),
    ])
    metrics = { products: productCount[0]?.total ?? 0, categories: categoryCount[0]?.total ?? 0, homepageSlides: slideCount[0]?.total ?? 0 }
    records = (await db.select({ id: products.id, name: products.name, published: products.published, price: products.price, createdAt: products.createdAt }).from(products).orderBy(desc(products.createdAt)).limit(10)).map((record) => ({ ...record }))
    series = await db.select({ label: products.published, value: count() }).from(products).groupBy(products.published).then((rows) => rows.map((row) => ({ label: row.label ? 'Published' : 'Draft', value: Number(row.value) })))
  }

  response.json({ data: { role: requestedRole, portal: administratorPortal(requestedRole as Parameters<typeof administratorPortal>[0]), metrics, series, records } })
})

adminEcosystemRouter.post('/ecosystem/administrators/:id/sessions/revoke', async (request, response) => {
  const authorization = await requireSuperAdmin('sessions.revoke', request, response)
  if (!authorization || !adminDb) return
  const adminId = Number(request.params.id)
  if (!Number.isInteger(adminId) || adminId < 1) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ID', message: 'Administrator ID is invalid.' } })
  await adminDb.transaction(async (transaction) => {
    await transaction.delete(adminSessions).where(eq(adminSessions.adminUserId, adminId))
    await transaction.insert(adminAuditLogs).values({ adminUserId: authorization.actor.id, action: 'administrator.sessions_revoked', targetType: 'admin_user', targetId: String(adminId) })
  })
  response.json({ data: { revoked: true } })
})

adminEcosystemRouter.post('/ecosystem/administrators/:id/reset-password', async (request, response) => {
  const authorization = await requireSuperAdmin('administrators.manage', request, response)
  if (!authorization || !adminDb) return
  const input = z.object({ password: bcryptPasswordSchema(14) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_PASSWORD', message: 'The replacement password does not meet policy requirements.' } })
  const adminId = Number(request.params.id)
  if (!Number.isInteger(adminId) || adminId < 1) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ID', message: 'Administrator ID is invalid.' } })
  const passwordHash = await hash(input.data.password, 12)
  await adminDb.transaction(async (transaction) => {
    await transaction.update(adminUsers).set({ passwordHash, passwordUpdatedAt: new Date() }).where(eq(adminUsers.id, adminId))
    await transaction.delete(adminSessions).where(eq(adminSessions.adminUserId, adminId))
    await transaction.insert(adminAuditLogs).values({ adminUserId: authorization.actor.id, action: 'administrator.credentials_reset', targetType: 'admin_user', targetId: String(adminId) })
  })
  response.json({ data: { reset: true, sessionsRevoked: true } })
})

adminEcosystemRouter.get('/ecosystem/administrators/:id/activity', async (request, response) => {
  const authorization = await requireSuperAdmin('audit.view', request, response)
  if (!authorization || !adminDb) return
  const adminId = Number(request.params.id)
  const rows = await adminDb.select({ id: adminAuditLogs.id, action: adminAuditLogs.action, targetType: adminAuditLogs.targetType, targetId: adminAuditLogs.targetId, createdAt: adminAuditLogs.createdAt }).from(adminAuditLogs).where(eq(adminAuditLogs.adminUserId, adminId)).orderBy(desc(adminAuditLogs.createdAt)).limit(100)
  response.json({ data: rows })
})

adminEcosystemRouter.post('/ecosystem/administrators/:id/invitation/resend', async (request, response) => {
  const authorization = await requireSuperAdmin('invitations.manage', request, response)
  if (!authorization || !adminDb) return
  const adminId = Number(request.params.id)
  const [invitation] = await adminDb.select({ id: adminInvitations.id, invitationId: adminInvitations.invitationId, email: adminInvitations.email, role: adminInvitations.role, consumedAt: adminInvitations.consumedAt, roleNumber: adminUsers.roleNumber }).from(adminInvitations).innerJoin(adminUsers, eq(adminUsers.id, adminInvitations.adminUserId)).where(eq(adminInvitations.adminUserId, adminId)).orderBy(desc(adminInvitations.createdAt)).limit(1)
  if (!invitation || invitation.consumedAt) return response.status(404).json({ error: { code: 'INVITATION_NOT_FOUND', message: 'A resendable administrator invitation was not found.' } })
  const rawToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 72 * 60 * 60_000)
  await adminDb.update(adminInvitations).set({ tokenHash: tokenHash(rawToken), expiresAt, deliveryStatus: 'queued' }).where(eq(adminInvitations.id, invitation.id))
  const url = buildAbsoluteUrl(`/admin/onboarding?token=${encodeURIComponent(rawToken)}&role=${encodeURIComponent(invitation.roleNumber ?? '')}`)
  const delivery = await sendTransactionalEmail({ to: invitation.email, subject: 'KitCulture administrator invitation reminder', text: `Complete your administrator onboarding: ${url}`, html: customerEmailTemplate({ title: 'Administrator invitation reminder', intro: 'Your administrator invitation is still pending.', actionLabel: 'Complete administrator onboarding', actionUrl: url, footer: 'This renewed invitation expires in 72 hours.' }), notificationType: 'email_verification' })
  await adminDb.update(adminInvitations).set({ deliveredAt: delivery.status === 'accepted' ? new Date() : null, deliveryStatus: delivery.status === 'accepted' ? 'accepted' : delivery.status }).where(eq(adminInvitations.id, invitation.id))
  response.json({ data: { deliveryStatus: delivery.status === 'accepted' ? 'accepted' : delivery.status } })
})

adminEcosystemRouter.get('/ecosystem/roles', (_request, response) => {
  response.json({ data: roles.map((role) => ({ role, portal: administratorPortal(role) })) })
})

adminEcosystemRouter.get('/ecosystem/roles/:role/permissions', async (request, response) => {
  const authorization = await requireSuperAdmin('permissions.manage', request, response)
  if (!authorization || !adminDb) return
  const role = request.params.role
  if (!roles.includes(role as (typeof roles)[number])) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ROLE', message: 'Administrator role is invalid.' } })
  const stored = await adminDb.select({ permission: adminRolePermissions.permission }).from(adminRolePermissions).where(eq(adminRolePermissions.role, role))
  const configured = stored.length > 0
  const activePermissions = new Set(configured ? stored.map(({ permission }) => permission) : defaultAdministratorPermissions[role as (typeof roles)[number]])
  response.json({ data: { role, configured, permissions: permissionKeys.map((permission) => ({ permission, description: permissionDescriptions[permission], enabled: activePermissions.has(permission) })) } })
})

adminEcosystemRouter.put('/ecosystem/roles/:role/permissions', async (request, response) => {
  const authorization = await requireSuperAdmin('permissions.manage', request, response)
  if (!authorization || !adminDb) return
  const role = request.params.role
  if (!roles.includes(role as (typeof roles)[number])) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ROLE', message: 'Administrator role is invalid.' } })
  if (role === 'super_admin') return response.status(403).json({ error: { code: 'SUPER_ADMIN_PERMISSIONS_IMMUTABLE', message: 'Super Administrator permissions cannot be changed.' } })
  const input = z.object({ permissions: z.array(z.string().trim().min(1).max(120)).min(1).max(permissionKeys.length) }).strict().safeParse(request.body)
  if (!input.success || !validatePermissionSelection(input.data?.permissions ?? [])) return response.status(400).json({ error: { code: 'INVALID_PERMISSION_ASSIGNMENT', message: 'Choose one or more valid, unique permissions.' } })
  await adminDb.transaction(async (transaction) => {
    const previousRows = await transaction.select({ permission: adminRolePermissions.permission }).from(adminRolePermissions).where(eq(adminRolePermissions.role, role))
    const previous = new Set(previousRows.length ? previousRows.map(({ permission }) => permission) : defaultAdministratorPermissions[role as (typeof roles)[number]])
    const next = new Set(input.data.permissions)
    await transaction.delete(adminRolePermissions).where(eq(adminRolePermissions.role, role))
    await transaction.insert(adminRolePermissions).values(input.data.permissions.map((permission) => ({ role, permission })))
    const changed = permissionKeys.filter((permission) => previous.has(permission) !== next.has(permission))
    if (changed.length) await transaction.insert(adminAuditLogs).values(changed.map((permission) => ({
      adminUserId: authorization.actor.id,
      action: `administrator.role_permission.${next.has(permission) ? 'granted' : 'revoked'}`,
      targetType: 'administrator_role_permission',
      targetId: `${role}:${permission}`,
    })))
  })
  response.json({ data: { role, permissions: input.data.permissions, updated: true } })
})

adminEcosystemRouter.get('/ecosystem/administrators/:id/permissions', async (request, response) => {
  const authorization = await requireSuperAdmin('permissions.manage', request, response)
  if (!authorization || !adminDb) return
  const adminId = Number(request.params.id)
  if (!Number.isInteger(adminId) || adminId < 1) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ID', message: 'Administrator ID is invalid.' } })
  const [target] = await adminDb.select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1)
  if (!target?.role || !roles.includes(target.role)) return response.status(404).json({ error: { code: 'ADMIN_NOT_FOUND', message: 'Administrator was not found.' } })
  const [roleRows, overrides, effective] = await Promise.all([
    adminDb.select({ permission: adminRolePermissions.permission }).from(adminRolePermissions).where(eq(adminRolePermissions.role, target.role)),
    adminDb.select({ permission: adminUserPermissions.permission, granted: adminUserPermissions.granted }).from(adminUserPermissions).where(and(eq(adminUserPermissions.adminUserId, adminId), isNull(adminUserPermissions.revokedAt))),
    loadAdministratorPermissions(adminId, target.role),
  ])
  const roleSet = new Set(roleRows.length ? roleRows.map(({ permission }) => permission) : defaultAdministratorPermissions[target.role])
  const overrideMap = new Map(overrides.map(({ permission, granted }) => [permission, granted]))
  response.json({ data: { adminId, role: target.role, permissions: permissionKeys.map((permission) => ({ permission, description: permissionDescriptions[permission], roleGranted: roleSet.has(permission), override: overrideMap.get(permission) ?? null, enabled: effective?.has(permission) ?? false })) } })
})

adminEcosystemRouter.patch('/ecosystem/administrators/:id/permissions/:permission', async (request, response) => {
  const authorization = await requireSuperAdmin('permissions.manage', request, response)
  if (!authorization || !adminDb) return
  const adminId = Number(request.params.id)
  const permission = request.params.permission
  if (!Number.isInteger(adminId) || adminId < 1) return response.status(400).json({ error: { code: 'INVALID_ADMIN_ID', message: 'Administrator ID is invalid.' } })
  if (!permissionKeys.includes(permission as AdministratorPermission)) return response.status(400).json({ error: { code: 'INVALID_PERMISSION', message: 'Permission is invalid.' } })
  const input = z.object({ granted: z.boolean().nullable() }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_PERMISSION_OVERRIDE', message: 'Permission override is invalid.' } })
  const [target] = await adminDb.select({ role: adminUsers.role }).from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1)
  if (!target) return response.status(404).json({ error: { code: 'ADMIN_NOT_FOUND', message: 'Administrator was not found.' } })
  if (target.role === 'super_admin') return response.status(403).json({ error: { code: 'SUPER_ADMIN_PERMISSIONS_IMMUTABLE', message: 'Super Administrator permissions cannot be overridden.' } })
  const now = new Date()
  await adminDb.transaction(async (transaction) => {
    if (input.data.granted === null) {
      await transaction.delete(adminUserPermissions).where(and(eq(adminUserPermissions.adminUserId, adminId), eq(adminUserPermissions.permission, permission)))
    } else {
      await transaction.insert(adminUserPermissions).values({ adminUserId: adminId, permission, granted: input.data.granted, grantedByAdminUserId: authorization.actor.id, createdAt: now, revokedAt: null })
        .onConflictDoUpdate({ target: [adminUserPermissions.adminUserId, adminUserPermissions.permission], set: { granted: input.data.granted, grantedByAdminUserId: authorization.actor.id, createdAt: now, revokedAt: null } })
    }
    await transaction.insert(adminAuditLogs).values({ adminUserId: authorization.actor.id, action: input.data.granted === null ? 'administrator.permission_override.cleared' : `administrator.permission_override.${input.data.granted ? 'granted' : 'denied'}`, targetType: 'administrator_permission', targetId: `${adminId}:${permission}` })
  })
  const effective = await loadAdministratorPermissions(adminId, target.role as (typeof roles)[number])
  response.json({ data: { adminId, permission, override: input.data.granted, enabled: effective?.has(permission as AdministratorPermission) ?? false } })
})

adminEcosystemRouter.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  request.log?.error({ errorCode: error instanceof Error ? error.name : 'ADMIN_ECOSYSTEM_ERROR' }, 'Administrator ecosystem request failed')
  response.status(500).json({ error: { code: 'ADMIN_ECOSYSTEM_ERROR', message: 'The administrator request could not be completed.' } })
  void next
})
