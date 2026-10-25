import { and, asc, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm'
import { Router, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { applicationSettings, categories, homepageSlides, jerseyCategories, leagues, orderItems, orders, productImages, productRatings, productReviews, productVariants, products, productVideos, teams } from '../../database/schema.js'
import { isDarajaConfigured, resolveDarajaShortcodes } from '../orders/daraja.js'

export const catalogueRouter = Router()
const productRatingLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
export const quickProductRatingSchema = z.object({ rating: z.number().int().min(1).max(5), visitorId: z.string().uuid() })

export function combinedRating(reviewAverage: unknown, reviewCount: unknown, quickAverage: unknown, quickCount: unknown) {
  const reviews = Number(reviewCount ?? 0)
  const quickRatings = Number(quickCount ?? 0)
  const total = reviews + quickRatings
  const average = total
    ? (Number(reviewAverage ?? 0) * reviews + Number(quickAverage ?? 0) * quickRatings) / total
    : 0
  return { ratingAverage: average, reviewCount: total }
}

catalogueRouter.post('/products/:productId/ratings', productRatingLimiter, async (request, response) => {
  if (!isAllowedClientOrigin(request.get('origin'))) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
    return
  }
  const productId = z.coerce.number().int().positive().safeParse(request.params.productId)
  const input = quickProductRatingSchema.safeParse(request.body)
  if (!productId.success || !input.success) {
    response.status(400).json({ error: { code: 'INVALID_PRODUCT_RATING', message: 'Choose a 1 to 5 star rating.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
    return
  }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, productId.data), eq(products.published, true))).limit(1)
  if (!product) {
    response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
    return
  }
  await db.insert(productRatings).values({ productId: product.id, visitorId: input.data.visitorId, rating: input.data.rating })
    .onDuplicateKeyUpdate({ set: { rating: input.data.rating, updatedAt: new Date() } })
  const [reviews, quickRatings] = await Promise.all([
    db.select({ average: sql<number>`AVG(${productReviews.rating})`, count: count() }).from(productReviews).where(eq(productReviews.productId, product.id)),
    db.select({ average: sql<number>`AVG(${productRatings.rating})`, count: count() }).from(productRatings).where(eq(productRatings.productId, product.id)),
  ])
  response.json({ data: combinedRating(reviews[0]?.average, reviews[0]?.count, quickRatings[0]?.average, quickRatings[0]?.count) })
})

catalogueRouter.get('/store/payment-options', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'PAYMENT_OPTIONS_UNAVAILABLE', message: 'Payment options are unavailable.' } })
  const settings = await db.select({ key: applicationSettings.key, value: applicationSettings.value }).from(applicationSettings)
    .where(inArray(applicationSettings.key, ['mpesaTillName', 'mpesaTillNumber', 'mpesaMobileNumber']))
  const values = Object.fromEntries(settings.map(({ key, value }) => [key, value]))
  const shortcodes = resolveDarajaShortcodes(env.DARAJA_ENV, env.DARAJA_TRANSACTION_TYPE, env.DARAJA_SHORTCODE, values.mpesaTillNumber)
  const mpesaTillNumber = shortcodes.partyB
  response.json({ data: {
    mpesaTillName: values.mpesaTillName ?? '',
    mpesaTillNumber,
    mpesaTransactionType: env.DARAJA_TRANSACTION_TYPE ?? '',
    mpesaMobileNumber: values.mpesaMobileNumber ?? '',
    stkPushAvailable: isDarajaConfigured(shortcodes.businessShortcode) && /^\d{5,20}$/.test(shortcodes.partyB),
  } })
})

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(140).optional(),
  league: z.string().trim().max(140).optional(),
  team: z.string().trim().max(140).optional(),
  jerseyCategory: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(48),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
})

