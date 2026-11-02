import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMonitoringEvent, monitoringEventSchema } from './monitoring-events.js'

const validEvent = {
  eventType: 'http.request.completed',
  category: 'request' as const,
  severity: 'info' as const,
  sourceService: 'kitculture-api',
  instanceId: 'test-instance',
  metadata: { method: 'GET', route: '/items/:id', status: 200 },
}

test('creates validated events with unique IDs and timestamps', () => {
  const first = createMonitoringEvent(validEvent)
  const second = createMonitoringEvent(validEvent)
  assert.ok(monitoringEventSchema.safeParse(first).success)
  assert.notEqual(first.eventId, second.eventId)
  assert.ok(Number.isFinite(Date.parse(first.occurredAt)))
})

test('rejects malformed event metadata and event categories', () => {
  assert.equal(monitoringEventSchema.safeParse({
    ...createMonitoringEvent(validEvent),
    category: 'unknown',
  }).success, false)
  assert.equal(monitoringEventSchema.safeParse({
    ...createMonitoringEvent(validEvent),
    metadata: { password: 'should-not-be-stored' },
  }).success, false)
  assert.equal(monitoringEventSchema.safeParse({
    ...createMonitoringEvent(validEvent),
    metadata: { note: 'Bearer abcdef1234567890' },
  }).success, false)
})
