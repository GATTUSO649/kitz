import { randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql, sum } from 'drizzle-orm'
import { Router } from 'express'
import express from 'express'
import { z } from 'zod'
import { adminDb, adminPool, db, pool } from '../../config/database.js'
import { isAllowedClientOrigin } from '../../config/env.js'
import { adminAuditLogs, adminUsers, itAccessRoles, operationsAuditEvents, operationsIncidentEvents, operationsIncidents, operationsOperators, operationsUsers } from '../../database/admin-schema.js'
import { logger } from '../../config/logger.js'
import { applicationSettings, categories, deliveryZones, expenseCategories, expenses, homepageSlides, inventoryMovements, jerseyCategories, leagues, notificationCampaigns, notificationRecipients, orderItems, orders, payments, productImages, productVariants, productVideos, products, supportMessages, supportRequests, teams, users } from '../../database/schema.js'
import { authenticateAdmin, authenticatedAdmin } from '../../middleware/authenticate.js'
import { isCustomerOnline, publishChatMessage, publishMessageReceipt, registerAdminStream } from '../../realtime/chat-events.js'
import { recordAdminAudit } from './auth.js'
import { deleteProductImage, ImageStorageError, uploadBrandLogoImage, uploadHomepageSlideImage, uploadProductImage, uploadSiteImage } from './image-storage.js'
import { isSiteImageUrl, siteImageSlotKeys } from '../site-images.js'
import { isSiteContentField, siteContentSchema } from '../site-content.js'
import { buildAdminDashboardReport, reportPeriods, resolveOptionalDateRange, resolveReportingRange } from './reporting.js'
import { hasItPermission, itPermissions, type ItPermission } from './it-access.js'
import { getRequestMetrics } from '../../middleware/request-metrics.js'
import { loadAdministratorPermissions, isAdministratorRole } from './permissions.js'
import { administratorPermissionsForRoute, hasAnyPermission, hasDedicatedAdministratorGuard, projectDashboardForRole } from './permission-routes.js'
import { adminWorkflowsRouter } from './workflows.js'
import { adminLaundryRouter } from '../laundry/routes.js'

export const adminRouter = Router()
adminRouter.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || isAllowedClientOrigin(request.get('origin'))) {
    next()
    return
  }
  response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
})
adminRouter.use(authenticateAdmin)

adminRouter.use(async (request, response, next) => {
  const actor = authenticatedAdmin(request)
  const required = administratorPermissionsForRoute(request.method, request.path)
  if (!required) {
    if (hasDedicatedAdministratorGuard(request.path)) {
      next()
      return
    }
    response.status(403).json({ error: { code: 'ADMIN_PERMISSION_POLICY_MISSING', message: 'This administrator route has no configured permission policy.' } })
    return
  }
  const role = actor?.role
  if (!actor || !role || !isAdministratorRole(role)) {
    response.status(403).json({ error: { code: 'ADMIN_ROLE_FORBIDDEN', message: 'This administrator role cannot access the requested resource.' } })
    return
  }
  try {
    const granted = await loadAdministratorPermissions(actor.id, role)
    if (!granted) {
      response.status(503).json({ error: { code: 'ADMIN_AUTHORIZATION_UNAVAILABLE', message: 'Administrator permissions could not be verified.' } })
      return
    }
    if (!hasAnyPermission(granted, required)) {
      response.status(403).json({ error: { code: 'ADMIN_PERMISSION_REQUIRED', message: 'This administrator does not have permission to access the requested resource.' } })
      return
    }
    response.locals.administratorPermissions = granted
    next()
  } catch (error) {
    next(error)
  }
})

adminRouter.use(adminWorkflowsRouter)
adminRouter.use('/laundry', adminLaundryRouter)

adminRouter.get('/me', (request, response) => {
  const actor = authenticatedAdmin(request)
  response.json({ data: { id: actor?.id, fullName: actor?.fullName, email: actor?.email } })
})

const dashboardQuerySchema = z.object({
  period: z.enum(reportPeriods).default('last30days'),
  from: z.string().optional(),
  to: z.string().optional(),
}).strict().superRefine((query, context) => {
  if (query.period === 'custom' && (!query.from || !query.to)) {
    context.addIssue({ code: 'custom', message: 'Custom reports require both from and to dates.' })
  }
  if (query.period !== 'custom' && (query.from !== undefined || query.to !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Date parameters are only supported for custom reports.' })
  }
})

adminRouter.get('/dashboard', async (request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Dashboard services are not configured.' } })
    return
  }
  const query = dashboardQuerySchema.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_REPORT_RANGE', message: 'Choose a valid reporting period and date range.' } })
  const range = resolveReportingRange(query.data)
  if (!range) return response.status(400).json({ error: { code: 'INVALID_REPORT_RANGE', message: 'Custom reports must be valid and no longer than 366 days.' } })
  const data = await buildAdminDashboardReport(db, range)
  if (!data) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Dashboard services are not configured.' } })
  const actor = authenticatedAdmin(request)
  response.json({ data: projectDashboardForRole(actor?.role ?? null, data as unknown as Record<string, unknown>, response.locals.administratorPermissions) })
})

const variantInput = z.object({
  sku: z.string().trim().min(2).max(80),
  size: z.string().trim().min(1).max(16),
  stock: z.number().int().min(0).max(100_000),
  price: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0, 'Variant price must be greater than zero.').nullable().optional(),
})
const productFieldsSchema = z.object({
  name: z.string().trim().min(2).max(180),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),
  description: z.string().trim().min(5).max(10_000),
  price: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0, 'Price must be greater than zero.'),
  salePrice: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0, 'Sale price must be greater than zero.').nullable().optional(),
  cost: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).nullable().optional(),
  season: z.string().trim().max(40).nullable().optional(),
  productType: z.string().trim().max(40).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  leagueId: z.number().int().positive().nullable().optional(),
  teamId: z.number().int().positive().nullable().optional(),
  jerseyCategoryId: z.number().int().positive().nullable().optional(),
  imageUrl: z.string().url().max(2048).refine((value) => value.toLowerCase().startsWith('https://'), 'Product images must use HTTPS.').nullable().optional(),
  featured: z.boolean().default(false),
  published: z.boolean().default(false),
  trending: z.boolean().default(false),
  variants: z.array(variantInput).min(1).max(40).superRefine((variants, context) => {
    const sizes = new Set<string>()
    const skus = new Set<string>()
    variants.forEach((variant, index) => {
      if (sizes.has(variant.size)) context.addIssue({ code: 'custom', path: [index, 'size'], message: 'Each product size must be unique.' })
      if (skus.has(variant.sku)) context.addIssue({ code: 'custom', path: [index, 'sku'], message: 'Each variant SKU must be unique.' })
      sizes.add(variant.size)
      skus.add(variant.sku)
    })
  }),
})
export const createProductSchema = productFieldsSchema.superRefine((value, context) => {
  if (value.salePrice && Number(value.salePrice) >= Number(value.price)) {
    context.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be less than the regular price.' })
  }
})
const patchProductSchema = productFieldsSchema.omit({ variants: true, slug: true }).partial().superRefine((value, context) => {
  if (value.salePrice && value.price && Number(value.salePrice) >= Number(value.price)) {
    context.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be less than the regular price.' })
  }
}).refine((value) => Object.keys(value).length > 0)
const stockSchema = z.object({ delta: z.number().int().min(-100_000).max(100_000).refine((value) => value !== 0), note: z.string().trim().max(500).optional() })
const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
})
const zoneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  fee: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/),
  active: z.boolean().default(true),
})
const expenseSchema = z.object({
  description: z.string().trim().min(2).max(240),
  amount: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/),
  categoryId: z.number().int().positive().nullable().optional(),
  incurredAt: z.string().datetime(),
})
export const supportUpdateSchema = z.object({
  status: z.enum(['in_progress', 'resolved', 'closed']).optional(),
  adminResponse: z.string().trim().min(1).max(4000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0)

export function canTransitionOrderStatus(currentStatus: string, nextStatus: 'processing' | 'dispatched' | 'delivered' | 'cancelled', paymentMethod: string) {
  if (nextStatus === 'cancelled') return currentStatus === 'pending_payment'
  if (nextStatus === 'processing') return currentStatus === 'paid' || (currentStatus === 'pending_payment' && paymentMethod === 'pay_on_delivery')
  if (nextStatus === 'dispatched') return currentStatus === 'processing'
  return currentStatus === 'dispatched'
}

export const adminNotificationSchema = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(2000),
  href: z.string().trim().max(320).refine((value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'), 'Link must be a same-site path.').optional(),
  audience: z.enum(['all', 'customer']),
  customerId: z.number().int().positive().optional(),
}).superRefine((value, context) => {
  if (value.audience === 'customer' && value.customerId === undefined) {
    context.addIssue({ code: 'custom', path: ['customerId'], message: 'Choose a customer.' })
  }
  if (value.audience === 'all' && value.customerId !== undefined) {
    context.addIssue({ code: 'custom', path: ['customerId'], message: 'Remove the customer ID for a broadcast.' })
  }
})
const adminSupportMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  productName: z.string().trim().min(1).max(180).optional(),
  productPrice: z.number().min(0).max(9999999999.99).optional(),
  productImageUrl: z.string().url().max(2000).refine((value) => new URL(value).protocol === 'https:').optional(),
  productUrl: z.string().regex(/^\/(?:account\/marketplace\/)?products\/[a-zA-Z0-9._-]+\/?$/).max(320).optional(),
}).superRefine((value, context) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) {
    context.addIssue({ code: 'custom', message: 'Provide both location coordinates or neither.', path: ['latitude'] })
  }
})
export const settingsSchema = z.object({
  businessName: z.string().trim().min(2).max(120).optional(),
  tagline: z.string().trim().max(240).optional(),
  contactEmail: z.string().trim().email().max(254).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  whatsappNumber: z.string().trim().max(30).optional(),
  instagramUrl: z.string().url().max(500).or(z.literal('')).optional(),
  dispatchTown: z.string().trim().max(120).optional(),
  mpesaTillName: z.string().trim().max(120).optional(),
  mpesaTillNumber: z.string().trim().regex(/^\d{5,20}$/).or(z.literal('')).optional(),
  mpesaMobileNumber: z.string().trim().regex(/^(?:\+?254|0)[17]\d{8}$/).or(z.literal('')).optional(),
}).refine((value) => Object.keys(value).length > 0)
const financeSettingsSchema = z.object({
  mpesaTillName: z.string().trim().max(120).optional(),
  mpesaTillNumber: z.string().trim().regex(/^\d{5,20}$/).or(z.literal('')).optional(),
  mpesaMobileNumber: z.string().trim().regex(/^(?:\+?254|0)[17]\d{8}$/).or(z.literal('')).optional(),
}).refine((value) => Object.keys(value).length > 0)
const homepageSlideFieldsSchema = z.object({
  imageUrl: z.string().url().max(2048).refine((value) => value.toLowerCase().startsWith('https://'), 'Slide images must use HTTPS.'),
  displayDurationSeconds: z.number().int().min(2).max(30).default(5),
  title: z.string().trim().min(2).max(180),
  subtitle: z.string().trim().min(2).max(500),
  promotionalMessage: z.string().trim().max(240).nullable().optional(),
  ctaLabel: z.string().trim().min(2).max(80),
  destinationUrl: z.string().trim().min(1).max(2048).refine((value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'), 'Destination must be a same-site path.'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(false),
})
const slugFields = {
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
}
const leagueSchema = z.object({
  ...slugFields,
  country: z.string().trim().min(2).max(80),
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/),
  season: z.string().trim().min(4).max(20),
  active: z.boolean().default(true),
})
const teamSchema = z.object({ ...slugFields, active: z.boolean().default(true) })
const jerseyCategorySchema = z.object({ ...slugFields, active: z.boolean().default(true) })
export const homepageSlideSchema = homepageSlideFieldsSchema
export const homepageSlideBatchSchema = z.array(homepageSlideFieldsSchema).min(1).max(20)
const patchHomepageSlideSchema = homepageSlideFieldsSchema.partial().refine((value) => Object.keys(value).length > 0)

export function isDuplicateKeyError(error: unknown): boolean {
  let current = error
  const visited = new Set<object>()
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current)
    const candidate = current as { code?: unknown; errno?: unknown; cause?: unknown }
    if (candidate.code === '23505' || candidate.code === 'ER_DUP_ENTRY' || candidate.errno === 1062) return true
    current = candidate.cause
  }
  return false
}

