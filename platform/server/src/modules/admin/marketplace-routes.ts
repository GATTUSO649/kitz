import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { rateLimit } from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import { database } from '../../database/connection.js'
import { marketplaceAdminSessions, marketplaceAdminUsers, marketplaceAuditLogs, marketplaceCategories, marketplaceContactUnlocks, marketplaceCounties, marketplaceEmailEvents, marketplaceNotifications, marketplacePaymentCallbacks, marketplacePayments, marketplaceProductReports, marketplaceProductViews, marketplaceProducts, marketplaceSettings, marketplaceSellerAccounts, marketplaceSellerSessions, marketplaceSellers } from '../../database/schema.js'
import { requireMarketplacePermission, type MarketplaceAdminSession } from './marketplace-auth.js'
import { parseDarajaTimestamp, queryStkPayment } from '../payments/daraja.js'
import { normalizeKenyanPhone } from '../marketplace/security.js'
import { listingExpiryAt, resolveListingExpiryDays } from '../marketplace/expiry.js'
import { parseMarketplaceSocialLinks } from '../marketplace/social-links.js'
import { enqueueMarketplaceEmail } from '../email/outbox.js'
import { getMarketplaceEmailProviderStatus } from '../email/service.js'

export const marketplaceAdminDataRouter = Router()
marketplaceAdminDataRouter.use('/admins', (_request, response) => {
  response.status(410).json({ error: { code: 'CENTRAL_ADMIN_MANAGEMENT_REQUIRED', message: 'Marketplace administrator management is centralized in KitCulture Super Admin.' } })
})
const adminSession = (response: import('express').Response) => response.locals.marketplaceAdmin as MarketplaceAdminSession
const adminEmailSendLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false })
const marketplacePaymentStatus = z.enum(['initiated', 'pending', 'processing', 'ambiguous', 'succeeded', 'failed', 'cancelled', 'expired', 'reversed', 'refunded'])
const marketplacePaymentPurpose = z.enum(['PRODUCT_PUBLICATION', 'CONTACT_UNLOCK'])

function maskMarketplacePhone(phone: string): string {
  if (phone.length < 7) return '••••'
  return `${phone.slice(0, 3)}${'•'.repeat(Math.max(2, phone.length - 6))}${phone.slice(-3)}`
}

