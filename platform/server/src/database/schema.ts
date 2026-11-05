import { bigint, boolean, check, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid, varchar, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const marketplaceSchema = pgSchema('marketplace')
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const marketplaceCategories = marketplaceSchema.table('marketplace_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 120 }).notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => marketplaceCategories.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...{ createdAt: createdAt(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() },
}, (table) => [uniqueIndex('marketplace_categories_slug_uq').on(table.slug), index('marketplace_categories_parent_idx').on(table.parentId, table.sortOrder)])

export const marketplaceSubcategories = marketplaceSchema.table('marketplace_subcategories', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id').notNull().references(() => marketplaceCategories.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 120 }).notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('marketplace_subcategories_slug_uq').on(table.slug), index('marketplace_subcategories_category_idx').on(table.categoryId, table.sortOrder)])

export const marketplaceCounties = marketplaceSchema.table('marketplace_counties', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 3 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  active: boolean('active').notNull().default(true),
}, (table) => [uniqueIndex('marketplace_counties_code_uq').on(table.code), uniqueIndex('marketplace_counties_name_uq').on(table.name)])

export const marketplaceSellers = marketplaceSchema.table('marketplace_sellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 16 }).notNull(),
  whatsapp: varchar('whatsapp', { length: 16 }),
  email: varchar('email', { length: 254 }),
  countyId: uuid('county_id').notNull().references(() => marketplaceCounties.id, { onDelete: 'restrict' }),
  subcounty: varchar('subcounty', { length: 100 }).notNull(),
  town: varchar('town', { length: 100 }).notNull(),
  area: varchar('area', { length: 120 }),
  createdAt: createdAt(),
}, (table) => [index('marketplace_sellers_county_idx').on(table.countyId), index('marketplace_sellers_subcounty_town_idx').on(table.subcounty, table.town)])

export const marketplaceProducts = marketplaceSchema.table('marketplace_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: varchar('reference', { length: 24 }).notNull(),
  slug: varchar('slug', { length: 180 }).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  description: text('description').notNull(),
  categoryId: uuid('category_id').notNull().references(() => marketplaceCategories.id, { onDelete: 'restrict' }),
  subcategoryId: uuid('subcategory_id').references(() => marketplaceSubcategories.id, { onDelete: 'set null' }),
  sellerId: uuid('seller_id').notNull().references(() => marketplaceSellers.id, { onDelete: 'restrict' }),
  condition: varchar('condition', { length: 20 }).notNull(),
  priceKes: bigint('price_kes', { mode: 'number' }).notNull(),
  negotiable: boolean('negotiable').notNull().default(false),
  status: varchar('status', { length: 24 }).notNull().default('pending_payment'),
  featured: boolean('featured').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('marketplace_products_reference_uq').on(table.reference),
  uniqueIndex('marketplace_products_slug_uq').on(table.slug),
  index('marketplace_products_publication_idx').on(table.status, table.publishedAt),
  index('marketplace_products_category_price_idx').on(table.categoryId, table.priceKes),
  index('marketplace_products_featured_idx').on(table.featured, table.publishedAt),
  index('marketplace_products_created_idx').on(table.createdAt),
  index('marketplace_products_condition_status_idx').on(table.condition, table.status, table.publishedAt),
  check('marketplace_products_price_positive_ck', sql`${table.priceKes} > 0`),
  check('marketplace_products_condition_ck', sql`${table.condition} IN ('new', 'like_new', 'good', 'fair', 'used')`),
  check('marketplace_products_status_ck', sql`${table.status} IN ('pending_payment', 'published', 'sold', 'expired', 'suspended', 'removed')`),
])

