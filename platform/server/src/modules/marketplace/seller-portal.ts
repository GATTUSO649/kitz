import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, count, desc, eq, gte, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAuditLogs, marketplaceCategories, marketplaceCounties, marketplaceProductImages, marketplaceProductViews, marketplaceProducts, marketplaceSellerAccounts, marketplaceSellerSessions, marketplaceSellers, marketplaceSellerVerificationTokens, marketplaceSubcategories } from '../../database/schema.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { hashSecret, normalizeKenyanPhone } from './security.js'

const cookieName = 'mh_marketplace_seller'
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const verificationLifetimeMs = 60 * 60 * 1000
const tokenHash = (token: string) => hashSecret(token)
const referenceSchema = z.string().regex(/^MH-[A-F0-9]{16}$/)

export type MarketplaceSellerSession = {
  id: string
  email: string
  sellerId: string
  name: string
  phone: string
  whatsapp: string | null
  countyCode: string
  county: string
  subcounty: string
  town: string
  area: string | null
}

export const marketplaceSellerAuthRouter = Router()
export const marketplaceSellerDataRouter = Router()

const signupLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })
const verificationLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })

function readSessionToken(request: Request): string | null {
  const cookie = request.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))
  const value = cookie?.slice(cookieName.length + 1)
  return value && /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null
}

function sessionCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${cookieName}=${token}; Path=/api/v1/marketplace; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`
}

function verificationUrl(token: string): string {
  const origin = process.env.PLATFORM_ORIGIN || 'http://127.0.0.1:5173'
  const url = new URL('/marketplace/seller/verify', origin)
  url.searchParams.set('token', token)
  return url.toString()
}

async function loadSellerSession(request: Request): Promise<MarketplaceSellerSession | null> {
  if (!database) return null
  const token = readSessionToken(request)
  if (!token) return null
  const [session] = await database.select({
    id: marketplaceSellerAccounts.id,
    email: marketplaceSellerAccounts.email,
    sellerId: marketplaceSellers.id,
    name: marketplaceSellers.name,
    phone: marketplaceSellers.phone,
    whatsapp: marketplaceSellers.whatsapp,
    countyCode: marketplaceCounties.code,
    county: marketplaceCounties.name,
    subcounty: marketplaceSellers.subcounty,
    town: marketplaceSellers.town,
    area: marketplaceSellers.area,
  }).from(marketplaceSellerSessions)
    .innerJoin(marketplaceSellerAccounts, eq(marketplaceSellerSessions.sellerAccountId, marketplaceSellerAccounts.id))
    .innerJoin(marketplaceSellers, eq(marketplaceSellers.accountId, marketplaceSellerAccounts.id))
    .innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
    .where(and(eq(marketplaceSellerSessions.tokenHash, tokenHash(token)), gt(marketplaceSellerSessions.expiresAt, new Date()), eq(marketplaceSellerAccounts.status, 'active')))
    .orderBy(desc(marketplaceSellers.createdAt)).limit(1)
  return session ?? null
}

export async function optionalMarketplaceSeller(request: Request, response: Response, next: NextFunction) {
  if (!readSessionToken(request)) {
    next()
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace seller services are temporarily unavailable.' } })
    return
  }
  try {
    const seller = await loadSellerSession(request)
    if (seller) response.locals.marketplaceSeller = seller
    next()
  } catch (error) {
    next(error)
  }
}

function requireMarketplaceSeller(request: Request, response: Response, next: NextFunction) {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace seller services are temporarily unavailable.' } })
    return
  }
  loadSellerSession(request).then((seller) => {
    if (!seller) {
      response.status(401).json({ error: { code: 'SELLER_UNAUTHENTICATED', message: 'Sign in to manage your listings.' } })
      return
    }
    response.locals.marketplaceSeller = seller
    next()
  }).catch(next)
}

function currentSeller(response: Response): MarketplaceSellerSession {
  return response.locals.marketplaceSeller as MarketplaceSellerSession
}

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(24),
  whatsapp: z.string().trim().max(24).optional().or(z.literal('')),
  countyCode: z.string().regex(/^\d{3}$/),
  subcounty: z.string().trim().min(2).max(100).optional().or(z.literal('')),
  town: z.string().trim().min(2).max(100).optional().or(z.literal('')),
  area: z.string().trim().max(120).optional(),
  password: z.string().min(12).max(128),
  confirmPassword: z.string(),
}).strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })

marketplaceSellerAuthRouter.post('/seller/signup', signupLimiter, async (request, response, next) => {
  const parsed = signupSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_SIGNUP', message: 'Check the account details, location, and password.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller registration is temporarily unavailable.' } })
    return
  }
  try {
    const [existingAccount] = await database.select({ id: marketplaceSellerAccounts.id }).from(marketplaceSellerAccounts).where(eq(marketplaceSellerAccounts.email, parsed.data.email)).limit(1)
    if (existingAccount) {
      response.status(409).json({ error: { code: 'SELLER_EMAIL_EXISTS', message: 'An account already uses this email. Sign in or request a new verification email.' } })
      return
    }
    const [county] = await database.select({ id: marketplaceCounties.id, name: marketplaceCounties.name }).from(marketplaceCounties)
      .where(and(eq(marketplaceCounties.code, parsed.data.countyCode), eq(marketplaceCounties.active, true))).limit(1)
    if (!county) {
      response.status(400).json({ error: { code: 'INVALID_SELLER_LOCATION', message: 'Choose an active county.' } })
      return
    }
    const phone = normalizeKenyanPhone(parsed.data.phone)
    const whatsapp = parsed.data.whatsapp ? normalizeKenyanPhone(parsed.data.whatsapp) : null
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const rawToken = randomBytes(32).toString('base64url')
    const accountId = await database.transaction(async (transaction) => {
      const [account] = await transaction.insert(marketplaceSellerAccounts).values({ email: parsed.data.email, passwordHash, status: 'pending' }).returning({ id: marketplaceSellerAccounts.id })
      if (!account) throw new Error('Seller account was not created.')
      await transaction.insert(marketplaceSellers).values({
        accountId: account.id,
        name: parsed.data.name,
        phone,
        whatsapp,
        email: parsed.data.email,
        countyId: county.id,
        subcounty: parsed.data.subcounty || county.name,
        town: parsed.data.town || county.name,
        area: parsed.data.area || null,
      })
      await transaction.insert(marketplaceSellerVerificationTokens).values({ sellerAccountId: account.id, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + verificationLifetimeMs) })
      await enqueueMarketplaceEmail(transaction, {
        eventKey: `seller-account:${account.id}:verify`,
        to: parsed.data.email,
        kind: 'seller_account_verification',
        data: { name: parsed.data.name, actionUrl: verificationUrl(rawToken) },
      })
      return account.id
    })
    response.status(202).json({ data: { pendingVerification: true, email: parsed.data.email, accountId } })
  } catch (error) {
    if (error instanceof Error && /valid Kenyan mobile number/.test(error.message)) {
      response.status(400).json({ error: { code: 'INVALID_PHONE', message: error.message } })
      return
    }
    next(error)
  }
})

marketplaceSellerAuthRouter.post('/seller/verify', verificationLimiter, async (request, response, next) => {
  const parsed = z.object({ token: z.string().min(32).max(128) }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_VERIFICATION', message: 'The verification link is invalid or expired.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller verification is temporarily unavailable.' } })
    return
  }
  try {
    const verified = await database.transaction(async (transaction) => {
      const [verification] = await transaction.select({ id: marketplaceSellerVerificationTokens.id, accountId: marketplaceSellerVerificationTokens.sellerAccountId, expiresAt: marketplaceSellerVerificationTokens.expiresAt, consumedAt: marketplaceSellerVerificationTokens.consumedAt })
        .from(marketplaceSellerVerificationTokens).where(eq(marketplaceSellerVerificationTokens.tokenHash, tokenHash(parsed.data.token))).for('update').limit(1)
      if (!verification || verification.consumedAt || verification.expiresAt.getTime() <= Date.now()) return false
      const [account] = await transaction.select({ email: marketplaceSellerAccounts.email, status: marketplaceSellerAccounts.status })
        .from(marketplaceSellerAccounts).where(eq(marketplaceSellerAccounts.id, verification.accountId)).limit(1)
      if (!account || account.status !== 'pending') return false
      const [consumed] = await transaction.update(marketplaceSellerVerificationTokens).set({ consumedAt: new Date() })
        .where(and(eq(marketplaceSellerVerificationTokens.id, verification.id), isNull(marketplaceSellerVerificationTokens.consumedAt))).returning({ id: marketplaceSellerVerificationTokens.id })
      if (!consumed) return false
      const verifiedAt = new Date()
      await transaction.update(marketplaceSellerAccounts).set({ status: 'active', emailVerifiedAt: verifiedAt, updatedAt: verifiedAt }).where(eq(marketplaceSellerAccounts.id, verification.accountId))
      await transaction.update(marketplaceSellers).set({ accountId: verification.accountId })
        .where(and(eq(marketplaceSellers.email, account.email), isNull(marketplaceSellers.accountId)))
      return true
    })
    if (!verified) {
      response.status(400).json({ error: { code: 'INVALID_SELLER_VERIFICATION', message: 'The verification link is invalid, expired, or already used.' } })
      return
    }
    response.json({ data: { verified: true, loginPath: '/marketplace/seller/login' } })
  } catch (error) {
    next(error)
  }
})

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict()
marketplaceSellerAuthRouter.post('/seller/login', loginLimiter, async (request, response, next) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_LOGIN', message: 'Enter a valid email address and password.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller sign-in is temporarily unavailable.' } })
    return
  }
  try {
    const [account] = await database.select({ id: marketplaceSellerAccounts.id, passwordHash: marketplaceSellerAccounts.passwordHash, status: marketplaceSellerAccounts.status })
      .from(marketplaceSellerAccounts).where(eq(marketplaceSellerAccounts.email, parsed.data.email.toLowerCase())).limit(1)
    const validPassword = account ? await bcrypt.compare(parsed.data.password, account.passwordHash) : false
    if (!account || !validPassword) {
      response.status(401).json({ error: { code: 'SELLER_INVALID_LOGIN', message: 'Email or password is incorrect.' } })
      return
    }
    if (account.status === 'pending') {
      response.status(403).json({ error: { code: 'SELLER_EMAIL_UNVERIFIED', message: 'Verify your email address before signing in.' } })
      return
    }
    if (account.status !== 'active') {
      response.status(403).json({ error: { code: 'SELLER_ACCOUNT_DISABLED', message: 'This seller account is not active.' } })
      return
    }
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + sessionLifetimeMs)
    await database.insert(marketplaceSellerSessions).values({ sellerAccountId: account.id, tokenHash: tokenHash(token), expiresAt })
    response.setHeader('Set-Cookie', sessionCookie(token, expiresAt))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: { signedIn: true, expiresAt: expiresAt.toISOString() } })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerAuthRouter.get('/seller/session', requireMarketplaceSeller, (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: currentSeller(response) })
})

marketplaceSellerAuthRouter.patch('/seller/password', requireMarketplaceSeller, async (request, response, next) => {
  const parsed = z.object({ currentPassword: z.string().min(1).max(128), password: z.string().min(12).max(128), confirmPassword: z.string().min(12).max(128) })
    .strict().refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' }).safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_PASSWORD', message: 'Check the password fields and try again.' } })
    return
  }
  if (!database) return
  try {
    const seller = currentSeller(response)
    const [account] = await database.select({ passwordHash: marketplaceSellerAccounts.passwordHash }).from(marketplaceSellerAccounts)
      .where(eq(marketplaceSellerAccounts.id, seller.id)).limit(1)
    if (!account || !await bcrypt.compare(parsed.data.currentPassword, account.passwordHash)) {
      response.status(401).json({ error: { code: 'SELLER_PASSWORD_MISMATCH', message: 'Current password is incorrect.' } })
      return
    }
    const token = readSessionToken(request)
    if (!token) {
      response.status(401).json({ error: { code: 'SELLER_UNAUTHENTICATED', message: 'Sign in to update your password.' } })
      return
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    await database.transaction(async (transaction) => {
      await transaction.update(marketplaceSellerAccounts).set({ passwordHash, updatedAt: new Date() }).where(eq(marketplaceSellerAccounts.id, seller.id))
      await transaction.delete(marketplaceSellerSessions).where(and(eq(marketplaceSellerSessions.sellerAccountId, seller.id), ne(marketplaceSellerSessions.tokenHash, tokenHash(token))))
      await transaction.insert(marketplaceAuditLogs).values({ action: 'seller.password.changed', resourceType: 'marketplace_seller_account', resourceId: seller.id })
    })
    response.json({ data: { updated: true, otherSessionsRevoked: true } })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerAuthRouter.post('/seller/logout', async (request, response, next) => {
  const token = readSessionToken(request)
  try {
    if (token && database) await database.delete(marketplaceSellerSessions).where(eq(marketplaceSellerSessions.tokenHash, tokenHash(token)))
    response.setHeader('Set-Cookie', `${cookieName}=; Path=/api/v1/marketplace; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
    response.json({ data: { signedOut: true } })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerDataRouter.get('/seller/products', requireMarketplaceSeller, async (_request, response, next) => {
  if (!database) return
  try {
    const seller = currentSeller(response)
    const products = await database.select({
      id: marketplaceProducts.id,
      reference: marketplaceProducts.reference,
      slug: marketplaceProducts.slug,
      title: marketplaceProducts.title,
      description: marketplaceProducts.description,
      condition: marketplaceProducts.condition,
      priceKes: marketplaceProducts.priceKes,
      negotiable: marketplaceProducts.negotiable,
      status: marketplaceProducts.status,
      expiresAt: marketplaceProducts.expiresAt,
      categoryId: marketplaceProducts.categoryId,
      category: marketplaceCategories.name,
      categoryActive: marketplaceCategories.active,
      subcategoryId: marketplaceProducts.subcategoryId,
      createdAt: marketplaceProducts.createdAt,
      publishedAt: marketplaceProducts.publishedAt,
      updatedAt: marketplaceProducts.updatedAt,
    }).from(marketplaceProducts)
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
      .innerJoin(marketplaceCategories, eq(marketplaceProducts.categoryId, marketplaceCategories.id))
      .where(eq(marketplaceSellers.accountId, seller.id)).orderBy(desc(marketplaceProducts.createdAt))
    const images = products.length ? await database.select({ id: marketplaceProductImages.id, productId: marketplaceProductImages.productId, imageUrl: marketplaceProductImages.imageUrl, isPrimary: marketplaceProductImages.isPrimary, sortOrder: marketplaceProductImages.sortOrder })
      .from(marketplaceProductImages).where(inArray(marketplaceProductImages.productId, products.map((product) => product.id))).orderBy(desc(marketplaceProductImages.isPrimary), marketplaceProductImages.sortOrder) : []
    const productIds = products.map((product) => product.id)
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    const [viewTotals, dailyViews, recentActivity] = await Promise.all([
      productIds.length
        ? database.select({ productId: marketplaceProductViews.productId, total: count() }).from(marketplaceProductViews)
          .where(inArray(marketplaceProductViews.productId, productIds)).groupBy(marketplaceProductViews.productId)
        : Promise.resolve([]),
      productIds.length
        ? database.select({ day: sql<string>`to_char(date_trunc('day', ${marketplaceProductViews.viewedAt}), 'YYYY-MM-DD')`, total: count() })
          .from(marketplaceProductViews)
          .where(and(inArray(marketplaceProductViews.productId, productIds), gte(marketplaceProductViews.viewedAt, yearAgo)))
          .groupBy(sql`date_trunc('day', ${marketplaceProductViews.viewedAt})`)
          .orderBy(sql`date_trunc('day', ${marketplaceProductViews.viewedAt})`)
        : Promise.resolve([]),
      productIds.length
        ? database.select({ action: marketplaceAuditLogs.action, resourceId: marketplaceAuditLogs.resourceId, createdAt: marketplaceAuditLogs.createdAt })
          .from(marketplaceAuditLogs)
          .where(and(
            eq(marketplaceAuditLogs.resourceType, 'marketplace_product'),
            inArray(marketplaceAuditLogs.resourceId, productIds),
            sql`${marketplaceAuditLogs.metadata}->>'sellerAccountId' = ${seller.id}`,
          ))
          .orderBy(desc(marketplaceAuditLogs.createdAt)).limit(12)
        : Promise.resolve([]),
    ])
    const imagesByProduct = new Map<string, typeof images>()
    for (const image of images) imagesByProduct.set(image.productId, [...(imagesByProduct.get(image.productId) ?? []), image])
    const viewCountByProduct = new Map(viewTotals.map((row) => [row.productId, Number(row.total)]))
    const productById = new Map(products.map((product) => [product.id, product]))
    const today = new Date()
    const viewsLast30Days = dailyViews.filter((row) => row.day >= new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .reduce((total, row) => total + Number(row.total), 0)
    const viewsPrevious30Days = dailyViews.filter((row) => {
      const start = new Date(today.getTime() - 59 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const end = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return row.day >= start && row.day <= end
    }).reduce((total, row) => total + Number(row.total), 0)
    response.setHeader('Cache-Control', 'no-store')
    response.json({
      data: products.map((product) => ({
        ...product,
        publicAvailable: product.status === 'published' && product.categoryActive && Boolean(product.expiresAt && product.expiresAt > new Date()),
        images: imagesByProduct.get(product.id) ?? [],
      })),
      analytics: {
        listingViews: [...viewCountByProduct].reduce((total, [, views]) => total + views, 0),
        viewsLast30Days,
        viewsPrevious30Days,
        dailyViews: dailyViews.map((row) => ({ day: row.day, views: Number(row.total) })),
        viewsByListing: products.map((product) => ({ reference: product.reference, views: viewCountByProduct.get(product.id) ?? 0 })),
      },
      recentActivity: [
        ...products.flatMap((product) => [
          { action: 'listing.created', reference: product.reference, title: product.title, createdAt: product.createdAt },
          ...(product.publishedAt ? [{ action: 'listing.published', reference: product.reference, title: product.title, createdAt: product.publishedAt }] : []),
        ]),
        ...recentActivity.map((item) => ({
          action: item.action,
          reference: item.resourceId ? productById.get(item.resourceId)?.reference ?? null : null,
          title: item.resourceId ? productById.get(item.resourceId)?.title ?? null : null,
          createdAt: item.createdAt,
        })),
      ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 12),
    })
  } catch (error) {
    next(error)
  }
})

const editListingSchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(30).max(5000),
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid().nullable().optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'used']),
  priceKes: z.number().int().positive().max(100_000_000),
  negotiable: z.boolean(),
}).strict()

