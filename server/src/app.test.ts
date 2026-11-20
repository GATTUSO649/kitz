import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { rootCertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

process.env.NODE_ENV = 'development'
process.env.PORT = '4000'
process.env.CLIENT_ORIGIN = 'http://localhost:5173'
process.env.MARKETHUB_PUBLIC_URL = 'https://market.example.test'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/kitculture'
process.env.ADMIN_DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/kitculture_admin'
const validRootCas = rootCertificates.filter((pem) => {
  const certificate = new X509Certificate(pem)
  return certificate.ca && Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now()
})
if (validRootCas.length < 2) throw new Error('Tests require two valid system root CA certificates.')
process.env.SUPABASE_CA_CERT = validRootCas[0]
process.env.ADMIN_SUPABASE_CA_CERT = validRootCas[1]
process.env.MARKETHUB_SERVICE_TOKEN = 'a'.repeat(48)
process.env.LOG_LEVEL = 'silent'

const { app } = await import('./app.js')
const { biometricLockoutStatus, isBiometricChallengeConsumable, webAuthnRelyingParty } = await import('./modules/admin/biometrics.js')
const { pool, adminPool } = await import('./config/database.js')
const { inspectDatabaseError } = await import('./config/database-diagnostics.js')
const { resolveDatabaseUrl } = await import('./config/env.js')
const { areSameDatabaseTarget } = await import('./config/database-target.js')
const clientDist = fileURLToPath(new URL('../../dist', import.meta.url))
const hasClientBuild = existsSync(`${clientDist}/index.html`)
let server: ReturnType<typeof app.listen>
let baseUrl: string

before(async () => {
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  baseUrl = `http://127.0.0.1:${address.port}`
})

test('uses a distinct administrator database pool when a separate URL is configured', () => {
  assert.ok(pool)
  assert.ok(adminPool)
  assert.notEqual(adminPool, pool)
  const kitzSsl = (pool as unknown as { options: { ssl: { ca: string; rejectUnauthorized: boolean } } }).options.ssl
  const adminSsl = (adminPool as unknown as { options: { ssl: { ca: string; rejectUnauthorized: boolean } } }).options.ssl
  assert.equal(kitzSsl.ca, validRootCas[0])
  assert.equal(adminSsl.ca, validRootCas[1])
  assert.equal(kitzSsl.rejectUnauthorized, true)
  assert.equal(adminSsl.rejectUnauthorized, true)
})

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (pool) await pool.end()
  if (adminPool && adminPool !== pool) await adminPool.end()
})

test('reads Railway-style MYSQL_URL values when DATABASE_URL is not set', async () => {
  const previous = process.env.DATABASE_URL
  const adminPrevious = process.env.ADMIN_DATABASE_URL
  const mysqlPrevious = process.env.MYSQL_URL
  const adminMysqlPrevious = process.env.ADMIN_MYSQL_URL

  process.env.DATABASE_URL = ''
  process.env.ADMIN_DATABASE_URL = ''
  process.env.MYSQL_URL = 'mysql://root:secret@iriguchi.proxy.rlwy.net:14915/railway'
  process.env.ADMIN_MYSQL_URL = 'mysql://root:secret@iriguchi.proxy.rlwy.net:14915/railway'

  try {
    assert.equal(resolveDatabaseUrl('DATABASE_URL', ['MYSQL_URL']), 'mysql://root:secret@iriguchi.proxy.rlwy.net:14915/railway')
    assert.equal(resolveDatabaseUrl('ADMIN_DATABASE_URL', ['ADMIN_MYSQL_URL']), undefined)
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    if (adminPrevious === undefined) delete process.env.ADMIN_DATABASE_URL
    else process.env.ADMIN_DATABASE_URL = adminPrevious
    if (mysqlPrevious === undefined) delete process.env.MYSQL_URL
    else process.env.MYSQL_URL = mysqlPrevious
    if (adminMysqlPrevious === undefined) delete process.env.ADMIN_MYSQL_URL
    else process.env.ADMIN_MYSQL_URL = adminMysqlPrevious
  }
})

