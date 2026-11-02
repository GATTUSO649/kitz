import { and, eq, gt, gte, lt, sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { PoolClient } from 'pg'
import { adminDb, adminPool } from '../../config/database.js'
import * as adminSchema from '../../database/admin-schema.js'
import {
  monitoringAlerts,
  monitoringDetectionHistory,
  monitoringDetectionRules,
  monitoringEvents,
  monitoringWorkerState,
} from '../../database/admin-schema.js'

const workerName = 'monitoring-detection'
const advisoryLockId = 741923861
const pollIntervalMs = 30_000
const retentionWorkerName = 'monitoring-retention'
const retentionDays = 30
const ruleDefaults = [
  { ruleId: 'repeated-login-failures', name: 'Repeated login failures', description: 'Repeated failed login requests on one normalized endpoint.', condition: 'login_failures', threshold: 10, windowSeconds: 300, severity: 'warning', cooldownSeconds: 900, recommendedResponse: 'Review the affected endpoint and authentication telemetry. Do not block accounts based on this signal alone.' },
  { ruleId: 'repeated-401-responses', name: 'Repeated unauthorized responses', description: 'A high volume of unauthorized responses on one normalized endpoint.', condition: 'status_401', threshold: 30, windowSeconds: 300, severity: 'warning', cooldownSeconds: 900, recommendedResponse: 'Correlate with authentication failures and expected client behavior.' },
  { ruleId: 'repeated-403-responses', name: 'Repeated forbidden responses', description: 'A high volume of forbidden responses on one normalized endpoint.', condition: 'status_403', threshold: 30, windowSeconds: 300, severity: 'warning', cooldownSeconds: 900, recommendedResponse: 'Review authorization logs and confirm whether the activity is expected.' },
  { ruleId: 'repeated-429-responses', name: 'Repeated rate-limit responses', description: 'A high volume of rate-limited responses on one normalized endpoint.', condition: 'status_429', threshold: 40, windowSeconds: 300, severity: 'warning', cooldownSeconds: 900, recommendedResponse: 'Correlate with application load and rate-limit configuration before escalation.' },
  { ruleId: 'unmatched-route-scan', name: 'Unmatched route activity', description: 'Repeated requests that did not match a registered route.', condition: 'api_scanning', threshold: 50, windowSeconds: 300, severity: 'warning', cooldownSeconds: 900, recommendedResponse: 'Review aggregate route-miss patterns; no individual client is automatically blocked.' },
  { ruleId: 'payment-callback-failures', name: 'Payment callback failures', description: 'Repeated failed responses from the M-Pesa callback route.', condition: 'payment_callback_failures', threshold: 5, windowSeconds: 300, severity: 'error', cooldownSeconds: 600, recommendedResponse: 'Review safe callback diagnostics and reconcile transaction state through the existing verified payment workflow.' },
  { ruleId: 'password-reset-activity', name: 'Password reset activity', description: 'Unusually high request volume on password recovery endpoints.', condition: 'password_reset_activity', threshold: 20, windowSeconds: 600, severity: 'warning', cooldownSeconds: 1800, recommendedResponse: 'Review authentication telemetry and confirm the recovery flow is behaving normally.' },
  { ruleId: 'abnormal-request-volume', name: 'Abnormal request volume', description: 'Unusually high total request volume across the application.', condition: 'abnormal_volume', threshold: 3000, windowSeconds: 300, severity: 'warning', cooldownSeconds: 900, recommendedResponse: 'Compare the observed traffic rate with expected application usage and provider telemetry.' },
] as const

let interval: NodeJS.Timeout | null = null
let cycleRunning = false
let consecutiveFailures = 0
let workerStopped = true

const status = sql<number>`(${monitoringEvents.metadata}->>'status')::integer`
const route = sql<string>`(${monitoringEvents.metadata}->>'route')`

function ruleFilter(condition: string) {
  switch (condition) {
    case 'login_failures': return and(eq(status, 401), sql`${route} ILIKE '%login%'`)
    case 'status_401': return eq(status, 401)
    case 'status_403': return eq(status, 403)
    case 'status_429': return eq(status, 429)
    case 'api_scanning': return and(eq(status, 404), eq(route, 'unmatched'))
    case 'payment_callback_failures': return and(gt(status, 399), sql`${route} ILIKE '%mpesa/callback%'`)
    case 'password_reset_activity': return sql`${route} ILIKE '%password%' AND (${route} ILIKE '%reset%' OR ${route} ILIKE '%forgot%')`
    case 'abnormal_volume': return sql`true`
    default: return sql`false`
  }
}

function groupExpression(condition: string) {
  return condition === 'abnormal_volume'
    ? monitoringEvents.sourceService
    : sql<string>`COALESCE(${route}, 'unknown')`
}

export function startMonitoringWorker() {
  if (interval || !adminDb || !adminPool) return () => undefined
  workerStopped = false
  const schedule = (delayMs: number) => {
    if (workerStopped) return
    interval = setTimeout(async () => {
      interval = null
      const succeeded = await runMonitoringCycle()
      consecutiveFailures = succeeded ? 0 : Math.min(consecutiveFailures + 1, 5)
      const delay = Math.min(300_000, pollIntervalMs * 2 ** consecutiveFailures)
      if (!workerStopped) schedule(delay)
    }, delayMs)
    interval.unref()
  }
  schedule(0)
  return stopMonitoringWorker
}

export async function stopMonitoringWorker() {
  workerStopped = true
  if (interval) clearTimeout(interval)
  interval = null
  const deadline = Date.now() + 20_000
  while (cycleRunning && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export async function runMonitoringCycle() {
  if (cycleRunning || !adminDb || !adminPool) return false
  cycleRunning = true
  let lockClient: PoolClient | null = null
  let transactionOpen = false
  try {
    lockClient = await adminPool.connect()
    await lockClient.query('BEGIN')
    transactionOpen = true
    const lock = await lockClient.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [advisoryLockId])
    if (!lock.rows[0]?.locked) {
      await lockClient.query('ROLLBACK')
      transactionOpen = false
      return false
    }
    await lockClient.query("SET LOCAL statement_timeout = '15000'")
    const workerDb = drizzle(lockClient, { schema: adminSchema })
    const now = new Date()
    await seedDetectionRules(workerDb)
    const rules = await workerDb.select().from(monitoringDetectionRules).where(eq(monitoringDetectionRules.enabled, true))
    for (const rule of rules) await evaluateRule(workerDb, rule, now)
    await cleanupRetainedEvents(workerDb, now)
    await workerDb.insert(monitoringWorkerState).values({
      workerName,
      lastHeartbeatAt: now,
      lastSuccessAt: now,
      failureCount: 0,
      lastErrorCode: null,
    }).onConflictDoUpdate({
      target: monitoringWorkerState.workerName,
      set: { lastHeartbeatAt: now, lastSuccessAt: now, failureCount: 0, lastErrorCode: null, updatedAt: now },
    })
    await lockClient.query('COMMIT')
    transactionOpen = false
    return true
  } catch {
    if (transactionOpen && lockClient) {
      try { await lockClient.query('ROLLBACK') } catch { /* The pool discards a broken transaction. */ }
      transactionOpen = false
    }
    const now = new Date()
    try {
      await adminDb.insert(monitoringWorkerState).values({
        workerName,
        lastHeartbeatAt: now,
        lastFailureAt: now,
        failureCount: 1,
        lastErrorCode: 'MONITORING_CYCLE_FAILED',
      }).onConflictDoUpdate({
        target: monitoringWorkerState.workerName,
        set: {
          lastHeartbeatAt: now,
          lastFailureAt: now,
          failureCount: sql`${monitoringWorkerState.failureCount} + 1`,
          lastErrorCode: 'MONITORING_CYCLE_FAILED',
          updatedAt: now,
        },
      })
    } catch { /* Worker health persistence is best effort during a database failure. */ }
    return false
  } finally {
    if (lockClient) {
      if (transactionOpen) {
        try { await lockClient.query('ROLLBACK') } catch { /* The pool discards a broken transaction. */ }
      }
      lockClient.release()
    }
    cycleRunning = false
  }
}

type WorkerDatabase = NodePgDatabase<typeof adminSchema>

async function cleanupRetainedEvents(database: WorkerDatabase, now: Date) {
  const [retentionState] = await database.select({ lastSuccessAt: monitoringWorkerState.lastSuccessAt })
    .from(monitoringWorkerState).where(eq(monitoringWorkerState.workerName, retentionWorkerName)).limit(1)
  if (retentionState?.lastSuccessAt && now.getTime() - retentionState.lastSuccessAt.getTime() < 24 * 60 * 60_000) return
  await database.delete(monitoringEvents).where(lt(monitoringEvents.occurredAt, new Date(now.getTime() - retentionDays * 24 * 60 * 60_000)))
  await database.insert(monitoringWorkerState).values({
    workerName: retentionWorkerName,
    lastHeartbeatAt: now,
    lastSuccessAt: now,
    failureCount: 0,
  }).onConflictDoUpdate({
    target: monitoringWorkerState.workerName,
    set: { lastHeartbeatAt: now, lastSuccessAt: now, failureCount: 0, lastErrorCode: null, updatedAt: now },
  })
}

async function seedDetectionRules(database: WorkerDatabase) {
  await database.insert(monitoringDetectionRules).values(ruleDefaults.map((rule) => ({
    ...rule,
    severity: rule.severity,
    enabled: true,
  }))).onConflictDoNothing({ target: monitoringDetectionRules.ruleId })
}

async function evaluateRule(database: WorkerDatabase, rule: typeof monitoringDetectionRules.$inferSelect, now: Date) {
  const windowStart = new Date(now.getTime() - rule.windowSeconds * 1000)
  const filter = ruleFilter(rule.condition)
  const group = groupExpression(rule.condition)
  const matches = await database.select({
    groupKey: group,
    matchCount: sql<number>`count(*)`,
    latestEventId: sql<number>`max(${monitoringEvents.id})`,
    affectedService: monitoringEvents.sourceService,
  }).from(monitoringEvents).where(and(
    eq(monitoringEvents.category, 'request'),
    eq(monitoringEvents.eventType, 'http.request.completed'),
    gte(monitoringEvents.occurredAt, windowStart),
    filter,
  )).groupBy(group, monitoringEvents.sourceService)

  for (const match of matches) {
    const [history] = await database.select().from(monitoringDetectionHistory).where(and(
      eq(monitoringDetectionHistory.ruleId, rule.ruleId),
      eq(monitoringDetectionHistory.groupKey, match.groupKey),
    )).limit(1)
    const newlyMatched = await database.select({ total: sql<number>`count(*)` }).from(monitoringEvents).where(and(
      eq(monitoringEvents.category, 'request'),
      eq(monitoringEvents.eventType, 'http.request.completed'),
      gt(monitoringEvents.id, history?.lastEventId ?? 0),
      gte(monitoringEvents.occurredAt, windowStart),
      filter,
      rule.condition === 'abnormal_volume'
        ? eq(monitoringEvents.sourceService, match.affectedService)
        : eq(route, match.groupKey),
    ))
    const newCount = Number(newlyMatched[0]?.total ?? 0)
    const shouldAlert = Number(match.matchCount) >= rule.threshold
      && newCount > 0
      && (!history?.lastAlertedAt || now.getTime() - history.lastAlertedAt.getTime() >= rule.cooldownSeconds * 1000)
    if (shouldAlert) {
      const deduplicationKey = `${rule.ruleId}:${match.groupKey}`.slice(0, 180)
      const description = `${rule.name}: ${Number(match.matchCount)} matching requests were observed in ${rule.windowSeconds} seconds on ${match.groupKey}.`
      await database.insert(monitoringAlerts).values({
        deduplicationKey,
        detectionRuleId: rule.id,
        sourceEventId: Number(match.latestEventId),
        severity: rule.severity,
        description,
        affectedService: match.affectedService,
        occurrenceCount: newCount,
        firstOccurrence: now,
        lastOccurrence: now,
        notificationSuppressedUntil: new Date(now.getTime() + rule.cooldownSeconds * 1000),
      }).onConflictDoUpdate({
        target: monitoringAlerts.deduplicationKey,
        set: {
          sourceEventId: Number(match.latestEventId),
          severity: rule.severity,
          description,
          lastOccurrence: now,
          occurrenceCount: sql`${monitoringAlerts.occurrenceCount} + ${newCount}`,
          notificationSuppressedUntil: new Date(now.getTime() + rule.cooldownSeconds * 1000),
          status: sql`CASE WHEN ${monitoringAlerts.status} IN ('resolved', 'closed') THEN 'new' ELSE ${monitoringAlerts.status} END`,
          updatedAt: now,
        },
      })
    }
    await database.insert(monitoringDetectionHistory).values({
      ruleId: rule.ruleId,
      groupKey: match.groupKey,
      lastEventId: Number(match.latestEventId),
      lastEvaluatedAt: now,
      lastAlertedAt: shouldAlert ? now : history?.lastAlertedAt ?? null,
      lastMatchCount: Number(match.matchCount),
    }).onConflictDoUpdate({
      target: [monitoringDetectionHistory.ruleId, monitoringDetectionHistory.groupKey],
      set: {
        lastEventId: Number(match.latestEventId),
        lastEvaluatedAt: now,
        lastAlertedAt: shouldAlert ? now : history?.lastAlertedAt ?? null,
        lastMatchCount: Number(match.matchCount),
      },
    })
  }
}
