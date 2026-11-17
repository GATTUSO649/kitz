import assert from 'node:assert/strict'
import express from 'express'
import test from 'node:test'
import { createWafMiddleware } from './waf.js'
import { addIpPolicy, evaluateIpPolicy, expirePolicies, listIpPolicies, type IpPolicyAction } from './ip-policy.js'

test('IPv4 and IPv6 CIDR patterns are evaluated correctly', () => {
  addIpPolicy({
    id: 'block-203',
    name: 'Block test range',
    action: 'block' as IpPolicyAction,
    value: '203.0.113.0/24',
    type: 'cidr',
    enabled: true,
    priority: 100,
  })

  assert.equal(evaluateIpPolicy('203.0.113.12').action, 'block')
  assert.equal(evaluateIpPolicy('203.0.113.200').action, 'block')
  assert.equal(evaluateIpPolicy('198.51.100.3').action, 'allow')

  addIpPolicy({
    id: 'allow-hex',
    name: 'Allow IPv6 range',
    action: 'allow' as IpPolicyAction,
    value: '2001:db8::/32',
    type: 'cidr',
    enabled: true,
    priority: 200,
  })

  assert.equal(evaluateIpPolicy('2001:db8::1').action, 'allow')
  assert.equal(evaluateIpPolicy('2001:db9::1').action, 'allow')
})

test('policy priority and expiration are enforced in order', () => {
  addIpPolicy({
    id: 'temporary-block',
    name: 'Temporary malicious range',
    action: 'block' as IpPolicyAction,
    value: '10.0.0.0/8',
    type: 'cidr',
    enabled: true,
    priority: 10,
    expiresAt: new Date(Date.now() - 1_000),
  })

  assert.equal(evaluateIpPolicy('10.0.0.5').action, 'allow')

  addIpPolicy({
    id: 'override-block',
    name: 'Higher priority override',
    action: 'block' as IpPolicyAction,
    value: '10.0.0.5',
    type: 'ip',
    enabled: true,
    priority: 50,
  })

  const result = evaluateIpPolicy('10.0.0.5')
  assert.equal(result.action, 'block')
  assert.equal(result.policyId, 'override-block')
  assert.ok(listIpPolicies().some((policy) => policy.id === 'override-block'))
  expirePolicies()
})

test('WAF rejects requests from blocked IP policy entries before normal rule checks', async () => {
  addIpPolicy({
    id: 'waf-block',
    name: 'WAF blocked subnet',
    action: 'block' as IpPolicyAction,
    value: '127.0.0.1',
    type: 'ip',
    enabled: true,
    priority: 500,
  })

  const app = express()
  app.use(express.json())
  app.use(createWafMiddleware('detect'))
  app.post('/api/test', (_request, response) => response.status(204).end())

  const server = app.listen(0)
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'ok' }),
    })
    assert.equal(response.status, 403)
    const body = await response.json()
    assert.equal(body.error.code, 'IP_POLICY_BLOCKED')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
