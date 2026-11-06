import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { raw, Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminUsers, marketplaceCategories, marketplaceCounties, marketplaceProductAccess, marketplaceProductImages, marketplaceProducts, marketplaceSellers, marketplaceSettings, marketplaceSubcategories } from '../../database/schema.js'
import { deleteMarketplaceImage, uploadMarketplaceImage } from './images.js'
import { calculateFeeKes, createListingReference, createListingSlug, createSecret, hashSecret, normalizeKenyanPhone } from './security.js'
import { optionalMarketplaceSeller, type MarketplaceSellerSession } from './seller-portal.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'

export const submissionRouter = Router()
const imageBody = raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '8mb' })
const imageUploadLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })

const submissionSchema = z.object({
  title: z.string().trim().min(5).max(160),
  description: z.string().trim().min(30).max(5000),
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid().optional(),
  condition: z.enum(['new', 'like_new', 'good', 'fair', 'used']),
  priceKes: z.number().int().positive().max(100_000_000),
  negotiable: z.boolean(),
  seller: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(24),
    whatsapp: z.string().trim().max(24).optional(),
    email: z.string().trim().email().max(254).optional().or(z.literal('')),
    countyCode: z.string().regex(/^\d{3}$/),
    subcounty: z.string().trim().min(2).max(100),
    town: z.string().trim().min(2).max(100),
    area: z.string().trim().max(120).optional(),
  }).optional(),
})

async function getFeeBasisPoints(key: string, fallback: number): Promise<number> {
  if (!database) return fallback
  const [setting] = await database.select({ value: marketplaceSettings.value }).from(marketplaceSettings).where(eq(marketplaceSettings.key, key)).limit(1)
  const value = Number(setting?.value ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error('Marketplace fee configuration is invalid.')
  return value
}

submissionRouter.get('/locations/counties', async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const counties = await database.select({ code: marketplaceCounties.code, name: marketplaceCounties.name })
      .from(marketplaceCounties).where(eq(marketplaceCounties.active, true)).orderBy(marketplaceCounties.code)
    response.json({ data: counties })
  } catch (error) {
    next(error)
  }
})

