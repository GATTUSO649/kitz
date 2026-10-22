import { compare, hash } from 'bcryptjs'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { db } from '../../config/database.js'
import { auditLogs, customerAddresses, notificationCampaigns, notificationRecipients, orders, productReviews, products, supportMessages, supportRequests, users, userSessions, wishlists } from '../../database/schema.js'
import { authenticate, authenticatedUser } from '../../middleware/authenticate.js'
import { isAdminOnline, publishChatMessage, publishMessageReceipt, registerCustomerStream } from '../../realtime/chat-events.js'

export const accountRouter = Router()
accountRouter.use(authenticate)

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
}).refine((value) => value.fullName !== undefined || value.phone !== undefined)

const addressFields = {
  label: z.string().trim().min(1).max(80),
  recipientName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(5).max(20),
  address: z.string().trim().min(3).max(180),
  county: z.string().trim().min(2).max(80),
  town: z.string().trim().min(2).max(100),
  estate: z.string().trim().max(100).nullable().optional(),
  landmark: z.string().trim().max(180).nullable().optional(),
  instructions: z.string().trim().max(500).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isDefault: z.boolean().optional(),
}
export const createAddressSchema = z.object(addressFields).superRefine((value, context) => {
  if ((value.latitude == null) !== (value.longitude == null)) {
    context.addIssue({ code: 'custom', message: 'Provide both coordinates or neither.', path: ['latitude'] })
  }
})
export const updateAddressSchema = z.object({
  label: addressFields.label.optional(),
  recipientName: addressFields.recipientName.optional(),
  phone: addressFields.phone.optional(),
  address: addressFields.address.optional(),
  county: addressFields.county.optional(),
  town: addressFields.town.optional(),
  estate: addressFields.estate,
  landmark: addressFields.landmark,
  instructions: addressFields.instructions,
  latitude: addressFields.latitude,
  longitude: addressFields.longitude,
  isDefault: addressFields.isDefault,
}).refine((value) => Object.values(value).some((field) => field !== undefined)).superRefine((value, context) => {
  if ((value.latitude === null) !== (value.longitude === null)) {
    context.addIssue({ code: 'custom', message: 'Provide both coordinates or clear both.', path: ['latitude'] })
  }
})
export const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
}).refine((value) => value.currentPassword !== value.newPassword, { path: ['newPassword'], message: 'Choose a password different from your current one.' })
export const supportRequestSchema = z.object({
  category: z.enum(['order', 'payment', 'delivery', 'product', 'account', 'other']),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(2000),
  orderNumber: z.string().trim().min(1).max(32).optional(),
})
export const supportMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  productName: z.string().trim().min(1).max(180).optional(),
  productPrice: z.number().min(0).max(9999999999.99).optional(),
  productImageUrl: z.string().url().max(2000).refine((value) => new URL(value).protocol === 'https:').optional(),
  productUrl: z.string().regex(/^\/(?:account\/marketplace\/)?products\/[a-zA-Z0-9._-]+\/?$/).max(320).optional(),
}).superRefine((value, context) => {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) {
    context.addIssue({ code: 'custom', message: 'Provide both location coordinates or neither.', path: ['latitude'] })
  }
})
const directChatMessageSchema = supportMessageSchema
export const productReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(10).max(2000),
})

function rejectCrossOrigin(request: Parameters<Parameters<typeof accountRouter.patch>[1]>[0], response: Parameters<Parameters<typeof accountRouter.patch>[1]>[1]) {
  if (!isAllowedClientOrigin(request.get('origin'))) {
    response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
    return true
  }
  return false
}

function currentAccount(request: Parameters<Parameters<typeof accountRouter.get>[1]>[0]) {
  return authenticatedUser(request)
}

function unavailable(response: Parameters<Parameters<typeof accountRouter.get>[1]>[1]) {
  response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Account services are not configured.' } })
}

