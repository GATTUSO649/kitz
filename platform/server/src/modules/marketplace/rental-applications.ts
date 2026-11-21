import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminUsers, marketplaceAuditLogs, marketplaceCounties, marketplaceRentalPlans, marketplaceSellerAccounts, marketplaceSellers, marketplaceShopActivationTokens, marketplaceShopCategories, marketplaceShopRentalApplicationHistory, marketplaceShopRentalApplications, marketplaceShops, marketplaceShopSubscriptions } from '../../database/schema.js'
import { normalizeKenyanPhone } from './security.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { requireMarketplacePermission, type MarketplaceAdminSession } from '../admin/marketplace-auth.js'

export const rentalApplicationRouter = Router()
export const rentalAdminRouter = Router()

const applicationSchema = z.object({
  sourceSubmissionId: z.string().trim().min(8).max(120),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(7).max(24),
  alternativePhone: z.string().trim().max(24).optional(),
  county: z.string().trim().min(2).max(100),
  town: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(160),
  businessCategory: z.string().trim().min(2).max(120),
  businessDescription: z.string().trim().min(20).max(4000),
  hasPhysicalShop: z.boolean(),
  businessLocation: z.string().trim().min(2).max(240),
  preferredShopName: z.string().trim().min(2).max(160),
  preferredSlug: z.string().trim().lowercase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  businessPhone: z.string().trim().min(7).max(24),
  businessEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  preferredPlanCode: z.string().trim().min(1).max(80).default('standard'),
  launchDate: z.string().datetime({ offset: true }).optional(),
  productCategories: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  estimatedProductCount: z.number().int().min(0).max(100000).default(0),
  additionalInformation: z.string().trim().max(4000).optional(),
  documents: z.record(z.string(), z.string().url()).default({}),
  declarations: z.record(z.string(), z.boolean()).refine((value) => value.terms === true && value.accuracy === true && value.rentalConditions === true).optional(),
}).strict()

function secretMatchesHeader(header: string | undefined): boolean {
  const secret = process.env.MARKETPLACE_SHOP_APPLICATION_INTAKE_SECRET?.trim()
  if (!secret || !header) return false
  const actual = createHash('sha256').update(header).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(actual, expected)
}

export function applicationReference() {
  return `MR-${randomBytes(8).toString('hex').toUpperCase()}`
}

export function shopSlugFromName(name: string) {
  return name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180)
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function adminSession(response: Response) {
  return response.locals.marketplaceAdmin as MarketplaceAdminSession
}

rentalApplicationRouter.get('/shop-rental/configuration', (_request, response) => {
  const url = process.env.MARKETPLACE_SHOP_RENTAL_GOOGLE_FORM_URL?.trim()
  let formUrl: string | null = null
  try {
    if (url) {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.hostname === 'docs.google.com') formUrl = parsed.toString()
    }
  } catch { /* Configuration remains unavailable. */ }
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: { formUrl, intakeConfigured: Boolean(process.env.MARKETPLACE_SHOP_APPLICATION_INTAKE_SECRET) } })
})

