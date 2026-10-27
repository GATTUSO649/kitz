import { createHash, randomBytes } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { db } from '../../config/database.js'
import { buildAbsoluteUrl, customerEmailTemplate, sendTransactionalEmail } from '../../config/email.js'
import { bcryptPasswordSchema } from '../../config/password-policy.js'
import { emailVerificationTokens, passwordResetTokens, userSessions, users } from '../../database/schema.js'

export const authRouter = Router()
const sessionCookie = 'kc_session'
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30

export const registerSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: bcryptPasswordSchema(8),
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

async function issueVerificationEmail(userId: number, email: string) {
  if (!db) return
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_MINUTES * 60_000)
  await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId))
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: digestToken(token),
    expiresAt,
  })
  const verificationUrl = buildAbsoluteUrl(`/verify-email?token=${encodeURIComponent(token)}`)
  await sendTransactionalEmail({
    to: email,
    subject: 'Verify your KitCulture account',
    text: `Verify your KitCulture account using this link: ${verificationUrl}`,
    html: customerEmailTemplate({
      title: 'Verify your KitCulture account',
      intro: 'Welcome to KitCulture. Please verify your email address so you can sign in securely and receive updates about your orders.',
      actionLabel: 'Verify email',
      actionUrl: verificationUrl,
      footer: 'If you did not create this account, you can safely ignore this message.',
    }),
    notificationType: 'email_verification',
    userId,
  })
}

async function issuePasswordResetEmail(userId: number, email: string) {
  if (!db) return
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000)
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId))
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: digestToken(token),
    expiresAt,
  })
  const resetUrl = buildAbsoluteUrl(`/reset-password?token=${encodeURIComponent(token)}`)
  await sendTransactionalEmail({
    to: email,
    subject: 'Reset your KitCulture password',
    text: `Reset your KitCulture password using this link: ${resetUrl}`,
    html: customerEmailTemplate({
      title: 'Reset your KitCulture password',
      intro: 'You recently requested a password reset. Use the secure link below to choose a new password.',
      actionLabel: 'Reset password',
      actionUrl: resetUrl,
      footer: 'If you did not request this reset, keep your current password and reach out to support.',
    }),
    notificationType: 'password_reset',
    userId,
  })
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

  if (env.EMAIL_PROVIDER !== 'disabled' && env.EMAIL_FROM && env.RESEND_API_KEY) {
    try {
      await issueVerificationEmail(result.id, result.email)
    } catch {
      // Email delivery is optional for registration flow, but verification tokens remain available.
    }
  }

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
  if (env.EMAIL_VERIFICATION_REQUIRED && !user.emailVerifiedAt) {
    response.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email address before signing in.' } })
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

authRouter.post('/request-verification', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }
  const [user] = await db.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.email, input.data.email)).limit(1)
  if (!user) {
    response.json({ data: { emailSent: false, alreadyVerified: false } })
    return
  }
  if (user.emailVerifiedAt) {
    response.json({ data: { emailSent: false, alreadyVerified: true } })
    return
  }

  try {
    await issueVerificationEmail(user.id, user.email)
  } catch {
    response.status(503).json({ error: { code: 'EMAIL_UNAVAILABLE', message: 'We could not send a verification email right now.' } })
    return
  }

  response.json({ data: { emailSent: true, alreadyVerified: false } })
})

authRouter.post('/verify-email', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = z.object({ token: z.string().trim().min(1) }).safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'The verification link is invalid or missing.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }

  const [tokenRecord] = await db.select({ id: emailVerificationTokens.id, userId: emailVerificationTokens.userId, expiresAt: emailVerificationTokens.expiresAt })
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.tokenHash, digestToken(input.data.token)), gt(emailVerificationTokens.expiresAt, new Date()), isNull(emailVerificationTokens.consumedAt)))
    .limit(1)

  if (!tokenRecord) {
    response.status(400).json({ error: { code: 'VERIFICATION_FAILED', message: 'This verification link has expired or is invalid.' } })
    return
  }

  await db.transaction(async (transaction) => {
    await transaction.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, tokenRecord.userId))
    await transaction.update(emailVerificationTokens).set({ consumedAt: new Date() }).where(eq(emailVerificationTokens.id, tokenRecord.id))
  })

  response.json({ data: { verified: true } })
})

authRouter.post('/forgot-password', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }

  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, input.data.email)).limit(1)
  if (user) {
    try {
      await issuePasswordResetEmail(user.id, user.email)
    } catch {
      response.status(503).json({ error: { code: 'EMAIL_UNAVAILABLE', message: 'We could not send a reset email right now.' } })
      return
    }
  }

  response.json({ data: { emailSent: true } })
})

authRouter.post('/reset-password', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const input = z.object({ token: z.string().trim().min(1), password: bcryptPasswordSchema(8) }).safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_RESET', message: 'Check the password and reset token details.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
    return
  }

  const [tokenRecord] = await db.select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, digestToken(input.data.token)), gt(passwordResetTokens.expiresAt, new Date()), isNull(passwordResetTokens.consumedAt)))
    .limit(1)

  if (!tokenRecord) {
    response.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This password reset link is invalid or expired.' } })
    return
  }

  const passwordHash = await hash(input.data.password, 12)
  await db.transaction(async (transaction) => {
    await transaction.update(users).set({ passwordHash }).where(eq(users.id, tokenRecord.userId))
    await transaction.delete(userSessions).where(eq(userSessions.userId, tokenRecord.userId))
    await transaction.update(passwordResetTokens).set({ consumedAt: new Date() }).where(eq(passwordResetTokens.id, tokenRecord.id))
  })

  response.json({ data: { passwordReset: true } })
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