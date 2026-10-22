import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { applicationSettings, auditLogs, deliveryZones, inventoryMovements, notificationCampaigns, notificationRecipients, orderItems, orders, payments, productVariants, products, supportMessages, supportRequests, users } from '../../database/schema.js'
import { authenticate, authenticatedUser } from '../../middleware/authenticate.js'
import { isAdminOnline, publishChatMessage } from '../../realtime/chat-events.js'
import { darajaCallbackRoute, initiateStkPush, isDarajaConfigured, isFinalDarajaPaymentStatus, isValidCallbackToken, isValidDarajaPaymentAmount, normalizeKenyanPhone, parseDarajaTimestamp, queryStkPush } from './daraja.js'

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

const rejectCrossOrigin: RequestHandler = (request, response, next) => {
  if (!isAllowedClientOrigin(request.get('origin'))) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
    return
  }
  next()
}

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
  if (input.data.paymentMethod === 'mpesa') {
    const [till] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
      .where(eq(applicationSettings.key, 'mpesaTillNumber')).limit(1)
    if (!isDarajaConfigured(till?.value ?? env.DARAJA_SHORTCODE ?? '')) {
      response.status(503).json({ error: { code: 'MPESA_NOT_CONFIGURED', message: 'M-Pesa payments are not configured yet.' } })
      return
    }
    const [account] = await db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, auth.userId)).limit(1)
    const accountPhone = account?.phone ? normalizeKenyanPhone(account.phone) : null
    if (!account || !accountPhone) {
      response.status(400).json({ error: { code: 'MPESA_ACCOUNT_PHONE_REQUIRED', message: 'Add a valid Kenyan phone number to your account before paying with M-Pesa.' } })
      return
    }
    if (normalizeKenyanPhone(input.data.address.phone) !== accountPhone
      || input.data.address.recipientName.trim().toLocaleLowerCase() !== account.fullName.trim().toLocaleLowerCase()) {
      response.status(400).json({ error: { code: 'MPESA_RECIPIENT_MUST_MATCH_ACCOUNT', message: 'For M-Pesa payments, the delivery recipient and phone must match the signed-in account.' } })
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
    throw error
  }
})

const stkPushSchema = z.object({ phone: z.string().trim().min(7).max(20).optional() }).strict()

ordersRouter.post('/orders/:orderNumber/mpesa/stk-push', rejectCrossOrigin, authenticate, async (request, response) => {
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

  const [order] = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    paymentMethod: orders.paymentMethod,
    total: orders.total,
    userId: orders.userId,
    phone: users.phone,
    fullName: users.fullName,
  }).from(orders).innerJoin(users, eq(orders.userId, users.id))
    .where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, orderNumber.data))).limit(1)
  if (!order) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } })
  if (order.paymentMethod !== 'mpesa' || order.status !== 'pending_payment') {
    return response.status(409).json({ error: { code: 'ORDER_NOT_PAYABLE', message: 'This order is not awaiting M-Pesa payment.' } })
  }
  const phone = input.data.phone ? normalizeKenyanPhone(input.data.phone) : order.phone ? normalizeKenyanPhone(order.phone) : null
  if (!phone) return response.status(400).json({ error: { code: 'MPESA_PHONE_REQUIRED', message: 'Enter a valid Kenyan phone number for the payment prompt.' } })
  const amountInCents = Math.round(Number(order.total) * 100)
  if (!Number.isSafeInteger(amountInCents) || amountInCents % 100 !== 0 || amountInCents < 1) {
    return response.status(400).json({ error: { code: 'MPESA_AMOUNT_INVALID', message: 'The order total must be a whole number of Kenyan shillings for M-Pesa.' } })
  }
  const [existingPayment] = await db.select({ id: payments.id, status: payments.status }).from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.provider, 'mpesa')))
    .orderBy(desc(payments.createdAt)).limit(1)
  if (existingPayment && existingPayment.status !== 'failed') {
    return response.status(409).json({ error: { code: 'MPESA_REQUEST_ALREADY_EXISTS', message: 'A payment request already exists for this order.' } })
  }

  const [payment] = await db.insert(payments).values({
    orderId: order.id,
    provider: 'mpesa',
    amount: order.total,
    status: 'initiated',
    merchantShortcode: shortcode,
    payerPhone: phone,
    payerName: order.fullName,
  }).$returningId()
  const paymentId = payment.id
  try {
    const result = await initiateStkPush({
      shortcode,
      phone,
      amount: amountInCents / 100,
      accountReference: order.orderNumber,
    })
    await db.update(payments).set({
      providerRequestId: result.checkoutRequestId,
      merchantRequestId: result.merchantRequestId,
      status: 'pending',
      verificationMessage: 'STK prompt sent; waiting for Daraja confirmation.',
    }).where(eq(payments.id, paymentId))
    response.status(202).json({ data: { orderNumber: order.orderNumber, status: 'pending', message: result.customerMessage } })
  } catch (error) {
    await db.update(payments).set({
      status: 'failed',
      verificationMessage: error instanceof Error ? error.message.slice(0, 500) : 'Daraja could not start the payment request.',
    }).where(eq(payments.id, paymentId))
    response.status(502).json({ error: { code: 'MPESA_PROMPT_FAILED', message: 'Daraja could not start the payment prompt. You can retry from this order.' } })
  }
})

