import { createMonitoringEvent } from './monitoring-events.js'
import { getMonitoringContext } from './monitoring-context.js'
import type { DatabaseMeasurement } from './postgres-monitoring.js'
import { enqueueMonitoringEvent } from './telemetry-store.js'

const service = 'kitculture-api'
const instanceId = process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local'

export function recordMonitoringEvent(input: Parameters<typeof createMonitoringEvent>[0]) {
  if (process.env.NODE_TEST_CONTEXT !== undefined) return
  try {
    enqueueMonitoringEvent(createMonitoringEvent({
      ...input,
      metadata: { environment: process.env.NODE_ENV ?? 'unknown', ...input.metadata },
    }))
  } catch {
    // Collection failures are isolated from the application operation being observed.
  }
}

export function recordDatabaseMeasurement(measurement: DatabaseMeasurement) {
  recordMonitoringEvent({
    eventType: measurement.eventType,
    category: 'system',
    severity: measurement.severity,
    sourceService: service,
    instanceId,
    ...(measurement.requestId ? { requestId: measurement.requestId } : {}),
    ...(measurement.correlationId ? { correlationId: measurement.correlationId } : {}),
      metadata: { environment: process.env.NODE_ENV ?? 'unknown', ...measurement.metadata,
      ...(measurement.route ? { route: measurement.route } : {}),
    },
  })
}

export function recordRuntimeMeasurement(metadata: Record<string, string | number | boolean | null>) {
  const context = getMonitoringContext()
  recordMonitoringEvent({
    eventType: 'runtime.performance.sampled',
    category: 'system',
    severity: 'info',
    sourceService: service,
    instanceId,
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
    metadata,
  })
}

export function recordProviderMeasurement(input: {
  provider: 'daraja' | 'cloudinary' | 'resend'
  operation: 'oauth' | 'stk_push' | 'stk_query' | 'image_upload' | 'image_delete' | 'email_submit'
  durationMs: number
  outcome: 'response_received' | 'rejected' | 'network_error' | 'timeout' | 'accepted_by_provider'
  httpStatus?: number
}) {
  const context = getMonitoringContext()
  recordMonitoringEvent({
    eventType: 'provider.request.completed',
    category: 'system',
    severity: input.outcome === 'network_error' || input.outcome === 'timeout' ? 'error'
      : input.outcome === 'rejected' ? 'warning' : 'info',
    sourceService: service,
    instanceId,
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
    metadata: {
      provider: input.provider,
      operation: input.operation,
      durationMs: Number(Math.max(0, input.durationMs).toFixed(2)),
      outcome: input.outcome,
      httpStatus: input.httpStatus ?? null,
      route: context?.resolveRoute?.() ?? 'background',
    },
  })
}