adminRouter.get('/products', async (_request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
    return
  }
  const [rows, variants, images, videos, leagueRows, teamRows, jerseyCategoryRows] = await Promise.all([
    db.select().from(products).orderBy(asc(products.name)),
    db.select().from(productVariants),
    db.select().from(productImages).orderBy(asc(productImages.sortOrder)),
    db.select().from(productVideos).orderBy(asc(productVideos.sortOrder)),
    db.select().from(leagues),
    db.select().from(teams),
    db.select().from(jerseyCategories),
  ])
  const leagueById = new Map(leagueRows.map((league) => [league.id, league]))
  const teamById = new Map(teamRows.map((team) => [team.id, team]))
  const jerseyCategoryById = new Map(jerseyCategoryRows.map((category) => [category.id, category]))
  const imagesByProduct = new Map<number, typeof images>()
  for (const image of images) {
    const current = imagesByProduct.get(image.productId) ?? []
    current.push(image)
    imagesByProduct.set(image.productId, current)
  }
  const videosByProduct = new Map<number, typeof videos>()
  for (const video of videos) {
    const current = videosByProduct.get(video.productId) ?? []
    current.push(video)
    videosByProduct.set(video.productId, current)
  }
  const variantsByProduct = new Map<number, typeof variants>()
  for (const variant of variants) {
    const current = variantsByProduct.get(variant.productId) ?? []
    current.push(variant)
    variantsByProduct.set(variant.productId, current)
  }
  response.json({ data: rows.map((product) => ({
    ...product,
    team: product.teamId ? teamById.get(product.teamId) ?? null : null,
    league: product.teamId ? leagueById.get(teamById.get(product.teamId)?.leagueId ?? -1) ?? null : null,
    jerseyCategory: product.jerseyCategoryId ? jerseyCategoryById.get(product.jerseyCategoryId) ?? null : null,
    variants: variantsByProduct.get(product.id) ?? [],
    images: imagesByProduct.get(product.id) ?? [],
    videos: videosByProduct.get(product.id) ?? [],
  })) })
})

adminRouter.get('/catalogue-options', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  const [leagueRows, teamRows, jerseyCategoryRows] = await Promise.all([
    db.select().from(leagues).orderBy(asc(leagues.sortOrder), asc(leagues.name)),
    db.select().from(teams).orderBy(asc(teams.sortOrder), asc(teams.name)),
    db.select().from(jerseyCategories).orderBy(asc(jerseyCategories.sortOrder), asc(jerseyCategories.name)),
  ])
  response.json({ data: { leagues: leagueRows, teams: teamRows, jerseyCategories: jerseyCategoryRows } })
})

adminRouter.post('/leagues', async (request, response) => {
  const input = leagueSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_LEAGUE', message: 'League details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  let created: { id: number }
  try {
    [created] = await db.insert(leagues).values(input.data).returning({ id: leagues.id })
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    return response.status(409).json({ error: { code: 'LEAGUE_EXISTS', message: 'A league with that slug already exists.' } })
  }
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'league.created', 'league', String(created.id))
  response.status(201).json({ data: { id: created.id } })
})

adminRouter.post('/leagues/:id/teams', async (request, response) => {
  const leagueId = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = teamSchema.safeParse(request.body)
  if (!leagueId.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_TEAM', message: 'Team details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  const [league] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId.data)).limit(1)
  if (!league) return response.status(404).json({ error: { code: 'LEAGUE_NOT_FOUND', message: 'League not found.' } })
  let created: { id: number }
  try {
    [created] = await db.insert(teams).values({ ...input.data, leagueId: leagueId.data }).returning({ id: teams.id })
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    return response.status(409).json({ error: { code: 'TEAM_EXISTS', message: 'That team already exists in this league.' } })
  }
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'team.created', 'team', String(created.id))
  response.status(201).json({ data: { id: created.id } })
})

adminRouter.post('/jersey-categories', async (request, response) => {
  const input = jerseyCategorySchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_JERSEY_CATEGORY', message: 'Jersey category details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  let created: { id: number }
  try {
    [created] = await db.insert(jerseyCategories).values(input.data).returning({ id: jerseyCategories.id })
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    return response.status(409).json({ error: { code: 'JERSEY_CATEGORY_EXISTS', message: 'A jersey category with that slug already exists.' } })
  }
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'jersey_category.created', 'jersey_category', String(created.id))
  response.status(201).json({ data: { id: created.id } })
})

adminRouter.post('/products/:id/images', express.raw({ type: 'application/octet-stream', limit: '8mb' }), async (request, response) => {
  const productId = z.coerce.number().int().positive().safeParse(request.params.id)
  const altText = z.string().trim().min(2).max(240).safeParse(request.get('x-image-alt') ?? '')
  if (!productId.success || !altText.success || !Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: { code: 'INVALID_IMAGE_UPLOAD', message: 'Provide a product id, image file, and descriptive alt text.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
    return
  }
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId.data)).limit(1)
  if (!product) {
    response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
    return
  }

  let asset: Awaited<ReturnType<typeof uploadProductImage>>
  try {
    asset = await uploadProductImage(productId.data, request.body)
  } catch (error) {
    if (!(error instanceof ImageStorageError)) throw error
    response.status(error.statusCode).json({ error: { code: 'IMAGE_UPLOAD_FAILED', message: error.message } })
    return
  }
  const existingImages = await db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId.data))
  const isPrimary = existingImages.length === 0
  try {
    const [{ id }] = await db.insert(productImages).values({
      productId: productId.data,
      publicId: asset.public_id,
      imageUrl: asset.secure_url,
      format: asset.format,
      byteSize: asset.bytes,
      width: asset.width,
      height: asset.height,
      altText: altText.data,
      sortOrder: existingImages.length,
      isPrimary,
    }).returning({ id: productImages.id })
    if (isPrimary) await db.update(products).set({ imageUrl: asset.secure_url }).where(eq(products.id, productId.data))
    const actor = authenticatedAdmin(request)
    if (actor) await recordAdminAudit(actor.id, 'product.image_uploaded', 'product', String(productId.data))
    return response.status(201).json({ data: { id, url: asset.secure_url, altText: altText.data, sortOrder: existingImages.length, isPrimary } })
  } catch (error) {
    try {
      await deleteProductImage(asset.public_id)
    } catch (cleanupError) {
      request.log.error({ err: cleanupError, productId: productId.data }, 'Failed to clean up image after metadata write failed')
    }
    throw error
  }
})

adminRouter.patch('/products/:id/images/:imageId', async (request, response) => {
  const productId = z.coerce.number().int().positive().safeParse(request.params.id)
  const imageId = z.coerce.number().int().positive().safeParse(request.params.imageId)
  const input = z.object({
    altText: z.string().trim().min(2).max(240).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isPrimary: z.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0).safeParse(request.body)
  if (!productId.success || !imageId.success || !input.success) {
    response.status(400).json({ error: { code: 'INVALID_IMAGE_UPDATE', message: 'Image update details are invalid.' } })
    return
  }
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  const [image] = await db.select().from(productImages)
    .where(and(eq(productImages.id, imageId.data), eq(productImages.productId, productId.data))).limit(1)
  if (!image) return response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'Product image not found.' } })
  if (image.isPrimary && input.data.isPrimary === false) {
    return response.status(400).json({ error: { code: 'PRIMARY_IMAGE_REQUIRED', message: 'Choose another primary image before unsetting this one.' } })
  }

  await db.transaction(async (transaction) => {
    if (input.data.isPrimary) {
      await transaction.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId.data))
    }
    await transaction.update(productImages).set(input.data).where(eq(productImages.id, image.id))
    if (input.data.isPrimary) {
      await transaction.update(products).set({ imageUrl: image.imageUrl }).where(eq(products.id, productId.data))
    }
  })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.image_updated', 'product', String(productId.data))
  response.json({ data: { id: image.id } })
})

adminRouter.delete('/products/:id/images/:imageId', async (request, response) => {
  const productId = z.coerce.number().int().positive().safeParse(request.params.id)
  const imageId = z.coerce.number().int().positive().safeParse(request.params.imageId)
  if (!productId.success || !imageId.success) return response.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'Image reference is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  const [image] = await db.select().from(productImages)
    .where(and(eq(productImages.id, imageId.data), eq(productImages.productId, productId.data))).limit(1)
  if (!image) return response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'Product image not found.' } })
  try {
    await deleteProductImage(image.publicId)
  } catch (error) {
    if (!(error instanceof ImageStorageError)) throw error
    return response.status(error.statusCode).json({ error: { code: 'IMAGE_DELETE_FAILED', message: error.message } })
  }

  await db.transaction(async (transaction) => {
    await transaction.delete(productImages).where(eq(productImages.id, image.id))
    if (image.isPrimary) {
      const [next] = await transaction.select().from(productImages)
        .where(eq(productImages.productId, productId.data)).orderBy(asc(productImages.sortOrder)).limit(1)
      if (next) {
        await transaction.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, next.id))
      }
      await transaction.update(products).set({ imageUrl: next?.imageUrl ?? null }).where(eq(products.id, productId.data))
    }
  })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.image_deleted', 'product', String(productId.data))
  response.status(204).end()
})

