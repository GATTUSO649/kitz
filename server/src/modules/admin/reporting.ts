import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql, sum } from 'drizzle-orm'
import { db } from '../../config/database.js'
import { categories, orderItems, orders, payments, productVariants, products, users } from '../../database/schema.js'

export const reportPeriods = ['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth', 'thisYear', 'custom'] as const
export type ReportPeriod = typeof reportPeriods[number]

export type ReportingRange = {
  period: ReportPeriod
  from: Date
  toExclusive: Date
}

const dayMs = 24 * 60 * 60 * 1000

function utcDayStart(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function parseDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date.getTime()
}

export function resolveOptionalDateRange(input: { from?: string; to?: string }): { from?: Date; toExclusive?: Date } | null {
  const from = input.from === undefined ? undefined : parseDate(input.from)
  const to = input.to === undefined ? undefined : parseDate(input.to)
  if ((input.from !== undefined && from === null) || (input.to !== undefined && to === null)) return null
  if (from !== undefined && from !== null && to !== undefined && to !== null && (to < from || to + dayMs - from > 366 * dayMs)) return null

  return {
    ...(from !== undefined && from !== null ? { from: new Date(from) } : {}),
    ...(to !== undefined && to !== null ? { toExclusive: new Date(to + dayMs) } : {}),
  }
}

export function resolveReportingRange(
  input: { period?: string; from?: string; to?: string },
  now = new Date(),
): ReportingRange | null {
  const period = input.period ?? 'last30days'
  if (!reportPeriods.includes(period as ReportPeriod)) return null
  const selectedPeriod = period as ReportPeriod
  const today = utcDayStart(now)
  let from: number
  let toExclusive = today + dayMs

  switch (selectedPeriod) {
    case 'today':
      from = today
      break
    case 'yesterday':
      from = today - dayMs
      toExclusive = today
      break
    case 'last7days':
      from = today - 6 * dayMs
      break
    case 'last30days':
      from = today - 29 * dayMs
      break
    case 'thisMonth':
      from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      break
    case 'lastMonth':
      from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
      toExclusive = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      break
    case 'thisYear':
      from = Date.UTC(now.getUTCFullYear(), 0, 1)
      break
    case 'custom': {
      const customFrom = parseDate(input.from)
      const customTo = parseDate(input.to)
      if (customFrom === null || customTo === null || customTo < customFrom) return null
      from = customFrom
      toExclusive = customTo + dayMs
      if (toExclusive - from > 366 * dayMs) return null
      break
    }
  }

  return { period: selectedPeriod, from: new Date(from), toExclusive: new Date(toExclusive) }
}

const salesOrderStatuses = ['paid', 'processing', 'dispatched', 'delivered'] as const
const settledAt = sql`COALESCE(${payments.transactionAt} AT TIME ZONE 'UTC', ${payments.updatedAt})`
const settledDate = sql`(${settledAt} AT TIME ZONE 'UTC')::date`

