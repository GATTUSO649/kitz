import { createMonitoringEvent } from './monitoring-events.js'
import { env } from '../../config/env.js'
import { getMonitoringContext } from './monitoring-context.js'
import type { DatabaseMeasurement } from './postgres-monitoring.js'
import { enqueueMonitoringEvent } from './telemetry-store.js'

const latencyBoundsMs = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 10000]
const defaultFlushIntervalMs = 30_000
const measurements = new Map<string, DatabaseAggregate>()
const instanceId = process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local'
let flushTimer: NodeJS.Timeout | null = null

type DatabaseAggregate = {
  eventType: DatabaseMeasurement['eventType']
  operation: string
  sampleCount: number
  successCount: number
  failureCount: number
  slowCount: number
  durationTotalMs: number
  minDurationMs: number
  maxDurationMs: number
  latencyBucketCounts: number[]
  firstSampleAt: number
  lastSampleAt: number
}

export type DatabaseAggregateEvent = {
  instanceId: string
  occurredAt: Date | string
  metadata: Record<string, unknown>
}

export type DatabasePerformanceSummary = {
  metricType: string
  operation: string
  sampleCount: number
  successCount: number
  failureCount: number
  slowCount: number
  averageDurationMs: number
  minDurationMs: number
  maxDurationMs: number
  p50DurationMs: number | null
  p95DurationMs: number | null
  p99DurationMs: number | null
  histogramEstimate: true
  latencyBucketBoundsMs: string
  latencyBucketCounts: string
  instanceCount: number
  windowStartedAt: string
  windowEndedAt: string
}

export function recordDatabaseMeasurement(measurement: DatabaseMeasurement) {
  const durationMs = typeof measurement.metadata.durationMs === 'number'
    ? measurement.metadata.durationMs
    : typeof measurement.metadata.waitMs === 'number' ? measurement.metadata.waitMs : null
  if (durationMs === null) return
  const operation = typeof measurement.metadata.operation === 'string'
    ? measurement.metadata.operation
    : measurement.eventType === 'database.connection.acquired' ? 'CONNECTION' : 'TRANSACTION'
  const key = `${measurement.eventType}:${operation}`
  const aggregate = measurements.get(key) ?? {
    eventType: measurement.eventType,
    operation,
    sampleCount: 0,
    successCount: 0,
    failureCount: 0,
    slowCount: 0,
    durationTotalMs: 0,
    minDurationMs: Number.POSITIVE_INFINITY,
    maxDurationMs: 0,
    latencyBucketCounts: latencyBoundsMs.map(() => 0).concat(0),
    firstSampleAt: Date.now(),
    lastSampleAt: Date.now(),
  }
  const sampledAt = Date.now()
  aggregate.firstSampleAt = Math.min(aggregate.firstSampleAt, sampledAt)
  aggregate.lastSampleAt = Math.max(aggregate.lastSampleAt, sampledAt)
  aggregate.sampleCount += 1
  aggregate.durationTotalMs += durationMs
  aggregate.minDurationMs = Math.min(aggregate.minDurationMs, durationMs)
  aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, durationMs)
  const failed = measurement.metadata.outcome === 'failed'
  aggregate.failureCount += failed ? 1 : 0
  aggregate.successCount += failed ? 0 : 1
  aggregate.slowCount += durationMs >= env.DATABASE_SLOW_QUERY_WARNING_MS ? 1 : 0
  const bucketIndex = latencyBoundsMs.findIndex((bound) => durationMs <= bound)
  aggregate.latencyBucketCounts[bucketIndex < 0 ? latencyBoundsMs.length : bucketIndex] += 1
  measurements.set(key, aggregate)

  if (failed || (measurement.eventType === 'database.query.completed' && durationMs >= env.DATABASE_SLOW_QUERY_WARNING_MS)) {
    const context = getMonitoringContext()
    recordEvent({
      eventType: failed ? 'database.operation.failed' : 'database.query.slow',
      severity: failed ? measurement.severity : durationMs >= env.DATABASE_SLOW_QUERY_CRITICAL_MS ? 'critical' : durationMs >= env.DATABASE_SLOW_QUERY_ERROR_MS ? 'error' : 'warning',
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
      metadata: {
        eventType: measurement.eventType,
        operation,
        durationMs,
        ...(typeof measurement.metadata.queryFingerprint === 'string' ? { queryFingerprint: measurement.metadata.queryFingerprint } : {}),
        ...(typeof measurement.metadata.sqlState === 'string' ? { sqlState: measurement.metadata.sqlState } : {}),
        ...(typeof measurement.metadata.errorCategory === 'string' ? { errorCategory: measurement.metadata.errorCategory } : {}),
        ...(typeof measurement.route === 'string' ? { route: measurement.route } : {}),
      },
    })
  }
  if (!flushTimer) scheduleFlush(defaultFlushIntervalMs)
}