marketplaceAdminDataRouter.get('/email-events', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({ status: z.enum(['failed', 'uncertain']).optional() }).safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL_EVENT_FILTER', message: 'Choose a supported email event state.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace email records are temporarily unavailable.' } })
    return
  }
  try {
    const events = await database.select({ id: marketplaceEmailEvents.id, kind: marketplaceEmailEvents.kind, recipientEmail: marketplaceEmailEvents.recipientEmail, status: marketplaceEmailEvents.status, attempts: marketplaceEmailEvents.attempts, lastErrorCode: marketplaceEmailEvents.lastErrorCode, createdAt: marketplaceEmailEvents.createdAt })
      .from(marketplaceEmailEvents).where(parsed.data.status ? eq(marketplaceEmailEvents.status, parsed.data.status) : inArray(marketplaceEmailEvents.status, ['failed', 'uncertain']))
      .orderBy(desc(marketplaceEmailEvents.createdAt)).limit(100)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: events })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/emails', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({
    status: z.enum(['pending', 'sending', 'sent', 'failed', 'uncertain', 'queued']).optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL_QUERY', message: 'Email filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace email records are temporarily unavailable.' } })
    return
  }
  try {
    const conditions = []
    if (parsed.data.status === 'queued') conditions.push(inArray(marketplaceEmailEvents.status, ['pending', 'sending']))
    else if (parsed.data.status === 'failed') conditions.push(inArray(marketplaceEmailEvents.status, ['failed', 'uncertain']))
    else if (parsed.data.status) conditions.push(eq(marketplaceEmailEvents.status, parsed.data.status))
    if (parsed.data.q) {
      const term = `%${parsed.data.q}%`
      conditions.push(or(ilike(marketplaceEmailEvents.recipientEmail, term), ilike(marketplaceEmailEvents.kind, term), ilike(marketplaceEmailEvents.eventKey, term))!)
    }
    const where = conditions.length ? and(...conditions) : undefined
    const [emails, totals, statusCounts, kindCounts] = await Promise.all([
      database.select({
        id: marketplaceEmailEvents.id,
        eventKey: marketplaceEmailEvents.eventKey,
        kind: marketplaceEmailEvents.kind,
        recipientEmail: marketplaceEmailEvents.recipientEmail,
        status: marketplaceEmailEvents.status,
        attempts: marketplaceEmailEvents.attempts,
        nextAttemptAt: marketplaceEmailEvents.nextAttemptAt,
        providerMessageId: marketplaceEmailEvents.providerMessageId,
        lastErrorCode: marketplaceEmailEvents.lastErrorCode,
        createdAt: marketplaceEmailEvents.createdAt,
        sentAt: marketplaceEmailEvents.sentAt,
      }).from(marketplaceEmailEvents).where(where)
        .orderBy(desc(marketplaceEmailEvents.createdAt)).limit(parsed.data.limit).offset((parsed.data.page - 1) * parsed.data.limit),
      database.select({ total: count() }).from(marketplaceEmailEvents).where(where),
      database.select({ status: marketplaceEmailEvents.status, total: count() }).from(marketplaceEmailEvents).groupBy(marketplaceEmailEvents.status),
      database.select({ kind: marketplaceEmailEvents.kind, total: count() }).from(marketplaceEmailEvents).groupBy(marketplaceEmailEvents.kind).orderBy(desc(count())).limit(10),
    ])
    const total = Number(totals[0]?.total ?? 0)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: {
      emails,
      summary: {
        total,
        statuses: statusCounts.map((row) => ({ status: row.status, total: Number(row.total) })),
        frequentKinds: kindCounts.map((row) => ({ kind: row.kind, total: Number(row.total) })),
      },
      provider: getMarketplaceEmailProviderStatus(),
    }, pagination: {
      page: parsed.data.page,
      limit: parsed.data.limit,
      total,
      hasMore: parsed.data.page * parsed.data.limit < total,
    } })
  } catch (error) {
    next(error)
  }
})

const composeEmailSchema = z.object({
  to: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  subject: z.string().trim().min(2).max(180),
  body: z.string().trim().min(2).max(5000),
}).strict()

