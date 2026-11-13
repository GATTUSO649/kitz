import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  numeric as decimal,
  index,
  integer as int,
  jsonb,
  pgTable as mysqlTable,
  primaryKey,
  text,
  timestamp as pgTimestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'
import { adminUsers } from './admin-schema.js'

const timestamp = (name: string) => pgTimestamp(name, { withTimezone: true, mode: 'date' })
const datetime = (name: string) => pgTimestamp(name, { withTimezone: false, mode: 'date' })
const enumText = <T extends string>(name: string, length: number) => varchar(name, { length }).$type<T>()

export const users = mysqlTable('users', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  emailVerifiedAt: timestamp('email_verified_at'),
  marketingConsentAt: timestamp('marketing_consent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
})

export const customerAddresses = mysqlTable('customer_addresses', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 80 }).notNull(),
  recipientName: varchar('recipient_name', { length: 160 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  address: varchar('address', { length: 180 }).notNull(),
  county: varchar('county', { length: 80 }).notNull(),
  town: varchar('town', { length: 100 }).notNull(),
  estate: varchar('estate', { length: 100 }),
  landmark: varchar('landmark', { length: 180 }),
  instructions: varchar('instructions', { length: 500 }),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [index('customer_addresses_user_idx').on(table.userId, table.isDefault)])

export const categories = mysqlTable('categories', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 140 }).notNull().unique(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
})

export const leagues = mysqlTable('leagues', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 140 }).notNull().unique(),
  country: varchar('country', { length: 80 }).notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull(),
  season: varchar('season', { length: 20 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
}, (table) => [index('leagues_active_order_idx').on(table.active, table.sortOrder)])

export const teams = mysqlTable('teams', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  leagueId: int('league_id').notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 140 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
}, (table) => [
  unique('teams_league_slug_unique').on(table.leagueId, table.slug),
  index('teams_league_active_order_idx').on(table.leagueId, table.active, table.sortOrder),
])

export const jerseyCategories = mysqlTable('jersey_categories', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
})

export const products = mysqlTable('products', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  categoryId: int('category_id').references(() => categories.id, { onDelete: 'set null' }),
  teamId: int('team_id').references(() => teams.id, { onDelete: 'set null' }),
  jerseyCategoryId: int('jersey_category_id').references(() => jerseyCategories.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 180 }).notNull(),
  slug: varchar('slug', { length: 200 }).notNull().unique(),
  description: text('description').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  salePrice: decimal('sale_price', { precision: 10, scale: 2 }),
  cost: decimal('cost', { precision: 10, scale: 2 }),
  season: varchar('season', { length: 40 }),
  productType: varchar('product_type', { length: 40 }),
  imageUrl: varchar('image_url', { length: 2048 }),
  published: boolean('published').default(false).notNull(),
  featured: boolean('featured').default(false).notNull(),
  trending: boolean('trending').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [index('products_category_published_idx').on(table.categoryId, table.published)])

export const productImages = mysqlTable('product_images', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  publicId: varchar('public_id', { length: 255 }).notNull().unique(),
  imageUrl: varchar('image_url', { length: 2048 }).notNull(),
  format: varchar('format', { length: 12 }).notNull(),
  byteSize: int('byte_size').notNull(),
  width: int('width'),
  height: int('height'),
  altText: varchar('alt_text', { length: 240 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  isPrimary: boolean('is_primary').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('product_images_product_order_idx').on(table.productId, table.sortOrder)])

export const productVideos = mysqlTable('product_videos', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  videoUrl: varchar('video_url', { length: 2048 }).notNull(),
  title: varchar('title', { length: 240 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('product_videos_product_order_idx').on(table.productId, table.sortOrder)])

export const homepageSlides = mysqlTable('homepage_slides', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  imageUrl: varchar('image_url', { length: 2048 }).notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  subtitle: varchar('subtitle', { length: 500 }).notNull(),
  promotionalMessage: varchar('promotional_message', { length: 240 }),
  ctaLabel: varchar('cta_label', { length: 80 }).notNull(),
  destinationUrl: varchar('destination_url', { length: 2048 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  displayDurationSeconds: int('display_duration_seconds').default(5).notNull(),
  active: boolean('active').default(false).notNull(),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [index('homepage_slides_active_order_idx').on(table.active, table.sortOrder)])

export const productVariants = mysqlTable('product_variants', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 80 }).notNull().unique(),
  size: varchar('size', { length: 16 }).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }),
  stock: int('stock').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [unique('product_variant_size_unique').on(table.productId, table.size)])

