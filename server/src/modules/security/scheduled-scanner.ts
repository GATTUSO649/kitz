import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { adminDb } from '../../config/database.js'
import { monitoringWorkerState, securityScanModules, securityScanSchedules, securityScannerHealth, securityScans } from '../../database/admin-schema.js'
import { persistSecurityScan } from './scanner-persistence.js'
import { startSecurityScan } from './scanner-engine.js'

export const dependencyScanScheduleId = '00000000-0000-4000-8000-000000000013'
const workerName = 'dependency-scanner'
const pollIntervalMs = 30_000
const scanTimeoutMs = 15 * 60_000
const recoveryGraceMs = 5 * 60_000

let pollTimer: NodeJS.Timeout | null = null
let cycleRunning = false
let stopped = true

export function nextDailyRunAt(expression: string, from = new Date()) {
  const match = /^daily@(\d{2}):(\d{2})Z$/.exec(expression)
  if (!match) throw new Error('INVALID_DEPENDENCY_SCAN_SCHEDULE')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error('INVALID_DEPENDENCY_SCAN_SCHEDULE')
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute))
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export function dependencyScanRecoveryCutoff(now = new Date()) {
  return new Date(now.getTime() - scanTimeoutMs - recoveryGraceMs)
}

export function startDependencyScanWorker() {
  if (!adminDb || pollTimer) return stopDependencyScanWorker
  stopped = false
  void runDependencyScanCycle()
  pollTimer = setInterval(() => void runDependencyScanCycle(), pollIntervalMs)
  pollTimer.unref()
  return stopDependencyScanWorker
}

export async function stopDependencyScanWorker() {
  stopped = true
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  const deadline = Date.now() + 20_000
  while (cycleRunning && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
}

export async function runDependencyScanCycle(now = new Date()) {
  if (cycleRunning || !adminDb || stopped) return false
  cycleRunning = true
  try {
    await adminDb.insert(monitoringWorkerState).values({
      workerName,
      lastHeartbeatAt: now,
      lastSuccessAt: now,
      failureCount: 0,
      lastErrorCode: null,
    }).onConflictDoUpdate({
      target: monitoringWorkerState.workerName,
      set: { lastHeartbeatAt: now, lastSuccessAt: now, failureCount: 0, lastErrorCode: null, updatedAt: now },
    })

    const staleScans = await adminDb.select({ id: securityScans.id }).from(securityScans).where(and(
      inArray(securityScans.status, ['queued', 'running']),
      lte(securityScans.createdAt, dependencyScanRecoveryCutoff(now)),
    ))
    for (const staleScan of staleScans) {
      await adminDb.update(securityScanModules).set({ status: 'failed', errorCode: 'WORKER_INTERRUPTED', completedAt: now })
        .where(and(eq(securityScanModules.scanId, staleScan.id), inArray(securityScanModules.status, ['queued', 'running'])))
      await adminDb.update(securityScans).set({ status: 'failed', errorCode: 'WORKER_INTERRUPTED', completedAt: now })
        .where(eq(securityScans.id, staleScan.id))
    }

    const [dueSchedule] = await adminDb.select({
      id: securityScanSchedules.id,
      cronExpression: securityScanSchedules.cronExpression,
    }).from(securityScanSchedules).where(and(
      eq(securityScanSchedules.scheduleId, dependencyScanScheduleId),
      eq(securityScanSchedules.enabled, true),
      lte(securityScanSchedules.nextRunAt, now),
    )).limit(1)

    if (!dueSchedule) return true
    const [schedule] = await adminDb.update(securityScanSchedules).set({
      lastRunAt: now,
      nextRunAt: nextDailyRunAt(dueSchedule.cronExpression, now),
    }).where(and(
      eq(securityScanSchedules.id, dueSchedule.id),
      eq(securityScanSchedules.enabled, true),
      lte(securityScanSchedules.nextRunAt, now),
    )).returning({ id: securityScanSchedules.id })
    if (!schedule) return true
    const scan = await startSecurityScan(['dependency'], process.cwd(), scanTimeoutMs, async (current) => {
      await persistSecurityScan(adminDb!, current)
      if (!current.completedAt) return
      const state = current.status === 'completed' ? 'healthy' : 'failed'
      await adminDb!.insert(securityScannerHealth).values({
        scanner: 'npm-audit',
        state,
        lastCheckedAt: new Date(current.completedAt),
        ...(state === 'healthy' ? { lastSuccessfulAt: new Date(current.completedAt) } : { lastFailureAt: new Date(current.completedAt) }),
        failureCount: state === 'healthy' ? 0 : 1,
        errorCode: current.errorCode ?? null,
      }).onConflictDoUpdate({
        target: securityScannerHealth.scanner,
        set: {
          state,
          lastCheckedAt: new Date(current.completedAt),
          ...(state === 'healthy' ? { lastSuccessfulAt: new Date(current.completedAt), failureCount: 0, errorCode: null } : { lastFailureAt: new Date(current.completedAt), failureCount: 1, errorCode: current.errorCode ?? 'SCAN_FAILED' }),
        },
      })
    })
    if (scan.status === 'running') return true
    return false
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SECURITY_SCAN_CONFLICT') {
      await adminDb.update(securityScanSchedules).set({ nextRunAt: new Date(now.getTime() + pollIntervalMs) })
        .where(eq(securityScanSchedules.scheduleId, dependencyScanScheduleId)).catch(() => undefined)
      return true
    }
    await adminDb.insert(monitoringWorkerState).values({
      workerName,
      lastHeartbeatAt: now,
      lastFailureAt: now,
      failureCount: 1,
      lastErrorCode: 'DEPENDENCY_SCAN_CYCLE_FAILED',
    }).onConflictDoUpdate({
      target: monitoringWorkerState.workerName,
      set: {
        lastHeartbeatAt: now,
        lastFailureAt: now,
        failureCount: sql`${monitoringWorkerState.failureCount} + 1`,
        lastErrorCode: 'DEPENDENCY_SCAN_CYCLE_FAILED',
        updatedAt: now,
      },
    }).catch(() => undefined)
    return false
  } finally {
    cycleRunning = false
  }
}