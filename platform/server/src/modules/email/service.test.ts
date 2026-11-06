import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMarketplaceEmailProviderStatus, renderMarketplaceEmail, sendMarketplaceEmail } from './service.js'

const smtpEnvironment = {
  MARKETPLACE_EMAIL_PROVIDER: 'smtp',
  MARKETPLACE_BREVO_FROM_NAME: 'MarketHub',
  MARKETPLACE_BREVO_FROM_EMAIL: 'notify@example.test',
  MARKETPLACE_BREVO_SMTP_HOST: 'smtp-relay.brevo.com',
  MARKETPLACE_BREVO_SMTP_PORT: '2525',
  MARKETPLACE_BREVO_SMTP_USER: 'smtp-user',
  MARKETPLACE_BREVO_SMTP_PASSWORD: 'not-a-real-secret',
}

const resendEnvironment = {
  MARKETPLACE_EMAIL_PROVIDER: 'resend',
  MARKETPLACE_RESEND_API_KEY: 'resend-test-secret',
  MARKETPLACE_RESEND_FROM_EMAIL: 'notify@example.test',
  MARKETPLACE_RESEND_FROM_NAME: 'MarketHub',
}

test('marketplace email templates escape user-provided HTML', () => {
  const rendered = renderMarketplaceEmail({
    to: 'buyer@example.test',
    kind: 'product_submission_received',
    data: { name: '<img src=x onerror=alert(1)>', title: 'Used <script>alert(1)</script>', reference: 'MH-123' },
  })
  assert.match(rendered.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(rendered.html, /<script>|<img src=x/)
})

test('marketplace email dispatch reports accepted SMTP delivery', async () => {
  let deliveredTo = ''
  let sender = ''
  let host = ''
  const result = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: { reference: 'MH-123' } }, {
    env: smtpEnvironment,
    sendSmtp: async (options, message) => {
      deliveredTo = message.to
      sender = `${message.from.name} <${message.from.address}>`
      host = options.host
      return { accepted: [message.to], messageId: 'provider-message-1' }
    },
  })
  assert.deepEqual(result, { status: 'sent', providerMessageId: 'provider-message-1' })
  assert.equal(deliveredTo, 'seller@example.test')
  assert.equal(sender, 'MarketHub <notify@example.test>')
  assert.equal(host, 'smtp-relay.brevo.com')
})

test('invalid recipients never reach the email provider', async () => {
  let called = false
  const result = await sendMarketplaceEmail({ to: 'not-an-email', kind: 'product_published', data: {} }, {
    env: smtpEnvironment,
    sendSmtp: async () => { called = true; return { accepted: [] } },
  })
  assert.deepEqual(result, { status: 'failed', code: 'INVALID_RECIPIENT' })
  assert.equal(called, false)
})

test('temporary SMTP rejection is retryable without exposing provider details', async () => {
  const result = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: {} }, {
    env: smtpEnvironment,
    sendSmtp: async () => { throw Object.assign(new Error('private provider response'), { responseCode: 451 }) },
  })
  assert.deepEqual(result, { status: 'retry', code: 'SMTP_TEMPORARY_REJECTION' })
})

test('Brevo authentication failure is permanent and provider messages are not returned', async () => {
  const result = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: {} }, {
    env: smtpEnvironment,
    sendSmtp: async () => { throw Object.assign(new Error('private auth response'), { code: 'EAUTH', responseCode: 535 }) },
  })
  assert.deepEqual(result, { status: 'failed', code: 'SMTP_PERMANENT_REJECTION' })
})

test('uncertain SMTP outcomes are not blindly retried', async () => {
  const result = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: {} }, {
    env: smtpEnvironment,
    sendSmtp: async () => { throw Object.assign(new Error('socket closed'), { code: 'ETIMEDOUT' }) },
  })
  assert.deepEqual(result, { status: 'uncertain', code: 'SMTP_OUTCOME_UNKNOWN' })
})

