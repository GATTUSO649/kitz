import { and, asc, eq, lt, lte, sql } from 'drizzle-orm'
import { database } from '../../database/connection.js'
import { marketplaceEmailEvents } from '../../database/schema.js'
import { sendMarketplaceEmail, type MarketplaceEmailInput, type MarketplaceEmailKind } from './service.js'

type EmailExecutor = Pick<NonNullable<typeof database>, 'insert'>

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

export async function dispatchNextMarketplaceEmail(): Promise<boolean> {
  if (!database) return false
  const now = new Date()
  await database.update(marketplaceEmailEvents).set({ status: 'uncertain', lockedAt: null, lastErrorCode: 'DELIVERY_LEASE_EXPIRED' })
    .where(and(eq(marketplaceEmailEvents.status, 'sending'), lt(marketplaceEmailEvents.lockedAt, new Date(now.getTime() - staleDeliveryMs))))

  const event = await database.transaction(async (transaction) => {
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
    }).where(eq(marketplaceEmailEvents.id, available.id)).returning()
    return claimed ?? null
  })
  if (!event) return false

  const delivery = await sendMarketplaceEmail({
    to: event.recipientEmail,
    kind: event.kind as MarketplaceEmailKind,
    data: event.payload,
  })
  if (delivery.status === 'sent') {
    await database.update(marketplaceEmailEvents).set({ status: 'sent', providerMessageId: delivery.providerMessageId ?? null, lastErrorCode: null, lockedAt: null, sentAt: new Date() })
      .where(and(eq(marketplaceEmailEvents.id, event.id), eq(marketplaceEmailEvents.status, 'sending')))
    console.info('MarketHub email delivery', { eventId: event.id, kind: event.kind, status: 'sent' })
    return true
  }

  if (delivery.status === 'retry' && event.attempts < maximumAttempts) {
    const delayMs = Math.min(30 * 60_000, 15_000 * (2 ** (event.attempts - 1)))
    await database.update(marketplaceEmailEvents).set({ status: 'pending', nextAttemptAt: new Date(Date.now() + delayMs), lastErrorCode: delivery.code, lockedAt: null })
      .where(and(eq(marketplaceEmailEvents.id, event.id), eq(marketplaceEmailEvents.status, 'sending')))
    console.warn('MarketHub email delivery deferred', { eventId: event.id, kind: event.kind, attempt: event.attempts, code: delivery.code })
    return true
  }

  const status = delivery.status === 'uncertain' ? 'uncertain' : 'failed'
  await database.update(marketplaceEmailEvents).set({ status, lastErrorCode: delivery.code, lockedAt: null })
    .where(and(eq(marketplaceEmailEvents.id, event.id), eq(marketplaceEmailEvents.status, 'sending')))
  console.warn('MarketHub email delivery did not complete', { eventId: event.id, kind: event.kind, attempt: event.attempts, status, code: delivery.code })
  return true
}

let dispatching = false

export function startMarketplaceEmailWorker(): () => void {
  if (!database) return () => undefined
  const drain = async () => {
    if (dispatching) return
    dispatching = true
    try {
      while (await dispatchNextMarketplaceEmail()) { /* drain ready events */ }
    } catch (error) {
      console.error('MarketHub email worker failed', { errorType: error instanceof Error ? error.name : 'unknown' })
    } finally {
      dispatching = false
    }
  }
  const timer = setInterval(() => { void drain() }, 5_000)
  timer.unref()
  void drain()
  return () => clearInterval(timer)
}