marketplaceAdminDataRouter.post('/emails/send', adminEmailSendLimiter, requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = composeEmailSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL_MESSAGE', message: 'Enter a valid recipient, subject, and message.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace email delivery is temporarily unavailable.' } })
    return
  }
  const actor = adminSession(response)
  const eventKey = `admin-compose:${randomUUID()}`
  try {
    await database.transaction(async (transaction) => {
      await enqueueMarketplaceEmail(transaction, {
        eventKey,
        to: parsed.data.to,
        kind: 'admin_custom_message',
        data: { subject: parsed.data.subject, body: parsed.data.body },
      })
      await transaction.insert(marketplaceAuditLogs).values({
        adminUserId: actor.id,
        action: 'email.admin_composed',
        resourceType: 'marketplace_email_event',
        metadata: { eventKey, recipientDomain: parsed.data.to.split('@')[1], subjectLength: parsed.data.subject.length },
      })
    })
    response.status(202).json({ data: { eventKey, status: 'pending' } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.post('/emails/test', adminEmailSendLimiter, requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({ subject: z.string().trim().min(2).max(180), body: z.string().trim().min(2).max(5000) }).strict().safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL_TEST', message: 'Enter a valid test subject and message.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace email delivery is temporarily unavailable.' } })
    return
  }
  const actor = adminSession(response)
  const eventKey = `admin-email-test:${randomUUID()}`
  try {
    await database.transaction(async (transaction) => {
      await enqueueMarketplaceEmail(transaction, { eventKey, to: actor.email, kind: 'admin_custom_message', data: parsed.data })
      await transaction.insert(marketplaceAuditLogs).values({
        adminUserId: actor.id,
        action: 'email.admin_test_queued',
        resourceType: 'marketplace_email_event',
        metadata: { eventKey },
      })
    })
    response.status(202).json({ data: { eventKey, status: 'pending' } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.post('/email-events/:id/retry', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id)
  if (!id.success) {
    response.status(400).json({ error: { code: 'INVALID_EMAIL_EVENT_ID', message: 'The email event identifier is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace email records are temporarily unavailable.' } })
    return
  }
  try {
    const recovered = await database.transaction(async (transaction) => {
      const [event] = await transaction.select({ status: marketplaceEmailEvents.status }).from(marketplaceEmailEvents)
        .where(eq(marketplaceEmailEvents.id, id.data)).for('update').limit(1)
      if (!event || event.status !== 'failed') return false
      const [updated] = await transaction.update(marketplaceEmailEvents).set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), lockedAt: null, lastErrorCode: null })
        .where(and(eq(marketplaceEmailEvents.id, id.data), eq(marketplaceEmailEvents.status, 'failed'))).returning({ id: marketplaceEmailEvents.id })
      if (!updated) return false
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: adminSession(response).id, action: 'email.failed_event_requeued', resourceType: 'marketplace_email_event', resourceId: id.data })
      return true
    })
    if (!recovered) {
      response.status(409).json({ error: { code: 'EMAIL_EVENT_NOT_RETRYABLE', message: 'Only definitively failed emails can be requeued. Uncertain outcomes are held to avoid duplicate delivery.' } })
      return
    }
    response.json({ data: { id: id.data, status: 'pending' } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/admins', requireMarketplacePermission('admins:manage'), async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  try {
    const admins = await database.select({ id: marketplaceAdminUsers.id, fullName: marketplaceAdminUsers.fullName, email: marketplaceAdminUsers.email, role: marketplaceAdminUsers.role, active: marketplaceAdminUsers.active, emailVerifiedAt: marketplaceAdminUsers.emailVerifiedAt, createdAt: marketplaceAdminUsers.createdAt })
      .from(marketplaceAdminUsers).orderBy(asc(marketplaceAdminUsers.createdAt))
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: admins })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/admins/:id/status', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(request.body)
  const id = z.string().uuid().safeParse(request.params.id)
  if (!parsed.success || !id.success) {
    response.status(400).json({ error: { code: 'INVALID_MARKETPLACE_ADMIN_STATUS', message: 'The administrator status update is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace administration is temporarily unavailable.' } })
    return
  }
  const actor = adminSession(response)
  try {
    const [target] = await database.select({ role: marketplaceAdminUsers.role }).from(marketplaceAdminUsers).where(eq(marketplaceAdminUsers.id, id.data)).limit(1)
    if (!target) {
      response.status(404).json({ error: { code: 'MARKETPLACE_ADMIN_NOT_FOUND', message: 'The administrator could not be found.' } })
      return
    }
    if (target.role === 'super_admin' || id.data === actor.id) {
      response.status(403).json({ error: { code: 'MARKETPLACE_ADMIN_PROTECTED', message: 'Super Admin access cannot be changed here.' } })
      return
    }
    await database.transaction(async (transaction) => {
      await transaction.update(marketplaceAdminUsers).set({ active: parsed.data.active, updatedAt: new Date() }).where(eq(marketplaceAdminUsers.id, id.data))
      if (!parsed.data.active) await transaction.delete(marketplaceAdminSessions).where(eq(marketplaceAdminSessions.adminUserId, id.data))
      await transaction.insert(marketplaceAuditLogs).values({ adminUserId: actor.id, action: parsed.data.active ? 'admin.activated' : 'admin.suspended', resourceType: 'admin_user', resourceId: id.data })
    })
    response.json({ data: { id: id.data, active: parsed.data.active, sessionsRevoked: !parsed.data.active } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/seller-accounts', requireMarketplacePermission('support:manage'), async (_request, response, next) => {
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller accounts are temporarily unavailable.' } })
    return
  }
  try {
    const accounts = await database.select({
      id: marketplaceSellerAccounts.id,
      email: marketplaceSellerAccounts.email,
      status: marketplaceSellerAccounts.status,
      emailVerifiedAt: marketplaceSellerAccounts.emailVerifiedAt,
      createdAt: marketplaceSellerAccounts.createdAt,
      sellerName: marketplaceSellers.name,
      town: marketplaceSellers.town,
      county: marketplaceCounties.name,
    }).from(marketplaceSellerAccounts)
      .leftJoin(marketplaceSellers, eq(marketplaceSellers.accountId, marketplaceSellerAccounts.id))
      .leftJoin(marketplaceCounties, eq(marketplaceCounties.id, marketplaceSellers.countyId))
      .orderBy(desc(marketplaceSellerAccounts.createdAt)).limit(100)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: accounts })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.patch('/seller-accounts/:id/status', requireMarketplacePermission('support:manage'), async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id)
  const parsed = z.object({ status: z.enum(['active', 'suspended']) }).strict().safeParse(request.body)
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_SELLER_STATUS', message: 'The seller status update is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Seller status is temporarily unavailable.' } })
    return
  }
  const actor = adminSession(response)
  try {
    const [target] = await database.select({ status: marketplaceSellerAccounts.status, emailVerifiedAt: marketplaceSellerAccounts.emailVerifiedAt })
      .from(marketplaceSellerAccounts).where(eq(marketplaceSellerAccounts.id, id.data)).limit(1)
    if (!target) {
      response.status(404).json({ error: { code: 'SELLER_ACCOUNT_NOT_FOUND', message: 'The seller account could not be found.' } })
      return
    }
    if (!target.emailVerifiedAt || target.status === 'pending') {
      response.status(409).json({ error: { code: 'SELLER_EMAIL_UNVERIFIED', message: 'Only email-verified seller accounts can be activated or suspended.' } })
      return
    }
    await database.transaction(async (transaction) => {
      await transaction.update(marketplaceSellerAccounts).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(marketplaceSellerAccounts.id, id.data))
      if (parsed.data.status === 'suspended') await transaction.delete(marketplaceSellerSessions).where(eq(marketplaceSellerSessions.sellerAccountId, id.data))
      await transaction.insert(marketplaceAuditLogs).values({
        adminUserId: actor.id,
        action: parsed.data.status === 'suspended' ? 'seller.account.suspended' : 'seller.account.reactivated',
        resourceType: 'marketplace_seller_account',
        resourceId: id.data,
        metadata: { kitzAdminId: actor.kitzAdminId },
      })
    })
    response.json({ data: { id: id.data, status: parsed.data.status, sessionsRevoked: parsed.data.status === 'suspended' } })
  } catch (error) {
    next(error)
  }
})

const adminPageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() })

marketplaceAdminDataRouter.get('/buyers', requireMarketplacePermission('support:manage'), async (request, response, next) => {
  const parsed = adminPageQuery.safeParse(request.query)
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Buyer date filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace buyer records are temporarily unavailable.' } })
    return
  }
  try {
    const conditions = [eq(marketplacePayments.purpose, 'CONTACT_UNLOCK'), eq(marketplacePayments.status, 'succeeded')]
    if (parsed.data.from) conditions.push(gte(marketplacePayments.verifiedAt, new Date(parsed.data.from)))
    if (parsed.data.to) conditions.push(lte(marketplacePayments.verifiedAt, new Date(parsed.data.to)))
    const rows = await database.select({ phone: marketplacePayments.phone, email: marketplacePayments.customerEmail, lastPaymentAt: sql<Date>`max(${marketplacePayments.verifiedAt})`, unlockCount: count() })
      .from(marketplacePayments).where(and(...conditions))
      .groupBy(marketplacePayments.phone, marketplacePayments.customerEmail)
      .orderBy(desc(sql`max(${marketplacePayments.verifiedAt})`)).limit(50).offset((parsed.data.page - 1) * 50)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: rows.map((row) => ({ ...row, phone: maskMarketplacePhone(row.phone) })), pagination: { page: parsed.data.page, limit: 50 } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/activity', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({ page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Activity pagination is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace activity is temporarily unavailable.' } })
    return
  }
  try {
    const events = await database.select({ id: marketplaceAuditLogs.id, action: marketplaceAuditLogs.action, resourceType: marketplaceAuditLogs.resourceType, resourceId: marketplaceAuditLogs.resourceId, adminEmail: marketplaceAdminUsers.email, createdAt: marketplaceAuditLogs.createdAt })
      .from(marketplaceAuditLogs).leftJoin(marketplaceAdminUsers, eq(marketplaceAdminUsers.id, marketplaceAuditLogs.adminUserId))
      .orderBy(desc(marketplaceAuditLogs.createdAt)).limit(100).offset((parsed.data.page - 1) * 100)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: events, pagination: { page: parsed.data.page, limit: 100 } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/notifications', requireMarketplacePermission('admins:manage'), async (request, response, next) => {
  const parsed = z.object({ page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query)
  if (!parsed.success) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Notification pagination is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace notifications are temporarily unavailable.' } })
    return
  }
  try {
    const rows = await database.select({ id: marketplaceNotifications.id, kind: marketplaceNotifications.kind, status: marketplaceNotifications.status, providerReference: marketplaceNotifications.providerReference, sellerName: marketplaceSellers.name, createdAt: marketplaceNotifications.createdAt, sentAt: marketplaceNotifications.sentAt })
      .from(marketplaceNotifications).leftJoin(marketplaceSellers, eq(marketplaceSellers.id, marketplaceNotifications.sellerId))
      .orderBy(desc(marketplaceNotifications.createdAt)).limit(100).offset((parsed.data.page - 1) * 100)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: rows, pagination: { page: parsed.data.page, limit: 100 } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/revenue', requireMarketplacePermission('finance:read'), async (request, response, next) => {
  const parsed = adminPageQuery.safeParse(request.query)
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Revenue date filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace revenue is temporarily unavailable.' } })
    return
  }
  try {
    const conditions = [eq(marketplacePayments.status, 'succeeded')]
    if (parsed.data.from) conditions.push(gte(marketplacePayments.verifiedAt, new Date(parsed.data.from)))
    if (parsed.data.to) conditions.push(lte(marketplacePayments.verifiedAt, new Date(parsed.data.to)))
    const rows = await database.select({
      day: sql<string>`to_char(date_trunc('day', ${marketplacePayments.verifiedAt} AT TIME ZONE 'Africa/Nairobi'), 'YYYY-MM-DD')`,
      purpose: marketplacePayments.purpose,
      transactionCount: count(),
      revenueKes: sql<string>`coalesce(sum(${marketplacePayments.amountKes}), 0)`,
    }).from(marketplacePayments).where(and(...conditions))
      .groupBy(sql`date_trunc('day', ${marketplacePayments.verifiedAt} AT TIME ZONE 'Africa/Nairobi')`, marketplacePayments.purpose)
      .orderBy(sql`date_trunc('day', ${marketplacePayments.verifiedAt} AT TIME ZONE 'Africa/Nairobi')`)
    response.json({ data: rows.map((row) => ({ ...row, transactionCount: Number(row.transactionCount), revenueKes: Number(row.revenueKes) })) })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/analytics', requireMarketplacePermission('dashboard:read'), async (request, response, next) => {
  const parsed = adminPageQuery.safeParse(request.query)
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Analytics date filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace analytics are temporarily unavailable.' } })
    return
  }
  try {
    const conditions = []
    if (parsed.data.from) conditions.push(gte(marketplaceProductViews.viewedAt, new Date(parsed.data.from)))
    if (parsed.data.to) conditions.push(lte(marketplaceProductViews.viewedAt, new Date(parsed.data.to)))
    const [dailyViews, topListings] = await Promise.all([
      database.select({ day: sql<string>`to_char(date_trunc('day', ${marketplaceProductViews.viewedAt} AT TIME ZONE 'Africa/Nairobi'), 'YYYY-MM-DD')`, views: count() })
        .from(marketplaceProductViews).where(conditions.length ? and(...conditions) : undefined)
        .groupBy(sql`date_trunc('day', ${marketplaceProductViews.viewedAt} AT TIME ZONE 'Africa/Nairobi')`)
        .orderBy(sql`date_trunc('day', ${marketplaceProductViews.viewedAt} AT TIME ZONE 'Africa/Nairobi')`),
      database.select({ reference: marketplaceProducts.reference, title: marketplaceProducts.title, status: marketplaceProducts.status, views: count() })
        .from(marketplaceProductViews).innerJoin(marketplaceProducts, eq(marketplaceProducts.id, marketplaceProductViews.productId))
        .where(conditions.length ? and(...conditions) : undefined).groupBy(marketplaceProducts.id)
        .orderBy(desc(count())).limit(20),
    ])
    response.json({ data: { dailyViews: dailyViews.map((row) => ({ ...row, views: Number(row.views) })), topListings: topListings.map((row) => ({ ...row, views: Number(row.views) })) } })
  } catch (error) {
    next(error)
  }
})

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
    const canReadFinance = admin.permissions.includes('finance:read')
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

