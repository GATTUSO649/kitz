import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Router, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { applicationSettings, auditLogs, deliveryZones, inventoryMovements, notificationCampaigns, notificationRecipients, orderItems, orders, payments, productVariants, products, supportMessages, supportRequests, users } from '../../database/schema.js'
import { authenticate, authenticatedUser } from '../../middleware/authenticate.js'
import { isAdminOnline, publishChatMessage } from '../../realtime/chat-events.js'
import { callbackFailureStatus, canVerifySuccessfulStkPayment, DarajaRequestError, darajaCallbackRoute, initiateStkPush, isDarajaConfigured, isFinalDarajaPaymentStatus, isValidCallbackToken, normalizeKenyanPhone, parseDarajaTimestamp, parseStkCallback, queryStkPush } from './daraja.js'

export const ordersRouter = Router()

function validCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const coordinate = Number(value)
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum ? coordinate : null
}

const addressSchema = z.object({
  recipientName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(20),
  address: z.string().trim().min(3).max(180),
  county: z.string().trim().min(2).max(80),
  town: z.string().trim().min(2).max(100),
  estate: z.string().trim().max(100).optional(),
  landmark: z.string().trim().max(180).optional(),
  instructions: z.string().trim().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
})

export const createOrderSchema = z.object({
  items: z.array(z.object({
    variantId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(5),
    customization: z.string().trim().max(180).optional(),
  })).min(1).max(30),
  deliveryZoneId: z.number().int().positive(),
  paymentMethod: z.enum(['pay_on_delivery', 'mpesa']).default('pay_on_delivery'),
  address: addressSchema,
}).superRefine((value, context) => {
  const ids = value.items.map(({ variantId }) => variantId)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Each product variant may appear only once.', path: ['items'] })
  }
})

export function exceedsProductQuantityLimit(items: readonly { productId: number; quantity: number }[]) {
  const quantities = new Map<number, number>()
  for (const item of items) {
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity
    if (quantity > 5) return true
    quantities.set(item.productId, quantity)
  }
  return false
}

class OrderRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function toCents(amount: string) {
  return Math.round(Number(amount) * 100)
}

function hasMysqlErrorCode(error: unknown, code: string, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  const candidate = error as { code?: unknown; cause?: unknown; errors?: unknown }
  if (candidate.code === code) return true
  return hasMysqlErrorCode(candidate.cause, code, seen)
    || (Array.isArray(candidate.errors) && candidate.errors.some((nested) => hasMysqlErrorCode(nested, code, seen)))
}

const rejectCrossOrigin: RequestHandler = (request, response, next) => {
  if (!isAllowedClientOrigin(request.get('origin'))) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
    return
  }
  next()
}

const stkPushLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

export function createTemporaryOrderNumber() {
  return `pending-${randomUUID().replaceAll('-', '').slice(0, 24)}`
}

ordersRouter.get('/delivery/zones', async (_request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Delivery services are not configured.' } })
    return
  }
  const zones = await db.select({ id: deliveryZones.id, name: deliveryZones.name, fee: deliveryZones.fee })
    .from(deliveryZones).where(eq(deliveryZones.active, true))
  response.json({ data: zones })
})

