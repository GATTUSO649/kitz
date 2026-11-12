import { sql } from 'drizzle-orm'
import { boolean, check, index, integer as int, jsonb, pgTable as mysqlTable, primaryKey, text, timestamp as pgTimestamp, unique, varchar } from 'drizzle-orm/pg-core'

const timestamp = (name: string) => pgTimestamp(name, { withTimezone: true, mode: 'date' })
const enumText = <T extends string>(name: string, length: number) => varchar(name, { length }).$type<T>()

export const administratorRoles = ['super_admin', 'it_admin', 'sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator', 'laundry_admin'] as const
export type AdministratorRole = typeof administratorRoles[number]
export const administratorStatuses = ['pending', 'active', 'suspended', 'disabled', 'rejected'] as const
export type AdministratorStatus = typeof administratorStatuses[number]

export const adminUsers = mysqlTable('admin_users', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  roleNumber: varchar('role_number', { length: 40 }).unique(),
  role: varchar('role', { length: 32 }).$type<AdministratorRole>(),
  status: varchar('status', { length: 24 }).$type<AdministratorStatus>().default('pending').notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  suspendedAt: timestamp('suspended_at'),
  suspendedReason: text('suspended_reason'),
  lastLoginAt: timestamp('last_login_at'),
  passwordUpdatedAt: timestamp('password_updated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('admin_users_role_idx').on(table.role),
  index('admin_users_status_idx').on(table.status),
  check('admin_users_role_check', sql`${table.role} IS NULL OR ${table.role} IN ('super_admin', 'it_admin', 'sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator', 'laundry_admin')`),
  check('admin_users_status_check', sql`${table.status} IN ('pending', 'active', 'suspended', 'disabled', 'rejected')`),
])

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
  adminUserId: int('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 80 }),
  targetId: varchar('target_id', { length: 80 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('admin_audit_actor_created_idx').on(table.adminUserId, table.createdAt)])

export const adminSetupLocks = mysqlTable('admin_setup_locks', {
  id: int('id').primaryKey(),
  purpose: varchar('purpose', { length: 40 }).notNull().unique(),
})

export const adminPermissions = mysqlTable('admin_permissions', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  permission: varchar('permission', { length: 120 }).notNull().unique(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const adminRolePermissions = mysqlTable('admin_role_permissions', {
  role: varchar('role', { length: 32 }).notNull(),
  permission: varchar('permission', { length: 120 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.role, table.permission] })])

export const adminUserPermissions = mysqlTable('admin_user_permissions', {
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  permission: varchar('permission', { length: 120 }).notNull(),
  granted: boolean('granted').notNull(),
  grantedByAdminUserId: int('granted_by_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
}, (table) => [primaryKey({ columns: [table.adminUserId, table.permission] })])

export const adminInvitations = mysqlTable('admin_invitations', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  invitationId: varchar('invitation_id', { length: 36 }).notNull().unique(),
  adminUserId: int('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 254 }).notNull(),
  role: varchar('role', { length: 32 }).$type<AdministratorRole>().notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  deliveredAt: timestamp('delivered_at'),
  deliveryStatus: varchar('delivery_status', { length: 24 }).default('queued').notNull(),
  deliveryErrorCode: varchar('delivery_error_code', { length: 80 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('admin_invitations_admin_idx').on(table.adminUserId),
  index('admin_invitations_email_idx').on(table.email),
  index('admin_invitations_status_idx').on(table.deliveryStatus, table.expiresAt),
])

export const adminLoginAttempts = mysqlTable('admin_login_attempts', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  identity: varchar('identity', { length: 254 }).notNull(),
  adminUserId: int('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  success: boolean('success').default(false).notNull(),
  failureCode: varchar('failure_code', { length: 80 }),
  requestId: varchar('request_id', { length: 120 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('admin_login_attempts_identity_idx').on(table.identity, table.createdAt)])

export const operationsUsers = mysqlTable('operations_users', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  role: varchar('role', { length: 32 }).$type<ItAccessRole>().default('viewer').notNull(),
  disabledAt: timestamp('disabled_at'),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [check('operations_users_role_check', sql`${table.role} IN ('super_admin', 'security_analyst', 'it_support', 'database_admin', 'infrastructure_admin', 'viewer')`)])

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
]).enableRLS()

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
  check('monitoring_detection_rules_condition_check', sql`${table.condition} IN ('login_failures', 'status_401', 'status_403', 'status_429', 'api_scanning', 'payment_callback_failures', 'abnormal_volume', 'password_reset_activity', 'database_slow_queries', 'database_connection_failures', 'provider_failures')`),
  check('monitoring_detection_rules_severity_check', sql`${table.severity} IN ('debug', 'info', 'warning', 'error', 'critical')`),
  check('monitoring_detection_rules_threshold_check', sql`${table.threshold} > 0 AND ${table.windowSeconds} > 0 AND ${table.cooldownSeconds} >= 0`),
]).enableRLS()

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
]).enableRLS()

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
]).enableRLS()

export const securityScans = mysqlTable('security_scans', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  scanId: varchar('scan_id', { length: 36 }).notNull().unique(),
  requestedByOperationsUserId: int('requested_by_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  requestedByAdminUserId: int('requested_by_admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 24 }).default('queued').notNull(),
  scope: varchar('scope', { length: 24 }).default('repository').notNull(),
  moduleCount: int('module_count').default(0).notNull(),
  findingCount: int('finding_count').default(0).notNull(),
  summary: jsonb('summary').$type<Record<string, string | number | boolean | null>>().default({}).notNull(),
  errorCode: varchar('error_code', { length: 80 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('security_scans_status_created_idx').on(table.status, table.createdAt),
  check('security_scans_status_check', sql`${table.status} IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')`),
  check('security_scans_scope_check', sql`${table.scope} IN ('repository', 'dependency', 'configuration', 'api', 'database', 'infrastructure', 'web')`),
])

