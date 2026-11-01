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
  app.get('/private', (_request, response) => response.json({ data: 'ok' }))
  app.get('/health/live', (_request, response) => response.json({ status: 'ok' }))
  app.get('/health/ready', (_request, response) => response.json({ status: 'ready' }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`

  assert.equal((await fetch(`${baseUrl}/private`)).status, 403)
  assert.equal((await fetch(`${baseUrl}/private`, { headers: { 'x-kitculture-origin-auth': `${token}wrong` } })).status, 403)
  assert.equal((await fetch(`${baseUrl}/private`, { headers: { 'x-kitculture-origin-auth': token } })).status, 200)
  assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200)
  assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200)
})