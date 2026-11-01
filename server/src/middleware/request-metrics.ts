import type { Request, RequestHandler } from 'express'

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

export const requestMetrics: RequestHandler = (request, response, next) => {
  const startedAt = performance.now()
  response.once('finish', () => {
    metrics.push({
      at: Date.now(),
      method: request.method,
      endpoint: endpointTemplate(request),
      status: response.statusCode,
      durationMs: Math.max(0, performance.now() - startedAt),
    })
    if (metrics.length > maxSamples) metrics.splice(0, metrics.length - maxSamples)
  })
  next()
}

export function getRequestMetrics(windowMs = 60 * 60_000, now = Date.now()) {
  const start = now - windowMs
  while (metrics.length && metrics[0].at < start) metrics.shift()
  const samples = metrics.filter((metric) => metric.at >= start)
  const sortedDurations = samples.map(({ durationMs }) => durationMs).sort((a, b) => a - b)
  const endpoints = new Map<string, { requests: number; errors: number; totalDurationMs: number }>()
  for (const sample of samples) {
    const key = `${sample.method} ${sample.endpoint}`
    const current = endpoints.get(key) ?? { requests: 0, errors: 0, totalDurationMs: 0 }
    current.requests += 1
    current.errors += sample.status >= 400 ? 1 : 0
    current.totalDurationMs += sample.durationMs
    endpoints.set(key, current)
  }
  return {
    windowStartedAt: new Date(start).toISOString(),
    requestCount: samples.length,
    errorCount: samples.filter(({ status }) => status >= 400).length,
    serverErrorCount: samples.filter(({ status }) => status >= 500).length,
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
  }
}