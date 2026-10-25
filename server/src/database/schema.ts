import {
  boolean,
  decimal,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  emailVerifiedAt: timestamp('email_verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
})

export const customerAddresses = mysqlTable('customer_addresses', {
  id: int('id').autoincrement().primaryKey(),
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
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [index('customer_addresses_user_idx').on(table.userId, table.isDefault)])

export const categories = mysqlTable('categories', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 140 }).notNull().unique(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
})

export const leagues = mysqlTable('leagues', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 140 }).notNull().unique(),
  country: varchar('country', { length: 80 }).notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull(),
  season: varchar('season', { length: 20 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
}, (table) => [index('leagues_active_order_idx').on(table.active, table.sortOrder)])

export const teams = mysqlTable('teams', {
  id: int('id').autoincrement().primaryKey(),
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
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  sortOrder: int('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
})

export const products = mysqlTable('products', {
  id: int('id').autoincrement().primaryKey(),
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
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [index('products_category_published_idx').on(table.categoryId, table.published)])

export const productImages = mysqlTable('product_images', {
  id: int('id').autoincrement().primaryKey(),
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
  id: int('id').autoincrement().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  videoUrl: varchar('video_url', { length: 2048 }).notNull(),
  title: varchar('title', { length: 240 }).notNull(),
  sortOrder: int('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('product_videos_product_order_idx').on(table.productId, table.sortOrder)])

export const homepageSlides = mysqlTable('homepage_slides', {
  id: int('id').autoincrement().primaryKey(),
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
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [index('homepage_slides_active_order_idx').on(table.active, table.sortOrder)])

export const productVariants = mysqlTable('product_variants', {
  id: int('id').autoincrement().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sku: varchar('sku', { length: 80 }).notNull().unique(),
  size: varchar('size', { length: 16 }).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }),
  stock: int('stock').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [unique('product_variant_size_unique').on(table.productId, table.size)])

export const wishlists = mysqlTable('wishlists', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [unique('wishlist_user_product_unique').on(table.userId, table.productId), index('wishlist_user_idx').on(table.userId)])

export const productReviews = mysqlTable('product_reviews', {
  id: int('id').autoincrement().primaryKey(),
  productId: int('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: int('rating').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [
  unique('product_reviews_user_product_unique').on(table.productId, table.userId),
  index('product_reviews_product_created_idx').on(table.productId, table.createdAt),
])

export const inventoryMovements = mysqlTable('inventory_movements', {
  id: int('id').autoincrement().primaryKey(),
  variantId: int('variant_id').notNull().references(() => productVariants.id),
  movementType: mysqlEnum('movement_type', ['restock', 'sale', 'adjustment', 'reservation', 'release']).notNull(),
  quantityChange: int('quantity_change').notNull(),
  note: varchar('note', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('inventory_variant_created_idx').on(table.variantId, table.createdAt)])

export const carts = mysqlTable('carts', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').references(() => users.id, { onDelete: 'cascade' }),
  anonymousTokenHash: varchar('anonymous_token_hash', { length: 64 }).unique(),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const cartItems = mysqlTable('cart_items', {
  id: int('id').autoincrement().primaryKey(),
  cartId: int('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
  variantId: int('variant_id').notNull().references(() => productVariants.id),
  quantity: int('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [unique('cart_variant_unique').on(table.cartId, table.variantId)])

export const orders = mysqlTable('orders', {
  id: int('id').autoincrement().primaryKey(),
  orderNumber: varchar('order_number', { length: 32 }).notNull().unique(),
  idempotencyKey: varchar('idempotency_key', { length: 36 }).unique(),
  userId: int('user_id').notNull().references(() => users.id),
  status: mysqlEnum('status', ['pending_payment', 'paid', 'processing', 'dispatched', 'delivered', 'cancelled', 'refunded']).default('pending_payment').notNull(),
  paymentMethod: mysqlEnum('payment_method', ['pay_on_delivery', 'mpesa']).default('pay_on_delivery').notNull(),
  currency: varchar('currency', { length: 3 }).default('KES').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  deliveryFee: decimal('delivery_fee', { precision: 12, scale: 2 }).notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  deliveryAddressSnapshot: text('delivery_address_snapshot').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [index('orders_user_created_idx').on(table.userId, table.createdAt), index('orders_status_created_idx').on(table.status, table.createdAt)])

export const orderItems = mysqlTable('order_items', {
  id: int('id').autoincrement().primaryKey(),
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
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orderId: int('order_id').references(() => orders.id, { onDelete: 'set null' }),
  category: mysqlEnum('category', ['order', 'payment', 'delivery', 'product', 'account', 'other']).notNull(),
  subject: varchar('subject', { length: 120 }).notNull(),
  message: text('message').notNull(),
  status: mysqlEnum('status', ['pending', 'in_progress', 'resolved', 'closed']).default('pending').notNull(),
  adminResponse: text('admin_response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index('support_requests_user_created_idx').on(table.userId, table.createdAt),
  index('support_requests_status_created_idx').on(table.status, table.createdAt),
])

export const supportMessages = mysqlTable('support_messages', {
  id: int('id').autoincrement().primaryKey(),
  supportRequestId: int('support_request_id').notNull().references(() => supportRequests.id, { onDelete: 'cascade' }),
  senderType: mysqlEnum('sender_type', ['customer', 'admin']).notNull(),
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
}, (table) => [index('support_messages_request_created_idx').on(table.supportRequestId, table.createdAt)])

export const notificationCampaigns = mysqlTable('notification_campaigns', {
  id: int('id').autoincrement().primaryKey(),
  type: mysqlEnum('type', ['order', 'support', 'announcement']).notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  body: text('body').notNull(),
  href: varchar('href', { length: 320 }),
  audienceType: mysqlEnum('audience_type', ['all', 'customer', 'system']).notNull(),
  audienceUserId: int('audience_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdByAdminId: int('created_by_admin_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('notification_campaigns_created_idx').on(table.createdAt)])

export const notificationRecipients = mysqlTable('notification_recipients', {
  id: int('id').autoincrement().primaryKey(),
  campaignId: int('campaign_id').notNull().references(() => notificationCampaigns.id, { onDelete: 'cascade' }),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  unique('notification_recipient_campaign_user_unique').on(table.campaignId, table.userId),
  index('notification_recipient_user_read_created_idx').on(table.userId, table.readAt, table.createdAt),
])

export const payments = mysqlTable('payments', {
  id: int('id').autoincrement().primaryKey(),
  orderId: int('order_id').notNull().references(() => orders.id),
  provider: mysqlEnum('provider', ['mpesa', 'manual', 'simulated']).notNull(),
  providerRequestId: varchar('provider_request_id', { length: 120 }).unique(),
  merchantRequestId: varchar('merchant_request_id', { length: 120 }),
  merchantShortcode: varchar('merchant_shortcode', { length: 20 }),
  providerReceipt: varchar('provider_receipt', { length: 120 }).unique(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  status: mysqlEnum('payment_status', ['initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'expired', 'requires_review', 'refunded']).default('initiated').notNull(),
  providerResultCode: varchar('provider_result_code', { length: 32 }),
  payerPhone: varchar('payer_phone', { length: 20 }),
  payerName: varchar('payer_name', { length: 160 }),
  transactionAt: datetime('transaction_at'),
  verificationMessage: varchar('verification_message', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => [index('payments_order_status_idx').on(table.orderId, table.status)])

export const deliveryZones = mysqlTable('delivery_zones', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull().unique(),
  fee: decimal('fee', { precision: 10, scale: 2 }).notNull(),
  active: boolean('active').default(true).notNull(),
})

export const expenseCategories = mysqlTable('expense_categories', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull().unique(),
  active: boolean('active').default(true).notNull(),
})

export const expenses = mysqlTable('expenses', {
  id: int('id').autoincrement().primaryKey(),
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
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
})

export const roles = mysqlTable('roles', {
  id: int('id').autoincrement().primaryKey(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  label: varchar('label', { length: 80 }).notNull(),
})

export const userRoles = mysqlTable('user_roles', {
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: int('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => [primaryKey({ columns: [table.userId, table.roleId] })])

export const userSessions = mysqlTable('user_sessions', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const emailVerificationTokens = mysqlTable('email_verification_tokens', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
})

export const passwordResetTokens = mysqlTable('password_reset_tokens', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
})

export const auditLogs = mysqlTable('audit_logs', {
  id: int('id').autoincrement().primaryKey(),
  actorUserId: int('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 80 }),
  targetId: varchar('target_id', { length: 80 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('audit_actor_created_idx').on(table.actorUserId, table.createdAt)])