test('reads Railway MYSQL_PUBLIC_URL when the private URL is unavailable', () => {
  const previous = process.env.DATABASE_URL
  const mysqlPrevious = process.env.MYSQL_URL
  const mysqlUriPrevious = process.env.MYSQL_URI
  const publicUrlPrevious = process.env.MYSQL_PUBLIC_URL
  process.env.DATABASE_URL = ''
  process.env.MYSQL_URL = ''
  process.env.MYSQL_URI = ''
  process.env.MYSQL_PUBLIC_URL = 'mysql://root:secret@iriguchi.proxy.rlwy.net:14915/railway'

  try {
    assert.equal(resolveDatabaseUrl('DATABASE_URL', ['MYSQL_URL', 'MYSQL_URI', 'MYSQL_PUBLIC_URL']), 'mysql://root:secret@iriguchi.proxy.rlwy.net:14915/railway')
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    if (mysqlPrevious === undefined) delete process.env.MYSQL_URL
    else process.env.MYSQL_URL = mysqlPrevious
    if (mysqlUriPrevious === undefined) delete process.env.MYSQL_URI
    else process.env.MYSQL_URI = mysqlUriPrevious
    if (publicUrlPrevious === undefined) delete process.env.MYSQL_PUBLIC_URL
    else process.env.MYSQL_PUBLIC_URL = publicUrlPrevious
  }
})

test('serves the built homepage and Vite assets without production NODE_ENV', { skip: !hasClientBuild }, async () => {
  const html = readFileSync(`${clientDist}/index.html`, 'utf8')
  const scriptPath = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1]
  const stylesheetPath = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1]
  assert.ok(scriptPath)
  assert.ok(stylesheetPath)

  const homepage = await fetch(baseUrl)
  assert.equal(homepage.status, 200)
  assert.match(homepage.headers.get('content-type') ?? '', /text\/html/)
  assert.match(homepage.headers.get('cache-control') ?? '', /no-cache/)
  assert.match(await homepage.text(), /<div id="root"><\/div>/)

  const route = await fetch(`${baseUrl}/shop`, { headers: { accept: 'text/html' } })
  assert.equal(route.status, 200)
  assert.match(route.headers.get('content-type') ?? '', /text\/html/)

  const script = await fetch(new URL(scriptPath, baseUrl))
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type') ?? '', /javascript/)
  assert.match(script.headers.get('cache-control') ?? '', /max-age=31536000, immutable/)

  const stylesheet = await fetch(new URL(stylesheetPath, baseUrl))
  assert.equal(stylesheet.status, 200)
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/)

  const image = await fetch(`${baseUrl}/culture-mark.webp`)
  assert.equal(image.status, 200)
  assert.match(image.headers.get('content-type') ?? '', /image\/webp/)
})

test('keeps unknown API routes as JSON 404s', async () => {
  const response = await fetch(`${baseUrl}/api/v1/missing`)
  assert.equal(response.status, 404)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  const result = await response.json() as { error: { code: string } }
  assert.equal(result.error.code, 'NOT_FOUND')
})

test('rejects request bodies over the configured 100 KB JSON limit', async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: 'x'.repeat(101 * 1024) }),
  })
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body exceeds the 100 KB limit.' } })
})

test('rejects excessive public catalogue pagination before querying the database', async () => {
  const response = await fetch(`${baseUrl}/api/v1/products?page=101`)
  assert.equal(response.status, 400)
  const result = await response.json() as { error: { code: string } }
  assert.equal(result.error.code, 'INVALID_QUERY')
})

