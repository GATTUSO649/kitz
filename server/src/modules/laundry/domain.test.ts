import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canTransitionLaundryStatus, centsToMoney, laundryPaymentStatus, moneyToCents, wouldOverpay } from './domain.js'

test('laundry money conversion uses cents without floating point totals', () => {
  assert.equal(moneyToCents('123.45'), 12345)
  assert.equal(centsToMoney(12345), '123.45')
})

test('laundry payment status derives paid, unpaid, and pending consistently', () => {
  assert.equal(laundryPaymentStatus({ amountDueCents: 5000, amountPaidCents: 5000, pendingPayments: 0 }), 'PAID')
  assert.equal(laundryPaymentStatus({ amountDueCents: 5000, amountPaidCents: 0, pendingPayments: 0 }), 'UNPAID')
  assert.equal(laundryPaymentStatus({ amountDueCents: 5000, amountPaidCents: 1200, pendingPayments: 0 }), 'PENDING')
  assert.equal(laundryPaymentStatus({ amountDueCents: 5000, amountPaidCents: 0, pendingPayments: 1 }), 'PENDING')
})

test('laundry confirmed payment cannot exceed the remaining booking balance', () => {
  assert.equal(wouldOverpay(5000, 3000, 2000), false)
  assert.equal(wouldOverpay(5000, 3000, 2001), true)
  assert.equal(wouldOverpay(0, 0, 100), true)
})

test('laundry processing follows allowed workflow transitions only', () => {
  assert.equal(canTransitionLaundryStatus('new', 'confirmed'), true)
  assert.equal(canTransitionLaundryStatus('confirmed', 'washing'), false)
  assert.equal(canTransitionLaundryStatus('out_for_delivery', 'completed'), true)
  assert.equal(canTransitionLaundryStatus('completed', 'washing'), false)
})