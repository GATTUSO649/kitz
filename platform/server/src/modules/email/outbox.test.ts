import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatchNextMarketplaceEmail, type EmailOutboxEvent, type EmailOutboxStore } from './outbox.js'

const now = new Date('2026-11-06T12:00:00.000Z')

function makeEvent(attempts = 1): EmailOutboxEvent {
  return {
    id: 'event-1', eventKey: 'listing:MH-1:published', kind: 'product_published', recipientEmail: 'seller@example.test', payload: {},
    status: 'sending', attempts, nextAttemptAt: now, lockedAt: now, providerMessageId: null, lastErrorCode: null,
    createdAt: now, sentAt: null,
  }
}

function makeStore(event: EmailOutboxEvent) {
  const changes: Array<Record<string, unknown>> = []
  let claimed = false
  const store: EmailOutboxStore = {
    recoverStaleDeliveries: async () => { changes.push({ operation: 'recover' }) },
    claimNext: async () => { if (claimed) return null; claimed = true; return event },
    markSent: async (eventId, sentAt, providerMessageId) => { changes.push({ operation: 'sent', eventId, sentAt, providerMessageId }) },
    scheduleRetry: async (eventId, nextAttemptAt, errorCode) => { changes.push({ operation: 'retry', eventId, nextAttemptAt, errorCode }) },
    markTerminal: async (eventId, status, errorCode) => { changes.push({ operation: status, eventId, errorCode }) },
  }
  return { store, changes }
}

test('email outbox records provider-accepted messages as sent', async () => {
  const { store, changes } = makeStore(makeEvent())
  const processed = await dispatchNextMarketplaceEmail({ store, now, sendEmail: async () => ({ status: 'sent', providerMessageId: 'provider-1' }) })
  assert.equal(processed, true)
  assert.deepEqual(changes.at(-1), { operation: 'sent', eventId: 'event-1', sentAt: now, providerMessageId: 'provider-1' })
})

test('temporary provider failures are retried with bounded exponential delay', async () => {
  const { store, changes } = makeStore(makeEvent(2))
  await dispatchNextMarketplaceEmail({ store, now, random: () => 0, sendEmail: async () => ({ status: 'retry', code: 'SMTP_TEMPORARY_REJECTION' }) })
  const retry = changes.at(-1)
  assert.equal(retry?.operation, 'retry')
  assert.equal((retry?.nextAttemptAt as Date).getTime() - now.getTime(), 30_000)
  assert.equal(retry?.errorCode, 'SMTP_TEMPORARY_REJECTION')
})

test('maximum-attempt events remain failed and recoverable for explicit review', async () => {
  const { store, changes } = makeStore(makeEvent(5))
  await dispatchNextMarketplaceEmail({ store, now, sendEmail: async () => ({ status: 'retry', code: 'SMTP_TEMPORARY_REJECTION' }) })
  assert.deepEqual(changes.at(-1), { operation: 'failed', eventId: 'event-1', errorCode: 'MAXIMUM_ATTEMPTS_REACHED' })
})

test('uncertain provider outcomes are not automatically retried', async () => {
  const { store, changes } = makeStore(makeEvent())
  await dispatchNextMarketplaceEmail({ store, now, sendEmail: async () => ({ status: 'uncertain', code: 'SMTP_OUTCOME_UNKNOWN' }) })
  assert.deepEqual(changes.at(-1), { operation: 'uncertain', eventId: 'event-1', errorCode: 'SMTP_OUTCOME_UNKNOWN' })
  assert.equal(changes.some((change) => change.operation === 'retry'), false)
})

test('stale delivery recovery errors propagate so the worker can retry the operation', async () => {
  const failure = Object.assign(new Error('relation marketplace.marketplace_email_events does not exist'), { code: '42P01' })
  const store: EmailOutboxStore = {
    recoverStaleDeliveries: async () => { throw failure },
    claimNext: async () => { throw new Error('claim should not run after recovery fails') },
    markSent: async () => undefined,
    scheduleRetry: async () => undefined,
    markTerminal: async () => undefined,
  }
  await assert.rejects(dispatchNextMarketplaceEmail({ store, now }), (error) => error === failure)
})