export const marketplaceProductImages = marketplaceSchema.table('marketplace_product_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => marketplaceProducts.id, { onDelete: 'cascade' }),
  storageKey: varchar('storage_key', { length: 512 }).notNull(),
  imageUrl: varchar('image_url', { length: 2048 }).notNull(),
  contentType: varchar('content_type', { length: 50 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (table) => [index('marketplace_product_images_order_idx').on(table.productId, table.isPrimary, table.sortOrder)])

export const marketplacePayments = marketplaceSchema.table('marketplace_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentReference: varchar('payment_reference', { length: 40 }).notNull(),
  merchantRequestId: varchar('merchant_request_id', { length: 100 }).notNull(),
  checkoutRequestId: varchar('checkout_request_id', { length: 100 }),
  purpose: varchar('purpose', { length: 32 }).notNull(),
  productId: uuid('product_id').references(() => marketplaceProducts.id, { onDelete: 'restrict' }),
  amountKes: bigint('amount_kes', { mode: 'number' }).notNull(),
  phone: varchar('phone', { length: 16 }).notNull(),
  customerEmail: varchar('customer_email', { length: 254 }),
  status: varchar('status', { length: 24 }).notNull().default('initiated'),
  accessTokenHash: varchar('access_token_hash', { length: 64 }),
  providerDetails: jsonb('provider_details').$type<Record<string, unknown> | null>(),
  providerReceipt: varchar('provider_receipt', { length: 32 }),
  transactionAt: timestamp('transaction_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  lastReconciliationAt: timestamp('last_reconciliation_at', { withTimezone: true }),
  reconciliationAttempts: integer('reconciliation_attempts').notNull().default(0),
  callbackProcessedAt: timestamp('callback_processed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('marketplace_payments_reference_uq').on(table.paymentReference),
  uniqueIndex('marketplace_payments_merchant_uq').on(table.merchantRequestId),
  uniqueIndex('marketplace_payments_checkout_uq').on(table.checkoutRequestId),
  index('marketplace_payments_status_created_idx').on(table.status, table.createdAt),
  check('marketplace_payments_purpose_ck', sql`${table.purpose} IN ('PRODUCT_PUBLICATION', 'CONTACT_UNLOCK')`),
  check('marketplace_payments_status_ck', sql`${table.status} IN ('initiated', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'ambiguous', 'reversed', 'refunded')`),
  check('marketplace_payments_amount_positive_ck', sql`${table.amountKes} > 0`),
])

export const marketplacePaymentCallbacks = marketplaceSchema.table('marketplace_payment_callbacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => marketplacePayments.id, { onDelete: 'restrict' }),
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  outcome: varchar('outcome', { length: 24 }).notNull().default('received'),
  receivedAt: createdAt(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => [uniqueIndex('marketplace_payment_callbacks_hash_uq').on(table.payloadHash), index('marketplace_payment_callbacks_payment_idx').on(table.paymentId)])

export const marketplaceContactUnlocks = marketplaceSchema.table('marketplace_contact_unlocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => marketplaceProducts.id, { onDelete: 'restrict' }),
  paymentId: uuid('payment_id').notNull().references(() => marketplacePayments.id, { onDelete: 'restrict' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('marketplace_contact_unlock_payment_uq').on(table.paymentId), uniqueIndex('marketplace_contact_unlock_token_uq').on(table.tokenHash), index('marketplace_contact_unlock_product_idx').on(table.productId, table.expiresAt)])

export const marketplaceProductAccess = marketplaceSchema.table('marketplace_product_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => marketplaceProducts.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('marketplace_product_access_token_uq').on(table.tokenHash), index('marketplace_product_access_product_idx').on(table.productId, table.expiresAt)])

export const marketplaceAdminUsers = marketplaceSchema.table('marketplace_admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).notNull(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  role: varchar('role', { length: 32 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('marketplace_admin_users_email_uq').on(table.email)])

export const marketplaceAdminSessions = marketplaceSchema.table('marketplace_admin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').notNull().references(() => marketplaceAdminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('marketplace_admin_sessions_token_uq').on(table.tokenHash), index('marketplace_admin_sessions_user_idx').on(table.adminUserId, table.expiresAt)])

export const marketplaceAuditLogs = marketplaceSchema.table('marketplace_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').references(() => marketplaceAdminUsers.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 80 }).notNull(),
  resourceId: varchar('resource_id', { length: 100 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => [index('marketplace_audit_logs_created_idx').on(table.createdAt), index('marketplace_audit_logs_resource_idx').on(table.resourceType, table.resourceId)])

export const marketplaceSettings = marketplaceSchema.table('marketplace_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const marketplaceProductReports = marketplaceSchema.table('marketplace_product_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => marketplaceProducts.id, { onDelete: 'restrict' }),
  reason: varchar('reason', { length: 60 }).notNull(),
  details: varchar('details', { length: 1000 }),
  reporterEmail: varchar('reporter_email', { length: 254 }),
  status: varchar('status', { length: 24 }).notNull().default('open'),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [index('marketplace_product_reports_status_idx').on(table.status, table.createdAt), index('marketplace_product_reports_product_idx').on(table.productId)])

export const marketplaceProductViews = marketplaceSchema.table('marketplace_product_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => marketplaceProducts.id, { onDelete: 'cascade' }),
  viewedAt: createdAt(),
}, (table) => [index('marketplace_product_views_product_time_idx').on(table.productId, table.viewedAt)])

export const marketplaceFeaturedProducts = marketplaceSchema.table('marketplace_featured_products', {
  productId: uuid('product_id').primaryKey().references(() => marketplaceProducts.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

export const marketplaceNotifications = marketplaceSchema.table('marketplace_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  sellerId: uuid('seller_id').references(() => marketplaceSellers.id, { onDelete: 'set null' }),
  kind: varchar('kind', { length: 50 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  providerReference: varchar('provider_reference', { length: 100 }),
  createdAt: createdAt(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (table) => [index('marketplace_notifications_status_idx').on(table.status, table.createdAt)])

export const marketplaceEmailEvents = marketplaceSchema.table('marketplace_email_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventKey: varchar('event_key', { length: 180 }).notNull(),
  kind: varchar('kind', { length: 48 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 254 }).notNull(),
  payload: jsonb('payload').$type<Record<string, string | number | null>>().notNull().default({}),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  providerMessageId: varchar('provider_message_id', { length: 180 }),
  lastErrorCode: varchar('last_error_code', { length: 48 }),
  createdAt: createdAt(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('marketplace_email_events_key_uq').on(table.eventKey),
  index('marketplace_email_events_delivery_idx').on(table.status, table.nextAttemptAt, table.createdAt),
  check('marketplace_email_events_status_ck', sql`${table.status} IN ('pending', 'sending', 'sent', 'failed', 'uncertain')`),
  check('marketplace_email_events_attempts_ck', sql`${table.attempts} >= 0`),
])