ordersRouter.post('/orders', rejectCrossOrigin, authenticate, async (request, response) => {
  const input = createOrderSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_ORDER', message: 'Check the delivery details and order items.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order services are not configured.' } })
    return
  }
  const auth = authenticatedUser(request)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to place an order.' } })
    return
  }
  const idempotencyKey = z.string().uuid().safeParse(request.get('idempotency-key'))
  if (!idempotencyKey.success) {
    response.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Refresh checkout and try again.' } })
    return
  }
  const [existingOrder] = await db.select({ orderNumber: orders.orderNumber, status: orders.status, paymentMethod: orders.paymentMethod, subtotal: orders.subtotal, deliveryFee: orders.deliveryFee, total: orders.total })
    .from(orders).where(and(eq(orders.userId, auth.userId), eq(orders.idempotencyKey, idempotencyKey.data))).limit(1)
  if (existingOrder) {
    response.status(200).json({ data: { ...existingOrder, replayed: true } })
    return
  }
  if (input.data.paymentMethod === 'mpesa') {
    const [till] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'mpesaTillNumber')).limit(1)
    if (!isDarajaConfigured(till?.value ?? env.DARAJA_SHORTCODE ?? '')) {
      response.status(503).json({ error: { code: 'MPESA_NOT_CONFIGURED', message: 'M-Pesa payments are not configured yet.' } })
      return
    }
  }

  try {
    const order = await db.transaction(async (transaction) => {
      const [zone] = await transaction.select({
        id: deliveryZones.id,
        name: deliveryZones.name,
        fee: deliveryZones.fee,
      }).from(deliveryZones).where(and(eq(deliveryZones.id, input.data.deliveryZoneId), eq(deliveryZones.active, true))).limit(1)
      if (!zone) throw new OrderRequestError(400, 'INVALID_DELIVERY_ZONE', 'This delivery area is unavailable.')

      const itemSnapshots = []
      let subtotalCents = 0
      for (const requested of input.data.items) {
        const [row] = await transaction.select({
          variantId: productVariants.id,
          productId: products.id,
          productName: products.name,
          price: sql<string>`COALESCE(${productVariants.price}, ${products.salePrice}, ${products.price})`,
          size: productVariants.size,
        }).from(productVariants).innerJoin(products, eq(productVariants.productId, products.id))
          .where(and(eq(productVariants.id, requested.variantId), eq(products.published, true))).limit(1)
        if (!row) throw new OrderRequestError(400, 'PRODUCT_UNAVAILABLE', 'One or more selected products are no longer available.')

        const priceCents = toCents(row.price)
        subtotalCents += priceCents * requested.quantity
        itemSnapshots.push({ ...requested, ...row, priceCents })
      }
      if (exceedsProductQuantityLimit(itemSnapshots)) {
        throw new OrderRequestError(400, 'PRODUCT_QUANTITY_LIMIT', 'You can order up to five kits per product across all sizes.')
      }

      const deliveryFeeCents = toCents(zone.fee)
      const totalCents = subtotalCents + deliveryFeeCents
      if (!Number.isSafeInteger(totalCents) || totalCents > 999_999_999_999) {
        throw new OrderRequestError(400, 'ORDER_TOTAL_TOO_LARGE', 'This order total exceeds the supported amount.')
      }
      if (input.data.paymentMethod === 'mpesa' && totalCents % 100 !== 0) {
        throw new OrderRequestError(400, 'MPESA_AMOUNT_INVALID', 'M-Pesa payments must be a whole number of Kenyan shillings. Adjust the basket before continuing.')
      }
      const addressSnapshot = JSON.stringify({ ...input.data.address, deliveryZone: zone.name })
      const temporaryNumber = createTemporaryOrderNumber()
      const [{ id: orderId }] = await transaction.insert(orders).values({
        orderNumber: temporaryNumber,
        idempotencyKey: idempotencyKey.data,
        userId: auth.userId,
        status: 'pending_payment',
        paymentMethod: input.data.paymentMethod,
        currency: 'KES',
        subtotal: (subtotalCents / 100).toFixed(2),
        deliveryFee: (deliveryFeeCents / 100).toFixed(2),
        discount: '0.00',
        total: (totalCents / 100).toFixed(2),
        deliveryAddressSnapshot: addressSnapshot,
      }).$returningId()

      for (const item of itemSnapshots) {
        const [updated] = await transaction.update(productVariants)
          .set({ stock: sql`${productVariants.stock} - ${item.quantity}` })
          .where(and(eq(productVariants.id, item.variantId), gte(productVariants.stock, item.quantity)))
        if (updated.affectedRows !== 1) {
          throw new OrderRequestError(409, 'INSUFFICIENT_STOCK', `${item.productName} (${item.size}) no longer has enough stock.`)
        }

        await transaction.insert(inventoryMovements).values({
          variantId: item.variantId,
          movementType: 'reservation',
          quantityChange: -item.quantity,
          note: `Reserved for order ${orderId}`,
        })
        await transaction.insert(orderItems).values({
          orderId,
          productId: item.productId,
          variantId: item.variantId,
          productNameSnapshot: item.productName,
          sizeSnapshot: item.size,
          customizationSnapshot: item.customization || null,
          quantity: item.quantity,
          unitPrice: (item.priceCents / 100).toFixed(2),
        })
      }

      const orderNumber = `KC-${new Date().getFullYear()}-${String(orderId).padStart(6, '0')}`
      await transaction.update(orders).set({ orderNumber }).where(eq(orders.id, orderId))
      await transaction.insert(auditLogs).values({
        actorUserId: auth.userId,
        action: 'order.created',
        targetType: 'order',
        targetId: String(orderId),
      })
      const [{ id: notificationId }] = await transaction.insert(notificationCampaigns).values({
        type: 'order',
        title: 'Order received',
        body: `Your order ${orderNumber} has been received and is pending payment.`,
        href: `/account/orders/${encodeURIComponent(orderNumber)}`,
        audienceType: 'system',
      }).$returningId()
      await transaction.insert(notificationRecipients).values({ campaignId: notificationId, userId: auth.userId })
      const address = input.data.address
      const addressLines = [address.address, address.estate, address.town, address.county].filter(Boolean)
      const message = [
        `New order ${orderNumber} created; payment is pending.`,
        `Customer: ${address.recipientName}`,
        `Phone: ${address.phone}`,
        `Items: ${itemSnapshots.map((item) => `${item.productName} (size ${item.size}) x ${item.quantity} - KES ${(item.priceCents * item.quantity / 100).toFixed(2)}`).join('; ')}`,
        `Delivery area: ${zone.name}`,
        `Address: ${addressLines.join(', ')}`,
        ...(address.landmark ? [`Landmark: ${address.landmark}`] : []),
        `Delivery pin: ${address.latitude}, ${address.longitude}`,
        `Subtotal: KES ${(subtotalCents / 100).toFixed(2)}; delivery: KES ${(deliveryFeeCents / 100).toFixed(2)}; total: KES ${(totalCents / 100).toFixed(2)}`,
      ].join('\n')
      const [{ id: conversationId }] = await transaction.insert(supportRequests).values({
        userId: auth.userId,
        orderId,
        category: 'delivery',
        subject: `Delivery tracking · ${orderNumber}`,
        message,
      }).$returningId()
      await transaction.insert(supportMessages).values({
        supportRequestId: conversationId,
        senderType: 'customer',
        body: message,
        latitude: String(address.latitude),
        longitude: String(address.longitude),
        deliveredAt: isAdminOnline() ? new Date() : null,
      })
      return { orderNumber, conversationId, status: 'pending_payment' as const, paymentMethod: input.data.paymentMethod, subtotal: (subtotalCents / 100).toFixed(2), deliveryFee: (deliveryFeeCents / 100).toFixed(2), total: (totalCents / 100).toFixed(2) }
    })
    publishChatMessage({ conversationId: order.conversationId, customerId: auth.userId, senderType: 'customer' })
    response.status(201).json({ data: order })
  } catch (error) {
    if (error instanceof OrderRequestError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }
    if (hasMysqlErrorCode(error, 'ER_DUP_ENTRY')) {
      const [replayedOrder] = await db.select({ orderNumber: orders.orderNumber, status: orders.status, paymentMethod: orders.paymentMethod, subtotal: orders.subtotal, deliveryFee: orders.deliveryFee, total: orders.total })
        .from(orders).where(and(eq(orders.userId, auth.userId), eq(orders.idempotencyKey, idempotencyKey.data))).limit(1)
      if (replayedOrder) {
        response.status(200).json({ data: { ...replayedOrder, replayed: true } })
        return
      }
    }
    throw error
  }
})