rentalApplicationRouter.post('/shop-rental/applications/intake', async (request, response, next) => {
  if (!secretMatchesHeader(request.get('X-MarketHub-Application-Secret') ?? undefined)) {
    response.status(401).json({ error: { code: 'INVALID_APPLICATION_INTAKE', message: 'Application intake authentication failed.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Shop rental applications are temporarily unavailable.' } })
    return
  }
  const parsed = applicationSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SHOP_APPLICATION', message: 'Check the shop application fields and declarations.' } })
    return
  }
  try {
    const phone = normalizeKenyanPhone(parsed.data.phone)
    const businessPhone = normalizeKenyanPhone(parsed.data.businessPhone)
    const alternativePhone = parsed.data.alternativePhone ? normalizeKenyanPhone(parsed.data.alternativePhone) : null
    const existing = await database.select({ id: marketplaceShopRentalApplications.id, applicationReference: marketplaceShopRentalApplications.applicationReference, status: marketplaceShopRentalApplications.status })
      .from(marketplaceShopRentalApplications).where(eq(marketplaceShopRentalApplications.sourceSubmissionId, parsed.data.sourceSubmissionId)).limit(1)
    if (existing[0]) {
      response.status(200).json({ data: { id: existing[0].id, applicationReference: existing[0].applicationReference, status: existing[0].status, duplicate: true } })
      return
    }
    const created = await database.transaction(async (transaction) => {
      const [application] = await transaction.insert(marketplaceShopRentalApplications).values({
        applicationReference: applicationReference(),
        sourceSubmissionId: parsed.data.sourceSubmissionId,
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        phone,
        alternativePhone,
        county: parsed.data.county,
        town: parsed.data.town,
        businessName: parsed.data.businessName,
        businessCategory: parsed.data.businessCategory,
        businessDescription: parsed.data.businessDescription,
        hasPhysicalShop: parsed.data.hasPhysicalShop,
        businessLocation: parsed.data.businessLocation,
        preferredShopName: parsed.data.preferredShopName,
        preferredSlug: parsed.data.preferredSlug,
        businessPhone,
        businessEmail: parsed.data.businessEmail,
        preferredPlanCode: parsed.data.preferredPlanCode,
        launchDate: parsed.data.launchDate ? new Date(parsed.data.launchDate) : null,
        productCategories: parsed.data.productCategories,
        estimatedProductCount: parsed.data.estimatedProductCount,
        additionalInformation: parsed.data.additionalInformation ?? null,
        documents: parsed.data.documents,
        declarations: parsed.data.declarations ?? {},
        status: 'pending',
      }).returning({ id: marketplaceShopRentalApplications.id, applicationReference: marketplaceShopRentalApplications.applicationReference })
      if (!application) throw new Error('Shop application was not created.')
      await transaction.insert(marketplaceShopRentalApplicationHistory).values({ applicationId: application.id, fromStatus: null, toStatus: 'pending', note: 'Received through secure Google Forms intake.' })
      await enqueueMarketplaceEmail(transaction, {
        eventKey: `shop-rental:${application.id}:received`,
        to: parsed.data.email,
        kind: 'shop_rental_application_received',
        data: { name: parsed.data.fullName, businessName: parsed.data.businessName, applicationReference: application.applicationReference },
      })
      return application
    })
    response.status(201).json({ data: { id: created.id, applicationReference: created.applicationReference, status: 'pending', duplicate: false } })
  } catch (error) {
    next(error)
  }
})

rentalAdminRouter.get('/shop-rental/applications', requireMarketplacePermission(['support:manage', 'settings:manage']), async (request, response, next) => {
  if (!database) return response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Shop applications are temporarily unavailable.' } })
  const parsed = z.object({ status: z.enum(['pending', 'under_review', 'approved', 'declined']).optional(), q: z.string().trim().max(160).optional(), page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query)
  if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_APPLICATION_QUERY', message: 'Shop application filters are invalid.' } })
  try {
    const conditions = []
    if (parsed.data.status) conditions.push(eq(marketplaceShopRentalApplications.status, parsed.data.status))
    if (parsed.data.q) conditions.push(or(ilike(marketplaceShopRentalApplications.fullName, `%${parsed.data.q}%`), ilike(marketplaceShopRentalApplications.businessName, `%${parsed.data.q}%`), ilike(marketplaceShopRentalApplications.email, `%${parsed.data.q}%`))!)
    const rows = await database.select().from(marketplaceShopRentalApplications).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(marketplaceShopRentalApplications.createdAt)).limit(50).offset((parsed.data.page - 1) * 50)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: rows, pagination: { page: parsed.data.page, limit: 50 } })
  } catch (error) { next(error) }
})