test('guest checkout endpoints validate publicly without requiring a customer session', async () => {
  const orderResponse = await fetch(`${baseUrl}/api/v1/orders/guest`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(orderResponse.status, 400)
  assert.equal((await orderResponse.json() as { error: { code: string } }).error.code, 'INVALID_ORDER')

  const statusResponse = await fetch(`${baseUrl}/api/v1/orders/guest/not-a-reference/status`)
  assert.equal(statusResponse.status, 404)
  assert.equal((await statusResponse.json() as { error: { code: string } }).error.code, 'ORDER_NOT_FOUND')

  const paymentResponse = await fetch(`${baseUrl}/api/v1/orders/guest/not-a-reference/mpesa/stk-push`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '0712345678' }),
  })
  assert.equal(paymentResponse.status, 400)
  assert.equal((await paymentResponse.json() as { error: { code: string } }).error.code, 'INVALID_PAYMENT_REQUEST')
})

test('MarketHub origin can submit public Laundry requests without credentialed admin CORS access', async () => {
  const platformOrigin = process.env.MARKETHUB_PUBLIC_URL!
  const bookingResponse = await fetch(`${baseUrl}/api/v1/laundry/bookings`, {
    method: 'POST',
    headers: { origin: platformOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(bookingResponse.status, 400)
  assert.equal(bookingResponse.headers.get('access-control-allow-origin'), platformOrigin)
  assert.equal(bookingResponse.headers.get('access-control-allow-credentials'), null)

  const adminPreflight = await fetch(`${baseUrl}/api/v1/admin/laundry/bookings`, {
    method: 'OPTIONS',
    headers: { origin: platformOrigin, 'access-control-request-method': 'GET' },
  })
  assert.equal(adminPreflight.headers.get('access-control-allow-origin'), null)
  assert.equal(adminPreflight.headers.get('access-control-allow-credentials'), null)
})

test('guest order management requires administrator authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/guest-orders`)
  assert.equal(response.status, 401)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED')
})

test('does not apply the authentication limit to regular admin writes', async () => {
  const responses = await Promise.all(Array.from({ length: 65 }, () => fetch(`${baseUrl}/api/v1/admin/orders/1/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'processing' }),
  })))

  assert.deepEqual([...new Set(responses.map((response) => response.status))], [403])
})

test('admin session endpoint rejects requests without an administrator cookie', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/me`)
  assert.equal(response.status, 401)
  const payload = await response.json() as { error: { code: string } }
  assert.equal(payload.error.code, 'UNAUTHENTICATED')
})

test('operations login uses the verified administrator form without an existing session', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/operations-login`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ identity: 'admin@example.com', password: '' }),
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_INPUT')
})

test('ordinary administrator registration is disabled in favor of Super Admin invitations', async () => {
  const statusResponse = await fetch(`${baseUrl}/api/v1/admin/registration-status`)
  assert.deepEqual(await statusResponse.json(), { data: { available: false } })

  const registrationResponse = await fetch(`${baseUrl}/api/v1/admin/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'New Admin', email: 'new@example.com', password: 'a-long-password-here', secretKey: 'not-accepted' }),
  })
  assert.equal(registrationResponse.status, 404)
  assert.equal((await registrationResponse.json() as { error: { code: string } }).error.code, 'NOT_FOUND')
})

test('Super Admin ecosystem APIs reject callers without an admin session', async () => {
  const requests = [
    fetch(`${baseUrl}/api/v1/admin/ecosystem/alerts`),
    fetch(`${baseUrl}/api/v1/admin/ecosystem/roles`),
    fetch(`${baseUrl}/api/v1/admin/ecosystem/roles/sales_admin/permissions`),
    fetch(`${baseUrl}/api/v1/admin/ecosystem/administrators/1/permissions`),
    fetch(`${baseUrl}/api/v1/admin/ecosystem/administrators/archive`, { method: 'POST', headers: { origin: process.env.CLIENT_ORIGIN!, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [1] }) }),
  ]
  const responses = await Promise.all(requests)
  for (const response of responses) {
    assert.equal(response.status, 401)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED')
  }
})

