import { and, asc, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminUsers, marketplaceAuditLogs, marketplaceCategories, marketplaceContactUnlocks, marketplaceCounties, marketplacePaymentCallbacks, marketplacePayments, marketplaceProductReports, marketplaceProducts, marketplaceSettings, marketplaceSellers } from '../../database/schema.js'
import { requireMarketplacePermission, type MarketplaceAdminSession } from './marketplace-auth.js'
import { parseDarajaTimestamp, queryStkPayment } from '../payments/daraja.js'
import { normalizeKenyanPhone } from '../marketplace/security.js'
import { listingExpiryAt, resolveListingExpiryDays } from '../marketplace/expiry.js'
import { parseMarketplaceSocialLinks } from '../marketplace/social-links.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'

export const marketplaceAdminDataRouter = Router()
const adminSession = (response: import('express').Response) => response.locals.marketplaceAdmin as MarketplaceAdminSession

marketplaceAdminDataRouter.get('/dashboard', requireMarketplacePermission('dashboard:read'), async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  try {
    const [listingStates, revenueRows, paymentStates, reports, recentListings] = await Promise.all([
      database.select({ status: marketplaceProducts.status, total: count() }).from(marketplaceProducts).groupBy(marketplaceProducts.status),
      database.select({ purpose: marketplacePayments.purpose, amount: sql<string>`coalesce(sum(${marketplacePayments.amountKes}), 0)` })
        .from(marketplacePayments).where(eq(marketplacePayments.status, 'succeeded')).groupBy(marketplacePayments.purpose),
      database.select({ status: marketplacePayments.status, total: count() }).from(marketplacePayments).groupBy(marketplacePayments.status),
      database.select({ total: count() }).from(marketplaceProductReports).where(eq(marketplaceProductReports.status, 'open')),
      database.select({ reference: marketplaceProducts.reference, title: marketplaceProducts.title, status: marketplaceProducts.status, priceKes: marketplaceProducts.priceKes, createdAt: marketplaceProducts.createdAt, category: marketplaceCategories.name, county: marketplaceCounties.name })
        .from(marketplaceProducts).innerJoin(marketplaceCategories, eq(marketplaceProducts.categoryId, marketplaceCategories.id)).innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id)).innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
        .orderBy(desc(marketplaceProducts.createdAt)).limit(8),
    ])
    const listingCount = (status: string) => Number(listingStates.find((item) => item.status === status)?.total ?? 0)
    const paymentCount = (status: string) => Number(paymentStates.find((item) => item.status === status)?.total ?? 0)
    const admin = adminSession(response)
    const canReadFinance = admin.role === 'super_admin' || admin.role === 'finance_admin'
    const revenueByPurpose = new Map(revenueRows.map(({ purpose, amount }) => [purpose, Number(amount)]))
    response.json({ data: {
      listings: {
        total: listingStates.reduce((total, item) => total + Number(item.total), 0),
        published: listingCount('published'), pendingPayment: listingCount('pending_payment'), sold: listingCount('sold'),
        expired: listingCount('expired'), suspended: listingCount('suspended'),
      },
      payments: { successful: paymentCount('succeeded'), failed: paymentCount('failed'), pending: paymentCount('pending'), ambiguous: paymentCount('ambiguous') },
      reports: { open: Number(reports[0]?.total ?? 0) },
      ...(canReadFinance ? { revenueKes: {
        publication: revenueByPurpose.get('PRODUCT_PUBLICATION') ?? 0,
        contactUnlock: revenueByPurpose.get('CONTACT_UNLOCK') ?? 0,
      } } : {}),
      recentListings,
    } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/listings', requireMarketplacePermission('listings:manage'), async (request, response, next) => {
  const query = z.object({ q: z.string().trim().max(120).optional(), status: z.string().max(24).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(25) }).safeParse(request.query)
  if (!query.success) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Listing filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const conditions = []
    if (query.data.q) conditions.push(ilike(marketplaceProducts.title, `%${query.data.q}%`))
    if (query.data.status) conditions.push(eq(marketplaceProducts.status, query.data.status))
    const where = conditions.length ? and(...conditions) : undefined
    const [rows, totals] = await Promise.all([
      database.select({ reference: marketplaceProducts.reference, slug: marketplaceProducts.slug, title: marketplaceProducts.title, status: marketplaceProducts.status, priceKes: marketplaceProducts.priceKes, createdAt: marketplaceProducts.createdAt, category: marketplaceCategories.name, county: marketplaceCounties.name, town: marketplaceSellers.town })
        .from(marketplaceProducts).innerJoin(marketplaceCategories, eq(marketplaceProducts.categoryId, marketplaceCategories.id)).innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id)).innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
        .where(where).orderBy(desc(marketplaceProducts.createdAt)).limit(query.data.limit).offset((query.data.page - 1) * query.data.limit),
      database.select({ total: count() }).from(marketplaceProducts).where(where),
    ])
    response.json({ data: rows, pagination: { page: query.data.page, limit: query.data.limit, total: Number(totals[0]?.total ?? 0) } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/listings/:reference/status', requireMarketplacePermission('listings:manage'), async (request, response, next) => {
  const parsed = z.object({ status: z.enum(['published', 'suspended', 'sold', 'removed']) }).safeParse(request.body)
  const reference = z.string().regex(/^MH-[A-F0-9]{16}$/).safeParse(request.params.reference)
  if (!parsed.success || !reference.success) {
    response.status(400).json({ error: { code: 'INVALID_LISTING_ACTION', message: 'The listing action is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const [product] = await database.select({ id: marketplaceProducts.id, status: marketplaceProducts.status, publishedAt: marketplaceProducts.publishedAt, title: marketplaceProducts.title, sellerName: marketplaceSellers.name, sellerEmail: marketplaceSellers.email }).from(marketplaceProducts)
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id)).where(eq(marketplaceProducts.reference, reference.data)).limit(1)
    if (!product) {
      response.status(404).json({ error: { code: 'LISTING_NOT_FOUND', message: 'The listing could not be found.' } })
      return
    }
    if (parsed.data.status === 'published' && (product.status !== 'suspended' || !product.publishedAt)) {
      response.status(409).json({ error: { code: 'PUBLICATION_PAYMENT_REQUIRED', message: 'Only a previously paid, suspended listing can be restored.' } })
      return
    }
    if (parsed.data.status !== 'published' && !['published', 'suspended'].includes(product.status)) {
      response.status(409).json({ error: { code: 'LISTING_STATE_CONFLICT', message: 'This listing cannot transition from its current state.' } })
      return
    }
    const admin = adminSession(response)
    await database.transaction(async (transaction) => {
      await transaction.update(marketplaceProducts).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(marketplaceProducts.id, product.id))
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: admin.id, action: `listing.${parsed.data.status}`, resourceType: 'marketplace_product', resourceId: product.id, metadata: { reference: reference.data } })
      if (parsed.data.status === 'removed' && product.sellerEmail) await enqueueMarketplaceEmail(transaction, {
        eventKey: `listing:${reference.data}:removed`,
        to: product.sellerEmail,
        kind: 'product_removed',
        data: { name: product.sellerName, title: product.title, reference: reference.data },
      })
    })
    response.json({ data: { reference: reference.data, status: parsed.data.status } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/categories', requireMarketplacePermission('categories:manage'), async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const categories = await database.select().from(marketplaceCategories).orderBy(asc(marketplaceCategories.sortOrder), asc(marketplaceCategories.name))
    response.json({ data: categories })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/settings/fees', requireMarketplacePermission('settings:manage'), async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace settings are temporarily unavailable.' } })
    return
  }
  try {
    const settings = await database.select({ key: marketplaceSettings.key, value: marketplaceSettings.value }).from(marketplaceSettings)
      .where(inArray(marketplaceSettings.key, ['publication_fee_basis_points', 'contact_unlock_fee_basis_points', 'listing_expiry_days']))
    const values = new Map(settings.map(({ key, value }) => [key, Number(value)]))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: {
      publicationFeeBasisPoints: values.get('publication_fee_basis_points') ?? 1_000,
      contactUnlockFeeBasisPoints: values.get('contact_unlock_fee_basis_points') ?? 500,
      listingExpiryDays: resolveListingExpiryDays(values.get('listing_expiry_days')),
    } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/settings/footer-social-links', requireMarketplacePermission('settings:manage'), async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace settings are temporarily unavailable.' } })
    return
  }
  try {
    const [setting] = await database.select({ value: marketplaceSettings.value }).from(marketplaceSettings).where(eq(marketplaceSettings.key, 'footer_social_links')).limit(1)
    const result = parseMarketplaceSocialLinks(setting?.value ?? {})
    if (!result.success) {
      response.status(500).json({ error: { code: 'INVALID_STORED_SETTINGS', message: 'Saved footer contact settings need administrator review.' } })
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: {
      facebookUrl: result.data.facebookUrl ?? '',
      xUrl: result.data.xUrl ?? '',
      youtubeUrl: result.data.youtubeUrl ?? '',
      whatsappPhone: result.data.whatsappPhone ?? '',
    } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/settings/footer-social-links', requireMarketplacePermission('settings:manage'), async (request, response, next) => {
  const parsed = parseMarketplaceSocialLinks(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SOCIAL_SETTINGS', message: parsed.message } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace settings are temporarily unavailable.' } })
    return
  }
  const values = {
    facebookUrl: parsed.data.facebookUrl,
    xUrl: parsed.data.xUrl,
    youtubeUrl: parsed.data.youtubeUrl,
    whatsappPhone: parsed.data.whatsappPhone,
  }
  const admin = adminSession(response)
  try {
    await database.transaction(async (transaction) => {
      await transaction.insert(marketplaceSettings).values({ key: 'footer_social_links', value: values })
        .onConflictDoUpdate({ target: marketplaceSettings.key, set: { value: values, updatedAt: new Date() } })
      await transaction.insert(marketplaceAuditLogs).values({
        adminUserId: admin.id,
        action: 'settings.footer-social-links.update',
        resourceType: 'marketplace_settings',
        metadata: {
          facebookConfigured: Boolean(values.facebookUrl),
          xConfigured: Boolean(values.xUrl),
          youtubeConfigured: Boolean(values.youtubeUrl),
          whatsappConfigured: Boolean(values.whatsappPhone),
        },
      })
    })
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: values })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.post('/categories', requireMarketplacePermission('categories:manage'), async (request, response, next) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), parentId: z.string().uuid().optional(), sortOrder: z.number().int().min(0).max(10000).default(0) }).safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_CATEGORY', message: 'Category details are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const [category] = await database.transaction(async (transaction) => {
      const created = await transaction.insert(marketplaceCategories).values({ ...parsed.data, parentId: parsed.data.parentId ?? null }).returning()
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: adminSession(response).id, action: 'category.create', resourceType: 'marketplace_category', resourceId: created[0]?.id ?? null })
      return created
    })
    response.status(201).json({ data: category })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/categories/:id', requireMarketplacePermission('categories:manage'), async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id)
  const parsed = z.object({ name: z.string().trim().min(2).max(100).optional(), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10000).optional(), parentId: z.string().uuid().nullable().optional() }).refine((value) => Object.keys(value).length > 0).safeParse(request.body)
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_CATEGORY', message: 'Category changes are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    const [category] = await database.transaction(async (transaction) => {
      const updated = await transaction.update(marketplaceCategories).set({ ...parsed.data, updatedAt: new Date() }).where(eq(marketplaceCategories.id, id.data)).returning()
      if (updated[0]) await transaction.insert(marketplaceAuditLogs).values({ adminUserId: adminSession(response).id, action: 'category.update', resourceType: 'marketplace_category', resourceId: id.data, metadata: parsed.data })
      return updated
    })
    if (!category) {
      response.status(404).json({ error: { code: 'CATEGORY_NOT_FOUND', message: 'The category could not be found.' } })
      return
    }
    response.json({ data: category })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/settings/fees', requireMarketplacePermission('settings:manage'), async (request, response, next) => {
  const parsed = z.object({ publicationFeeBasisPoints: z.number().int().min(1).max(10_000), contactUnlockFeeBasisPoints: z.number().int().min(1).max(10_000), listingExpiryDays: z.number().int().min(1).max(365) }).safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_FEE_SETTINGS', message: 'Fee rates must be between 0.01% and 100%.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace settings are temporarily unavailable.' } })
    return
  }
  const admin = adminSession(response)
  try {
    await database.transaction(async (transaction) => {
      await transaction.insert(marketplaceSettings).values([
        { key: 'publication_fee_basis_points', value: parsed.data.publicationFeeBasisPoints },
        { key: 'contact_unlock_fee_basis_points', value: parsed.data.contactUnlockFeeBasisPoints },
        { key: 'listing_expiry_days', value: parsed.data.listingExpiryDays },
      ]).onConflictDoUpdate({ target: marketplaceSettings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
      await transaction.update(marketplaceProducts).set({
        expiresAt: sql`${marketplaceProducts.publishedAt} + (${parsed.data.listingExpiryDays} * interval '1 day')`,
        updatedAt: new Date(),
      }).where(eq(marketplaceProducts.status, 'published'))
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: admin.id, action: 'settings.fees.update', resourceType: 'marketplace_settings', metadata: parsed.data })
    })
    response.json({ data: parsed.data })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/payments', requireMarketplacePermission('finance:read'), async (request, response, next) => {
  const page = z.coerce.number().int().min(1).default(1).safeParse(request.query.page)
  if (!page.success) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Payment pagination is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace payments are temporarily unavailable.' } })
    return
  }
  try {
    const rows = await database.select({ reference: marketplacePayments.paymentReference, purpose: marketplacePayments.purpose, amountKes: marketplacePayments.amountKes, status: marketplacePayments.status, createdAt: marketplacePayments.createdAt, listingReference: marketplaceProducts.reference })
      .from(marketplacePayments).leftJoin(marketplaceProducts, eq(marketplacePayments.productId, marketplaceProducts.id))
      .orderBy(desc(marketplacePayments.createdAt)).limit(50).offset((page.data - 1) * 50)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: rows, pagination: { page: page.data, limit: 50 } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.post('/payments/:reference/reconcile', requireMarketplacePermission('finance:read'), async (request, response, next) => {
  const reference = z.string().regex(/^MP-[A-F0-9]{16}$/).safeParse(request.params.reference)
  if (!reference.success || !database) {
    response.status(reference.success ? 503 : 400).json({ error: { code: reference.success ? 'MARKETPLACE_UNAVAILABLE' : 'INVALID_PAYMENT_REFERENCE', message: 'Payment reconciliation could not be started.' } })
    return
  }
  try {
    const [payment] = await database.select({ id: marketplacePayments.id, checkoutRequestId: marketplacePayments.checkoutRequestId, merchantRequestId: marketplacePayments.merchantRequestId, purpose: marketplacePayments.purpose, productId: marketplacePayments.productId, amountKes: marketplacePayments.amountKes, phone: marketplacePayments.phone, customerEmail: marketplacePayments.customerEmail, status: marketplacePayments.status, accessTokenHash: marketplacePayments.accessTokenHash })
      .from(marketplacePayments).where(eq(marketplacePayments.paymentReference, reference.data)).limit(1)
    if (!payment) {
      response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'The marketplace payment could not be found.' } })
      return
    }
    if (payment.status === 'succeeded') {
      response.json({ data: { reference: reference.data, status: 'succeeded', reconciled: false } })
      return
    }
    if (!['pending', 'ambiguous'].includes(payment.status) || !payment.checkoutRequestId) {
      response.status(409).json({ error: { code: 'PAYMENT_NOT_RECONCILABLE', message: 'This payment is not in a reconcilable state.' } })
      return
    }
    await database.update(marketplacePayments).set({ lastReconciliationAt: new Date(), reconciliationAttempts: sql`${marketplacePayments.reconciliationAttempts} + 1`, updatedAt: new Date() })
      .where(eq(marketplacePayments.id, payment.id))
    const providerResult = await queryStkPayment(payment.checkoutRequestId)
    if (providerResult.resultCode !== '0' || providerResult.checkoutRequestId !== payment.checkoutRequestId || providerResult.merchantRequestId !== payment.merchantRequestId) {
      response.json({ data: { reference: reference.data, status: payment.status, reconciled: false } })
      return
    }
    const [callbackRow] = await database.select({ id: marketplacePaymentCallbacks.id, payload: marketplacePaymentCallbacks.payload }).from(marketplacePaymentCallbacks)
      .where(eq(marketplacePaymentCallbacks.paymentId, payment.id)).orderBy(desc(marketplacePaymentCallbacks.receivedAt)).limit(1)
    const callback = z.object({ Body: z.object({ stkCallback: z.object({ MerchantRequestID: z.string(), CheckoutRequestID: z.string(), ResultCode: z.union([z.string(), z.number()]), CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) }) }) }) }).safeParse(callbackRow?.payload)
    if (!callback.success) {
      response.json({ data: { reference: reference.data, status: 'ambiguous', reconciled: false } })
      return
    }
    const callbackData = callback.data.Body.stkCallback
    const metadata = new Map(callbackData.CallbackMetadata.Item.map(({ Name, Value }) => [Name, Value]))
    const receipt = metadata.get('MpesaReceiptNumber')
    const transactionAt = parseDarajaTimestamp(metadata.get('TransactionDate'))
    const matches = String(callbackData.ResultCode) === '0'
      && callbackData.CheckoutRequestID === payment.checkoutRequestId
      && callbackData.MerchantRequestID === payment.merchantRequestId
      && Number(metadata.get('Amount')) === payment.amountKes
      && normalizeKenyanPhone(String(metadata.get('PhoneNumber') ?? '')) === payment.phone
      && typeof receipt === 'string' && /^[A-Z0-9]{6,32}$/.test(receipt)
      && transactionAt !== null
    if (!matches || !payment.productId) {
      response.json({ data: { reference: reference.data, status: 'ambiguous', reconciled: false } })
      return
    }
    const now = new Date()
    const admin = adminSession(response)
    let reconciled = false
    await database.transaction(async (transaction) => {
      const updated = await transaction.update(marketplacePayments).set({ status: 'succeeded', providerReceipt: receipt, transactionAt, verifiedAt: now, callbackProcessedAt: now, providerDetails: { verification: 'operator_reconciliation', checkoutRequestId: payment.checkoutRequestId, merchantRequestId: payment.merchantRequestId }, updatedAt: now })
        .where(and(eq(marketplacePayments.id, payment.id), inArray(marketplacePayments.status, ['pending', 'ambiguous'])))
        .returning({ id: marketplacePayments.id })
      if (!updated.length) return
      reconciled = true
      if (callbackRow) await transaction.update(marketplacePaymentCallbacks).set({ outcome: 'reconciled_success', processedAt: now }).where(eq(marketplacePaymentCallbacks.id, callbackRow.id))
      if (payment.purpose === 'PRODUCT_PUBLICATION') {
        const [expirySetting] = await transaction.select({ value: marketplaceSettings.value }).from(marketplaceSettings)
          .where(eq(marketplaceSettings.key, 'listing_expiry_days')).limit(1)
        const [published] = await transaction.update(marketplaceProducts).set({ status: 'published', publishedAt: now, expiresAt: listingExpiryAt(now, expirySetting?.value), updatedAt: now })
          .where(and(eq(marketplaceProducts.id, payment.productId!), eq(marketplaceProducts.status, 'pending_payment')))
          .returning({ id: marketplaceProducts.id })
        const [product] = await transaction.select({ title: marketplaceProducts.title, reference: marketplaceProducts.reference, sellerEmail: marketplaceSellers.email, sellerName: marketplaceSellers.name }).from(marketplaceProducts)
          .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id)).where(eq(marketplaceProducts.id, payment.productId!)).limit(1)
        if (published && product?.sellerEmail) {
          await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${reference.data}:verified`, to: product.sellerEmail, kind: 'publication_payment_success', data: { name: product.sellerName, title: product.title, reference: reference.data, amountKes: payment.amountKes } })
          await enqueueMarketplaceEmail(transaction, { eventKey: `listing:${reference.data}:published`, to: product.sellerEmail, kind: 'product_published', data: { name: product.sellerName, title: product.title, reference: reference.data, amountKes: payment.amountKes } })
        }
        if (payment.customerEmail) await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${reference.data}:receipt`, to: payment.customerEmail, kind: 'payment_receipt', data: { title: product?.title, reference: reference.data, amountKes: payment.amountKes } })
        const financeAdmins = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
          .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'finance_admin'])))
        for (const recipient of financeAdmins) await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${reference.data}:admin-success:${recipient.email}`, to: recipient.email, kind: 'admin_publication_success', data: { title: product?.title, reference: reference.data, amountKes: payment.amountKes } })
      } else if (payment.purpose === 'CONTACT_UNLOCK' && payment.accessTokenHash) {
        await transaction.insert(marketplaceContactUnlocks).values({ productId: payment.productId!, paymentId: payment.id, tokenHash: payment.accessTokenHash, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }).onConflictDoNothing()
        if (payment.customerEmail) await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${reference.data}:receipt`, to: payment.customerEmail, kind: 'payment_receipt', data: { reference: reference.data, amountKes: payment.amountKes } })
      }
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: admin.id, action: 'payment.reconcile.success', resourceType: 'marketplace_payment', resourceId: payment.id, metadata: { reference: reference.data } })
    })
    response.json({ data: { reference: reference.data, status: reconciled ? 'succeeded' : payment.status, reconciled } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/reports', requireMarketplacePermission('support:manage'), async (request, response, next) => {
  const query = z.object({ status: z.enum(['open', 'reviewed', 'resolved', 'dismissed']).optional(), page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query)
  if (!query.success) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Report filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace reports are temporarily unavailable.' } })
    return
  }
  try {
    const where = query.data.status ? eq(marketplaceProductReports.status, query.data.status) : undefined
    const rows = await database.select({ id: marketplaceProductReports.id, reference: marketplaceProducts.reference, title: marketplaceProducts.title, reason: marketplaceProductReports.reason, details: marketplaceProductReports.details, reporterEmail: marketplaceProductReports.reporterEmail, status: marketplaceProductReports.status, createdAt: marketplaceProductReports.createdAt })
      .from(marketplaceProductReports).innerJoin(marketplaceProducts, eq(marketplaceProductReports.productId, marketplaceProducts.id))
      .where(where).orderBy(desc(marketplaceProductReports.createdAt)).limit(50).offset((query.data.page - 1) * 50)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: rows, pagination: { page: query.data.page, limit: 50 } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/reports/:id', requireMarketplacePermission('support:manage'), async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id)
  const parsed = z.object({ status: z.enum(['reviewed', 'resolved', 'dismissed']) }).safeParse(request.body)
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_REPORT_ACTION', message: 'The report action is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace reports are temporarily unavailable.' } })
    return
  }
  try {
    const [report] = await database.transaction(async (transaction) => {
      const updated = await transaction.update(marketplaceProductReports).set({ status: parsed.data.status, resolvedAt: parsed.data.status === 'reviewed' ? null : new Date() })
        .where(eq(marketplaceProductReports.id, id.data)).returning({ id: marketplaceProductReports.id, productId: marketplaceProductReports.productId })
      if (updated[0]) await transaction.insert(marketplaceAuditLogs).values({ adminUserId: adminSession(response).id, action: `report.${parsed.data.status}`, resourceType: 'marketplace_product_report', resourceId: id.data, metadata: { productId: updated[0].productId } })
      return updated
    })
    if (!report) {
      response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'The listing report could not be found.' } })
      return
    }
    response.json({ data: { id: report.id, status: parsed.data.status } })
  } catch (error) {
    next(error)
  }
})
