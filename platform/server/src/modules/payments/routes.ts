import { and, desc, eq, gt, gte, inArray } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceContactUnlocks, marketplaceCounties, marketplacePaymentCallbacks, marketplacePayments, marketplaceProductAccess, marketplaceProducts, marketplaceSellers, marketplaceSettings } from '../../database/schema.js'
import { calculateFeeKes, createListingReference, createSecret, hashSecret, normalizeKenyanPhone } from '../marketplace/security.js'
import { assertDarajaConfigured, DarajaUnavailableError, initiateStkPush, paymentCallbackFingerprint, queryStkPayment, verifyCallbackToken } from './daraja.js'

export const paymentRouter = Router()

const publicationInput = z.object({ reference: z.string().regex(/^MH-[A-F0-9]{16}$/), phone: z.string().max(24), submissionToken: z.string().min(20).max(100) })
const unlockInput = z.object({ slug: z.string().min(1).max(180), phone: z.string().max(24) })
const callbackSchema = z.object({
  Body: z.object({ stkCallback: z.object({
    MerchantRequestID: z.string().min(1).max(100),
    CheckoutRequestID: z.string().min(1).max(100),
    ResultCode: z.union([z.string(), z.number()]),
    ResultDesc: z.string().max(500).optional(),
    CallbackMetadata: z.object({ Item: z.array(z.object({ Name: z.string().max(80), Value: z.union([z.string(), z.number()]).optional() })).optional() }).optional(),
  }) }),
})

