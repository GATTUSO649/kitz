import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminInvitations, marketplaceAdminSessions, marketplaceAdminUsers, marketplaceAdminVerificationTokens, marketplaceAuditLogs } from '../../database/schema.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { hashSecret } from '../marketplace/security.js'

export type MarketplaceAdminRole = 'super_admin' | 'second_hand_admin' | 'seller_support_admin' | 'marketplace_finance_admin' | 'marketplace_moderator'
export type MarketplacePermission = 'dashboard:read' | 'listings:read' | 'listings:manage' | 'moderation:manage' | 'categories:manage' | 'finance:read' | 'support:manage' | 'settings:manage' | 'admins:manage'

const cookieName = 'mh_marketplace_admin'
const kitzPermissionByMarketplacePermission: Record<MarketplacePermission, string> = {
  'dashboard:read': 'marketplace.dashboard.read',
  'listings:read': 'marketplace.listings.read',
  'listings:manage': 'marketplace.listings.manage',
  'moderation:manage': 'marketplace.moderation.manage',
  'categories:manage': 'marketplace.categories.manage',
  'finance:read': 'marketplace.finance.read',
  'support:manage': 'marketplace.support.manage',
  'settings:manage': 'marketplace.settings.manage',
  'admins:manage': 'administrators.manage',
}

export type MarketplaceAdminSession = { id: string; kitzAdminId: number; email: string; role: MarketplaceAdminRole; permissions: MarketplacePermission[] }

const kitzAdminRoleSchema = z.enum(['super_admin', 'second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator'])
const kitzAdminSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  fullName: z.string().min(1),
  role: kitzAdminRoleSchema,
  emailVerifiedAt: z.string().datetime(),
  permissions: z.array(z.string()),
})
type KitzAdmin = z.infer<typeof kitzAdminSchema>

function getKitzServiceConfig() {
  const authValue = process.env.KITCULTURE_MARKETPLACE_AUTH_URL
  const authorizeValue = process.env.KITCULTURE_MARKETPLACE_AUTHORIZE_URL
  const serviceToken = process.env.KITCULTURE_MARKETPLACE_SERVICE_TOKEN
  if (!authValue || !authorizeValue || !serviceToken) return null
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(serviceToken)) throw new Error('Kitz marketplace service token configuration is invalid.')
  const authUrl = new URL(authValue)
  const authorizeUrl = new URL(authorizeValue)
  const secureRequired = process.env.NODE_ENV === 'production'
  if (authUrl.pathname !== '/api/v1/admin/marketplace/authenticate'
    || authorizeUrl.pathname !== '/api/v1/admin/marketplace/authorize'
    || authUrl.origin !== authorizeUrl.origin
    || authUrl.username || authUrl.password || authUrl.search || authUrl.hash
    || authorizeUrl.username || authorizeUrl.password || authorizeUrl.search || authorizeUrl.hash
    || (secureRequired && (authUrl.protocol !== 'https:' || authorizeUrl.protocol !== 'https:'))) {
    throw new Error('Kitz marketplace service URLs are invalid.')
  }
  return { authUrl: authUrl.toString(), authorizeUrl: authorizeUrl.toString(), serviceToken, originToken: process.env.KITCULTURE_ORIGIN_AUTH_TOKEN }
}

export function getKitzAdminServiceStatus(): { configured: boolean; code: string | null } {
  try {
    const configured = getKitzServiceConfig() !== null
    return { configured, code: configured ? null : 'KITCULTURE_ADMIN_AUTH_NOT_CONFIGURED' }
  } catch {
    return { configured: false, code: 'KITCULTURE_ADMIN_AUTH_CONFIG_INVALID' }
  }
}