rentalAdminRouter.get('/shop-rental/applications/:id', requireMarketplacePermission(['support:manage', 'settings:manage']), async (request, response, next) => {
  if (!database) return response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Shop applications are temporarily unavailable.' } })
  const id = z.string().uuid().safeParse(request.params.id)
  if (!id.success) return response.status(400).json({ error: { code: 'INVALID_APPLICATION', message: 'The application identifier is invalid.' } })
  try {
    const [application] = await database.select().from(marketplaceShopRentalApplications).where(eq(marketplaceShopRentalApplications.id, id.data)).limit(1)
    if (!application) return response.status(404).json({ error: { code: 'SHOP_APPLICATION_NOT_FOUND', message: 'The shop application could not be found.' } })
    const history = await database.select().from(marketplaceShopRentalApplicationHistory).where(eq(marketplaceShopRentalApplicationHistory.applicationId, id.data)).orderBy(desc(marketplaceShopRentalApplicationHistory.createdAt))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: { application, history } })
  } catch (error) { next(error) }
})

rentalAdminRouter.post('/shop-rental/applications/:id/decline', requireMarketplacePermission(['support:manage', 'settings:manage']), async (request, response, next) => {
  if (!database) return response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Shop applications are temporarily unavailable.' } })
  const id = z.string().uuid().safeParse(request.params.id)
  const input = z.object({ reason: z.string().trim().min(5).max(1000) }).strict().safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_DECLINE', message: 'Provide a valid application and decline reason.' } })
  const actor = adminSession(response)
  try {
    const updated = await database.transaction(async (transaction) => {
      const [application] = await transaction.select().from(marketplaceShopRentalApplications).where(eq(marketplaceShopRentalApplications.id, id.data)).for('update').limit(1)
      if (!application || application.status === 'approved') return null
      await transaction.update(marketplaceShopRentalApplications).set({ status: 'declined', adminNotes: input.data.reason, updatedAt: new Date() }).where(eq(marketplaceShopRentalApplications.id, id.data))
      await transaction.insert(marketplaceShopRentalApplicationHistory).values({ applicationId: id.data, adminUserId: actor.id, fromStatus: application.status, toStatus: 'declined', note: input.data.reason })
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: actor.id, action: 'shop_rental.application_declined', resourceType: 'shop_rental_application', resourceId: id.data, metadata: { reason: input.data.reason } })
      await enqueueMarketplaceEmail(transaction, { eventKey: `shop-rental:${id.data}:declined`, to: application.email, kind: 'shop_rental_application_declined', data: { name: application.fullName, businessName: application.businessName, applicationReference: application.applicationReference, reason: input.data.reason } })
      return application
    })
    if (!updated) return response.status(409).json({ error: { code: 'SHOP_APPLICATION_NOT_REVIEWABLE', message: 'This application is already approved or could not be found.' } })
    response.json({ data: { id: id.data, status: 'declined' } })
  } catch (error) { next(error) }
})