accountRouter.get('/', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [customerOrders, addresses, savedProducts] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.userId, auth.userId)),
    db.select({ count: sql<number>`count(*)` }).from(customerAddresses).where(eq(customerAddresses.userId, auth.userId)),
    db.select({ count: sql<number>`count(*)` }).from(wishlists).where(eq(wishlists.userId, auth.userId)),
  ])
  response.json({ data: {
    user: { id: auth.userId, email: auth.email, fullName: auth.fullName },
    orderCount: Number(customerOrders[0]?.count ?? 0),
    savedAddressCount: Number(addresses[0]?.count ?? 0),
    wishlistCount: Number(savedProducts[0]?.count ?? 0),
  } })
})

accountRouter.get('/profile', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [profile] = await db.select({
    id: users.id,
    email: users.email,
    fullName: users.fullName,
    phone: users.phone,
    emailVerifiedAt: users.emailVerifiedAt,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, auth.userId)).limit(1)
  if (!profile) {
    response.status(404).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found.' } })
    return
  }
  response.json({ data: profile })
})

accountRouter.patch('/profile', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const input = profileSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_PROFILE', message: 'Check the profile details and try again.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const values: { fullName?: string; phone?: string | null } = {}
  if (input.data.fullName !== undefined) values.fullName = input.data.fullName
  if (input.data.phone !== undefined) values.phone = input.data.phone || null
  await db.update(users).set(values).where(eq(users.id, auth.userId))
  response.json({ data: { updated: true } })
})

accountRouter.get('/addresses', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const data = await db.select().from(customerAddresses).where(eq(customerAddresses.userId, auth.userId))
    .orderBy(sql`${customerAddresses.isDefault} desc`, sql`${customerAddresses.createdAt} desc`)
  response.json({ data })
})

accountRouter.post('/addresses', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const input = createAddressSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_ADDRESS', message: 'Check the delivery address details and try again.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const address = await db.transaction(async (transaction) => {
    if (input.data.isDefault) {
      await transaction.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.userId, auth.userId))
    }
    const [{ id }] = await transaction.insert(customerAddresses).values({
      userId: auth.userId,
      label: input.data.label,
      recipientName: input.data.recipientName,
      phone: input.data.phone,
      address: input.data.address,
      county: input.data.county,
      town: input.data.town,
      estate: input.data.estate ?? null,
      landmark: input.data.landmark ?? null,
      instructions: input.data.instructions ?? null,
      latitude: input.data.latitude == null ? null : String(input.data.latitude),
      longitude: input.data.longitude == null ? null : String(input.data.longitude),
      isDefault: input.data.isDefault ?? false,
    }).$returningId()
    const [created] = await transaction.select().from(customerAddresses).where(eq(customerAddresses.id, id)).limit(1)
    return created
  })
  response.status(201).json({ data: address })
})

accountRouter.patch('/addresses/:id', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = updateAddressSchema.safeParse(request.body)
  if (!id.success || !input.success) {
    response.status(400).json({ error: { code: 'INVALID_ADDRESS', message: 'Check the delivery address details and try again.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const updated = await db.transaction(async (transaction) => {
    const [existing] = await transaction.select({ id: customerAddresses.id }).from(customerAddresses)
      .where(and(eq(customerAddresses.id, id.data), eq(customerAddresses.userId, auth.userId))).limit(1)
    if (!existing) return null
    if (input.data.isDefault) {
      await transaction.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.userId, auth.userId))
    }
    const values: Record<string, unknown> = { ...input.data }
    if (input.data.latitude !== undefined) values.latitude = input.data.latitude === null ? null : String(input.data.latitude)
    if (input.data.longitude !== undefined) values.longitude = input.data.longitude === null ? null : String(input.data.longitude)
    const [result] = await transaction.update(customerAddresses).set(values).where(and(
      eq(customerAddresses.id, id.data),
      eq(customerAddresses.userId, auth.userId),
    ))
    return result.affectedRows === 1
  })
  if (!updated) {
    response.status(404).json({ error: { code: 'ADDRESS_NOT_FOUND', message: 'Delivery address not found.' } })
    return
  }
  response.json({ data: { updated: true } })
})

