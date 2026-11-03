import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateProcessCpuPercent } from './runtime-performance.js'

test('calculates process CPU share from measured process time and elapsed wall time', () => {
  assert.equal(calculateProcessCpuPercent(500_000, 250_000, 1000, 4), 18.75)
  assert.equal(calculateProcessCpuPercent(2_000_000, 0, 1000, 2), 100)
  assert.equal(calculateProcessCpuPercent(100_000, 100_000, 0, 1), null)
  assert.equal(calculateProcessCpuPercent(100_000, 100_000, 1000, 0), null)
})
