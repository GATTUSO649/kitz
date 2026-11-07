import { and, asc, count, desc, eq, gte, gt, ilike, inArray, isNull, lte, lt, or } from 'drizzle-orm'
import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminUsers, marketplaceCategories, marketplaceCounties, marketplaceProductImages, marketplaceProductReports, marketplaceProductViews, marketplaceProducts, marketplaceSellers, marketplaceSettings, marketplaceSubcategories } from '../../database/schema.js'
import { calculateFeeKes } from './security.js'
import { parseMarketplaceSocialLinks } from './social-links.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { marketplaceImageDeliveryUrl } from './images.js'

export const marketplaceRouter = Router()
const productViewLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
const productReportLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })

marketplaceRouter.get('/settings/footer-social-links', async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace settings are temporarily unavailable.' } })
    return
  }
  try {
    const [setting] = await database.select({ value: marketplaceSettings.value }).from(marketplaceSettings).where(eq(marketplaceSettings.key, 'footer_social_links')).limit(1)
    const result = parseMarketplaceSocialLinks(setting?.value ?? {})
    response.setHeader('Cache-Control', 'public, max-age=300')
    response.json({ data: result.success ? result.data : { facebookUrl: null, xUrl: null, youtubeUrl: null, whatsappPhone: null, whatsappUrl: null } })
  } catch (error) {
    next(error)
  }
})

const listingQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  subcategory: z.string().trim().max(120).optional(),
  county: z.string().trim().max(100).optional(),
  subcounty: z.string().trim().max(100).optional(),
  town: z.string().trim().max(100).optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'used']).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  publishedAfter: z.coerce.date().optional(),
  publishedBefore: z.coerce.date().optional(),
  negotiable: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false', 'all']).optional(),
  sort: z.enum(['newest', 'oldest', 'price_low', 'price_high', 'updated']).default('newest'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
}).refine((value) => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice, {
  message: 'Minimum price cannot exceed maximum price.',
  path: ['minPrice'],
})

marketplaceRouter.get('/categories', async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const categories = await database.select({ id: marketplaceCategories.id, name: marketplaceCategories.name, slug: marketplaceCategories.slug })
      .from(marketplaceCategories)
      .where(and(eq(marketplaceCategories.active, true), isNull(marketplaceCategories.parentId)))
      .orderBy(asc(marketplaceCategories.sortOrder), asc(marketplaceCategories.name))
    const subcategories = categories.length
      ? await database.select({ id: marketplaceSubcategories.id, categoryId: marketplaceSubcategories.categoryId, name: marketplaceSubcategories.name, slug: marketplaceSubcategories.slug })
        .from(marketplaceSubcategories)
        .where(and(eq(marketplaceSubcategories.active, true), inArray(marketplaceSubcategories.categoryId, categories.map(({ id }) => id))))
        .orderBy(asc(marketplaceSubcategories.sortOrder), asc(marketplaceSubcategories.name))
      : []
    response.json({ data: categories.map((item) => ({ ...item, subcategories: subcategories.filter((subcategory) => subcategory.categoryId === item.id).map(({ id, name, slug }) => ({ id, name, slug })) })) })
  } catch (error) {
    next(error)
  }
})

