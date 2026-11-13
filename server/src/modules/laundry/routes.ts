import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { db } from '../../config/database.js'
import { authenticatedAdmin } from '../../middleware/authenticate.js'
import { laundryBookingEvents, laundryBookings, laundryPaymentEvents, laundryPayments, laundryServiceAreas } from '../../database/schema.js'
import { recordAdminAudit } from '../admin/auth.js'
import { canTransitionLaundryStatus, centsToMoney, laundryPaymentStatus, moneyToCents, wouldOverpay, type LaundryBookingStatus } from './domain.js'

export const publicLaundryRouter = Router()
export const adminLaundryRouter = Router()

class LaundryRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function sendLaundryError(response: Response, error: unknown) {
  if (!(error instanceof LaundryRequestError)) return false
  response.status(error.status).json({ error: { code: error.code, message: error.message } })
  return true
}

function currentAdminId(request: Request) {
  const id = authenticatedAdmin(request)?.id
  if (!id) throw new LaundryRequestError(401, 'UNAUTHENTICATED', 'Administrator sign in is required.')
  return id
}

function parseId(value: string) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits.startsWith('7') || digits.startsWith('1') ? `254${digits}` : digits
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null
}

function paymentShape(input: { amountDue: string; paidAmount: string; pendingCount: number }) {
  const amountDueCents = moneyToCents(input.amountDue)
  const amountPaidCents = moneyToCents(input.paidAmount)
  return {
    amountDue: centsToMoney(amountDueCents),
    amountPaid: centsToMoney(amountPaidCents),
    balance: centsToMoney(Math.max(0, amountDueCents - amountPaidCents)),
    paymentStatus: laundryPaymentStatus({ amountDueCents, amountPaidCents, pendingPayments: Number(input.pendingCount) }),
  }
}

const bookingReference = () => `LAUN-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`
const moneySchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).refine((value) => Number(value) >= 0)
const positiveMoneySchema = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0)
const supportedBookingStatuses = ['new', 'confirmed', 'pickup_scheduled', 'collected', 'washing', 'drying', 'ironing_folding', 'ready_for_delivery', 'out_for_delivery', 'completed', 'cancelled'] as const

const publicBookingSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(20),
  areaId: z.number().int().positive().optional(),
  locationLatitude: z.number().min(-90).max(90).optional(),
  locationLongitude: z.number().min(-180).max(180).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
}).strict().superRefine((value, context) => {
  if ((value.locationLatitude === undefined) !== (value.locationLongitude === undefined)) context.addIssue({ code: 'custom', message: 'A pinned location requires both coordinates.' })
  if (value.areaId !== undefined && value.locationLatitude !== undefined) context.addIssue({ code: 'custom', message: 'Choose a listed area or pin a location, not both.' })
  if (value.areaId === undefined && value.locationLatitude === undefined) context.addIssue({ code: 'custom', message: 'Choose a listed area or pin a location.' })
  if (!normalizePhone(value.phone)) context.addIssue({ code: 'custom', message: 'Enter a valid Kenyan mobile number.' })
})

const publicRequestLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false })

publicLaundryRouter.get('/locations', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Pickup locations are temporarily unavailable.' } })
  const rows = await db.select({ id: laundryServiceAreas.id, name: laundryServiceAreas.name }).from(laundryServiceAreas)
    .where(eq(laundryServiceAreas.active, true)).orderBy(asc(laundryServiceAreas.sortOrder), asc(laundryServiceAreas.name))
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: rows })
})

publicLaundryRouter.post('/bookings', publicRequestLimiter, async (request, response, next) => {
  const input = publicBookingSchema.safeParse({ ...request.body, idempotencyKey: request.get('idempotency-key') ?? request.body?.idempotencyKey })
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_LAUNDRY_BOOKING', message: 'Enter your name, a valid mobile number, and a listed or pinned pickup location.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Booking is temporarily unavailable.' } })
  try {
    const phone = normalizePhone(input.data.phone)!
    const booking = await db.transaction(async (transaction) => {
      if (input.data.idempotencyKey) {
        const [existing] = await transaction.select({ id: laundryBookings.id, reference: laundryBookings.reference, status: laundryBookings.status, createdAt: laundryBookings.createdAt })
          .from(laundryBookings).where(eq(laundryBookings.idempotencyKey, input.data.idempotencyKey)).limit(1)
        if (existing) return existing
      }
      let location = 'Pinned location'
      if (input.data.areaId !== undefined) {
        const [area] = await transaction.select({ name: laundryServiceAreas.name }).from(laundryServiceAreas)
          .where(and(eq(laundryServiceAreas.id, input.data.areaId), eq(laundryServiceAreas.active, true))).limit(1)
        if (!area) throw new LaundryRequestError(400, 'INVALID_PICKUP_AREA', 'Choose an active pickup location from the list.')
        location = area.name
      }
      const [created] = await transaction.insert(laundryBookings).values({
        reference: bookingReference(), idempotencyKey: input.data.idempotencyKey ?? null,
        name: input.data.name, phone, location,
        locationLatitude: input.data.locationLatitude?.toFixed(7) ?? null,
        locationLongitude: input.data.locationLongitude?.toFixed(7) ?? null,
      }).returning({ id: laundryBookings.id, reference: laundryBookings.reference, status: laundryBookings.status, createdAt: laundryBookings.createdAt })
      await transaction.insert(laundryBookingEvents).values({ bookingId: created.id, newStatus: 'new', actorType: 'customer', note: 'Customer booking submitted.' })
      return created
    })
    response.status(201).json({ data: booking })
  } catch (error) {
    if (sendLaundryError(response, error)) return
    next(error)
  }
})