test('Brevo SMTP is not attempted when the required independent credentials are incomplete', async () => {
  let called = false
  const result = await sendMarketplaceEmail({ to: 'buyer@example.test', kind: 'payment_receipt', data: { amountKes: 500 } }, {
    env: { MARKETPLACE_EMAIL_PROVIDER: 'smtp', MARKETPLACE_BREVO_SMTP_HOST: 'smtp-relay.brevo.com' },
    sendSmtp: async () => { called = true; return { accepted: [] } },
  })
  assert.deepEqual(result, { status: 'failed', code: 'BREVO_SMTP_NOT_CONFIGURED' })
  assert.equal(called, false)
})

test('seller and admin verification emails include only safe HTTP action links', () => {
  const verification = renderMarketplaceEmail({
    to: 'seller@example.test',
    kind: 'seller_account_verification',
    data: { actionUrl: 'https://market.example.test/marketplace/seller/verify?token=abc' },
  })
  assert.match(verification.html, /href="https:\/\/market\.example\.test\/marketplace\/seller\/verify\?token=abc"/)
  assert.match(verification.text, /Continue: https:\/\/market\.example\.test/)

  const adminVerification = renderMarketplaceEmail({
    to: 'admin@example.test',
    kind: 'marketplace_admin_verification',
    data: { actionUrl: 'https://market.example.test/admin/marketplace/verify?token=def' },
  })
  assert.match(adminVerification.html, /href="https:\/\/market\.example\.test\/admin\/marketplace\/verify\?token=def"/)

  const unsafe = renderMarketplaceEmail({
    to: 'admin@example.test',
    kind: 'marketplace_admin_invitation',
    data: { actionUrl: 'javascript:alert(1)' },
  })
  assert.doesNotMatch(unsafe.html, /href="javascript:/)
  assert.doesNotMatch(unsafe.text, /Continue: javascript:/)
})

test('Resend accepts a verified sender and records provider acceptance', async () => {
  let sender = ''
  let apiKey = ''
  const result = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: { reference: 'MH-1' } }, {
    env: resendEnvironment,
    sendResend: async (key, message) => { apiKey = key; sender = `${message.from.name} <${message.from.address}>`; return { status: 200, id: 'resend-message-1' } },
  })
  assert.deepEqual(result, { status: 'sent', providerMessageId: 'resend-message-1' })
  assert.equal(sender, 'MarketHub <notify@example.test>')
  assert.equal(apiKey, resendEnvironment.MARKETPLACE_RESEND_API_KEY)
})

test('production email refuses non-Brevo providers', async () => {
  let called = false
  const productionResend = { ...resendEnvironment, NODE_ENV: 'production' }
  assert.deepEqual(getMarketplaceEmailProviderStatus(productionResend), { provider: 'resend', configured: false, code: 'BREVO_SMTP_REQUIRED' })
  const result = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: {} }, {
    env: productionResend,
    sendResend: async () => { called = true; return { status: 200, id: 'resend-message-1' } },
  })
  assert.deepEqual(result, { status: 'failed', code: 'BREVO_SMTP_REQUIRED' })
  assert.equal(called, false)
})

test('Resend rate limits are retried and unknown provider outcomes are not resent automatically', async () => {
  const limited = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: {} }, {
    env: resendEnvironment,
    sendResend: async () => ({ status: 429 }),
  })
  assert.deepEqual(limited, { status: 'retry', code: 'RESEND_RATE_LIMITED' })
  const unknown = await sendMarketplaceEmail({ to: 'seller@example.test', kind: 'product_published', data: {} }, {
    env: resendEnvironment,
    sendResend: async () => { throw new TypeError('network failed') },
  })
  assert.deepEqual(unknown, { status: 'uncertain', code: 'RESEND_OUTCOME_UNKNOWN' })
})

test('email provider readiness reports disabled, unsupported, or incomplete configuration safely', () => {
  assert.deepEqual(getMarketplaceEmailProviderStatus({}), { provider: 'disabled', configured: false, code: 'EMAIL_PROVIDER_DISABLED' })
  assert.deepEqual(getMarketplaceEmailProviderStatus({ MARKETPLACE_EMAIL_PROVIDER: 'resend', MARKETPLACE_RESEND_API_KEY: 'secret' }), { provider: 'resend', configured: false, code: 'RESEND_NOT_CONFIGURED' })
  assert.deepEqual(getMarketplaceEmailProviderStatus(resendEnvironment), { provider: 'resend', configured: true, code: null })
})