import { randomUUID } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import { createMonitoringEvent } from '../modules/operations/monitoring-events.js'
import { enqueueMonitoringEvent } from '../modules/operations/telemetry-store.js'

export type RequestMetric = {
  at: number
  method: string
  endpoint: string
  status: number
  durationMs: number
}

const metrics: RequestMetric[] = []
const maxSamples = 5000

function endpointTemplate(request: Request) {
  const route = request.route?.path
  return typeof route === 'string' ? `${request.baseUrl}${route}` : 'unmatched'
}

function userAgentCategory(request: Request) {
  const userAgent = request.get('user-agent')?.toLowerCase() ?? ''
  if (!userAgent) return 'unknown'
  if (/bot|crawler|spider|preview/.test(userAgent)) return 'bot'
  if (/ipad|tablet/.test(userAgent)) return 'tablet'
  if (/mobile|android|iphone/.test(userAgent)) return 'mobile'
  return 'desktop'
}

function originHost(request: Request) {
  const origin = request.get('origin')
  if (!origin) return 'none'
  try { return new URL(origin).host.slice(0, 120) } catch { return 'invalid' }
}

function safeCorrelationId(request: Request) {
  const value = request.get('x-correlation-id')
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined
}

export const requestMetrics: RequestHandler = (request, response, next) => {
  const startedAt = performance.now()
  const telemetryRequestId = randomUUID()
  const correlationId = safeCorrelationId(request)
  response.once('finish', () => {
    const at = Date.now()
    const endpoint = endpointTemplate(request)
    const durationMs = Math.max(0, performance.now() - startedAt)
    const authenticated = Boolean('auth' in request || 'admin' in request || 'operationsUser' in request)
    metrics.push({
      at,
      method: request.method,
      endpoint,
      status: response.statusCode,
      durationMs,
    })
    if (metrics.length > maxSamples) metrics.splice(0, metrics.length - maxSamples)
    try {
      const event = createMonitoringEvent({
        eventType: 'http.request.completed',
        category: 'request',
        severity: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warning' : 'info',
        sourceService: 'kitculture-api',
        instanceId: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local',
        requestId: telemetryRequestId,
        ...(correlationId ? { correlationId } : {}),
        metadata: {
          method: request.method,
          route: endpoint,
          status: response.statusCode,
          durationMs: Number(durationMs.toFixed(1)),
          responseBytes: Number(response.getHeader('content-length')) || null,
          userAgentCategory: userAgentCategory(request),
          originHost: originHost(request),
          authentication: authenticated ? 'authenticated' : 'anonymous',
          rateLimitOutcome: response.statusCode === 429 ? 'limited' : 'unknown',
        },
      })
      enqueueMonitoringEvent(event)
      if ([401, 403, 429].includes(response.statusCode)) {
        enqueueMonitoringEvent(createMonitoringEvent({
          eventType: 'http.security_signal',
          category: 'security',
          severity: 'info',
          sourceService: 'kitculture-api',
          instanceId: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local',
          requestId: telemetryRequestId,
          metadata: { route: endpoint, status: response.statusCode, signal: 'http_response_status' },
        }))
      }
      if (response.statusCode >= 500) {
        enqueueMonitoringEvent(createMonitoringEvent({
          eventType: 'application.http_failure',
          category: 'application',
          severity: 'error',
          sourceService: 'kitculture-api',
          instanceId: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local',
          requestId: telemetryRequestId,
          metadata: { route: endpoint, status: response.statusCode },
        }))
      }
    } catch {
      // Telemetry collection is isolated from the completed customer response.
    }
  })
  next()
}