async function getFeeBasisPoints(key: string, fallback: number): Promise<number> {
  if (!database) return fallback
  const [setting] = await database.select({ value: marketplaceSettings.value }).from(marketplaceSettings).where(eq(marketplaceSettings.key, key)).limit(1)
  const value = Number(setting?.value ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error('Marketplace fee configuration is invalid.')
  return value
}

function sendPaymentError(response: import('express').Response, error: unknown): void {
  if (error instanceof Error && /valid Kenyan mobile number/.test(error.message)) {
    response.status(400).json({ error: { code: 'INVALID_PHONE', message: error.message } })
    return
  }
  if (error instanceof DarajaUnavailableError) {
    response.status(503).json({ error: { code: 'PAYMENTS_UNAVAILABLE', message: error.message } })
    return
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Payment could not be initiated.' } })
}

async function startPayment(input: {
  purpose: 'PRODUCT_PUBLICATION' | 'CONTACT_UNLOCK'
  productId: string
  phone: string
  amountKes: number
  accessToken: string
}): Promise<{ paymentReference: string; status: string }> {
  if (!database) throw new Error('Marketplace data is unavailable.')
  const paymentReference = `MP-${createListingReference().slice(3)}`
  const merchantRequestId = createListingReference()
  const [payment] = await database.insert(marketplacePayments).values({
    paymentReference,
    merchantRequestId,
    purpose: input.purpose,
    productId: input.productId,
    amountKes: input.amountKes,
    phone: input.phone,
    accessTokenHash: hashSecret(input.accessToken),
    status: 'initiated',
  }).returning({ id: marketplacePayments.id })
  if (!payment) throw new Error('Marketplace payment record was not created.')
  try {
    const provider = await initiateStkPush({
      phone: input.phone,
      amountKes: input.amountKes,
      paymentReference,
      description: input.purpose === 'PRODUCT_PUBLICATION' ? 'Marketplace listing fee' : 'Marketplace contact fee',
    })
    await database.update(marketplacePayments).set({
      checkoutRequestId: provider.CheckoutRequestID,
      merchantRequestId: provider.MerchantRequestID,
      providerDetails: { merchantRequestId: provider.MerchantRequestID },
      status: 'pending',
      updatedAt: new Date(),
    }).where(eq(marketplacePayments.id, payment.id))
    return { paymentReference, status: 'pending' }
  } catch {
    await database.update(marketplacePayments).set({ status: 'ambiguous', updatedAt: new Date() }).where(eq(marketplacePayments.id, payment.id))
    return { paymentReference, status: 'ambiguous' }
  }
}

paymentRouter.post('/publication', async (request, response, next) => {
  const parsed = publicationInput.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_PAYMENT_REQUEST', message: 'The payment request is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    assertDarajaConfigured()
    const phone = normalizeKenyanPhone(parsed.data.phone)
    const tokenHash = hashSecret(parsed.data.submissionToken)
    const [product] = await database.select({ id: marketplaceProducts.id, status: marketplaceProducts.status, priceKes: marketplaceProducts.priceKes, tokenHash: marketplaceProductAccess.tokenHash })
      .from(marketplaceProducts)
      .innerJoin(marketplaceProductAccess, eq(marketplaceProductAccess.productId, marketplaceProducts.id))
      .where(and(eq(marketplaceProducts.reference, parsed.data.reference), gt(marketplaceProductAccess.expiresAt, new Date())))
      .limit(1)
    if (!product || product.tokenHash !== tokenHash) {
      response.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'The submission could not be found.' } })
      return
    }
    if (product.status !== 'pending_payment') {
      response.status(409).json({ error: { code: 'SUBMISSION_NOT_PAYABLE', message: 'This listing is not awaiting publication payment.' } })
      return
    }
    const [existingPayment] = await database.select({ paymentReference: marketplacePayments.paymentReference })
      .from(marketplacePayments)
      .where(and(eq(marketplacePayments.productId, product.id), eq(marketplacePayments.purpose, 'PRODUCT_PUBLICATION'), inArray(marketplacePayments.status, ['initiated', 'pending', 'ambiguous'])))
      .orderBy(desc(marketplacePayments.createdAt)).limit(1)
    if (existingPayment) {
      response.status(409).json({ error: { code: 'PAYMENT_ALREADY_PENDING', message: 'A publication payment is already in progress.', paymentReference: existingPayment.paymentReference } })
      return
    }
    const fee = calculateFeeKes(product.priceKes, await getFeeBasisPoints('publication_fee_basis_points', 1_000))
    const result = await startPayment({ purpose: 'PRODUCT_PUBLICATION', productId: product.id, phone, amountKes: fee, accessToken: parsed.data.submissionToken })
    response.status(202).json({ data: { ...result, amountKes: fee, currency: 'KES', paymentPurpose: 'PRODUCT_PUBLICATION' } })
  } catch (error) {
    if (error instanceof DarajaUnavailableError || (error instanceof Error && /valid Kenyan mobile number/.test(error.message))) {
      sendPaymentError(response, error)
      return
    }
    next(error)
  }
})

paymentRouter.post('/contact-unlock', async (request, response, next) => {
  const parsed = unlockInput.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_PAYMENT_REQUEST', message: 'The payment request is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  try {
    assertDarajaConfigured()
    const phone = normalizeKenyanPhone(parsed.data.phone)
    const [product] = await database.select({ id: marketplaceProducts.id, status: marketplaceProducts.status, priceKes: marketplaceProducts.priceKes })
      .from(marketplaceProducts).where(and(eq(marketplaceProducts.slug, parsed.data.slug), eq(marketplaceProducts.status, 'published'))).limit(1)
    if (!product) {
      response.status(404).json({ error: { code: 'LISTING_NOT_FOUND', message: 'This listing is not available.' } })
      return
    }
    const [activePayment] = await database.select({ paymentReference: marketplacePayments.paymentReference })
      .from(marketplacePayments)
      .where(and(
        eq(marketplacePayments.productId, product.id),
        eq(marketplacePayments.purpose, 'CONTACT_UNLOCK'),
        eq(marketplacePayments.phone, phone),
        inArray(marketplacePayments.status, ['initiated', 'pending', 'ambiguous']),
        gte(marketplacePayments.createdAt, new Date(Date.now() - 10 * 60_000)),
      ))
      .orderBy(desc(marketplacePayments.createdAt)).limit(1)
    if (activePayment) {
      response.status(409).json({ error: { code: 'PAYMENT_ALREADY_PENDING', message: 'A contact-unlock payment is already in progress for this listing and phone.', paymentReference: activePayment.paymentReference } })
      return
    }
    const fee = calculateFeeKes(product.priceKes, await getFeeBasisPoints('contact_unlock_fee_basis_points', 500))
    const accessToken = createSecret()
    const result = await startPayment({ purpose: 'CONTACT_UNLOCK', productId: product.id, phone, amountKes: fee, accessToken })
    response.status(202).json({ data: { ...result, accessToken, amountKes: fee, currency: 'KES', paymentPurpose: 'CONTACT_UNLOCK' } })
  } catch (error) {
    if (error instanceof DarajaUnavailableError || (error instanceof Error && /valid Kenyan mobile number/.test(error.message))) {
      sendPaymentError(response, error)
      return
    }
    next(error)
  }
})