marketplaceAdminDataRouter.get('/listings', requireMarketplacePermission('listings:read'), async (request, response, next) => {
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

marketplaceAdminDataRouter.patch('/listings/:reference/status', requireMarketplacePermission(['listings:manage', 'moderation:manage']), async (request, response, next) => {
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
  const query = z.object({
    page: z.coerce.number().int().min(1).default(1),
    status: marketplacePaymentStatus.optional(),
    purpose: marketplacePaymentPurpose.optional(),
    q: z.string().trim().max(120).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    minAmount: z.coerce.number().int().min(0).optional(),
    maxAmount: z.coerce.number().int().min(0).optional(),
  }).safeParse(request.query)
  if (!query.success || (query.data.from && query.data.to && query.data.from > query.data.to)
    || (query.data.minAmount !== undefined && query.data.maxAmount !== undefined && query.data.minAmount > query.data.maxAmount)) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Payment pagination is invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace payments are temporarily unavailable.' } })
    return
  }
  try {
    const conditions = []
    if (query.data.status) conditions.push(eq(marketplacePayments.status, query.data.status))
    if (query.data.purpose) conditions.push(eq(marketplacePayments.purpose, query.data.purpose))
    if (query.data.from) conditions.push(gte(marketplacePayments.createdAt, new Date(query.data.from)))
    if (query.data.to) conditions.push(lte(marketplacePayments.createdAt, new Date(query.data.to)))
    if (query.data.minAmount !== undefined) conditions.push(gte(marketplacePayments.amountKes, query.data.minAmount))
    if (query.data.maxAmount !== undefined) conditions.push(lte(marketplacePayments.amountKes, query.data.maxAmount))
    if (query.data.q) {
      const term = `%${query.data.q}%`
      conditions.push(or(ilike(marketplacePayments.paymentReference, term), ilike(marketplacePayments.providerReceipt, term), ilike(marketplacePayments.phone, term))!)
    }
    const where = conditions.length ? and(...conditions) : undefined
    const [rows, totals] = await Promise.all([
      database.select({
        reference: marketplacePayments.paymentReference,
        transactionId: marketplacePayments.id,
        merchantRequestId: marketplacePayments.merchantRequestId,
        checkoutRequestId: marketplacePayments.checkoutRequestId,
        purpose: marketplacePayments.purpose,
        amountKes: marketplacePayments.amountKes,
        currency: sql<string>`'KES'`,
        phone: marketplacePayments.phone,
        status: marketplacePayments.status,
        createdAt: marketplacePayments.createdAt,
        updatedAt: marketplacePayments.updatedAt,
        stkPushSubmittedAt: marketplacePayments.stkPushSubmittedAt,
        stkPushResponseAt: marketplacePayments.stkPushResponseAt,
        callbackReceivedAt: marketplacePayments.callbackReceivedAt,
        verificationCompletedAt: marketplacePayments.verificationCompletedAt,
        finalizedAt: marketplacePayments.finalizedAt,
        providerResponseCode: marketplacePayments.providerResponseCode,
        providerResponseDescription: marketplacePayments.providerResponseDescription,
        failureCategory: marketplacePayments.failureCategory,
        failureReason: marketplacePayments.failureReason,
        providerReceipt: marketplacePayments.providerReceipt,
        transactionAt: marketplacePayments.transactionAt,
        verifiedAt: marketplacePayments.verifiedAt,
        listingReference: marketplaceProducts.reference,
      }).from(marketplacePayments).leftJoin(marketplaceProducts, eq(marketplacePayments.productId, marketplaceProducts.id))
        .where(where).orderBy(desc(marketplacePayments.createdAt)).limit(50).offset((query.data.page - 1) * 50),
      database.select({ total: count() }).from(marketplacePayments).where(where),
    ])
    response.setHeader('Cache-Control', 'no-store')
    const total = Number(totals[0]?.total ?? 0)
    response.json({ data: rows.map((row) => ({ ...row, phone: maskMarketplacePhone(row.phone) })), pagination: { page: query.data.page, limit: 50, total, hasMore: query.data.page * 50 < total } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/payments/summary', requireMarketplacePermission('finance:read'), async (request, response, next) => {
  const parsed = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }).safeParse(request.query)
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) {
    response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Payment report date filters are invalid.' } })
    return
  }
  if (!database) {
    response.status(503).json({ error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'Marketplace payment reports are temporarily unavailable.' } })
    return
  }
  try {
    const activityConditions = []
    if (parsed.data.from) activityConditions.push(gte(marketplacePayments.createdAt, new Date(parsed.data.from)))
    if (parsed.data.to) activityConditions.push(lte(marketplacePayments.createdAt, new Date(parsed.data.to)))
    const verifiedConditions = [eq(marketplacePayments.status, 'succeeded')]
    if (parsed.data.from) verifiedConditions.push(gte(marketplacePayments.verifiedAt, new Date(parsed.data.from)))
    if (parsed.data.to) verifiedConditions.push(lte(marketplacePayments.verifiedAt, new Date(parsed.data.to)))
    const [states, revenue, totalRows] = await Promise.all([
      database.select({ status: marketplacePayments.status, transactions: count() }).from(marketplacePayments)
        .where(activityConditions.length ? and(...activityConditions) : undefined).groupBy(marketplacePayments.status),
      database.select({ purpose: marketplacePayments.purpose, transactions: count(), revenueKes: sql<string>`coalesce(sum(${marketplacePayments.amountKes}), 0)` })
        .from(marketplacePayments).where(and(...verifiedConditions)).groupBy(marketplacePayments.purpose),
      database.select({ transactions: count() }).from(marketplacePayments)
        .where(activityConditions.length ? and(...activityConditions) : undefined),
    ])
    const confirmedRevenueKes = revenue.reduce((total, row) => total + Number(row.revenueKes), 0)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: {
      transactions: Number(totalRows[0]?.transactions ?? 0),
      states: states.map((row) => ({ status: row.status, transactions: Number(row.transactions) })),
      confirmedRevenueKes,
      revenueByPurpose: revenue.map((row) => ({ purpose: row.purpose, transactions: Number(row.transactions), revenueKes: Number(row.revenueKes) })),
    } })
  } catch (error) {
    next(error)
  }
})