submissionRouter.post('/submissions', optionalMarketplaceSeller, async (request, response, next) => {
  const parsed = submissionSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SUBMISSION', message: 'Check the listing details and try again.', details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace submissions are temporarily unavailable.' } })
    return
  }
  try {
    const submission = parsed.data
    const sellerSession = response.locals.marketplaceSeller as MarketplaceSellerSession | undefined
    if (!sellerSession && !submission.seller) {
      response.status(400).json({ error: { code: 'INVALID_SUBMISSION', message: 'Seller contact information is required.' } })
      return
    }
    const sellerInput = submission.seller
    const sellerPhone = sellerSession?.phone ?? normalizeKenyanPhone(sellerInput!.phone)
    const whatsapp = sellerSession ? sellerSession.whatsapp : sellerInput?.whatsapp ? normalizeKenyanPhone(sellerInput.whatsapp) : null
    const [category] = await database.select({ id: marketplaceCategories.id }).from(marketplaceCategories)
      .where(and(eq(marketplaceCategories.id, submission.categoryId), eq(marketplaceCategories.active, true)))
      .limit(1)
    const [county] = await database.select({ id: marketplaceCounties.id }).from(marketplaceCounties)
      .where(and(eq(marketplaceCounties.code, sellerSession?.countyCode ?? sellerInput!.countyCode), eq(marketplaceCounties.active, true)))
      .limit(1)
    if (!category || !county) {
      response.status(400).json({ error: { code: 'INVALID_LOCATION_OR_CATEGORY', message: 'Choose an active product category and county.' } })
      return
    }
    if (submission.subcategoryId) {
      const [subcategory] = await database.select({ id: marketplaceSubcategories.id }).from(marketplaceSubcategories)
        .where(and(eq(marketplaceSubcategories.id, submission.subcategoryId), eq(marketplaceSubcategories.categoryId, category.id), eq(marketplaceSubcategories.active, true)))
        .limit(1)
      if (!subcategory) {
        response.status(400).json({ error: { code: 'INVALID_SUBCATEGORY', message: 'Choose an active subcategory for the selected category.' } })
        return
      }
    }
    const reference = createListingReference()
    const statusToken = createSecret()
    const feeBasisPoints = await getFeeBasisPoints('publication_fee_basis_points', 1_000)
    const publicationFeeKes = calculateFeeKes(submission.priceKes, feeBasisPoints)
    const slug = createListingSlug(submission.title, reference)
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    await database.transaction(async (transaction) => {
      const sellerEmail = sellerSession?.email ?? (sellerInput?.email?.trim().toLowerCase() || null)
      let sellerId = sellerSession?.sellerId
      if (!sellerSession) {
        const [seller] = await transaction.insert(marketplaceSellers).values({
          name: sellerInput!.name,
          phone: sellerPhone,
          whatsapp,
          email: sellerEmail,
          countyId: county.id,
          subcounty: sellerInput!.subcounty,
          town: sellerInput!.town,
          area: sellerInput!.area || null,
        }).returning({ id: marketplaceSellers.id })
        sellerId = seller?.id
      }
      if (!sellerId) throw new Error('Marketplace seller profile was not found.')
      const [product] = await transaction.insert(marketplaceProducts).values({
        reference,
        slug,
        title: submission.title,
        description: submission.description,
        categoryId: category.id,
        subcategoryId: submission.subcategoryId ?? null,
        sellerId,
        condition: submission.condition,
        priceKes: submission.priceKes,
        negotiable: submission.negotiable,
        status: 'pending_payment',
      }).returning({ id: marketplaceProducts.id })
      if (!product) throw new Error('Marketplace listing record was not created.')
      await transaction.insert(marketplaceProductAccess).values({ productId: product.id, tokenHash: hashSecret(statusToken), expiresAt })
      if (sellerEmail) await enqueueMarketplaceEmail(transaction, {
        eventKey: `listing:${reference}:submission-received:seller`,
        to: sellerEmail,
        kind: 'product_submission_received',
        data: { name: sellerSession?.name ?? sellerInput?.name ?? '', title: submission.title, reference, amountKes: publicationFeeKes },
      })
      const adminEmails = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
        .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'second_hand_admin', 'marketplace_moderator'])))
      for (const admin of adminEmails) await enqueueMarketplaceEmail(transaction, {
        eventKey: `listing:${reference}:new-submission:${admin.email}`,
        to: admin.email,
        kind: 'admin_new_submission',
        data: { title: submission.title, reference, amountKes: publicationFeeKes },
      })
    })
    response.status(201).json({ data: {
      reference,
      slug,
      statusToken,
      status: 'pending_payment',
      priceKes: submission.priceKes,
      publicationFeeKes,
      currency: 'KES',
      expiresAt: expiresAt.toISOString(),
    } })
  } catch (error) {
    if (error instanceof Error && /valid Kenyan mobile number/.test(error.message)) {
      response.status(400).json({ error: { code: 'INVALID_PHONE', message: error.message } })
      return
    }
    next(error)
  }
})

submissionRouter.get('/submissions/:reference/status', async (request, response) => {
  const reference = z.string().regex(/^MH-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const token = request.get('x-submission-token') ?? ''
  if (!reference.success || token.length < 20) {
    response.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'The submission could not be found.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace status is temporarily unavailable.' } })
    return
  }
  const [submission] = await database.select({ reference: marketplaceProducts.reference, slug: marketplaceProducts.slug, status: marketplaceProducts.status, updatedAt: marketplaceProducts.updatedAt, expiresAt: marketplaceProductAccess.expiresAt, tokenHash: marketplaceProductAccess.tokenHash })
    .from(marketplaceProducts)
    .innerJoin(marketplaceProductAccess, eq(marketplaceProducts.id, marketplaceProductAccess.productId))
    .where(and(eq(marketplaceProducts.reference, reference.data), gt(marketplaceProductAccess.expiresAt, new Date())))
    .limit(1)
  if (!submission || submission.tokenHash !== hashSecret(token)) {
    response.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'The submission could not be found.' } })
    return
  }
  response.json({ data: { reference: submission.reference, slug: submission.slug, status: submission.status, updatedAt: submission.updatedAt, expiresAt: submission.expiresAt } })
})

