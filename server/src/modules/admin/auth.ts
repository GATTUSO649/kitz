import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { adminDb } from '../../config/database.js'
import { verifyPassword } from '../../config/password-policy.js'
import { adminSessionAbsoluteLifetimeMs, adminSessionIdleTimeoutMs, nextSessionExpiry } from '../../config/session-policy.js'
import { adminAuditLogs, adminInvitations, adminLoginAttempts, adminSessions, adminUsers, adminVerificationTokens } from '../../database/admin-schema.js'
import { administratorPortal, marketplaceAdministratorRoles, requiredAdministratorRole } from './administration.js'
import { authenticatedAdmin } from '../../middleware/authenticate.js'
import { authenticateAdmin } from '../../middleware/authenticate.js'

export const adminAuthRouter = Router()
const cookieName = 'kc_admin_session'
export const adminIdleTimeoutMs = adminSessionIdleTimeoutMs
export const adminLoginSchema = z.object({
  identity: z.string().trim().min(3).max(254).optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  roleNumber: z.string().trim().min(4).max(40).optional(),
  expectedRole: z.enum(['sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'it_admin', 'super_admin', 'second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator', 'laundry_admin']).optional(),
  password: z.string().min(1).max(128),
}).strict().refine((value) => Boolean(value.identity || value.email || value.roleNumber), { message: 'Enter an administrator email or role number.' })
export const invalidAdminCredentialsMessage = 'The email address or password is incorrect. Please try again.'
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function cookieToken(header?: string) {
  const value = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
  if (!value) return null
  try { return decodeURIComponent(value.slice(cookieName.length + 1)) } catch { return null }
}

function setAdminSessionCookie(response: Response, token: string) {
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/admin',
    maxAge: adminIdleTimeoutMs,
  })
}

export function matchesAdminSignupSecret(candidate: string, configuredSecret = env.ADMIN_SIGNUP_SECRET) {
  if (!configuredSecret) return false
  const candidateDigest = createHash('sha256').update(candidate).digest()
  const configuredDigest = createHash('sha256').update(configuredSecret).digest()
  return timingSafeEqual(candidateDigest, configuredDigest)
}

function rejectCrossOrigin(request: Parameters<Parameters<typeof adminAuthRouter.post>[1]>[0], response: Parameters<Parameters<typeof adminAuthRouter.post>[1]>[1]) {
  if (!isAllowedClientOrigin(request.get('origin'))) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
    return true
  }
  return false
}

adminAuthRouter.get('/registration-status', (_request, response) => response.json({ data: { available: false } }))
adminAuthRouter.post('/register', (_request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Administrator registration is not available.' } }))

adminAuthRouter.post('/verify', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = z.object({ token: z.string().min(32).max(128) }).safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'The verification link is invalid or expired.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is not configured.' } })
    return
  }
  const now = new Date()
  const verification = await adminDb.transaction(async (transaction) => {
    const [record] = await transaction.select({
      id: adminVerificationTokens.id,
      adminUserId: adminVerificationTokens.adminUserId,
      consumedAt: adminVerificationTokens.consumedAt,
      emailVerifiedAt: adminUsers.emailVerifiedAt,
      role: adminUsers.role,
      status: adminUsers.status,
    }).from(adminVerificationTokens)
      .innerJoin(adminUsers, eq(adminUsers.id, adminVerificationTokens.adminUserId))
      .where(and(
        eq(adminVerificationTokens.tokenHash, hashToken(input.data.token)),
        gt(adminVerificationTokens.expiresAt, now),
      )).limit(1).for('update')
    if (!record) return false
    if (record.consumedAt) return Boolean(record.emailVerifiedAt)
    if (['rejected', 'suspended', 'disabled'].includes(record.status)) return false
    const consumed = await transaction.update(adminVerificationTokens).set({ consumedAt: now })
      .where(and(
        eq(adminVerificationTokens.id, record.id),
        gt(adminVerificationTokens.expiresAt, now),
        isNull(adminVerificationTokens.consumedAt),
      )).returning({ id: adminVerificationTokens.id })
    if (consumed.length !== 1) return false
    const nextStatus = record.role && marketplaceAdministratorRoles.has(record.role) ? 'pending' : 'active'
    await transaction.update(adminUsers).set({ emailVerifiedAt: now, status: nextStatus })
      .where(eq(adminUsers.id, record.adminUserId))
    return true
  })
  if (!verification) {
    response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'The verification link is invalid, expired, or already used.' } })
    return
  }
  response.json({ data: { verified: true } })
})