const stkPushSchema = z.object({ phone: z.string().trim().min(7).max(20) }).strict()

ordersRouter.post('/orders/:orderNumber/mpesa/stk-push', rejectCrossOrigin, stkPushLimiter, authenticate, async (request, response) => {
  const orderNumber = z.string().min(1).max(32).safeParse(request.params.orderNumber)
  const input = stkPushSchema.safeParse(request.body)
  if (!orderNumber.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_REQUEST', message: 'Payment details are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Payment services are unavailable.' } })
  const auth = authenticatedUser(request)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to pay for this order.' } })

  const [settings] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'mpesaTillNumber')).limit(1)
  const shortcode = settings?.value ?? env.DARAJA_SHORTCODE ?? ''
  if (!isDarajaConfigured(shortcode)) return response.status(503).json({ error: { code: 'MPESA_NOT_CONFIGURED', message: 'M-Pesa payments are not configured yet. Complete the Daraja server settings first.' } })

  const phone = normalizeKenyanPhone(input.data.phone)
  if (!phone) return response.status(400).json({ error: { code: 'MPESA_PHONE_REQUIRED', message: 'Enter a valid Kenyan phone number for the payment prompt.' } })
  let order: { id: number; orderNumber: string; total: string }
  let amountInCents: number
  let paymentId: number
  try {
    const paymentCreation = await db.transaction(async (transaction) => {
      const [lockedOrder] = await transaction.select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        total: orders.total,
      }).from(orders)
        .where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data)))
        .limit(1)
        .for('update')
      if (!lockedOrder) throw new OrderRequestError(404, 'ORDER_NOT_FOUND', 'Order not found.')
      if (lockedOrder.paymentMethod !== 'mpesa' || lockedOrder.status !== 'pending_payment') {
        throw new OrderRequestError(409, 'ORDER_NOT_PAYABLE', 'This order is not awaiting M-Pesa payment.')
      }
      const amountCents = Math.round(Number(lockedOrder.total) * 100)
      if (!Number.isSafeInteger(amountCents) || amountCents % 100 !== 0 || amountCents < 1) {
        throw new OrderRequestError(400, 'MPESA_AMOUNT_INVALID', 'The order total must be a whole number of Kenyan shillings for M-Pesa.')
      }
      const [existingPayment] = await transaction.select({ id: payments.id, status: payments.status }).from(payments)
        .where(and(eq(payments.orderId, lockedOrder.id), eq(payments.provider, 'mpesa')))
        .orderBy(desc(payments.createdAt)).limit(1)
      if (existingPayment && existingPayment.status !== 'failed' && existingPayment.status !== 'cancelled' && existingPayment.status !== 'expired') {
        throw new OrderRequestError(409, 'MPESA_REQUEST_ALREADY_EXISTS', 'A payment attempt is already active or requires review. Check its status before trying again.')
      }
      const [createdPayment] = await transaction.insert(payments).values({
        orderId: lockedOrder.id,
        provider: 'mpesa',
        amount: lockedOrder.total,
        status: 'initiated',
        merchantShortcode: shortcode,
        payerPhone: phone,
      }).$returningId()
      return { order: lockedOrder, amountCents, paymentId: createdPayment.id }
    })
    order = paymentCreation.order
    amountInCents = paymentCreation.amountCents
    paymentId = paymentCreation.paymentId
  } catch (error) {
    if (error instanceof OrderRequestError) return response.status(error.status).json({ error: { code: error.code, message: error.message } })
    throw error
  }
  let providerAccepted = false
  try {
    const result = await initiateStkPush({
      shortcode,
      phone,
      amount: amountInCents / 100,
      accountReference: order.orderNumber,
    })
    providerAccepted = true
    const [updated] = await db.update(payments).set({
      providerRequestId: result.checkoutRequestId,
      merchantRequestId: result.merchantRequestId,
      status: 'pending',
      verificationMessage: 'STK prompt sent; waiting for Daraja confirmation.',
    }).where(eq(payments.id, paymentId))
    if (updated.affectedRows !== 1) throw new Error('STK request accepted but its payment record could not be updated.')
    response.status(202).json({ data: { orderNumber: order.orderNumber, status: 'pending', message: result.customerMessage } })
  } catch (error) {
    const unknownOutcome = providerAccepted || (error instanceof DarajaRequestError && error.outcome === 'unknown')
    const resultCode = error instanceof DarajaRequestError ? error.providerCode ?? null : null
    request.log.warn({
      requestId: request.id,
      operation: 'orders.mpesa.stk-push',
      stage: error instanceof DarajaRequestError ? error.stage : 'payment_record_update',
      outcome: unknownOutcome ? 'unknown' : error instanceof DarajaRequestError ? error.outcome : 'unknown',
      providerCode: resultCode,
    }, 'Daraja STK request did not complete normally')
    await db.update(payments).set({
      status: unknownOutcome ? 'requires_review' : 'failed',
      providerResultCode: resultCode,
      verificationMessage: unknownOutcome
        ? 'The payment request outcome is unknown. Check payment status or contact support before retrying.'
        : 'Daraja rejected the payment request before creating a customer prompt.',
    }).where(and(eq(payments.id, paymentId), eq(payments.status, 'initiated')))
    response.status(502).json({ error: { code: unknownOutcome ? 'MPESA_OUTCOME_UNKNOWN' : 'MPESA_PROMPT_FAILED', message: unknownOutcome ? 'We could not confirm whether the prompt was sent. Check payment status before trying again.' : 'Daraja could not start the payment prompt. You can retry this order.' } })
  }
})