marketplaceAdminDataRouter.get('/payments/:reference', requireMarketplacePermission('finance:read'), async (request, response, next) => {
  const identifier = z.string().min(1).max(64).safeParse(request.params.reference)
  if (!identifier.success || !database) {
    response.status(identifier.success ? 503 : 400).json({ error: { code: identifier.success ? 'MARKETPLACE_UNAVAILABLE' : 'INVALID_PAYMENT_REFERENCE', message: 'Payment details could not be loaded.' } })
    return
  }
  try {
    const [payment] = await database.select({
      id: marketplacePayments.id,
      reference: marketplacePayments.paymentReference,
      merchantRequestId: marketplacePayments.merchantRequestId,
      checkoutRequestId: marketplacePayments.checkoutRequestId,
      purpose: marketplacePayments.purpose,
      amountKes: marketplacePayments.amountKes,
      status: marketplacePayments.status,
      phone: marketplacePayments.phone,
      customerEmail: marketplacePayments.customerEmail,
      providerReceipt: marketplacePayments.providerReceipt,
      transactionAt: marketplacePayments.transactionAt,
      verifiedAt: marketplacePayments.verifiedAt,
      stkPushSubmittedAt: marketplacePayments.stkPushSubmittedAt,
      stkPushResponseAt: marketplacePayments.stkPushResponseAt,
      callbackReceivedAt: marketplacePayments.callbackReceivedAt,
      verificationCompletedAt: marketplacePayments.verificationCompletedAt,
      finalizedAt: marketplacePayments.finalizedAt,
      providerResponseCode: marketplacePayments.providerResponseCode,
      providerResponseDescription: marketplacePayments.providerResponseDescription,
      failureCategory: marketplacePayments.failureCategory,
      failureReason: marketplacePayments.failureReason,
      createdAt: marketplacePayments.createdAt,
      updatedAt: marketplacePayments.updatedAt,
      lastReconciliationAt: marketplacePayments.lastReconciliationAt,
      reconciliationAttempts: marketplacePayments.reconciliationAttempts,
      listingReference: marketplaceProducts.reference,
      listingTitle: marketplaceProducts.title,
    }).from(marketplacePayments).leftJoin(marketplaceProducts, eq(marketplacePayments.productId, marketplaceProducts.id))
      .where(identifier.data.startsWith('MP-') ? eq(marketplacePayments.paymentReference, identifier.data) : eq(marketplacePayments.id, identifier.data)).limit(1)
    if (!payment) {
      response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'The marketplace payment could not be found.' } })
      return
    }
    const [callbacks, reconciliationEvents] = await Promise.all([
      database.select({ outcome: marketplacePaymentCallbacks.outcome, receivedAt: marketplacePaymentCallbacks.receivedAt, processedAt: marketplacePaymentCallbacks.processedAt })
        .from(marketplacePaymentCallbacks).where(eq(marketplacePaymentCallbacks.paymentId, payment.id)).orderBy(asc(marketplacePaymentCallbacks.receivedAt)),
      database.select({ action: marketplaceAuditLogs.action, createdAt: marketplaceAuditLogs.createdAt, metadata: marketplaceAuditLogs.metadata })
        .from(marketplaceAuditLogs).where(and(eq(marketplaceAuditLogs.resourceType, 'marketplace_payment'), eq(marketplaceAuditLogs.resourceId, payment.id))).orderBy(asc(marketplaceAuditLogs.createdAt)),
    ])
    const events = [
      { kind: 'transaction_initiated', at: payment.createdAt },
      ...(payment.stkPushSubmittedAt ? [{ kind: 'stk_push_submitted', at: payment.stkPushSubmittedAt }] : []),
      ...(payment.stkPushResponseAt ? [{ kind: 'stk_push_response_received', at: payment.stkPushResponseAt }] : []),
      ...callbacks.flatMap((callback) => [
        { kind: 'callback_received', at: callback.receivedAt, outcome: callback.outcome },
        ...(callback.processedAt ? [{ kind: 'callback_processed', at: callback.processedAt, outcome: callback.outcome }] : []),
      ]),
      ...(payment.verificationCompletedAt ? [{ kind: 'verification_completed', at: payment.verificationCompletedAt }] : []),
      ...reconciliationEvents.map((event) => ({ kind: event.action, at: event.createdAt, metadata: event.metadata })),
      ...(payment.finalizedAt ? [{ kind: 'final_status_recorded', at: payment.finalizedAt, status: payment.status }] : []),
    ].sort((left, right) => left.at.getTime() - right.at.getTime())
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: {
      ...payment,
      phone: maskMarketplacePhone(payment.phone),
      callbackReceived: callbacks.length > 0,
      reconciliationRequired: ['pending', 'processing', 'ambiguous'].includes(payment.status) && callbacks.length === 0,
      events,
    } })
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
          .where(and(eq(marketplaceAdminUsers.active, true), inArray(marketplaceAdminUsers.role, ['super_admin', 'marketplace_finance_admin'])))
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
