import { createHash, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq, ilike, inArray, lt, max, or, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminUsers, marketplaceAuditLogs, marketplacePaymentCallbacks, marketplacePayments, marketplaceProducts } from '../../database/schema.js'

export const marketplaceSecurityFeedRouter = Router()

function serviceTokenMatches(candidate: string) {
  const expected = process.env.KITCULTURE_MARKETPLACE_SERVICE_TOKEN
  if (!expected || !candidate) return false
  const expectedHash = createHash('sha256').update(expected).digest()
  const candidateHash = createHash('sha256').update(candidate).digest()
  return timingSafeEqual(expectedHash, candidateHash)
}

const querySchema = z.object({
  status: z.enum(['initiated', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'ambiguous', 'reversed', 'refunded']).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
}).strict()

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits ? `***${digits.slice(-4)}` : 'unavailable'
}

marketplaceSecurityFeedRouter.get('/api/v1/admin/marketplace/security-payments', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  if (!serviceTokenMatches(request.get('x-markethub-service-token') ?? '')) {
    response.status(401).json({ error: { code: 'MARKETHUB_SERVICE_UNAUTHORIZED', message: 'Marketplace service authentication is required.' } })
    return
  }
  const query = querySchema.safeParse(request.query)
  const requestingActorId = z.coerce.number().int().positive().safeParse(request.get('x-operations-actor-id'))
  const requestingActorType = z.enum(['central_admin', 'legacy_operations_user']).safeParse(request.get('x-operations-actor-type'))
  if (!query.success || !requestingActorId.success || !requestingActorType.success) {
    response.status(400).json({ error: { code: 'INVALID_SECURITY_PAYMENT_QUERY', message: 'Payment inspection parameters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETHUB_DATABASE_UNAVAILABLE', message: 'Marketplace payment records are unavailable.' } })
    return
  }

  try {
    const rows = await database.select({
      id: marketplacePayments.id,
      paymentReference: marketplacePayments.paymentReference,
      merchantRequestId: marketplacePayments.merchantRequestId,
      checkoutRequestId: marketplacePayments.checkoutRequestId,
      purpose: marketplacePayments.purpose,
      amountKes: marketplacePayments.amountKes,
      phone: marketplacePayments.phone,
      status: marketplacePayments.status,
      providerReceipt: marketplacePayments.providerReceipt,
      providerResponseCode: marketplacePayments.providerResponseCode,
      failureCategory: marketplacePayments.failureCategory,
      failureReason: marketplacePayments.failureReason,
      createdAt: marketplacePayments.createdAt,
      updatedAt: marketplacePayments.updatedAt,
      transactionAt: marketplacePayments.transactionAt,
      callbackReceivedAt: marketplacePayments.callbackReceivedAt,
      callbackProcessedAt: marketplacePayments.callbackProcessedAt,
      verificationCompletedAt: marketplacePayments.verificationCompletedAt,
      verifiedAt: marketplacePayments.verifiedAt,
      lastReconciliationAt: marketplacePayments.lastReconciliationAt,
      reconciliationAttempts: marketplacePayments.reconciliationAttempts,
      listingReference: marketplaceProducts.reference,
    }).from(marketplacePayments).leftJoin(marketplaceProducts, eq(marketplacePayments.productId, marketplaceProducts.id))
      .where(and(
        eq(marketplacePayments.applicationId, 'MARKETHUB'),
        query.data.status ? eq(marketplacePayments.status, query.data.status) : undefined,
        query.data.cursor ? lt(marketplacePayments.id, query.data.cursor) : undefined,
        query.data.search ? or(
          ilike(marketplacePayments.paymentReference, `%${query.data.search}%`),
          ilike(marketplacePayments.merchantRequestId, `%${query.data.search}%`),
          ilike(marketplacePayments.checkoutRequestId, `%${query.data.search}%`),
          ilike(marketplacePayments.providerReceipt, `%${query.data.search}%`),
        ) : undefined,
      )).orderBy(desc(marketplacePayments.id)).limit(query.data.limit + 1)

    const hasMore = rows.length > query.data.limit
    const page = rows.slice(0, query.data.limit)
    const paymentIds = page.map(({ id }) => id)
    const callbackSummaries = paymentIds.length ? await database.select({
      paymentId: marketplacePaymentCallbacks.paymentId,
      count: count(),
      receivedAt: max(marketplacePaymentCallbacks.receivedAt),
      processedAt: max(marketplacePaymentCallbacks.processedAt),
      outcomes: sql<string[]>`array_agg(DISTINCT ${marketplacePaymentCallbacks.outcome})`,
    }).from(marketplacePaymentCallbacks).where(inArray(marketplacePaymentCallbacks.paymentId, paymentIds)).groupBy(marketplacePaymentCallbacks.paymentId) : []
    const callbacksByPayment = new Map(callbackSummaries.map((summary) => [summary.paymentId, summary]))

    await database.insert(marketplaceAuditLogs).values({
      adminUserId: null,
      action: 'security.payment.inspected',
      resourceType: 'marketplace_payment_list',
      resourceId: null,
      metadata: {
        source: 'kitz_operations',
        requestingActorId: requestingActorId.data,
        requestingActorType: requestingActorType.data,
        status: query.data.status ?? 'all',
        returnedCount: page.length,
      },
    })

    response.json({ data: {
      application: 'MARKETHUB',
      records: page.map((payment) => {
        const callback = callbacksByPayment.get(payment.id)
        const callbackStatus = !callback ? payment.callbackReceivedAt ? 'recorded_without_callback_row' : 'missing'
          : callback.processedAt ? 'processed' : 'received_unprocessed'
        const verificationStatus = payment.verifiedAt ? 'verified' : payment.verificationCompletedAt ? 'unverified_or_mismatch' : 'not_verified'
        const reconciliationStatus = ['pending', 'processing', 'ambiguous'].includes(payment.status) && !payment.verifiedAt
          ? 'required' : payment.lastReconciliationAt ? 'attempted' : 'not_required'
        return {
          id: payment.id,
          reference: payment.paymentReference,
          relatedListingReference: payment.listingReference,
          purpose: payment.purpose,
          amount: payment.amountKes,
          currency: 'KES',
          status: payment.status,
          provider: 'daraja',
          transactionReference: payment.providerReceipt,
          merchantRequestId: payment.merchantRequestId,
          checkoutRequestId: payment.checkoutRequestId,
          payerPhoneMasked: maskPhone(payment.phone),
          providerResponseCode: payment.providerResponseCode,
          failureCategory: payment.failureCategory,
          failureReason: payment.failureReason,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
          transactionAt: payment.transactionAt,
          callback: { status: callbackStatus, count: Number(callback?.count ?? 0), lastReceivedAt: callback?.receivedAt ?? payment.callbackReceivedAt, lastProcessedAt: callback?.processedAt ?? payment.callbackProcessedAt, outcomes: callback?.outcomes ?? [] },
          verification: { status: verificationStatus, completedAt: payment.verificationCompletedAt, verifiedAt: payment.verifiedAt },
          reconciliation: { status: reconciliationStatus, lastAttemptAt: payment.lastReconciliationAt, attempts: payment.reconciliationAttempts },
        }
      }),
      pagination: { nextCursor: hasMore ? page.at(-1)?.id ?? null : null, hasMore },
    } })
  } catch {
    response.status(503).json({ error: { code: 'MARKETHUB_PAYMENT_FEED_UNAVAILABLE', message: 'Marketplace payment monitoring is temporarily unavailable.' } })
  }
})