publicLaundryRouter.post('/track', publicRequestLimiter, async (request, response) => {
  const input = z.object({ reference: z.string().trim().min(8).max(40), phone: z.string().trim().min(8).max(20) }).strict().safeParse(request.body)
  if (!input.success || !normalizePhone(input.data.phone)) return response.status(400).json({ error: { code: 'INVALID_TRACKING_REQUEST', message: 'Enter the booking reference and booking phone number.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Booking tracking is temporarily unavailable.' } })
  const [booking] = await db.select({ reference: laundryBookings.reference, status: laundryBookings.status, createdAt: laundryBookings.createdAt })
    .from(laundryBookings).where(and(eq(laundryBookings.reference, input.data.reference.toUpperCase()), eq(laundryBookings.phone, normalizePhone(input.data.phone)!))).limit(1)
  if (!booking) return response.status(404).json({ error: { code: 'BOOKING_NOT_FOUND', message: 'No matching laundry booking was found.' } })
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: booking })
})

const bookingPaidAmount = sql<string>`COALESCE((SELECT SUM(lp.amount) FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} AND lp.status = 'confirmed'), 0)::numeric(12, 2)`
const bookingPendingCount = sql<number>`(SELECT COUNT(*)::integer FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} AND lp.status = 'pending')`

async function adminBookingRows(conditions: Parameters<typeof and>[0][], limit: number, offset: number) {
  if (!db) throw new LaundryRequestError(503, 'LAUNDRY_UNAVAILABLE', 'Laundry booking records are unavailable.')
  return db.select({
    id: laundryBookings.id, reference: laundryBookings.reference, name: laundryBookings.name, phone: laundryBookings.phone,
    location: laundryBookings.location, locationLatitude: laundryBookings.locationLatitude, locationLongitude: laundryBookings.locationLongitude,
    serviceName: laundryBookings.serviceName, quantity: laundryBookings.quantity, quantityUnit: laundryBookings.quantityUnit,
    pickupAddress: laundryBookings.pickupAddress, preferredPickupAt: laundryBookings.preferredPickupAt,
    deliveryAddress: laundryBookings.deliveryAddress, preferredDeliveryAt: laundryBookings.preferredDeliveryAt,
    amountDue: laundryBookings.amountDue, paidAmount: bookingPaidAmount, pendingCount: bookingPendingCount,
    latestPaymentMethod: sql<string | null>`(SELECT lp.method FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} ORDER BY lp.payment_date DESC, lp.id DESC LIMIT 1)`,
    latestPaymentDate: sql<Date | null>`(SELECT lp.payment_date FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} ORDER BY lp.payment_date DESC, lp.id DESC LIMIT 1)`,
    status: laundryBookings.status, createdAt: laundryBookings.createdAt,
  }).from(laundryBookings).where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(laundryBookings.createdAt), desc(laundryBookings.id)).limit(limit).offset(offset)
}

const dateQuery = z.string().date()