submissionRouter.post('/submissions/:reference/images', imageUploadLimiter, imageBody, async (request, response, next) => {
  const reference = z.string().regex(/^MH-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const token = request.get('x-submission-token') ?? ''
  if (!reference.success || token.length < 20 || !Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: { code: 'INVALID_IMAGE', message: 'Upload a JPEG, PNG or WebP image.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const [submission] = await database.select({ id: marketplaceProducts.id, status: marketplaceProducts.status, tokenHash: marketplaceProductAccess.tokenHash })
      .from(marketplaceProducts).innerJoin(marketplaceProductAccess, eq(marketplaceProductAccess.productId, marketplaceProducts.id))
      .where(and(eq(marketplaceProducts.reference, reference.data), gt(marketplaceProductAccess.expiresAt, new Date()))).limit(1)
    if (!submission || submission.tokenHash !== hashSecret(token)) {
      response.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'The submission could not be found.' } })
      return
    }
    if (submission.status !== 'pending_payment') {
      response.status(409).json({ error: { code: 'SUBMISSION_NOT_EDITABLE', message: 'Images cannot be changed for this listing.' } })
      return
    }
    const existing = await database.select({ id: marketplaceProductImages.id, isPrimary: marketplaceProductImages.isPrimary })
      .from(marketplaceProductImages).where(eq(marketplaceProductImages.productId, submission.id))
    if (existing.length >= 5) {
      response.status(413).json({ error: { code: 'IMAGE_LIMIT_REACHED', message: 'A listing can have at most five images.' } })
      return
    }
    const uploaded = await uploadMarketplaceImage({ buffer: request.body, reference: reference.data, order: existing.length })
    const makePrimary = request.get('x-primary-image') === 'true' || existing.length === 0
    const [image] = await database.transaction(async (transaction) => {
      if (makePrimary) await transaction.update(marketplaceProductImages).set({ isPrimary: false }).where(eq(marketplaceProductImages.productId, submission.id))
      return transaction.insert(marketplaceProductImages).values({
        productId: submission.id,
        storageKey: uploaded.storageKey,
        imageUrl: uploaded.imageUrl,
        contentType: uploaded.contentType,
        byteSize: uploaded.byteSize,
        width: uploaded.width,
        height: uploaded.height,
        isPrimary: makePrimary,
        sortOrder: existing.length,
      }).returning({ id: marketplaceProductImages.id, imageUrl: marketplaceProductImages.imageUrl, isPrimary: marketplaceProductImages.isPrimary, sortOrder: marketplaceProductImages.sortOrder })
    })
    if (!image) throw new Error('Marketplace image record was not created.')
    response.status(201).json({ data: image })
  } catch (error) {
    if (error instanceof Error && /valid JPEG/.test(error.message)) {
      response.status(400).json({ error: { code: 'INVALID_IMAGE', message: error.message } })
      return
    }
    if (error instanceof Error && /persistent image storage is not configured/.test(error.message)) {
      response.status(503).json({ error: { code: 'IMAGE_STORAGE_UNAVAILABLE', message: 'Product image storage is not configured. Contact marketplace support.' } })
      return
    }
    if (error instanceof Error && /storage rejected|storage returned/.test(error.message)) {
      response.status(502).json({ error: { code: 'IMAGE_STORAGE_FAILED', message: 'Product image storage could not process this upload. Please try again.' } })
      return
    }
    next(error)
  }
})

