import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { createClient } from 'redis'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { accountRateLimitKey, createAccountRateLimiter, createRedisRateLimitStore, ipRateLimitKey, isRateLimitStorageUnavailable } from './distributed-rate-limit.js'

const activeServers: Server[] = []
const redisTestUrl = process.env.REDIS_TEST_URL

after(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))))
})

test('account limiter keys are stable, opaque, and case-insensitive', () => {
  const normalized = accountRateLimitKey(' Admin@Example.test ')
  assert.equal(normalized, accountRateLimitKey('admin@example.test'))
  assert.ok(normalized)
  assert.equal(normalized.includes('admin@example.test'), false)
  assert.equal(accountRateLimitKey('  '), null)
})

test('IP limiter keys are stable and do not contain raw addresses', () => {
  const key = ipRateLimitKey('203.0.113.42')
  assert.equal(key, ipRateLimitKey('203.0.113.42'))
  assert.equal(key.includes('203.0.113.42'), false)
})

test('untrusted forwarded IP headers do not bypass the IP limiter', async () => {
  const app = express()
  app.set('trust proxy', false)
  app.get('/', rateLimit({
    windowMs: 60_000,
    limit: 1,
    keyGenerator: (request) => ipRateLimitKey(ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? 'unknown')),
  }), (_request, response) => response.sendStatus(200))
  const server = app.listen(0, '127.0.0.1')
  activeServers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/`
  const first = await fetch(url, { headers: { 'X-Forwarded-For': '198.51.100.10' } })
  const spoofed = await fetch(url, { headers: { 'X-Forwarded-For': '198.51.100.11' } })
  assert.equal(first.status, 200)
  assert.equal(spoofed.status, 429)
})

test('account limits remain shared when the source IP changes', async () => {
  const app = express()
  app.set('trust proxy', false)
  app.use(express.json())
  app.post('/', createAccountRateLimiter('test.account', { windowMs: 60_000, limit: 1 }, (request) => request.body?.email), (_request, response) => response.sendStatus(200))
  const server = app.listen(0, '127.0.0.1')
  activeServers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/`
  const body = JSON.stringify({ email: 'account@example.test' })
  const first = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' }, body })
  const second = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' }, body })
  assert.equal(first.status, 200)
  assert.equal(second.status, 429)
})

test('shared-store errors reject requests with 503', async () => {
  const store = createRedisRateLimitStore('outage-test', {
    isReady: true,
    async sendCommand(command) {
      if (command[0] === 'SCRIPT' && command[1] === 'LOAD') return 'a'.repeat(40)
      throw new Error('test Redis outage')
    },
  })
  const app = express()
  app.get('/', rateLimit({ windowMs: 60_000, limit: 1, store, passOnStoreError: false }), (_request, response) => response.sendStatus(200))
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(isRateLimitStorageUnavailable(error) ? 503 : 500).json({ code: isRateLimitStorageUnavailable(error) ? 'RATE_LIMIT_UNAVAILABLE' : 'INTERNAL_ERROR' })
  })
  const server = app.listen(0, '127.0.0.1')
  activeServers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const response = await fetch(`http://127.0.0.1:${address.port}/`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { code: 'RATE_LIMIT_UNAVAILABLE' })
})

test('two API instances share an atomic Redis limit and counter expiry', { skip: !redisTestUrl }, async () => {
  const clientA = createClient({ url: redisTestUrl, disableOfflineQueue: true, socket: { connectTimeout: 2_000 } })
  const clientB = createClient({ url: redisTestUrl, disableOfflineQueue: true, socket: { connectTimeout: 2_000 } })
  const prefix = `integration:${randomUUID()}`
  try {
    await Promise.all([clientA.connect(), clientB.connect()])
    const serverA = createLimitedServer(createRedisRateLimitStore(prefix, clientA), 1_000)
    const serverB = createLimitedServer(createRedisRateLimitStore(prefix, clientB), 1_000)
    activeServers.push(serverA, serverB)
    const addressA = serverA.address()
    const addressB = serverB.address()
    assert.ok(addressA && typeof addressA !== 'string')
    assert.ok(addressB && typeof addressB !== 'string')
    const urls = [`http://127.0.0.1:${addressA.port}/`, `http://127.0.0.1:${addressB.port}/`]
    const simultaneous = await Promise.all(urls.map((url) => fetch(url)))
    assert.deepEqual(simultaneous.map(({ status }) => status).sort(), [200, 429])
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const afterExpiry = await fetch(urls[0]!)
    assert.equal(afterExpiry.status, 200)
  } finally {
    await Promise.all([clientA.close(), clientB.close()])
  }
})

function createLimitedServer(store: ReturnType<typeof createRedisRateLimitStore>, windowMs: number) {
  const app = express()
  app.get('/', rateLimit({ windowMs, limit: 1, store, standardHeaders: 'draft-8', legacyHeaders: false, passOnStoreError: false }), (_request, response) => response.sendStatus(200))
  return app.listen(0, '127.0.0.1')
}
