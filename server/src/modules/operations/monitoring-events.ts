import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const metadataValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])
const metadataSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/), metadataValue)
const sensitiveMetadataKey = /password|secret|token|authorization|cookie|credential|phone|email|address|body|payload/i
const sensitiveValue = /\b(?:bearer\s+)[a-z0-9._~+/-]+=*|\b(?:sk|pk|api)[-_][a-z0-9_-]{16,}\b/i

export const monitoringEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
  category: z.enum(['request', 'application', 'security', 'business', 'system']),
  severity: z.enum(['debug', 'info', 'warning', 'error', 'critical']),
  occurredAt: z.string().datetime({ offset: true }),
  sourceService: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  instanceId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(120).optional(),
  correlationId: z.string().uuid().optional(),
  relatedResourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  metadata: metadataSchema.refine((value) => Object.keys(value).length <= 24, 'Metadata has too many fields.'),
}).strict().superRefine((event, context) => {
  for (const [key, value] of Object.entries(event.metadata)) {
    if (sensitiveMetadataKey.test(key)) {
      context.addIssue({ code: 'custom', path: ['metadata', key], message: 'Sensitive metadata keys are not permitted.' })
    }
    if (typeof value === 'string' && sensitiveValue.test(value)) {
      context.addIssue({ code: 'custom', path: ['metadata', key], message: 'Sensitive values are not permitted.' })
    }
  }
})

export type MonitoringEvent = z.infer<typeof monitoringEventSchema>
export type MonitoringEventInput = Omit<MonitoringEvent, 'eventId' | 'occurredAt'> & {
  eventId?: string
  occurredAt?: string
}

export function createMonitoringEvent(input: MonitoringEventInput): MonitoringEvent {
  return monitoringEventSchema.parse({
    ...input,
    eventId: input.eventId ?? randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  })
}
