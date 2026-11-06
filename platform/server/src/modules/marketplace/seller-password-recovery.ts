import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, eq, isNull } from 'drizzle-orm'
import { rateLimit } from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAuditLogs, marketplaceSellerAccounts, marketplaceSellerPasswordResetTokens, marketplaceSellerSessions } from '../../database/schema.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { hashSecret } from './security.js'

const resetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })
const resetLifetimeMs = 60 * 60_000
const resetTokenHash = (token: string) => hashSecret(token)
const passwordSchema = z.string().min(12).max(128).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, { message: 'Use a password of no more than 72 UTF-8 bytes.' })

function resetUrl(token: string): string {
  const origin = process.env.PLATFORM_ORIGIN || 'http://127.0.0.1:5173'
  const url = new URL('/marketplace/seller/reset-password', origin)
  url.searchParams.set('token', token)
  return url.toString()
}

export const marketplaceSellerPasswordRecoveryRouter = Router()

marketplaceSellerPasswordRecoveryRouter.post('/seller/password/forgot', resetLimiter, async (request, response, next) => {
  const parsed = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_PASSWORD_RESET_REQUEST', message: 'Enter a valid email address.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller password recovery is temporarily unavailable.' } })
    return
  }
  try {
    const [account] = await database.select({ id: marketplaceSellerAccounts.id, emailVerifiedAt: marketplaceSellerAccounts.emailVerifiedAt, status: marketplaceSellerAccounts.status })
      .from(marketplaceSellerAccounts).where(eq(marketplaceSellerAccounts.email, parsed.data.email)).limit(1)
    if (account?.status === 'active' && account.emailVerifiedAt) {
      const rawToken = randomBytes(32).toString('base64url')
      const now = new Date()
      await database.transaction(async (transaction) => {
        await transaction.update(marketplaceSellerPasswordResetTokens).set({ consumedAt: now })
          .where(and(eq(marketplaceSellerPasswordResetTokens.sellerAccountId, account.id), isNull(marketplaceSellerPasswordResetTokens.consumedAt)))
        await transaction.insert(marketplaceSellerPasswordResetTokens).values({ sellerAccountId: account.id, tokenHash: resetTokenHash(rawToken), expiresAt: new Date(now.getTime() + resetLifetimeMs) })
        await enqueueMarketplaceEmail(transaction, {
          eventKey: `seller-account:${account.id}:password-reset:${resetTokenHash(rawToken)}`,
          to: parsed.data.email,
          kind: 'seller_password_reset',
          data: { actionUrl: resetUrl(rawToken) },
        })
      })
    }
    response.status(202).json({ data: { requested: true } })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerPasswordRecoveryRouter.post('/seller/password/reset', resetLimiter, async (request, response, next) => {
  const parsed = z.object({ token: z.string().min(32).max(128), password: passwordSchema, confirmPassword: passwordSchema })
    .strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' }).safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_PASSWORD_RESET', message: 'Check the reset link and password details.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller password recovery is temporarily unavailable.' } })
    return
  }
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const reset = await database.transaction(async (transaction) => {
      const now = new Date()
      const [record] = await transaction.select({ id: marketplaceSellerPasswordResetTokens.id, sellerAccountId: marketplaceSellerPasswordResetTokens.sellerAccountId, expiresAt: marketplaceSellerPasswordResetTokens.expiresAt, consumedAt: marketplaceSellerPasswordResetTokens.consumedAt, email: marketplaceSellerAccounts.email, status: marketplaceSellerAccounts.status, emailVerifiedAt: marketplaceSellerAccounts.emailVerifiedAt })
        .from(marketplaceSellerPasswordResetTokens).innerJoin(marketplaceSellerAccounts, eq(marketplaceSellerAccounts.id, marketplaceSellerPasswordResetTokens.sellerAccountId))
        .where(eq(marketplaceSellerPasswordResetTokens.tokenHash, resetTokenHash(parsed.data.token))).for('update').limit(1)
      if (!record || record.consumedAt || record.expiresAt.getTime() <= now.getTime() || record.status !== 'active' || !record.emailVerifiedAt) return false
      const [consumed] = await transaction.update(marketplaceSellerPasswordResetTokens).set({ consumedAt: now })
        .where(and(eq(marketplaceSellerPasswordResetTokens.id, record.id), isNull(marketplaceSellerPasswordResetTokens.consumedAt))).returning({ id: marketplaceSellerPasswordResetTokens.id })
      if (!consumed) return false
      await transaction.update(marketplaceSellerAccounts).set({ passwordHash, updatedAt: now }).where(eq(marketplaceSellerAccounts.id, record.sellerAccountId))
      await transaction.delete(marketplaceSellerSessions).where(eq(marketplaceSellerSessions.sellerAccountId, record.sellerAccountId))
      await transaction.insert(marketplaceAuditLogs).values({ action: 'seller.password.reset', resourceType: 'marketplace_seller_account', resourceId: record.sellerAccountId })
      await enqueueMarketplaceEmail(transaction, {
        eventKey: `seller-account:${record.sellerAccountId}:password-reset-completed:${record.id}`,
        to: record.email,
        kind: 'seller_password_reset_completed',
        data: {},
      })
      return true
    })
    if (!reset) {
      response.status(400).json({ error: { code: 'INVALID_SELLER_PASSWORD_RESET', message: 'The reset link is invalid, expired, or already used.' } })
      return
    }
    response.json({ data: { reset: true } })
  } catch (error) {
    next(error)
  }
})