test('operations endpoints reject store-administrator sessions', async () => {
  for (const path of ['/me', '/operators', '/overview', '/telemetry', '/health', '/workers', '/detections', '/events', '/metrics', '/database-performance', '/database-performance/events', '/runtime-performance', '/provider-performance', '/payments', '/security/waf', '/security/sbom', '/security/notifications/status', '/alerts', '/incidents', '/audit']) {
    const response = await fetch(`${baseUrl}/api/v1/operations${path}`, { headers: { cookie: 'kc_admin_session=not-an-operations-session' } })
    assert.equal(response.status, 401, path)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'OPERATIONS_UNAUTHENTICATED', path)
  }

  const adminResponse = await fetch(`${baseUrl}/api/v1/admin/me`, { headers: { cookie: 'kc_ops_session=not-a-store-admin-session' } })
  assert.equal(adminResponse.status, 401)
  assert.equal((await adminResponse.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED')
})

test('Operations API rejects requests without an Operations session before querying protected data', async () => {
  for (const path of ['/me', '/operators', '/overview', '/telemetry', '/health', '/workers', '/detections', '/events', '/metrics', '/database-performance', '/database-performance/events', '/runtime-performance', '/provider-performance', '/payments', '/security/waf', '/security/sbom', '/security/notifications/status', '/alerts', '/incidents', '/audit']) {
    const response = await fetch(`${baseUrl}/api/v1/operations${path}`)
    assert.equal(response.status, 401, path)
    assert.deepEqual(await response.json(), {
      error: { code: 'OPERATIONS_UNAUTHENTICATED', message: 'Operations sign in is required.' },
    }, path)
  }
})

test('Operations session status reports signed-out state without an authentication error', async () => {
  const response = await fetch(`${baseUrl}/api/v1/operations/session-status`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: { hasSessionCookie: false } })
})

test('IT operator self-signup is disabled in favor of managed provisioning', async () => {
  const statusResponse = await fetch(`${baseUrl}/api/v1/operations/registration-status`)
  assert.equal(statusResponse.status, 200)
  assert.equal((await statusResponse.json() as { data: { available: boolean } }).data.available, false)

  const registrationResponse = await fetch(`${baseUrl}/api/v1/operations/register`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'IT Operator',
      email: 'it@example.com',
      password: 'a-secure-passphrase-2026',
      secretKey: 'not-configured',
    }),
  })
  assert.equal(registrationResponse.status, 404)
  assert.equal((await registrationResponse.json() as { error: { code: string } }).error.code, 'NOT_FOUND')
})

test('operations mutations reject cross-origin requests before checking authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/operations/incidents`, {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'ORIGIN_REJECTED')
})

test('administrator ecosystem mutations reject cross-origin requests before authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/ecosystem/roles/sales_admin/permissions`, {
    method: 'PUT',
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ permissions: ['sales.view'] }),
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'ORIGIN_REJECTED')
})

test('MarketHub can read public site images but cannot use Kitz admin writes', async () => {
  const origin = 'https://market.example.test'
  const read = await fetch(`${baseUrl}/api/v1/store/site-images`, { headers: { origin } })
  assert.equal(read.headers.get('access-control-allow-origin'), origin)
  const contentRead = await fetch(`${baseUrl}/api/v1/store/site-content`, { headers: { origin } })
  assert.equal(contentRead.headers.get('access-control-allow-origin'), origin)

  const write = await fetch(`${baseUrl}/api/v1/admin/homepage/site-images/platform-brand-logo`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/octet-stream' },
    body: Buffer.from('not-an-image'),
  })
  assert.equal(write.status, 403)
  assert.equal(write.headers.get('access-control-allow-origin'), null)
  assert.equal((await write.json() as { error: { code: string } }).error.code, 'ORIGIN_REJECTED')

  const contentWrite = await fetch(`${baseUrl}/api/v1/admin/homepage/site-content`, {
    method: 'PUT',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(contentWrite.status, 403)
  assert.equal((await contentWrite.json() as { error: { code: string } }).error.code, 'ORIGIN_REJECTED')
})

test('MarketHub service authentication endpoints reject ordinary browser requests', async () => {
  for (const path of ['/api/v1/admin/marketplace/authenticate', '/api/v1/admin/marketplace/authorize']) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(response.status, 401, path)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'MARKETHUB_SERVICE_UNAUTHORIZED', path)
  }

  const authenticatedRequest = await fetch(`${baseUrl}/api/v1/admin/marketplace/authenticate`, {
    method: 'POST',
    headers: { 'x-markethub-service-token': process.env.MARKETHUB_SERVICE_TOKEN!, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(authenticatedRequest.status, 400)
  assert.equal((await authenticatedRequest.json() as { error: { code: string } }).error.code, 'INVALID_MARKETPLACE_CREDENTIALS')
})

test('customer and administrator session renewal reject requests without valid sessions', async () => {
  for (const path of ['/api/v1/auth/session/activity', '/api/v1/admin/session/activity']) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { origin: process.env.CLIENT_ORIGIN! },
    })
    assert.equal(response.status, 401, path)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED', path)
  }
})

