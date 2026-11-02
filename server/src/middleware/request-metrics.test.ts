import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { test } from 'node:test'
import { getRequestMetrics, requestMetrics } from './request-metrics.js'

test('records bounded, privacy-safe route metrics', async (context) => {
  const app = express()
  app.use(requestMetrics)
  app.get('/items/:itemId', (_request, response) => response.json({ data: true }))
  app.get('/denied', (_request, response) => response.sendStatus(403))
  app.get('/limited', (_request, response) => response.sendStatus(429))
  app.get('/failure', (_request, response) => response.sendStatus(500))
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
  await fetch(`${baseUrl}/denied`)
  await fetch(`${baseUrl}/limited`)
  await fetch(`${baseUrl}/failure`)

  const snapshot = getRequestMetrics()
  const endpoint = snapshot.endpoints.find((entry) => entry.endpoint.endsWith('/items/:itemId'))
  assert.ok(endpoint)
  assert.equal(endpoint.requests, 2)
  assert.equal(snapshot.successfulRequestCount, 2)
  assert.equal(snapshot.securitySignalCount, 2)
  assert.equal(snapshot.responseDistribution.success, 2)
  assert.equal(snapshot.responseDistribution.clientError, 2)
  assert.equal(snapshot.responseDistribution.serverError, 1)
  assert.equal(snapshot.methods[0].method, 'GET')
  assert.equal(snapshot.requestsLastMinute, 5)
  assert.equal(snapshot.timeline.length, 12)
  assert.equal(snapshot.timeline.reduce((total, bucket) => total + bucket.requestCount, 0), snapshot.requestCount)
  assert.equal(snapshot.timeline.reduce((total, bucket) => total + bucket.securitySignalCount, 0), snapshot.securitySignalCount)
  assert.ok(snapshot.timeline.filter((bucket) => bucket.requestCount > 0)
    .every((bucket) => bucket.averageResponseMs !== null && bucket.p95ResponseMs !== null))
  assert.ok(!JSON.stringify(snapshot).includes('/items/123'))
  assert.ok(!JSON.stringify(snapshot).includes('private@example.com'))
})