accountRouter.delete('/addresses/:id', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) {
    response.status(404).json({ error: { code: 'ADDRESS_NOT_FOUND', message: 'Delivery address not found.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [deleted] = await db.delete(customerAddresses).where(and(
    eq(customerAddresses.id, id.data),
    eq(customerAddresses.userId, auth.userId),
  ))
  if (deleted.affectedRows !== 1) {
    response.status(404).json({ error: { code: 'ADDRESS_NOT_FOUND', message: 'Delivery address not found.' } })
    return
  }
  response.status(204).end()
})

accountRouter.get('/wishlist', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const data = await db.select({
    id: products.id,
    name: products.name,
    slug: products.slug,
    description: products.description,
    price: products.price,
    imageUrl: products.imageUrl,
    createdAt: wishlists.createdAt,
  }).from(wishlists).innerJoin(products, eq(wishlists.productId, products.id))
    .where(and(eq(wishlists.userId, auth.userId), eq(products.published, true)))
  response.json({ data })
})

accountRouter.get('/notifications/unread-count', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to view notifications.' } })
  const [result] = await db.select({ count: sql<number>`count(*)` }).from(notificationRecipients).where(and(
    eq(notificationRecipients.userId, auth.userId),
    isNull(notificationRecipients.readAt),
  ))
  response.json({ data: { count: Number(result?.count ?? 0) } })
})

accountRouter.get('/notifications', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to view notifications.' } })
  const data = await db.select({
    id: notificationRecipients.id,
    type: notificationCampaigns.type,
    title: notificationCampaigns.title,
    body: notificationCampaigns.body,
    href: notificationCampaigns.href,
    readAt: notificationRecipients.readAt,
    createdAt: notificationRecipients.createdAt,
  }).from(notificationRecipients).innerJoin(notificationCampaigns, eq(notificationRecipients.campaignId, notificationCampaigns.id))
    .where(eq(notificationRecipients.userId, auth.userId))
    .orderBy(sql`${notificationRecipients.createdAt} desc`).limit(100)
  response.json({ data })
})

accountRouter.patch('/notifications/read-all', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to update notifications.' } })
  await db.update(notificationRecipients).set({ readAt: new Date() }).where(and(
    eq(notificationRecipients.userId, auth.userId),
    isNull(notificationRecipients.readAt),
  ))
  response.json({ data: { updated: true } })
})

accountRouter.patch('/notifications/:id/read', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } })
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to update notifications.' } })
  const [notification] = await db.select({ id: notificationRecipients.id }).from(notificationRecipients).where(and(
    eq(notificationRecipients.id, id.data),
    eq(notificationRecipients.userId, auth.userId),
  )).limit(1)
  if (!notification) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } })
  await db.update(notificationRecipients).set({ readAt: new Date() }).where(and(
    eq(notificationRecipients.id, id.data),
    eq(notificationRecipients.userId, auth.userId),
    isNull(notificationRecipients.readAt),
  ))
  response.json({ data: { updated: true } })
})

accountRouter.delete('/notifications/:id', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } })
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to dismiss notifications.' } })
  const deleted = await db.delete(notificationRecipients).where(and(
    eq(notificationRecipients.id, id.data),
    eq(notificationRecipients.userId, auth.userId),
  ))
  if (deleted[0].affectedRows !== 1) return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } })
  response.status(204).end()
})

accountRouter.get('/support', async (request, response) => {
  const auth = currentAccount(request)
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to view support requests.' } })
    return
  }
  const data = await db.select({
    id: supportRequests.id,
    category: supportRequests.category,
    subject: supportRequests.subject,
    message: supportRequests.message,
    status: supportRequests.status,
    adminResponse: supportRequests.adminResponse,
    createdAt: supportRequests.createdAt,
    updatedAt: supportRequests.updatedAt,
    orderNumber: orders.orderNumber,
  }).from(supportRequests).leftJoin(orders, eq(supportRequests.orderId, orders.id))
    .where(eq(supportRequests.userId, auth.userId))
    .orderBy(sql`${supportRequests.updatedAt} desc`)
  response.json({ data })
})

