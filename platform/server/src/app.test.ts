import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

delete process.env.MARKETPLACE_DATABASE_URL
const { app } = await import('./app.js')
const { getMarketplaceDatabaseConfig, marketplaceDatabaseStartupDiagnostic } = await import('./database/connection.js')
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

test('content security policy allows local seller image previews', async () => {
  const response = await fetch(`${origin}/health/live`)
  const policy = response.headers.get('content-security-policy') ?? ''
  assert.match(policy, /img-src[^;]*'self'[^;]*data:[^;]*blob:/)
})

test('marketplace public GET endpoints fail closed without a database', async () => {
  const paths = [
    '/api/v1/marketplace/settings/footer-social-links',
    '/api/v1/marketplace/categories',
    '/api/v1/marketplace/locations/counties',
  ]
  const responses = await Promise.all(paths.map((path) => fetch(`${origin}${path}`)))
  for (const response of responses) {
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
  }
})

test('readiness reports missing marketplace database configuration', async () => {
  const response = await fetch(`${origin}/health/ready`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).database, 'not_configured')
})

test('worker health reports configured state without exposing secret values', async () => {
  const response = await fetch(`${origin}/health/workers`)
  const result = await response.json() as { workers?: Record<string, unknown>; emailProvider?: { provider: string; configured: boolean; code: string | null } }
  assert.equal(response.status, 200)
  assert.equal(result.emailProvider?.provider, 'disabled')
  assert.equal(result.emailProvider?.configured, false)
  assert.ok(result.workers?.marketplace_email)
  assert.ok(result.workers?.marketplace_listing_expiry)
  assert.doesNotMatch(JSON.stringify(result), /MARKETPLACE_DATABASE_URL|SMTP_PASSWORD|API_KEY/)
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

test('seller account management fails closed when the marketplace database is unavailable', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/seller/products`)
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('seller signup accepts county-only location details', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/seller/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({ name: 'Test Seller', email: 'seller@example.test', phone: '0712345678', countyCode: '001', password: 'secure-password-123', confirmPassword: 'secure-password-123' }),
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('guest listing submission accepts county-only location details', async () => {
  const response = await fetch(`${origin}/api/v1/marketplace/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' },
    body: JSON.stringify({
      title: 'A valid marketplace item',
      description: 'This is a sufficiently detailed description for the seller listing.',
      categoryId: '00000000-0000-4000-8000-000000000001',
      condition: 'good',
      priceKes: 1000,
      negotiable: false,
      seller: { name: 'Test Seller', phone: '0712345678', countyCode: '001' },
    }),
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('second-hand admin assignment is managed by KitCulture Super Admin', async () => {
  const response = await fetch(`${origin}/api/v1/admin/marketplace/admins/invitations`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Marketplace Admin', email: 'admin@example.test' }),
  })
  assert.equal(response.status, 410)
  assert.equal((await response.json()).error.code, 'CENTRAL_ADMIN_MANAGEMENT_REQUIRED')
})

test('email event recovery fails closed when the marketplace database is unavailable', async () => {
  const response = await fetch(`${origin}/api/v1/admin/marketplace/email-events/00000000-0000-4000-8000-000000000001/retry`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('MarketHub-local administrator provisioning and management are disabled', async () => {
  const responses = await Promise.all([
    fetch(`${origin}/api/v1/admin/marketplace/admins/invitations`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Local Admin', email: 'local-admin@example.com' }),
    }),
    fetch(`${origin}/api/v1/admin/marketplace/invitations/activate`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'x'.repeat(32), password: 'a-secure-passphrase-2026', confirmPassword: 'a-secure-passphrase-2026' }),
    }),
    fetch(`${origin}/api/v1/admin/marketplace/admins`),
  ])

  for (const response of responses) {
    assert.equal(response.status, 410)
    assert.equal((await response.json()).error.code, 'CENTRAL_ADMIN_MANAGEMENT_REQUIRED')
  }
})

test('seller password recovery validates requests and fails closed without the marketplace database', async () => {
  const invalidRequest = await fetch(`${origin}/api/v1/marketplace/seller/password/forgot`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  })
  assert.equal(invalidRequest.status, 400)

  const forgot = await fetch(`${origin}/api/v1/marketplace/seller/password/forgot`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'seller@example.test' }),
  })
  assert.equal(forgot.status, 503)
  assert.equal((await forgot.json()).error.code, 'MARKETPLACE_UNAVAILABLE')

  const reset = await fetch(`${origin}/api/v1/marketplace/seller/password/reset`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'x'.repeat(32), password: 'a-secure-passphrase-2026', confirmPassword: 'a-secure-passphrase-2026' }),
  })
  assert.equal(reset.status, 503)
  assert.equal((await reset.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
})