async function getProducts(
  response: Response,
  options: { q?: string; category?: string; league?: string; team?: string; jerseyCategory?: string; limit?: number; page?: number; filter?: SQL; order?: 'name' | 'recent' | 'featured' | 'trending'; orderIds?: number[] },
): Promise<void> {
  response.locals.databaseOperation = 'catalogue.getProducts'
  if (!db) {
    response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
    return
  }
  const filters = [eq(products.published, true)]
  if (options.filter) filters.push(options.filter)
  if (options.q) {
    const pattern = `%${options.q.replace(/[\\%_]/g, '\\$&')}%`
    filters.push(or(
      like(products.name, pattern),
      like(products.description, pattern),
      like(categories.name, pattern),
      like(leagues.name, pattern),
      like(teams.name, pattern),
      like(jerseyCategories.name, pattern),
    ) as typeof filters[number])
  }
  if (options.category) filters.push(and(eq(categories.slug, options.category), eq(categories.active, true)) as typeof filters[number])
  if (options.league) filters.push(and(eq(leagues.slug, options.league), eq(leagues.active, true)) as typeof filters[number])
  if (options.team) filters.push(and(eq(teams.slug, options.team), eq(teams.active, true)) as typeof filters[number])
  if (options.jerseyCategory) filters.push(and(eq(jerseyCategories.slug, options.jerseyCategory), eq(jerseyCategories.active, true)) as typeof filters[number])

  const rows = await db.select({
    id: products.id,
    name: products.name,
    slug: products.slug,
    description: products.description,
    price: products.price,
    salePrice: products.salePrice,
    season: products.season,
    productType: products.productType,
    imageUrl: products.imageUrl,
    featured: products.featured,
    trending: products.trending,
    categoryId: categories.id,
    categoryName: categories.name,
    categorySlug: categories.slug,
    teamId: teams.id,
    teamName: teams.name,
    teamSlug: teams.slug,
    leagueId: leagues.id,
    leagueName: leagues.name,
    leagueSlug: leagues.slug,
    leagueCountry: leagues.country,
    jerseyCategoryId: jerseyCategories.id,
    jerseyCategoryName: jerseyCategories.name,
    jerseyCategorySlug: jerseyCategories.slug,
  }).from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(teams, eq(products.teamId, teams.id))
    .leftJoin(leagues, eq(teams.leagueId, leagues.id))
    .leftJoin(jerseyCategories, eq(products.jerseyCategoryId, jerseyCategories.id))
    .where(and(...filters))
    .orderBy(options.orderIds?.length
      ? sql`FIELD(${products.id}, ${sql.join(options.orderIds.map((id) => sql`${id}`), sql`, `)})`
      : options.order === 'recent' ? desc(products.createdAt)
        : options.order === 'featured' ? desc(products.featured)
          : options.order === 'trending' ? desc(products.trending)
            : asc(products.name))
    .limit((options.limit ?? 48) + 1)
    .offset(((options.page ?? 1) - 1) * (options.limit ?? 48))

  const ids = rows.map((row) => row.id)
  const variants = ids.length ? await db.select().from(productVariants).where(inArray(productVariants.productId, ids)) : []
  const images = ids.length ? await db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.sortOrder)) : []
  const variantsByProduct = new Map<number, typeof variants>()
  for (const variant of variants) {
    const current = variantsByProduct.get(variant.productId) ?? []
    current.push(variant)
    variantsByProduct.set(variant.productId, current)
  }

  const imagesByProduct = new Map<number, typeof images>()
  for (const image of images) {
    const current = imagesByProduct.get(image.productId) ?? []
    current.push(image)
    imagesByProduct.set(image.productId, current)
  }
  const ratings = ids.length ? await db.select({
    productId: productReviews.productId,
    average: sql<number>`AVG(${productReviews.rating})`,
    reviewCount: count(),
  }).from(productReviews).where(inArray(productReviews.productId, ids)).groupBy(productReviews.productId) : []
  const quickRatings = ids.length ? await db.select({
    productId: productRatings.productId,
    average: sql<number>`AVG(${productRatings.rating})`,
    ratingCount: count(),
  }).from(productRatings).where(inArray(productRatings.productId, ids)).groupBy(productRatings.productId) : []
  const ratingsByProduct = new Map(ratings.map((rating) => [rating.productId, rating]))
  const quickRatingsByProduct = new Map(quickRatings.map((rating) => [rating.productId, rating]))
  const pageRows = rows.slice(0, options.limit ?? 48)
  const sortedRows = options.orderIds?.length
    ? [...pageRows].sort((left, right) => options.orderIds!.indexOf(left.id) - options.orderIds!.indexOf(right.id))
    : pageRows
  response.json({ data: sortedRows.map((product) => ({
    ...product,
    category: product.categoryId ? { id: product.categoryId, name: product.categoryName, slug: product.categorySlug } : null,
    team: product.teamId ? { id: product.teamId, name: product.teamName, slug: product.teamSlug } : null,
    league: product.leagueId ? { id: product.leagueId, name: product.leagueName, slug: product.leagueSlug, country: product.leagueCountry } : null,
    jerseyCategory: product.jerseyCategoryId ? { id: product.jerseyCategoryId, name: product.jerseyCategoryName, slug: product.jerseyCategorySlug } : null,
    variants: (variantsByProduct.get(product.id) ?? []).map(({ id, size, stock, price }) => ({ id, size, stock, price })),
    images: (imagesByProduct.get(product.id) ?? []).map(({ id, imageUrl, altText, sortOrder, isPrimary }) => ({ id, imageUrl, altText, sortOrder, isPrimary })),
    ...combinedRating(ratingsByProduct.get(product.id)?.average, ratingsByProduct.get(product.id)?.reviewCount, quickRatingsByProduct.get(product.id)?.average, quickRatingsByProduct.get(product.id)?.ratingCount),
  })), pagination: { page: options.page ?? 1, limit: options.limit ?? 48, hasMore: rows.length > (options.limit ?? 48) } })
}

