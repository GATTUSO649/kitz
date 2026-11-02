import { adminDb } from '../../config/database.js'
import { monitoringEvents } from '../../database/admin-schema.js'
import type { MonitoringEvent } from './monitoring-events.js'

const maxQueueDepth = 5000
const batchSize = 100
const queue: MonitoringEvent[] = []
let scheduled = false
let flushing = false
let flushTimer: NodeJS.Timeout | null = null
let retryAttempt = 0
let droppedEvents = 0
let storageFailures = 0
let persistedEvents = 0
let lastPersistedAt: string | null = null
let lastFailureAt: string | null = null

export function enqueueMonitoringEvent(event: MonitoringEvent): boolean {
  if (!adminDb || queue.length >= maxQueueDepth) {
    droppedEvents += 1
    return false
  }
  queue.push(event)
  scheduleFlush()
  return true
}

export function getTelemetryQueueState() {
  const lastPersistedTime = lastPersistedAt ? Date.parse(lastPersistedAt) : null
  const freshness = !adminDb ? 'unavailable'
    : lastPersistedTime === null ? 'awaiting_first_event'
      : Date.now() - lastPersistedTime > 2 * 60_000 ? 'stale' : 'available'
  return {
    queueDepth: queue.length,
    droppedEvents,
    storageFailures,
    persistedEvents,
    lastPersistedAt,
    lastFailureAt,
    storageConfigured: Boolean(adminDb),
    freshness,
  }
}

export async function flushMonitoringEvents(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (queue.length > 0 && Date.now() < deadline) {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    scheduled = false
    await flushBatch()
    if (queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return queue.length === 0
}

function scheduleFlush(delayMs = 0) {
  if (scheduled) return
  scheduled = true
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushBatch()
  }, delayMs)
  flushTimer.unref()
}

async function flushBatch() {
  if (flushing) {
    scheduled = false
    scheduleFlush(50)
    return
  }
  scheduled = false
  flushTimer = null
  if (!adminDb || queue.length === 0) return
  flushing = true
  const batch = queue.splice(0, batchSize)
  try {
    const persisted = await adminDb.insert(monitoringEvents).values(batch.map((event) => ({
      ...event,
      occurredAt: new Date(event.occurredAt),
    }))).onConflictDoNothing({ target: monitoringEvents.eventId }).returning({ id: monitoringEvents.id })
    persistedEvents += persisted.length
    lastPersistedAt = new Date().toISOString()
    retryAttempt = 0
  } catch {
    storageFailures += 1
    lastFailureAt = new Date().toISOString()
    queue.unshift(...batch)
    retryAttempt = Math.min(retryAttempt + 1, 8)
  } finally {
    flushing = false
  }
  if (queue.length) scheduleFlush(retryAttempt ? Math.min(30_000, 250 * 2 ** retryAttempt) : 0)
}