adminRouter.post('/products/:id/videos', async (request, response) => {
  const productId = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = z.object({
    videoUrl: z.string().trim().url().max(2048).refine((value) => {
      try { return new URL(value).protocol === 'https:' } catch { return false }
    }, 'Use a secure HTTPS video URL.'),
    title: z.string().trim().min(2).max(240),
  }).safeParse(request.body)
  if (!productId.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_PRODUCT_VIDEO', message: 'Provide a secure video URL and descriptive title.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId.data)).limit(1)
  if (!product) return response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
  const existing = await db.select({ id: productVideos.id }).from(productVideos).where(eq(productVideos.productId, productId.data))
  const [{ id }] = await db.insert(productVideos).values({ ...input.data, productId: productId.data, sortOrder: existing.length }).returning({ id: productVideos.id })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.video_added', 'product', String(productId.data))
  response.status(201).json({ data: { id } })
})

adminRouter.delete('/products/:id/videos/:videoId', async (request, response) => {
  const productId = z.coerce.number().int().positive().safeParse(request.params.id)
  const videoId = z.coerce.number().int().positive().safeParse(request.params.videoId)
  if (!productId.success || !videoId.success) return response.status(400).json({ error: { code: 'INVALID_PRODUCT_VIDEO', message: 'Video reference is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
  const [video] = await db.select({ id: productVideos.id }).from(productVideos)
    .where(and(eq(productVideos.id, videoId.data), eq(productVideos.productId, productId.data))).limit(1)
  if (!video) return response.status(404).json({ error: { code: 'VIDEO_NOT_FOUND', message: 'Product video not found.' } })
  await db.delete(productVideos).where(eq(productVideos.id, video.id))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.video_deleted', 'product', String(productId.data))
  response.status(204).end()
})

adminRouter.get('/homepage', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage content services are unavailable.' } })
  const slides = await db.select().from(homepageSlides).orderBy(asc(homepageSlides.sortOrder), asc(homepageSlides.id))
  response.json({ data: slides })
})

adminRouter.get('/homepage/logo', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage branding is unavailable.' } })
  const [setting] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'brandLogoUrl')).limit(1)
  response.json({ data: { logoUrl: typeof setting?.value === 'string' ? setting.value : null } })
})

adminRouter.post('/homepage/logo', express.raw({ type: 'application/octet-stream', limit: '8mb' }), async (request, response) => {
  if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: { code: 'INVALID_IMAGE_UPLOAD', message: 'Choose a JPEG, PNG, or WebP logo image.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage branding is unavailable.' } })
  try {
    const asset = await uploadBrandLogoImage(request.body)
    await db.insert(applicationSettings).values({ key: 'brandLogoUrl', value: asset.secure_url, updatedBy: null })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value: asset.secure_url, updatedBy: null } })
    const actor = authenticatedAdmin(request)
    if (actor) await recordAdminAudit(actor.id, 'homepage.brand_logo_updated', 'homepage_branding', asset.public_id)
    response.status(201).json({ data: { logoUrl: asset.secure_url } })
  } catch (error) {
    if (!(error instanceof ImageStorageError)) throw error
    response.status(error.statusCode).json({ error: { code: 'IMAGE_UPLOAD_FAILED', message: error.message } })
  }
})

  adminRouter.get('/homepage/site-content', async (_request, response) => {
    if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Site content is unavailable.' } })
    const keys = ['terms', 'privacy', 'kitzFooterDescription', 'kitzFooterCopyright', 'platformFooterNotice', 'platformFacebookUrl', 'platformXUrl', 'platformYoutubeUrl', 'platformWhatsappPhone', 'platformContactEmail', 'platformContactPhone'].map((field) => `siteContent:${field}`)
    const settings = await db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
      .where(inArray(applicationSettings.key, keys))
    const content = Object.fromEntries(settings.flatMap(({ key, value }) => {
      const field = key.replace(/^siteContent:/, '')
      return isSiteContentField(field) && typeof value === 'string' ? [[field, value]] : []
    }))
    response.json({ data: content })
  })

  adminRouter.put('/homepage/site-content', async (request, response) => {
    const input = siteContentSchema.safeParse(request.body)
    if (!input.success) return response.status(400).json({ error: { code: 'INVALID_SITE_CONTENT', message: 'Site content fields exceed their allowed lengths or contain unsupported fields.' } })
    const database = db
    if (!database) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Site content is unavailable.' } })
    await database.transaction(async (transaction) => {
      for (const [field, value] of Object.entries(input.data)) {
        await transaction.insert(applicationSettings)
          .values({ key: `siteContent:${field}`, value, updatedBy: null })
          .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: null } })
      }
    })
    const actor = authenticatedAdmin(request)
    if (actor) await recordAdminAudit(actor.id, 'site.content_updated', 'site_content', 'legal_and_footer')
    response.json({ data: { updated: true } })
  })

  adminRouter.get('/homepage/site-images', async (_request, response) => {
    if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage image settings are unavailable.' } })
    const settings = await db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
      .where(inArray(applicationSettings.key, siteImageSlotKeys.map((slot) => `siteImage:${slot}`)))
    const images = Object.fromEntries(settings.flatMap(({ key, value }) => {
      const slot = key.replace(/^siteImage:/, '')
      return siteImageSlotKeys.includes(slot as typeof siteImageSlotKeys[number]) && isSiteImageUrl(value) ? [[slot, value]] : []
    }))
    response.json({ data: images })
  })

  adminRouter.post('/homepage/site-images/:slot', express.raw({ type: 'application/octet-stream', limit: '8mb' }), async (request, response) => {
    const slot = z.enum(siteImageSlotKeys).safeParse(request.params.slot)
    if (!slot.success || !Buffer.isBuffer(request.body)) return response.status(400).json({ error: { code: 'INVALID_SITE_IMAGE', message: 'Choose a supported site image and a JPEG, PNG, or WebP file.' } })
    if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage image settings are unavailable.' } })
    try {
      const asset = await uploadSiteImage(slot.data, request.body)
      await db.insert(applicationSettings).values({ key: `siteImage:${slot.data}`, value: asset.secure_url, updatedBy: null })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value: asset.secure_url, updatedBy: null } })
      const actor = authenticatedAdmin(request)
      if (actor) await recordAdminAudit(actor.id, 'homepage.site_image_updated', 'site_image', slot.data)
      response.status(201).json({ data: { slot: slot.data, imageUrl: asset.secure_url } })
    } catch (error) {
      if (!(error instanceof ImageStorageError)) throw error
      response.status(error.statusCode).json({ error: { code: 'IMAGE_UPLOAD_FAILED', message: error.message } })
    }
  })

  adminRouter.delete('/homepage/site-images/:slot', async (request, response) => {
    const slot = z.enum(siteImageSlotKeys).safeParse(request.params.slot)
    if (!slot.success) return response.status(400).json({ error: { code: 'INVALID_SITE_IMAGE', message: 'Choose a supported site image.' } })
    if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage image settings are unavailable.' } })
    await db.delete(applicationSettings).where(eq(applicationSettings.key, `siteImage:${slot.data}`))
    const actor = authenticatedAdmin(request)
    if (actor) await recordAdminAudit(actor.id, 'homepage.site_image_reset', 'site_image', slot.data)
    response.status(204).end()
  })

  adminRouter.post('/homepage/slides/image', express.raw({ type: 'application/octet-stream', limit: '8mb' }), async (request, response) => {
  if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: { code: 'INVALID_IMAGE_UPLOAD', message: 'Choose a JPEG, PNG, or WebP image.' } })
  try {
    const asset = await uploadHomepageSlideImage(request.body)
    const actor = authenticatedAdmin(request)
    if (actor) await recordAdminAudit(actor.id, 'homepage.slide_image_uploaded', 'homepage_slide_image', asset.public_id)
    response.status(201).json({ data: { imageUrl: asset.secure_url } })
  } catch (error) {
    if (!(error instanceof ImageStorageError)) throw error
    response.status(error.statusCode).json({ error: { code: 'IMAGE_UPLOAD_FAILED', message: error.message } })
  }
})

adminRouter.post('/homepage/slides', async (request, response) => {
  const input = homepageSlideSchema.safeParse(request.body)
  if (!input.success) {
    const details = input.error.issues.map((issue) => `${issue.path.join('.') || 'slide'}: ${issue.message}`).join(' ')
    return response.status(400).json({ error: { code: 'INVALID_SLIDE', message: `Homepage slide details are invalid. ${details}` } })
  }
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage content services are unavailable.' } })
  const [created] = await db.insert(homepageSlides).values(input.data).returning({ id: homepageSlides.id })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'homepage.slide_created', 'homepage_slide', String(created.id))
  response.status(201).json({ data: { id: created.id } })
})

adminRouter.post('/homepage/slides/batch', async (request, response) => {
  const input = homepageSlideBatchSchema.safeParse(request.body)
  if (!input.success) {
    const details = input.error.issues.map((issue) => `${issue.path.join('.') || 'slides'}: ${issue.message}`).join(' ')
    return response.status(400).json({ error: { code: 'INVALID_SLIDE_BATCH', message: `Homepage slides are invalid. ${details}` } })
  }
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage content services are unavailable.' } })
  const created = await db.insert(homepageSlides).values(input.data).returning({ id: homepageSlides.id })
  const actor = authenticatedAdmin(request)
  if (actor) await Promise.all(created.map((slide) => recordAdminAudit(actor.id, 'homepage.slide_created', 'homepage_slide', String(slide.id))))
  response.status(201).json({ data: { ids: created.map((slide) => slide.id), count: created.length } })
})

adminRouter.patch('/homepage/slides/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = patchHomepageSlideSchema.safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_SLIDE', message: 'Homepage slide update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage content services are unavailable.' } })
  const [existing] = await db.select().from(homepageSlides).where(eq(homepageSlides.id, id.data)).limit(1)
  if (!existing) return response.status(404).json({ error: { code: 'SLIDE_NOT_FOUND', message: 'Homepage slide not found.' } })
  await db.update(homepageSlides).set(input.data).where(eq(homepageSlides.id, id.data))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'homepage.slide_updated', 'homepage_slide', String(id.data))
  response.json({ data: { id: id.data } })
})