export const wishlists = mysqlTable('wishlists', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [unique('wishlist_user_product_unique').on(table.userId, table.productId), index('wishlist_user_idx').on(table.userId)])

export const productReviews = mysqlTable('product_reviews', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: int('rating').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  unique('product_reviews_user_product_unique').on(table.productId, table.userId),
  index('product_reviews_product_created_idx').on(table.productId, table.createdAt),
])

export const productRatings = mysqlTable('product_ratings', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  visitorId: varchar('visitor_id', { length: 36 }).notNull(),
  rating: int('rating').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  unique('product_ratings_product_visitor_unique').on(table.productId, table.visitorId),
  index('product_ratings_product_created_idx').on(table.productId, table.createdAt),
])

export const inventoryMovements = mysqlTable('inventory_movements', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  variantId: int('variant_id').notNull().references(() => productVariants.id),
  movementType: enumText<'restock' | 'sale' | 'adjustment' | 'reservation' | 'release'>('movement_type', 20).notNull(),
  quantityChange: int('quantity_change').notNull(),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('inventory_variant_created_idx').on(table.variantId, table.createdAt),
  check('inventory_movements_movement_type_check', sql`${table.movementType} IN ('restock', 'sale', 'adjustment', 'reservation', 'release')`),
])

export const carts = mysqlTable('carts', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').references(() => users.id, { onDelete: 'cascade' }),
  anonymousTokenHash: varchar('anonymous_token_hash', { length: 64 }).unique(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const cartItems = mysqlTable('cart_items', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  cartId: int('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
  variantId: int('variant_id').notNull().references(() => productVariants.id),
  quantity: int('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [unique('cart_variant_unique').on(table.cartId, table.variantId)])

export const orders = mysqlTable('orders', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  orderNumber: varchar('order_number', { length: 32 }).notNull().unique(),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).unique(),
  userId: int('user_id').references(() => users.id),
  status: enumText<'pending_payment' | 'paid' | 'processing' | 'dispatched' | 'delivered' | 'cancelled' | 'refunded'>('status', 32).default('pending_payment').notNull(),
  paymentMethod: enumText<'pay_on_delivery' | 'mpesa'>('payment_method', 24).default('pay_on_delivery').notNull(),
  currency: varchar('currency', { length: 3 }).default('KES').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  deliveryFee: decimal('delivery_fee', { precision: 12, scale: 2 }).notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  deliveryAddressSnapshot: text('delivery_address_snapshot').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('orders_user_created_idx').on(table.userId, table.createdAt),
  index('orders_status_created_idx').on(table.status, table.createdAt),
  check('orders_status_check', sql`${table.status} IN ('pending_payment', 'paid', 'processing', 'dispatched', 'delivered', 'cancelled', 'refunded')`),
  check('orders_payment_method_check', sql`${table.paymentMethod} IN ('pay_on_delivery', 'mpesa')`),
])

export const orderItems = mysqlTable('order_items', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  orderId: int('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: int('product_id').references(() => products.id, { onDelete: 'set null' }),
  variantId: int('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
  productNameSnapshot: varchar('product_name_snapshot', { length: 180 }).notNull(),
  sizeSnapshot: varchar('size_snapshot', { length: 16 }).notNull(),
  customizationSnapshot: varchar('customization_snapshot', { length: 180 }),
  quantity: int('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
}, (table) => [index('order_items_order_idx').on(table.orderId)])

export const supportRequests = mysqlTable('support_requests', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orderId: int('order_id').references(() => orders.id, { onDelete: 'set null' }),
  category: enumText<'order' | 'payment' | 'delivery' | 'product' | 'account' | 'other'>('category', 20).notNull(),
  subject: varchar('subject', { length: 120 }).notNull(),
  message: text('message').notNull(),
  status: enumText<'pending' | 'in_progress' | 'resolved' | 'closed'>('status', 20).default('pending').notNull(),
  adminResponse: text('admin_response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('support_requests_user_created_idx').on(table.userId, table.createdAt),
  index('support_requests_status_created_idx').on(table.status, table.createdAt),
  check('support_requests_category_check', sql`${table.category} IN ('order', 'payment', 'delivery', 'product', 'account', 'other')`),
  check('support_requests_status_check', sql`${table.status} IN ('pending', 'in_progress', 'resolved', 'closed')`),
])

export const supportMessages = mysqlTable('support_messages', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  supportRequestId: int('support_request_id').notNull().references(() => supportRequests.id, { onDelete: 'cascade' }),
  senderType: enumText<'customer' | 'admin'>('sender_type', 12).notNull(),
  body: text('body').notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  productName: varchar('product_name', { length: 180 }),
  productPrice: decimal('product_price', { precision: 12, scale: 2 }),
  productImageUrl: text('product_image_url'),
  productUrl: varchar('product_url', { length: 320 }),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('support_messages_request_created_idx').on(table.supportRequestId, table.createdAt),
  check('support_messages_sender_type_check', sql`${table.senderType} IN ('customer', 'admin')`),
])

export const notificationCampaigns = mysqlTable('notification_campaigns', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  type: enumText<'order' | 'support' | 'announcement'>('type', 20).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  body: text('body').notNull(),
  href: varchar('href', { length: 320 }),
  audienceType: enumText<'all' | 'customer' | 'system'>('audience_type', 20).notNull(),
  audienceUserId: int('audience_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByAdminId: int('created_by_admin_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('notification_campaigns_created_idx').on(table.createdAt),
  check('notification_campaigns_type_check', sql`${table.type} IN ('order', 'support', 'announcement')`),
  check('notification_campaigns_audience_type_check', sql`${table.audienceType} IN ('all', 'customer', 'system')`),
])

export const notificationRecipients = mysqlTable('notification_recipients', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  campaignId: int('campaign_id').notNull().references(() => notificationCampaigns.id, { onDelete: 'cascade' }),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  unique('notification_recipient_campaign_user_unique').on(table.campaignId, table.userId),
  index('notification_recipient_user_read_created_idx').on(table.userId, table.readAt, table.createdAt),
])

export const payments = mysqlTable('payments', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  applicationId: varchar('application_id', { length: 16 }).$type<'KITZ' | 'MARKETHUB'>().notNull().default('KITZ'),
  orderId: int('order_id').notNull().references(() => orders.id),
  provider: enumText<'mpesa' | 'manual' | 'simulated'>('provider', 16).notNull(),
  providerRequestId: varchar('provider_request_id', { length: 120 }).unique(),
  merchantRequestId: varchar('merchant_request_id', { length: 120 }),
  merchantShortcode: varchar('merchant_shortcode', { length: 20 }),
  providerReceipt: varchar('provider_receipt', { length: 120 }).unique(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  status: enumText<'initiated' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'requires_review' | 'refunded'>('status', 24).default('initiated').notNull(),
  providerResultCode: varchar('provider_result_code', { length: 32 }),
  payerPhone: varchar('payer_phone', { length: 20 }),
  payerName: varchar('payer_name', { length: 160 }),
  transactionAt: datetime('transaction_at'),
  verificationMessage: varchar('verification_message', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('payments_order_status_idx').on(table.orderId, table.status),
  check('payments_application_id_check', sql`${table.applicationId} = 'KITZ'`),
  check('payments_provider_check', sql`${table.provider} IN ('mpesa', 'manual', 'simulated')`),
  check('payments_status_check', sql`${table.status} IN ('initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'expired', 'requires_review', 'refunded')`),
])

export const paymentRefunds = mysqlTable('payment_refunds', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  paymentId: int('payment_id').notNull().references(() => payments.id),
  orderId: int('order_id').notNull().references(() => orders.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  status: enumText<'requested' | 'approved' | 'rejected' | 'paid'>('status', 20).default('requested').notNull(),
  providerReference: varchar('provider_reference', { length: 120 }),
  resolutionNote: varchar('resolution_note', { length: 500 }),
  createdByAdminId: int('created_by_admin_id').notNull(),
  resolvedByAdminId: int('resolved_by_admin_id'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('payment_refunds_payment_created_idx').on(table.paymentId, table.createdAt),
  index('payment_refunds_status_created_idx').on(table.status, table.createdAt),
  check('payment_refunds_amount_check', sql`${table.amount} > 0`),
  check('payment_refunds_status_check', sql`${table.status} IN ('requested', 'approved', 'rejected', 'paid')`),
])

export const paymentReconciliations = mysqlTable('payment_reconciliations', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  settlementDate: varchar('settlement_date', { length: 10 }).notNull().unique(),
  internalAmount: decimal('internal_amount', { precision: 14, scale: 2 }).notNull(),
  providerAmount: decimal('provider_amount', { precision: 14, scale: 2 }).notNull(),
  note: varchar('note', { length: 500 }),
  reconciledByAdminId: int('reconciled_by_admin_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [index('payment_reconciliations_date_idx').on(table.settlementDate)])

export const laundryServiceAreas = mysqlTable('laundry_service_areas', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 160 }).notNull().unique(),
  active: boolean('active').default(true).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  createdByAdminId: int('created_by_admin_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [index('laundry_service_areas_active_order_idx').on(table.active, table.sortOrder)])

export const laundryBookings = mysqlTable('laundry_bookings', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  reference: varchar('reference', { length: 40 }).notNull().unique(),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).unique(),
  name: varchar('name', { length: 160 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  location: varchar('location', { length: 240 }).notNull(),
  locationLatitude: decimal('location_latitude', { precision: 10, scale: 7 }),
  locationLongitude: decimal('location_longitude', { precision: 10, scale: 7 }),
  serviceName: varchar('service_name', { length: 120 }),
  quantity: decimal('quantity', { precision: 10, scale: 2 }),
  quantityUnit: varchar('quantity_unit', { length: 24 }),
  pickupAddress: varchar('pickup_address', { length: 500 }),
  preferredPickupAt: timestamp('preferred_pickup_at'),
  deliveryAddress: varchar('delivery_address', { length: 500 }),
  preferredDeliveryAt: timestamp('preferred_delivery_at'),
  amountDue: decimal('amount_due', { precision: 12, scale: 2 }).default('0.00').notNull(),
  status: enumText<'new' | 'confirmed' | 'pickup_scheduled' | 'collected' | 'washing' | 'drying' | 'ironing_folding' | 'ready_for_delivery' | 'out_for_delivery' | 'completed' | 'cancelled'>('status', 32).default('new').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('laundry_bookings_status_created_idx').on(table.status, table.createdAt),
  index('laundry_bookings_phone_created_idx').on(table.phone, table.createdAt),
  check('laundry_bookings_status_check', sql`${table.status} IN ('new', 'confirmed', 'pickup_scheduled', 'collected', 'washing', 'drying', 'ironing_folding', 'ready_for_delivery', 'out_for_delivery', 'completed', 'cancelled')`),
  check('laundry_bookings_amount_due_check', sql`${table.amountDue} >= 0`),
  check('laundry_bookings_location_pair_check', sql`(${table.locationLatitude} IS NULL) = (${table.locationLongitude} IS NULL)`),
])

export const laundryBookingEvents = mysqlTable('laundry_booking_events', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  bookingId: int('booking_id').notNull().references(() => laundryBookings.id, { onDelete: 'cascade' }),
  previousStatus: varchar('previous_status', { length: 32 }),
  newStatus: varchar('new_status', { length: 32 }).notNull(),
  actorType: enumText<'customer' | 'admin' | 'system'>('actor_type', 16).notNull(),
  actorAdminUserId: int('actor_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('laundry_booking_events_booking_created_idx').on(table.bookingId, table.createdAt)])

export const laundryPayments = mysqlTable('laundry_payments', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  bookingId: int('booking_id').notNull().references(() => laundryBookings.id),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).unique(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: enumText<'cash' | 'mpesa' | 'bank_transfer' | 'other'>('method', 20).notNull(),
  paymentDate: timestamp('payment_date').notNull(),
  transactionReference: varchar('transaction_reference', { length: 120 }),
  notes: varchar('notes', { length: 1000 }),
  status: enumText<'pending' | 'confirmed' | 'reversed'>('status', 16).default('confirmed').notNull(),
  recordedByAdminId: int('recorded_by_admin_id').notNull().references(() => adminUsers.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('laundry_payments_booking_status_idx').on(table.bookingId, table.status),
  index('laundry_payments_date_status_idx').on(table.paymentDate, table.status),
  check('laundry_payments_amount_check', sql`${table.amount} > 0`),
  check('laundry_payments_method_check', sql`${table.method} IN ('cash', 'mpesa', 'bank_transfer', 'other')`),
  check('laundry_payments_status_check', sql`${table.status} IN ('pending', 'confirmed', 'reversed')`),
])

export const laundryPaymentEvents = mysqlTable('laundry_payment_events', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  paymentId: int('payment_id').notNull().references(() => laundryPayments.id),
  bookingId: int('booking_id').notNull().references(() => laundryBookings.id),
  actorAdminUserId: int('actor_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  eventType: enumText<'recorded' | 'updated' | 'status_changed' | 'reversed'>('event_type', 20).notNull(),
  before: jsonb('before').$type<Record<string, unknown> | null>(),
  after: jsonb('after').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('laundry_payment_events_payment_created_idx').on(table.paymentId, table.createdAt)])

export const inventorySuppliers = mysqlTable('inventory_suppliers', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 160 }).notNull().unique(),
  contactName: varchar('contact_name', { length: 160 }),
  email: varchar('email', { length: 254 }),
  phone: varchar('phone', { length: 32 }),
  notes: varchar('notes', { length: 1000 }),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
})

export const inventoryPurchaseOrders = mysqlTable('inventory_purchase_orders', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  supplierId: int('supplier_id').notNull().references(() => inventorySuppliers.id),
  status: enumText<'draft' | 'approved' | 'ordered' | 'received' | 'cancelled'>('status', 20).default('draft').notNull(),
  note: varchar('note', { length: 1000 }),
  expectedAt: timestamp('expected_at'),
  createdByAdminId: int('created_by_admin_id').notNull(),
  approvedByAdminId: int('approved_by_admin_id'),
  approvedAt: timestamp('approved_at'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('inventory_purchase_orders_status_created_idx').on(table.status, table.createdAt),
  check('inventory_purchase_orders_status_check', sql`${table.status} IN ('draft', 'approved', 'ordered', 'received', 'cancelled')`),
])

export const inventoryPurchaseOrderLines = mysqlTable('inventory_purchase_order_lines', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  purchaseOrderId: int('purchase_order_id').notNull().references(() => inventoryPurchaseOrders.id, { onDelete: 'cascade' }),
  variantId: int('variant_id').notNull().references(() => productVariants.id),
  quantityOrdered: int('quantity_ordered').notNull(),
  quantityReceived: int('quantity_received').default(0).notNull(),
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index('inventory_purchase_order_lines_order_idx').on(table.purchaseOrderId),
  check('inventory_purchase_order_lines_quantity_check', sql`${table.quantityOrdered} > 0 AND ${table.quantityReceived} >= 0 AND ${table.quantityReceived} <= ${table.quantityOrdered}`),
  check('inventory_purchase_order_lines_cost_check', sql`${table.unitCost} >= 0`),
])

export const inventoryReturns = mysqlTable('inventory_returns', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  orderId: int('order_id').notNull().references(() => orders.id),
  orderItemId: int('order_item_id').notNull().references(() => orderItems.id),
  variantId: int('variant_id').references(() => productVariants.id),
  quantity: int('quantity').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  status: enumText<'requested' | 'approved' | 'rejected' | 'received'>('status', 20).default('requested').notNull(),
  resolutionNote: varchar('resolution_note', { length: 500 }),
  createdByAdminId: int('created_by_admin_id').notNull(),
  resolvedByAdminId: int('resolved_by_admin_id'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('inventory_returns_status_created_idx').on(table.status, table.createdAt),
  check('inventory_returns_quantity_check', sql`${table.quantity} > 0`),
  check('inventory_returns_status_check', sql`${table.status} IN ('requested', 'approved', 'rejected', 'received')`),
])

export const marketingCoupons = mysqlTable('marketing_coupons', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  discountType: enumText<'percent' | 'fixed'>('discount_type', 12).notNull(),
  value: decimal('value', { precision: 10, scale: 2 }).notNull(),
  minimumSubtotal: decimal('minimum_subtotal', { precision: 12, scale: 2 }).default('0.00').notNull(),
  maxRedemptions: int('max_redemptions'),
  redemptionCount: int('redemption_count').default(0).notNull(),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),
  active: boolean('active').default(true).notNull(),
  createdByAdminId: int('created_by_admin_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('marketing_coupons_active_ends_idx').on(table.active, table.endsAt),
  check('marketing_coupons_type_check', sql`${table.discountType} IN ('percent', 'fixed')`),
  check('marketing_coupons_value_check', sql`${table.value} > 0 AND (${table.discountType} <> 'percent' OR ${table.value} <= 100)`),
  check('marketing_coupons_redemption_check', sql`${table.redemptionCount} >= 0 AND (${table.maxRedemptions} IS NULL OR ${table.maxRedemptions} > 0)`),
])

export const marketingCouponRedemptions = mysqlTable('marketing_coupon_redemptions', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  couponId: int('coupon_id').notNull().references(() => marketingCoupons.id),
  orderId: int('order_id').notNull().unique().references(() => orders.id),
  userId: int('user_id').references(() => users.id, { onDelete: 'set null' }),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull(),
  redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
}, (table) => [index('marketing_coupon_redemptions_coupon_idx').on(table.couponId, table.redeemedAt)])

export const marketingEmailCampaigns = mysqlTable('marketing_email_campaigns', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  subject: varchar('subject', { length: 160 }).notNull(),
  body: text('body').notNull(),
  status: enumText<'sent' | 'partial' | 'failed'>('status', 12).notNull(),
  recipientCount: int('recipient_count').default(0).notNull(),
  acceptedCount: int('accepted_count').default(0).notNull(),
  failedCount: int('failed_count').default(0).notNull(),
  createdByAdminId: int('created_by_admin_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('marketing_email_campaigns_created_idx').on(table.createdAt)])

export const deliveryZones = mysqlTable('delivery_zones', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 120 }).notNull().unique(),
  fee: decimal('fee', { precision: 10, scale: 2 }).notNull(),
  active: boolean('active').default(true).notNull(),
})

export const expenseCategories = mysqlTable('expense_categories', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  name: varchar('name', { length: 120 }).notNull().unique(),
  active: boolean('active').default(true).notNull(),
})

export const expenses = mysqlTable('expenses', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  categoryId: int('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  description: varchar('description', { length: 240 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  incurredAt: datetime('incurred_at').notNull(),
  createdBy: int('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('expenses_incurred_idx').on(table.incurredAt)])

export const applicationSettings = mysqlTable('application_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  updatedBy: int('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
})

export const roles = mysqlTable('roles', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  label: varchar('label', { length: 80 }).notNull(),
})

export const userRoles = mysqlTable('user_roles', {
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: int('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => [primaryKey({ columns: [table.userId, table.roleId] })])

export const userSessions = mysqlTable('user_sessions', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const emailVerificationTokens = mysqlTable('email_verification_tokens', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
})

export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
})

export const emailDeliveryLogs = mysqlTable('email_delivery_logs', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  userId: int('user_id').references(() => users.id, { onDelete: 'set null' }),
  orderId: int('order_id').references(() => orders.id, { onDelete: 'set null' }),
  notificationType: varchar('notification_type', { length: 64 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 254 }).notNull(),
  providerMessageId: varchar('provider_message_id', { length: 128 }),
  status: enumText<'queued' | 'accepted' | 'delivered' | 'rejected' | 'failed'>('status', 16).default('queued').notNull(),
  attempts: int('attempts').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastAttemptAt: timestamp('last_attempt_at'),
  errorCategory: varchar('error_category', { length: 64 }),
  errorMessage: text('error_message'),
}, (table) => [
  index('email_delivery_logs_user_created_idx').on(table.userId, table.createdAt),
  index('email_delivery_logs_order_idx').on(table.orderId),
  check('email_delivery_logs_status_check', sql`${table.status} IN ('queued', 'accepted', 'delivered', 'rejected', 'failed')`),
])

export const auditLogs = mysqlTable('audit_logs', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  actorUserId: int('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 80 }),
  targetId: varchar('target_id', { length: 80 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('audit_actor_created_idx').on(table.actorUserId, table.createdAt)])