ordersRouter.post(darajaCallbackRoute, async (request, response) => {
  const token = z.string().min(32).max(256).safeParse(request.params.token)
  if (!token.success || !isValidCallbackToken(token.data)) return response.status(404).end()
  if (!db) return response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment services are unavailable.' })

  const callback = parseStkCallback(request.body)
  if (!callback) return response.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload.' })
  const { checkoutRequestId, merchantRequestId } = callback
  const [payment] = await db.select({
    id: payments.id,
    orderId: payments.orderId,
    providerRequestId: payments.providerRequestId,
    merchantRequestId: payments.merchantRequestId,
    merchantShortcode: payments.merchantShortcode,
    amount: payments.amount,
    payerPhone: payments.payerPhone,
    payerName: payments.payerName,
    createdAt: payments.createdAt,
    status: payments.status,
  }).from(payments).where(eq(payments.providerRequestId, checkoutRequestId)).limit(1)
  if (!payment) return response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment request is not ready for verification; retry callback.' })
  if (payment.merchantRequestId !== merchantRequestId) return response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' })
  if (isFinalDarajaPaymentStatus(payment.status)) return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })

  const resultCode = String(callback.resultCode)
  if (callback.resultCode !== 0) {
    const status = callbackFailureStatus(callback.resultCode)
    await db.update(payments).set({
      status,
      providerResultCode: resultCode || null,
      verificationMessage: status === 'cancelled' ? 'The customer cancelled the M-Pesa prompt.' : status === 'expired' ? 'The M-Pesa prompt expired before completion.' : 'Daraja reported that the payment did not complete.',
    })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const metadata = callback.metadata
  const receipt = typeof metadata.MpesaReceiptNumber === 'string' ? metadata.MpesaReceiptNumber : ''
  const amount = Number(metadata.Amount)
  const callbackPhone = normalizeKenyanPhone(String(metadata.PhoneNumber ?? ''))
  const transactionAt = parseDarajaTimestamp(String(metadata.TransactionDate ?? ''))
  if (!receipt || !Number.isFinite(amount) || !callbackPhone || !transactionAt) {
    await db.update(payments).set({
      status: 'requires_review',
      providerResultCode: resultCode,
      verificationMessage: 'Daraja reported success but supplied incomplete transaction details. Manual reconciliation is required.',
    })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  try {
    const query = await queryStkPush(payment.merchantShortcode ?? '', checkoutRequestId)
    if (String(query.ResultCode) !== '0' || query.CheckoutRequestID !== checkoutRequestId || query.MerchantRequestID !== merchantRequestId) {
      throw new Error('Daraja STK query did not confirm this payment request.')
    }
  } catch {
    return response.status(500).json({ ResultCode: 1, ResultDesc: 'Payment verification is temporarily unavailable.' })
  }

  const [order] = await db.select({ id: orders.id, userId: orders.userId, orderNumber: orders.orderNumber, total: orders.total, currency: orders.currency, status: orders.status })
    .from(orders).innerJoin(users, eq(orders.userId, users.id)).where(eq(orders.id, payment.orderId)).limit(1)
  const transactionMatchesOrder = order !== undefined && canVerifySuccessfulStkPayment({
    orderStatus: order.status,
    currency: order.currency,
    callbackAmount: amount,
    paymentAmount: payment.amount,
    orderTotal: order.total,
    callbackPhone,
    payerPhone: payment.payerPhone,
    transactionAt,
    paymentCreatedAt: payment.createdAt,
  })
  if (!transactionMatchesOrder || !order) {
    await db.update(payments).set({
      status: 'requires_review',
      providerResultCode: resultCode,
      providerReceipt: receipt || null,
      payerPhone: callbackPhone,
      transactionAt,
      verificationMessage: 'Daraja reported success, but transaction details did not match this order. Manual reconciliation is required.',
    }).where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  await db.transaction(async (transaction) => {
    const [paymentUpdate] = await transaction.update(payments).set({
      status: 'succeeded',
      providerResultCode: resultCode,
      providerReceipt: receipt,
      payerPhone: callbackPhone,
      transactionAt,
      verificationMessage: 'Payment was verified against the Daraja STK query and matched this order.',
    }).where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    if (paymentUpdate.affectedRows !== 1) return
    const [orderUpdate] = await transaction.update(orders).set({ status: 'paid' })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')))
    if (orderUpdate.affectedRows !== 1) throw new Error('Order changed while verifying the M-Pesa payment.')
    await transaction.insert(auditLogs).values({
      actorUserId: null,
      action: 'payment.mpesa_verified',
      targetType: 'payment',
      targetId: String(payment.id),
    })
    const [{ id: notificationId }] = await transaction.insert(notificationCampaigns).values({
      type: 'order',
      title: 'M-Pesa payment confirmed',
      body: `Payment ${receipt} for order ${order.orderNumber} has been verified.`,
      href: `/account/orders/${encodeURIComponent(order.orderNumber)}`,
      audienceType: 'system',
    }).$returningId()
    await transaction.insert(notificationRecipients).values({ campaignId: notificationId, userId: order.userId })
  })
  response.json({ ResultCode: 0, ResultDesc: 'Accepted' })
})

ordersRouter.get('/orders', authenticate, async (request, response) => {
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order services are not configured.' } })
    return
  }
  const auth = authenticatedUser(request)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to view orders.' } })
    return
  }
  const rows = await db.select({
    orderNumber: orders.orderNumber,
    status: orders.status,
    paymentMethod: orders.paymentMethod,
    currency: orders.currency,
    total: orders.total,
    createdAt: orders.createdAt,
  }).from(orders).where(eq(orders.userId, auth.userId)).orderBy(sql`${orders.createdAt} desc`)
  response.json({ data: rows })
})