export function getRequestMetrics(windowMs = 60 * 60_000, now = Date.now()) {
  const start = now - windowMs
  const bucketCount = 12
  const bucketDurationMs = windowMs / bucketCount
  while (metrics.length && metrics[0].at < start) metrics.shift()
  const samples = metrics.filter((metric) => metric.at >= start)
  const sortedDurations = samples.map(({ durationMs }) => durationMs).sort((a, b) => a - b)
  const endpoints = new Map<string, { requests: number; errors: number; totalDurationMs: number }>()
  const methods = new Map<string, number>()
  const responseDistribution = { success: 0, redirect: 0, clientError: 0, serverError: 0 }
  const timelineBuckets = Array.from({ length: bucketCount }, (_, index) => ({
    bucketStartedAt: new Date(start + index * bucketDurationMs).toISOString(),
    requestCount: 0,
    errorCount: 0,
    serverErrorCount: 0,
    securitySignalCount: 0,
    totalDurationMs: 0,
    durations: [] as number[],
  }))
  for (const sample of samples) {
    const key = `${sample.method} ${sample.endpoint}`
    const current = endpoints.get(key) ?? { requests: 0, errors: 0, totalDurationMs: 0 }
    current.requests += 1
    current.errors += sample.status >= 400 ? 1 : 0
    current.totalDurationMs += sample.durationMs
    endpoints.set(key, current)
    methods.set(sample.method, (methods.get(sample.method) ?? 0) + 1)
    if (sample.status < 300) responseDistribution.success += 1
    else if (sample.status < 400) responseDistribution.redirect += 1
    else if (sample.status < 500) responseDistribution.clientError += 1
    else responseDistribution.serverError += 1

    const bucketIndex = Math.min(bucketCount - 1, Math.floor((sample.at - start) / bucketDurationMs))
    const bucket = timelineBuckets[bucketIndex]
    bucket.requestCount += 1
    bucket.errorCount += sample.status >= 400 ? 1 : 0
    bucket.serverErrorCount += sample.status >= 500 ? 1 : 0
    bucket.securitySignalCount += [401, 403, 429].includes(sample.status) ? 1 : 0
    bucket.totalDurationMs += sample.durationMs
    bucket.durations.push(sample.durationMs)
  }
  const timeline = timelineBuckets.map(({ durations, ...bucket }) => {
    const sortedBucketDurations = durations.sort((a, b) => a - b)
    return {
      ...bucket,
      averageResponseMs: durations.length
        ? Number((bucket.totalDurationMs / durations.length).toFixed(1))
        : null,
      p95ResponseMs: sortedBucketDurations.length
        ? Number(sortedBucketDurations[Math.min(sortedBucketDurations.length - 1, Math.ceil(sortedBucketDurations.length * 0.95) - 1)].toFixed(1))
        : null,
    }
  })
  const lastMinuteStart = now - 60_000
  const lastMinuteSamples = samples.filter(({ at }) => at >= lastMinuteStart)
  return {
    windowStartedAt: new Date(start).toISOString(),
    collectedAt: new Date(now).toISOString(),
    requestCount: samples.length,
    requestsLastMinute: lastMinuteSamples.length,
    errorCount: samples.filter(({ status }) => status >= 400).length,
    serverErrorCount: samples.filter(({ status }) => status >= 500).length,
    clientErrorCount: samples.filter(({ status }) => status >= 400 && status < 500).length,
    successfulRequestCount: samples.filter(({ status }) => status < 400).length,
    securitySignalCount: samples.filter(({ status }) => [401, 403, 429].includes(status)).length,
    securitySignalsLastMinute: lastMinuteSamples.filter(({ status }) => [401, 403, 429].includes(status)).length,
    averageResponseMs: samples.length
      ? Number((samples.reduce((total, { durationMs }) => total + durationMs, 0) / samples.length).toFixed(1))
      : null,
    p95ResponseMs: sortedDurations.length
      ? Number(sortedDurations[Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * 0.95) - 1)].toFixed(1))
      : null,
    endpoints: [...endpoints.entries()].map(([endpoint, totals]) => ({
      endpoint,
      requests: totals.requests,
      errors: totals.errors,
      averageResponseMs: Number((totals.totalDurationMs / totals.requests).toFixed(1)),
    })).sort((a, b) => b.requests - a.requests).slice(0, 50),
    timeline,
    methods: [...methods.entries()].map(([method, requests]) => ({ method, requests })).sort((a, b) => b.requests - a.requests),
    responseDistribution,
  }
}