paymentRouter.get('/:reference/status', async (request, response) => {
  const reference = z.string().regex(/^MP-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const token = request.get('x-payment-token') ?? ''
  if (!reference.success || token.length < 20) {
    response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'The payment could not be found.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace status is temporarily unavailable.' } })
    return
  }
  const [payment] = await database.select({ reference: marketplacePayments.paymentReference, status: marketplacePayments.status, purpose: marketplacePayments.purpose, productId: marketplacePayments.productId, amountKes: marketplacePayments.amountKes, accessTokenHash: marketplacePayments.accessTokenHash })
    .from(marketplacePayments).where(eq(marketplacePayments.paymentReference, reference.data)).limit(1)
  if (!payment || payment.accessTokenHash !== hashSecret(token)) {
    response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'The payment could not be found.' } })
    return
  }
  const [product] = payment.productId ? await database.select({ status: marketplaceProducts.status, reference: marketplaceProducts.reference })
    .from(marketplaceProducts).where(eq(marketplaceProducts.id, payment.productId)).limit(1) : []
  response.json({ data: { reference: payment.reference, status: payment.status, purpose: payment.purpose, amountKes: payment.amountKes, listingStatus: product?.status ?? null, listingReference: product?.reference ?? null } })
})

paymentRouter.post('/callback/:token', async (request, response) => {
  const expectedToken = process.env.MPESA_CALLBACK_TOKEN ?? ''
  if (!expectedToken || !verifyCallbackToken(request.params.token, expectedToken)) {
    response.status(404).json({ ResultCode: 1, ResultDesc: 'Not found' })
    return
  }
  const parsed = callbackSchema.safeParse(request.body)
  if (!parsed.success || !database) {
    response.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback' })
    return
  }
  const callback = parsed.data.Body.stkCallback
  const resultCode = String(callback.ResultCode)
  const [payment] = await database.select({ id: marketplacePayments.id, checkoutRequestId: marketplacePayments.checkoutRequestId, merchantRequestId: marketplacePayments.merchantRequestId, purpose: marketplacePayments.purpose, productId: marketplacePayments.productId, amountKes: marketplacePayments.amountKes, phone: marketplacePayments.phone, status: marketplacePayments.status, accessTokenHash: marketplacePayments.accessTokenHash })
    .from(marketplacePayments).where(eq(marketplacePayments.checkoutRequestId, callback.CheckoutRequestID)).limit(1)
  if (!payment) {
    response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' })
    return
  }
  const fingerprint = paymentCallbackFingerprint(request.body)
  let callbackOutcome = 'verified_failure'
  let shouldSettle = false
  let failureStatus: 'failed' | 'ambiguous' = 'failed'
  if (resultCode === '0') {
    const values = new Map((callback.CallbackMetadata?.Item ?? []).map(({ Name, Value }) => [Name, Value]))
    const amount = Number(values.get('Amount'))
    const callbackPhone = String(values.get('PhoneNumber') ?? '')
    const receipt = values.get('MpesaReceiptNumber')
    try {
      const verified = await queryStkPayment(callback.CheckoutRequestID)
      const callbackMatches = callback.MerchantRequestID === payment.merchantRequestId
        && Number.isSafeInteger(amount) && amount === payment.amountKes
        && normalizeKenyanPhone(callbackPhone) === payment.phone
        && Boolean(receipt)
      if (verified.resultCode === '0' && callbackMatches) {
        callbackOutcome = 'verified_success'
        shouldSettle = true
      } else {
        callbackOutcome = 'verification_mismatch'
        failureStatus = 'ambiguous'
      }
    } catch {
      response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment verification is temporarily unavailable' })
      return
    }
  }
  const now = new Date()
  await database.transaction(async (transaction) => {
    const inserted = await transaction.insert(marketplacePaymentCallbacks).values({
      paymentId: payment.id,
      payloadHash: fingerprint,
      payload: request.body as Record<string, unknown>,
      outcome: callbackOutcome,
      processedAt: now,
    }).onConflictDoNothing({ target: marketplacePaymentCallbacks.payloadHash }).returning({ id: marketplacePaymentCallbacks.id })
    if (!inserted.length) return
    const nextStatus = shouldSettle ? 'succeeded' : resultCode === '0' ? failureStatus : 'failed'
    await transaction.update(marketplacePayments).set({ status: nextStatus, callbackProcessedAt: now, updatedAt: now })
      .where(and(eq(marketplacePayments.id, payment.id), inArray(marketplacePayments.status, ['initiated', 'pending', 'ambiguous'])))
    if (!shouldSettle || !payment.productId) return
    if (payment.purpose === 'PRODUCT_PUBLICATION') {
      await transaction.update(marketplaceProducts).set({ status: 'published', publishedAt: now, updatedAt: now })
        .where(and(eq(marketplaceProducts.id, payment.productId), eq(marketplaceProducts.status, 'pending_payment')))
    } else if (payment.purpose === 'CONTACT_UNLOCK' && payment.accessTokenHash) {
      await transaction.insert(marketplaceContactUnlocks).values({
        productId: payment.productId,
        paymentId: payment.id,
        tokenHash: payment.accessTokenHash,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      }).onConflictDoNothing()
    }
  })
  response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' })
})