accountRouter.get('/support/events', (request, response) => {
  const auth = currentAccount(request)
  if (!auth) return response.status(401).end()
  response.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  registerCustomerStream(auth.userId, response)
})

accountRouter.get('/support/:id/messages', async (request, response) => {
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  if (!id.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_REQUEST', message: 'Support conversation is invalid.' } })
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to view this conversation.' } })
  const [conversation] = await db.select({ id: supportRequests.id }).from(supportRequests)
    .where(and(eq(supportRequests.id, id.data), eq(supportRequests.userId, auth.userId))).limit(1)
  if (!conversation) return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support conversation not found.' } })
  const unreadMessages = await db.select({ id: supportMessages.id }).from(supportMessages).where(and(
    eq(supportMessages.supportRequestId, id.data),
    eq(supportMessages.senderType, 'admin'),
    isNull(supportMessages.readAt),
  ))
  if (unreadMessages.length) {
    const readAt = new Date()
    await db.update(supportMessages).set({ deliveredAt: readAt, readAt }).where(and(
      eq(supportMessages.supportRequestId, id.data),
      eq(supportMessages.senderType, 'admin'),
      isNull(supportMessages.readAt),
    ))
    publishMessageReceipt({ conversationId: id.data, customerId: auth.userId, senderType: 'admin' })
  }
  const data = await db.select({
    id: supportMessages.id,
    senderType: supportMessages.senderType,
    body: supportMessages.body,
    latitude: supportMessages.latitude,
    longitude: supportMessages.longitude,
    productName: supportMessages.productName,
    productPrice: supportMessages.productPrice,
    productImageUrl: supportMessages.productImageUrl,
    productUrl: supportMessages.productUrl,
    deliveredAt: supportMessages.deliveredAt,
    readAt: supportMessages.readAt,
    createdAt: supportMessages.createdAt,
  }).from(supportMessages).where(eq(supportMessages.supportRequestId, id.data)).orderBy(supportMessages.createdAt)
  response.json({ data })
})

accountRouter.post('/support/:id/messages', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const input = supportMessageSchema.safeParse(request.body)
  if (!id.success || !input.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_MESSAGE', message: 'Enter a message and provide a complete, valid location pin if sharing one.' } })
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to send a message.' } })
  const [conversation] = await db.select({ id: supportRequests.id, status: supportRequests.status }).from(supportRequests)
    .where(and(eq(supportRequests.id, id.data), eq(supportRequests.userId, auth.userId))).limit(1)
  if (!conversation) return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support conversation not found.' } })
  await db.transaction(async (transaction) => {
    await transaction.insert(supportMessages).values({
      supportRequestId: id.data,
      senderType: 'customer',
      body: input.data.body,
      latitude: input.data.latitude === undefined ? null : String(input.data.latitude),
      longitude: input.data.longitude === undefined ? null : String(input.data.longitude),
      productName: input.data.productName ?? null,
      productPrice: input.data.productPrice === undefined ? null : String(input.data.productPrice),
      productImageUrl: input.data.productImageUrl ?? null,
      productUrl: input.data.productUrl ?? null,
      deliveredAt: isAdminOnline() ? new Date() : null,
    })
    await transaction.update(supportRequests).set({
      updatedAt: new Date(),
      ...(conversation.status === 'resolved' || conversation.status === 'closed' ? { status: 'in_progress' as const } : {}),
    }).where(eq(supportRequests.id, id.data))
  })
  publishChatMessage({ conversationId: id.data, customerId: auth.userId, senderType: 'customer' })
  if (isAdminOnline()) publishMessageReceipt({ conversationId: id.data, customerId: auth.userId, senderType: 'customer' })
  response.status(201).json({ data: { sent: true } })
})

accountRouter.delete('/support/:id/messages/:messageId', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const id = z.coerce.number().int().positive().safeParse(request.params.id)
  const messageId = z.coerce.number().int().positive().safeParse(request.params.messageId)
  if (!id.success || !messageId.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_MESSAGE', message: 'Chat message is invalid.' } })
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to delete a message.' } })
  const [conversation] = await db.select({ id: supportRequests.id }).from(supportRequests)
    .where(and(eq(supportRequests.id, id.data), eq(supportRequests.userId, auth.userId))).limit(1)
  if (!conversation) return response.status(404).json({ error: { code: 'SUPPORT_REQUEST_NOT_FOUND', message: 'Support conversation not found.' } })
  const [message] = await db.select({ id: supportMessages.id, senderType: supportMessages.senderType }).from(supportMessages)
    .where(and(eq(supportMessages.id, messageId.data), eq(supportMessages.supportRequestId, id.data))).limit(1)
  if (!message) return response.status(404).json({ error: { code: 'SUPPORT_MESSAGE_NOT_FOUND', message: 'Chat message not found.' } })
  if (message.senderType !== 'customer') return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own messages.' } })
  await db.delete(supportMessages).where(eq(supportMessages.id, message.id))
  await db.update(supportRequests).set({ updatedAt: new Date() }).where(eq(supportRequests.id, id.data))
  publishChatMessage({ conversationId: id.data, customerId: auth.userId, senderType: 'customer' })
  response.json({ data: { deleted: true } })
})

accountRouter.post('/support/chat', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const input = directChatMessageSchema.safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_SUPPORT_MESSAGE', message: 'Enter a message and provide a complete, valid location pin if sharing one.' } })
  if (!db) return unavailable(response)
  if (!auth) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to chat with KitCulture Admin.' } })

  const subject = 'Chat with KitCulture Admin'
  const [existing] = await db.select({ id: supportRequests.id, status: supportRequests.status }).from(supportRequests)
    .where(and(eq(supportRequests.userId, auth.userId), eq(supportRequests.subject, subject)))
    .orderBy(sql`${supportRequests.updatedAt} desc`).limit(1)

  if (existing) {
    await db.transaction(async (transaction) => {
      await transaction.insert(supportMessages).values({
        supportRequestId: existing.id,
        senderType: 'customer',
        body: input.data.body,
        latitude: input.data.latitude === undefined ? null : String(input.data.latitude),
        longitude: input.data.longitude === undefined ? null : String(input.data.longitude),
        productName: input.data.productName ?? null,
        productPrice: input.data.productPrice === undefined ? null : String(input.data.productPrice),
        productImageUrl: input.data.productImageUrl ?? null,
        productUrl: input.data.productUrl ?? null,
        deliveredAt: isAdminOnline() ? new Date() : null,
      })
      await transaction.update(supportRequests).set({
        updatedAt: new Date(),
        ...(existing.status === 'resolved' || existing.status === 'closed' ? { status: 'in_progress' as const } : {}),
      }).where(eq(supportRequests.id, existing.id))
    })
    publishChatMessage({ conversationId: existing.id, customerId: auth.userId, senderType: 'customer' })
    response.status(201).json({ data: { id: existing.id } })
    return
  }

  const [{ id }] = await db.transaction(async (transaction) => {
    const [created] = await transaction.insert(supportRequests).values({
      userId: auth.userId,
      category: 'other',
      subject,
      message: input.data.body,
    }).$returningId()
    await transaction.insert(supportMessages).values({
      supportRequestId: created.id,
      senderType: 'customer',
      body: input.data.body,
      latitude: input.data.latitude === undefined ? null : String(input.data.latitude),
      longitude: input.data.longitude === undefined ? null : String(input.data.longitude),
      productName: input.data.productName ?? null,
      productPrice: input.data.productPrice === undefined ? null : String(input.data.productPrice),
      productImageUrl: input.data.productImageUrl ?? null,
      productUrl: input.data.productUrl ?? null,
      deliveredAt: isAdminOnline() ? new Date() : null,
    })
    await transaction.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'customer.support_chat_started',
      targetType: 'support_request',
      targetId: String(created.id),
    })
    return [created]
  })
  publishChatMessage({ conversationId: id, customerId: auth.userId, senderType: 'customer' })
  if (isAdminOnline()) publishMessageReceipt({ conversationId: id, customerId: auth.userId, senderType: 'customer' })
  response.status(201).json({ data: { id } })
})

