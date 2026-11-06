import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { test } from 'node:test'
import { createOriginAuthentication } from './origin-auth.js'

const token = 'kitculture-origin-token-12345678901234567890'

test('origin authentication is opt-in until a token is configured', async (context) => {
  const app = express()
  app.use(createOriginAuthentication(undefined))
  app.get('/private', (_request, response) => response.json({ data: 'ok' }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const response = await fetch(`http://127.0.0.1:${address.port}/private`)
  assert.equal(response.status, 200)
})

test('origin authentication rejects missing or incorrect headers and accepts the configured secret', async (context) => {
  const app = express()
  app.use(createOriginAuthentication(token))
  app.get('/admin/access', (_request, response) => response.send('admin access'))
  app.get('/favicon.ico', (_request, response) => response.type('image/x-icon').send('icon'))
  app.get('/health/live', (_request, response) => response.json({ status: 'ok' }))
  app.get('/health/ready', (_request, response) => response.json({ status: 'ready' }))
  app.post('/api/v1/admin/marketplace/authenticate', (_request, response) => response.json({ data: 'ok' }))
  app.post('/api/v1/admin/marketplace/authorize', (_request, response) => response.json({ data: 'ok' }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`

  assert.equal((await fetch(`${baseUrl}/admin/access`)).status, 200)
  assert.equal((await fetch(`${baseUrl}/favicon.ico`)).status, 200)
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/marketplace/authenticate`, { method: 'POST' })).status, 403)
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/marketplace/authenticate`, {
    method: 'POST',
    headers: { 'x-kitculture-origin-auth': token },
  })).status, 200)
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/marketplace/authorize`, { method: 'POST' })).status, 403)
  assert.equal((await fetch(`${baseUrl}/api/v1/admin/marketplace/authorize`, {
    method: 'POST',
    headers: { 'x-kitculture-origin-auth': token },
  })).status, 200)
  assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200)
  assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200)
})