paymentRouter.post('/products/:slug/contact', async (request, response) => {
  const slug = z.string().min(1).max(180).safeParse(request.params.slug)
  const token = request.get('x-unlock-token') ?? ''
  if (!slug.success || token.length < 20) {
    response.status(404).json({ error: { code: 'CONTACT_NOT_AVAILABLE', message: 'Seller contact is not available.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace data is temporarily unavailable.' } })
    return
  }
  const [contact] = await database.select({ name: marketplaceSellers.name, phone: marketplaceSellers.phone, whatsapp: marketplaceSellers.whatsapp, email: marketplaceSellers.email, county: marketplaceCounties.name, subcounty: marketplaceSellers.subcounty, town: marketplaceSellers.town, area: marketplaceSellers.area })
    .from(marketplaceContactUnlocks)
    .innerJoin(marketplacePayments, eq(marketplaceContactUnlocks.paymentId, marketplacePayments.id))
    .innerJoin(marketplaceProducts, eq(marketplaceContactUnlocks.productId, marketplaceProducts.id))
    .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
    .innerJoin(marketplaceCounties, eq(marketplaceSellers.countyId, marketplaceCounties.id))
    .where(and(eq(marketplaceProducts.slug, slug.data), eq(marketplaceProducts.status, 'published'), eq(marketplaceContactUnlocks.tokenHash, hashSecret(token)), gt(marketplaceContactUnlocks.expiresAt, new Date()), eq(marketplacePayments.status, 'succeeded')))
    .limit(1)
  if (!contact) {
    response.status(403).json({ error: { code: 'CONTACT_LOCKED', message: 'A verified contact-unlock payment is required.' } })
    return
  }
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: contact })
})