test('allows same-origin site previews while blocking external framing on application responses', async () => {
  const responses = await Promise.all([
    fetch(`${baseUrl}/health/live`),
    fetch(`${baseUrl}/api/v1/admin/me`),
    fetch(`${baseUrl}/api/v1/missing`),
    fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid json',
    }),
  ])
  const [response] = responses
  const policy = response.headers.get('content-security-policy') ?? ''
  assert.match(policy, /img-src[^;]*https:/)
  assert.match(policy, /frame-src[^;]*https:\/\/maps\.google\.com/)
  assert.match(policy, /frame-src[^;]*https:\/\/www\.google\.com/)
  assert.match(policy, /frame-ancestors 'self'/)
  assert.match(policy, /frame-src[^;]*'self'[^;]*https:\/\/market\.example\.test/)
  assert.equal(response.headers.get('strict-transport-security') ?? '', 'max-age=31536000; includeSubDomains')
  assert.equal(response.headers.get('x-content-type-options') ?? '', 'nosniff')
  assert.equal(response.headers.get('referrer-policy') ?? '', 'no-referrer')
  for (const protectedResponse of responses) {
    assert.equal(protectedResponse.headers.get('x-frame-options') ?? '', 'SAMEORIGIN')
    assert.match(protectedResponse.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/)
  }
  assert.equal(responses[1].status, 401)
  assert.equal(responses[2].status, 404)
  assert.equal(responses[3].status, 400)
  assert.deepEqual(await responses[3].json(), { error: { code: 'INVALID_JSON_BODY', message: 'The request body must be valid JSON.' } })
})

test('readiness reflects unavailable MySQL while liveness remains healthy', async () => {
  const [liveness, readiness] = await Promise.all([
    fetch(`${baseUrl}/health/live`),
    fetch(`${baseUrl}/health/ready`),
  ])
  assert.equal(liveness.status, 200)
  assert.equal(readiness.status, 503)
  assert.deepEqual(await readiness.json(), { status: 'not_ready' })
})

test('diagnoses nested MySQL TLS errors without logging Drizzle SQL or credentials', () => {
  const tlsError = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'HANDSHAKE_SSL_ERROR' })
  const aggregate = new AggregateError([tlsError], 'Connection failed')
  const drizzleError = Object.assign(new Error('Failed query: SELECT * FROM products WHERE email = secret@example.com'), {
    name: 'DrizzleQueryError',
    cause: aggregate,
  })
  const result = inspectDatabaseError(drizzleError)

  assert.equal(result.category, 'connection')
  assert.equal(result.errors[0].message, 'Drizzle query failed.')
  assert.equal(result.errors[2].code, 'HANDSHAKE_SSL_ERROR')
  assert.equal(result.errors[2].message, 'self-signed certificate in certificate chain')
  assert.ok(result.errors.every(({ message }) => !message.includes('secret@example.com')))
})