adminRouter.delete('/homepage/slides/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(400).json({ error: { code: 'INVALID_SLIDE', message: 'Homepage slide id is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Homepage content services are unavailable.' } })
  const [existing] = await db.select({ id: homepageSlides.id }).from(homepageSlides).where(eq(homepageSlides.id, id.data)).limit(1)
  if (!existing) return response.status(404).json({ error: { code: 'SLIDE_NOT_FOUND', message: 'Homepage slide not found.' } })
  await db.delete(homepageSlides).where(eq(homepageSlides.id, id.data))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'homepage.slide_deleted', 'homepage_slide', String(id.data))
  response.status(204).end()
})

adminRouter.post('/products', async (request, response) => {
  const input = createProductSchema.safeParse(request.body)
  if (!input.success) {
    const details = input.error.issues
      .map((issue) => `${issue.path.join('.') || 'product'}: ${issue.message}`)
      .join(' ')
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: `Product details are invalid. ${details}` } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
    return
  }
  if (input.data.categoryId) {
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, input.data.categoryId)).limit(1)
    if (!category) {
      response.status(400).json({ error: { code: 'INVALID_CATEGORY', message: 'Choose an existing category.' } })
      return
    }
  }
  if (input.data.teamId) {
    const [team] = await db.select({ id: teams.id, leagueId: teams.leagueId, active: teams.active }).from(teams).where(eq(teams.id, input.data.teamId)).limit(1)
    if (!team || !team.active || input.data.leagueId !== team.leagueId) {
      response.status(400).json({ error: { code: 'INVALID_TEAM', message: 'Choose an active team from the selected league.' } })
      return
    }
  } else if (input.data.leagueId) {
    response.status(400).json({ error: { code: 'INVALID_TEAM', message: 'Choose a team from the selected league.' } })
    return
  }
  if (input.data.jerseyCategoryId) {
    const [jerseyCategory] = await db.select({ id: jerseyCategories.id, active: jerseyCategories.active }).from(jerseyCategories)
      .where(eq(jerseyCategories.id, input.data.jerseyCategoryId)).limit(1)
    if (!jerseyCategory || !jerseyCategory.active) {
      response.status(400).json({ error: { code: 'INVALID_JERSEY_CATEGORY', message: 'Choose an active jersey category.' } })
      return
    }
  }

  const [existingProduct] = await db.select({ id: products.id }).from(products)
    .where(eq(products.slug, input.data.slug)).limit(1)
  if (existingProduct) {
    response.status(409).json({ error: { code: 'PRODUCT_SLUG_EXISTS', message: 'This kit is already in the catalogue. Manage the existing product or change the team, season, or jersey type if this is a different kit.' } })
    return
  }

  let productId: number
  try {
    productId = await db.transaction(async (transaction) => {
    const [created] = await transaction.insert(products).values({
      name: input.data.name,
      slug: input.data.slug,
      description: input.data.description,
      price: input.data.price,
      salePrice: input.data.salePrice ?? null,
      cost: input.data.cost ?? null,
      season: input.data.season ?? null,
      productType: input.data.productType ?? null,
      categoryId: input.data.categoryId ?? null,
      teamId: input.data.teamId ?? null,
      jerseyCategoryId: input.data.jerseyCategoryId ?? null,
      imageUrl: input.data.imageUrl ?? null,
      featured: input.data.featured,
      published: input.data.published,
      trending: input.data.trending,
    }).returning({ id: products.id })
    await transaction.insert(productVariants).values(input.data.variants.map((variant) => ({ ...variant, productId: created.id })))
    if (input.data.variants.some((variant) => variant.stock > 0)) {
      const createdVariants = await transaction.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants).where(eq(productVariants.productId, created.id))
      const movementRows = createdVariants.flatMap((createdVariant) => {
        const requested = input.data.variants.find((variant) => variant.sku === createdVariant.sku)
        return requested?.stock ? [{ variantId: createdVariant.id, movementType: 'restock' as const, quantityChange: requested.stock, note: 'Initial catalogue quantity' }] : []
      })
      await transaction.insert(inventoryMovements).values(movementRows)
    }
    return created.id
    })
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    response.status(409).json({ error: { code: 'PRODUCT_CONFLICT', message: 'A product slug or variant SKU is already in use. Change the product name or sizes and try again.' } })
    return
  }
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.created', 'product', String(productId))
  response.status(201).json({ data: { id: productId } })
})

adminRouter.patch('/products/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = patchProductSchema.safeParse(request.body)
  if (!id.success || !input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Product update is invalid.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
    return
  }
  const [existing] = await db.select({
    id: products.id,
    price: products.price,
    salePrice: products.salePrice,
    teamId: products.teamId,
    leagueId: teams.leagueId,
  }).from(products).leftJoin(teams, eq(products.teamId, teams.id)).where(eq(products.id, id.data)).limit(1)
  if (!existing) {
    response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
    return
  }
  const effectiveSalePrice = input.data.salePrice === undefined ? existing.salePrice : input.data.salePrice
  const effectiveRegularPrice = input.data.price ?? existing.price
  if (effectiveSalePrice && Number(effectiveSalePrice) >= Number(effectiveRegularPrice)) {
    response.status(400).json({ error: { code: 'INVALID_SALE_PRICE', message: 'Sale price must be less than the regular price.' } })
    return
  }
  const effectiveTeamId = input.data.teamId === undefined ? existing.teamId : input.data.teamId
  const effectiveLeagueId = input.data.leagueId === undefined ? existing.leagueId : input.data.leagueId
  if (effectiveTeamId) {
    const [team] = await db.select({ id: teams.id, leagueId: teams.leagueId }).from(teams).where(eq(teams.id, effectiveTeamId)).limit(1)
    if (!team || team.leagueId !== effectiveLeagueId) {
      response.status(400).json({ error: { code: 'INVALID_TEAM', message: 'Choose a team from the selected league.' } })
      return
    }
  } else if (effectiveLeagueId) {
    response.status(400).json({ error: { code: 'INVALID_TEAM', message: 'Choose a team from the selected league.' } })
    return
  }
  if (input.data.jerseyCategoryId) {
    const [jerseyCategory] = await db.select({ id: jerseyCategories.id, active: jerseyCategories.active }).from(jerseyCategories)
      .where(eq(jerseyCategories.id, input.data.jerseyCategoryId)).limit(1)
    if (!jerseyCategory || !jerseyCategory.active) {
      response.status(400).json({ error: { code: 'INVALID_JERSEY_CATEGORY', message: 'Choose an active jersey category.' } })
      return
    }
  }
  const { leagueId: _leagueId, ...productChanges } = input.data
  await db.update(products).set(productChanges).where(eq(products.id, id.data))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.updated', 'product', String(id.data))
  response.json({ data: { id: id.data } })
})

adminRouter.delete('/products/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Product id is invalid.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Catalogue services are not configured.' } })
    return
  }
  await db.update(products).set({ published: false }).where(eq(products.id, id.data))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'product.unpublished', 'product', String(id.data))
  response.status(204).end()
})

adminRouter.post('/products/:id/variants/:variantId/stock', async (request, response) => {
  const productId = z.coerce.number().int().positive().safeParse(request.params.id)
  const variantId = z.coerce.number().int().positive().safeParse(request.params.variantId)
  const input = stockSchema.safeParse(request.body)
  if (!productId.success || !variantId.success || !input.success) {
    response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Stock adjustment is invalid.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Inventory services are not configured.' } })
    return
  }
  const result = await db.transaction(async (transaction) => {
    const updated = await transaction.update(productVariants).set({ stock: sql`${productVariants.stock} + ${input.data.delta}` })
      .where(and(eq(productVariants.id, variantId.data), eq(productVariants.productId, productId.data), sql`${productVariants.stock} + ${input.data.delta} >= 0`))
      .returning({ id: productVariants.id })
    if (updated.length !== 1) return null
    const [variant] = await transaction.select({ stock: productVariants.stock }).from(productVariants).where(eq(productVariants.id, variantId.data)).limit(1)
    await transaction.insert(inventoryMovements).values({ variantId: variantId.data, movementType: 'adjustment', quantityChange: input.data.delta, note: input.data.note ?? null })
    return variant.stock
  })
  if (result === null) {
    response.status(409).json({ error: { code: 'STOCK_CONFLICT', message: 'The variant is missing or the adjustment would make stock negative.' } })
    return
  }
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'inventory.adjusted', 'variant', String(variantId.data))
  response.json({ data: { variantId: variantId.data, stock: result } })
})

adminRouter.get('/categories', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Category services are unavailable.' } })
  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name))
  response.json({ data: rows })
})

adminRouter.post('/categories', async (request, response) => {
  const input = categorySchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Category details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Category services are unavailable.' } })
  const [{ id }] = await db.insert(categories).values(input.data).returning({ id: categories.id })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'category.created', 'category', String(id))
  response.status(201).json({ data: { id } })
})

adminRouter.patch('/categories/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = categorySchema.partial().refine((value) => Object.keys(value).length > 0).safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Category update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Category services are unavailable.' } })
  await db.update(categories).set(input.data).where(eq(categories.id, id.data))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'category.updated', 'category', String(id.data))
  response.json({ data: { id: id.data } })
})

adminRouter.get('/orders', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order services are unavailable.' } })
  const rows = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, status: orders.status, paymentMethod: orders.paymentMethod, total: orders.total,
    subtotal: orders.subtotal, deliveryFee: orders.deliveryFee, createdAt: orders.createdAt,
    customerName: sql<string | null>`COALESCE(${users.fullName}, jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'recipientName'))`,
    customerEmail: sql<string | null>`COALESCE(${users.email}, jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'email'))`,
  }).from(orders).leftJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt)).limit(200)
  const paymentRows = rows.length ? await db.select({ orderId: payments.orderId, status: payments.status }).from(payments)
    .where(inArray(payments.orderId, rows.map(({ id }) => id))).orderBy(desc(payments.createdAt)) : []
  const latestPaymentByOrder = new Map<number, typeof paymentRows[number]['status']>()
  for (const payment of paymentRows) {
    if (!latestPaymentByOrder.has(payment.orderId)) latestPaymentByOrder.set(payment.orderId, payment.status)
  }
  response.json({ data: rows.map((order) => ({ ...order, paymentStatus: latestPaymentByOrder.get(order.id) ?? null })) })
})

