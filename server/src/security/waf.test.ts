import assert from 'node:assert/strict'
import express from 'express'
import test from 'node:test'
import { createWafMiddleware, decideWafAction, inspectWafRequest } from './waf.js'

const request = (overrides: Partial<Parameters<typeof inspectWafRequest>[0]> = {}) => ({
  method: 'GET',
  path: '/api/v1/products',
  headers: {},
  ...overrides,
})

test('WAF detects traversal and malformed path encodings without retaining raw input', () => {
  const findings = inspectWafRequest(request({ path: '/api/%2e%2e/admin' }))
  assert.ok(findings.some(({ ruleId }) => ruleId === 'waf.path-traversal'))
  assert.equal(decideWafAction('detect', findings), 'logged')
})

test('WAF identifies active script markup in parsed request fields', () => {
  const findings = inspectWafRequest(request({ method: 'POST', path: '/api/v1/support', body: { message: '<script>example()</script>' } }))
  assert.deepEqual(findings.map(({ ruleId }) => ruleId), ['waf.active-script-markup'])
  assert.equal(decideWafAction('block', findings), 'blocked')
})

test('WAF records suspicious SQL and command patterns but does not block them by default', () => {
  const findings = inspectWafRequest(request({
    method: 'POST',
    path: '/api/v1/search',
    headers: { 'content-type': 'application/json' },
    query: { term: 'UNION SELECT sample' },
    body: { note: 'value; curl sample' },
  }))
  assert.ok(findings.some(({ ruleId }) => ruleId === 'waf.sql-injection-pattern'))
  assert.ok(findings.some(({ ruleId }) => ruleId === 'waf.command-injection-pattern'))
  assert.equal(decideWafAction('block', findings), 'logged')
})

test('WAF rejects disallowed methods only in configured block mode', () => {
  const findings = inspectWafRequest(request({
    method: 'TRACE',
    headers: { 'content-type': 'application/json' },
  }))
  assert.ok(findings.some(({ ruleId }) => ruleId === 'waf.disallowed-method'))
  assert.equal(decideWafAction('detect', findings), 'logged')
  assert.equal(decideWafAction('block', findings), 'blocked')
  assert.equal(decideWafAction('disabled', findings), 'disabled')
})

test('WAF does not inspect outside API routes or values beyond bounded traversal depth', () => {
  assert.deepEqual(inspectWafRequest(request({ path: '/shop/products', body: { script: '<script>example()</script>' } })), [])
    assert.deepEqual(inspectWafRequest(request({
    body: { nested: { deeper: { value: { more: { script: '<script>example()</script>' } } } } },
    })), [])
})

  test('block mode rejects high-confidence API findings with a generic no-store response', async (context) => {
    const app = express()
    app.use(express.json())
    app.use(createWafMiddleware('block'))
    app.post('/api/test', (_request, response) => response.status(204).end())
    const server = app.listen(0)
    context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: '<script>example()</script>' }),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: { code: 'REQUEST_REJECTED_BY_SECURITY_POLICY', message: 'The request was rejected by the security policy.' } })
  })