marketplaceRouter.get('/products', async (request, response, next) => {
  const parsed = listingQuery.safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Search filters are invalid.', details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  const filters = parsed.data
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Minimum price cannot exceed maximum price.' } })
    return
  }
  try {
    const conditions = [eq(marketplaceProducts.status, 'published'), gt(marketplaceProducts.expiresAt, new Date())]
    if (filters.q) conditions.push(or(ilike(marketplaceProducts.title, `%${filters.q}%`), ilike(marketplaceProducts.description, `%${filters.q}%`))!)
    if (filters.category) conditions.push(eq(marketplaceCategories.slug, filters.category))
    if (filters.subcategory) conditions.push(eq(marketplaceSubcategories.slug, filters.subcategory))
    if (filters.county) conditions.push(eq(marketplaceCounties.name, filters.county))
    if (filters.subcounty) conditions.push(eq(marketplaceSellers.subcounty, filters.subcounty))
    if (filters.town) conditions.push(eq(marketplaceSellers.town, filters.town))
    if (filters.condition) conditions.push(eq(marketplaceProducts.condition, filters.condition))
    if (filters.minPrice !== undefined) conditions.push(gte(marketplaceProducts.priceKes, filters.minPrice))
    if (filters.maxPrice !== undefined) conditions.push(lte(marketplaceProducts.priceKes, filters.maxPrice))
    if (filters.publishedAfter) conditions.push(gt(marketplaceProducts.publishedAt, filters.publishedAfter))
    if (filters.publishedBefore) conditions.push(lt(marketplaceProducts.publishedAt, filters.publishedBefore))
    if (filters.negotiable !== undefined) conditions.push(eq(marketplaceProducts.negotiable, filters.negotiable === 'true'))
    if (filters.featured !== undefined && filters.featured !== 'all') conditions.push(eq(marketplaceProducts.featured, filters.featured === 'true'))
    const orderBy = filters.sort === 'oldest' ? asc(marketplaceProducts.publishedAt)
      : filters.sort === 'price_low' ? asc(marketplaceProducts.priceKes)
        : filters.sort === 'price_high' ? desc(marketplaceProducts.priceKes)
          : filters.sort === 'updated' ? desc(marketplaceProducts.updatedAt)
            : desc(marketplaceProducts.publishedAt)
    const where = and(...conditions)
    const offset = (filters.page - 1) * filters.limit
    const [rows, countRows] = await Promise.all([
      database.select({
        id: marketplaceProducts.id,
        reference: marketplaceProducts.reference,
        slug: marketplaceProducts.slug,
        title: marketplaceProducts.title,
        description: marketplaceProducts.description,
        condition: marketplaceProducts.condition,
        priceKes: marketplaceProducts.priceKes,
        negotiable: marketplaceProducts.negotiable,
        featured: marketplaceProducts.featured,
        publishedAt: marketplaceProducts.publishedAt,
        category: marketplaceCategories.name,
        categorySlug: marketplaceCategories.slug,
        subcategory: marketplaceSubcategories.name,
        subcategorySlug: marketplaceSubcategories.slug,
        county: marketplaceCounties.name,
        subcounty: marketplaceSellers.subcounty,
        town: marketplaceSellers.town,
      }).from(marketplaceProducts)
        .innerJoin(marketplaceCategories, eq(marketplaceProducts.categoryId, marketplaceCategories.id))
        .leftJoin(marketplaceSubcategories, eq(marketplaceProducts.subcategoryId, marketplaceSubcategories.id))
        .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
        .innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
        .where(where).orderBy(orderBy).limit(filters.limit).offset(offset),
      database.select({ total: count() }).from(marketplaceProducts)
        .innerJoin(marketplaceCategories, eq(marketplaceProducts.categoryId, marketplaceCategories.id))
        .leftJoin(marketplaceSubcategories, eq(marketplaceProducts.subcategoryId, marketplaceSubcategories.id))
        .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
        .innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
        .where(where),
    ])
    const images = rows.length
      ? await database.select({ productId: marketplaceProductImages.productId, imageUrl: marketplaceProductImages.imageUrl, isPrimary: marketplaceProductImages.isPrimary, sortOrder: marketplaceProductImages.sortOrder })
        .from(marketplaceProductImages)
        .where(inArray(marketplaceProductImages.productId, rows.map((row) => row.id)))
        .orderBy(desc(marketplaceProductImages.isPrimary), asc(marketplaceProductImages.sortOrder))
      : []
    const primaryImageByProduct = new Map<string, string>()
    for (const image of images) if (!primaryImageByProduct.has(image.productId)) primaryImageByProduct.set(image.productId, marketplaceImageDeliveryUrl(image.imageUrl, 640))
    const total = Number(countRows[0]?.total ?? 0)
    response.json({
      data: rows.map(({ id, ...row }) => ({ ...row, imageUrl: primaryImageByProduct.get(id) ?? null })),
      pagination: { page: filters.page, limit: filters.limit, total, hasMore: offset + rows.length < total },
    })
  } catch (error) {
    next(error)
  }
})