adminRouter.get('/guest-orders', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Guest order services are unavailable.' } })
  const guestOrders = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    paymentMethod: orders.paymentMethod,
    total: orders.total,
    subtotal: orders.subtotal,
    deliveryFee: orders.deliveryFee,
    createdAt: orders.createdAt,
    customerName: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'recipientName')`,
    customerEmail: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'email')`,
    customerPhone: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'phone')`,
    address: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'address')`,
    town: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'town')`,
    county: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'county')`,
    estate: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'estate')`,
    landmark: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'landmark')`,
    deliveryZone: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'deliveryZone')`,
    latitude: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'latitude')`,
    longitude: sql<string | null>`jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'longitude')`,
  }).from(orders).where(isNull(orders.userId)).orderBy(desc(orders.createdAt)).limit(250)
  const orderIds = guestOrders.map(({ id }) => id)
  const [paymentRows, itemRows] = orderIds.length ? await Promise.all([
    db.select({
      orderId: payments.orderId,
      status: payments.status,
      amount: payments.amount,
      providerReceipt: payments.providerReceipt,
      payerPhone: payments.payerPhone,
      transactionAt: payments.transactionAt,
      verificationMessage: payments.verificationMessage,
      createdAt: payments.createdAt,
    }).from(payments).where(and(inArray(payments.orderId, orderIds), eq(payments.provider, 'mpesa'))).orderBy(desc(payments.createdAt)),
    db.select({
      orderId: orderItems.orderId,
      name: orderItems.productNameSnapshot,
      size: orderItems.sizeSnapshot,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
    }).from(orderItems).where(inArray(orderItems.orderId, orderIds)),
  ]) : [[], []]
  const latestPaymentByOrder = new Map<number, typeof paymentRows[number]>()
  for (const payment of paymentRows) if (!latestPaymentByOrder.has(payment.orderId)) latestPaymentByOrder.set(payment.orderId, payment)
  const itemsByOrder = new Map<number, typeof itemRows>()
  for (const item of itemRows) itemsByOrder.set(item.orderId, [...(itemsByOrder.get(item.orderId) ?? []), item])
  response.json({ data: guestOrders.map((order) => ({
    ...order,
    items: itemsByOrder.get(order.id) ?? [],
    payment: latestPaymentByOrder.get(order.id) ?? null,
  })) })
})

adminRouter.patch('/orders/:id/status', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = z.object({ status: z.enum(['processing', 'dispatched', 'delivered', 'cancelled']) }).safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Order status update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order services are unavailable.' } })
  const result = await db.transaction(async (transaction) => {
    const [order] = await transaction.select({ status: orders.status, paymentMethod: orders.paymentMethod, userId: orders.userId, orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, id.data)).limit(1)
    if (!order) return 'missing' as const
    if (!canTransitionOrderStatus(order.status, input.data.status, order.paymentMethod)) return 'conflict' as const
    const updated = await transaction.update(orders).set({ status: input.data.status })
      .where(and(eq(orders.id, id.data), eq(orders.status, order.status)))
      .returning({ id: orders.id })
    if (updated.length !== 1) return 'conflict' as const
    if (input.data.status === 'cancelled') {
      const reservations = await transaction.select({
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
      }).from(orderItems).where(eq(orderItems.orderId, id.data))
      for (const reservation of reservations) {
        if (reservation.variantId === null) continue
        await transaction.update(productVariants)
          .set({ stock: sql`${productVariants.stock} + ${reservation.quantity}` })
          .where(eq(productVariants.id, reservation.variantId))
        await transaction.insert(inventoryMovements).values({
          variantId: reservation.variantId,
          movementType: 'release',
          quantityChange: reservation.quantity,
          note: `Released from cancelled order ${id.data}`,
        })
      }
    }
    const statusLabel = input.data.status === 'processing' ? 'being prepared'
      : input.data.status === 'dispatched' ? 'on the way'
        : input.data.status === 'delivered' ? 'delivered' : 'cancelled'
    const [{ id: notificationId }] = await transaction.insert(notificationCampaigns).values({
      type: 'order',
      title: input.data.status === 'delivered' ? 'Order delivered' : input.data.status === 'cancelled' ? 'Order cancelled' : 'Order update',
      body: `Your order ${order.orderNumber} is now ${statusLabel}.`,
      href: `/account/orders/${encodeURIComponent(order.orderNumber)}`,
      audienceType: 'system',
    }).returning({ id: notificationCampaigns.id })
    if (order.userId !== null) await transaction.insert(notificationRecipients).values({ campaignId: notificationId, userId: order.userId })
    return 'updated' as const
  })
  if (result === 'missing') return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })
  if (result === 'conflict') return response.status(409).json({ error: { code: 'ORDER_STATUS_CONFLICT', message: 'The order cannot make that status transition.' } })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, `order.${input.data.status}`, 'order', String(id.data))
  response.json({ data: { id: id.data, status: input.data.status } })
})

adminRouter.get('/customers', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Customer services are unavailable.' } })
  const rows = await db.select({
    id: users.id, fullName: users.fullName, email: users.email, phone: users.phone, createdAt: users.createdAt,
  }).from(users).orderBy(desc(users.createdAt)).limit(200)
  response.json({ data: rows })
})

adminRouter.get('/notifications', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Notification services are unavailable.' } })
  const data = await db.select({
    id: notificationCampaigns.id,
    type: notificationCampaigns.type,
    title: notificationCampaigns.title,
    body: notificationCampaigns.body,
    href: notificationCampaigns.href,
    audienceType: notificationCampaigns.audienceType,
    audienceUserId: notificationCampaigns.audienceUserId,
    createdAt: notificationCampaigns.createdAt,
    recipientCount: sql<number>`count(${notificationRecipients.id})`,
    unreadCount: sql<number>`sum(case when ${notificationRecipients.readAt} is null then 1 else 0 end)`,
  }).from(notificationCampaigns).leftJoin(notificationRecipients, eq(notificationRecipients.campaignId, notificationCampaigns.id))
    .groupBy(notificationCampaigns.id, notificationCampaigns.type, notificationCampaigns.title, notificationCampaigns.body,
      notificationCampaigns.href, notificationCampaigns.audienceType, notificationCampaigns.audienceUserId, notificationCampaigns.createdAt)
    .orderBy(desc(notificationCampaigns.createdAt)).limit(100)
  response.json({ data })
})

adminRouter.post('/notifications', async (request, response) => {
  const input = adminNotificationSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_NOTIFICATION', message: 'Check the notification details and audience.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Notification services are unavailable.' } })
  const actor = authenticatedAdmin(request)
  const recipientIds = input.data.audience === 'customer'
    ? await db.select({ id: users.id }).from(users).where(eq(users.id, input.data.customerId!))
    : await db.select({ id: users.id }).from(users)
  if (recipientIds.length === 0) return response.status(404).json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'The selected customer no longer exists.' } })
  const campaignId = await db.transaction(async (transaction) => {
    const [{ id }] = await transaction.insert(notificationCampaigns).values({
      type: 'announcement',
      title: input.data.title,
      body: input.data.body,
      href: input.data.href ?? null,
      audienceType: input.data.audience,
      audienceUserId: input.data.customerId ?? null,
      createdByAdminId: actor?.id ?? null,
    }).returning({ id: notificationCampaigns.id })
    for (let offset = 0; offset < recipientIds.length; offset += 500) {
      await transaction.insert(notificationRecipients).values(recipientIds.slice(offset, offset + 500).map(({ id: userId }) => ({ campaignId: id, userId })))
    }
    return id
  })
  if (actor) await recordAdminAudit(actor.id, 'notification.sent', 'notification', String(campaignId))
  response.status(201).json({ data: { id: campaignId, recipientCount: recipientIds.length } })
})

adminRouter.delete('/notifications/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Notification services are unavailable.' } })
  const deleted = await db.delete(notificationCampaigns).where(and(
    eq(notificationCampaigns.id, id.data),
    eq(notificationCampaigns.type, 'announcement'),
  )).returning({ id: notificationCampaigns.id })
  if (deleted.length !== 1) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Announcement not found.' } })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'notification.retracted', 'notification', String(id.data))
  response.status(204).end()
})

adminRouter.get('/support', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Support services are unavailable.' } })
  const requests = await db.select({
    id: supportRequests.id,
    customerId: supportRequests.userId,
    customerName: users.fullName,
    customerEmail: users.email,
    orderNumber: orders.orderNumber,
    category: supportRequests.category,
    subject: supportRequests.subject,
    message: supportRequests.message,
    status: supportRequests.status,
    adminResponse: supportRequests.adminResponse,
    createdAt: supportRequests.createdAt,
    updatedAt: supportRequests.updatedAt,
  }).from(supportRequests).innerJoin(users, eq(supportRequests.userId, users.id))
    .leftJoin(orders, eq(supportRequests.orderId, orders.id))
    .orderBy(desc(supportRequests.updatedAt))
    .limit(250)
  const counts = await db.select({
    conversationId: supportMessages.supportRequestId,
    messageCount: count(),
    unreadCount: sql<number>`SUM(CASE WHEN ${supportMessages.senderType} = 'customer' AND ${supportMessages.readAt} IS NULL THEN 1 ELSE 0 END)`,
  }).from(supportMessages).groupBy(supportMessages.supportRequestId)
  const countByConversation = new Map(counts.map((entry) => [entry.conversationId, entry]))
  const data = requests.map((request) => ({
    ...request,
    messageCount: countByConversation.get(request.id)?.messageCount ?? 0,
    unreadCount: Number(countByConversation.get(request.id)?.unreadCount ?? 0),
  }))
  response.json({ data })
})

adminRouter.get('/support/events', (request, response) => {
  const actor = authenticatedAdmin(request)
  if (!actor) return response.status(401).end()
  response.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  registerAdminStream(actor.id, response)
})

adminRouter.patch('/support/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = supportUpdateSchema.safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_UPDATE', message: 'Support request update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Support services are unavailable.' } })
  const result = await db.transaction(async (transaction) => {
    const [existing] = await transaction.select({
      id: supportRequests.id,
      userId: supportRequests.userId,
      subject: supportRequests.subject,
      status: supportRequests.status,
      adminResponse: supportRequests.adminResponse,
    }).from(supportRequests).where(eq(supportRequests.id, id.data)).limit(1)
    if (!existing) return 'missing' as const

    const statusChanged = input.data.status !== undefined && input.data.status !== existing.status
    const responseChanged = input.data.adminResponse !== undefined && input.data.adminResponse !== existing.adminResponse
    await transaction.update(supportRequests).set(input.data).where(eq(supportRequests.id, id.data))

    if (statusChanged || (responseChanged && typeof input.data.adminResponse === 'string')) {
      const isReply = responseChanged && typeof input.data.adminResponse === 'string'
      const [{ id: notificationId }] = await transaction.insert(notificationCampaigns).values({
        type: 'support',
        title: isReply ? 'Support team replied' : 'Support request updated',
        body: isReply
          ? `The KitCulture team replied to your support request: ${existing.subject}.`
          : `Your support request ${existing.subject} is now ${input.data.status?.replaceAll('_', ' ')}.`,
        href: '/account/support',
        audienceType: 'system',
      }).returning({ id: notificationCampaigns.id })
      await transaction.insert(notificationRecipients).values({ campaignId: notificationId, userId: existing.userId })
    }
    return 'updated' as const
  })
  if (result === 'missing') return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support request not found.' } })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'support.request_updated', 'support_request', String(id.data))
  response.json({ data: { id: id.data } })
})

