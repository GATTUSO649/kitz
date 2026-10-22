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

test('serves the built homepage and Vite assets without production NODE_ENV', { skip: !hasClientBuild }, async () => {
  const html = readFileSync(`${clientDist}/index.html`, 'utf8')
  const scriptPath = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1]
  const stylesheetPath = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1]
  assert.ok(scriptPath)
  assert.ok(stylesheetPath)

  const homepage = await fetch(baseUrl)
  assert.equal(homepage.status, 200)
  assert.match(homepage.headers.get('content-type') ?? '', /text\/html/)
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