export function flushDatabasePerformanceMetrics() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!measurements.size) return 0
  const batch = [...measurements.entries()]
  measurements.clear()
  let enqueued = 0
  for (const [key, aggregate] of batch) {
    const accepted = recordEvent({
      eventType: 'database.performance.aggregate',
      severity: 'info',
      metadata: {
        metricType: aggregate.eventType,
        operation: aggregate.operation,
        sampleCount: aggregate.sampleCount,
        successCount: aggregate.successCount,
        failureCount: aggregate.failureCount,
        slowCount: aggregate.slowCount,
        slowQueryThresholdMs: env.DATABASE_SLOW_QUERY_WARNING_MS,
        errorThresholdMs: env.DATABASE_SLOW_QUERY_ERROR_MS,
        criticalThresholdMs: env.DATABASE_SLOW_QUERY_CRITICAL_MS,
        durationTotalMs: Number(aggregate.durationTotalMs.toFixed(2)),
        minDurationMs: Number(aggregate.minDurationMs.toFixed(2)),
        maxDurationMs: Number(aggregate.maxDurationMs.toFixed(2)),
        latencyBucketBoundsMs: `${latencyBoundsMs.join(',')},gt10000`,
        latencyBucketCounts: aggregate.latencyBucketCounts.join(','),
        windowStartedAt: new Date(aggregate.firstSampleAt).toISOString(),
        windowEndedAt: new Date(aggregate.lastSampleAt).toISOString(),
        instanceSampleCount: aggregate.sampleCount,
      },
    })
    enqueued += accepted ? 1 : 0
    if (!accepted) {
      const current = measurements.get(key)
      if (current) mergeAggregate(current, aggregate)
      else measurements.set(key, aggregate)
    }
  }
  if (measurements.size && !flushTimer) scheduleFlush(defaultFlushIntervalMs)
  return enqueued
}

export function startDatabasePerformanceCollector(intervalMs = defaultFlushIntervalMs) {
  if (flushTimer) return stopDatabasePerformanceCollector
  scheduleFlush(intervalMs)
  return stopDatabasePerformanceCollector
}

export function stopDatabasePerformanceCollector() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
}

function scheduleFlush(intervalMs: number) {
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushDatabasePerformanceMetrics()
    if (measurements.size) scheduleFlush(defaultFlushIntervalMs)
  }, intervalMs)
  flushTimer.unref()
}

function mergeAggregate(target: DatabaseAggregate, source: DatabaseAggregate) {
  target.sampleCount += source.sampleCount
  target.successCount += source.successCount
  target.failureCount += source.failureCount
  target.slowCount += source.slowCount
  target.durationTotalMs += source.durationTotalMs
  target.minDurationMs = Math.min(target.minDurationMs, source.minDurationMs)
  target.maxDurationMs = Math.max(target.maxDurationMs, source.maxDurationMs)
  target.latencyBucketCounts = target.latencyBucketCounts.map((count, index) => count + source.latencyBucketCounts[index])
  target.firstSampleAt = Math.min(target.firstSampleAt, source.firstSampleAt)
  target.lastSampleAt = Math.max(target.lastSampleAt, source.lastSampleAt)
}