async function postKitz(url: string, body: Record<string, unknown>) {
  const config = getKitzServiceConfig()
  if (!config) throw new Error('Kitz administrator authentication is not configured.')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MarketHub-Service-Token': config.serviceToken,
      ...(config.originToken ? { 'X-KitCulture-Origin-Auth': config.originToken } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const payload = await response.json().catch(() => null) as { data?: unknown } | null
  return { status: response.status, data: payload?.data }
}

async function authenticateKitzAdmin(email: string, password: string): Promise<KitzAdmin | null> {
  const result = await postKitz(getKitzServiceConfig()?.authUrl ?? '', { email, password })
  if (result.status === 401) return null
  if (result.status !== 200) throw new Error('Kitz administrator authentication is unavailable.')
  const parsed = kitzAdminSchema.safeParse(result.data)
  if (!parsed.success) throw new Error('Kitz administrator authentication returned an invalid response.')
  return parsed.data
}

async function authorizeKitzAdmin(adminId: number, permission: MarketplacePermission) {
  const result = await postKitz(getKitzServiceConfig()?.authorizeUrl ?? '', { adminId, permission: kitzPermissionByMarketplacePermission[permission] })
  if (result.status !== 200 || !result.data || typeof result.data !== 'object') throw new Error('Kitz administrator authorization is unavailable.')
  const value = result.data as { authorized?: unknown; accountActive?: unknown; id?: unknown; email?: unknown; fullName?: unknown; role?: unknown; permissions?: unknown }
  if (typeof value.authorized !== 'boolean' || typeof value.accountActive !== 'boolean') throw new Error('Kitz administrator authorization returned an invalid response.')
  if (!value.accountActive) return { authorized: false, accountActive: false, admin: null }
  const parsed = z.object({ id: z.number().int().positive(), email: z.string().email(), fullName: z.string().min(1), role: kitzAdminRoleSchema, permissions: z.array(z.string()) }).safeParse(value)
  if (!parsed.success) throw new Error('Kitz administrator authorization returned an invalid response.')
  return { authorized: value.authorized, accountActive: true, admin: parsed.data, permissions: marketplacePermissions(parsed.data.permissions) }
}

function marketplacePermissions(permissions: readonly string[]): MarketplacePermission[] {
  return (Object.entries(kitzPermissionByMarketplacePermission) as [MarketplacePermission, string][])
    .filter(([, kitzPermission]) => permissions.includes(kitzPermission))
    .map(([permission]) => permission)
}

export const marketplaceAdminRouter = Router()
marketplaceAdminRouter.use(['/admins/invitations', '/invitations/activate', '/invitations/verify'], (_request, response) => {
  response.status(410).json({ error: { code: 'CENTRAL_ADMIN_MANAGEMENT_REQUIRED', message: 'Marketplace administrators are invited and verified through KitCulture Super Admin.' } })
})
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const activationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const verificationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) })
const tokenHash = (token: string) => hashSecret(token)

marketplaceAdminRouter.post('/admins/invitations', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_MARKETPLACE_ADMIN_INVITATION', message: 'Enter a valid name and email address.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  try {
    const rawToken = randomBytes(32).toString('base64url')
    const adminId = await database.transaction(async (transaction) => {
      const [created] = await transaction.insert(marketplaceAdminUsers).values({
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 12),
        role: 'product_admin',
        active: false,
      }).returning({ id: marketplaceAdminUsers.id })
      if (!created) throw new Error('Second-hand admin account was not created.')
      await transaction.insert(marketplaceAdminInvitations).values({ adminUserId: created.id, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 72 * 60 * 60_000) })
      const origin = process.env.PLATFORM_ORIGIN || 'http://127.0.0.1:5173'
      const url = new URL('/admin/marketplace/activate', origin)
      url.searchParams.set('token', rawToken)
      await enqueueMarketplaceEmail(transaction, {
        eventKey: `marketplace-admin:${created.id}:invitation`,
        to: parsed.data.email,
        kind: 'marketplace_admin_invitation',
        data: { name: parsed.data.fullName, actionUrl: url.toString() },
      })
      return created.id
    })
    response.status(202).json({ data: { id: adminId, role: 'product_admin', verificationRequired: true } })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: { code: 'MARKETPLACE_ADMIN_EMAIL_EXISTS', message: 'A marketplace administrator already uses this email.' } })
      return
    }
    next(error)
  }
})