ordersRouter.get('/orders/:orderNumber', authenticate, async (request, response) => {
  const orderNumber = z.string().min(1).max(32).safeParse(request.params.orderNumber)
  if (!orderNumber.success) {
    response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order services are not configured.' } })
    return
  }
  const auth = authenticatedUser(request)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to view this order.' } })
    return
  }
  const [order] = await db.select({
    orderNumber: orders.orderNumber,
    status: orders.status,
    paymentMethod: orders.paymentMethod,
    currency: orders.currency,
    subtotal: orders.subtotal,
    deliveryFee: orders.deliveryFee,
    total: orders.total,
    createdAt: orders.createdAt,
  }).from(orders).where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data))).limit(1)
  if (!order) {
    response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })
    return
  }
  const items = await db.select({
    name: orderItems.productNameSnapshot,
    size: orderItems.sizeSnapshot,
    customization: orderItems.customizationSnapshot,
    quantity: orderItems.quantity,
    unitPrice: orderItems.unitPrice,
  }).from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data)))
  const [payment] = order.paymentMethod === 'mpesa' ? await db.select({
    status: payments.status,
    providerReceipt: payments.providerReceipt,
    payerPhone: payments.payerPhone,
    payerName: payments.payerName,
    transactionAt: payments.transactionAt,
    verificationMessage: payments.verificationMessage,
    createdAt: payments.createdAt,
  }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id))
    .where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data), eq(payments.provider, 'mpesa')))
    .orderBy(desc(payments.createdAt)).limit(1) : []
  response.json({ data: { ...order, items, payment: payment ?? null } })
})