export async function buildAdminDashboardReport(database: typeof db, range: ReportingRange) {
  if (!database) return null
  const orderRange = and(gte(orders.createdAt, range.from), lt(orders.createdAt, range.toExclusive))
  const paymentRange = and(gte(settledAt, range.from), lt(settledAt, range.toExclusive))
  const [orderSummary, revenueSummary, inventorySummary, pendingSummary, customerSummary, productSummary] = await Promise.all([
    database.select({ total: count() }).from(orders).where(orderRange),
    database.select({
      revenue: sum(payments.amount),
      paidPayments: count(),
      paidOrders: sql<number>`COUNT(DISTINCT ${payments.orderId})`,
    }).from(payments).where(and(eq(payments.status, 'succeeded'), paymentRange)),
    database.select({
      units: sum(productVariants.stock),
      lowStock: sql<number>`COALESCE(SUM(CASE WHEN ${productVariants.stock} > 0 AND ${productVariants.stock} <= 5 THEN 1 ELSE 0 END), 0)`,
      outOfStock: sql<number>`COALESCE(SUM(CASE WHEN ${productVariants.stock} = 0 THEN 1 ELSE 0 END), 0)`,
    }).from(productVariants),
    database.select({ total: count() }).from(orders).where(eq(orders.status, 'pending_payment')),
    database.select({ total: count(), newCustomers: sql<number>`COALESCE(SUM(CASE WHEN ${users.createdAt} >= ${range.from} AND ${users.createdAt} < ${range.toExclusive} THEN 1 ELSE 0 END), 0)` }).from(users),
    database.select({ total: count() }).from(products),
  ])

  const paidRevenue = Number(revenueSummary[0]?.revenue ?? 0)
  const paidOrderCount = Number(revenueSummary[0]?.paidOrders ?? 0)
  const [returningCustomerSummary] = await database.select({
    total: sql<number>`COUNT(DISTINCT ${orders.userId})`,
  })
    .from(orders)
    .where(and(
      isNotNull(orders.userId),
      orderRange,
      inArray(orders.status, salesOrderStatuses),
      sql`EXISTS (
        SELECT 1 FROM orders AS previous_orders
        WHERE previous_orders.user_id = ${orders.userId}
          AND previous_orders.created_at < ${range.from}
          AND previous_orders.status IN ('paid', 'processing', 'dispatched', 'delivered')
      )`,
    ))

  const salesItems = () => database.select({
      name: products.name,
      category: sql<string>`COALESCE(${categories.name}, 'Uncategorized')`,
      units: sum(orderItems.quantity),
    }).from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(orderRange, inArray(orders.status, salesOrderStatuses)))
      .groupBy(products.id, products.name, categories.name)

  const [bestSellers, worstSellers, salesByCategory, salesByLocation, revenueTrend] = await Promise.all([
    salesItems().orderBy(desc(sum(orderItems.quantity))).limit(5),
    salesItems().orderBy(sum(orderItems.quantity)).limit(5),
    database.select({ category: sql<string>`COALESCE(${categories.name}, 'Uncategorized')`, units: sum(orderItems.quantity) })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(orderRange, inArray(orders.status, salesOrderStatuses)))
      .groupBy(categories.name)
      .orderBy(desc(sum(orderItems.quantity)))
      .limit(8),
    database.select({
      location: sql<string>`COALESCE(NULLIF(jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'county'), ''), 'Unknown')`,
      orders: count(),
    }).from(orders)
      .where(and(orderRange, inArray(orders.status, salesOrderStatuses)))
      .groupBy(sql`location`)
      .orderBy(desc(count()))
      .limit(8),
    database.select({ date: settledDate, revenue: sum(payments.amount) })
      .from(payments)
      .where(and(eq(payments.status, 'succeeded'), paymentRange))
      .groupBy(settledDate)
      .orderBy(settledDate),
  ])

  const [recentOrders] = await Promise.all([database.select({
    orderNumber: orders.orderNumber,
    status: orders.status,
    total: orders.total,
    createdAt: orders.createdAt,
      customerName: sql<string | null>`COALESCE(${users.fullName}, jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'recipientName'))`,
      customerEmail: sql<string | null>`COALESCE(${users.email}, jsonb_extract_path_text(${orders.deliveryAddressSnapshot}::jsonb, 'email'))`,
  }).from(orders).leftJoin(users, eq(orders.userId, users.id))
    .where(orderRange)
    .orderBy(desc(orders.createdAt))
    .limit(8)])

  return {
    period: range.period,
    from: range.from.toISOString().slice(0, 10),
    to: new Date(range.toExclusive.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    totalOrders: Number(orderSummary[0]?.total ?? 0),
    paidRevenue: paidRevenue.toFixed(2),
    paidOrderCount,
    averageOrderValue: paidOrderCount ? (paidRevenue / paidOrderCount).toFixed(2) : '0.00',
    paidPayments: Number(revenueSummary[0]?.paidPayments ?? 0),
    pendingOrders: Number(pendingSummary[0]?.total ?? 0),
    totalCustomers: Number(customerSummary[0]?.total ?? 0),
    newCustomers: Number(customerSummary[0]?.newCustomers ?? 0),
    returningCustomers: Number(returningCustomerSummary?.total ?? 0),
    totalProducts: Number(productSummary[0]?.total ?? 0),
    inventoryUnits: Number(inventorySummary[0]?.units ?? 0),
    lowStockVariants: Number(inventorySummary[0]?.lowStock ?? 0),
    outOfStockVariants: Number(inventorySummary[0]?.outOfStock ?? 0),
    recentOrders,
    bestSellers,
    worstSellers,
    salesByCategory,
    salesByLocation,
    revenueTrend,
  }
}