test('preserves IP addresses in sanitized database connection errors', () => {
  const result = inspectDatabaseError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' }))
  assert.equal(result.errors[0].message, 'connect ECONNREFUSED 127.0.0.1:3306')
})

test('distinguishes missing MySQL tables and columns from connection failures', () => {
  assert.equal(inspectDatabaseError(Object.assign(new Error("Table 'railway.products' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' })).category, 'missing_table')
  assert.equal(inspectDatabaseError(Object.assign(new Error("Unknown column 'published' in 'where clause'"), { code: 'ER_BAD_FIELD_ERROR' })).category, 'missing_column')
})

test('classifies PostgreSQL SQLSTATEs and redacts PostgreSQL connection URLs', () => {
  const missingTable = inspectDatabaseError(Object.assign(new Error('relation products does not exist'), { code: '42P01' }))
  assert.equal(missingTable.category, 'missing_table')
  assert.equal(missingTable.errors[0].message, 'PostgreSQL table is missing.')

  const connection = inspectDatabaseError(Object.assign(
    new Error('connection failed: postgresql://user:secret@db.example.test/postgres'),
    { code: '08006' },
  ))
  assert.equal(connection.category, 'connection')
  assert.ok(connection.errors[0].message.includes('[redacted-db-url]'))
  assert.ok(!connection.errors[0].message.includes('secret'))
})

test('returns temporary-unavailability responses when MySQL is unreachable', async () => {
  const catalogue = await fetch(`${baseUrl}/api/v1/products`)
  assert.equal(catalogue.status, 503)
  const catalogueResult = await catalogue.json() as { error: { code: string; requestId?: string } }
  assert.equal(catalogueResult.error.code, 'DATABASE_UNAVAILABLE')
  assert.ok(catalogueResult.error.requestId)

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'not-a-real-password' }),
  })
  assert.equal(login.status, 503)
  const loginResult = await login.json() as { error: { code: string; requestId?: string } }
  assert.equal(loginResult.error.code, 'DATABASE_UNAVAILABLE')
  assert.ok(loginResult.error.requestId)
  assert.equal(login.headers.get('set-cookie'), null)
})

test('IT operations overview and grant APIs require an administrator session', async () => {
  for (const path of [
    '/api/v1/admin/it/overview',
    '/api/v1/admin/it/access',
    '/api/v1/admin/it/administrators',
    '/api/v1/admin/it/incidents',
    '/api/v1/admin/it/incidents/1/events',
    '/api/v1/admin/it/audit',
  ]) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 401)
    const result = await response.json() as { error: { code: string } }
    assert.equal(result.error.code, 'UNAUTHENTICATED')
  }
})

test('trusts the observed Render and Cloudflare proxy chain for rate limiting', async () => {
  assert.equal(app.get('trust proxy'), 3)
  const response = await fetch(`${baseUrl}/api/v1/missing`, {
    headers: { 'x-forwarded-for': '198.51.100.24, 104.23.243.42, 10.24.90.146' },
  })
  assert.equal(response.status, 404)
  assert.ok(response.headers.has('ratelimit-policy'))
})

test('limits repeated M-PESA STK initiation attempts per forwarded client IP', async () => {
  const statuses = await Promise.all(Array.from({ length: 6 }, async () => {
    const response = await fetch(`${baseUrl}/api/v1/orders/KC-2026-000001/mpesa/stk-push`, {
      method: 'POST',
      headers: {
        origin: process.env.CLIENT_ORIGIN!,
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.42, 104.23.243.42, 10.24.90.146',
      },
      body: JSON.stringify({ phone: '0712345678' }),
    })
    return response.status
  }))
  assert.equal(statuses.filter((status) => status === 429).length, 1)
  assert.equal(statuses.filter((status) => status === 401).length, 5)
})

