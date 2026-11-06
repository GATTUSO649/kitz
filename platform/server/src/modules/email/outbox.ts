import { and, asc, eq, lt, lte, sql } from 'drizzle-orm'
import { database } from '../../database/connection.js'
import { marketplaceEmailEvents } from '../../database/schema.js'
import { setWorkerEnabled } from '../../workers/health.js'
import { startScheduledWorker } from '../../workers/scheduler.js'
import { sendMarketplaceEmail, type MarketplaceEmailInput, type MarketplaceEmailKind } from './service.js'

type EmailExecutor = Pick<NonNullable<typeof database>, 'insert'>
export type EmailOutboxEvent = typeof marketplaceEmailEvents.$inferSelect
type TerminalEmailStatus = 'failed' | 'uncertain'

export type EmailOutboxStore = {
  recoverStaleDeliveries: (cutoff: Date) => Promise<void>
  claimNext: (now: Date) => Promise<EmailOutboxEvent | null>
  markSent: (eventId: string, sentAt: Date, providerMessageId: string | null) => Promise<void>
  scheduleRetry: (eventId: string, nextAttemptAt: Date, errorCode: string) => Promise<void>
  markTerminal: (eventId: string, status: TerminalEmailStatus, errorCode: string) => Promise<void>
}

export async function enqueueMarketplaceEmail(
  executor: EmailExecutor,
  input: MarketplaceEmailInput & { eventKey: string },
): Promise<void> {
  const payload = Object.fromEntries(Object.entries(input.data).filter(([, value]) => value !== undefined)) as Record<string, string | number | null>
  await executor.insert(marketplaceEmailEvents).values({
    eventKey: input.eventKey,
    kind: input.kind,
    recipientEmail: input.to,
    payload,
  }).onConflictDoNothing({ target: marketplaceEmailEvents.eventKey })
}

const maximumAttempts = 5
const staleDeliveryMs = 2 * 60_000
const maximumBatchSize = 25

function workerOperationError(operation: string, error: unknown, category: 'database' | 'provider' = 'database'): Error {
  return Object.assign(new Error(`Marketplace email ${operation} operation failed.`, { cause: error }), { operation: `email.${operation}`, category })
}

function createDatabaseStore(): EmailOutboxStore | null {
  const databaseClient = database
  if (!databaseClient) return null
  return {
    async recoverStaleDeliveries(cutoff) {
      try {
        await databaseClient.update(marketplaceEmailEvents).set({ status: 'uncertain', lockedAt: null, lastErrorCode: 'DELIVERY_LEASE_EXPIRED' })
          .where(and(eq(marketplaceEmailEvents.status, 'sending'), lt(marketplaceEmailEvents.lockedAt, cutoff)))
      } catch (error) {
        throw workerOperationError('recover_stale', error)
      }
    },
    async claimNext(now) {
      try {
        return await databaseClient.transaction(async (transaction) => {
          const [available] = await transaction.select().from(marketplaceEmailEvents)
            .where(and(eq(marketplaceEmailEvents.status, 'pending'), lte(marketplaceEmailEvents.nextAttemptAt, now)))
            .orderBy(asc(marketplaceEmailEvents.nextAttemptAt), asc(marketplaceEmailEvents.createdAt))
            .limit(1)
            .for('update', { skipLocked: true })
          if (!available) return null
          const [claimed] = await transaction.update(marketplaceEmailEvents).set({
            status: 'sending',
            attempts: sql`${marketplaceEmailEvents.attempts} + 1`,
            lockedAt: now,
          }).where(and(eq(marketplaceEmailEvents.id, available.id), eq(marketplaceEmailEvents.status, 'pending'))).returning()
          return claimed ?? null
        })
      } catch (error) {
        throw workerOperationError('claim_pending', error)
      }
    },
    async markSent(eventId, sentAt, providerMessageId) {
      try {
        const [updated] = await databaseClient.update(marketplaceEmailEvents).set({ status: 'sent', providerMessageId, lastErrorCode: null, lockedAt: null, sentAt })
          .where(and(eq(marketplaceEmailEvents.id, eventId), eq(marketplaceEmailEvents.status, 'sending'))).returning({ id: marketplaceEmailEvents.id })
        if (!updated) throw new Error('Claimed email event was no longer in sending state.')
      } catch (error) {
        throw workerOperationError('mark_sent', error)
      }
    },
    async scheduleRetry(eventId, nextAttemptAt, errorCode) {
      try {
        const [updated] = await databaseClient.update(marketplaceEmailEvents).set({ status: 'pending', nextAttemptAt, lastErrorCode: errorCode, lockedAt: null })
          .where(and(eq(marketplaceEmailEvents.id, eventId), eq(marketplaceEmailEvents.status, 'sending'))).returning({ id: marketplaceEmailEvents.id })
        if (!updated) throw new Error('Claimed email event was no longer in sending state.')
      } catch (error) {
        throw workerOperationError('schedule_retry', error)
      }
    },
    async markTerminal(eventId, status, errorCode) {
      try {
        const [updated] = await databaseClient.update(marketplaceEmailEvents).set({ status, lastErrorCode: errorCode, lockedAt: null })
          .where(and(eq(marketplaceEmailEvents.id, eventId), eq(marketplaceEmailEvents.status, 'sending'))).returning({ id: marketplaceEmailEvents.id })
        if (!updated) throw new Error('Claimed email event was no longer in sending state.')
      } catch (error) {
        throw workerOperationError(`mark_${status}`, error)
      }
    },
  }
}