adminLaundryRouter.get('/dashboard', async (request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry dashboard is unavailable.' } })
  const parsed = z.object({ from: dateQuery.optional(), to: dateQuery.optional() }).strict().safeParse(request.query)
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) return response.status(400).json({ error: { code: 'INVALID_DATE_RANGE', message: 'Choose a valid date range.' } })
  const rangeFrom = parsed.data.from ? new Date(`${parsed.data.from}T00:00:00.000Z`) : null
  const rangeTo = parsed.data.to ? new Date(`${parsed.data.to}T23:59:59.999Z`) : null
  const collectionFrom = rangeFrom ?? new Date(Date.now() - 29 * 86_400_000)
  const collectionTo = rangeTo ?? new Date()
  const bookingDateFilters = [
    ...(rangeFrom ? [gte(laundryBookings.createdAt, rangeFrom)] : []),
    ...(rangeTo ? [lte(laundryBookings.createdAt, rangeTo)] : []),
  ]
  const paymentDateFilters = [
    ...(rangeFrom ? [gte(laundryPayments.paymentDate, rangeFrom)] : []),
    ...(rangeTo ? [lte(laundryPayments.paymentDate, rangeTo)] : []),
  ]
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const monday = new Date(today)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const [bookingTotals, paymentTotals, collections, bookingRows] = await Promise.all([
    db.select({ total: count(), newRequests: sql<number>`COUNT(*) FILTER (WHERE ${laundryBookings.status} = 'new')`, confirmed: sql<number>`COUNT(*) FILTER (WHERE ${laundryBookings.status} = 'confirmed')`, due: sql<string>`COALESCE(SUM(${laundryBookings.amountDue}), 0)::numeric(14, 2)` }).from(laundryBookings).where(bookingDateFilters.length ? and(...bookingDateFilters) : undefined),
    db.select({ transactions: count(), revenue: sql<string>`COALESCE(SUM(${laundryPayments.amount}) FILTER (WHERE ${laundryPayments.status} = 'confirmed'), 0)::numeric(14, 2)`, pending: sql<number>`COUNT(*) FILTER (WHERE ${laundryPayments.status} = 'pending')`, today: sql<string>`COALESCE(SUM(${laundryPayments.amount}) FILTER (WHERE ${laundryPayments.status} = 'confirmed' AND ${laundryPayments.paymentDate} >= ${today}), 0)::numeric(14, 2)`, week: sql<string>`COALESCE(SUM(${laundryPayments.amount}) FILTER (WHERE ${laundryPayments.status} = 'confirmed' AND ${laundryPayments.paymentDate} >= ${monday}), 0)::numeric(14, 2)`, month: sql<string>`COALESCE(SUM(${laundryPayments.amount}) FILTER (WHERE ${laundryPayments.status} = 'confirmed' AND ${laundryPayments.paymentDate} >= ${monthStart}), 0)::numeric(14, 2)` }).from(laundryPayments).where(paymentDateFilters.length ? and(...paymentDateFilters) : undefined),
    db.select({ date: sql<string>`to_char(${laundryPayments.paymentDate} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, amount: sql<string>`COALESCE(SUM(${laundryPayments.amount}), 0)::numeric(14, 2)` }).from(laundryPayments)
      .where(and(eq(laundryPayments.status, 'confirmed'), gte(laundryPayments.paymentDate, collectionFrom), lte(laundryPayments.paymentDate, collectionTo)))
      .groupBy(sql`to_char(${laundryPayments.paymentDate} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`).orderBy(sql`to_char(${laundryPayments.paymentDate} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`),
    db.select({ amountDue: laundryBookings.amountDue, paidAmount: bookingPaidAmount, pendingCount: bookingPendingCount }).from(laundryBookings).where(bookingDateFilters.length ? and(...bookingDateFilters) : undefined),
  ])
  const finance = bookingRows.reduce((result, row) => {
    const shape = paymentShape({ amountDue: row.amountDue, paidAmount: row.paidAmount, pendingCount: row.pendingCount })
    result.balanceCents += moneyToCents(shape.balance)
    if (shape.paymentStatus === 'PAID') result.paidBookings += 1
    else if (shape.paymentStatus === 'UNPAID') result.unpaidBookings += 1
    else result.pendingBookings += 1
    return result
  }, { balanceCents: 0, paidBookings: 0, unpaidBookings: 0, pendingBookings: 0 })
  response.json({ data: {
    totalBookings: Number(bookingTotals[0]?.total ?? 0), newRequests: Number(bookingTotals[0]?.newRequests ?? 0), confirmedBookings: Number(bookingTotals[0]?.confirmed ?? 0),
    totalRevenueReceived: paymentTotals[0]?.revenue ?? '0.00', totalAmountDue: bookingTotals[0]?.due ?? '0.00', totalOutstandingBalance: centsToMoney(finance.balanceCents),
    paidBookings: finance.paidBookings, unpaidBookings: finance.unpaidBookings, pendingPayments: Number(paymentTotals[0]?.pending ?? 0) + finance.pendingBookings,
    totalTransactions: Number(paymentTotals[0]?.transactions ?? 0), paymentsReceivedToday: paymentTotals[0]?.today ?? '0.00', paymentsReceivedThisWeek: paymentTotals[0]?.week ?? '0.00', paymentsReceivedThisMonth: paymentTotals[0]?.month ?? '0.00',
    collections: collections.map((row) => ({ date: row.date, amount: row.amount })),
  } })
})

adminLaundryRouter.get('/bookings', async (request, response) => {
  const query = z.object({ search: z.string().trim().max(120).optional(), status: z.enum(supportedBookingStatuses).optional(), from: dateQuery.optional(), to: dateQuery.optional(), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().safeParse(request.query)
  if (!query.success || (query.data.from && query.data.to && query.data.from > query.data.to)) return response.status(400).json({ error: { code: 'INVALID_BOOKING_QUERY', message: 'Check the booking search and filters.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry bookings are unavailable.' } })
  const filters = []
  if (query.data.status) filters.push(eq(laundryBookings.status, query.data.status))
  if (query.data.from) filters.push(gte(laundryBookings.createdAt, new Date(`${query.data.from}T00:00:00.000Z`)))
  if (query.data.to) filters.push(lte(laundryBookings.createdAt, new Date(`${query.data.to}T23:59:59.999Z`)))
  if (query.data.search) filters.push(or(ilike(laundryBookings.reference, `%${query.data.search}%`), ilike(laundryBookings.name, `%${query.data.search}%`), ilike(laundryBookings.phone, `%${query.data.search}%`))!)
  const [rows, totals] = await Promise.all([
    adminBookingRows(filters, query.data.limit, (query.data.page - 1) * query.data.limit),
    db.select({ total: count() }).from(laundryBookings).where(filters.length ? and(...filters) : undefined),
  ])
  response.json({ data: rows.map((row) => ({ ...row, ...paymentShape({ amountDue: row.amountDue, paidAmount: row.paidAmount, pendingCount: row.pendingCount }) })), pagination: { page: query.data.page, limit: query.data.limit, total: Number(totals[0]?.total ?? 0) } })
})

const operationalQueues: Record<'pickups' | 'processing' | 'deliveries', readonly LaundryBookingStatus[]> = {
  pickups: ['new', 'confirmed', 'pickup_scheduled', 'collected'],
  processing: ['new', 'confirmed', 'pickup_scheduled', 'collected', 'washing', 'drying', 'ironing_folding', 'ready_for_delivery', 'out_for_delivery', 'completed', 'cancelled'],
  deliveries: ['ready_for_delivery', 'out_for_delivery', 'completed'],
}

for (const [queue, statuses] of Object.entries(operationalQueues) as [keyof typeof operationalQueues, readonly LaundryBookingStatus[]][]) {
  adminLaundryRouter.get(`/${queue}`, async (request, response) => {
    const query = z.object({ search: z.string().trim().max(120).optional(), from: dateQuery.optional(), to: dateQuery.optional(), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(request.query)
    if (!query.success || (query.data.from && query.data.to && query.data.from > query.data.to)) return response.status(400).json({ error: { code: 'INVALID_LAUNDRY_QUEUE_QUERY', message: 'Check the search and date filters.' } })
    if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry operations are unavailable.' } })
    const filters = [inArray(laundryBookings.status, [...statuses])]
    if (query.data.search) filters.push(or(ilike(laundryBookings.reference, `%${query.data.search}%`), ilike(laundryBookings.name, `%${query.data.search}%`), ilike(laundryBookings.phone, `%${query.data.search}%`))!)
    const scheduledAt = queue === 'pickups' ? laundryBookings.preferredPickupAt : queue === 'deliveries' ? laundryBookings.preferredDeliveryAt : laundryBookings.createdAt
    if (query.data.from) filters.push(gte(scheduledAt, new Date(`${query.data.from}T00:00:00.000Z`)))
    if (query.data.to) filters.push(lte(scheduledAt, new Date(`${query.data.to}T23:59:59.999Z`)))
    const [rows, totals] = await Promise.all([
      adminBookingRows(filters, query.data.limit, (query.data.page - 1) * query.data.limit),
      db.select({ total: count() }).from(laundryBookings).where(and(...filters)),
    ])
    response.json({ data: rows.map((row) => ({ ...row, ...paymentShape({ amountDue: row.amountDue, paidAmount: row.paidAmount, pendingCount: row.pendingCount }) })), pagination: { page: query.data.page, limit: query.data.limit, total: Number(totals[0]?.total ?? 0) } })
  })
}

adminLaundryRouter.get('/customers', async (request, response) => {
  const query = z.object({ search: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: { code: 'INVALID_CUSTOMER_QUERY', message: 'Check the customer search.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry customer records are unavailable.' } })
  const search = query.data.search ? `%${query.data.search}%` : null
  const customerFilter = search ? or(
    ilike(laundryBookings.phone, search),
    sql`(array_agg(${laundryBookings.name} ORDER BY ${laundryBookings.createdAt} DESC))[1] ILIKE ${search}`,
  ) : undefined
  const groups = db.select({ phone: laundryBookings.phone }).from(laundryBookings).groupBy(laundryBookings.phone).having(customerFilter).as('laundry_customers')
  const [customers, totals] = await Promise.all([
    db.select({
      name: sql<string>`(array_agg(${laundryBookings.name} ORDER BY ${laundryBookings.createdAt} DESC))[1]`,
      phone: laundryBookings.phone,
      totalBookings: count(),
      completedBookings: sql<number>`COUNT(*) FILTER (WHERE ${laundryBookings.status} = 'completed')`,
      amountDue: sql<string>`COALESCE(SUM(${laundryBookings.amountDue}), 0)::numeric(14, 2)`,
      amountPaid: sql<string>`COALESCE(SUM(${bookingPaidAmount}), 0)::numeric(14, 2)`,
      lastBookingAt: sql<Date>`MAX(${laundryBookings.createdAt})`,
    }).from(laundryBookings).groupBy(laundryBookings.phone).having(customerFilter).orderBy(desc(sql`MAX(${laundryBookings.createdAt})`)).limit(query.data.limit).offset((query.data.page - 1) * query.data.limit),
    db.select({ total: count() }).from(groups),
  ])
  const data = customers.map((customer) => ({
    ...customer,
    balance: centsToMoney(Math.max(0, moneyToCents(customer.amountDue) - moneyToCents(customer.amountPaid))),
  }))
  response.json({ data, pagination: { page: query.data.page, limit: query.data.limit, total: Number(totals[0]?.total ?? 0) } })
})

adminLaundryRouter.get('/customers/:phone/bookings', async (request, response) => {
  const phone = normalizePhone(request.params.phone)
  if (!phone) return response.status(400).json({ error: { code: 'INVALID_CUSTOMER_PHONE', message: 'Customer phone number is invalid.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry customer records are unavailable.' } })
  const rows = await adminBookingRows([eq(laundryBookings.phone, phone)], 100, 0)
  response.json({ data: rows.map((row) => ({ ...row, ...paymentShape({ amountDue: row.amountDue, paidAmount: row.paidAmount, pendingCount: row.pendingCount }) })) })
})

adminLaundryRouter.get('/bookings/:id', async (request, response) => {
  const id = parseId(request.params.id)
  if (!id || !db) return response.status(id ? 503 : 400).json({ error: { code: id ? 'LAUNDRY_UNAVAILABLE' : 'INVALID_BOOKING_ID', message: id ? 'Laundry booking is unavailable.' : 'Booking reference is invalid.' } })
  const [booking] = await adminBookingRows([eq(laundryBookings.id, id)], 1, 0)
  if (!booking) return response.status(404).json({ error: { code: 'BOOKING_NOT_FOUND', message: 'Laundry booking was not found.' } })
  const [events, payments] = await Promise.all([
    db.select().from(laundryBookingEvents).where(eq(laundryBookingEvents.bookingId, id)).orderBy(desc(laundryBookingEvents.createdAt)),
    db.select().from(laundryPayments).where(eq(laundryPayments.bookingId, id)).orderBy(desc(laundryPayments.paymentDate), desc(laundryPayments.id)),
  ])
  response.json({ data: { ...booking, ...paymentShape({ amountDue: booking.amountDue, paidAmount: booking.paidAmount, pendingCount: booking.pendingCount }), events, payments } })
})

const bookingUpdateSchema = z.object({
  status: z.enum(supportedBookingStatuses).optional(),
  amountDue: moneySchema.optional(),
  serviceName: z.string().trim().min(1).max(120).nullable().optional(),
  quantity: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).nullable().optional(),
  quantityUnit: z.string().trim().min(1).max(24).nullable().optional(),
  pickupAddress: z.string().trim().max(500).nullable().optional(),
  preferredPickupAt: z.string().datetime().nullable().optional(),
  deliveryAddress: z.string().trim().max(500).nullable().optional(),
  preferredDeliveryAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(500).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'note'))

async function updateLaundryBooking(request: Request, response: Response, next: NextFunction) {
  const rawId = request.params.id
  const id = parseId(Array.isArray(rawId) ? rawId[0] : rawId)
  const input = bookingUpdateSchema.safeParse(request.body)
  if (!id || !input.success) return response.status(400).json({ error: { code: 'INVALID_BOOKING_UPDATE', message: 'Check the booking update details.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry bookings are unavailable.' } })
  try {
    const adminId = currentAdminId(request)
    const updated = await db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(laundryBookings).where(eq(laundryBookings.id, id)).for('update').limit(1)
      if (!existing) throw new LaundryRequestError(404, 'BOOKING_NOT_FOUND', 'Laundry booking was not found.')
      if (input.data.status && !canTransitionLaundryStatus(existing.status as LaundryBookingStatus, input.data.status)) throw new LaundryRequestError(409, 'INVALID_BOOKING_TRANSITION', `A booking cannot move from ${existing.status} to ${input.data.status}.`)
      const confirmedRows = await transaction.select({ amount: laundryPayments.amount }).from(laundryPayments).where(and(eq(laundryPayments.bookingId, id), eq(laundryPayments.status, 'confirmed')))
      const confirmedCents = confirmedRows.reduce((total, row) => total + moneyToCents(row.amount), 0)
      const newDueCents = input.data.amountDue === undefined ? moneyToCents(existing.amountDue) : moneyToCents(input.data.amountDue)
      if (confirmedCents > newDueCents) throw new LaundryRequestError(409, 'AMOUNT_DUE_BELOW_PAID', 'Total amount due cannot be less than confirmed payments received.')
      const values = {
        ...(input.data.status ? { status: input.data.status } : {}),
        ...(input.data.amountDue !== undefined ? { amountDue: input.data.amountDue } : {}),
        ...(input.data.serviceName !== undefined ? { serviceName: input.data.serviceName } : {}),
        ...(input.data.quantity !== undefined ? { quantity: input.data.quantity } : {}),
        ...(input.data.quantityUnit !== undefined ? { quantityUnit: input.data.quantityUnit } : {}),
        ...(input.data.pickupAddress !== undefined ? { pickupAddress: input.data.pickupAddress } : {}),
        ...(input.data.preferredPickupAt !== undefined ? { preferredPickupAt: input.data.preferredPickupAt ? new Date(input.data.preferredPickupAt) : null } : {}),
        ...(input.data.deliveryAddress !== undefined ? { deliveryAddress: input.data.deliveryAddress } : {}),
        ...(input.data.preferredDeliveryAt !== undefined ? { preferredDeliveryAt: input.data.preferredDeliveryAt ? new Date(input.data.preferredDeliveryAt) : null } : {}),
        updatedAt: new Date(),
      }
      const [saved] = await transaction.update(laundryBookings).set(values).where(eq(laundryBookings.id, id)).returning({ id: laundryBookings.id, reference: laundryBookings.reference, status: laundryBookings.status, amountDue: laundryBookings.amountDue })
      if (input.data.status && input.data.status !== existing.status) await transaction.insert(laundryBookingEvents).values({ bookingId: id, previousStatus: existing.status, newStatus: input.data.status, actorType: 'admin', actorAdminUserId: adminId, note: input.data.note ?? null })
      return saved
    })
    await recordAdminAudit(adminId, input.data.status ? `laundry.booking.${input.data.status}` : 'laundry.booking.updated', 'laundry_booking', String(id))
    response.json({ data: updated })
  } catch (error) {
    if (sendLaundryError(response, error)) return
    next(error)
  }
}

adminLaundryRouter.patch(['/bookings/:id', '/pickups/:id', '/processing/:id', '/deliveries/:id'], updateLaundryBooking)

const paymentSchema = z.object({
  amount: positiveMoneySchema,
  method: z.enum(['cash', 'mpesa', 'bank_transfer', 'other']),
  paymentDate: z.string().datetime().or(dateQuery),
  transactionReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['pending', 'confirmed']),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
}).strict()

adminLaundryRouter.get('/payments', async (request, response) => {
  const query = z.object({ search: z.string().trim().max(120).optional(), status: z.enum(['PAID', 'UNPAID', 'PENDING']).optional(), method: z.enum(['cash', 'mpesa', 'bank_transfer', 'other']).optional(), from: dateQuery.optional(), to: dateQuery.optional(), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict().safeParse(request.query)
  if (!query.success || (query.data.from && query.data.to && query.data.from > query.data.to)) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_QUERY', message: 'Check the payment search and filters.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry payment records are unavailable.' } })
  const filters = []
  if (query.data.search) filters.push(or(ilike(laundryBookings.reference, `%${query.data.search}%`), ilike(laundryBookings.name, `%${query.data.search}%`), ilike(laundryBookings.phone, `%${query.data.search}%`))!)
  if (query.data.method) filters.push(sql`EXISTS (SELECT 1 FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} AND lp.method = ${query.data.method})`)
  if (query.data.from) filters.push(sql`EXISTS (SELECT 1 FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} AND lp.payment_date >= ${new Date(`${query.data.from}T00:00:00.000Z`)})`)
  if (query.data.to) filters.push(sql`EXISTS (SELECT 1 FROM laundry_payments lp WHERE lp.booking_id = ${laundryBookings.id} AND lp.payment_date <= ${new Date(`${query.data.to}T23:59:59.999Z`)})`)
  if (query.data.status === 'PAID') filters.push(sql`${laundryBookings.amountDue} > 0 AND ${bookingPaidAmount} >= ${laundryBookings.amountDue} AND ${bookingPendingCount} = 0`)
  if (query.data.status === 'PENDING') filters.push(sql`${bookingPendingCount} > 0 OR (${bookingPaidAmount} > 0 AND ${bookingPaidAmount} < ${laundryBookings.amountDue})`)
  if (query.data.status === 'UNPAID') filters.push(sql`${bookingPaidAmount} = 0 AND ${bookingPendingCount} = 0`)
  const rows = await adminBookingRows(filters, query.data.limit, (query.data.page - 1) * query.data.limit)
  const filtered = rows.map((row) => ({ ...row, ...paymentShape({ amountDue: row.amountDue, paidAmount: row.paidAmount, pendingCount: row.pendingCount }) }))
  const [totals] = await db.select({ total: count() }).from(laundryBookings).where(filters.length ? and(...filters) : undefined)
  response.json({ data: filtered, pagination: { page: query.data.page, limit: query.data.limit, total: Number(totals?.total ?? 0) } })
})

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

adminLaundryRouter.get('/payments/export.csv', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry payment records are unavailable.' } })
  const rows = await adminBookingRows([], 5000, 0)
  const header = ['Booking Reference', 'Customer', 'Phone', 'Amount Due', 'Amount Paid', 'Balance', 'Payment Status', 'Location', 'Booking Created']
  const body = rows.map((row) => {
    const financial = paymentShape({ amountDue: row.amountDue, paidAmount: row.paidAmount, pendingCount: row.pendingCount })
    return [row.reference, row.name, row.phone, financial.amountDue, financial.amountPaid, financial.balance, financial.paymentStatus, row.location, row.createdAt.toISOString()].map(csvCell).join(',')
  })
  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', 'attachment; filename="laundry-payments.csv"')
  response.send([header.map(csvCell).join(','), ...body].join('\r\n'))
})

adminLaundryRouter.get('/payments/:id/events', async (request, response) => {
  const id = parseId(request.params.id)
  if (!id || !db) return response.status(id ? 503 : 400).json({ error: { code: id ? 'LAUNDRY_UNAVAILABLE' : 'INVALID_PAYMENT_ID', message: 'Payment history is unavailable.' } })
  response.json({ data: await db.select().from(laundryPaymentEvents).where(eq(laundryPaymentEvents.paymentId, id)).orderBy(desc(laundryPaymentEvents.createdAt)) })
})

adminLaundryRouter.post('/bookings/:id/payments', async (request, response, next) => {
  const bookingId = parseId(request.params.id)
  const input = paymentSchema.safeParse({ ...request.body, idempotencyKey: request.get('idempotency-key') ?? request.body?.idempotencyKey })
  if (!bookingId || !input.success) return response.status(400).json({ error: { code: 'INVALID_LAUNDRY_PAYMENT', message: 'Enter a positive amount, method, payment date, and status.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry payment records are unavailable.' } })
  try {
    const adminId = currentAdminId(request)
    const payment = await db.transaction(async (transaction) => {
      if (input.data.idempotencyKey) {
        const [existing] = await transaction.select().from(laundryPayments).where(eq(laundryPayments.idempotencyKey, input.data.idempotencyKey)).limit(1)
        if (existing) return existing
      }
      const [booking] = await transaction.select({ id: laundryBookings.id, amountDue: laundryBookings.amountDue }).from(laundryBookings)
        .where(eq(laundryBookings.id, bookingId)).for('update').limit(1)
      if (!booking) throw new LaundryRequestError(404, 'BOOKING_NOT_FOUND', 'Laundry booking was not found.')
      if (input.data.status === 'confirmed') {
        const existingRows = await transaction.select({ amount: laundryPayments.amount }).from(laundryPayments).where(and(eq(laundryPayments.bookingId, bookingId), eq(laundryPayments.status, 'confirmed')))
        const confirmed = existingRows.reduce((total, row) => total + moneyToCents(row.amount), 0)
        if (wouldOverpay(moneyToCents(booking.amountDue), confirmed, moneyToCents(input.data.amount))) throw new LaundryRequestError(409, 'PAYMENT_EXCEEDS_BALANCE', 'Confirmed payments cannot exceed the booking amount due. Set or correct the amount due first.')
      }
      const [created] = await transaction.insert(laundryPayments).values({
        bookingId, idempotencyKey: input.data.idempotencyKey ?? null, amount: input.data.amount, method: input.data.method,
        paymentDate: new Date(input.data.paymentDate.length === 10 ? `${input.data.paymentDate}T00:00:00.000Z` : input.data.paymentDate),
        transactionReference: input.data.transactionReference || null, notes: input.data.notes || null,
        status: input.data.status, recordedByAdminId: adminId,
      }).returning()
      await transaction.insert(laundryPaymentEvents).values({ paymentId: created.id, bookingId, actorAdminUserId: adminId, eventType: 'recorded', before: null, after: created })
      return created
    })
    await recordAdminAudit(adminId, 'laundry.payment.recorded', 'laundry_payment', String(payment.id))
    response.status(201).json({ data: payment })
  } catch (error) {
    if (sendLaundryError(response, error)) return
    next(error)
  }
})

const paymentUpdateSchema = z.object({
  amount: positiveMoneySchema.optional(), method: z.enum(['cash', 'mpesa', 'bank_transfer', 'other']).optional(),
  paymentDate: z.string().datetime().or(dateQuery).optional(), transactionReference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(), status: z.enum(['pending', 'confirmed', 'reversed']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

adminLaundryRouter.patch('/payments/:id', async (request, response, next) => {
  const paymentId = parseId(request.params.id)
  const input = paymentUpdateSchema.safeParse(request.body)
  if (!paymentId || !input.success) return response.status(400).json({ error: { code: 'INVALID_PAYMENT_UPDATE', message: 'Check the payment correction details.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Laundry payment records are unavailable.' } })
  try {
    const adminId = currentAdminId(request)
    const updated = await db.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(laundryPayments).where(eq(laundryPayments.id, paymentId)).for('update').limit(1)
      if (!existing) throw new LaundryRequestError(404, 'PAYMENT_NOT_FOUND', 'Laundry payment was not found.')
      if (existing.status === 'reversed' && input.data.status && input.data.status !== 'reversed') throw new LaundryRequestError(409, 'PAYMENT_REVERSED', 'A reversed payment cannot be reactivated. Record a new payment instead.')
      const [booking] = await transaction.select({ amountDue: laundryBookings.amountDue }).from(laundryBookings).where(eq(laundryBookings.id, existing.bookingId)).for('update').limit(1)
      if (!booking) throw new LaundryRequestError(404, 'BOOKING_NOT_FOUND', 'Laundry booking was not found.')
      const nextStatus = input.data.status ?? existing.status
      const nextAmount = input.data.amount ?? existing.amount
      if (nextStatus === 'confirmed') {
        const otherRows = await transaction.select({ amount: laundryPayments.amount }).from(laundryPayments)
          .where(and(eq(laundryPayments.bookingId, existing.bookingId), eq(laundryPayments.status, 'confirmed'), sql`${laundryPayments.id} <> ${paymentId}`))
        const confirmed = otherRows.reduce((total, row) => total + moneyToCents(row.amount), 0)
        if (wouldOverpay(moneyToCents(booking.amountDue), confirmed, moneyToCents(nextAmount))) throw new LaundryRequestError(409, 'PAYMENT_EXCEEDS_BALANCE', 'Confirmed payments cannot exceed the booking amount due.')
      }
      const before = { amount: existing.amount, method: existing.method, paymentDate: existing.paymentDate, transactionReference: existing.transactionReference, notes: existing.notes, status: existing.status }
      const values = {
        ...(input.data.amount !== undefined ? { amount: input.data.amount } : {}),
        ...(input.data.method !== undefined ? { method: input.data.method } : {}),
        ...(input.data.paymentDate !== undefined ? { paymentDate: new Date(input.data.paymentDate.length === 10 ? `${input.data.paymentDate}T00:00:00.000Z` : input.data.paymentDate) } : {}),
        ...(input.data.transactionReference !== undefined ? { transactionReference: input.data.transactionReference || null } : {}),
        ...(input.data.notes !== undefined ? { notes: input.data.notes || null } : {}),
        ...(input.data.status !== undefined ? { status: input.data.status } : {}),
        updatedAt: new Date(),
      }
      const [saved] = await transaction.update(laundryPayments).set(values).where(eq(laundryPayments.id, paymentId)).returning()
      const eventType = input.data.status === 'reversed' ? 'reversed' : input.data.status && input.data.status !== existing.status ? 'status_changed' : 'updated'
      await transaction.insert(laundryPaymentEvents).values({ paymentId, bookingId: existing.bookingId, actorAdminUserId: adminId, eventType, before, after: saved })
      return saved
    })
    await recordAdminAudit(adminId, 'laundry.payment.corrected', 'laundry_payment', String(paymentId))
    response.json({ data: updated })
  } catch (error) {
    if (sendLaundryError(response, error)) return
    next(error)
  }
})

adminLaundryRouter.get('/locations', async (_request, response) => {
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Pickup locations are unavailable.' } })
  response.json({ data: await db.select().from(laundryServiceAreas).orderBy(asc(laundryServiceAreas.sortOrder), asc(laundryServiceAreas.name)) })
})

adminLaundryRouter.put('/locations', async (request, response, next) => {
  const input = z.object({ locations: z.array(z.string().trim().min(2).max(160)).max(100) }).strict().safeParse(request.body)
  if (!input.success || new Set(input.data.locations.map((name) => name.toLowerCase())).size !== input.data.locations.length) return response.status(400).json({ error: { code: 'INVALID_PICKUP_LOCATIONS', message: 'Pickup locations must be unique names.' } })
  if (!db) return response.status(503).json({ error: { code: 'LAUNDRY_UNAVAILABLE', message: 'Pickup locations are unavailable.' } })
  try {
    const adminId = currentAdminId(request)
    await db.transaction(async (transaction) => {
      await transaction.update(laundryServiceAreas).set({ active: false, updatedAt: new Date() })
      for (const [sortOrder, name] of input.data.locations.entries()) {
        await transaction.insert(laundryServiceAreas).values({ name, sortOrder, active: true, createdByAdminId: adminId })
          .onConflictDoUpdate({ target: laundryServiceAreas.name, set: { active: true, sortOrder, updatedAt: new Date() } })
      }
    })
    await recordAdminAudit(adminId, 'laundry.locations.updated', 'laundry_service_areas', 'active')
    response.json({ data: await db.select().from(laundryServiceAreas).orderBy(asc(laundryServiceAreas.sortOrder), asc(laundryServiceAreas.name)) })
  } catch (error) {
    next(error)
  }
})