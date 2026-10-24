import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

process.env.NODE_ENV = 'development'
process.env.PORT = '4000'
process.env.CLIENT_ORIGIN = 'http://localhost:5173'
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:1/kitculture'
process.env.ADMIN_DATABASE_URL = 'mysql://test:test@127.0.0.1:1/kitculture_admin'
process.env.LOG_LEVEL = 'silent'

const { app } = await import('./app.js')
const { pool, adminPool } = await import('./config/database.js')
const { inspectDatabaseError } = await import('./config/database-diagnostics.js')
const { resolveDatabaseUrl } = await import('./config/env.js')
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

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await Promise.all([pool?.end(), adminPool?.end()])
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
    assert.equal(resolveDatabaseUrl('ADMIN_DATABASE_URL', ['ADMIN_MYSQL_URL']), 'mysql://root:secret@iriguchi.proxy.rlwy.net:14915/railway')
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

  const stylesheet = await fetch(new URL(stylesheetPath, baseUrl))
  assert.equal(stylesheet.status, 200)
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/)

  const image = await fetch(`${baseUrl}/culture-mark.png`)
  assert.equal(image.status, 200)
  assert.match(image.headers.get('content-type') ?? '', /image\/png/)
})

test('keeps unknown API routes as JSON 404s', async () => {
  const response = await fetch(`${baseUrl}/api/v1/missing`)
  assert.equal(response.status, 404)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  const result = await response.json() as { error: { code: string } }
  assert.equal(result.error.code, 'NOT_FOUND')
})

test('does not apply the authentication limit to regular admin writes', async () => {
  const responses = await Promise.all(Array.from({ length: 65 }, () => fetch(`${baseUrl}/api/v1/admin/orders/1/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'processing' }),
  })))

  assert.deepEqual([...new Set(responses.map((response) => response.status))], [403])
})

test('allows HTTPS-hosted images under the content security policy', async () => {
  const response = await fetch(`${baseUrl}/health/live`)
  const policy = response.headers.get('content-security-policy') ?? ''
  assert.match(policy, /img-src[^;]*https:/)
  assert.match(policy, /frame-src[^;]*https:\/\/maps\.google\.com/)
  assert.match(policy, /frame-src[^;]*https:\/\/www\.google\.com/)
})

test('readiness reflects unavailable MySQL while liveness remains healthy', async () => {
  const [liveness, readiness] = await Promise.all([
    fetch(`${baseUrl}/health/live`),
    fetch(`${baseUrl}/health/ready`),
  ])
  assert.equal(liveness.status, 200)
  assert.equal(readiness.status, 503)
  const result = await readiness.json() as { status: string; checks: { storeDatabase: string; adminDatabase: string } }
  assert.equal(result.status, 'not_ready')
  assert.equal(result.checks.storeDatabase, 'unavailable')
  assert.equal(result.checks.adminDatabase, 'unavailable')
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

test('returns temporary-unavailability responses when MySQL is unreachable', async () => {
  const catalogue = await fetch(`${baseUrl}/api/v1/products`)
  assert.equal(catalogue.status, 503)
  const catalogueResult = await catalogue.json() as { error: { code: string } }
  assert.equal(catalogueResult.error.code, 'DATABASE_UNAVAILABLE')

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { origin: process.env.CLIENT_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'not-a-real-password' }),
  })
  assert.equal(login.status, 503)
  const loginResult = await login.json() as { error: { code: string } }
  assert.equal(loginResult.error.code, 'DATABASE_UNAVAILABLE')
  assert.equal(login.headers.get('set-cookie'), null)
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