test('seller account support routes fail closed without the marketplace database', async () => {
  const list = await fetch(`${origin}/api/v1/admin/marketplace/seller-accounts`)
  assert.equal(list.status, 503)
  assert.equal((await list.json()).error.code, 'MARKETPLACE_UNAVAILABLE')

  const update = await fetch(`${origin}/api/v1/admin/marketplace/seller-accounts/00000000-0000-4000-8000-000000000001/status`, {
    method: 'PATCH',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'suspended' }),
  })
  assert.equal(update.status, 503)
  assert.equal((await update.json()).error.code, 'MARKETPLACE_UNAVAILABLE')
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

test('database configuration accepts the shared postgres database only with matching host and schema', () => {
  const config = getMarketplaceDatabaseConfig({
    MARKETPLACE_DATABASE_URL: 'postgresql://marketplace_app:secret@db.example.supabase.co:5432/postgres',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_HOST: 'db.example.supabase.co',
    MARKETPLACE_DATABASE_USER: 'marketplace_app',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
    NODE_ENV: 'development',
  })
  assert.equal(config?.connectionString.endsWith('/postgres'), true)
  assert.throws(() => getMarketplaceDatabaseConfig({
    MARKETPLACE_DATABASE_URL: 'postgresql://marketplace_app:secret@db.example.supabase.co:5432/postgres',
    MARKETPLACE_DATABASE_NAME: 'marketplace',
    MARKETPLACE_DATABASE_HOST: 'db.example.supabase.co',
    MARKETPLACE_DATABASE_USER: 'marketplace_app',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
  }), /MARKETPLACE_DATABASE_NAME/)
  assert.throws(() => getMarketplaceDatabaseConfig({
    MARKETPLACE_DATABASE_URL: 'not-a-url-with-secret',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_HOST: 'db.example.supabase.co',
    MARKETPLACE_DATABASE_USER: 'marketplace_app',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
  }), /valid PostgreSQL connection URL/)
  assert.throws(() => getMarketplaceDatabaseConfig({
    MARKETPLACE_DATABASE_URL: 'postgresql://marketplace_app:secret@db.example.supabase.co:5432/postgres',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_HOST: 'db.example.supabase.co',
    MARKETPLACE_DATABASE_USER: 'marketplace_app',
    MARKETPLACE_DATABASE_SCHEMA: 'public',
  }), /MARKETPLACE_DATABASE_SCHEMA/)
})

test('production database configuration requires verified TLS and its CA', () => {
  const config = getMarketplaceDatabaseConfig({
    MARKETPLACE_DATABASE_URL: 'postgresql://marketplace_app:secret@db.example.supabase.co:5432/postgres',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_HOST: 'db.example.supabase.co',
    MARKETPLACE_DATABASE_USER: 'marketplace_app',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
    MARKETPLACE_DATABASE_CA: 'verified-ca',
    NODE_ENV: 'production',
  })
  assert.deepEqual(config?.ssl, { ca: 'verified-ca', rejectUnauthorized: true })
  assert.throws(() => getMarketplaceDatabaseConfig({ NODE_ENV: 'production' }), /MARKETPLACE_DATABASE_URL/)
  assert.throws(() => getMarketplaceDatabaseConfig({
    MARKETPLACE_DATABASE_URL: 'postgresql://marketplace_app:secret@db.example.supabase.co:5432/postgres',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_HOST: 'db.example.supabase.co',
    MARKETPLACE_DATABASE_USER: 'marketplace_app',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
    NODE_ENV: 'production',
  }), /MARKETPLACE_DATABASE_CA/)
})

test('startup database diagnostic reports safe configuration and connection results', async () => {
  const configuration = {
    MARKETPLACE_DATABASE_URL: 'postgresql://private-user:private-password@db.example.supabase.co/postgres',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
    MARKETPLACE_DATABASE_CA: 'private-certificate',
  }
  const connected = await marketplaceDatabaseStartupDiagnostic({
    query: async () => ({ rows: [{ database_name: 'postgres' }] }),
  } as never, configuration)
  assert.equal(connected.databaseUrlConfigured, true)
  assert.equal(connected.configuredDatabaseName, 'postgres')
  assert.equal(connected.configuredSchema, 'marketplace')
  assert.equal(connected.databaseConnected, true)
  assert.equal(connected.actualDatabaseName, 'postgres')
  assert.doesNotMatch(JSON.stringify(connected), /private-user|private-password|private-certificate|postgresql:\/\//)

  const failed = await marketplaceDatabaseStartupDiagnostic({
    query: async () => { throw Object.assign(new Error('password authentication failed'), { code: '28P01' }) },
  } as never, configuration)
  assert.equal(failed.databaseConnected, false)
  assert.equal(failed.databaseError?.code, '28P01')
  assert.doesNotMatch(JSON.stringify(failed), /private-user|private-password|private-certificate|postgresql:\/\//)
})