accountRouter.post('/support', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const input = supportRequestSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_SUPPORT_REQUEST', message: 'Provide a subject and message so the support team can help.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to submit a support request.' } })
    return
  }
  let orderId: number | null = null
  if (input.data.orderNumber) {
    const [order] = await db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.userId, auth.userId), eq(orders.orderNumber, input.data.orderNumber))).limit(1)
    if (!order) {
      response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'That order could not be found in your account.' } })
      return
    }
    orderId = order.id
  }
  const [{ id }] = await db.transaction(async (transaction) => {
    const [created] = await transaction.insert(supportRequests).values({
      userId: auth.userId,
      orderId,
      category: input.data.category,
      subject: input.data.subject,
      message: input.data.message,
    }).$returningId()
    await transaction.insert(supportMessages).values({
      supportRequestId: created.id,
      senderType: 'customer',
      body: input.data.message,
    })
    await transaction.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'customer.support_request_created',
      targetType: 'support_request',
      targetId: String(created.id),
    })
    return [created]
  })
  response.status(201).json({ data: { id } })
})

accountRouter.post('/wishlist', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const input = z.object({ productId: z.number().int().positive() }).safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_PRODUCT', message: 'Select a valid product.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, input.data.productId), eq(products.published, true))).limit(1)
  if (!product) {
    response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
    return
  }
  await db.insert(wishlists).values({ userId: auth.userId, productId: product.id }).onDuplicateKeyUpdate({ set: { productId: product.id } })
  response.status(201).json({ data: { saved: true } })
})

