import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callbackFailureStatus, DarajaRequestError, getDarajaReadiness, initiateStkPush, parseDarajaTimestamp, queryStkPayment, verifyMarketplaceStkCallback } from './daraja.js'

const configuration = {
  MARKETPLACE_DARAJA_ENVIRONMENT: 'sandbox',
  MARKETPLACE_DARAJA_CONSUMER_KEY: 'unit-test-consumer-key',
  MARKETPLACE_DARAJA_CONSUMER_SECRET: 'unit-test-consumer-secret',
  MARKETPLACE_DARAJA_PASSKEY: 'unit-test-passkey',
  MARKETPLACE_DARAJA_SHORTCODE: '123456',
  MARKETPLACE_DARAJA_TRANSACTION_TYPE: 'CustomerPayBillOnline',
  MARKETPLACE_DARAJA_CALLBACK_URL: `https://market.example/api/v1/marketplace/payments/callback/${'c'.repeat(40)}`,
  MARKETPLACE_DARAJA_CALLBACK_TOKEN: 'c'.repeat(40),
} as NodeJS.ProcessEnv

test('STK push authenticates, formats bounded reference fields, and stores provider request identifiers', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const result = await initiateStkPush({ phone: '254712345678', amountKes: 150, paymentReference: 'MP-1234567890ABCDEF', description: 'Marketplace publication fee' }, {
    env: configuration,
    fetcher: async (input, init) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/oauth/')) return new Response(JSON.stringify({ access_token: 'unit-test-token', expires_in: '3600' }), { status: 200 })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      assert.equal(body.AccountReference, 'MP-123456789')
      assert.equal(String(body.TransactionDesc).length, 13)
      assert.equal(body.Amount, 150)
      assert.equal(body.PhoneNumber, '254712345678')
      assert.equal(body.BusinessShortCode, configuration.MARKETPLACE_DARAJA_SHORTCODE)
      assert.equal(body.PartyB, configuration.MARKETPLACE_DARAJA_SHORTCODE)
      assert.equal(init?.headers && new Headers(init.headers).get('Authorization'), 'Bearer unit-test-token')
      return new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_123', MerchantRequestID: 'merchant_123' }), { status: 200 })
    },
  })
  assert.equal(requests.length, 2)
  assert.match(new Headers(requests[0]?.init?.headers).get('Authorization') ?? '', /^Basic /)
  assert.deepEqual(result, { ResponseCode: '0', CheckoutRequestID: 'ws_CO_123', MerchantRequestID: 'merchant_123' })
})

test('production mode uses the Safaricom production API and reports readiness without secrets', async () => {
  const productionConfig = { ...configuration, MARKETPLACE_DARAJA_ENVIRONMENT: 'production' } as NodeJS.ProcessEnv
  const urls: string[] = []
  await initiateStkPush({ phone: '254712345678', amountKes: 150, paymentReference: 'MP-PRODUCTION-123', description: 'Marketplace fee' }, {
    env: productionConfig,
    fetcher: async (input) => {
      const url = String(input)
      urls.push(url)
      return url.includes('/oauth/')
        ? new Response(JSON.stringify({ access_token: 'production-unit-test-token', expires_in: '3600' }), { status: 200 })
        : new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_PROD', MerchantRequestID: 'merchant_prod' }), { status: 200 })
    },
  })
  assert.equal(new URL(urls[0]!).origin, 'https://api.safaricom.co.ke')
  assert.deepEqual(getDarajaReadiness(productionConfig), { mode: 'production', status: 'ready' })
  assert.deepEqual(getDarajaReadiness({ ...productionConfig, MARKETPLACE_DARAJA_PASSKEY: '' }), {
    mode: 'production', status: 'misconfigured', issue: 'missing_variables', missingVariables: ['MARKETPLACE_DARAJA_PASSKEY'],
  })
  assert.deepEqual(getDarajaReadiness({ ...productionConfig, MARKETPLACE_DARAJA_CALLBACK_URL: 'https://market.example/wrong-path' }), {
    mode: 'production', status: 'misconfigured', issue: 'callback_url_mismatch',
  })
  assert.deepEqual(getDarajaReadiness({}), { mode: 'disabled', status: 'disabled' })
})

