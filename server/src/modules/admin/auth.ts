import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { hash } from 'bcryptjs'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { adminDb } from '../../config/database.js'
import { bcryptPasswordSchema, verifyPassword } from '../../config/password-policy.js'
import { adminSessionAbsoluteLifetimeMs, adminSessionIdleTimeoutMs, nextSessionExpiry } from '../../config/session-policy.js'
import { adminAuditLogs, adminLoginAttempts, adminSessions, adminUsers, adminVerificationTokens } from '../../database/admin-schema.js'
import { administratorPortal, requiredAdministratorRole } from './administration.js'
import { allocateAdministratorRoleNumber } from './role-number.js'
import { authenticatedAdmin } from '../../middleware/authenticate.js'
import { authenticateAdmin } from '../../middleware/authenticate.js'

export const adminAuthRouter = Router()
const cookieName = 'kc_admin_session'
export const adminIdleTimeoutMs = adminSessionIdleTimeoutMs
export const adminLoginSchema = z.object({
  identity: z.string().trim().min(3).max(254).optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  roleNumber: z.string().trim().min(4).max(40).optional(),
  expectedRole: z.enum(['sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'it_admin', 'super_admin']).optional(),
  password: z.string().min(1).max(128),
}).strict().refine((value) => Boolean(value.identity || value.email || value.roleNumber), { message: 'Enter an administrator email or role number.' })
export const invalidAdminCredentialsMessage = 'The email address or password is incorrect. Please try again.'
const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: bcryptPasswordSchema(14),
  fullName: z.string().trim().min(2).max(160),
  secretKey: z.string().min(1).max(512),
})

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

adminAuthRouter.get('/registration-status', async (_request, response) => {
  if (!env.ADMIN_SIGNUP_SECRET) {
    response.json({ data: { available: false } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is not configured.' } })
    return
  }
  response.json({ data: { available: true } })
})

adminAuthRouter.post('/register', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  if (!env.ADMIN_SIGNUP_SECRET) return response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Administrator setup is not available.' } })
  const input = registerSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Check the administrator account details. Passwords must be at least 14 characters.' } })
  if (!matchesAdminSignupSecret(input.data.secretKey)) return response.status(403).json({ error: { code: 'INVALID_ADMIN_SETUP_KEY', message: 'Administrator setup key is invalid.' } })
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is not configured.' } })

  const passwordHash = await hash(input.data.password, 12)
  const verificationToken = randomBytes(32).toString('base64url')
  const registration = await adminDb.transaction(async (transaction) => {
    const [existingUser] = await transaction.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, input.data.email)).limit(1)
    if (existingUser) return 'email-unavailable' as const
    const [created] = await transaction.insert(adminUsers).values({
      email: input.data.email,
      fullName: input.data.fullName,
      passwordHash,
      role: 'sales_admin',
      roleNumber: await allocateAdministratorRoleNumber(transaction, 'sales_admin'),
      status: 'pending',
    }).returning({ id: adminUsers.id })
    await transaction.insert(adminVerificationTokens).values({ adminUserId: created.id, tokenHash: hashToken(verificationToken), expiresAt: new Date(Date.now() + 30 * 60_000) })
    await transaction.insert(adminAuditLogs).values({ adminUserId: created.id, action: 'sales_administrator.registered', targetType: 'admin_user', targetId: String(created.id) })
    return 'created' as const
  })
  if (registration === 'email-unavailable') return response.status(409).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Unable to create an administrator account with those details.' } })
  response.status(201).json({ data: { verificationUrl: `/admin/verify?token=${encodeURIComponent(verificationToken)}`, expiresInMinutes: 30 } })
})

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
    }).from(adminVerificationTokens)
      .where(and(
        eq(adminVerificationTokens.tokenHash, hashToken(input.data.token)),
        gt(adminVerificationTokens.expiresAt, now),
      )).limit(1).for('update')
    if (!record) return false
    if (record.consumedAt) {
      const [admin] = await transaction.select({ emailVerifiedAt: adminUsers.emailVerifiedAt })
        .from(adminUsers).where(eq(adminUsers.id, record.adminUserId)).limit(1)
      return Boolean(admin?.emailVerifiedAt)
    }
    const consumed = await transaction.update(adminVerificationTokens).set({ consumedAt: now })
      .where(and(
        eq(adminVerificationTokens.id, record.id),
        gt(adminVerificationTokens.expiresAt, now),
        isNull(adminVerificationTokens.consumedAt),
      )).returning({ id: adminVerificationTokens.id })
    if (consumed.length !== 1) return false
    await transaction.update(adminUsers).set({ emailVerifiedAt: now, status: 'active' })
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
  const passwordMatches = await verifyPassword(input.data.password, admin?.passwordHash)
  if (!admin || !passwordMatches) {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, success: false, failureCode: 'INVALID_CREDENTIALS' })
    response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: invalidAdminCredentialsMessage } })
    return
  }
  if (admin.status === 'suspended' || admin.status === 'disabled') {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'ACCOUNT_SUSPENDED' })
    response.status(403).json({ error: { code: 'ADMIN_ACCOUNT_SUSPENDED', message: 'This administrator account is suspended or disabled.' } })
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
  const requiredRole = requiredAdministratorRole(request.path, input.data.expectedRole)
  if (requiredRole && requiredRole !== admin.role) {
    await adminDb.insert(adminLoginAttempts).values({ identity: normalizedIdentity, adminUserId: admin.id, success: false, failureCode: 'PORTAL_ROLE_MISMATCH' })
    response.status(403).json({ error: { code: 'PORTAL_ROLE_MISMATCH', message: 'These credentials do not belong to this administrator portal.' } })
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

adminAuthRouter.get('/me', authenticateAdmin, async (request, response) => {
  const admin = authenticatedAdmin(request)
  if (!admin) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  response.json({ data: { user: admin, portal: admin.role && admin.status === 'active' ? administratorPortal(admin.role as Parameters<typeof administratorPortal>[0]) : null } })
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