marketplaceSellerDataRouter.patch('/seller/products/:reference', requireMarketplaceSeller, async (request, response, next) => {
  const reference = referenceSchema.safeParse(request.params.reference)
  const parsed = editListingSchema.safeParse(request.body)
  if (!reference.success || !parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_LISTING', message: 'Check the listing details and try again.' } })
    return
  }
  if (!database) return
  try {
    const seller = currentSeller(response)
    const [product] = await database.select({ id: marketplaceProducts.id, status: marketplaceProducts.status }).from(marketplaceProducts)
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
      .where(and(eq(marketplaceProducts.reference, reference.data), eq(marketplaceSellers.accountId, seller.id))).limit(1)
    if (!product) {
      response.status(404).json({ error: { code: 'SELLER_LISTING_NOT_FOUND', message: 'The listing could not be found in your account.' } })
      return
    }
    if (!['published', 'pending_payment', 'expired'].includes(product.status)) {
      response.status(409).json({ error: { code: 'SELLER_LISTING_NOT_EDITABLE', message: 'This listing cannot be edited in its current state.' } })
      return
    }
    const [category] = await database.select({ id: marketplaceCategories.id }).from(marketplaceCategories)
      .where(and(eq(marketplaceCategories.id, parsed.data.categoryId), eq(marketplaceCategories.active, true))).limit(1)
    if (!category) {
      response.status(400).json({ error: { code: 'INVALID_LISTING_CATEGORY', message: 'Choose an active category.' } })
      return
    }
    if (parsed.data.subcategoryId) {
      const [subcategory] = await database.select({ id: marketplaceSubcategories.id }).from(marketplaceSubcategories)
        .where(and(eq(marketplaceSubcategories.id, parsed.data.subcategoryId), eq(marketplaceSubcategories.categoryId, category.id), eq(marketplaceSubcategories.active, true))).limit(1)
      if (!subcategory) {
        response.status(400).json({ error: { code: 'INVALID_LISTING_SUBCATEGORY', message: 'Choose a subcategory within the selected category.' } })
        return
      }
    }
    const [updated] = await database.transaction(async (transaction) => {
      const rows = await transaction.update(marketplaceProducts).set({
        ...parsed.data,
        subcategoryId: parsed.data.subcategoryId ?? null,
        updatedAt: new Date(),
      }).where(eq(marketplaceProducts.id, product.id)).returning({ reference: marketplaceProducts.reference, slug: marketplaceProducts.slug, status: marketplaceProducts.status })
      if (rows[0]) await transaction.insert(marketplaceAuditLogs).values({ action: 'seller.listing.updated', resourceType: 'marketplace_product', resourceId: product.id, metadata: { sellerAccountId: seller.id, reference: reference.data } })
      return rows
    })
    if (!updated) {
      response.status(404).json({ error: { code: 'SELLER_LISTING_NOT_FOUND', message: 'The listing could not be found in your account.' } })
      return
    }
    response.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerDataRouter.patch('/seller/products/:reference/status', requireMarketplaceSeller, async (request, response, next) => {
  const reference = referenceSchema.safeParse(request.params.reference)
  const parsed = z.object({ status: z.literal('sold') }).strict().safeParse(request.body)
  if (!reference.success || !parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_LISTING_ACTION', message: 'The listing action is invalid.' } })
    return
  }
  if (!database) return
  try {
    const seller = currentSeller(response)
    const [product] = await database.select({ id: marketplaceProducts.id }).from(marketplaceProducts)
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
      .where(and(eq(marketplaceProducts.reference, reference.data), eq(marketplaceSellers.accountId, seller.id), eq(marketplaceProducts.status, 'published'))).limit(1)
    if (!product) {
      response.status(409).json({ error: { code: 'SELLER_LISTING_NOT_SELLABLE', message: 'Only your published listings can be marked as sold.' } })
      return
    }
    await database.transaction(async (transaction) => {
      await transaction.update(marketplaceProducts).set({ status: 'sold', updatedAt: new Date() }).where(eq(marketplaceProducts.id, product.id))
      await transaction.insert(marketplaceAuditLogs).values({ action: 'seller.listing.sold', resourceType: 'marketplace_product', resourceId: product.id, metadata: { sellerAccountId: seller.id, reference: reference.data } })
    })
    response.json({ data: { reference: reference.data, status: 'sold' } })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerDataRouter.delete('/seller/products/:reference', requireMarketplaceSeller, async (request, response, next) => {
  const reference = referenceSchema.safeParse(request.params.reference)
  if (!reference.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_LISTING', message: 'The listing reference is invalid.' } })
    return
  }
  if (!database) return
  try {
    const seller = currentSeller(response)
    const [product] = await database.select({ id: marketplaceProducts.id }).from(marketplaceProducts)
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
      .where(and(eq(marketplaceProducts.reference, reference.data), eq(marketplaceSellers.accountId, seller.id))).limit(1)
    if (!product) {
      response.status(404).json({ error: { code: 'SELLER_LISTING_NOT_FOUND', message: 'The listing could not be found in your account.' } })
      return
    }
    await database.transaction(async (transaction) => {
      await transaction.update(marketplaceProducts).set({ status: 'removed', updatedAt: new Date() }).where(eq(marketplaceProducts.id, product.id))
      await transaction.insert(marketplaceAuditLogs).values({ action: 'seller.listing.removed', resourceType: 'marketplace_product', resourceId: product.id, metadata: { sellerAccountId: seller.id, reference: reference.data } })
    })
    response.json({ data: { reference: reference.data, status: 'removed' } })
  } catch (error) {
    next(error)
  }
})

marketplaceSellerDataRouter.patch('/seller/profile', requireMarketplaceSeller, async (request, response, next) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(24),
    whatsapp: z.string().trim().max(24).optional().or(z.literal('')),
    countyCode: z.string().regex(/^\d{3}$/),
    subcounty: z.string().trim().min(2).max(100),
    town: z.string().trim().min(2).max(100),
    area: z.string().trim().max(120).optional(),
  }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_PROFILE', message: 'Check your seller profile details and try again.' } })
    return
  }
  if (!database) return
  try {
    const seller = currentSeller(response)
    const [county] = await database.select({ id: marketplaceCounties.id }).from(marketplaceCounties)
      .where(and(eq(marketplaceCounties.code, parsed.data.countyCode), eq(marketplaceCounties.active, true))).limit(1)
    if (!county) {
      response.status(400).json({ error: { code: 'INVALID_SELLER_LOCATION', message: 'Choose an active county.' } })
      return
    }
    const phone = normalizeKenyanPhone(parsed.data.phone)
    const whatsapp = parsed.data.whatsapp ? normalizeKenyanPhone(parsed.data.whatsapp) : null
    const [updated] = await database.transaction(async (transaction) => {
      const rows = await transaction.update(marketplaceSellers).set({
        name: parsed.data.name,
        phone,
        whatsapp,
        countyId: county.id,
        subcounty: parsed.data.subcounty,
        town: parsed.data.town,
        area: parsed.data.area || null,
      }).where(and(eq(marketplaceSellers.id, seller.sellerId), eq(marketplaceSellers.accountId, seller.id))).returning({ id: marketplaceSellers.id })
      if (rows[0]) await transaction.insert(marketplaceAuditLogs).values({ action: 'seller.profile.updated', resourceType: 'marketplace_seller_account', resourceId: seller.id })
      return rows
    })
    if (!updated) {
      response.status(404).json({ error: { code: 'SELLER_PROFILE_NOT_FOUND', message: 'Seller profile could not be found.' } })
      return
    }
    const [profile] = await database.select({ id: marketplaceSellerAccounts.id, email: marketplaceSellerAccounts.email, sellerId: marketplaceSellers.id, name: marketplaceSellers.name, phone: marketplaceSellers.phone, whatsapp: marketplaceSellers.whatsapp, countyCode: marketplaceCounties.code, county: marketplaceCounties.name, subcounty: marketplaceSellers.subcounty, town: marketplaceSellers.town, area: marketplaceSellers.area })
      .from(marketplaceSellerAccounts).innerJoin(marketplaceSellers, eq(marketplaceSellers.accountId, marketplaceSellerAccounts.id))
      .innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
      .where(eq(marketplaceSellerAccounts.id, seller.id)).limit(1)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: profile })
  } catch (error) {
    if (error instanceof Error && /valid Kenyan mobile number/.test(error.message)) {
      response.status(400).json({ error: { code: 'INVALID_PHONE', message: error.message } })
      return
    }
    next(error)
  }
})