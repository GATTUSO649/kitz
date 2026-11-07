import { and, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminUsers, marketplaceContactUnlocks, marketplaceCounties, marketplacePaymentCallbacks, marketplacePayments, marketplaceProductAccess, marketplaceProducts, marketplaceSellers, marketplaceSettings } from '../../database/schema.js'
import { optionalMarketplaceSeller, type MarketplaceSellerSession } from '../marketplace/seller-portal.js'
import { calculateFeeKes, createListingReference, createSecret, hashSecret, normalizeKenyanPhone } from '../marketplace/security.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { listingExpiryAt } from '../marketplace/expiry.js'
import { assertDarajaConfigured, callbackFailureStatus, DarajaRequestError, DarajaUnavailableError, initiateStkPush, parseDarajaTimestamp, paymentCallbackFingerprint, queryStkPayment, verifyCallbackToken, verifyMarketplaceStkCallback } from './daraja.js'

export const paymentRouter = Router()

const publicationInput = z.object({ reference: z.string().regex(/^MH-[A-F0-9]{16}$/), phone: z.string().max(24), submissionToken: z.string().min(20).max(100).optional() })
const unlockInput = z.object({ slug: z.string().min(1).max(180), phone: z.string().max(24), email: z.string().trim().email().max(254) })
const callbackSchema = z.object({
  Body: z.object({ stkCallback: z.object({
    MerchantRequestID: z.string().min(1).max(100),
    CheckoutRequestID: z.string().min(1).max(100),
    ResultCode: z.union([z.string().regex(/^\d{1,10}$/), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]),
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

function safeCallbackDescription(value: string | undefined): string | null {
  if (!value) return null
  const description = value.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!description || /consumer[\s_-]*(?:key|secret)|passkey|password|authorization|access[\s_-]*token/i.test(description)) return null
  return description.replace(/(?:\+?254|0)[17]\d{8}/g, '[phone redacted]').slice(0, 240)
}

async function startPayment(input: {
  purpose: 'PRODUCT_PUBLICATION' | 'CONTACT_UNLOCK'
  productId: string
  phone: string
  amountKes: number
  accessToken: string
  customerEmail: string | null
  recipientName?: string
}): Promise<{ paymentReference: string; status: string }> {
  if (!database) throw new Error('Marketplace data is unavailable.')
  const paymentReference = `MP-${createListingReference().slice(3)}`
  const merchantRequestId = createListingReference()
  const [payment] = await database.insert(marketplacePayments).values({
    applicationId: 'MARKETHUB',
    paymentReference,
    merchantRequestId,
    purpose: input.purpose,
    productId: input.productId,
    amountKes: input.amountKes,
    phone: input.phone,
    customerEmail: input.customerEmail,
    accessTokenHash: hashSecret(input.accessToken),
    status: 'initiated',
  }).returning({ id: marketplacePayments.id })
  if (!payment) throw new Error('Marketplace payment record was not created.')
  let stkPushSubmittedAt: Date | null = null
  let stkPushResponseAt: Date | null = null
  let providerResponseCode: string | null = null
  let providerResponseDescription: string | null = null
  try {
    const provider = await initiateStkPush({
      phone: input.phone,
      amountKes: input.amountKes,
      paymentReference,
      description: input.purpose === 'PRODUCT_PUBLICATION' ? 'Marketplace listing fee' : 'Marketplace contact fee',
    }, {
      onStkPushSubmitted: (at) => { stkPushSubmittedAt = at },
      onStkPushResponse: (at, result) => {
        stkPushResponseAt = at
        providerResponseCode = result.code ?? null
        providerResponseDescription = result.description ?? null
      },
    })
    await database.transaction(async (transaction) => {
      await transaction.update(marketplacePayments).set({
        checkoutRequestId: provider.CheckoutRequestID,
        merchantRequestId: provider.MerchantRequestID,
        providerDetails: { merchantRequestId: provider.MerchantRequestID },
        status: 'pending',
        stkPushSubmittedAt,
        stkPushResponseAt,
        providerResponseCode,
        providerResponseDescription,
        failureCategory: null,
        failureReason: null,
        updatedAt: new Date(),
      }).where(eq(marketplacePayments.id, payment.id))
      if (input.customerEmail) await enqueueMarketplaceEmail(transaction, {
        eventKey: `payment:${paymentReference}:initiated:${input.purpose}`,
        to: input.customerEmail,
        kind: input.purpose === 'PRODUCT_PUBLICATION' ? 'publication_payment_initiated' : 'contact_unlock_payment_initiated',
        data: { name: input.recipientName, reference: paymentReference, amountKes: input.amountKes },
      })
    })
    return { paymentReference, status: 'pending' }
  } catch (error) {
    const rejected = error instanceof DarajaRequestError && error.outcome === 'rejected'
    const status = rejected ? 'failed' : 'ambiguous'
    const failureCategory = error instanceof DarajaRequestError ? `${error.stage}_${error.outcome}` : 'local_persistence_error'
    const failureReason = error instanceof DarajaRequestError ? error.providerDescription ?? 'Safaricom did not confirm the STK request.' : 'Payment initiation could not be fully recorded.'
    await database.transaction(async (transaction) => {
      await transaction.update(marketplacePayments).set({
        status,
        stkPushSubmittedAt,
        stkPushResponseAt,
        providerResponseCode: error instanceof DarajaRequestError ? error.providerCode ?? providerResponseCode : providerResponseCode,
        providerResponseDescription: error instanceof DarajaRequestError ? error.providerDescription ?? providerResponseDescription : providerResponseDescription,
        failureCategory,
        failureReason,
        finalizedAt: rejected ? new Date() : null,
        updatedAt: new Date(),
        providerDetails: { initiationOutcome: status, ...(error instanceof DarajaRequestError && error.httpStatus ? { httpStatus: error.httpStatus } : {}) },
      }).where(eq(marketplacePayments.id, payment.id))
      if (!rejected) return
      if (input.customerEmail) await enqueueMarketplaceEmail(transaction, {
        eventKey: `payment:${paymentReference}:initiation-failed`,
        to: input.customerEmail,
        kind: input.purpose === 'PRODUCT_PUBLICATION' ? 'product_publication_failed' : 'payment_unsuccessful',
        data: { name: input.recipientName, reference: paymentReference, amountKes: input.amountKes },
      })
      const admins = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
        .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'marketplace_finance_admin'])))
      for (const admin of admins) await enqueueMarketplaceEmail(transaction, {
        eventKey: `payment:${paymentReference}:initiation-failed-admin:${admin.email}`,
        to: admin.email,
        kind: 'admin_payment_failure',
        data: { reference: paymentReference, amountKes: input.amountKes },
      })
    })
    return { paymentReference, status }
  }
}

paymentRouter.post('/publication', optionalMarketplaceSeller, async (request, response, next) => {
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
    const sellerSession = response.locals.marketplaceSeller as MarketplaceSellerSession | undefined
    if (!sellerSession && !parsed.data.submissionToken) {
      response.status(400).json({ error: { code: 'SUBMISSION_TOKEN_REQUIRED', message: 'The secure submission token is required to pay for this listing.' } })
      return
    }
    const [product] = await database.select({ id: marketplaceProducts.id, reference: marketplaceProducts.reference, title: marketplaceProducts.title, status: marketplaceProducts.status, priceKes: marketplaceProducts.priceKes, sellerName: marketplaceSellers.name, sellerEmail: marketplaceSellers.email, sellerAccountId: marketplaceSellers.accountId, tokenHash: marketplaceProductAccess.tokenHash, tokenExpiresAt: marketplaceProductAccess.expiresAt })
      .from(marketplaceProducts)
      .innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
      .leftJoin(marketplaceProductAccess, eq(marketplaceProductAccess.productId, marketplaceProducts.id))
      .where(eq(marketplaceProducts.reference, parsed.data.reference))
      .limit(1)
    const authorized = product && (sellerSession
      ? product.sellerAccountId === sellerSession.id
      : product.tokenHash === hashSecret(parsed.data.submissionToken!) && Boolean(product.tokenExpiresAt && product.tokenExpiresAt > new Date()))
    if (!authorized || !product) {
      response.status(404).json({ error: { code: 'SUBMISSION_NOT_FOUND', message: 'The submission could not be found.' } })
      return
    }
    if (product.status !== 'pending_payment') {
      response.status(409).json({ error: { code: 'SUBMISSION_NOT_PAYABLE', message: 'This listing is not awaiting publication payment.' } })
      return
    }
    const [existingPayment] = await database.select({ paymentReference: marketplacePayments.paymentReference, status: marketplacePayments.status, amountKes: marketplacePayments.amountKes })
      .from(marketplacePayments)
      .where(and(eq(marketplacePayments.productId, product.id), eq(marketplacePayments.purpose, 'PRODUCT_PUBLICATION'), inArray(marketplacePayments.status, ['initiated', 'pending', 'ambiguous'])))
      .orderBy(desc(marketplacePayments.createdAt)).limit(1)
    if (existingPayment) {
      response.json({ data: { paymentReference: existingPayment.paymentReference, status: existingPayment.status, amountKes: existingPayment.amountKes, currency: 'KES', paymentPurpose: 'PRODUCT_PUBLICATION', existing: true } })
      return
    }
    const fee = calculateFeeKes(product.priceKes, await getFeeBasisPoints('publication_fee_basis_points', 1_000))
    const paymentStatusToken = parsed.data.submissionToken ?? createSecret()
    const result = await startPayment({ purpose: 'PRODUCT_PUBLICATION', productId: product.id, phone, amountKes: fee, accessToken: paymentStatusToken, customerEmail: product.sellerEmail, recipientName: product.sellerName })
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
      .from(marketplaceProducts).where(and(eq(marketplaceProducts.slug, parsed.data.slug), eq(marketplaceProducts.status, 'published'), gt(marketplaceProducts.expiresAt, new Date()))).limit(1)
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
    const result = await startPayment({ purpose: 'CONTACT_UNLOCK', productId: product.id, phone, amountKes: fee, accessToken, customerEmail: parsed.data.email.toLowerCase() })
    response.status(202).json({ data: { ...result, accessToken, amountKes: fee, currency: 'KES', paymentPurpose: 'CONTACT_UNLOCK' } })
  } catch (error) {
    if (error instanceof DarajaUnavailableError || (error instanceof Error && /valid Kenyan mobile number/.test(error.message))) {
      sendPaymentError(response, error)
      return
    }
    next(error)
  }
})

