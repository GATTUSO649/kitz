import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { buildAbsoluteUrl, renderHtmlEmail, sendTransactionalEmail } from '../../config/email.js'
import { db } from '../../config/database.js'
import { authenticatedAdmin } from '../../middleware/authenticate.js'
import { recordAdminAudit } from './auth.js'
import {
  inventoryMovements,
  inventoryPurchaseOrderLines,
  inventoryPurchaseOrders,
  inventoryReturns,
  inventorySuppliers,
  marketingCoupons,
  marketingEmailCampaigns,
  orderItems,
  orders,
  paymentReconciliations,
  paymentRefunds,
  payments,
  productVariants,
  products,
  users,
} from '../../database/schema.js'

export const adminWorkflowsRouter = Router()
const moneySchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/)
const actorId = (request: Parameters<typeof authenticatedAdmin>[0]) => authenticatedAdmin(request)?.id

class WorkflowRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function sendWorkflowError(response: Parameters<Parameters<typeof adminWorkflowsRouter.get>[1]>[1], error: unknown) {
  if (error instanceof WorkflowRequestError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } })
    return true
  }
  return false
}

function cents(value: string) {
  return Math.round(Number(value) * 100)
}

function decimal(value: number) {
  return (value / 100).toFixed(2)
}

function currentActorId(request: Parameters<typeof authenticatedAdmin>[0]) {
  const id = actorId(request)
  if (!id) throw new WorkflowRequestError(401, 'UNAUTHENTICATED', 'Administrator sign in is required.')
  return id
}

adminWorkflowsRouter.get('/finance/refunds', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Refund records are unavailable.' } })
  const rows = await db.select({
    id: paymentRefunds.id, paymentId: paymentRefunds.paymentId, orderId: paymentRefunds.orderId,
    orderNumber: orders.orderNumber, providerReceipt: payments.providerReceipt, amount: paymentRefunds.amount,
    reason: paymentRefunds.reason, status: paymentRefunds.status, providerReference: paymentRefunds.providerReference,
    resolutionNote: paymentRefunds.resolutionNote, createdAt: paymentRefunds.createdAt, resolvedAt: paymentRefunds.resolvedAt,
  }).from(paymentRefunds).innerJoin(orders, eq(paymentRefunds.orderId, orders.id))
    .innerJoin(payments, eq(paymentRefunds.paymentId, payments.id)).orderBy(desc(paymentRefunds.createdAt)).limit(250)
  response.json({ data: rows })
})

