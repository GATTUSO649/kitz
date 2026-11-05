import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

delete process.env.MARKETPLACE_DATABASE_URL
const { app } = await import('./app.js')
const server = app.listen(0, '127.0.0.1')
let origin = ''

before(async () => {
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (address && typeof address !== 'string') origin = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('public catalogue fails closed when the marketplace database is not configured', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/products`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('readiness reports missing marketplace database configuration', async () => {
  const response = await fetch(`${origin}/health/ready`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).database, 'not_configured')
})

test('catalogue rejects invalid pagination before accessing the database', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/products?limit=999`)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'INVALID_QUERY')
})

test('catalogue rejects an inverted price range before accessing the database', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/products?minPrice=20000&maxPrice=10000`)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'INVALID_QUERY')
})

test('catalogue rejects malformed publication-date filters', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/products?publishedAfter=not-a-date`)
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'INVALID_QUERY')
})

test('unknown platform routes return a safe not-found response', async () => {
  const response = await fetch(`${origin}/not-a-route`)
  if (response.headers.get('content-type')?.includes('text/html')) {
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<div id="root"><\/div>/)
  } else {
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error.code, 'NOT_FOUND')
  }
})

test('browser mutations reject cross-origin requests', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/submissions`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, 'ORIGIN_REJECTED')
})

test('development Vite fallback origin is allowed for mutations', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/submissions`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5174', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'INVALID_SUBMISSION')
})

test('Daraja callbacks reject requests without the configured secret path', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/payments/callback/not-a-secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 404)
})

test('marketplace administration never serves dashboard data without its isolated database', async () => {
  const response = await fetch(`${origin}/api/v1/admin/marketplace/dashboard`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('seller contact endpoint rejects requests without an unlock token', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/payments/products/private-listing/contact`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'X-Unlock-Token': 'not-valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, 'CONTACT_NOT_AVAILABLE')
})