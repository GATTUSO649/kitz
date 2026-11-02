import { sql } from 'drizzle-orm'
import { check, index, integer as int, pgTable as mysqlTable, primaryKey, text, timestamp as pgTimestamp, varchar } from 'drizzle-orm/pg-core'

const timestamp = (name: string) => pgTimestamp(name, { withTimezone: true, mode: 'date' })
const enumText = <T extends string>(name: string, length: number) => varchar(name, { length }).$type<T>()

export const adminUsers = mysqlTable('admin_users', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const adminSessions = mysqlTable('admin_sessions', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('admin_sessions_user_expiry_idx').on(table.adminUserId, table.expiresAt)])

export const adminVerificationTokens = mysqlTable('admin_verification_tokens', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
}, (table) => [index('admin_verification_user_expiry_idx').on(table.adminUserId, table.expiresAt)])

export const adminAuditLogs = mysqlTable('admin_audit_logs', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
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

export const operationsUsers = mysqlTable('operations_users', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  disabledAt: timestamp('disabled_at'),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const operationsSessions = mysqlTable('operations_sessions', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  operationsUserId: int('operations_user_id').notNull().references(() => operationsUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('operations_sessions_user_expiry_idx').on(table.operationsUserId, table.expiresAt)])

export const operationsOperators = mysqlTable('operations_operators', {
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  grantedByAdminUserId: int('granted_by_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.adminUserId] }),
  index('operations_operators_granted_by_idx').on(table.grantedByAdminUserId),
])

export const operationsIncidents = mysqlTable('operations_incidents', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  incidentNumber: varchar('incident_number', { length: 24 }).notNull().unique(),
  severity: enumText<'P1' | 'P2' | 'P3' | 'P4'>('severity', 2).notNull(),
  status: enumText<'open' | 'investigating' | 'resolved' | 'closed'>('status', 16).default('open').notNull(),
  title: varchar('title', { length: 160 }).notNull(),
  description: text('description').notNull(),
  affectedComponent: varchar('affected_component', { length: 80 }).notNull(),
  createdByAdminUserId: int('created_by_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdByOperationsUserId: int('created_by_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  assignedAdminUserId: int('assigned_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  assignedOperationsUserId: int('assigned_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  rootCause: text('root_cause'),
  resolutionNotes: text('resolution_notes'),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('operations_incidents_status_created_idx').on(table.status, table.createdAt),
  index('operations_incidents_severity_created_idx').on(table.severity, table.createdAt),
  index('operations_incidents_assignee_idx').on(table.assignedOperationsUserId, table.status),
  check('operations_incidents_severity_check', sql`${table.severity} IN ('P1', 'P2', 'P3', 'P4')`),
  check('operations_incidents_status_check', sql`${table.status} IN ('open', 'investigating', 'resolved', 'closed')`),
])

export const operationsIncidentEvents = mysqlTable('operations_incident_events', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  incidentId: int('incident_id').notNull().references(() => operationsIncidents.id, { onDelete: 'cascade' }),
  actorAdminUserId: int('actor_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  actorOperationsUserId: int('actor_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('operations_incident_events_created_idx').on(table.incidentId, table.createdAt)])

export const operationsAuditEvents = mysqlTable('operations_audit_events', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  actorAdminUserId: int('actor_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  actorOperationsUserId: int('actor_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  actorType: enumText<'admin' | 'operations_user' | 'provisioning_cli'>('actor_type', 24).notNull(),
  action: varchar('action', { length: 80 }).notNull(),
  targetType: varchar('target_type', { length: 80 }).notNull(),
  targetId: varchar('target_id', { length: 80 }).notNull(),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('operations_audit_created_idx').on(table.createdAt),
  index('operations_audit_actor_created_idx').on(table.actorOperationsUserId, table.createdAt),
  check('operations_audit_events_actor_type_check', sql`${table.actorType} IN ('admin', 'operations_user', 'provisioning_cli')`),
])