export function summarizeDatabaseAggregates(rows: DatabaseAggregateEvent[]): DatabasePerformanceSummary[] {
  const grouped = new Map<string, {
    metricType: string
    operation: string
    sampleCount: number
    successCount: number
    failureCount: number
    slowCount: number
    durationTotalMs: number
    minDurationMs: number
    maxDurationMs: number
    bucketCounts: number[]
    instances: Set<string>
    firstSampleAt: number
    lastSampleAt: number
  }>()
  for (const row of rows) {
    const metadata = row.metadata
    const metricType = typeof metadata.metricType === 'string' ? metadata.metricType : 'unknown'
    const operation = typeof metadata.operation === 'string' ? metadata.operation : 'OTHER'
    const key = `${metricType}:${operation}`
    const sampleCount = safeCount(metadata.sampleCount)
    const bucketCounts = parseCounts(metadata.latencyBucketCounts)
    const firstSampleAt = parseTimestamp(metadata.windowStartedAt, row.occurredAt)
    const lastSampleAt = parseTimestamp(metadata.windowEndedAt, row.occurredAt)
    const current = grouped.get(key) ?? {
      metricType,
      operation,
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      slowCount: 0,
      durationTotalMs: 0,
      minDurationMs: Number.POSITIVE_INFINITY,
      maxDurationMs: 0,
      bucketCounts: [],
      instances: new Set<string>(),
      firstSampleAt,
      lastSampleAt,
    }
    current.sampleCount += sampleCount
    current.successCount += safeCount(metadata.successCount)
    current.failureCount += safeCount(metadata.failureCount)
    current.slowCount += safeCount(metadata.slowCount)
    current.durationTotalMs += safeNumber(metadata.durationTotalMs)
    current.minDurationMs = Math.min(current.minDurationMs, safeNumber(metadata.minDurationMs, Number.POSITIVE_INFINITY))
    current.maxDurationMs = Math.max(current.maxDurationMs, safeNumber(metadata.maxDurationMs))
    current.bucketCounts = mergeCounts(current.bucketCounts, bucketCounts)
    current.instances.add(row.instanceId)
    current.firstSampleAt = Math.min(current.firstSampleAt, firstSampleAt)
    current.lastSampleAt = Math.max(current.lastSampleAt, lastSampleAt)
    grouped.set(key, current)
  }
  return [...grouped.values()].map((item) => ({
    metricType: item.metricType,
    operation: item.operation,
    sampleCount: item.sampleCount,
    successCount: item.successCount,
    failureCount: item.failureCount,
    slowCount: item.slowCount,
    averageDurationMs: item.sampleCount ? Number((item.durationTotalMs / item.sampleCount).toFixed(2)) : 0,
    minDurationMs: Number(item.minDurationMs.toFixed(2)),
    maxDurationMs: Number(item.maxDurationMs.toFixed(2)),
    p50DurationMs: histogramPercentile(item.bucketCounts, item.sampleCount, 0.5),
    p95DurationMs: histogramPercentile(item.bucketCounts, item.sampleCount, 0.95),
    p99DurationMs: histogramPercentile(item.bucketCounts, item.sampleCount, 0.99),
    histogramEstimate: true as const,
    latencyBucketBoundsMs: `${latencyBoundsMs.join(',')},gt10000`,
    latencyBucketCounts: item.bucketCounts.join(','),
    instanceCount: item.instances.size,
    windowStartedAt: new Date(item.firstSampleAt).toISOString(),
    windowEndedAt: new Date(item.lastSampleAt).toISOString(),
  })).sort((left, right) => left.metricType.localeCompare(right.metricType) || left.operation.localeCompare(right.operation))
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function safeCount(value: unknown) {
  return Math.max(0, Math.trunc(safeNumber(value)))
}

function parseCounts(value: unknown) {
  if (typeof value !== 'string') return []
  return value.split(',').map((item) => Math.max(0, Number.parseInt(item, 10) || 0))
}

function mergeCounts(left: number[], right: number[]) {
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => (left[index] ?? 0) + (right[index] ?? 0))
}

function parseTimestamp(value: unknown, fallback: Date | string) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  const fallbackTime = fallback instanceof Date ? fallback.getTime() : Date.parse(fallback)
  return Number.isFinite(parsed) ? parsed : Number.isFinite(fallbackTime) ? fallbackTime : Date.now()
}

function histogramPercentile(bucketCounts: number[], sampleCount: number, percentile: number) {
  if (!sampleCount || !bucketCounts.length) return null
  const target = Math.ceil(sampleCount * percentile)
  let cumulative = 0
  for (let index = 0; index < bucketCounts.length; index += 1) {
    cumulative += bucketCounts[index]
    if (cumulative >= target) {
      if (index >= latencyBoundsMs.length) return null
      return latencyBoundsMs[index]
    }
  }
  return null
}

function recordEvent(input: {
  eventType: string
  severity: DatabaseMeasurement['severity']
  requestId?: string
  correlationId?: string
  metadata: Record<string, string | number | boolean | null>
}) {
  try {
    const event = createMonitoringEvent({
      eventType: input.eventType,
      category: 'system',
      severity: input.severity,
      sourceService: 'kitculture-api',
      instanceId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      metadata: input.metadata,
    })
    return enqueueMonitoringEvent(event)
  } catch {
    return false
  }
}