paymentRouter.get('/:reference/status', optionalMarketplaceSeller, async (request, response) => {
  const reference = z.string().regex(/^MP-[A-F0-9]{16}$/).safeParse(request.params.reference)
  const token = request.get('x-payment-token') ?? ''
  const sellerSession = response.locals.marketplaceSeller as MarketplaceSellerSession | undefined
  if (!reference.success || (!sellerSession && token.length < 20)) {
    response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'The payment could not be found.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace status is temporarily unavailable.' } })
    return
  }
  const [payment] = await database.select({ reference: marketplacePayments.paymentReference, status: marketplacePayments.status, purpose: marketplacePayments.purpose, productId: marketplacePayments.productId, amountKes: marketplacePayments.amountKes, accessTokenHash: marketplacePayments.accessTokenHash })
    .from(marketplacePayments).where(eq(marketplacePayments.paymentReference, reference.data)).limit(1)
  const [product] = payment?.productId ? await database.select({ status: marketplaceProducts.status, reference: marketplaceProducts.reference, sellerAccountId: marketplaceSellers.accountId })
    .from(marketplaceProducts).innerJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id)).where(eq(marketplaceProducts.id, payment.productId)).limit(1) : []
  const tokenAuthorized = Boolean(payment && token.length >= 20 && payment.accessTokenHash === hashSecret(token))
  const sellerAuthorized = Boolean(payment && sellerSession && payment.purpose === 'PRODUCT_PUBLICATION' && product?.sellerAccountId === sellerSession.id)
  const authorized = tokenAuthorized || sellerAuthorized
  if (!authorized || !payment) {
    response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'The payment could not be found.' } })
    return
  }
  response.json({ data: { reference: payment.reference, status: payment.status, purpose: payment.purpose, amountKes: payment.amountKes, listingStatus: product?.status ?? null, listingReference: product?.reference ?? null } })
})