rentalAdminRouter.post('/shop-rental/applications/:id/approve', requireMarketplacePermission(['support:manage', 'settings:manage']), async (request, response, next) => {
  if (!database) return response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Shop applications are temporarily unavailable.' } })
  const id = z.string().uuid().safeParse(request.params.id)
  const input = z.object({ planCode: z.string().trim().min(1).max(80).optional(), shopName: z.string().trim().min(2).max(160).optional(), slug: z.string().trim().lowercase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180).optional() }).strict().safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_APPROVAL', message: 'The approval fields are invalid.' } })
  const actor = adminSession(response)
  try {
    const result = await database.transaction(async (transaction) => {
      const [application] = await transaction.select().from(marketplaceShopRentalApplications).where(eq(marketplaceShopRentalApplications.id, id.data)).for('update').limit(1)
      if (!application) return { kind: 'not-found' as const }
      if (application.status === 'approved') {
        const [existingShop] = await transaction.select({ id: marketplaceShops.id }).from(marketplaceShops).where(eq(marketplaceShops.sellerAccountId, application.sellerAccountId ?? '00000000-0000-0000-0000-000000000000')).limit(1)
        return { kind: 'already-approved' as const, shopId: existingShop?.id ?? application.shopId }
      }
      if (application.status === 'declined') return { kind: 'declined' as const }
      const planCode = input.data.planCode ?? application.preferredPlanCode
      const [plan] = await transaction.select().from(marketplaceRentalPlans).where(and(eq(marketplaceRentalPlans.code, planCode), eq(marketplaceRentalPlans.active, true))).limit(1)
      if (!plan) return { kind: 'plan-not-found' as const }
      const [county] = await transaction.select({ id: marketplaceCounties.id }).from(marketplaceCounties).where(ilike(marketplaceCounties.name, application.county)).limit(1)
      if (!county) return { kind: 'county-not-found' as const }
      let account = await transaction.select({ id: marketplaceSellerAccounts.id, status: marketplaceSellerAccounts.status, passwordHash: marketplaceSellerAccounts.passwordHash }).from(marketplaceSellerAccounts).where(eq(marketplaceSellerAccounts.email, application.email)).limit(1)
      let accountId: string
      if (account[0]) {
        accountId = account[0].id
      } else {
        const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)
        const [createdAccount] = await transaction.insert(marketplaceSellerAccounts).values({ email: application.email, passwordHash, status: 'pending', termsAcceptedAt: null }).returning({ id: marketplaceSellerAccounts.id })
        if (!createdAccount) throw new Error('Seller account was not created.')
        accountId = createdAccount.id
      }
      const shopName = input.data.shopName ?? application.preferredShopName
      const slug = input.data.slug ?? application.preferredSlug
      const [existingSlug] = await transaction.select({ id: marketplaceShops.id }).from(marketplaceShops).where(eq(marketplaceShops.slug, slug)).limit(1)
      if (existingSlug) return { kind: 'slug-conflict' as const }
      const [shopCategory] = await transaction.select({ id: marketplaceShopCategories.id }).from(marketplaceShopCategories).where(and(eq(marketplaceShopCategories.name, application.businessCategory), eq(marketplaceShopCategories.active, true))).limit(1)
      const [seller] = await transaction.insert(marketplaceSellers).values({ accountId, name: application.fullName, phone: application.phone, whatsapp: application.alternativePhone ?? application.phone, email: application.email, countyId: county.id, subcounty: application.town, town: application.town, area: application.businessLocation }).onConflictDoNothing().returning({ id: marketplaceSellers.id })
      let sellerId = seller?.id
      if (!sellerId) {
        const [existingSeller] = await transaction.select({ id: marketplaceSellers.id }).from(marketplaceSellers).where(eq(marketplaceSellers.accountId, accountId)).limit(1)
        sellerId = existingSeller?.id
      }
      const [shop] = await transaction.insert(marketplaceShops).values({ sellerAccountId: accountId, sellerId: sellerId ?? null, name: shopName, slug, description: application.businessDescription, categoryId: shopCategory?.id ?? null, category: shopCategory ? application.businessCategory : null, status: 'active' }).returning({ id: marketplaceShops.id })
      if (!shop) throw new Error('Shop was not created.')
      await transaction.insert(marketplaceShopSubscriptions).values({ shopId: shop.id, planId: plan.id, status: 'pending', startsAt: null, expiresAt: null })
      const rawToken = randomBytes(32).toString('base64url')
      await transaction.insert(marketplaceShopActivationTokens).values({ sellerAccountId: accountId, applicationId: application.id, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) })
      await transaction.update(marketplaceShopRentalApplications).set({ status: 'approved', sellerAccountId: accountId, shopId: shop.id, preferredSlug: slug, preferredShopName: shopName, updatedAt: new Date() }).where(eq(marketplaceShopRentalApplications.id, application.id))
      await transaction.insert(marketplaceShopRentalApplicationHistory).values({ applicationId: application.id, adminUserId: actor.id, fromStatus: application.status, toStatus: 'approved', note: `Approved with plan ${plan.code} and shop ${shopName}.` })
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: actor.id, action: 'shop_rental.application_approved', resourceType: 'shop_rental_application', resourceId: application.id, metadata: { shopId: shop.id, planCode: plan.code, accountId } })
      const baseUrl = process.env.PLATFORM_ORIGIN || 'http://127.0.0.1:5173'
      await enqueueMarketplaceEmail(transaction, { eventKey: `shop-rental:${application.id}:approved`, to: application.email, kind: 'shop_rental_application_approved', data: { name: application.fullName, businessName: application.businessName, shopName, applicationReference: application.applicationReference } })
      await enqueueMarketplaceEmail(transaction, { eventKey: `shop-rental:${application.id}:activation`, to: application.email, kind: 'shop_account_activation', data: { name: application.fullName, businessName: application.businessName, shopName, applicationReference: application.applicationReference, actionUrl: `${baseUrl}/marketplace/shops/activate?token=${encodeURIComponent(rawToken)}` } })
      return { kind: 'approved' as const, accountId, shopId: shop.id }
    })
    if (result.kind === 'not-found') return response.status(404).json({ error: { code: 'SHOP_APPLICATION_NOT_FOUND', message: 'The shop application could not be found.' } })
    if (result.kind === 'declined') return response.status(409).json({ error: { code: 'SHOP_APPLICATION_DECLINED', message: 'This application was declined.' } })
    if (result.kind === 'plan-not-found') return response.status(409).json({ error: { code: 'RENTAL_PLAN_NOT_FOUND', message: 'The selected rental plan is unavailable.' } })
    if (result.kind === 'county-not-found') return response.status(409).json({ error: { code: 'APPLICATION_COUNTY_NOT_FOUND', message: 'The application county is not registered.' } })
    if (result.kind === 'slug-conflict') return response.status(409).json({ error: { code: 'SHOP_SLUG_TAKEN', message: 'The requested shop URL is already in use.' } })
    if (result.kind === 'already-approved') return response.status(200).json({ data: { id: id.data, status: 'approved', shopId: result.shopId, duplicate: true } })
    response.json({ data: { id: id.data, status: 'approved', shopId: result.shopId, accountProvisioned: true, duplicate: false } })
  } catch (error) { next(error) }
})