submissionRouter.patch('/submissions/:reference/images/order', async (request, response) => {
  const reference = z.string().regex(/^MH-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const body = z.object({ imageIds: z.array(z.string().uuid()).min(1).max(5) }).safeParse(request.body)
  const token = request.get('x-submission-token') ?? ''
  if (!reference.success || !body.success || token.length < 20 || new Set(body.data.imageIds).size !== body.data.imageIds.length) {
    response.status(400).json({ error: { code: 'INVALID_IMAGE_ORDER', message: 'The image order is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  const [submission] = await database.select({ id: marketplaceProducts.id, tokenHash: marketplaceProductAccess.tokenHash })
    .from(marketplaceProducts).innerJoin(marketplaceProductAccess, eq(marketplaceProductAccess.productId, marketplaceProducts.id))
    .where(and(eq(marketplaceProducts.reference, reference.data), gt(marketplaceProductAccess.expiresAt, new Date()), eq(marketplaceProducts.status, 'pending_payment'))).limit(1)
  if (!submission || submission.tokenHash !== hashSecret(token)) {
    response.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'The submission could not be found.' } })
    return
  }
  const images = await database.select({ id: marketplaceProductImages.id }).from(marketplaceProductImages).where(eq(marketplaceProductImages.productId, submission.id))
  if (images.length !== body.data.imageIds.length || images.some(({ id }) => !body.data.imageIds.includes(id))) {
    response.status(400).json({ error: { code: 'INVALID_IMAGE_ORDER', message: 'Choose the uploaded images for this listing.' } })
    return
  }
  await database.transaction(async (transaction) => {
    for (const [sortOrder, id] of body.data.imageIds.entries()) {
      await transaction.update(marketplaceProductImages).set({ sortOrder }).where(and(eq(marketplaceProductImages.id, id), eq(marketplaceProductImages.productId, submission.id)))
    }
  })
  response.json({ data: { imageIds: body.data.imageIds } })
})

submissionRouter.patch('/submissions/:reference/images/:imageId/primary', async (request, response) => {
  const reference = z.string().regex(/^MH-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const imageId = z.string().uuid().safeParse(request.params.imageId)
  const token = request.get('x-submission-token') ?? ''
  if (!reference.success || !imageId.success || token.length < 20) {
    response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'The image could not be found.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  const [submission] = await database.select({ id: marketplaceProducts.id, tokenHash: marketplaceProductAccess.tokenHash })
    .from(marketplaceProducts).innerJoin(marketplaceProductAccess, eq(marketplaceProductAccess.productId, marketplaceProducts.id))
    .where(and(eq(marketplaceProducts.reference, reference.data), gt(marketplaceProductAccess.expiresAt, new Date()), eq(marketplaceProducts.status, 'pending_payment'))).limit(1)
  if (!submission || submission.tokenHash !== hashSecret(token)) {
    response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'The image could not be found.' } })
    return
  }
  const [image] = await database.select({ id: marketplaceProductImages.id }).from(marketplaceProductImages)
    .where(and(eq(marketplaceProductImages.id, imageId.data), eq(marketplaceProductImages.productId, submission.id))).limit(1)
  if (!image) {
    response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'The image could not be found.' } })
    return
  }
  await database.transaction(async (transaction) => {
    await transaction.update(marketplaceProductImages).set({ isPrimary: false }).where(eq(marketplaceProductImages.productId, submission.id))
    await transaction.update(marketplaceProductImages).set({ isPrimary: true }).where(eq(marketplaceProductImages.id, image.id))
  })
  response.json({ data: { primaryImageId: image.id } })
})

submissionRouter.delete('/submissions/:reference/images/:imageId', async (request, response, next) => {
  const reference = z.string().regex(/^MH-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const imageId = z.string().uuid().safeParse(request.params.imageId)
  const token = request.get('x-submission-token') ?? ''
  if (!reference.success || !imageId.success || token.length < 20) {
    response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'The image could not be found.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const [submission] = await database.select({ id: marketplaceProducts.id, tokenHash: marketplaceProductAccess.tokenHash })
      .from(marketplaceProducts).innerJoin(marketplaceProductAccess, eq(marketplaceProductAccess.productId, marketplaceProducts.id))
      .where(and(eq(marketplaceProducts.reference, reference.data), gt(marketplaceProductAccess.expiresAt, new Date()), eq(marketplaceProducts.status, 'pending_payment'))).limit(1)
    if (!submission || submission.tokenHash !== hashSecret(token)) {
      response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'The image could not be found.' } })
      return
    }
    const [image] = await database.select({ id: marketplaceProductImages.id, storageKey: marketplaceProductImages.storageKey, isPrimary: marketplaceProductImages.isPrimary })
      .from(marketplaceProductImages).where(and(eq(marketplaceProductImages.id, imageId.data), eq(marketplaceProductImages.productId, submission.id))).limit(1)
    if (!image) {
      response.status(404).json({ error: { code: 'IMAGE_NOT_FOUND', message: 'The image could not be found.' } })
      return
    }
    await deleteMarketplaceImage(image.storageKey)
    await database.delete(marketplaceProductImages).where(eq(marketplaceProductImages.id, image.id))
    if (image.isPrimary) {
      const [next] = await database.select({ id: marketplaceProductImages.id }).from(marketplaceProductImages)
        .where(eq(marketplaceProductImages.productId, submission.id)).orderBy(asc(marketplaceProductImages.sortOrder)).limit(1)
      if (next) await database.update(marketplaceProductImages).set({ isPrimary: true }).where(eq(marketplaceProductImages.id, next.id))
    }
    response.json({ data: { deleted: true } })
  } catch (error) {
    next(error)
  }
})
