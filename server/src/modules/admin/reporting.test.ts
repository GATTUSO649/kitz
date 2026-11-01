import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveOptionalDateRange, resolveReportingRange } from './reporting.js'

const now = new Date('2026-11-02T18:45:00.000Z')

test('reporting presets use UTC inclusive calendar periods', () => {
  const today = resolveReportingRange({ period: 'today' }, now)
  assert.equal(today?.from.toISOString(), '2026-11-02T00:00:00.000Z')
  assert.equal(today?.toExclusive.toISOString(), '2026-11-03T00:00:00.000Z')

  const lastMonth = resolveReportingRange({ period: 'lastMonth' }, now)
  assert.equal(lastMonth?.from.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(lastMonth?.toExclusive.toISOString(), '2026-11-01T00:00:00.000Z')
})

test('custom reporting ranges include both requested dates and reject invalid or oversized ranges', () => {
  const range = resolveReportingRange({ period: 'custom', from: '2026-10-01', to: '2026-10-31' }, now)
  assert.equal(range?.from.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(range?.toExclusive.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(resolveReportingRange({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }, now), null)
  assert.equal(resolveReportingRange({ period: 'custom', from: '2026-11-03', to: '2026-11-02' }, now), null)
  assert.equal(resolveReportingRange({ period: 'custom', from: '2025-01-01', to: '2026-11-02' }, now), null)
})

test('optional report date filters use an exclusive UTC end and reject invalid ranges', () => {
  const range = resolveOptionalDateRange({ from: '2026-10-01', to: '2026-10-31' })
  assert.equal(range?.from?.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(range?.toExclusive?.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.deepEqual(resolveOptionalDateRange({}), {})
  assert.equal(resolveOptionalDateRange({ from: '2026-02-30' }), null)
  assert.equal(resolveOptionalDateRange({ from: '2026-11-03', to: '2026-11-02' }), null)
  assert.equal(resolveOptionalDateRange({ from: '2025-01-01', to: '2026-11-02' }), null)
})