adminWorkflowsRouter.post('/finance/refunds', async (request, response) => {
  const input = z.object({ paymentId: z.number().int().positive(), amount: moneySchema, reason: z.string().trim().min(3).max(500) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_REFUND', message: 'Enter a payment, positive amount, and reason.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Refund requests are unavailable.' } })
  try {
    const adminId = currentActorId(request)
    const created = await db.transaction(async (transaction) => {
      const [payment] = await transaction.select({ id: payments.id, orderId: payments.orderId, amount: payments.amount, status: payments.status })
        .from(payments).where(eq(payments.id, input.data.paymentId)).for('update').limit(1)
      if (!payment || !['succeeded', 'refunded'].includes(payment.status)) throw new WorkflowRequestError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only successful payments can be refunded.')
      const refunds = await transaction.select({ amount: paymentRefunds.amount }).from(paymentRefunds)
        .where(and(eq(paymentRefunds.paymentId, payment.id), inArray(paymentRefunds.status, ['requested', 'approved', 'paid'])))
      const reservedCents = refunds.reduce((total, row) => total + cents(row.amount), 0)
      const amountCents = cents(input.data.amount)
      if (amountCents <= 0 || reservedCents + amountCents > cents(payment.amount)) throw new WorkflowRequestError(409, 'REFUND_EXCEEDS_BALANCE', 'The refund exceeds the payment amount remaining after other requests.')
      const [refund] = await transaction.insert(paymentRefunds).values({ paymentId: payment.id, orderId: payment.orderId, amount: decimal(amountCents), reason: input.data.reason, createdByAdminId: adminId }).returning({ id: paymentRefunds.id })
      return refund
    })
    await recordAdminAudit(adminId, 'finance.refund.requested', 'payment_refund', String(created.id))
    response.status(201).json({ data: created })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.patch('/finance/refunds/:id', async (request, response) => {
  const input = z.object({ action: z.enum(['approve', 'reject', 'mark_paid']), note: z.string().trim().max(500).optional(), providerReference: z.string().trim().min(2).max(120).optional() }).strict().safeParse(request.body)
  const refundId = Number(request.params.id)
  if (!Number.isInteger(refundId) || refundId < 1 || !input.success) return response.status(400).json({ error: { code: 'INVALID_REFUND_UPDATE', message: 'The refund update is invalid.' } })
  if (input.data.action === 'mark_paid' && !input.data.providerReference) return response.status(400).json({ error: { code: 'PROVIDER_REFERENCE_REQUIRED', message: 'Record the external payout reference before marking a refund paid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Refund records are unavailable.' } })
  try {
    const adminId = currentActorId(request)
    await db.transaction(async (transaction) => {
      const [refund] = await transaction.select({ id: paymentRefunds.id, paymentId: paymentRefunds.paymentId, orderId: paymentRefunds.orderId, amount: paymentRefunds.amount, status: paymentRefunds.status })
        .from(paymentRefunds).where(eq(paymentRefunds.id, refundId)).for('update').limit(1)
      if (!refund) throw new WorkflowRequestError(404, 'REFUND_NOT_FOUND', 'Refund request was not found.')
      if (input.data.action === 'approve' || input.data.action === 'reject') {
        if (refund.status !== 'requested') throw new WorkflowRequestError(409, 'INVALID_REFUND_STATE', 'Only requested refunds can be approved or rejected.')
        await transaction.update(paymentRefunds).set({ status: input.data.action === 'approve' ? 'approved' : 'rejected', resolutionNote: input.data.note ?? null, resolvedByAdminId: adminId, resolvedAt: new Date() }).where(eq(paymentRefunds.id, refund.id))
      } else {
        if (refund.status !== 'approved') throw new WorkflowRequestError(409, 'INVALID_REFUND_STATE', 'Approve a refund before recording its manual payout.')
        await transaction.update(paymentRefunds).set({ status: 'paid', providerReference: input.data.providerReference, resolutionNote: input.data.note ?? null, resolvedByAdminId: adminId, resolvedAt: new Date() }).where(eq(paymentRefunds.id, refund.id))
        const [payment] = await transaction.select({ amount: payments.amount }).from(payments).where(eq(payments.id, refund.paymentId)).limit(1)
        const paid = await transaction.select({ amount: paymentRefunds.amount }).from(paymentRefunds).where(and(eq(paymentRefunds.paymentId, refund.paymentId), eq(paymentRefunds.status, 'paid')))
        const paidCents = paid.reduce((total, row) => total + cents(row.amount), cents(refund.amount))
        if (payment && paidCents >= cents(payment.amount)) await transaction.update(payments).set({ status: 'refunded' }).where(eq(payments.id, refund.paymentId))
        const orderPaid = await transaction.select({ amount: payments.amount }).from(payments).where(and(eq(payments.orderId, refund.orderId), eq(payments.status, 'refunded')))
        const fullyRefundedCents = orderPaid.reduce((total, row) => total + cents(row.amount), 0)
        const [order] = await transaction.select({ total: orders.total }).from(orders).where(eq(orders.id, refund.orderId)).limit(1)
        if (order && fullyRefundedCents >= cents(order.total)) await transaction.update(orders).set({ status: 'refunded' }).where(eq(orders.id, refund.orderId))
      }
    })
    await recordAdminAudit(adminId, `finance.refund.${input.data.action}`, 'payment_refund', String(refundId))
    response.json({ data: { updated: true } })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.get('/finance/reconciliation', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Reconciliation is unavailable.' } })
  const rows = await db.select().from(paymentReconciliations).orderBy(desc(paymentReconciliations.settlementDate)).limit(180)
  response.json({ data: rows.map((row) => ({ ...row, variance: decimal(cents(row.providerAmount) - cents(row.internalAmount)) })) })
})

adminWorkflowsRouter.post('/finance/reconciliation', async (request, response) => {
  const input = z.object({ settlementDate: z.string().date(), providerAmount: moneySchema, note: z.string().trim().max(500).optional() }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_RECONCILIATION', message: 'Enter a valid settlement date and provider amount.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Reconciliation is unavailable.' } })
  try {
    const adminId = currentActorId(request)
    const internalAmount = await db.select({ amount: sql<string>`COALESCE(SUM(${payments.amount}), 0)` }).from(payments)
      .where(and(eq(payments.status, 'succeeded'), sql`DATE(COALESCE(${payments.transactionAt}, ${payments.createdAt})) = ${input.data.settlementDate}`))
    const internalCents = cents(internalAmount[0]?.amount ?? '0')
    const values = { internalAmount: decimal(internalCents), providerAmount: decimal(cents(input.data.providerAmount)), note: input.data.note ?? null, reconciledByAdminId: adminId }
    const [existing] = await db.select({ id: paymentReconciliations.id }).from(paymentReconciliations).where(eq(paymentReconciliations.settlementDate, input.data.settlementDate)).limit(1)
    if (existing) await db.update(paymentReconciliations).set(values).where(eq(paymentReconciliations.id, existing.id))
    else await db.insert(paymentReconciliations).values({ ...values, settlementDate: input.data.settlementDate })
    await recordAdminAudit(adminId, existing ? 'finance.reconciliation.updated' : 'finance.reconciliation.created', 'settlement', input.data.settlementDate)
    response.json({ data: { settlementDate: input.data.settlementDate, ...values, variance: decimal(cents(values.providerAmount) - internalCents) } })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.get('/inventory/suppliers', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Suppliers are unavailable.' } })
  response.json({ data: await db.select().from(inventorySuppliers).orderBy(asc(inventorySuppliers.name)) })
})

adminWorkflowsRouter.post('/inventory/suppliers', async (request, response) => {
  const input = z.object({ name: z.string().trim().min(2).max(160), contactName: z.string().trim().max(160).optional(), email: z.string().trim().email().max(254).optional().or(z.literal('')), phone: z.string().trim().max(32).optional(), notes: z.string().trim().max(1000).optional() }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_SUPPLIER', message: 'Check the supplier details.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Suppliers are unavailable.' } })
  const adminId = currentActorId(request)
  const [supplier] = await db.insert(inventorySuppliers).values({ ...input.data, email: input.data.email || null }).returning({ id: inventorySuppliers.id })
  await recordAdminAudit(adminId, 'inventory.supplier.created', 'supplier', String(supplier.id))
  response.status(201).json({ data: supplier })
})

adminWorkflowsRouter.patch('/inventory/suppliers/:id', async (request, response) => {
  const id = Number(request.params.id)
  const input = z.object({ active: z.boolean() }).strict().safeParse(request.body)
  if (!Number.isInteger(id) || id < 1 || !input.success) return response.status(400).json({ error: { code: 'INVALID_SUPPLIER_UPDATE', message: 'Supplier update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Suppliers are unavailable.' } })
  const adminId = currentActorId(request)
  const result = await db.update(inventorySuppliers).set({ active: input.data.active }).where(eq(inventorySuppliers.id, id)).returning({ id: inventorySuppliers.id })
  if (!result.length) return response.status(404).json({ error: { code: 'SUPPLIER_NOT_FOUND', message: 'Supplier was not found.' } })
  await recordAdminAudit(adminId, input.data.active ? 'inventory.supplier.activated' : 'inventory.supplier.deactivated', 'supplier', String(id))
  response.json({ data: { updated: true } })
})

adminWorkflowsRouter.get('/inventory/purchase-orders', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Purchase orders are unavailable.' } })
  const orders = await db.select({ id: inventoryPurchaseOrders.id, status: inventoryPurchaseOrders.status, note: inventoryPurchaseOrders.note, expectedAt: inventoryPurchaseOrders.expectedAt, createdAt: inventoryPurchaseOrders.createdAt, receivedAt: inventoryPurchaseOrders.receivedAt, supplierId: inventorySuppliers.id, supplierName: inventorySuppliers.name })
    .from(inventoryPurchaseOrders).innerJoin(inventorySuppliers, eq(inventoryPurchaseOrders.supplierId, inventorySuppliers.id)).orderBy(desc(inventoryPurchaseOrders.createdAt)).limit(200)
  const ids = orders.map((order) => order.id)
  const lines = ids.length ? await db.select({ purchaseOrderId: inventoryPurchaseOrderLines.purchaseOrderId, id: inventoryPurchaseOrderLines.id, variantId: productVariants.id, productName: products.name, size: productVariants.size, sku: productVariants.sku, quantityOrdered: inventoryPurchaseOrderLines.quantityOrdered, quantityReceived: inventoryPurchaseOrderLines.quantityReceived, unitCost: inventoryPurchaseOrderLines.unitCost })
    .from(inventoryPurchaseOrderLines).innerJoin(productVariants, eq(inventoryPurchaseOrderLines.variantId, productVariants.id)).innerJoin(products, eq(productVariants.productId, products.id)).where(inArray(inventoryPurchaseOrderLines.purchaseOrderId, ids)) : []
  response.json({ data: orders.map((order) => ({ ...order, lines: lines.filter((line) => line.purchaseOrderId === order.id) })) })
})

adminWorkflowsRouter.post('/inventory/purchase-orders', async (request, response) => {
  const input = z.object({ supplierId: z.number().int().positive(), note: z.string().trim().max(1000).optional(), expectedAt: z.string().datetime().optional(), lines: z.array(z.object({ variantId: z.number().int().positive(), quantity: z.number().int().min(1).max(100000), unitCost: moneySchema }).strict()).min(1).max(100) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_PURCHASE_ORDER', message: 'Add a supplier and at least one valid line item.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Purchase orders are unavailable.' } })
  try {
    const adminId = currentActorId(request)
    const id = await db.transaction(async (transaction) => {
      const [supplier] = await transaction.select({ id: inventorySuppliers.id }).from(inventorySuppliers).where(and(eq(inventorySuppliers.id, input.data.supplierId), eq(inventorySuppliers.active, true))).limit(1)
      if (!supplier) throw new WorkflowRequestError(400, 'SUPPLIER_INACTIVE', 'Choose an active supplier.')
      const [order] = await transaction.insert(inventoryPurchaseOrders).values({ supplierId: supplier.id, note: input.data.note ?? null, expectedAt: input.data.expectedAt ? new Date(input.data.expectedAt) : null, createdByAdminId: adminId }).returning({ id: inventoryPurchaseOrders.id })
      await transaction.insert(inventoryPurchaseOrderLines).values(input.data.lines.map((line) => ({ purchaseOrderId: order.id, variantId: line.variantId, quantityOrdered: line.quantity, unitCost: line.unitCost })))
      return order.id
    })
    await recordAdminAudit(adminId, 'inventory.purchase_order.created', 'purchase_order', String(id))
    response.status(201).json({ data: { id } })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.patch('/inventory/purchase-orders/:id', async (request, response) => {
  const id = Number(request.params.id)
  const input = z.object({ action: z.enum(['approve', 'order', 'cancel']) }).strict().safeParse(request.body)
  if (!Number.isInteger(id) || id < 1 || !input.success) return response.status(400).json({ error: { code: 'INVALID_PURCHASE_ORDER_ACTION', message: 'Purchase order action is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Purchase orders are unavailable.' } })
  try {
    const adminId = currentActorId(request)
    await db.transaction(async (transaction) => {
      const [order] = await transaction.select({ id: inventoryPurchaseOrders.id, status: inventoryPurchaseOrders.status }).from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, id)).for('update').limit(1)
      if (!order) throw new WorkflowRequestError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found.')
      const next = input.data.action === 'approve' && order.status === 'draft' ? 'approved'
        : input.data.action === 'order' && order.status === 'approved' ? 'ordered'
          : input.data.action === 'cancel' && ['draft', 'approved', 'ordered'].includes(order.status) ? 'cancelled' : null
      if (!next) throw new WorkflowRequestError(409, 'INVALID_PURCHASE_ORDER_STATE', 'Purchase order cannot make that transition.')
      await transaction.update(inventoryPurchaseOrders).set({ status: next, ...(next === 'approved' ? { approvedByAdminId: adminId, approvedAt: new Date() } : {}) }).where(eq(inventoryPurchaseOrders.id, id))
    })
    await recordAdminAudit(adminId, `inventory.purchase_order.${input.data.action}d`, 'purchase_order', String(id))
    response.json({ data: { updated: true } })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.post('/inventory/purchase-orders/:id/receive', async (request, response) => {
  const id = Number(request.params.id)
  const input = z.object({ lines: z.array(z.object({ lineId: z.number().int().positive(), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(100) }).strict().safeParse(request.body)
  if (!Number.isInteger(id) || id < 1 || !input.success) return response.status(400).json({ error: { code: 'INVALID_RECEIPT', message: 'Enter received quantities for this purchase order.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Receiving is unavailable.' } })
  try {
    const adminId = currentActorId(request)
    const allReceived = await db.transaction(async (transaction) => {
      const [order] = await transaction.select({ status: inventoryPurchaseOrders.status }).from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, id)).for('update').limit(1)
      if (!order) throw new WorkflowRequestError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found.')
      if (order.status !== 'ordered') throw new WorkflowRequestError(409, 'PURCHASE_ORDER_NOT_ORDERED', 'Only ordered purchase orders can be received.')
      for (const received of input.data.lines) {
        const [line] = await transaction.select({ id: inventoryPurchaseOrderLines.id, variantId: inventoryPurchaseOrderLines.variantId, quantityOrdered: inventoryPurchaseOrderLines.quantityOrdered, quantityReceived: inventoryPurchaseOrderLines.quantityReceived })
          .from(inventoryPurchaseOrderLines).where(and(eq(inventoryPurchaseOrderLines.id, received.lineId), eq(inventoryPurchaseOrderLines.purchaseOrderId, id))).for('update').limit(1)
        if (!line || line.quantityReceived + received.quantity > line.quantityOrdered) throw new WorkflowRequestError(409, 'RECEIPT_EXCEEDS_ORDER', 'Received quantity exceeds the remaining ordered quantity.')
        await transaction.update(inventoryPurchaseOrderLines).set({ quantityReceived: line.quantityReceived + received.quantity }).where(eq(inventoryPurchaseOrderLines.id, line.id))
        await transaction.update(productVariants).set({ stock: sql`${productVariants.stock} + ${received.quantity}` }).where(eq(productVariants.id, line.variantId))
        await transaction.insert(inventoryMovements).values({ variantId: line.variantId, movementType: 'restock', quantityChange: received.quantity, note: `Received against purchase order ${id}` })
      }
      const remaining = await transaction.select({ total: count() }).from(inventoryPurchaseOrderLines).where(and(eq(inventoryPurchaseOrderLines.purchaseOrderId, id), sql`${inventoryPurchaseOrderLines.quantityReceived} < ${inventoryPurchaseOrderLines.quantityOrdered}`))
      const complete = Number(remaining[0]?.total ?? 0) === 0
      if (complete) await transaction.update(inventoryPurchaseOrders).set({ status: 'received', receivedAt: new Date() }).where(eq(inventoryPurchaseOrders.id, id))
      return complete
    })
    await recordAdminAudit(adminId, allReceived ? 'inventory.purchase_order.received' : 'inventory.purchase_order.partially_received', 'purchase_order', String(id))
    response.json({ data: { received: true, complete: allReceived } })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.get('/inventory/returns', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Returns are unavailable.' } })
  const rows = await db.select({ id: inventoryReturns.id, orderId: inventoryReturns.orderId, orderNumber: orders.orderNumber, orderItemId: inventoryReturns.orderItemId, productName: orderItems.productNameSnapshot, size: orderItems.sizeSnapshot, quantity: inventoryReturns.quantity, reason: inventoryReturns.reason, status: inventoryReturns.status, resolutionNote: inventoryReturns.resolutionNote, createdAt: inventoryReturns.createdAt })
    .from(inventoryReturns).innerJoin(orders, eq(inventoryReturns.orderId, orders.id)).innerJoin(orderItems, eq(inventoryReturns.orderItemId, orderItems.id)).orderBy(desc(inventoryReturns.createdAt)).limit(250)
  response.json({ data: rows })
})

adminWorkflowsRouter.get('/inventory/returns/eligible-items', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Eligible return items are unavailable.' } })
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000)
  const items = await db.select({ id: orderItems.id, orderNumber: orders.orderNumber, productName: orderItems.productNameSnapshot, size: orderItems.sizeSnapshot, quantity: orderItems.quantity, createdAt: orders.createdAt })
    .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.status, 'delivered'), gte(orders.createdAt, cutoff)))
    .orderBy(desc(orders.createdAt)).limit(250)
  const itemIds = items.map((item) => item.id)
  const priorReturns = itemIds.length ? await db.select({ orderItemId: inventoryReturns.orderItemId, quantity: inventoryReturns.quantity })
    .from(inventoryReturns).where(and(inArray(inventoryReturns.orderItemId, itemIds), inArray(inventoryReturns.status, ['requested', 'approved', 'received']))) : []
  const returnedByItem = new Map<number, number>()
  for (const item of priorReturns) returnedByItem.set(item.orderItemId, (returnedByItem.get(item.orderItemId) ?? 0) + item.quantity)
  response.json({ data: items.flatMap((item) => {
    const remainingQuantity = item.quantity - (returnedByItem.get(item.id) ?? 0)
    return remainingQuantity > 0 ? [{ ...item, remainingQuantity }] : []
  }) })
})

adminWorkflowsRouter.post('/inventory/returns', async (request, response) => {
  const input = z.object({ orderItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(5), reason: z.string().trim().min(3).max(500) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_RETURN', message: 'Check the order item, quantity, and reason.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Returns are unavailable.' } })
  try {
    const adminId = currentActorId(request)
    const result = await db.transaction(async (transaction) => {
      const [item] = await transaction.select({ id: orderItems.id, orderId: orders.id, variantId: orderItems.variantId, quantity: orderItems.quantity, status: orders.status, createdAt: orders.createdAt })
        .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id)).where(eq(orderItems.id, input.data.orderItemId)).for('update').limit(1)
      if (!item || item.status !== 'delivered' || Date.now() - item.createdAt.getTime() > 30 * 24 * 60 * 60_000) throw new WorkflowRequestError(409, 'RETURN_WINDOW_CLOSED', 'Returns are available for delivered orders within 30 days.')
      const prior = await transaction.select({ quantity: inventoryReturns.quantity }).from(inventoryReturns).where(and(eq(inventoryReturns.orderItemId, item.id), inArray(inventoryReturns.status, ['requested', 'approved', 'received'])))
      if (prior.reduce((total, row) => total + row.quantity, 0) + input.data.quantity > item.quantity) throw new WorkflowRequestError(409, 'RETURN_QUANTITY_EXCEEDED', 'Return quantity exceeds the unreturned order quantity.')
      const [created] = await transaction.insert(inventoryReturns).values({ orderId: item.orderId, orderItemId: item.id, variantId: item.variantId, quantity: input.data.quantity, reason: input.data.reason, createdByAdminId: adminId }).returning({ id: inventoryReturns.id })
      return created
    })
    await recordAdminAudit(adminId, 'inventory.return.requested', 'inventory_return', String(result.id))
    response.status(201).json({ data: result })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.patch('/inventory/returns/:id', async (request, response) => {
  const id = Number(request.params.id)
  const input = z.object({ action: z.enum(['approve', 'reject', 'receive']), note: z.string().trim().max(500).optional() }).strict().safeParse(request.body)
  if (!Number.isInteger(id) || id < 1 || !input.success) return response.status(400).json({ error: { code: 'INVALID_RETURN_UPDATE', message: 'Return update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Returns are unavailable.' } })
  try {
    const adminId = currentActorId(request)
    await db.transaction(async (transaction) => {
      const [item] = await transaction.select({ id: inventoryReturns.id, variantId: inventoryReturns.variantId, quantity: inventoryReturns.quantity, status: inventoryReturns.status })
        .from(inventoryReturns).where(eq(inventoryReturns.id, id)).for('update').limit(1)
      if (!item) throw new WorkflowRequestError(404, 'RETURN_NOT_FOUND', 'Return request was not found.')
      if (input.data.action === 'approve' || input.data.action === 'reject') {
        if (item.status !== 'requested') throw new WorkflowRequestError(409, 'INVALID_RETURN_STATE', 'Only requested returns can be approved or rejected.')
        await transaction.update(inventoryReturns).set({ status: input.data.action === 'approve' ? 'approved' : 'rejected', resolutionNote: input.data.note ?? null, resolvedByAdminId: adminId }).where(eq(inventoryReturns.id, id))
      } else {
        if (item.status !== 'approved' || !item.variantId) throw new WorkflowRequestError(409, 'INVALID_RETURN_STATE', 'Approve a return with a valid stock variant before receiving it.')
        await transaction.update(inventoryReturns).set({ status: 'received', resolutionNote: input.data.note ?? null, resolvedByAdminId: adminId, receivedAt: new Date() }).where(eq(inventoryReturns.id, id))
        await transaction.update(productVariants).set({ stock: sql`${productVariants.stock} + ${item.quantity}` }).where(eq(productVariants.id, item.variantId))
        await transaction.insert(inventoryMovements).values({ variantId: item.variantId, movementType: 'restock', quantityChange: item.quantity, note: `Customer return ${id} received` })
      }
    })
    await recordAdminAudit(adminId, `inventory.return.${input.data.action}d`, 'inventory_return', String(id))
    response.json({ data: { updated: true } })
  } catch (error) {
    if (sendWorkflowError(response, error)) return
    throw error
  }
})

adminWorkflowsRouter.get('/marketing/coupons', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Coupons are unavailable.' } })
  response.json({ data: await db.select().from(marketingCoupons).orderBy(desc(marketingCoupons.createdAt)).limit(250) })
})

adminWorkflowsRouter.post('/marketing/coupons', async (request, response) => {
  const input = z.object({ code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/), discountType: z.enum(['percent', 'fixed']), value: moneySchema, minimumSubtotal: moneySchema.default('0.00'), maxRedemptions: z.number().int().positive().nullable().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).strict().safeParse(request.body)
  if (!input.success || (input.success && (cents(input.data.value) <= 0 || (input.data.discountType === 'percent' && Number(input.data.value) > 100)))) return response.status(400).json({ error: { code: 'INVALID_COUPON', message: 'Coupon value, type, or dates are invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Coupons are unavailable.' } })
  const adminId = currentActorId(request)
  try {
    const [coupon] = await db.insert(marketingCoupons).values({ code: input.data.code.toUpperCase(), discountType: input.data.discountType, value: input.data.value, minimumSubtotal: input.data.minimumSubtotal, maxRedemptions: input.data.maxRedemptions ?? null, startsAt: input.data.startsAt ? new Date(input.data.startsAt) : null, endsAt: input.data.endsAt ? new Date(input.data.endsAt) : null, createdByAdminId: adminId }).returning({ id: marketingCoupons.id })
    await recordAdminAudit(adminId, 'marketing.coupon.created', 'coupon', String(coupon.id))
    response.status(201).json({ data: coupon })
  } catch (error) {
    if (String((error as { code?: string }).code ?? '') === '23505') return response.status(409).json({ error: { code: 'COUPON_CODE_EXISTS', message: 'That coupon code already exists.' } })
    throw error
  }
})

adminWorkflowsRouter.patch('/marketing/coupons/:id', async (request, response) => {
  const id = Number(request.params.id)
  const input = z.object({ active: z.boolean() }).strict().safeParse(request.body)
  if (!Number.isInteger(id) || id < 1 || !input.success) return response.status(400).json({ error: { code: 'INVALID_COUPON_UPDATE', message: 'Coupon update is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Coupons are unavailable.' } })
  const adminId = currentActorId(request)
  const changed = await db.update(marketingCoupons).set({ active: input.data.active }).where(eq(marketingCoupons.id, id)).returning({ id: marketingCoupons.id })
  if (!changed.length) return response.status(404).json({ error: { code: 'COUPON_NOT_FOUND', message: 'Coupon was not found.' } })
  await recordAdminAudit(adminId, input.data.active ? 'marketing.coupon.activated' : 'marketing.coupon.deactivated', 'coupon', String(id))
  response.json({ data: { updated: true } })
})

adminWorkflowsRouter.get('/marketing/audiences', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Marketing audiences are unavailable.' } })
  const [totals] = await db.select({ total: count(), eligible: sql<number>`COUNT(*) FILTER (WHERE ${users.emailVerifiedAt} IS NOT NULL AND ${users.marketingConsentAt} IS NOT NULL)` }).from(users)
  response.json({ data: { totalCustomers: Number(totals?.total ?? 0), eligibleEmailSubscribers: Number(totals?.eligible ?? 0), consentRequired: true } })
})

adminWorkflowsRouter.get('/marketing/email-campaigns', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Email campaigns are unavailable.' } })
  response.json({ data: await db.select().from(marketingEmailCampaigns).orderBy(desc(marketingEmailCampaigns.createdAt)).limit(100) })
})

adminWorkflowsRouter.post('/marketing/email-campaigns', async (request, response) => {
  const input = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(6000) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_EMAIL_CAMPAIGN', message: 'Enter a subject and campaign body.' } })
  if (!db) return response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Email campaigns are unavailable.' } })
  const adminId = currentActorId(request)
  const recipients = await db.select({ id: users.id, email: users.email }).from(users).where(and(isNotNull(users.emailVerifiedAt), isNotNull(users.marketingConsentAt))).orderBy(asc(users.id)).limit(251)
  if (recipients.length > 250) return response.status(409).json({ error: { code: 'AUDIENCE_TOO_LARGE', message: 'This synchronous sender is limited to 250 opted-in subscribers. Narrow the audience before sending.' } })
  if (!recipients.length) return response.status(409).json({ error: { code: 'AUDIENCE_EMPTY', message: 'No verified customers have opted in to marketing emails.' } })
  const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const preferenceUrl = buildAbsoluteUrl('/account/settings')
  const bodyText = input.data.body
  const bodyHtml = `<p>${escapeHtml(bodyText).replace(/\n/g, '<br>')}</p><p><a href="${escapeHtml(preferenceUrl)}">Manage email preferences</a></p>`
  const results = await Promise.all(recipients.map((recipient) => sendTransactionalEmail({ to: recipient.email, subject: input.data.subject, text: `${bodyText}\n\nManage email preferences: ${preferenceUrl}`, html: renderHtmlEmail(input.data.subject, bodyHtml), notificationType: 'marketing_campaign', userId: recipient.id })))
  const acceptedCount = results.filter((result) => result.accepted).length
  const failedCount = results.length - acceptedCount
  const status = acceptedCount === results.length ? 'sent' : acceptedCount ? 'partial' : 'failed'
  const [campaign] = await db.insert(marketingEmailCampaigns).values({ subject: input.data.subject, body: bodyText, status, recipientCount: recipients.length, acceptedCount, failedCount, createdByAdminId: adminId }).returning({ id: marketingEmailCampaigns.id })
  await recordAdminAudit(adminId, 'marketing.email_campaign.sent', 'email_campaign', String(campaign.id))
  response.status(201).json({ data: { ...campaign, status, recipientCount: recipients.length, acceptedCount, failedCount } })
})