export const securityScanModules = mysqlTable('security_scan_modules', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  scanId: int('scan_id').notNull().references(() => securityScans.id, { onDelete: 'cascade' }),
  module: varchar('module', { length: 40 }).notNull(),
  status: varchar('status', { length: 24 }).default('queued').notNull(),
  findingCount: int('finding_count').default(0).notNull(),
  unsupportedReason: text('unsupported_reason'),
  errorCode: varchar('error_code', { length: 80 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  unique('security_scan_modules_scan_module_unique').on(table.scanId, table.module),
  index('security_scan_modules_status_idx').on(table.status),
  check('security_scan_modules_status_check', sql`${table.status} IN ('queued', 'running', 'successful', 'partial', 'failed', 'unsupported', 'not_configured', 'cancelled')`),
])

export const securityFindings = mysqlTable('security_findings', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  findingId: varchar('finding_id', { length: 36 }).notNull().unique(),
  scanModuleId: int('scan_module_id').notNull().references(() => securityScanModules.id, { onDelete: 'cascade' }),
  deduplicationKey: varchar('deduplication_key', { length: 180 }).notNull(),
  source: varchar('source', { length: 40 }).notNull(),
  title: varchar('title', { length: 240 }).notNull(),
  description: text('description').notNull(),
  severity: varchar('severity', { length: 20 }),
  cve: varchar('cve', { length: 40 }),
  cwe: varchar('cwe', { length: 40 }),
  cvssScore: varchar('cvss_score', { length: 8 }),
  affectedComponent: varchar('affected_component', { length: 240 }),
  affectedFile: varchar('affected_file', { length: 500 }),
  affectedEndpoint: varchar('affected_endpoint', { length: 500 }),
  evidence: jsonb('evidence').$type<Record<string, string | number | boolean | null>>().default({}).notNull(),
  remediation: text('remediation'),
  lifecycleStatus: varchar('lifecycle_status', { length: 24 }).default('OPEN').notNull(),
  verificationStatus: varchar('verification_status', { length: 24 }).default('UNVERIFIED').notNull(),
  firstObservedAt: timestamp('first_observed_at').defaultNow().notNull(),
  lastObservedAt: timestamp('last_observed_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
}, (table) => [
  unique('security_findings_source_dedup_unique').on(table.source, table.deduplicationKey),
  index('security_findings_lifecycle_idx').on(table.lifecycleStatus, table.lastObservedAt),
  index('security_findings_severity_idx').on(table.severity, table.lastObservedAt),
  check('security_findings_severity_check', sql`${table.severity} IS NULL OR ${table.severity} IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL')`),
  check('security_findings_lifecycle_check', sql`${table.lifecycleStatus} IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'ACCEPTED_RISK', 'FALSE_POSITIVE')`),
  check('security_findings_verification_check', sql`${table.verificationStatus} IN ('UNVERIFIED', 'VERIFIED_FIXED', 'VERIFIED_NOT_FIXED')`),
])

export const securityFindingEvents = mysqlTable('security_finding_events', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  findingId: int('finding_id').notNull().references(() => securityFindings.id, { onDelete: 'cascade' }),
  actorOperationsUserId: int('actor_operations_user_id').references(() => operationsUsers.id, { onDelete: 'set null' }),
  fromStatus: varchar('from_status', { length: 24 }),
  toStatus: varchar('to_status', { length: 24 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('security_finding_events_finding_idx').on(table.findingId, table.createdAt)])

export const securityScannerHealth = mysqlTable('security_scanner_health', {
  scanner: varchar('scanner', { length: 40 }).primaryKey(),
  state: varchar('state', { length: 24 }).default('not_configured').notNull(),
  lastCheckedAt: timestamp('last_checked_at'),
  lastSuccessfulAt: timestamp('last_successful_at'),
  lastFailureAt: timestamp('last_failure_at'),
  failureCount: int('failure_count').default(0).notNull(),
  errorCode: varchar('error_code', { length: 80 }),
}, (table) => [check('security_scanner_health_state_check', sql`${table.state} IN ('healthy', 'degraded', 'failed', 'not_configured', 'unsupported')`)])

export const securityScanSchedules = mysqlTable('security_scan_schedules', {
  id: int('id').generatedByDefaultAsIdentity().primaryKey(),
  scheduleId: varchar('schedule_id', { length: 36 }).notNull().unique(),
  enabled: boolean('enabled').default(false).notNull(),
  scope: varchar('scope', { length: 24 }).default('repository').notNull(),
  cronExpression: varchar('cron_expression', { length: 120 }).notNull(),
  nextRunAt: timestamp('next_run_at'),
  lastRunAt: timestamp('last_run_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdateFn(() => new Date()).notNull(),
}, (table) => [index('security_scan_schedules_next_run_idx').on(table.enabled, table.nextRunAt)])

export const monitoringWorkerState = mysqlTable('monitoring_worker_state', {
  workerName: varchar('worker_name', { length: 80 }).primaryKey(),
  lastHeartbeatAt: timestamp('last_heartbeat_at'),
  lastSuccessAt: timestamp('last_success_at'),
  lastFailureAt: timestamp('last_failure_at'),
  failureCount: int('failure_count').default(0).notNull(),
  lastErrorCode: varchar('last_error_code', { length: 80 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdateFn(() => new Date()),
}, (table) => [index('monitoring_worker_state_heartbeat_idx').on(table.lastHeartbeatAt)]).enableRLS()