adminRouter.get('/support/:id/messages', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_REQUEST', message: 'Support conversation is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Support services are unavailable.' } })
  const [conversation] = await db.select({ id: supportRequests.id, customerId: supportRequests.userId }).from(supportRequests).where(eq(supportRequests.id, id.data)).limit(1)
  if (!conversation) return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support conversation not found.' } })
  const unreadMessages = await db.select({ id: supportMessages.id }).from(supportMessages).where(and(
    eq(supportMessages.supportRequestId, id.data),
    eq(supportMessages.senderType, 'customer'),
    isNull(supportMessages.readAt),
  ))
  if (unreadMessages.length) {
    const readAt = new Date()
    await db.update(supportMessages).set({ deliveredAt: readAt, readAt }).where(and(
      eq(supportMessages.supportRequestId, id.data),
      eq(supportMessages.senderType, 'customer'),
      isNull(supportMessages.readAt),
    ))
    publishMessageReceipt({ conversationId: id.data, customerId: conversation.customerId, senderType: 'customer' })
  }
  const data = await db.select({
    id: supportMessages.id,
    senderType: supportMessages.senderType,
    body: supportMessages.body,
    latitude: supportMessages.latitude,
    longitude: supportMessages.longitude,
    productName: supportMessages.productName,
    productPrice: supportMessages.productPrice,
    productImageUrl: supportMessages.productImageUrl,
    productUrl: supportMessages.productUrl,
    deliveredAt: supportMessages.deliveredAt,
    readAt: supportMessages.readAt,
    createdAt: supportMessages.createdAt,
  }).from(supportMessages).where(eq(supportMessages.supportRequestId, id.data)).orderBy(supportMessages.createdAt)
  response.json({ data })
})

adminRouter.post('/support/:id/messages', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = adminSupportMessageSchema.safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_MESSAGE', message: 'Enter a message and provide a complete, valid location pin if sharing one.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Support services are unavailable.' } })
  const [conversation] = await db.select({ id: supportRequests.id, customerId: supportRequests.userId, status: supportRequests.status, subject: supportRequests.subject }).from(supportRequests)
    .where(eq(supportRequests.id, id.data)).limit(1)
  if (!conversation) return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support conversation not found.' } })
  await db.transaction(async (transaction) => {
    await transaction.insert(supportMessages).values({
      supportRequestId: id.data,
      senderType: 'admin',
      body: input.data.body,
      latitude: input.data.latitude === undefined ? null : String(input.data.latitude),
      longitude: input.data.longitude === undefined ? null : String(input.data.longitude),
      productName: input.data.productName ?? null,
      productPrice: input.data.productPrice === undefined ? null : String(input.data.productPrice),
      productImageUrl: input.data.productImageUrl ?? null,
      productUrl: input.data.productUrl ?? null,
      deliveredAt: isCustomerOnline(conversation.customerId) ? new Date() : null,
    })
    await transaction.update(supportRequests).set({
      updatedAt: new Date(),
      ...(conversation.status === 'pending' || conversation.status === 'resolved' || conversation.status === 'closed'
        ? { status: 'in_progress' as const }
        : {}),
    }).where(eq(supportRequests.id, id.data))
    const [{ id: notificationId }] = await transaction.insert(notificationCampaigns).values({
      type: 'support',
      title: 'Support team replied',
      body: `The KitCulture team replied to your support request: ${conversation.subject}.`,
      href: '/account/support',
      audienceType: 'system',
    }).returning({ id: notificationCampaigns.id })
    await transaction.insert(notificationRecipients).values({ campaignId: notificationId, userId: conversation.customerId })
  })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'support.message_sent', 'support_request', String(id.data))
  publishChatMessage({ conversationId: id.data, customerId: conversation.customerId, senderType: 'admin' })
  if (isCustomerOnline(conversation.customerId)) publishMessageReceipt({ conversationId: id.data, customerId: conversation.customerId, senderType: 'admin' })
  response.status(201).json({ data: { sent: true } })
})

adminRouter.delete('/support/:id/messages/:messageId', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const messageId = z.coerce.number().int().positive().safeParse(request.params.messageId)
  if (!id.success || !messageId.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_MESSAGE', message: 'Chat message is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Support services are unavailable.' } })
  const [message] = await db.select({ id: supportMessages.id, senderType: supportMessages.senderType }).from(supportMessages)
    .where(and(eq(supportMessages.id, messageId.data), eq(supportMessages.supportRequestId, id.data))).limit(1)
  if (!message) return response.status(404).json({ error: { code: 'SUPPORT_MESSAGE_NOT_FOUND', message: 'Chat message not found.' } })
  if (message.senderType !== 'admin') return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own messages.' } })
  const [conversation] = await db.select({ customerId: supportRequests.userId }).from(supportRequests)
    .where(eq(supportRequests.id, id.data)).limit(1)
  if (!conversation) return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support conversation not found.' } })
  await db.delete(supportMessages).where(eq(supportMessages.id, message.id))
  await db.update(supportRequests).set({ updatedAt: new Date() }).where(eq(supportRequests.id, id.data))
  publishChatMessage({ conversationId: id.data, customerId: conversation.customerId, senderType: 'admin' })
  response.json({ data: { deleted: true } })
})

adminRouter.get('/inventory/movements', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Inventory services are unavailable.' } })
  const rows = await db.select({
    id: inventoryMovements.id, movementType: inventoryMovements.movementType, quantityChange: inventoryMovements.quantityChange,
    note: inventoryMovements.note, createdAt: inventoryMovements.createdAt, sku: productVariants.sku, size: productVariants.size,
    productName: products.name,
  }).from(inventoryMovements).innerJoin(productVariants, eq(inventoryMovements.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id)).orderBy(desc(inventoryMovements.createdAt)).limit(250)
  response.json({ data: rows })
})

adminRouter.get('/delivery/zones', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Delivery services are unavailable.' } })
  response.json({ data: await db.select().from(deliveryZones).orderBy(asc(deliveryZones.name)) })
})

adminRouter.post('/delivery/zones', async (request, response) => {
  const input = zoneSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Delivery area details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Delivery services are unavailable.' } })
  const [{ id }] = await db.insert(deliveryZones).values(input.data).returning({ id: deliveryZones.id })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'delivery_zone.created', 'delivery_zone', String(id))
  response.status(201).json({ data: { id } })
})

adminRouter.patch('/delivery/zones/:id', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = zoneSchema.partial().refine((value) => Object.keys(value).length > 0).safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Delivery area update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Delivery services are unavailable.' } })
  await db.update(deliveryZones).set(input.data).where(eq(deliveryZones.id, id.data))
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'delivery_zone.updated', 'delivery_zone', String(id.data))
  response.json({ data: { id: id.data } })
})

adminRouter.get('/payments', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Payment services are unavailable.' } })
  const rows = await db.select({
    orderNumber: orders.orderNumber, provider: payments.provider, status: payments.status, amount: payments.amount,
    providerReceipt: payments.providerReceipt, transactionAt: payments.transactionAt, payerPhone: payments.payerPhone,
    verificationMessage: payments.verificationMessage, providerResultCode: payments.providerResultCode,
    createdAt: payments.createdAt, id: payments.id, providerRequestId: payments.providerRequestId, merchantRequestId: payments.merchantRequestId,
  }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id))
    .where(eq(payments.status, 'succeeded')).orderBy(desc(payments.createdAt)).limit(250)
  response.json({ data: rows })
})

adminRouter.get('/expenses', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Financial services are unavailable.' } })
  const rows = await db.select({
    id: expenses.id, description: expenses.description, amount: expenses.amount, incurredAt: expenses.incurredAt,
    categoryName: expenseCategories.name,
  }).from(expenses).leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .orderBy(desc(expenses.incurredAt)).limit(500)
  response.json({ data: rows })
})

adminRouter.post('/expenses', async (request, response) => {
  const input = expenseSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Expense details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Financial services are unavailable.' } })
  const [{ id }] = await db.insert(expenses).values({
    ...input.data,
    incurredAt: new Date(input.data.incurredAt),
    categoryId: input.data.categoryId ?? null,
    createdBy: null,
  }).returning({ id: expenses.id })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'expense.created', 'expense', String(id))
  response.status(201).json({ data: { id } })
})

adminRouter.get('/reports/financial', async (request, response) => {
  const range = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).safeParse(request.query)
  if (!range.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Report date range is invalid.' } })
  const dateRange = resolveOptionalDateRange(range.data)
  if (!dateRange) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Report date range must be valid and no longer than 366 days.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Reporting services are unavailable.' } })
  const conditions = []
  const expenseConditions = []
  if (dateRange.from) {
    conditions.push(gte(orders.createdAt, dateRange.from))
    expenseConditions.push(gte(expenses.incurredAt, dateRange.from))
  }
  if (dateRange.toExclusive) {
    conditions.push(lt(orders.createdAt, dateRange.toExclusive))
    expenseConditions.push(lt(expenses.incurredAt, dateRange.toExclusive))
  }
  const [[sales], [costs], [expensesTotal]] = await Promise.all([
    db.select({ gross: sum(orders.subtotal), discounts: sum(orders.discount), paid: sum(payments.amount) })
      .from(orders).leftJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, 'succeeded')))
      .where(and(...conditions)),
    db.select({ cost: sum(sql`${products.cost} * ${orderItems.quantity}`) })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id)).where(and(...conditions)),
    db.select({ amount: sum(expenses.amount) }).from(expenses).where(and(...expenseConditions)),
  ])
  response.json({ data: {
    grossSales: sales.gross ?? '0.00',
    discounts: sales.discounts ?? '0.00',
    collectedPayments: sales.paid ?? '0.00',
    costOfGoodsSold: costs.cost ?? null,
    operatingExpenses: expensesTotal.amount ?? '0.00',
    profitAvailable: costs.cost !== null,
  } })
})

adminRouter.get('/finance/settings', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Finance settings are unavailable.' } })
  const rows = await db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
    .where(inArray(applicationSettings.key, ['mpesaTillName', 'mpesaTillNumber', 'mpesaMobileNumber']))
  response.json({ data: Object.fromEntries(rows.map(({ key, value }) => [key, value])) })
})

