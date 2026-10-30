import { createHash } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import type { Request, RequestHandler } from 'express'
import { adminDb, db } from '../config/database.js'
import { adminSessions, adminUsers } from '../database/admin-schema.js'
import { roles, userRoles, userSessions, users } from '../database/schema.js'
import { adminSessionAbsoluteLifetimeMs, adminSessionIdleTimeoutMs, customerSessionAbsoluteLifetimeMs, customerSessionIdleTimeoutMs, nextSessionExpiry } from '../config/session-policy.js'

type AuthenticatedRequest = Request & {
  auth?: { userId: number; email: string; fullName: string; roles: string[] }
  admin?: { id: number; email: string; fullName: string }
}

function sessionToken(request: Request) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('kc_session='))
  if (!cookie) return null
  try { return decodeURIComponent(cookie.slice('kc_session='.length)) } catch { return null }
}

function adminSessionToken(request: Request) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('kc_admin_session='))
  if (!cookie) return null
  try { return decodeURIComponent(cookie.slice('kc_admin_session='.length)) } catch { return null }
}

export const authenticate: RequestHandler = async (request, response, next) => {
  const token = sessionToken(request)
  if (!token) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const now = new Date()
  const [session] = await db.select({ id: userSessions.id, userId: userSessions.userId, createdAt: userSessions.createdAt, expiresAt: userSessions.expiresAt }).from(userSessions)
    .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, now))).limit(1)
  if (!session) {
    response.clearCookie('kc_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1' })
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const renewedExpiry = nextSessionExpiry(session.createdAt, now, customerSessionIdleTimeoutMs, customerSessionAbsoluteLifetimeMs)
  if (!renewedExpiry) {
    await db.delete(userSessions).where(eq(userSessions.id, session.id))
    response.clearCookie('kc_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1' })
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [user] = await db.select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const assignedRoles = await db.select({ key: roles.key }).from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id)).where(eq(userRoles.userId, user.id))
  ;(request as AuthenticatedRequest).auth = { userId: user.id, email: user.email, fullName: user.fullName, roles: assignedRoles.map(({ key }) => key) }
  next()
}

export function requireRole(role: string): RequestHandler {
  return (request, response, next) => {
    const auth = (request as AuthenticatedRequest).auth
    if (!auth?.roles.includes(role)) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' } })
      return
    }
    next()
  }
}

export function authenticatedUser(request: Request) {
  return (request as AuthenticatedRequest).auth
}

export const authenticateAdmin: RequestHandler = async (request, response, next) => {
  const token = adminSessionToken(request)
  if (!token) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is not configured.' } })
    return
  }
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const now = new Date()
  const [session] = await adminDb.select({ id: adminSessions.id, adminUserId: adminSessions.adminUserId, createdAt: adminSessions.createdAt, expiresAt: adminSessions.expiresAt }).from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, tokenHash), gt(adminSessions.expiresAt, now))).limit(1)
  if (!session) {
    response.clearCookie('kc_admin_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/admin' })
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  const renewedExpiry = nextSessionExpiry(session.createdAt, now, adminSessionIdleTimeoutMs, adminSessionAbsoluteLifetimeMs)
  if (!renewedExpiry) {
    await adminDb.delete(adminSessions).where(eq(adminSessions.id, session.id))
    response.clearCookie('kc_admin_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1/admin' })
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
    return
  }
  const [admin] = await adminDb.select({
    id: adminUsers.id,
    email: adminUsers.email,
    fullName: adminUsers.fullName,
  }).from(adminUsers).where(eq(adminUsers.id, session.adminUserId)).limit(1)
  if (!admin) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator account is unavailable.' } })
    return
  }
  ;(request as AuthenticatedRequest).admin = admin
  next()
}

export function authenticatedAdmin(request: Request) {
  return (request as AuthenticatedRequest).admin
}