catalogueRouter.get('/store/homepage', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
  const slides = await db.select({
    id: homepageSlides.id,
    imageUrl: homepageSlides.imageUrl,
    displayDurationSeconds: homepageSlides.displayDurationSeconds,
    title: homepageSlides.title,
    subtitle: homepageSlides.subtitle,
    promotionalMessage: homepageSlides.promotionalMessage,
    ctaLabel: homepageSlides.ctaLabel,
    destinationUrl: homepageSlides.destinationUrl,
    sortOrder: homepageSlides.sortOrder,
  }).from(homepageSlides)
    .where(eq(homepageSlides.active, true))
    .orderBy(asc(homepageSlides.sortOrder))
    .limit(10)
  const directory = await getLeagueDirectory()
  response.json({ data: { slides, leagues: directory.leagues } })
})

async function getLeagueDirectory() {
  if (!db) return { leagues: [], jerseyCategories: [] }
  const leagueRows = await db.select({
    id: leagues.id,
    name: leagues.name,
    slug: leagues.slug,
    country: leagues.country,
    countryCode: leagues.countryCode,
    season: leagues.season,
    sortOrder: leagues.sortOrder,
  }).from(leagues).where(eq(leagues.active, true)).orderBy(asc(leagues.sortOrder), asc(leagues.name))
  const teamRows = await db.select({
    id: teams.id,
    leagueId: teams.leagueId,
    name: teams.name,
    slug: teams.slug,
    sortOrder: teams.sortOrder,
    productCount: count(products.id),
  }).from(teams).leftJoin(products, and(eq(products.teamId, teams.id), eq(products.published, true)))
    .where(eq(teams.active, true))
    .groupBy(teams.id, teams.leagueId, teams.name, teams.slug, teams.sortOrder)
    .orderBy(asc(teams.sortOrder), asc(teams.name))
  const categoriesList = await db.select({
    id: jerseyCategories.id,
    name: jerseyCategories.name,
    slug: jerseyCategories.slug,
    sortOrder: jerseyCategories.sortOrder,
  }).from(jerseyCategories).where(eq(jerseyCategories.active, true)).orderBy(asc(jerseyCategories.sortOrder), asc(jerseyCategories.name))
  return {
    leagues: leagueRows.map((league) => ({
      ...league,
      teams: teamRows.filter((team) => team.leagueId === league.id),
    })),
    jerseyCategories: categoriesList,
  }
}

catalogueRouter.get('/marketplace', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
  response.json({ data: await getLeagueDirectory() })
})

catalogueRouter.get('/products', async (request, response) => {
  const query = listQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Search parameters are invalid.' } })
  await getProducts(response, { ...query.data, order: 'name' })
})

catalogueRouter.get('/products/featured', async (request, response) => {
  const query = listQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Search parameters are invalid.' } })
  await getProducts(response, { ...query.data, filter: eq(products.featured, true), order: 'featured' })
})

catalogueRouter.get('/products/trending', async (request, response) => {
  const query = listQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Search parameters are invalid.' } })
  await getProducts(response, { ...query.data, filter: eq(products.trending, true), order: 'trending' })
})

catalogueRouter.get('/products/new-arrivals', async (request, response) => {
  const query = listQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Search parameters are invalid.' } })
  await getProducts(response, { ...query.data, order: 'recent' })
})

