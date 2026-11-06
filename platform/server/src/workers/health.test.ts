import assert from 'node:assert/strict'
import { test } from 'node:test'
import { databaseErrorResponseCode, safeDatabaseError } from '../database/diagnostics.js'
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

test('worker diagnostics preserve nested PostgreSQL failure details without leaking certificates', () => {
  const cause = Object.assign(new Error('relation marketplace.marketplace_products does not exist'), { code: '42P01', schema: 'marketplace', table: 'marketplace_products' })
  const certificate = '-----BEGIN CERTIFICATE-----private-ca-----END CERTIFICATE-----'
  const wrapped = Object.assign(new Error(`Listing expiry failed with ${certificate}`, { cause }), { category: 'database' })
  const safe = safeWorkerError(wrapped, { MARKETPLACE_DATABASE_CA: certificate })
  assert.equal(safe.databaseError?.code, '42P01')
  assert.equal(safe.databaseError?.failureKind, 'missing_relation')
  assert.equal(safe.databaseError?.table, 'marketplace_products')
  assert.equal(safe.databaseConnection.configured, false)
  assert.doesNotMatch(JSON.stringify(safe), /private-ca|BEGIN CERTIFICATE/)
})

test('PostgreSQL diagnostics classify missing schema, permission, and connection timeout failures', () => {
  const missingSchema = safeDatabaseError(Object.assign(new Error('schema marketplace does not exist'), { code: '3F000' }))
  const permissionDenied = safeDatabaseError(Object.assign(new Error('permission denied for schema marketplace'), { code: '42501' }))
  const connectionTimeout = safeDatabaseError(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' }))
  assert.equal(databaseErrorResponseCode(missingSchema), 'DATABASE_SCHEMA_MISSING')
  assert.equal(databaseErrorResponseCode(permissionDenied), 'DATABASE_PERMISSION_DENIED')
  assert.equal(databaseErrorResponseCode(connectionTimeout), 'DATABASE_CONNECTION_TIMEOUT')
  assert.equal(classifyWorkerError(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })), 'database')
})