import { and, asc, count, desc, eq, gte, isNull, lte, sql, sum } from 'drizzle-orm'
import { Router } from 'express'
import express from 'express'
import { z } from 'zod'
import { adminDb, db } from '../../config/database.js'
import { adminAuditLogs, adminUsers } from '../../database/admin-schema.js'
import { applicationSettings, categories, deliveryZones, expenseCategories, expenses, homepageSlides, inventoryMovements, jerseyCategories, leagues, notificationCampaigns, notificationRecipients, orderItems, orders, payments, productImages, productVariants, productVideos, products, supportMessages, supportRequests, teams, users } from '../../database/schema.js'
import { authenticateAdmin, authenticatedAdmin } from '../../middleware/authenticate.js'
import { isCustomerOnline, publishChatMessage, publishMessageReceipt, registerAdminStream } from '../../realtime/chat-events.js'
import { recordAdminAudit } from './auth.js'
import { deleteProductImage, ImageStorageError, uploadHomepageSlideImage, uploadProductImage } from './image-storage.js'

export const adminRouter = Router()
adminRouter.use(authenticateAdmin)

adminRouter.get('/me', (request, response) => {
  const actor = authenticatedAdmin(request)
  response.json({ data: { id: actor?.id, fullName: actor?.fullName, email: actor?.email } })
})

adminRouter.get('/dashboard', async (_request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Dashboard services are not configured.' } })
    return
  }
  const [[orderSummary], [paidSummary], [inventorySummary], [pendingSummary], [recentOrders], [bestSellers]] = await Promise.all([
    db.select({ total: count() }).from(orders),
    db.select({ total: sum(payments.amount) }).from(payments).where(eq(payments.status, 'succeeded')),
    db.select({
      units: sum(productVariants.stock),
      lowStock: sql<number>`COALESCE(SUM(CASE WHEN ${productVariants.stock} > 0 AND ${productVariants.stock} <= 5 THEN 1 ELSE 0 END), 0)`,
      outOfStock: sql<number>`COALESCE(SUM(CASE WHEN ${productVariants.stock} = 0 THEN 1 ELSE 0 END), 0)`,
    }).from(productVariants),
    db.select({ total: count() }).from(orders).where(eq(orders.status, 'pending_payment')),
    db.select({
      orderNumber: orders.orderNumber, status: orders.status, total: orders.total, createdAt: orders.createdAt,
      customerName: users.fullName, customerEmail: users.email,
    }).from(orders).innerJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt)).limit(8),
    db.select({ name: orderItems.productNameSnapshot, units: sum(orderItems.quantity) })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(sql`${orders.status} NOT IN ('cancelled', 'refunded')`)
      .groupBy(orderItems.productNameSnapshot).orderBy(desc(sum(orderItems.quantity))).limit(5),
  ])
  response.json({ data: {
    totalOrders: orderSummary.total,
    pendingOrders: pendingSummary.total,
    paidRevenue: paidSummary.total ?? '0.00',
    inventoryUnits: inventorySummary.units ?? '0',
    lowStockVariants: inventorySummary.lowStock,
    outOfStockVariants: inventorySummary.outOfStock,
    recentOrders,
    bestSellers,
  } })
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
    if (candidate.code === 'ER_DUP_ENTRY' || candidate.errno === 1062) return true
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
    [created] = await db.insert(leagues).values(input.data).$returningId()
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
    [created] = await db.insert(teams).values({ ...input.data, leagueId: leagueId.data }).$returningId()
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
    [created] = await db.insert(jerseyCategories).values(input.data).$returningId()
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
    }).$returningId()
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
  const [{ id }] = await db.insert(productVideos).values({ ...input.data, productId: productId.data, sortOrder: existing.length }).$returningId()
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
  const [created] = await db.insert(homepageSlides).values(input.data).$returningId()
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
  const created = await db.insert(homepageSlides).values(input.data).$returningId()
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
    }).$returningId()
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
    const [update] = await transaction.update(productVariants).set({ stock: sql`${productVariants.stock} + ${input.data.delta}` })
      .where(and(eq(productVariants.id, variantId.data), eq(productVariants.productId, productId.data), sql`${productVariants.stock} + ${input.data.delta} >= 0`))
    if (update.affectedRows !== 1) return null
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
  const [{ id }] = await db.insert(categories).values(input.data).$returningId()
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
    customerName: users.fullName, customerEmail: users.email,
  }).from(orders).innerJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt)).limit(200)
  response.json({ data: rows })
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
    const [updated] = await transaction.update(orders).set({ status: input.data.status })
      .where(and(eq(orders.id, id.data), eq(orders.status, order.status)))
    if (updated.affectedRows !== 1) return 'conflict' as const
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
    }).$returningId()
    await transaction.insert(notificationRecipients).values({ campaignId: notificationId, userId: order.userId })
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
    }).$returningId()
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
  ))
  if (deleted[0].affectedRows !== 1) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Announcement not found.' } })
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
      }).$returningId()
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
    }).$returningId()
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
  const [{ id }] = await db.insert(deliveryZones).values(input.data).$returningId()
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
  }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id)).orderBy(desc(payments.createdAt)).limit(250)
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
  }).$returningId()
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'expense.created', 'expense', String(id))
  response.status(201).json({ data: { id } })
})

adminRouter.get('/reports/financial', async (request, response) => {
  const range = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).safeParse(request.query)
  if (!range.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Report date range is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Reporting services are unavailable.' } })
  const conditions = []
  if (range.data.from) conditions.push(gte(orders.createdAt, new Date(`${range.data.from}T00:00:00.000Z`)))
  if (range.data.to) conditions.push(lte(orders.createdAt, new Date(`${range.data.to}T23:59:59.999Z`)))
  const [[sales], [costs], [expensesTotal]] = await Promise.all([
    db.select({ gross: sum(orders.subtotal), discounts: sum(orders.discount), paid: sum(payments.amount) })
      .from(orders).leftJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.status, 'succeeded')))
      .where(and(...conditions)),
    db.select({ cost: sum(sql`${products.cost} * ${orderItems.quantity}`) })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id)).where(and(...conditions)),
    db.select({ amount: sum(expenses.amount) }).from(expenses),
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
        .onDuplicateKeyUpdate({ set: { value, updatedBy: null } })
    }
  })
  const actor = authenticatedAdmin(request)
  if (actor) await recordAdminAudit(actor.id, 'settings.updated', 'settings', 'business')
  response.json({ data: input.data })
})

adminRouter.get('/audit', async (_request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator audit services are unavailable.' } })
  const rows = await adminDb.select({
    id: adminAuditLogs.id, action: adminAuditLogs.action, targetType: adminAuditLogs.targetType, targetId: adminAuditLogs.targetId,
    createdAt: adminAuditLogs.createdAt, actorName: adminUsers.fullName, actorEmail: adminUsers.email,
  }).from(adminAuditLogs).innerJoin(adminUsers, eq(adminAuditLogs.adminUserId, adminUsers.id)).orderBy(desc(adminAuditLogs.createdAt)).limit(500)
  response.json({ data: rows })
})