ordersRouter.get('/orders/:orderNumber/tracking', authenticate, async (request, response) => {
  const orderNumber = z.string().min(1).max(32).safeParse(request.params.orderNumber)
  if (!orderNumber.success) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order tracking is unavailable.' } })
  const auth = authenticatedUser(request)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to track this order.' } })
  const [order] = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    deliveryAddressSnapshot: orders.deliveryAddressSnapshot,
  }).from(orders).where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data))).limit(1)
  if (!order) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })

  let snapshot: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(order.deliveryAddressSnapshot)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) snapshot = parsed as Record<string, unknown>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  const [courier] = await db.select({
    latitude: supportMessages.latitude,
    longitude: supportMessages.longitude,
    updatedAt: supportMessages.createdAt,
  }).from(supportMessages).innerJoin(supportRequests, eq(supportMessages.supportRequestId, supportRequests.id))
    .where(and(
      eq(supportRequests.orderId, order.id),
      eq(supportMessages.senderType, 'admin'),
      isNotNull(supportMessages.latitude),
      isNotNull(supportMessages.longitude),
    ))
    .orderBy(desc(supportMessages.createdAt)).limit(1)
  response.json({ data: {
    orderNumber: order.orderNumber,
    status: order.status,
    destination: {
      latitude: validCoordinate(snapshot.latitude, -90, 90),
      longitude: validCoordinate(snapshot.longitude, -180, 180),
      accuracy: validCoordinate(snapshot.accuracy, 0, 100000),
      town: typeof snapshot.town === 'string' ? snapshot.town : null,
      county: typeof snapshot.county === 'string' ? snapshot.county : null,
    },
    courier: courier ? {
      latitude: validCoordinate(courier.latitude, -90, 90),
      longitude: validCoordinate(courier.longitude, -180, 180),
      updatedAt: courier.updatedAt,
    } : null,
  } })
})

