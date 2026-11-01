import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { test } from 'node:test'
import { getRequestMetrics, requestMetrics } from './request-metrics.js'

test('records bounded, privacy-safe route metrics', async (context) => {
  const app = express()
  app.use(requestMetrics)
  app.get('/items/:itemId', (_request, response) => response.json({ data: true }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  await fetch(`${baseUrl}/items/123?email=private@example.com`)
  await fetch(`${baseUrl}/items/456`)

  const snapshot = getRequestMetrics()
  const endpoint = snapshot.endpoints.find((entry) => entry.endpoint.endsWith('/items/:itemId'))
  assert.ok(endpoint)
  assert.equal(endpoint.requests, 2)
  assert.ok(!JSON.stringify(snapshot).includes('123'))
  assert.ok(!JSON.stringify(snapshot).includes('private@example.com'))
})