marketplaceAdminRouter.post('/invitations/activate', activationLimiter, async (request, response, next) => {
  const parsed = z.object({ token: z.string().min(32).max(128), password: z.string().min(12).max(128), confirmPassword: z.string() })
    .strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' }).safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_MARKETPLACE_ADMIN_ACTIVATION', message: 'Check the invitation and password details.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const rawVerificationToken = randomBytes(32).toString('base64url')
    const passwordSet = await database.transaction(async (transaction) => {
      const [invitation] = await transaction.select({ id: marketplaceAdminInvitations.id, adminUserId: marketplaceAdminInvitations.adminUserId, expiresAt: marketplaceAdminInvitations.expiresAt, consumedAt: marketplaceAdminInvitations.consumedAt, role: marketplaceAdminUsers.role, active: marketplaceAdminUsers.active })
        .from(marketplaceAdminInvitations).innerJoin(marketplaceAdminUsers, eq(marketplaceAdminInvitations.adminUserId, marketplaceAdminUsers.id))
        .where(eq(marketplaceAdminInvitations.tokenHash, tokenHash(parsed.data.token))).for('update').limit(1)
      if (!invitation || invitation.consumedAt || invitation.active || invitation.role !== 'product_admin' || invitation.expiresAt.getTime() <= Date.now()) return false
      const [consumed] = await transaction.update(marketplaceAdminInvitations).set({ consumedAt: new Date() })
        .where(and(eq(marketplaceAdminInvitations.id, invitation.id), isNull(marketplaceAdminInvitations.consumedAt))).returning({ id: marketplaceAdminInvitations.id })
      if (!consumed) return false
      const updatedAt = new Date()
      await transaction.update(marketplaceAdminUsers).set({ passwordHash, updatedAt }).where(eq(marketplaceAdminUsers.id, invitation.adminUserId))
      await transaction.insert(marketplaceAdminVerificationTokens).values({ adminUserId: invitation.adminUserId, tokenHash: tokenHash(rawVerificationToken), expiresAt: new Date(Date.now() + 60 * 60_000) })
      const [admin] = await transaction.select({ email: marketplaceAdminUsers.email, fullName: marketplaceAdminUsers.fullName }).from(marketplaceAdminUsers).where(eq(marketplaceAdminUsers.id, invitation.adminUserId)).limit(1)
      if (!admin) return false
      const origin = process.env.PLATFORM_ORIGIN || 'http://127.0.0.1:5173'
      const url = new URL('/admin/marketplace/verify', origin)
      url.searchParams.set('token', rawVerificationToken)
      await enqueueMarketplaceEmail(transaction, {
        eventKey: `marketplace-admin:${invitation.adminUserId}:verify:${Date.now()}`,
        to: admin.email,
        kind: 'marketplace_admin_verification',
        data: { name: admin.fullName, actionUrl: url.toString() },
      })
      await transaction.insert(marketplaceAuditLogs).values({ action: 'admin.invitation_password_set', resourceType: 'admin_user', resourceId: invitation.adminUserId })
      return true
    })
    if (!passwordSet) {
      response.status(400).json({ error: { code: 'INVALID_MARKETPLACE_ADMIN_ACTIVATION', message: 'The invitation is invalid, expired, or already used.' } })
      return
    }
    response.json({ data: { passwordSet: true, verificationRequired: true } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminRouter.post('/invitations/verify', verificationLimiter, async (request, response, next) => {
  const parsed = z.object({ token: z.string().min(32).max(128) }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_MARKETPLACE_ADMIN_VERIFICATION', message: 'The verification link is invalid or expired.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  try {
    const verified = await database.transaction(async (transaction) => {
      const [verification] = await transaction.select({ id: marketplaceAdminVerificationTokens.id, adminUserId: marketplaceAdminVerificationTokens.adminUserId, expiresAt: marketplaceAdminVerificationTokens.expiresAt, consumedAt: marketplaceAdminVerificationTokens.consumedAt, role: marketplaceAdminUsers.role, active: marketplaceAdminUsers.active })
        .from(marketplaceAdminVerificationTokens).innerJoin(marketplaceAdminUsers, eq(marketplaceAdminVerificationTokens.adminUserId, marketplaceAdminUsers.id))
        .where(eq(marketplaceAdminVerificationTokens.tokenHash, tokenHash(parsed.data.token))).for('update').limit(1)
      if (!verification || verification.consumedAt || verification.active || verification.role !== 'product_admin' || verification.expiresAt.getTime() <= Date.now()) return false
      const [consumed] = await transaction.update(marketplaceAdminVerificationTokens).set({ consumedAt: new Date() })
        .where(and(eq(marketplaceAdminVerificationTokens.id, verification.id), isNull(marketplaceAdminVerificationTokens.consumedAt))).returning({ id: marketplaceAdminVerificationTokens.id })
      if (!consumed) return false
      const verifiedAt = new Date()
      await transaction.update(marketplaceAdminUsers).set({ active: true, emailVerifiedAt: verifiedAt, updatedAt: verifiedAt }).where(eq(marketplaceAdminUsers.id, verification.adminUserId))
      await transaction.insert(marketplaceAuditLogs).values({ action: 'admin.invitation_verified', resourceType: 'admin_user', resourceId: verification.adminUserId })
      return true
    })
    if (!verified) {
      response.status(400).json({ error: { code: 'INVALID_MARKETPLACE_ADMIN_VERIFICATION', message: 'The verification link is invalid, expired, or already used.' } })
      return
    }
    response.json({ data: { verified: true, loginPath: '/admin/marketplace/login' } })
  } catch (error) {
    next(error)
  }
})

function readSessionToken(request: Request): string | null {
  const cookie = request.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
  const value = cookie?.slice(cookieName.length + 1)
  return value && /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null
}

function sessionCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${cookieName}=${token}; Path=/api/v1/admin/marketplace; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`
}

export function requireMarketplacePermission(permission: MarketplacePermission | readonly MarketplacePermission[]) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!database) {
      response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
      return
    }
    const token = readSessionToken(request)
    if (!token) {
      response.status(401).json({ error: { code: 'ADMIN_UNAUTHENTICATED', message: 'Sign in to continue.' } })
      return
    }
    try {
      const requiredPermissions = typeof permission === 'string' ? [permission] : permission
      const firstRequiredPermission = requiredPermissions[0]
      if (!firstRequiredPermission) {
        response.status(403).json({ error: { code: 'ADMIN_FORBIDDEN', message: 'You do not have permission to perform this action.' } })
        return
      }
      const [session] = await database.select({ id: marketplaceAdminUsers.id, kitzAdminId: marketplaceAdminUsers.kitzAdminId })
        .from(marketplaceAdminSessions)
        .innerJoin(marketplaceAdminUsers, eq(marketplaceAdminSessions.adminUserId, marketplaceAdminUsers.id))
        .where(and(eq(marketplaceAdminSessions.tokenHash, hashSecret(token)), gt(marketplaceAdminSessions.expiresAt, new Date()), eq(marketplaceAdminUsers.active, true)))
        .limit(1)
      if (!session?.kitzAdminId) {
        response.status(401).json({ error: { code: 'ADMIN_UNAUTHENTICATED', message: 'Sign in to continue.' } })
        return
      }
      const authorization = await authorizeKitzAdmin(session.kitzAdminId, firstRequiredPermission)
      if (!authorization.accountActive || !authorization.admin) {
        response.status(401).json({ error: { code: 'ADMIN_UNAUTHENTICATED', message: 'Sign in to continue.' } })
        return
      }
      if (!authorization.permissions.some((candidate) => requiredPermissions.includes(candidate))) {
        response.status(403).json({ error: { code: 'ADMIN_FORBIDDEN', message: 'You do not have permission to perform this action.' } })
        return
      }
      response.locals.marketplaceAdmin = { ...authorization.admin, id: session.id, kitzAdminId: session.kitzAdminId, permissions: authorization.permissions } satisfies MarketplaceAdminSession
      next()
    } catch {
      response.status(503).json({ error: { code: 'CENTRAL_ADMIN_AUTH_UNAVAILABLE', message: 'Administrator access could not be verified.' } })
    }
  }
}

marketplaceAdminRouter.post('/login', loginLimiter, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Enter a valid email address and password.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  try {
    let centralAdmin: KitzAdmin | null
    try {
      centralAdmin = await authenticateKitzAdmin(parsed.data.email.toLowerCase(), parsed.data.password)
    } catch {
      response.status(503).json({ error: { code: 'CENTRAL_ADMIN_AUTH_UNAVAILABLE', message: 'Administrator sign in is temporarily unavailable.' } })
      return
    }
    if (!centralAdmin) {
      response.status(401).json({ error: { code: 'ADMIN_INVALID_LOGIN', message: 'Email or password is incorrect.' } })
      return
    }
    const marketplaceAdminId = await database.transaction(async (transaction) => {
      const [linkedAdmin] = await transaction.select({ id: marketplaceAdminUsers.id, kitzAdminId: marketplaceAdminUsers.kitzAdminId })
        .from(marketplaceAdminUsers).where(eq(marketplaceAdminUsers.kitzAdminId, centralAdmin.id)).limit(1)
      const [emailAdmin] = linkedAdmin ? [] : await transaction.select({ id: marketplaceAdminUsers.id, kitzAdminId: marketplaceAdminUsers.kitzAdminId })
        .from(marketplaceAdminUsers).where(eq(marketplaceAdminUsers.email, centralAdmin.email)).limit(1)
      const existing = linkedAdmin ?? emailAdmin
      if (existing?.kitzAdminId && existing.kitzAdminId !== centralAdmin.id) throw new Error('The marketplace administrator identity link conflicts.')
      const now = new Date()
      if (existing) {
        await transaction.update(marketplaceAdminUsers).set({
          kitzAdminId: centralAdmin.id,
          email: centralAdmin.email,
          fullName: centralAdmin.fullName,
          role: centralAdmin.role,
          active: true,
          emailVerifiedAt: new Date(centralAdmin.emailVerifiedAt),
          updatedAt: now,
        }).where(eq(marketplaceAdminUsers.id, existing.id))
        return existing.id
      }
      const [created] = await transaction.insert(marketplaceAdminUsers).values({
        kitzAdminId: centralAdmin.id,
        email: centralAdmin.email,
        fullName: centralAdmin.fullName,
        passwordHash: await bcrypt.hash(randomBytes(32).toString('base64url'), 12),
        role: centralAdmin.role,
        active: true,
        emailVerifiedAt: new Date(centralAdmin.emailVerifiedAt),
      }).returning({ id: marketplaceAdminUsers.id })
      if (!created) throw new Error('Marketplace admin session identity could not be created.')
      return created.id
    })
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
    await database.transaction(async (transaction) => {
      await transaction.insert(marketplaceAdminSessions).values({ adminUserId: marketplaceAdminId, tokenHash: hashSecret(token), expiresAt })
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: marketplaceAdminId, action: 'admin.login', resourceType: 'admin_user', resourceId: String(centralAdmin.id), metadata: { kitzAdminId: centralAdmin.id } })
    })
    response.setHeader('Set-Cookie', sessionCookie(token, expiresAt))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: { id: marketplaceAdminId, kitzAdminId: centralAdmin.id, email: centralAdmin.email, role: centralAdmin.role, permissions: marketplacePermissions(centralAdmin.permissions), expiresAt: expiresAt.toISOString() } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminRouter.get('/session', requireMarketplacePermission('dashboard:read'), (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: response.locals.marketplaceAdmin })
})

marketplaceAdminRouter.post('/logout', async (request, response, next) => {
  const token = readSessionToken(request)
  if (token && database) {
    try {
      const [session] = await database.select({ adminUserId: marketplaceAdminSessions.adminUserId }).from(marketplaceAdminSessions)
        .where(eq(marketplaceAdminSessions.tokenHash, hashSecret(token))).limit(1)
      await database.delete(marketplaceAdminSessions).where(eq(marketplaceAdminSessions.tokenHash, hashSecret(token)))
      if (session) await database.insert(marketplaceAuditLogs).values({ adminUserId: session.adminUserId, action: 'admin.logout', resourceType: 'admin_user', resourceId: session.adminUserId })
    } catch (error) {
      next(error)
      return
    }
  }
  response.setHeader('Set-Cookie', `${cookieName}=; Path=/api/v1/admin/marketplace; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
  response.json({ data: { signedOut: true } })
})