accountRouter.post('/products/:productId/reviews', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const productId = z.coerce.number().int().positive().safeParse(request.params.productId)
  const input = productReviewSchema.safeParse(request.body)
  if (!productId.success || !input.success) {
    response.status(400).json({ error: { code: 'INVALID_PRODUCT_REVIEW', message: 'Choose a 1 to 5 star rating and write a review of at least 10 characters.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to write a review.' } })
    return
  }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, productId.data), eq(products.published, true))).limit(1)
  if (!product) {
    response.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } })
    return
  }
  await db.insert(productReviews).values({ productId: product.id, userId: auth.userId, ...input.data })
    .onDuplicateKeyUpdate({ set: { ...input.data, updatedAt: new Date() } })
  response.json({ data: { saved: true } })
})

accountRouter.delete('/wishlist/:productId', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const productId = z.coerce.number().int().positive().safeParse(request.params.productId)
  if (!productId.success) {
    response.status(404).json({ error: { code: 'WISHLIST_ITEM_NOT_FOUND', message: 'Saved product not found.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  await db.delete(wishlists).where(and(eq(wishlists.userId, auth.userId), eq(wishlists.productId, productId.data)))
  response.status(204).end()
})

accountRouter.patch('/security/password', async (request, response) => {
  if (rejectCrossOrigin(request, response)) return
  const auth = currentAccount(request)
  const input = passwordSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: { code: 'INVALID_PASSWORD', message: input.error.issues[0]?.message ?? 'Check the password details.' } })
    return
  }
  if (!db) return unavailable(response)
  if (!auth) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
    return
  }
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.userId)).limit(1)
  if (!user || !(await compare(input.data.currentPassword, user.passwordHash))) {
    response.status(400).json({ error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect.' } })
    return
  }
  await db.transaction(async (transaction) => {
    await transaction.update(users).set({ passwordHash: await hash(input.data.newPassword, 12) }).where(eq(users.id, auth.userId))
    await transaction.delete(userSessions).where(eq(userSessions.userId, auth.userId))
    await transaction.insert(auditLogs).values({
      actorUserId: auth.userId,
      action: 'customer.password_changed',
      targetType: 'customer',
      targetId: String(auth.userId),
    })
  })
  response.clearCookie('kc_session', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1',
  })
  response.json({ data: { passwordChanged: true, sessionsRevoked: true } })
})