const adminLoginHandler = async (request: Request, response: Response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = adminLoginSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Enter a valid administrator email and password.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is not configured.' } })
    return
  }
  const identity = (input.data.identity ?? input.data.roleNumber ?? input.data.email ?? '').trim()
  const normalizedIdentity = identity.includes('@') ? identity.toLowerCase() : identity.toUpperCase()
  const [admin] = await adminDb.select({
    id: adminUsers.id,
    email: adminUsers.email,
    fullName: adminUsers.fullName,
    passwordHash: adminUsers.passwordHash,
    emailVerifiedAt: adminUsers.emailVerifiedAt,
    roleNumber: adminUsers.roleNumber,
    role: adminUsers.role,
    status: adminUsers.status,
  }).from(adminUsers).where(normalizedIdentity.includes('@') ? eq(adminUsers.email, normalizedIdentity) : eq(adminUsers.roleNumber, normalizedIdentity)).limit(1)
  if (!admin) {
    await verifyPassword(input.data.password, undefined)
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, success: false, failureCode: 'INVALID_CREDENTIALS' })
    response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: invalidAdminCredentialsMessage } })
    return
  }
  if (admin.status === 'suspended' || admin.status === 'disabled') {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'ACCOUNT_SUSPENDED' })
    response.status(403).json({ error: { code: 'ADMIN_ACCOUNT_SUSPENDED', message: 'This administrator account is suspended or disabled.' } })
    return
  }
  if (admin.status === 'rejected') {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'ADMIN_APPLICATION_REJECTED' })
    response.status(403).json({ error: { code: 'ADMIN_APPLICATION_REJECTED', message: 'This administrator application was not approved.' } })
    return
  }
  const requiredRole = requiredAdministratorRole(request.path, input.data.expectedRole)
  if (requiredRole && requiredRole !== admin.role) {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'PORTAL_ROLE_MISMATCH' })
    response.status(403).json({ error: { code: 'PORTAL_ROLE_MISMATCH', message: 'These credentials do not belong to this administrator portal.' } })
    return
  }
  if (admin.status === 'pending' && admin.roleNumber && (normalizedIdentity === admin.roleNumber || normalizedIdentity === admin.email) && input.data.password === admin.roleNumber) {
    const [invitation] = await adminDb.select({ id: adminInvitations.id, expiresAt: adminInvitations.expiresAt, consumedAt: adminInvitations.consumedAt })
      .from(adminInvitations).where(and(eq(adminInvitations.adminUserId, admin.id), isNull(adminInvitations.consumedAt))).limit(1)
    if (invitation && invitation.expiresAt.getTime() > Date.now()) {
      const activationToken = randomBytes(32).toString('base64url')
      await adminDb.update(adminInvitations).set({ tokenHash: hashToken(activationToken), expiresAt: new Date(Date.now() + 72 * 60 * 60_000) }).where(eq(adminInvitations.id, invitation.id))
      await adminDb.insert(adminAuditLogs).values({ adminUserId: admin.id, action: 'administrator.role_number_activation_started', targetType: 'admin_user', targetId: String(admin.id) })
      response.json({ data: { activationRequired: true, activationToken, roleNumber: admin.roleNumber, email: admin.email, portal: administratorPortal(admin.role!) } })
      return
    }
  }
  const passwordMatches = await verifyPassword(input.data.password, admin.passwordHash)
  if (!passwordMatches) {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'INVALID_CREDENTIALS' })
    response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: invalidAdminCredentialsMessage } })
    return
  }
  if (admin.status !== 'active' || !admin.emailVerifiedAt) {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'ACCOUNT_NOT_ACTIVE' })
    response.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify and activate the administrator account before signing in.' } })
    return
  }
  if (!admin.role) {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'ADMIN_ROLE_UNASSIGNED' })
    response.status(403).json({ error: { code: 'ADMIN_ROLE_UNASSIGNED', message: 'The administrator account has no assigned role.' } })
    return
  }
  const token = randomBytes(32).toString('base64url')
  const createdAt = new Date()
  const expiresAt = nextSessionExpiry(createdAt, createdAt, adminIdleTimeoutMs, adminSessionAbsoluteLifetimeMs)!
  await adminDb.insert(adminSessions).values({
    adminUserId: admin.id,
    tokenHash: hashToken(token),
    expiresAt,
    createdAt,
  })
  setAdminSessionCookie(response, token)
  await adminDb.insert(adminAuditLogs).values({
    adminUserId: admin.id,
    action: 'admin.login',
    targetType: 'admin_user',
    targetId: String(admin.id),
  })
  await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: true })
  await adminDb.update(adminUsers).set({ lastLoginAt: createdAt }).where(eq(adminUsers.id, admin.id))
  response.json({ data: { user: { id: admin.id, email: admin.email, fullName: admin.fullName, roleNumber: admin.roleNumber, role: admin.role }, portal: administratorPortal(admin.role) } })
}

