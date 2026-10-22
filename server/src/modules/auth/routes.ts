import { createHash, randomBytes } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { and, eq, gt } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { db } from '../../config/database.js'
import { userSessions, users } from '../../database/schema.js'

export const authRouter = Router()
const sessionCookie = 'kc_session'
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30

export const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(20).optional(),
})
export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
})

function digestToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function readSessionCookie(cookieHeader?: string) {
  const value = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`))
  if (!value) return null
  try { return decodeURIComponent(value.slice(sessionCookie.length + 1)) } catch { return null }
}

function setSessionCookie(response: Parameters<Parameters<typeof authRouter.get>[1]>[1], token: string) {
  response.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1',
    maxAge: sessionDurationMs,
  })
}

function rejectCrossOrigin(request: Parameters<Parameters<typeof authRouter.post>[1]>[0], response: Parameters<Parameters<typeof authRouter.post>[1]>[1]) {
  if (!isAllowedClientOrigin(request.get('origin'))) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
    return true
  }
  return false
}

authRouter.post('/register', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = registerSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Check the supplied account details.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.data.email)).limit(1)
  if (existing) {
    response.status(409).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Unable to create an account with those details.' } })
    return
  }

  const passwordHash = await hash(input.data.password, 12)
  const result = await db.transaction(async (transaction) => {
    const [created] = await transaction.insert(users).values({
      email: input.data.email,
      passwordHash,
      fullName: input.data.fullName,
      phone: input.data.phone || null,
    }).$returningId()
    return { id: created.id, email: input.data.email, fullName: input.data.fullName }
  })
  response.status(201).json({ data: { user: result, emailVerified: false } })
})

authRouter.post('/login', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = loginSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email or password is invalid.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }

  const [user] = await db.select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, passwordHash: users.passwordHash, emailVerifiedAt: users.emailVerifiedAt })
    .from(users).where(eq(users.email, input.data.email)).limit(1)
  const passwordMatches = user ? await compare(input.data.password, user.passwordHash) : false
  if (!user || !passwordMatches) {
    response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is invalid.' } })
    return
  }

  const token = randomBytes(32).toString('base64url')
  await db.insert(userSessions).values({
    userId: user.id,
    tokenHash: digestToken(token),
    expiresAt: new Date(Date.now() + sessionDurationMs),
  })
  setSessionCookie(response, token)
  response.json({ data: { user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone }, emailVerified: Boolean(user.emailVerifiedAt) } })
})

authRouter.get('/me', async (request, response) => {
  const token = readSessionCookie(request.headers.cookie)
  if (!token) {
    response.json({ data: { user: null, emailVerified: false } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }
  const [session] = await db.select({ userId: userSessions.userId }).from(userSessions)
    .where(and(eq(userSessions.tokenHash, digestToken(token)), gt(userSessions.expiresAt, new Date()))).limit(1)
  if (!session) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [user] = await db.select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone, emailVerifiedAt: users.emailVerifiedAt })
    .from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  response.json({ data: { user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone }, emailVerified: Boolean(user.emailVerifiedAt) } })
})

authRouter.post('/logout', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const token = readSessionCookie(request.headers.cookie)
  if (token && db) await db.delete(userSessions).where(eq(userSessions.tokenHash, digestToken(token)))
  response.clearCookie(sessionCookie, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1' })
  response.status(204).end()
})