import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workerRetryDelay } from './scheduler.js'

test('worker database retry delay grows exponentially and is bounded', () => {
  assert.equal(workerRetryDelay(5_000, 1, 300_000), 5_000)
  assert.equal(workerRetryDelay(5_000, 2, 300_000), 10_000)
  assert.equal(workerRetryDelay(5_000, 3, 300_000), 20_000)
  assert.equal(workerRetryDelay(5_000, 20, 300_000), 300_000)
})