catalogueRouter.get('/products/best-sellers', async (request, response) => {
  const query = listQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Search parameters are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
  const bestSellers = await db.select({ productId: orderItems.productId, unitsSold: sql<number>`SUM(${orderItems.quantity})` })
    .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(eq(orders.status, 'delivered'))
    .groupBy(orderItems.productId)
    .orderBy(desc(sql`SUM(${orderItems.quantity})`))
    .limit(query.data.page * query.data.limit + 1)
  const rankedIds = bestSellers.flatMap(({ productId }) => productId === null ? [] : [productId])
  if (!rankedIds.length) return response.json({ data: [], pagination: { page: 1, limit: query.data.limit, hasMore: false } })
  await getProducts(response, { ...query.data, filter: inArray(products.id, rankedIds), orderIds: rankedIds })
})

catalogueRouter.get('/products/:slug', async (request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
    return
  }
  const [product] = await db.select({
    id: products.id,
    name: products.name,
    slug: products.slug,
    description: products.description,
    price: products.price,
    salePrice: products.salePrice,
    season: products.season,
    productType: products.productType,
    imageUrl: products.imageUrl,
    featured: products.featured,
    trending: products.trending,
    categoryId: categories.id,
    categoryName: categories.name,
    categorySlug: categories.slug,
    teamId: teams.id,
    teamName: teams.name,
    teamSlug: teams.slug,
    leagueId: leagues.id,
    leagueName: leagues.name,
    leagueSlug: leagues.slug,
    leagueCountry: leagues.country,
    jerseyCategoryId: jerseyCategories.id,
    jerseyCategoryName: jerseyCategories.name,
    jerseyCategorySlug: jerseyCategories.slug,
  }).from(products).leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(teams, eq(products.teamId, teams.id))
    .leftJoin(leagues, eq(teams.leagueId, leagues.id))
    .leftJoin(jerseyCategories, eq(products.jerseyCategoryId, jerseyCategories.id))
    .where(and(eq(products.slug, request.params.slug), eq(products.published, true))).limit(1)
  if (!product) {
    response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
    return
  }
  const variants = await db.select({ id: productVariants.id, size: productVariants.size, stock: productVariants.stock, price: productVariants.price })
    .from(productVariants).where(eq(productVariants.productId, product.id))
  const images = await db.select({ id: productImages.id, imageUrl: productImages.imageUrl, altText: productImages.altText, sortOrder: productImages.sortOrder, isPrimary: productImages.isPrimary })
    .from(productImages).where(eq(productImages.productId, product.id)).orderBy(asc(productImages.sortOrder))
  const [videos, reviews, [ratingSummary], [quickRatingSummary]] = await Promise.all([
    db.select().from(productVideos).where(eq(productVideos.productId, product.id)).orderBy(asc(productVideos.sortOrder)),
    db.select({ id: productReviews.id, rating: productReviews.rating, body: productReviews.body, createdAt: productReviews.createdAt })
      .from(productReviews).where(eq(productReviews.productId, product.id)).orderBy(desc(productReviews.createdAt)).limit(100),
    db.select({ average: sql<number>`AVG(${productReviews.rating})`, reviewCount: count() })
      .from(productReviews).where(eq(productReviews.productId, product.id)),
    db.select({ average: sql<number>`AVG(${productRatings.rating})`, reviewCount: count() })
      .from(productRatings).where(eq(productRatings.productId, product.id)),
  ])
  const ratingSummaryCombined = combinedRating(ratingSummary?.average, ratingSummary?.reviewCount, quickRatingSummary?.average, quickRatingSummary?.reviewCount)
  response.json({ data: {
    ...product,
    category: product.categoryName ? { id: product.categoryId, name: product.categoryName, slug: product.categorySlug } : null,
    team: product.teamId ? { id: product.teamId, name: product.teamName, slug: product.teamSlug } : null,
    league: product.leagueId ? { id: product.leagueId, name: product.leagueName, slug: product.leagueSlug, country: product.leagueCountry } : null,
    jerseyCategory: product.jerseyCategoryId ? { id: product.jerseyCategoryId, name: product.jerseyCategoryName, slug: product.jerseyCategorySlug } : null,
    variants,
    images,
    videos,
    reviews: reviews.map((review) => ({ ...review, reviewerName: 'Customer' })),
    ...ratingSummaryCombined,
  } })
})

catalogueRouter.get('/categories', async (_request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'CATALOGUE_UNAVAILABLE', message: 'The catalogue database is not configured.' } })
    return
  }
  const rows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sortOrder))
  response.json({ data: rows })
})