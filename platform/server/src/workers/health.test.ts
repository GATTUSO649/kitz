import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyWorkerError, safeWorkerError } from './health.js'

test('worker errors distinguish database, provider, and application failures', () => {
  assert.equal(classifyWorkerError(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })), 'database')
  assert.equal(classifyWorkerError(Object.assign(new Error('temporary email rejection'), { code: 'SMTP_TEMPORARY_REJECTION' })), 'provider')
  assert.equal(classifyWorkerError(new Error('unexpected state')), 'application')
})

test('worker diagnostics redact credentials from messages, URLs, and stacks', () => {
  const password = 'smtp-private-password'
  const url = 'postgresql://marketplace:db-private-password@db.example.test/marketplace'
  const error = new Error(`SMTP_PASSWORD=${password}; DATABASE_URL=${url}`)
  const safe = safeWorkerError(error, { MARKETPLACE_BREVO_SMTP_PASSWORD: password, MARKETPLACE_DATABASE_URL: url })
  const serialized = JSON.stringify(safe)
  assert.doesNotMatch(serialized, /smtp-private-password|db-private-password|marketplace:.*@/)
  assert.match(serialized, /\[REDACTED\]/)
  assert.equal(safe.category, 'application')
})