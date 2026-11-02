import { sql } from 'drizzle-orm'
import { boolean, check, index, integer as int, jsonb, pgTable as mysqlTable, primaryKey, text, timestamp as pgTimestamp, unique, varchar } from 'drizzle-orm/pg-core'

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

export const itAccessRoles = ['super_admin', 'security_analyst', 'it_support', 'database_admin', 'infrastructure_admin', 'viewer'] as const
export type ItAccessRole = typeof itAccessRoles[number]

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
  role: varchar('it_role', { length: 32 }).$type<ItAccessRole>(),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
  revokedByAdminUserId: int('revoked_by_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
}, (table) => [
  primaryKey({ columns: [table.adminUserId] }),
  index('operations_operators_granted_by_idx').on(table.grantedByAdminUserId),
  index('operations_operators_active_role_idx').on(table.role, table.revokedAt),
  check('operations_operators_it_role_check', sql`${table.role} IS NULL OR ${table.role} IN ('super_admin', 'security_analyst', 'it_support', 'database_admin', 'infrastructure_admin', 'viewer')`),
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

export const monitoringEvents = mysqlTable('monitoring_events', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  eventId: varchar('event_id', { length: 36 }).notNull(),
  eventType: varchar('event_type', { length: 80 }).notNull(),
  category: varchar('category', { length: 24 }).notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  occurredAt: timestamp('occurred_at').notNull(),
  sourceService: varchar('source_service', { length: 40 }).notNull(),
  instanceId: varchar('instance_id', { length: 120 }).notNull(),
  requestId: varchar('request_id', { length: 120 }),
  correlationId: varchar('correlation_id', { length: 36 }),
  relatedResourceId: varchar('related_resource_id', { length: 80 }),
  metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().notNull(),
  ingestedAt: timestamp('ingested_at').defaultNow().notNull(),
}, (table) => [
  unique('monitoring_events_event_id_unique').on(table.eventId),
  index('monitoring_events_occurred_idx').on(table.occurredAt),
  index('monitoring_events_category_occurred_idx').on(table.category, table.occurredAt),
  index('monitoring_events_type_occurred_idx').on(table.eventType, table.occurredAt),
  index('monitoring_events_instance_occurred_idx').on(table.instanceId, table.occurredAt),
  check('monitoring_events_category_check', sql`${table.category} IN ('request', 'application', 'security', 'business', 'system')`),
  check('monitoring_events_severity_check', sql`${table.severity} IN ('debug', 'info', 'warning', 'error', 'critical')`),
])

export const monitoringDetectionRules = mysqlTable('monitoring_detection_rules', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  ruleId: varchar('rule_id', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull(),
  condition: varchar('condition', { length: 40 }).notNull(),
  threshold: int('threshold').notNull(),
  windowSeconds: int('window_seconds').notNull(),
  severity: varchar('severity', { length: 16 }).notNull(),
  cooldownSeconds: int('cooldown_seconds').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  recommendedResponse: text('recommended_response').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('monitoring_detection_rules_enabled_idx').on(table.enabled, table.ruleId),
  check('monitoring_detection_rules_condition_check', sql`${table.condition} IN ('login_failures', 'status_401', 'status_403', 'status_429', 'api_scanning', 'payment_callback_failures', 'abnormal_volume', 'password_reset_activity')`),
  check('monitoring_detection_rules_severity_check', sql`${table.severity} IN ('debug', 'info', 'warning', 'error', 'critical')`),
  check('monitoring_detection_rules_threshold_check', sql`${table.threshold} > 0 AND ${table.windowSeconds} > 0 AND ${table.cooldownSeconds} >= 0`),
])

export const monitoringAlerts = mysqlTable('monitoring_alerts', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  deduplicationKey: varchar('deduplication_key', { length: 180 }).notNull().unique(),
  detectionRuleId: int('detection_rule_id').notNull().references(() => monitoringDetectionRules.id, { onDelete: 'restrict' }),
  sourceEventId: int('source_event_id').references(() => monitoringEvents.id, { onDelete: 'set null' }),
  severity: varchar('severity', { length: 16 }).notNull(),
  description: text('description').notNull(),
  affectedService: varchar('affected_service', { length: 80 }).notNull(),
  status: varchar('status', { length: 20 }).default('new').notNull(),
  firstOccurrence: timestamp('first_occurrence').defaultNow().notNull(),
  lastOccurrence: timestamp('last_occurrence').defaultNow().notNull(),
  occurrenceCount: int('occurrence_count').default(1).notNull(),
  assignedOperationsUserId: int('assigned_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  resolutionInformation: text('resolution_information'),
  notificationSuppressedUntil: timestamp('notification_suppressed_until'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [
  index('monitoring_alerts_status_severity_created_idx').on(table.status, table.severity, table.createdAt),
  index('monitoring_alerts_rule_last_occurrence_idx').on(table.detectionRuleId, table.lastOccurrence),
  check('monitoring_alerts_severity_check', sql`${table.severity} IN ('debug', 'info', 'warning', 'error', 'critical')`),
  check('monitoring_alerts_status_check', sql`${table.status} IN ('new', 'acknowledged', 'investigating', 'resolved', 'closed')`),
  check('monitoring_alerts_occurrence_count_check', sql`${table.occurrenceCount} > 0`),
])

export const monitoringDetectionHistory = mysqlTable('monitoring_detection_history', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  ruleId: varchar('rule_id', { length: 80 }).notNull(),
  groupKey: varchar('group_key', { length: 120 }).notNull(),
  lastEventId: int('last_event_id').default(0).notNull(),
  lastEvaluatedAt: timestamp('last_evaluated_at').notNull(),
  lastAlertedAt: timestamp('last_alerted_at'),
  lastMatchCount: int('last_match_count').default(0).notNull(),
}, (table) => [
  unique('monitoring_detection_history_rule_group_unique').on(table.ruleId, table.groupKey),
  index('monitoring_detection_history_evaluated_idx').on(table.lastEvaluatedAt),
])

export const monitoringWorkerState = mysqlTable('monitoring_worker_state', {
  workerName: varchar('worker_name', { length: 80 }).primaryKey(),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  lastSuccessAt: timestamp('last_success_at'),
  lastFailureAt: timestamp('last_failure_at'),
  failureCount: int('failure_count').default(0).notNull(),
  lastErrorCode: varchar('last_error_code', { length: 80 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [index('monitoring_worker_state_heartbeat_idx').on(table.lastHeartbeatAt)])
