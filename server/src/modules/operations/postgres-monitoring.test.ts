import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeDatabaseAggregates } from './database-performance.js'
import { runWithMonitoringContext } from './monitoring-context.js'
import { fingerprintSql, instrumentPostgresPool } from './postgres-monitoring.js'

test('SQL fingerprints discard literals and parameters', () => {
  const first = fingerprintSql("SELECT * FROM users WHERE email = 'one@example.com' AND id = 123")
  const second = fingerprintSql("SELECT * FROM users WHERE email = 'another@example.com' AND id = 456")
  assert.equal(first, second)
  assert.equal(first.length, 32)
})

test('instruments pool queries and acquired transaction clients without retaining SQL or parameters', async () => {
  const measurements: Array<{ eventType: string; metadata: Record<string, unknown>; requestId?: string; route?: string }> = []
  const client = {
    query: async (...args: unknown[]) => ({ rowCount: args[0] === 'COMMIT' ? null : typeof args[0] === 'string' && args[0].startsWith('SELECT') ? 3 : 2 }),
    release: () => undefined,
  }
  let pool: {
    totalCount: number
    idleCount: number
    waitingCount: number
    options: { max: number }
    query: (...args: unknown[]) => Promise<{ rowCount: number | null }>
    connect: () => Promise<typeof client>
  }
  pool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    options: { max: 10 },
    query: async (...args: unknown[]) => {
      const acquired = await pool.connect()
      return acquired.query(...args)
    },
    connect: async () => client,
  }
  const getSnapshot = instrumentPostgresPool(pool, (measurement) => measurements.push(measurement))

  await runWithMonitoringContext({ requestId: 'request-safe-id', resolveRoute: () => '/api/v1/orders/:id' }, async () => {
    await pool.query("SELECT * FROM users WHERE email = $1", ['private@example.com'])
    const transactionClient = await pool.connect()
    await transactionClient.query('BEGIN')
    await transactionClient.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', 123])
    await transactionClient.query('COMMIT')
  })

  assert.equal(measurements.filter((entry) => entry.eventType === 'database.query.completed').length, 4)
  assert.equal(measurements.filter((entry) => entry.eventType === 'database.connection.acquired').length, 2)
  assert.equal(measurements.filter((entry) => entry.eventType === 'database.transaction.completed').length, 1)
  assert.equal(measurements.find((entry) => entry.eventType === 'database.query.completed')?.metadata.affectedRows, 3)
  assert.equal(measurements.find((entry) => entry.eventType === 'database.query.completed')?.requestId, 'request-safe-id')
  assert.equal(measurements.find((entry) => entry.eventType === 'database.query.completed')?.route, '/api/v1/orders/:id')
  assert.deepEqual(getSnapshot(), { totalConnections: 1, idleConnections: 1, waitingRequests: 0, maxConnections: 10 })
  assert.ok(!JSON.stringify(measurements).includes('private@example.com'))
  assert.ok(!JSON.stringify(measurements).includes('UPDATE orders'))
})

test('merges database histograms across instances without averaging percentiles', () => {
  const summary = summarizeDatabaseAggregates([
    {
      instanceId: 'instance-a',
      occurredAt: '2026-11-03T10:00:00.000Z',
      metadata: {
        metricType: 'database.query.completed', operation: 'SELECT', sampleCount: 2,
        successCount: 2, failureCount: 0, slowCount: 1, durationTotalMs: 125,
        minDurationMs: 25, maxDurationMs: 100, windowStartedAt: '2026-11-03T09:59:30.000Z',
        windowEndedAt: '2026-11-03T10:00:00.000Z', latencyBucketCounts: '0,0,0,1,0,1,0,0,0,0,0,0',
      },
    },
    {
      instanceId: 'instance-b',
      occurredAt: '2026-11-03T10:00:10.000Z',
      metadata: {
        metricType: 'database.query.completed', operation: 'SELECT', sampleCount: 2,
        successCount: 1, failureCount: 1, slowCount: 1, durationTotalMs: 625,
        minDurationMs: 125, maxDurationMs: 500, windowStartedAt: '2026-11-03T10:00:00.000Z',
        windowEndedAt: '2026-11-03T10:00:10.000Z', latencyBucketCounts: '0,0,0,0,0,0,1,0,0,0,1,0',
      },
    },
  ])[0]

  assert.equal(summary.sampleCount, 4)
  assert.equal(summary.successCount, 3)
  assert.equal(summary.failureCount, 1)
  assert.equal(summary.averageDurationMs, 187.5)
  assert.equal(summary.minDurationMs, 25)
  assert.equal(summary.maxDurationMs, 500)
  assert.equal(summary.p50DurationMs, 100)
  assert.equal(summary.p95DurationMs, 10000)
  assert.equal(summary.p99DurationMs, 10000)
  assert.equal(summary.histogramEstimate, true)
  assert.equal(summary.instanceCount, 2)
  assert.equal(summary.windowStartedAt, '2026-11-03T09:59:30.000Z')
  assert.equal(summary.windowEndedAt, '2026-11-03T10:00:10.000Z')
})

test('records only a classified SQLSTATE when a query fails', async () => {
  const measurements: Array<{ eventType: string; severity: string; metadata: Record<string, unknown> }> = []
  const failure = Object.assign(new Error('duplicate key detail includes private values'), { code: '23505' })
  const client: { query: (...args: unknown[]) => Promise<{ rowCount: number | null }>; release: () => void } = {
    query: async (..._args: unknown[]) => { throw failure },
    release: () => undefined,
  }
  const pool = {
    totalCount: 1,
    idleCount: 0,
    waitingCount: 0,
    options: { max: 10 },
    query: async (...args: unknown[]) => (await pool.connect()).query(...args),
    connect: async () => client,
  }
  instrumentPostgresPool(pool, (measurement) => measurements.push(measurement))
  await assert.rejects(() => pool.query('INSERT INTO users (email) VALUES ($1)', ['private@example.com']))
  const queryFailure = measurements.find((measurement) => measurement.eventType === 'database.query.completed')
  assert.equal(queryFailure?.metadata.sqlState, '23505')
  assert.equal(queryFailure?.metadata.errorCategory, 'integrity')
  assert.equal(queryFailure?.metadata.outcome, 'failed')
  assert.ok(!JSON.stringify(measurements).includes('private@example.com'))
  assert.ok(!JSON.stringify(measurements).includes('duplicate key detail'))
})