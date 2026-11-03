import { availableParallelism } from 'node:os'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { recordRuntimeMeasurement } from './monitoring-recorder.js'

const sampleIntervalMs = 30_000
const cpuCoreCount = Math.max(1, availableParallelism())
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
let timer: NodeJS.Timeout | null = null
let previousCpuUsage = process.cpuUsage()
let previousSampleAt = performance.now()
let previousEventLoopUtilization = performance.eventLoopUtilization()
let startedAt: string | null = null

export function calculateProcessCpuPercent(userCpuMicros: number, systemCpuMicros: number, elapsedMs: number, coreCount = cpuCoreCount) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(coreCount) || coreCount <= 0) return null
  const cpuTimeMs = (Math.max(0, userCpuMicros) + Math.max(0, systemCpuMicros)) / 1000
  return Number(Math.min(100, cpuTimeMs / (elapsedMs * coreCount) * 100).toFixed(2))
}

export function startRuntimePerformanceSampler(intervalMs = sampleIntervalMs) {
  if (timer) return stopRuntimePerformanceSampler
  startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString()
  eventLoopDelay.enable()
  recordRuntimeMeasurement({
    sampleType: 'process_started',
    startedAt,
    uptimeSeconds: Number(process.uptime().toFixed(1)),
    nodeVersion: process.version,
    nodeEnvironment: process.env.NODE_ENV ?? 'unknown',
    hostCpuUtilizationPercent: null,
    hostMemoryBytes: null,
  })
  scheduleSample(intervalMs)
  return stopRuntimePerformanceSampler
}

export function stopRuntimePerformanceSampler() {
  if (timer) clearTimeout(timer)
  timer = null
  eventLoopDelay.disable()
}

function scheduleSample(intervalMs: number) {
  timer = setTimeout(() => {
    timer = null
    collectRuntimeSample()
    if (startedAt) scheduleSample(intervalMs)
  }, intervalMs)
  timer.unref()
}

function collectRuntimeSample() {
  const now = performance.now()
  const elapsedMs = Math.max(0, now - previousSampleAt)
  const cpuDelta = process.cpuUsage(previousCpuUsage)
  const eventLoopDelta = performance.eventLoopUtilization(previousEventLoopUtilization)
  const memory = process.memoryUsage()
  const eventLoopMeanDelayMs = Number.isFinite(eventLoopDelay.mean) ? Number((eventLoopDelay.mean / 1e6).toFixed(2)) : null
  const eventLoopP95DelayMs = Number.isFinite(eventLoopDelay.percentile(95)) ? Number((eventLoopDelay.percentile(95) / 1e6).toFixed(2)) : null
  const eventLoopP99DelayMs = Number.isFinite(eventLoopDelay.percentile(99)) ? Number((eventLoopDelay.percentile(99) / 1e6).toFixed(2)) : null

  recordRuntimeMeasurement({
    sampleType: 'process_performance',
    sampledAt: new Date().toISOString(),
    startedAt,
    uptimeSeconds: Number(process.uptime().toFixed(1)),
    nodeVersion: process.version,
    nodeEnvironment: process.env.NODE_ENV ?? 'unknown',
    processCpuPercentOfAvailableCapacity: calculateProcessCpuPercent(cpuDelta.user, cpuDelta.system, elapsedMs),
    processUserCpuMs: Number((cpuDelta.user / 1000).toFixed(2)),
    processSystemCpuMs: Number((cpuDelta.system / 1000).toFixed(2)),
    processRssBytes: memory.rss,
    processHeapUsedBytes: memory.heapUsed,
    processHeapTotalBytes: memory.heapTotal,
    processExternalBytes: memory.external,
    processArrayBuffersBytes: memory.arrayBuffers,
    runtimeAvailableMemoryBytes: typeof process.availableMemory === 'function' ? process.availableMemory() : null,
    runtimeConstrainedMemoryBytes: typeof process.constrainedMemory === 'function' ? process.constrainedMemory() || null : null,
    eventLoopUtilizationPercent: Number((eventLoopDelta.utilization * 100).toFixed(2)),
    eventLoopMeanDelayMs,
    eventLoopP95DelayMs,
    eventLoopP99DelayMs,
    logicalCpuCount: cpuCoreCount,
    hostCpuUtilizationPercent: null,
    hostMemoryBytes: null,
  })
  eventLoopDelay.reset()
  previousCpuUsage = process.cpuUsage()
  previousSampleAt = now
  previousEventLoopUtilization = performance.eventLoopUtilization()
}
