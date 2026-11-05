import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, eq, gt } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminSessions, marketplaceAdminUsers, marketplaceAuditLogs } from '../../database/schema.js'
import { hashSecret } from '../marketplace/security.js'

export type MarketplaceAdminRole = 'super_admin' | 'product_admin' | 'finance_admin' | 'support_admin'
export type MarketplacePermission = 'dashboard:read' | 'listings:manage' | 'categories:manage' | 'finance:read' | 'support:manage' | 'settings:manage' | 'admins:manage'

const cookieName = 'mh_marketplace_admin'
const rolePermissions: Record<MarketplaceAdminRole, MarketplacePermission[]> = {
  super_admin: ['dashboard:read', 'listings:manage', 'categories:manage', 'finance:read', 'support:manage', 'settings:manage', 'admins:manage'],
  product_admin: ['dashboard:read', 'listings:manage', 'categories:manage', 'support:manage'],
  finance_admin: ['dashboard:read', 'finance:read'],
  support_admin: ['dashboard:read', 'support:manage'],
}

export type MarketplaceAdminSession = { id: string; email: string; role: MarketplaceAdminRole }

export const marketplaceAdminRouter = Router()
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) })

function readSessionToken(request: Request): string | null {
  const cookie = request.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
  const value = cookie?.slice(cookieName.length + 1)
  return value && /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null
}

function sessionCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${cookieName}=${token}; Path=/api/v1/admin/marketplace; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`
}

export function requireMarketplacePermission(permission: MarketplacePermission) {
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
      const [session] = await database.select({ id: marketplaceAdminUsers.id, email: marketplaceAdminUsers.email, role: marketplaceAdminUsers.role })
        .from(marketplaceAdminSessions)
        .innerJoin(marketplaceAdminUsers, eq(marketplaceAdminSessions.adminUserId, marketplaceAdminUsers.id))
        .where(and(eq(marketplaceAdminSessions.tokenHash, hashSecret(token)), gt(marketplaceAdminSessions.expiresAt, new Date()), eq(marketplaceAdminUsers.active, true)))
        .limit(1)
      if (!session) {
        response.status(401).json({ error: { code: 'ADMIN_UNAUTHENTICATED', message: 'Sign in to continue.' } })
        return
      }
      if (!(session.role in rolePermissions) || !rolePermissions[session.role as MarketplaceAdminRole].includes(permission)) {
        response.status(403).json({ error: { code: 'ADMIN_FORBIDDEN', message: 'You do not have permission to perform this action.' } })
        return
      }
      response.locals.marketplaceAdmin = session as MarketplaceAdminSession
      next()
    } catch (error) {
      next(error)
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
    const email = parsed.data.email.toLowerCase()
    const [admin] = await database.select({ id: marketplaceAdminUsers.id, email: marketplaceAdminUsers.email, passwordHash: marketplaceAdminUsers.passwordHash, role: marketplaceAdminUsers.role, active: marketplaceAdminUsers.active })
      .from(marketplaceAdminUsers).where(eq(marketplaceAdminUsers.email, email)).limit(1)
    const validPassword = admin ? await bcrypt.compare(parsed.data.password, admin.passwordHash) : false
    if (!admin || !admin.active || !validPassword || !(admin.role in rolePermissions)) {
      response.status(401).json({ error: { code: 'ADMIN_INVALID_LOGIN', message: 'Email or password is incorrect.' } })
      return
    }
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000)
    await database.transaction(async (transaction) => {
      await transaction.insert(marketplaceAdminSessions).values({ adminUserId: admin.id, tokenHash: hashSecret(token), expiresAt })
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: admin.id, action: 'admin.login', resourceType: 'admin_user', resourceId: admin.id })
    })
    response.setHeader('Set-Cookie', sessionCookie(token, expiresAt))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: { id: admin.id, email: admin.email, role: admin.role, permissions: rolePermissions[admin.role as MarketplaceAdminRole], expiresAt: expiresAt.toISOString() } })
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