adminRouter.patch('/finance/settings', async (request, response) => {
  const input = financeSettingsSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_FINANCE_SETTINGS', message: 'Check the M-Pesa display name, Till number, and mobile number.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Finance settings are unavailable.' } })
  const actor = authenticatedAdmin(request)
  if (!actor) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
  await db.transaction(async (transaction) => {
    for (const [key, value] of Object.entries(input.data)) {
      await transaction.insert(applicationSettings).values({ key, value, updatedBy: null })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: null } })
    }
  })
  await recordAdminAudit(actor.id, 'finance.settings.updated', 'finance_settings', 'mpesa')
  response.json({ data: input.data })
})

adminRouter.get('/settings', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Settings services are unavailable.' } })
  const rows = await db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
  response.json({ data: Object.fromEntries(rows.map(({ key, value }) => [key, value])) })
})

adminRouter.patch('/settings', async (request, response) => {
  const input = settingsSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Business settings are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Settings services are unavailable.' } })
  await db.transaction(async (transaction) => {
    for (const [key, value] of Object.entries(input.data)) {
      await transaction.insert(applicationSettings).values({ key, value, updatedBy: null })
        .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: null } })
    }
  })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'settings.updated', 'settings', 'business')
  response.json({ data: input.data })
})

adminRouter.get('/audit', async (_request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator audit services are unavailable.' } })
  const actor = authenticatedAdmin(_request)
  if (!actor) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Administrator sign in is required.' } })
  const rows = await adminDb.select({
    id: adminAuditLogs.id, action: adminAuditLogs.action, targetType: adminAuditLogs.targetType, targetId: adminAuditLogs.targetId,
    createdAt: adminAuditLogs.createdAt, actorName: adminUsers.fullName, actorEmail: adminUsers.email,
  }).from(adminAuditLogs).leftJoin(adminUsers, eq(adminAuditLogs.adminUserId, adminUsers.id))
    .where(actor.role === 'super_admin' ? undefined : eq(adminAuditLogs.adminUserId, actor.id))
    .orderBy(desc(adminAuditLogs.createdAt)).limit(500)
  response.json({ data: rows })
})

async function activeItGrant(adminUserId: number) {
  if (!adminDb) return null
  const [grant] = await adminDb.select({ role: operationsOperators.role }).from(operationsOperators)
    .where(and(eq(operationsOperators.adminUserId, adminUserId), isNull(operationsOperators.revokedAt)))
    .limit(1)
  return grant?.role ? { role: grant.role } : null
}

async function requireItPermission(request: import('express').Request, response: import('express').Response, permission: ItPermission) {
  const actor = authenticatedAdmin(request)
  if (!actor || !adminDb) {
    response.status(503).json({ error: { code: 'IT_ACCESS_UNAVAILABLE', message: 'IT access is unavailable.' } })
    return false
  }
  let grant: Awaited<ReturnType<typeof activeItGrant>>
  try {
    grant = await activeItGrant(actor.id)
  } catch {
    logger.warn({ requestId: String(request.id) }, 'IT permission lookup failed; verify the admin database migrations')
    response.status(503).json({ error: { code: 'IT_ACCESS_UNAVAILABLE', message: 'IT access could not be verified. Confirm the admin database schema is up to date.' } })
    return false
  }
  if (!grant || !hasItPermission(grant.role, permission)) {
    response.status(403).json({ error: { code: 'IT_PERMISSION_REQUIRED', message: 'You do not have permission to access this IT resource.' } })
    return false
  }
  return grant.role
}

async function probeItDatabase(database: typeof pool, name: string) {
  if (!database) return { name, status: 'unavailable' as const, latencyMs: null }
  const startedAt = performance.now()
  try {
    await database.query('SELECT 1')
    return { name, status: 'healthy' as const, latencyMs: Number((performance.now() - startedAt).toFixed(1)) }
  } catch {
    return { name, status: 'unavailable' as const, latencyMs: null }
  }
}

adminRouter.get('/it/overview', async (request, response) => {
  const role = await requireItPermission(request, response, 'overview.read')
  if (!role) return
  const [storeProbe, adminProbe, incidentCounts] = await Promise.allSettled([
    probeItDatabase(pool, 'store'),
    adminPool === pool ? probeItDatabase(adminPool, 'admin') : probeItDatabase(adminPool, 'admin'),
    adminDb!.select({
      total: count(),
      open: sql<number>`COUNT(*) FILTER (WHERE ${operationsIncidents.status} = 'open')`,
      investigating: sql<number>`COUNT(*) FILTER (WHERE ${operationsIncidents.status} = 'investigating')`,
    }).from(operationsIncidents),
  ])
  const databaseProbes = [
    storeProbe.status === 'fulfilled' ? storeProbe.value : { name: 'store', status: 'unavailable' as const, latencyMs: null },
    adminProbe.status === 'fulfilled' ? adminProbe.value : { name: 'admin', status: 'unavailable' as const, latencyMs: null },
  ]
  const incidentSummary = incidentCounts.status === 'fulfilled'
    ? { status: 'available' as const, total: Number(incidentCounts.value[0]?.total ?? 0), open: Number(incidentCounts.value[0]?.open ?? 0), investigating: Number(incidentCounts.value[0]?.investigating ?? 0) }
    : { status: 'unavailable' as const, total: null, open: null, investigating: null }
  const memory = process.memoryUsage()
  response.json({ data: {
    access: { role, permissions: itPermissions.filter((permission) => hasItPermission(role, permission)) },
    application: { status: 'healthy', uptimeSeconds: Math.floor(process.uptime()), nodeVersion: process.version, memoryRssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
    databases: databaseProbes,
    requests: getRequestMetrics(),
    incidents: incidentSummary,
    coverage: {
      securityEvents: { status: 'not_configured' },
      vulnerabilities: { status: 'not_configured' },
      supportTickets: { status: 'not_configured' },
      backupMonitoring: { status: 'not_configured' },
    },
    externalServices: {
      render: { status: 'unknown', reason: 'No authorized Render telemetry is configured.' },
      cloudinary: { status: 'unknown', reason: 'No authorized Cloudinary health feed is configured.' },
      daraja: { status: 'unknown', reason: 'No safe provider health check is configured; no payment request was sent.' },
      email: { status: 'unknown', reason: 'Provider delivery health is not exposed as a live check.' },
    },
  } })
})

const itIncidentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().positive().optional(),
}).strict()