test('rejects cross-origin administrator mutations before checking authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/categories`, {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test', slug: 'test' }),
  })
  assert.equal(response.status, 403)
  const result = await response.json() as { error: { code: string } }
  assert.equal(result.error.code, 'ORIGIN_REJECTED')
})

test('operations sign-in uses its own login endpoint and validation contract', async () => {
  const response = await fetch(`${baseUrl}/api/v1/operations/login`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ops@example.com', password: '' }),
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_OPERATIONS_LOGIN')
})

test('IT operations APIs require an administrator session', async () => {
  for (const path of ['/api/v1/admin/it/overview', '/api/v1/admin/it/access', '/api/v1/admin/it/identity-bridge-status']) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 401)
    const result = await response.json() as { error: { code: string } }
    assert.equal(result.error.code, 'UNAUTHENTICATED')
  }
})

test('Operations session exchange rejects callers without a central administrator session', async () => {
  const response = await fetch(`${baseUrl}/api/v1/admin/it/operations-session`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN! },
  })
  assert.equal(response.status, 401)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('recognizes two Supabase pooler URLs for the same project as one database target', () => {
  assert.equal(areSameDatabaseTarget(
    'postgresql://postgres.projectref:secret@aws-0-region.pooler.supabase.com:6543/postgres',
    'postgresql://postgres.projectref:other-secret@aws-0-region.pooler.supabase.com:5432/postgres',
  ), true)
  assert.equal(areSameDatabaseTarget(
    'postgresql://postgres.kitzref:secret@aws-0-region.pooler.supabase.com:6543/postgres',
    'postgresql://postgres.adminref:secret@aws-0-region.pooler.supabase.com:6543/postgres',
  ), false)
})

test('Super Admin WebAuthn routes reject requests without an administrator session', async () => {
  const options = { method: 'POST', headers: { origin: process.env.CLIENT_ORIGIN!, 'Content-Type': 'application/json' }, body: '{}' }
  const requests = [
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/status`),
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/devices`),
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/register/options`, options),
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/register/verify`, options),
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/authenticate/options`, options),
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/authenticate/verify`, options),
    fetch(`${baseUrl}/api/v1/super-admin/biometrics/revoke`, options),
  ]
  const responses = await Promise.all(requests)
  for (const response of responses) {
    assert.equal(response.status, 401)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHENTICATED')
  }
})

test('WebAuthn relying party binds to the configured site origin and rejects insecure non-local origins', () => {
  assert.deepEqual(webAuthnRelyingParty('https://admin.kitculture.example'), {
    origin: 'https://admin.kitculture.example',
    rpID: 'admin.kitculture.example',
    rpName: 'KitCulture IT Portal',
  })
  assert.throws(() => webAuthnRelyingParty('http://admin.kitculture.example'), /requires HTTPS/)
})

test('Super Admin WebAuthn mutations reject cross-origin requests before authentication', async () => {
  const response = await fetch(`${baseUrl}/api/v1/super-admin/biometrics/register/options`, {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'ORIGIN_REJECTED')
})

test('WebAuthn lockout activates at the configured failed-attempt threshold', () => {
  const now = new Date('2026-11-20T12:00:00.000Z')
  assert.deepEqual(biometricLockoutStatus(4, new Date(now.getTime() - 60_000), now), { failures: 4, lockedUntil: null })
  assert.deepEqual(biometricLockoutStatus(5, new Date(now.getTime() - 60_000), now), {
    failures: 5,
    lockedUntil: new Date(now.getTime() + 14 * 60_000),
  })
})

test('WebAuthn challenges are single-use and expire strictly before verification', () => {
  const now = new Date('2026-11-20T12:00:00.000Z')
  assert.equal(isBiometricChallengeConsumable({ expiresAt: new Date(now.getTime() + 1), consumedAt: null }, now), true)
  assert.equal(isBiometricChallengeConsumable({ expiresAt: now, consumedAt: null }, now), false)
  assert.equal(isBiometricChallengeConsumable({ expiresAt: new Date(now.getTime() + 1), consumedAt: now }, now), false)
})