test('production Buy Goods STK uses the configured receiving Till as PartyB', async () => {
  const buyGoodsConfig = {
    ...configuration,
    MARKETPLACE_DARAJA_ENVIRONMENT: 'production',
    MARKETPLACE_DARAJA_TRANSACTION_TYPE: 'CustomerBuyGoodsOnline',
    MARKETPLACE_DARAJA_TILL_NUMBER: '6543210',
  } as NodeJS.ProcessEnv
  const stkBodies: Record<string, unknown>[] = []
  await initiateStkPush({ phone: '254712345678', amountKes: 150, paymentReference: 'MP-BUYGOODS-123', description: 'Marketplace fee' }, {
    env: buyGoodsConfig,
    fetcher: async (input, init) => {
      if (String(input).includes('/oauth/')) return new Response(JSON.stringify({ access_token: 'buy-goods-token', expires_in: '3600' }), { status: 200 })
      stkBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_TILL', MerchantRequestID: 'merchant_till' }), { status: 200 })
    },
  })
  assert.equal(stkBodies[0]?.BusinessShortCode, configuration.MARKETPLACE_DARAJA_SHORTCODE)
  assert.equal(stkBodies[0]?.PartyB, '6543210')
  assert.deepEqual(getDarajaReadiness(buyGoodsConfig), { mode: 'production', status: 'ready' })
  assert.deepEqual(getDarajaReadiness({ ...buyGoodsConfig, MARKETPLACE_DARAJA_TILL_NUMBER: '' }), {
    mode: 'production', status: 'misconfigured', issue: 'missing_variables', missingVariables: ['MARKETPLACE_DARAJA_TILL_NUMBER'],
  })
})

test('invalid STK amount is rejected before contacting Daraja', async () => {
  let called = false
  await assert.rejects(() => initiateStkPush({ phone: '254712345678', amountKes: 0, paymentReference: 'MP-123', description: 'Fee' }, {
    env: configuration,
    fetcher: async () => { called = true; return new Response('{}') },
  }), /payment details are invalid/)
  assert.equal(called, false)
})

test('STK provider rejection is distinguished from an unknown network outcome', async () => {
  const error = await initiateStkPush({ phone: '254712345678', amountKes: 150, paymentReference: 'MP-123', description: 'Fee' }, {
    env: { ...configuration, MARKETPLACE_DARAJA_CONSUMER_KEY: 'different-rejection-key' },
    fetcher: async (input) => String(input).includes('/oauth/')
      ? new Response(JSON.stringify({ access_token: 'token', expires_in: '3600' }), { status: 200 })
      : new Response(JSON.stringify({ ResponseCode: '1' }), { status: 400 }),
  }).then(() => null, (reason: unknown) => reason)
  assert.ok(error instanceof DarajaRequestError)
  assert.equal(error.stage, 'stk_push')
  assert.equal(error.outcome, 'rejected')
  assert.doesNotMatch(error.message, /consumer-secret|passkey|token/i)
})

test('STK query returns request identifiers needed to match a callback', async () => {
  const result = await queryStkPayment('checkout-456', {
    env: { ...configuration, MARKETPLACE_DARAJA_CONSUMER_KEY: 'query-test-key' },
    fetcher: async (input) => String(input).includes('/oauth/')
      ? new Response(JSON.stringify({ access_token: 'query-token', expires_in: '3600' }), { status: 200 })
      : new Response(JSON.stringify({ ResultCode: '0', ResultDesc: 'Processed', CheckoutRequestID: 'checkout-456', MerchantRequestID: 'merchant-456' }), { status: 200 }),
  })
  assert.deepEqual(result, { resultCode: '0', resultDescription: 'Processed', checkoutRequestId: 'checkout-456', merchantRequestId: 'merchant-456' })
})

test('Daraja transaction dates parse as Nairobi time and reject invalid dates', () => {
  assert.equal(parseDarajaTimestamp('20261231235959')?.toISOString(), '2026-12-31T20:59:59.000Z')
  assert.equal(parseDarajaTimestamp('20260229010101'), null)
  assert.equal(parseDarajaTimestamp('invalid'), null)
})

test('callback settlement requires matching provider IDs, amount, payer, receipt, and transaction time', () => {
  const paymentCreatedAt = new Date('2026-11-06T09:00:00.000Z')
  const transactionAt = new Date('2026-11-06T09:02:00.000Z')
  const valid = {
    callbackResultCode: '0',
    callbackCheckoutRequestId: 'checkout-1',
    callbackMerchantRequestId: 'merchant-1',
    queryCheckoutRequestId: 'checkout-1',
    queryMerchantRequestId: 'merchant-1',
    queryResultCode: '0',
    callbackAmount: 150,
    expectedAmount: 150,
    callbackPhone: '254712345678',
    expectedPhone: '254712345678',
    receipt: 'QWE1234567',
    transactionAt,
    paymentCreatedAt,
    now: new Date('2026-11-06T09:03:00.000Z'),
  }
  assert.equal(verifyMarketplaceStkCallback(valid), true)
  assert.equal(verifyMarketplaceStkCallback({ ...valid, callbackAmount: 149 }), false)
  assert.equal(verifyMarketplaceStkCallback({ ...valid, queryCheckoutRequestId: 'another-checkout' }), false)
  assert.equal(verifyMarketplaceStkCallback({ ...valid, callbackPhone: '254700000000' }), false)
  assert.equal(verifyMarketplaceStkCallback({ ...valid, transactionAt: new Date('2026-11-06T08:00:00.000Z') }), false)
})

test('Daraja cancellation and timeout result codes map to terminal payment states', () => {
  assert.equal(callbackFailureStatus('1032'), 'cancelled')
  assert.equal(callbackFailureStatus('1037'), 'expired')
  assert.equal(callbackFailureStatus('1'), 'failed')
})