adminRouter.get('/it/incidents', async (request, response) => {
  if (!await requireItPermission(request, response, 'incidents.read')) return
  if (!adminDb) return response.status(503).json({ error: { code: 'IT_DATABASE_UNAVAILABLE', message: 'IT incident data is unavailable.' } })
  const query = itIncidentQuerySchema.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Incident pagination is invalid.' } })
  const rows = await adminDb.select({
    id: operationsIncidents.id,
    incidentNumber: operationsIncidents.incidentNumber,
    severity: operationsIncidents.severity,
    status: operationsIncidents.status,
    title: operationsIncidents.title,
    description: operationsIncidents.description,
    affectedComponent: operationsIncidents.affectedComponent,
    assignedAdminUserId: operationsIncidents.assignedAdminUserId,
    assignedOperationsUserId: operationsIncidents.assignedOperationsUserId,
    assigneeName: sql<string | null>`COALESCE(${adminUsers.fullName}, ${operationsUsers.fullName})`,
    rootCause: operationsIncidents.rootCause,
    resolutionNotes: operationsIncidents.resolutionNotes,
    detectedAt: operationsIncidents.detectedAt,
    resolvedAt: operationsIncidents.resolvedAt,
    createdAt: operationsIncidents.createdAt,
    updatedAt: operationsIncidents.updatedAt,
  }).from(operationsIncidents)
    .leftJoin(adminUsers, eq(operationsIncidents.assignedAdminUserId, adminUsers.id))
    .leftJoin(operationsUsers, eq(operationsIncidents.assignedOperationsUserId, operationsUsers.id))
    .where(query.data.cursor ? lt(operationsIncidents.id, query.data.cursor) : undefined)
    .orderBy(desc(operationsIncidents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

adminRouter.get('/it/administrators', async (request, response) => {
  if (!await requireItPermission(request, response, 'incidents.write')) return
  if (!adminDb) return response.status(503).json({ error: { code: 'IT_ACCESS_UNAVAILABLE', message: 'IT account data is unavailable.' } })
  const rows = await adminDb.select({ id: adminUsers.id, email: adminUsers.email, fullName: adminUsers.fullName })
    .from(adminUsers).where(isNotNull(adminUsers.emailVerifiedAt)).orderBy(asc(adminUsers.fullName)).limit(200)
  response.json({ data: rows })
})

const createItIncidentSchema = z.object({
  severity: z.enum(['P1', 'P2', 'P3', 'P4']),
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().min(10).max(4000),
  affectedComponent: z.enum(['website', 'api', 'database', 'payments', 'email', 'security', 'other']),
}).strict()

adminRouter.post('/it/incidents', async (request, response) => {
  const actor = authenticatedAdmin(request)
  const input = createItIncidentSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT', message: 'Incident details are invalid.' } })
  if (!actor || !await requireItPermission(request, response, 'incidents.write')) return
  if (!adminDb) return response.status(503).json({ error: { code: 'IT_DATABASE_UNAVAILABLE', message: 'IT incident data is unavailable.' } })
  const incidentNumber = `IT-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`
  const now = new Date()
  const id = await adminDb.transaction(async (transaction) => {
    const [{ id: incidentId }] = await transaction.insert(operationsIncidents).values({
      incidentNumber,
      severity: input.data.severity,
      status: 'open',
      title: input.data.title,
      description: input.data.description,
      affectedComponent: input.data.affectedComponent,
      createdByAdminUserId: actor.id,
      detectedAt: now,
    }).returning({ id: operationsIncidents.id })
    await transaction.insert(operationsIncidentEvents).values({
      incidentId,
      actorAdminUserId: actor.id,
      eventType: 'created',
      message: `Incident opened: ${input.data.title}`,
    })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: actor.id,
      actorType: 'admin',
      action: 'it_incident.created',
      targetType: 'incident',
      targetId: incidentNumber,
      details: JSON.stringify({ severity: input.data.severity, affectedComponent: input.data.affectedComponent }),
    })
    await transaction.insert(adminAuditLogs).values({ adminUserId: actor.id, action: 'it_incident.created', targetType: 'incident', targetId: incidentNumber })
    return incidentId
  })
  response.status(201).json({ data: { id, incidentNumber } })
})

const patchItIncidentSchema = z.object({
  severity: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
  assignedAdminUserId: z.number().int().positive().nullable().optional(),
  rootCause: z.string().trim().max(4000).nullable().optional(),
  resolutionNotes: z.string().trim().max(4000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

adminRouter.patch('/it/incidents/:id', async (request, response) => {
  const actor = authenticatedAdmin(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = patchItIncidentSchema.safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_UPDATE', message: 'Incident update is invalid.' } })
  if (!actor || !await requireItPermission(request, response, 'incidents.write')) return
  if (!adminDb) return response.status(503).json({ error: { code: 'IT_DATABASE_UNAVAILABLE', message: 'IT incident data is unavailable.' } })
  if (input.data.assignedAdminUserId) {
    const [assignee] = await adminDb.select({ id: adminUsers.id }).from(adminUsers)
      .where(eq(adminUsers.id, input.data.assignedAdminUserId)).limit(1)
    if (!assignee) return response.status(400).json({ error: { code: 'INVALID_ASSIGNEE', message: 'The assignee is not an administrator.' } })
  }
  const now = new Date()
  const incidentNumber = await adminDb.transaction(async (transaction) => {
    const [existing] = await transaction.select({ id: operationsIncidents.id, incidentNumber: operationsIncidents.incidentNumber })
      .from(operationsIncidents).where(eq(operationsIncidents.id, id.data)).limit(1).for('update')
    if (!existing) return null
    await transaction.update(operationsIncidents).set({
      ...input.data,
      ...(input.data.status ? { resolvedAt: ['resolved', 'closed'].includes(input.data.status) ? now : null } : {}),
    }).where(eq(operationsIncidents.id, id.data))
    const changedFields = Object.keys(input.data)
    await transaction.insert(operationsIncidentEvents).values({
      incidentId: id.data,
      actorAdminUserId: actor.id,
      eventType: 'updated',
      message: `IT incident updated: ${changedFields.join(', ')}`,
    })
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: actor.id,
      actorType: 'admin',
      action: 'it_incident.updated',
      targetType: 'incident',
      targetId: existing.incidentNumber,
      details: JSON.stringify(changedFields),
    })
    await transaction.insert(adminAuditLogs).values({ adminUserId: actor.id, action: 'it_incident.updated', targetType: 'incident', targetId: existing.incidentNumber })
    return existing.incidentNumber
  })
  if (!incidentNumber) return response.status(404).json({ error: { code: 'INCIDENT_NOT_FOUND', message: 'Incident not found.' } })
  response.json({ data: { id: id.data, incidentNumber } })
})

adminRouter.get('/it/incidents/:id/events', async (request, response) => {
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(400).json({ error: { code: 'INVALID_INCIDENT_ID', message: 'Incident ID is invalid.' } })
  if (!await requireItPermission(request, response, 'incidents.read')) return
  if (!adminDb) return response.status(503).json({ error: { code: 'IT_DATABASE_UNAVAILABLE', message: 'IT incident data is unavailable.' } })
  const rows = await adminDb.select({
    id: operationsIncidentEvents.id,
    eventType: operationsIncidentEvents.eventType,
    message: operationsIncidentEvents.message,
    createdAt: operationsIncidentEvents.createdAt,
    actorName: sql<string | null>`COALESCE(${adminUsers.fullName}, ${operationsUsers.fullName})`,
  }).from(operationsIncidentEvents)
    .leftJoin(adminUsers, eq(operationsIncidentEvents.actorAdminUserId, adminUsers.id))
    .leftJoin(operationsUsers, eq(operationsIncidentEvents.actorOperationsUserId, operationsUsers.id))
    .where(eq(operationsIncidentEvents.incidentId, id.data))
    .orderBy(desc(operationsIncidentEvents.createdAt))
    .limit(100)
  response.json({ data: rows.reverse() })
})

adminRouter.get('/it/audit', async (request, response) => {
  if (!await requireItPermission(request, response, 'audit.read')) return
  if (!adminDb) return response.status(503).json({ error: { code: 'IT_DATABASE_UNAVAILABLE', message: 'IT audit data is unavailable.' } })
  const query = itIncidentQuerySchema.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Audit pagination is invalid.' } })
  const rows = await adminDb.select({
    id: operationsAuditEvents.id,
    actorType: operationsAuditEvents.actorType,
    actorName: sql<string | null>`COALESCE(${adminUsers.fullName}, ${operationsUsers.fullName})`,
    action: operationsAuditEvents.action,
    targetType: operationsAuditEvents.targetType,
    targetId: operationsAuditEvents.targetId,
    details: operationsAuditEvents.details,
    createdAt: operationsAuditEvents.createdAt,
  }).from(operationsAuditEvents)
    .leftJoin(adminUsers, eq(operationsAuditEvents.actorAdminUserId, adminUsers.id))
    .leftJoin(operationsUsers, eq(operationsAuditEvents.actorOperationsUserId, operationsUsers.id))
    .where(query.data.cursor ? lt(operationsAuditEvents.id, query.data.cursor) : undefined)
    .orderBy(desc(operationsAuditEvents.id))
    .limit(query.data.limit + 1)
  const hasMore = rows.length > query.data.limit
  const data = rows.slice(0, query.data.limit)
  response.json({ data, pagination: { limit: query.data.limit, nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore } })
})

adminRouter.get('/it/access', async (request, response) => {
  const actor = authenticatedAdmin(request)
  if (!actor || !adminDb) return response.status(503).json({ error: { code: 'IT_ACCESS_UNAVAILABLE', message: 'IT access is unavailable.' } })
  const grant = await activeItGrant(actor.id)
  if (grant?.role !== 'super_admin') return response.status(403).json({ error: { code: 'IT_PERMISSION_REQUIRED', message: 'Only an IT super-admin can manage IT access.' } })
  const rows = await adminDb.select({
    adminUserId: operationsOperators.adminUserId,
    email: adminUsers.email,
    fullName: adminUsers.fullName,
    role: operationsOperators.role,
    grantedAt: operationsOperators.grantedAt,
  }).from(operationsOperators).innerJoin(adminUsers, eq(operationsOperators.adminUserId, adminUsers.id))
    .where(and(isNull(operationsOperators.revokedAt), isNotNull(operationsOperators.role)))
    .orderBy(asc(adminUsers.fullName))
  response.json({ data: rows })
})

const itAccessChangeSchema = z.object({
  action: z.enum(['grant', 'revoke']),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(itAccessRoles).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'grant' && !value.role) context.addIssue({ code: 'custom', path: ['role'], message: 'A role is required for a grant.' })
  if (value.action === 'revoke' && value.role) context.addIssue({ code: 'custom', path: ['role'], message: 'A role is not accepted for a revocation.' })
})

adminRouter.post('/it/access', async (request, response) => {
  const actor = authenticatedAdmin(request)
  const input = itAccessChangeSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_IT_ACCESS_CHANGE', message: 'IT access change is invalid.' } })
  if (!actor || !adminDb) return response.status(503).json({ error: { code: 'IT_ACCESS_UNAVAILABLE', message: 'IT access is unavailable.' } })
  const now = new Date()
  const result = await adminDb.transaction(async (transaction) => {
    const [grantor] = await transaction.select({ role: operationsOperators.role })
      .from(operationsOperators).where(and(
        eq(operationsOperators.adminUserId, actor.id),
        isNull(operationsOperators.revokedAt),
      )).limit(1).for('update')
    if (grantor?.role !== 'super_admin') return { status: 403 as const, code: 'IT_PERMISSION_REQUIRED', message: 'Only an IT super-admin can manage IT access.' }

    const [target] = await transaction.select({ id: adminUsers.id, emailVerifiedAt: adminUsers.emailVerifiedAt })
      .from(adminUsers).where(eq(adminUsers.email, input.data.email)).limit(1).for('update')
    if (!target?.emailVerifiedAt) return { status: 404 as const, code: 'ADMIN_ACCOUNT_NOT_FOUND', message: 'Verified administrator account not found.' }

    const [existingGrant] = await transaction.select({ role: operationsOperators.role }).from(operationsOperators)
      .where(and(eq(operationsOperators.adminUserId, target.id), isNull(operationsOperators.revokedAt))).limit(1).for('update')
    if (input.data.action === 'revoke' && !existingGrant) {
      return { status: 404 as const, code: 'IT_GRANT_NOT_FOUND', message: 'No active IT grant exists for this administrator.' }
    }
    const removesSuperAdmin = existingGrant?.role === 'super_admin'
      && (input.data.action === 'revoke' || input.data.role !== 'super_admin')
    if (removesSuperAdmin) {
      const activeSuperAdmins = await transaction.select({ adminUserId: operationsOperators.adminUserId })
        .from(operationsOperators).where(and(
          eq(operationsOperators.role, 'super_admin'),
          isNull(operationsOperators.revokedAt),
        )).for('update')
      if (activeSuperAdmins.length <= 1) return { status: 409 as const, code: 'LAST_IT_SUPER_ADMIN', message: 'The last IT super-admin grant cannot be revoked.' }
    }

    if (input.data.action === 'grant') {
      await transaction.insert(operationsOperators).values({
        adminUserId: target.id,
        grantedByAdminUserId: actor.id,
        role: input.data.role!,
        grantedAt: now,
        revokedAt: null,
        revokedByAdminUserId: null,
      }).onConflictDoUpdate({
        target: operationsOperators.adminUserId,
        set: { grantedByAdminUserId: actor.id, role: input.data.role!, grantedAt: now, revokedAt: null, revokedByAdminUserId: null },
      })
    } else {
      if (!existingGrant) return { status: 404 as const, code: 'IT_GRANT_NOT_FOUND', message: 'No active IT grant exists for this administrator.' }
      await transaction.update(operationsOperators).set({ revokedAt: now, revokedByAdminUserId: actor.id })
        .where(and(eq(operationsOperators.adminUserId, target.id), isNull(operationsOperators.revokedAt)))
    }
    const details = input.data.action === 'grant' ? { role: input.data.role } : { role: existingGrant?.role }
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: actor.id,
      actorType: 'admin',
      action: `it_access.${input.data.action}ed`,
      targetType: 'admin_user',
      targetId: String(target.id),
      details: JSON.stringify(details),
    })
    await transaction.insert(adminAuditLogs).values({
      adminUserId: actor.id,
      action: `it_access.${input.data.action}ed`,
      targetType: 'admin_user',
      targetId: String(target.id),
    })
    return { status: 200 as const, code: 'IT_ACCESS_UPDATED', message: 'IT access updated.' }
  })
  if (result.status !== 200) return response.status(result.status).json({ error: { code: result.code, message: result.message } })
  response.json({ data: { updated: true } })
})