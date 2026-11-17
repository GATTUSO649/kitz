import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSecurityAlertEmail, securityNotificationStatus } from './security-notifications.js'

test('security alert email escapes rule metadata and excludes sensitive event details', () => {
  const message = buildSecurityAlertEmail({
    ruleId: 'waf-test',
    ruleName: '<script>unexpected</script>',
    severity: 'error',
    affectedService: 'kitculture-api',
    occurrenceCount: 6,
    windowSeconds: 300,
  })
  assert.match(message.html, /&lt;script&gt;/)
  assert.doesNotMatch(message.html, /<script>/)
  assert.doesNotMatch(message.text, /password|token|phone|payload/i)
  assert.match(message.text, /not proof of compromise/)
})

test('security email readiness reports configuration without exposing values', () => {
  const status = securityNotificationStatus()
  assert.equal(typeof status.configured, 'boolean')
  assert.equal(typeof status.recipientConfigured, 'boolean')
  assert.equal(typeof status.providerConfigured, 'boolean')
  assert.equal(JSON.stringify(status).includes('@'), false)
})