ordersRouter.post('/orders/:orderNumber/cancel', rejectCrossOrigin, authenticate, async (request, response) => {
  const orderNumber = z.string().min(1).max(32).safeParse(request.params.orderNumber)
  if (!orderNumber.success) {
    response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })
    return
  }
  if (!db) {
    response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Order services are not configured.' } })
    return
  }
  const auth = authenticatedUser(request)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to cancel this order.' } })
    return
  }

  try {
    await db.transaction(async (transaction) => {
      const [order] = await transaction.select({ id: orders.id, status: orders.status })
        .from(orders).where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data))).limit(1)
      if (!order) throw new OrderRequestError(404, 'ORDER_NOT_FOUND', 'Order not found.')
      if (order.status !== 'pending_payment') {
        throw new OrderRequestError(409, 'ORDER_CANNOT_BE_CANCELLED', 'Only orders awaiting payment can be cancelled.')
      }

      const [cancelled] = await transaction.update(orders).set({ status: 'cancelled' })
        .where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')))
      if (cancelled.affectedRows !== 1) {
        throw new OrderRequestError(409, 'ORDER_CANNOT_BE_CANCELLED', 'This order has already changed status.')
      }
      const reservations = await transaction.select({
        variantId: orderItems.variantId,
        quantity: orderItems.quantity,
      }).from(orderItems).where(eq(orderItems.orderId, order.id))
      for (const reservation of reservations) {
        if (reservation.variantId === null) continue
        await transaction.update(productVariants)
          .set({ stock: sql`${productVariants.stock} + ${reservation.quantity}` })
          .where(eq(productVariants.id, reservation.variantId))
        await transaction.insert(inventoryMovements).values({
          variantId: reservation.variantId,
          movementType: 'release',
          quantityChange: reservation.quantity,
          note: `Released from cancelled order ${order.id}`,
        })
      }
      await transaction.insert(auditLogs).values({
        actorUserId: auth.userId,
        action: 'order.cancelled',
        targetType: 'order',
        targetId: String(order.id),
      })
    })
    response.status(204).end()
  } catch (error) {
    if (error instanceof OrderRequestError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }
    throw error
  }
})