rentalApplicationRouter.post('/shop-rental/activate', async (request, response, next) => {
  if (!database) return response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Shop activation is temporarily unavailable.' } })
  const parsed = z.object({ token: z.string().min(32).max(128), password: z.string().min(12).max(128), confirmPassword: z.string().min(12).max(128) }).strict().refine((value) => value.password === value.confirmPassword).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: { code: 'INVALID_SHOP_ACTIVATION', message: 'Check the activation link and password.' } })
  try {
    const activated = await database.transaction(async (transaction) => {
      const [activation] = await transaction.select().from(marketplaceShopActivationTokens).where(eq(marketplaceShopActivationTokens.tokenHash, tokenHash(parsed.data.token))).for('update').limit(1)
      if (!activation || activation.consumedAt || activation.expiresAt.getTime() <= Date.now()) return false
      const [consumed] = await transaction.update(marketplaceShopActivationTokens).set({ consumedAt: new Date() }).where(and(eq(marketplaceShopActivationTokens.id, activation.id), isNull(marketplaceShopActivationTokens.consumedAt))).returning({ id: marketplaceShopActivationTokens.id })
      if (!consumed) return false
      const passwordHash = await bcrypt.hash(parsed.data.password, 12)
      await transaction.update(marketplaceSellerAccounts).set({ passwordHash, status: 'active', emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(marketplaceSellerAccounts.id, activation.sellerAccountId))
      await transaction.update(marketplaceShopRentalApplications).set({ updatedAt: new Date() }).where(eq(marketplaceShopRentalApplications.id, activation.applicationId))
      return true
    })
    if (!activated) return response.status(400).json({ error: { code: 'SHOP_ACTIVATION_INVALID', message: 'The activation link is invalid, expired, or already used.' } })
    response.json({ data: { activated: true, loginPath: '/marketplace/seller/login' } })
  } catch (error) { next(error) }
})