ordersRouter.post(darajaCallbackRoute, async (request, response) => {
  const token = z.string().min(32).max(256).safeParse(request.params.token)
  if (!token.success || !isValidCallbackToken(token.data)) return response.status(404).end()
  if (!db) return response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment services are unavailable.' })

  const callback = request.body?.Body?.stkCallback
  const checkoutRequestId = typeof callback?.CheckoutRequestID === 'string' ? callback.CheckoutRequestID : ''
  const merchantRequestId = typeof callback?.MerchantRequestID === 'string' ? callback.MerchantRequestID : ''
  const [payment] = checkoutRequestId ? await db.select({
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
  }).from(payments).where(eq(payments.providerRequestId, checkoutRequestId)).limit(1) : []
  if (!payment) return response.status(503).json({ ResultCode: 1, ResultDesc: 'Payment request is not ready for verification; retry callback.' })
  if (payment.merchantRequestId !== merchantRequestId) return response.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' })
  if (isFinalDarajaPaymentStatus(payment.status)) return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })

  const resultCode = String(callback?.ResultCode ?? '')
  if (resultCode !== '0') {
    await db.update(payments).set({ status: 'failed', verificationMessage: `Customer payment was not completed: ${String(callback?.ResultDesc ?? 'Daraja returned an unsuccessful result.').slice(0, 420)}` })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  const items = callback?.CallbackMetadata?.Item
  const metadata = Array.isArray(items) ? Object.fromEntries(items.filter((item: { Name?: unknown }) => typeof item?.Name === 'string').map((item: { Name: string; Value?: unknown }) => [item.Name, item.Value])) : {}
  const receipt = typeof metadata.MpesaReceiptNumber === 'string' ? metadata.MpesaReceiptNumber : ''
  const amount = Number(metadata.Amount)
  const callbackPhone = normalizeKenyanPhone(String(metadata.PhoneNumber ?? ''))
  const transactionAt = parseDarajaTimestamp(String(metadata.TransactionDate ?? ''))
  if (!receipt || !Number.isFinite(amount) || !callbackPhone || !transactionAt) {
    await db.update(payments).set({ status: 'failed', verificationMessage: 'Daraja callback omitted required receipt, amount, phone, or transaction time.' })
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

  const [order] = await db.select({ id: orders.id, userId: orders.userId, orderNumber: orders.orderNumber, total: orders.total, currency: orders.currency, status: orders.status, phone: users.phone })
    .from(orders).innerJoin(users, eq(orders.userId, users.id)).where(eq(orders.id, payment.orderId)).limit(1)
  const accountPhone = order?.phone ? normalizeKenyanPhone(order.phone) : null
  const validTime = transactionAt.getTime() >= payment.createdAt.getTime() - 2 * 60 * 1000 && transactionAt.getTime() <= Date.now() + 5 * 60 * 1000
  if (!order || order.status !== 'pending_payment' || order.currency !== 'KES' || !accountPhone || accountPhone !== callbackPhone
    || callbackPhone !== payment.payerPhone || !isValidDarajaPaymentAmount(order.currency, amount, payment.amount, order.total) || !validTime) {
    await db.update(payments).set({
      status: 'failed',
      providerReceipt: receipt,
      payerPhone: callbackPhone,
      transactionAt,
      verificationMessage: 'Automatic verification rejected the callback: order, amount, account phone, or transaction time did not match.',
    }).where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    return response.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }

  await db.transaction(async (transaction) => {
    const [paymentUpdate] = await transaction.update(payments).set({
      status: 'succeeded',
      providerReceipt: receipt,
      payerPhone: callbackPhone,
      transactionAt,
      verificationMessage: `Automatically verified against Daraja. Account name on file: ${payment.payerName ?? 'not provided'}; Daraja does not verify account-holder names.`,
    }).where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
    if (paymentUpdate.affectedRows !== 1) return
    const [orderUpdate] = await transaction.update(orders).set({ status: 'paid' })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')))
    if (orderUpdate.affectedRows !== 1) throw new Error('Order changed while verifying the M-Pesa payment.')
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
