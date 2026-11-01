import assert from 'node:assert/strict'
import { get } from 'node:http'
import { once } from 'node:events'
import compression from 'compression'
import express from 'express'
import { test } from 'node:test'
import { publicApiCache } from './public-cache.js'

test('caches public catalogue responses without caching private API routes', async (context) => {
  const app = express()
  let publicCalls = 0
  let privateCalls = 0
  app.use(publicApiCache)
  app.get('/api/v1/products', (_request, response) => {
    publicCalls += 1
    response.json({ data: [{ id: publicCalls }] })
  })
  app.get('/api/v1/account/profile', (_request, response) => {
    privateCalls += 1
    response.json({ data: { id: privateCalls } })
  })

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const publicUrl = `${baseUrl}/api/v1/products?test=${crypto.randomUUID()}`
  const firstPublicResponse = await fetch(publicUrl)
  const secondPublicResponse = await fetch(publicUrl)

  assert.equal(firstPublicResponse.headers.get('x-cache'), 'MISS')
  assert.equal(secondPublicResponse.headers.get('x-cache'), 'HIT')
  assert.match(secondPublicResponse.headers.get('cache-control') ?? '', /max-age=10/)
  assert.deepEqual(await secondPublicResponse.json(), { data: [{ id: 1 }] })
  assert.equal(publicCalls, 1)

  await fetch(`${baseUrl}/api/v1/account/profile`)
  await fetch(`${baseUrl}/api/v1/account/profile`)
  assert.equal(privateCalls, 2)
})

test('compresses large text responses for clients that accept gzip', async (context) => {
  const app = express()
  app.use(compression())
  app.get('/large', (_request, response) => response.type('text/plain').send('x'.repeat(2048)))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${address.port}/large`, { headers: { 'accept-encoding': 'gzip' } }, resolve)
    request.on('error', reject)
  })
  assert.equal(response.headers['content-encoding'], 'gzip')
  response.resume()
  await once(response, 'end')
})