adminAuthRouter.post('/login', adminLoginHandler)
adminAuthRouter.post('/super-admin/login', adminLoginHandler)
adminAuthRouter.post('/finance-admin/login', adminLoginHandler)
adminAuthRouter.post('/inventory-admin/login', adminLoginHandler)
adminAuthRouter.post('/marketing-admin/login', adminLoginHandler)
adminAuthRouter.post('/content-admin/login', adminLoginHandler)
adminAuthRouter.post('/laundry-admin/login', adminLoginHandler)

adminAuthRouter.get('/me', authenticateAdmin, async (request, response) => {
  const admin = authenticatedAdmin(request)
  if (!admin) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  response.json({ data: {
    user: admin,
    portal: admin.role && admin.status === 'active' ? administratorPortal(admin.role as Parameters<typeof administratorPortal>[0]) : null,
    marketHubOrigin: env.MARKETHUB_PUBLIC_URL ? new URL(env.MARKETHUB_PUBLIC_URL).origin : null,
  } })
})

adminAuthRouter.post('/session/activity', (request, response, next) => {
  if (rejectCrossOrigin(request, response)) return
  next()
}, authenticateAdmin, async (request, response) => {
  const token = cookieToken(request.headers.cookie)
  if (!token || !adminDb) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  const now = new Date()
  const [session] = await adminDb.select({ id: adminSessions.id, createdAt: adminSessions.createdAt, expiresAt: adminSessions.expiresAt })
    .from(adminSessions).where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, now))).limit(1)
  const nextExpiry = session ? nextSessionExpiry(session.createdAt, now, adminIdleTimeoutMs, adminSessionAbsoluteLifetimeMs) : null
  const refreshed = session && nextExpiry ? await adminDb.update(adminSessions).set({ expiresAt: nextExpiry }).where(and(
    eq(adminSessions.id, session.id),
    gt(adminSessions.expiresAt, now),
  )).returning({ id: adminSessions.id }) : []
  if (refreshed.length !== 1) {
    response.clearCookie(cookieName, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/admin' })
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/admin',
    maxAge: nextExpiry!.getTime() - now.getTime(),
  })
  response.status(204).end()
})

adminAuthRouter.post('/logout', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const token = cookieToken(request.headers.cookie)
  if (token && adminDb) {
    await adminDb.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)))
  }
  response.clearCookie(cookieName, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/admin',
  })
  response.status(204).end()
})

export async function recordAdminAudit(adminUserId: number, action: string, targetType?: string, targetId?: string) {
  if (!adminDb) {
    throw new Error('Administrator database is not configured; the admin action could not be audited.')
  }
  await adminDb.insert(adminAuditLogs).values({
    adminUserId,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
  })
}