export async function dispatchNextMarketplaceEmail(dependencies: {
  store?: EmailOutboxStore | null
  sendEmail?: typeof sendMarketplaceEmail
  now?: Date
  random?: () => number
} = {}): Promise<boolean> {
  const store = dependencies.store === undefined ? createDatabaseStore() : dependencies.store
  if (!store) return false
  const now = dependencies.now ?? new Date()
  const sendEmail = dependencies.sendEmail ?? sendMarketplaceEmail
  await store.recoverStaleDeliveries(new Date(now.getTime() - staleDeliveryMs))

  const event = await store.claimNext(now)
  if (!event) return false

  let delivery
  try {
    delivery = await sendEmail({ to: event.recipientEmail, kind: event.kind as MarketplaceEmailKind, data: event.payload })
  } catch (error) {
    throw workerOperationError('send_provider', error, 'provider')
  }

  if (delivery.status === 'sent') {
    await store.markSent(event.id, now, delivery.providerMessageId ?? null)
    console.info('MarketHub email delivery accepted', { worker: 'marketplace_email', eventId: event.id, kind: event.kind, attempt: event.attempts })
    return true
  }

  if (delivery.status === 'retry' && event.attempts < maximumAttempts) {
    const baseDelayMs = Math.min(30 * 60_000, 15_000 * (2 ** (event.attempts - 1)))
    const jitter = 1 + Math.max(0, Math.min(1, dependencies.random?.() ?? Math.random())) * 0.2
    const nextAttemptAt = new Date(now.getTime() + Math.round(baseDelayMs * jitter))
    await store.scheduleRetry(event.id, nextAttemptAt, delivery.code)
    console.warn('MarketHub email retry scheduled', { worker: 'marketplace_email', eventId: event.id, kind: event.kind, attempt: event.attempts, nextAttemptAt: nextAttemptAt.toISOString(), code: delivery.code })
    return true
  }

  const status: TerminalEmailStatus = delivery.status === 'uncertain' ? 'uncertain' : 'failed'
  const errorCode = delivery.status === 'retry' ? 'MAXIMUM_ATTEMPTS_REACHED' : delivery.code
  await store.markTerminal(event.id, status, errorCode)
  console.warn('MarketHub email requires review', { worker: 'marketplace_email', eventId: event.id, kind: event.kind, attempt: event.attempts, status, code: errorCode })
  return true
}

export function startMarketplaceEmailWorker(): () => void {
  const store = createDatabaseStore()
  if (!store) {
    setWorkerEnabled('marketplace_email', false)
    return () => undefined
  }
  return startScheduledWorker('marketplace_email', { intervalMs: 5_000, maximumBackoffMs: 5 * 60_000 }, async () => {
    let processedCount = 0
    while (processedCount < maximumBatchSize && await dispatchNextMarketplaceEmail({ store })) processedCount += 1
    return processedCount
  })
}