paymentRouter.post('/callback/:token', async (request, response) => {
  const expectedToken = process.env.MARKETPLACE_DARAJA_CALLBACK_TOKEN ?? ''
  if (!expectedToken || !verifyCallbackToken(request.params.token, expectedToken)) {
    response.status(404).json({ ResultCode: 1, ResultDesc: 'Not found' })
    return
  }
  const parsed = callbackSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback' })
    return
  }
  if (!database) {
    response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment services are unavailable.' })
    return
  }
  const callback = parsed.data.Body.stkCallback
  const resultCode = String(callback.ResultCode)
  const [payment] = await database.select({ id: marketplacePayments.id, applicationId: marketplacePayments.applicationId, reference: marketplacePayments.paymentReference, checkoutRequestId: marketplacePayments.checkoutRequestId, merchantRequestId: marketplacePayments.merchantRequestId, purpose: marketplacePayments.purpose, productId: marketplacePayments.productId, amountKes: marketplacePayments.amountKes, phone: marketplacePayments.phone, customerEmail: marketplacePayments.customerEmail, status: marketplacePayments.status, accessTokenHash: marketplacePayments.accessTokenHash, createdAt: marketplacePayments.createdAt, productTitle: marketplaceProducts.title, sellerEmail: marketplaceSellers.email, sellerName: marketplaceSellers.name })
    .from(marketplacePayments).leftJoin(marketplaceProducts, eq(marketplacePayments.productId, marketplaceProducts.id))
    .leftJoin(marketplaceSellers, eq(marketplaceProducts.sellerId, marketplaceSellers.id))
    .where(eq(marketplacePayments.checkoutRequestId, callback.CheckoutRequestID)).limit(1)
  if (!payment) {
    response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment request is not ready for verification; retry callback.' })
    return
  }
  if (payment.applicationId !== 'MARKETHUB') {
    response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment application is invalid.' })
    return
  }
  if (callback.MerchantRequestID !== payment.merchantRequestId) {
    response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' })
    return
  }
  const fingerprint = paymentCallbackFingerprint(request.body)
  const [insertedCallback] = await database.insert(marketplacePaymentCallbacks).values({
    paymentId: payment.id,
    payloadHash: fingerprint,
    payload: request.body as Record<string, unknown>,
    outcome: 'received',
  }).onConflictDoNothing({ target: marketplacePaymentCallbacks.payloadHash }).returning({ id: marketplacePaymentCallbacks.id })
  const [callbackEvent] = insertedCallback
    ? [insertedCallback]
    : await database.select({ id: marketplacePaymentCallbacks.id }).from(marketplacePaymentCallbacks).where(eq(marketplacePaymentCallbacks.payloadHash, fingerprint)).limit(1)
  if (!callbackEvent) {
    response.status(503).json({ ResultCode: 1, ResultDesc: 'Callback could not be recorded; retry.' })
    return
  }
  const callbackReceivedAt = new Date()
  await database.update(marketplacePayments).set({
    callbackReceivedAt: sql`coalesce(${marketplacePayments.callbackReceivedAt}, ${callbackReceivedAt})`,
    updatedAt: callbackReceivedAt,
  }).where(eq(marketplacePayments.id, payment.id))
  let callbackOutcome = 'verified_failure'
  let shouldSettle = false
  let verificationCompletedAt: Date | null = null
  let failureStatus: 'failed' | 'cancelled' | 'expired' | 'ambiguous' = 'failed'
  if (resultCode === '0') {
    const values = new Map((callback.CallbackMetadata?.Item ?? []).map(({ Name, Value }) => [Name, Value]))
    const amount = Number(values.get('Amount'))
    const callbackPhone = normalizeKenyanPhone(String(values.get('PhoneNumber') ?? ''))
    const receiptValue = values.get('MpesaReceiptNumber')
    const receipt = typeof receiptValue === 'string' ? receiptValue : ''
    const transactionAt = parseDarajaTimestamp(values.get('TransactionDate'))
    try {
      const verified = await queryStkPayment(callback.CheckoutRequestID)
      verificationCompletedAt = new Date()
      const callbackMatches = verifyMarketplaceStkCallback({
        callbackResultCode: resultCode,
        callbackCheckoutRequestId: callback.CheckoutRequestID,
        callbackMerchantRequestId: callback.MerchantRequestID,
        queryCheckoutRequestId: verified.checkoutRequestId,
        queryMerchantRequestId: verified.merchantRequestId,
        queryResultCode: verified.resultCode,
        callbackAmount: amount,
        expectedAmount: payment.amountKes,
        callbackPhone,
        expectedPhone: payment.phone,
        receipt,
        transactionAt,
        paymentCreatedAt: payment.createdAt,
      })
      if (callbackMatches) {
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
    if (shouldSettle) {
      const now = new Date()
      await database.transaction(async (transaction) => {
        await transaction.update(marketplacePaymentCallbacks).set({ outcome: callbackOutcome, processedAt: now }).where(eq(marketplacePaymentCallbacks.id, callbackEvent.id))
        const updated = await transaction.update(marketplacePayments).set({
          status: 'succeeded',
          callbackProcessedAt: now,
          verificationCompletedAt,
          finalizedAt: now,
          providerReceipt: receipt,
          transactionAt,
          verifiedAt: now,
          providerDetails: { verification: 'stk_query_and_callback_match', resultCode, checkoutRequestId: callback.CheckoutRequestID, merchantRequestId: callback.MerchantRequestID },
          updatedAt: now,
        }).where(and(eq(marketplacePayments.id, payment.id), inArray(marketplacePayments.status, ['initiated', 'pending', 'processing', 'ambiguous']))).returning({ id: marketplacePayments.id })
        if (!updated.length || !payment.productId) return
        if (payment.purpose === 'PRODUCT_PUBLICATION') {
          const [expirySetting] = await transaction.select({ value: marketplaceSettings.value }).from(marketplaceSettings)
            .where(eq(marketplaceSettings.key, 'listing_expiry_days')).limit(1)
          await transaction.update(marketplaceProducts).set({ status: 'published', publishedAt: now, expiresAt: listingExpiryAt(now, expirySetting?.value), updatedAt: now })
            .where(and(eq(marketplaceProducts.id, payment.productId), eq(marketplaceProducts.status, 'pending_payment')))
          if (payment.customerEmail) {
            await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${payment.reference}:verified`, to: payment.customerEmail, kind: 'publication_payment_success', data: { name: payment.sellerName, title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
            await enqueueMarketplaceEmail(transaction, { eventKey: `listing:${payment.reference}:published`, to: payment.customerEmail, kind: 'product_published', data: { name: payment.sellerName, title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
            await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${payment.reference}:receipt`, to: payment.customerEmail, kind: 'payment_receipt', data: { name: payment.sellerName, title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
          }
          const admins = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
            .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'marketplace_finance_admin'])))
          for (const admin of admins) await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${payment.reference}:admin-success:${admin.email}`, to: admin.email, kind: 'admin_publication_success', data: { title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
        } else if (payment.purpose === 'CONTACT_UNLOCK' && payment.accessTokenHash) {
          await transaction.insert(marketplaceContactUnlocks).values({ productId: payment.productId, paymentId: payment.id, tokenHash: payment.accessTokenHash, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }).onConflictDoNothing()
          if (payment.customerEmail) {
            await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${payment.reference}:verified`, to: payment.customerEmail, kind: 'contact_unlock_payment_success', data: { title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
            await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${payment.reference}:contact-unlocked`, to: payment.customerEmail, kind: 'contact_details_unlocked', data: { title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
            await enqueueMarketplaceEmail(transaction, { eventKey: `payment:${payment.reference}:receipt`, to: payment.customerEmail, kind: 'payment_receipt', data: { title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes } })
          }
        }
      })
      response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' })
      return
    }
  } else {
    failureStatus = callbackFailureStatus(resultCode)
  }
  const now = new Date()
  await database.transaction(async (transaction) => {
    await transaction.update(marketplacePaymentCallbacks).set({ outcome: callbackOutcome, processedAt: now }).where(eq(marketplacePaymentCallbacks.id, callbackEvent.id))
    const updated = await transaction.update(marketplacePayments).set({
      status: failureStatus,
      callbackProcessedAt: now,
      verificationCompletedAt,
      ...(failureStatus === 'ambiguous' ? {} : { finalizedAt: now }),
      failureCategory: failureStatus === 'ambiguous' ? 'callback_verification_mismatch' : `callback_${failureStatus}`,
      failureReason: failureStatus === 'ambiguous' ? 'Callback details did not match Daraja verification.' : safeCallbackDescription(callback.ResultDesc) ?? `Daraja reported ${failureStatus}.`,
      providerResponseCode: resultCode,
      providerResponseDescription: safeCallbackDescription(callback.ResultDesc),
      updatedAt: now,
    })
      .where(and(eq(marketplacePayments.id, payment.id), inArray(marketplacePayments.status, ['initiated', 'pending', 'processing', 'ambiguous'])))
      .returning({ id: marketplacePayments.id })
    if (!updated.length) return
    if (failureStatus === 'ambiguous') {
      const admins = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
        .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'marketplace_finance_admin'])))
      for (const admin of admins) await enqueueMarketplaceEmail(transaction, {
        eventKey: `payment:${payment.reference}:verification-review:${admin.email}`,
        to: admin.email,
        kind: 'admin_marketplace_activity',
        data: { reference: payment.reference, amountKes: payment.amountKes, reason: 'Daraja verification requires review' },
      })
      return
    }
    if (payment.customerEmail) await enqueueMarketplaceEmail(transaction, {
      eventKey: `payment:${payment.reference}:not-completed:${failureStatus}`,
      to: payment.customerEmail,
      kind: payment.purpose === 'PRODUCT_PUBLICATION' ? 'product_publication_failed' : 'payment_unsuccessful',
      data: { name: payment.sellerName, title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes },
    })
    const admins = await transaction.select({ email: marketplaceAdminUsers.email }).from(marketplaceAdminUsers)
      .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'marketplace_finance_admin'])))
    for (const admin of admins) await enqueueMarketplaceEmail(transaction, {
      eventKey: `payment:${payment.reference}:admin-failure:${admin.email}`,
      to: admin.email,
      kind: 'admin_payment_failure',
      data: { title: payment.productTitle, reference: payment.reference, amountKes: payment.amountKes, reason: failureStatus },
    })
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
    .where(and(eq(marketplaceProducts.slug, slug.data), eq(marketplaceProducts.status, 'published'), gt(marketplaceProducts.expiresAt, new Date()), eq(marketplaceContactUnlocks.tokenHash, hashSecret(token)), gt(marketplaceContactUnlocks.expiresAt, new Date()), eq(marketplacePayments.status, 'succeeded')))
    .limit(1)
  if (!contact) {
    response.status(403).json({ error: { code: 'CONTACT_LOCKED', message: 'A verified contact-unlock payment is required.' } })
    return
  }
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: contact })
})