marketplaceRouter.get('/products/:slug', async (request, response, next) => {
  const slug = z.string().min(1).max(180).safeParse(request.params.slug)
  if (!slug.success) {
    response.status(400).json({ error: { code: 'INVALID_LISTING', message: 'The listing reference is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const [product] = await database.select({
      id: marketplaceProducts.id,
      reference: marketplaceProducts.reference,
      slug: marketplaceProducts.slug,
      title: marketplaceProducts.title,
      description: marketplaceProducts.description,
      condition: marketplaceProducts.condition,
      priceKes: marketplaceProducts.priceKes,
      negotiable: marketplaceProducts.negotiable,
      publishedAt: marketplaceProducts.publishedAt,
      category: marketplaceCategories.name,
      subcategory: marketplaceSubcategories.name,
      county: marketplaceCounties.name,
      subcounty: marketplaceSellers.subcounty,
      town: marketplaceSellers.town,
    }).from(marketplaceProducts)
      .innerJoin(marketplaceCategories, eq(marketplaceProducts.categoryId, marketplaceCategories.id))
      .leftJoin(marketplaceSubcategories, eq(marketplaceProducts.subcategoryId, marketplaceSubcategories.id))
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
      .innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
      .where(and(eq(marketplaceProducts.slug, slug.data), eq(marketplaceProducts.status, 'published'), gt(marketplaceProducts.expiresAt, new Date()), eq(marketplaceCategories.active, true)))
      .limit(1)
    if (!product) {
      response.status(404).json({ error: { code: 'LISTING_NOT_FOUND', message: 'This listing is not available.' } })
      return
    }
    const images = await database.select({ imageUrl: marketplaceProductImages.imageUrl, isPrimary: marketplaceProductImages.isPrimary, sortOrder: marketplaceProductImages.sortOrder })
      .from(marketplaceProductImages)
      .where(eq(marketplaceProductImages.productId, product.id))
      .orderBy(desc(marketplaceProductImages.isPrimary), asc(marketplaceProductImages.sortOrder))
    const [feeSetting] = await database.select({ value: marketplaceSettings.value }).from(marketplaceSettings).where(eq(marketplaceSettings.key, 'contact_unlock_fee_basis_points')).limit(1)
    const feeBasisPoints = Number(feeSetting?.value ?? 500)
    const contactUnlockFeeKes = calculateFeeKes(product.priceKes, feeBasisPoints)
    const publicProduct = {
      reference: product.reference,
      slug: product.slug,
      title: product.title,
      description: product.description,
      condition: product.condition,
      priceKes: product.priceKes,
      negotiable: product.negotiable,
      publishedAt: product.publishedAt,
      category: product.category,
      subcategory: product.subcategory,
      county: product.county,
      subcounty: product.subcounty,
      town: product.town,
    }
    response.json({ data: { ...publicProduct, contactUnlockFeeKes, images: images.map(({ imageUrl }) => marketplaceImageDeliveryUrl(imageUrl, 1200)) } })
  } catch (error) {
    next(error)
  }
})

marketplaceRouter.post('/products/:slug/views', productViewLimiter, async (request, response) => {
  const slug = z.string().min(1).max(180).safeParse(request.params.slug)
  if (!slug.success) {
    response.status(400).json({ error: { code: 'INVALID_LISTING', message: 'The listing reference is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  const [product] = await database.select({ id: marketplaceProducts.id }).from(marketplaceProducts)
    .where(and(eq(marketplaceProducts.slug, slug.data), eq(marketplaceProducts.status, 'published'), gt(marketplaceProducts.expiresAt, new Date()))).limit(1)
  if (product) await database.insert(marketplaceProductViews).values({ productId: product.id })
  response.status(202).json({ data: { recorded: Boolean(product) } })
})

marketplaceRouter.post('/products/:slug/reports', productReportLimiter, async (request, response) => {
  const slug = z.string().min(1).max(180).safeParse(request.params.slug)
  const report = z.object({ reason: z.enum(['fraud', 'prohibited', 'misleading', 'duplicate', 'other']), details: z.string().trim().max(1000).optional(), email: z.string().trim().email().max(254).optional().or(z.literal('')) }).safeParse(request.body)
  if (!slug.success || !report.success) {
    response.status(400).json({ error: { code: 'INVALID_REPORT', message: 'Choose a report reason and check the optional details.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace reports are temporarily unavailable.' } })
    return
  }
  const [product] = await database.select({ id: marketplaceProducts.id, reference: marketplaceProducts.reference, title: marketplaceProducts.title }).from(marketplaceProducts)
    .where(and(eq(marketplaceProducts.slug, slug.data), eq(marketplaceProducts.status, 'published'), gt(marketplaceProducts.expiresAt, new Date()))).limit(1)
  if (!product) {
    response.status(404).json({ error: { code: 'LISTING_NOT_FOUND', message: 'This listing is not available.' } })
    return
  }
  const [created] = await database.transaction(async (transaction) => {
    const [createdReport] = await transaction.insert(marketplaceProductReports).values({ productId: product.id, reason: report.data.reason, details: report.data.details || null, reporterEmail: report.data.email || null }).returning({ id: marketplaceProductReports.id })
    if (!createdReport) return []
    const admins = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
      .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'seller_support_admin', 'marketplace_moderator'])))
    for (const admin of admins) await enqueueMarketplaceEmail(transaction, {
      eventKey: `report:${createdReport.id}:admin-notification:${admin.email}`,
      to: admin.email,
      kind: 'admin_product_report',
      data: { title: product.title, reference: product.reference, reason: report.data.reason },
    })
    return [createdReport]
  })
  response.status(201).json({ data: { reportReference: created?.id } })
})