import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { adminDb } from '../../config/database.js'
import { bcryptPasswordSchema } from '../../config/password-policy.js'
import { adminAuditLogs, adminSessions, adminSetupLocks, adminUsers, adminVerificationTokens } from '../../database/admin-schema.js'
import { authenticatedAdmin } from '../../middleware/authenticate.js'
import { authenticateAdmin } from '../../middleware/authenticate.js'

export const adminAuthRouter = Router()
const cookieName = 'kc_admin_session'
export const adminIdleTimeoutMs = 3 * 60_000
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
})
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
  const [admin] = await adminDb.select({ id: adminUsers.id }).from(adminUsers).limit(1)
  response.json({ data: { available: !admin } })
})

adminAuthRouter.post('/register', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  if (!env.ADMIN_SIGNUP_SECRET) {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Administrator setup is not available.' } })
    return
  }
  const input = registerSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Check the administrator account details. Passwords must be at least 14 characters.' } })
    return
  }
  if (!matchesAdminSignupSecret(input.data.secretKey)) {
    response.status(403).json({ error: { code: 'INVALID_ADMIN_SETUP_KEY', message: 'Administrator setup key is invalid.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is not configured.' } })
    return
  }

  const passwordHash = await hash(input.data.password, 12)
  const verificationToken = randomBytes(32).toString('base64url')
  const registration = await adminDb.transaction(async (transaction) => {
    await transaction.insert(adminSetupLocks).values({ id: 1, purpose: 'first-admin-bootstrap' })
      .onDuplicateKeyUpdate({ set: { purpose: 'first-admin-bootstrap' } })
    await transaction.select({ id: adminSetupLocks.id }).from(adminSetupLocks)
      .where(eq(adminSetupLocks.id, 1)).for('update')
    const [existingAdmin] = await transaction.select({ id: adminUsers.id }).from(adminUsers).limit(1)
    if (existingAdmin) return 'already-configured' as const

    const [existingUser] = await transaction.select({ id: adminUsers.id }).from(adminUsers)
      .where(eq(adminUsers.email, input.data.email)).limit(1)
    if (existingUser) return 'email-unavailable' as const

    const [created] = await transaction.insert(adminUsers).values({
      email: input.data.email,
      fullName: input.data.fullName,
      passwordHash,
    }).$returningId()
    await transaction.insert(adminVerificationTokens).values({
      adminUserId: created.id,
      tokenHash: hashToken(verificationToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })
    return 'created' as const
  })
  if (registration === 'already-configured') {
    response.status(409).json({ error: { code: 'ADMIN_ALREADY_CONFIGURED', message: 'An administrator account already exists. Sign in instead.' } })
    return
  }
  if (registration === 'email-unavailable') {
    response.status(409).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Unable to create an administrator account with those details.' } })
    return
  }
  response.status(201).json({
    data: {
      verificationUrl: `/admin/verify?token=${encodeURIComponent(verificationToken)}`,
      expiresInMinutes: 30,
    },
  })
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
    const [consumed] = await transaction.update(adminVerificationTokens).set({ consumedAt: now })
      .where(and(
        eq(adminVerificationTokens.id, record.id),
        gt(adminVerificationTokens.expiresAt, now),
        isNull(adminVerificationTokens.consumedAt),
      ))
    if (consumed.affectedRows !== 1) return false
    await transaction.update(adminUsers).set({ emailVerifiedAt: now })
      .where(eq(adminUsers.id, record.adminUserId))
    return true
  })
  if (!verification) {
    response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'The verification link is invalid, expired, or already used.' } })
    return
  }
  response.json({ data: { verified: true } })
})

adminAuthRouter.post('/login', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = loginSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email or password is invalid.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator database is not configured.' } })
    return
  }
  const [admin] = await adminDb.select({
    id: adminUsers.id,
    email: adminUsers.email,
    fullName: adminUsers.fullName,
    passwordHash: adminUsers.passwordHash,
    emailVerifiedAt: adminUsers.emailVerifiedAt,
  }).from(adminUsers).where(eq(adminUsers.email, input.data.email)).limit(1)
  if (!admin || !(await compare(input.data.password, admin.passwordHash))) {
    response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is invalid.' } })
    return
  }
  if (!admin.emailVerifiedAt) {
    response.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify the administrator email before signing in.' } })
    return
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + adminIdleTimeoutMs)
  await adminDb.insert(adminSessions).values({
    adminUserId: admin.id,
    tokenHash: hashToken(token),
    expiresAt,
  })
  setAdminSessionCookie(response, token)
  await adminDb.insert(adminAuditLogs).values({
    adminUserId: admin.id,
    action: 'admin.login',
    targetType: 'admin_user',
    targetId: String(admin.id),
  })
  response.json({ data: { user: { id: admin.id, email: admin.email, fullName: admin.fullName } } })
})

adminAuthRouter.get('/me', async (request, response) => {
  const admin = authenticatedAdmin(request)
  if (!admin) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  response.json({ data: { user: admin } })
})

adminAuthRouter.post('/session/activity', rejectCrossOrigin, authenticateAdmin, async (request, response) => {
  const token = cookieToken(request.headers.cookie)
  if (!token || !adminDb) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  const now = new Date()
  const [refreshed] = await adminDb.update(adminSessions).set({
    expiresAt: new Date(now.getTime() + adminIdleTimeoutMs),
  }).where(and(
    eq(adminSessions.tokenHash, hashToken(token)),
    gt(adminSessions.expiresAt, now),
  ))
  if (refreshed.affectedRows !== 1) {
    response.clearCookie(cookieName, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/admin' })
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  setAdminSessionCookie(response, token)
  response.status(204).end()
})

adminAuthRouter.post('/logout', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const token = cookieToken(request.headers.cookie)
  if (token && adminDb) {
    await adminDb.delete(adminSessions).where(and(
      eq(adminSessions.tokenHash, hashToken(token)),
      gt(adminSessions.expiresAt, new Date()),
    ))
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
