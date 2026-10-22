import { index, int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core'

export const adminUsers = mysqlTable('admin_users', {
  id: int('id').autoincrement().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const adminSessions = mysqlTable('admin_sessions', {
  id: int('id').autoincrement().primaryKey(),
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('admin_sessions_user_expiry_idx').on(table.adminUserId, table.expiresAt)])

export const adminVerificationTokens = mysqlTable('admin_verification_tokens', {
  id: int('id').autoincrement().primaryKey(),
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
}, (table) => [index('admin_verification_user_expiry_idx').on(table.adminUserId, table.expiresAt)])

export const adminAuditLogs = mysqlTable('admin_audit_logs', {
  id: int('id').autoincrement().primaryKey(),
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 80 }),
  targetId: varchar('target_id', { length: 80 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('admin_audit_actor_created_idx').on(table.adminUserId, table.createdAt)])

export const adminSetupLocks = mysqlTable('admin_setup_locks', {
  id: int('id').primaryKey(),
  purpose: varchar('purpose', { length: 40 }).notNull().unique(),
})
