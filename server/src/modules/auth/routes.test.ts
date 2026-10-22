import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { mysqlSslOptions } from '../../config/database.js'
import { isAllowedClientOrigin } from '../../config/env.js'
import { loginSchema, registerSchema } from './routes.js'
import { createOrderSchema, createTemporaryOrderNumber, exceedsProductQuantityLimit, ordersRouter } from '../orders/routes.js'
import { buildDarajaCallbackUrl, darajaCallbackRoute, isFinalDarajaPaymentStatus, isValidDarajaPaymentAmount, matchesCallbackToken, normalizeKenyanPhone, parseDarajaTimestamp } from '../orders/daraja.js'
import { createAddressSchema, passwordSchema, productReviewSchema, profileSchema, supportMessageSchema, supportRequestSchema } from '../account/routes.js'
import { adminNotificationSchema, canTransitionOrderStatus, createProductSchema, homepageSlideBatchSchema, homepageSlideSchema, isDuplicateKeyError, settingsSchema, supportUpdateSchema } from '../admin/routes.js'
import { detectImageFormat } from '../admin/image-storage.js'

test('registration normalizes email and accepts a long password', () => {
  const result = registerSchema.safeParse({
    fullName: 'Supporter Name',
    email: '  FAN@example.com ',
    password: 'a-long-test-password',
  })

  assert.equal(result.success, true)
  if (result.success) assert.equal(result.data.email, 'fan@example.com')
})

test('registration rejects a short password and malformed email', () => {
  const result = registerSchema.safeParse({
    fullName: 'Supporter Name',
    email: 'not-an-email',
    password: 'short',
  })

  assert.equal(result.success, false)
})

test('login rejects an empty password', () => {
  const result = loginSchema.safeParse({ email: 'fan@example.com', password: '' })
  assert.equal(result.success, false)
})

test('development accepts the configured Vite fallback port 5175', () => {
  assert.equal(isAllowedClientOrigin('http://localhost:5175'), true)
  assert.equal(isAllowedClientOrigin('http://localhost:5176'), false)
})

test('production MySQL connections require verified TLS and accept a custom CA', () => {
  assert.deepEqual(mysqlSslOptions('production'), { rejectUnauthorized: true })
  assert.deepEqual(mysqlSslOptions('production', 'test-ca'), { rejectUnauthorized: true, ca: 'test-ca' })
  assert.equal(mysqlSslOptions('development'), undefined)
  assert.equal(mysqlSslOptions('development', undefined, 'localhost'), undefined)
  assert.deepEqual(mysqlSslOptions('development', 'test-ca', 'mysql.example.com'), { rejectUnauthorized: true, ca: 'test-ca' })
})

test('customer order mutations reject cross-origin requests before authentication', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', ordersRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    for (const path of [
      '/api/v1/orders',
      '/api/v1/orders/KC-2026-000001/mpesa/stk-push',
      '/api/v1/orders/KC-2026-000001/cancel',
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: 'POST',
        headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 403, path)
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('order input requires paired, geographically valid coordinates', () => {
  const input = {
    items: [{ variantId: 3, quantity: 2 }],
    deliveryZoneId: 1,
    address: { recipientName: 'Supporter Name', phone: '0712345678', address: 'Main Street', county: 'Machakos', town: 'Machakos', latitude: -1.5 },
  }
  assert.equal(createOrderSchema.safeParse(input).success, false)
  assert.equal(createOrderSchema.safeParse({
    ...input,
    address: { ...input.address, longitude: 37.2 },
  }).success, true)
  const defaultPayment = createOrderSchema.safeParse({
    ...input,
    address: { ...input.address, longitude: 37.2 },
  })
  assert.equal(defaultPayment.success, true)
  if (defaultPayment.success) assert.equal(defaultPayment.data.paymentMethod, 'pay_on_delivery')
  assert.equal(createOrderSchema.safeParse({
    ...input,
    address: { ...input.address, latitude: 95, longitude: 37.2 },
  }).success, false)
  assert.equal(createOrderSchema.safeParse({ ...input, address: { ...input.address, longitude: undefined } }).success, false)
  assert.equal(createOrderSchema.safeParse({ ...input, address: { ...input.address, phone: '' } }).success, false)
  assert.equal(createOrderSchema.safeParse({ ...input, address: { ...input.address, longitude: 37.2, accuracy: 12.5 } }).success, true)
  assert.equal(createOrderSchema.safeParse({ ...input, address: { ...input.address, longitude: 37.2, accuracy: -1 } }).success, false)
})

test('order input rejects duplicate variants and invalid quantities', () => {
  const base = {
    items: [{ variantId: 3, quantity: 1 }, { variantId: 3, quantity: 1 }],
    deliveryZoneId: 1,
    address: { recipientName: 'Supporter Name', phone: '0712345678', address: 'Main Street', county: 'Machakos', town: 'Machakos', latitude: -1.5, longitude: 37.2 },
  }
  assert.equal(createOrderSchema.safeParse(base).success, false)
  assert.equal(createOrderSchema.safeParse({
    ...base,
    items: [{ variantId: 3, quantity: 6 }],
  }).success, false)
  assert.equal(createOrderSchema.safeParse({ ...base, items: [{ variantId: 3, quantity: 5 }] }).success, true)
  assert.equal(createOrderSchema.safeParse({ ...base, items: [{ variantId: 3, quantity: 1 }], paymentMethod: 'mpesa' }).success, true)
})

test('customer profile updates cannot assign roles or account permissions', () => {
  assert.equal(profileSchema.safeParse({ role: 'admin' }).success, false)
  const result = profileSchema.safeParse({ fullName: 'Supporter Name', role: 'admin', isAdmin: true })
  assert.equal(result.success, true)
  if (result.success) {
    assert.deepEqual(result.data, { fullName: 'Supporter Name' })
  }
})

test('saved delivery addresses require paired, valid GPS coordinates', () => {
  const base = {
    label: 'Home',
    recipientName: 'Supporter Name',
    phone: '+254700000000',
    address: 'Main Street',
    county: 'Machakos',
    town: 'Machakos',
  }
  assert.equal(createAddressSchema.safeParse({ ...base, latitude: -1.5 }).success, false)
  assert.equal(createAddressSchema.safeParse({ ...base, latitude: -1.5, longitude: 37.2 }).success, true)
})

test('password security requires a strong new password distinct from the current password', () => {
  assert.equal(passwordSchema.safeParse({ currentPassword: 'short', newPassword: 'short' }).success, false)
  assert.equal(passwordSchema.safeParse({ currentPassword: 'old-password-123', newPassword: 'new-password-123' }).success, true)
})

test('product creation rejects duplicate variant sizes and SKUs', () => {
  const product = {
    name: 'Match jersey',
    slug: 'match-jersey',
    description: 'A test jersey description.',
    price: '1200.00',
    variants: [
      { sku: 'MATCH-S', size: 'S', stock: 0 },
      { sku: 'MATCH-M', size: 'M', stock: 0 },
    ],
  }
  assert.equal(createProductSchema.safeParse(product).success, true)
  const variantPrice = createProductSchema.safeParse({ ...product, variants: [{ sku: 'MATCH-S-PRICE', size: 'S', stock: 3, price: '1350.00' }] })
  assert.equal(variantPrice.success, true)
  if (variantPrice.success) assert.equal(variantPrice.data.variants[0]?.price, '1350.00')
  const stockedProduct = createProductSchema.safeParse({ ...product, variants: [{ sku: 'MATCH-S', size: 'S', stock: 4 }] })
  assert.equal(stockedProduct.success, true)
  if (stockedProduct.success) assert.equal(stockedProduct.data.variants[0]?.stock, 4)
  assert.equal(createProductSchema.safeParse({
    ...product,
    variants: [product.variants[0], { sku: 'MATCH-M', size: 'S', stock: 0 }],
  }).success, false)
  assert.equal(createProductSchema.safeParse({
    ...product,
    variants: [product.variants[0], { sku: 'MATCH-S', size: 'M', stock: 0 }],
  }).success, false)
  assert.equal(createProductSchema.safeParse({
    ...product,
    variants: [{ sku: 'A'.repeat(81), size: 'S', stock: 0 }],
  }).success, false)
})

test('jersey products can be classified by league, team and jersey category', () => {
  const product = {
    name: 'North London home jersey',
    slug: 'north-london-home-jersey',
    description: 'A test club jersey description.',
    price: '1200.00',
    leagueId: 1,
    teamId: 3,
    jerseyCategoryId: 1,
    variants: [{ sku: 'NORTH-LONDON-S', size: 'S', stock: 0 }],
  }
  assert.equal(createProductSchema.safeParse(product).success, true)
  assert.equal(createProductSchema.safeParse({ ...product, leagueId: 0 }).success, false)
  assert.equal(createProductSchema.safeParse({ ...product, teamId: -1 }).success, false)
  assert.equal(createProductSchema.safeParse({ ...product, jerseyCategoryId: 0 }).success, false)
})

test('product sale pricing stays below the regular price', () => {
  const product = {
    name: 'Match jersey',
    slug: 'match-jersey-sale',
    description: 'A test jersey description.',
    price: '1200.00',
    variants: [{ sku: 'MATCH-SALE-S', size: 'S', stock: 0 }],
  }
  assert.equal(createProductSchema.safeParse({ ...product, salePrice: '900.00' }).success, true)
  assert.equal(createProductSchema.safeParse({ ...product, price: '0.00' }).success, false)
  assert.equal(createProductSchema.safeParse({ ...product, salePrice: '0.00' }).success, false)
  assert.equal(createProductSchema.safeParse({ ...product, salePrice: '1200.00' }).success, false)
  assert.equal(createProductSchema.safeParse({ ...product, salePrice: '1300.00' }).success, false)
})

test('homepage slides require HTTPS imagery, same-site destinations and valid display timing', () => {
  const slide = {
    imageUrl: 'https://images.example.test/home.jpg',
    title: 'New season',
    subtitle: 'Find your colours.',
    ctaLabel: 'Shop now',
    destinationUrl: '/shop',
  }
  assert.equal(homepageSlideSchema.safeParse(slide).success, true)
  assert.equal(homepageSlideSchema.parse(slide).displayDurationSeconds, 5)
  assert.equal(homepageSlideSchema.safeParse({ ...slide, displayDurationSeconds: 1 }).success, false)
  assert.equal(homepageSlideSchema.safeParse({ ...slide, displayDurationSeconds: 31 }).success, false)
  assert.equal(homepageSlideSchema.safeParse({ ...slide, imageUrl: 'javascript:alert(1)' }).success, false)
  assert.equal(homepageSlideSchema.safeParse({ ...slide, destinationUrl: '//attacker.example' }).success, false)
  assert.equal(homepageSlideBatchSchema.safeParse([slide, { ...slide, title: 'Away kit' }]).success, true)
  assert.equal(homepageSlideBatchSchema.safeParse([]).success, false)
  assert.equal(homepageSlideBatchSchema.safeParse(Array.from({ length: 21 }, (_, index) => ({ ...slide, title: `Slide ${index}` }))).success, false)
})

test('product image format detection recognizes supported file signatures only', () => {
  assert.equal(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'jpg')
  assert.equal(detectImageFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'png')
  assert.equal(detectImageFormat(Buffer.from('RIFFxxxxWEBP')), 'webp')
  assert.equal(detectImageFormat(Buffer.from('not an image')), null)
})

test('customer support requests validate fields and optional order references', () => {
  const request = {
    category: 'delivery',
    subject: 'Where is my order?',
    message: 'Could you please share the latest delivery update?',
  }
  assert.equal(supportRequestSchema.safeParse(request).success, true)
  assert.equal(supportRequestSchema.safeParse({ ...request, orderNumber: 'KC-2026-001' }).success, true)
  assert.equal(supportRequestSchema.safeParse({ ...request, category: 'refund' }).success, false)
  assert.equal(supportRequestSchema.safeParse({ ...request, message: 'Help' }).success, false)
  assert.equal(supportRequestSchema.safeParse({ ...request, orderNumber: '' }).success, false)
})

test('support chat location pins require complete valid coordinates', () => {
  assert.equal(supportMessageSchema.safeParse({ body: 'Here is my delivery location.', latitude: -1.5, longitude: 37.2 }).success, true)
  assert.equal(supportMessageSchema.safeParse({ body: 'Here is my delivery location.', latitude: -1.5 }).success, false)
  assert.equal(supportMessageSchema.safeParse({ body: 'Here is my delivery location.', latitude: 95, longitude: 37.2 }).success, false)
})

test('chat kit previews require secure imagery and a local product link', () => {
  const message = {
    body: 'I am interested in this kit.',
    productName: 'Manchester United Home Kit',
    productPrice: 8500,
    productImageUrl: 'https://cdn.example.com/manchester-home.jpg',
    productUrl: '/account/marketplace/products/manchester-united-home',
  }
  assert.equal(supportMessageSchema.safeParse(message).success, true)
  assert.equal(supportMessageSchema.safeParse({ ...message, productImageUrl: 'http://cdn.example.com/manchester-home.jpg' }).success, false)
  assert.equal(supportMessageSchema.safeParse({ ...message, productUrl: 'https://example.com/' }).success, false)
  assert.equal(supportMessageSchema.safeParse({ ...message, productPrice: -1 }).success, false)
})

test('admin support updates require a meaningful status or response', () => {
  assert.equal(supportUpdateSchema.safeParse({ status: 'in_progress' }).success, true)
  assert.equal(supportUpdateSchema.safeParse({ adminResponse: 'We are checking this for you.' }).success, true)
  assert.equal(supportUpdateSchema.safeParse({ adminResponse: null }).success, true)
  assert.equal(supportUpdateSchema.safeParse({ status: 'pending' }).success, false)
  assert.equal(supportUpdateSchema.safeParse({ adminResponse: '' }).success, false)
  assert.equal(supportUpdateSchema.safeParse({}).success, false)
})

test('admin notifications validate audience and same-site destinations', () => {
  const notification = { title: 'Delivery update', body: 'Your order is on the way.', audience: 'all' }
  assert.equal(adminNotificationSchema.safeParse(notification).success, true)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, audience: 'customer', customerId: 12 }).success, true)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, audience: 'customer' }).success, false)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, customerId: 12 }).success, false)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, href: '/account/orders/KC-2026-000001' }).success, true)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, href: '//example.com' }).success, false)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, href: 'https://example.com' }).success, false)
  assert.equal(adminNotificationSchema.safeParse({ ...notification, href: '/\\example.com' }).success, false)
})

test('duplicate MySQL key errors are detected through wrapped query errors', () => {
  const driverError = Object.assign(new Error('duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 })
  const queryError = Object.assign(new Error('database query failed'), { cause: driverError })
  assert.equal(isDuplicateKeyError(queryError), true)
  assert.equal(isDuplicateKeyError(new Error('connection unavailable')), false)
})

test('product reviews require a valid star rating and useful review text', () => {
  assert.equal(productReviewSchema.safeParse({ rating: 5, body: 'The fit and fabric are excellent.' }).success, true)
  assert.equal(productReviewSchema.safeParse({ rating: 6, body: 'The fit and fabric are excellent.' }).success, false)
  assert.equal(productReviewSchema.safeParse({ rating: 4, body: 'Too short' }).success, false)
})

test('product quantity cap applies across multiple selected sizes', () => {
  assert.equal(exceedsProductQuantityLimit([{ productId: 4, quantity: 2 }, { productId: 4, quantity: 3 }]), false)
  assert.equal(exceedsProductQuantityLimit([{ productId: 4, quantity: 3 }, { productId: 4, quantity: 3 }]), true)
  assert.equal(exceedsProductQuantityLimit([{ productId: 4, quantity: 4 }, { productId: 5, quantity: 4 }]), false)
})

test('temporary order numbers fit the database column', () => {
  const orderNumber = createTemporaryOrderNumber()
  assert.equal(orderNumber.length, 32)
  assert.match(orderNumber, /^pending-[a-f0-9]{24}$/)
})

test('M-Pesa Till settings accept valid digits and reject malformed numbers', () => {
  assert.equal(settingsSchema.safeParse({ mpesaTillName: 'KitCulture', mpesaTillNumber: '1234567' }).success, true)
  assert.equal(settingsSchema.safeParse({ mpesaTillNumber: '12-34567' }).success, false)
  assert.equal(settingsSchema.safeParse({ mpesaMobileNumber: '0712345678' }).success, true)
  assert.equal(settingsSchema.safeParse({ mpesaMobileNumber: '+254712345678' }).success, true)
  assert.equal(settingsSchema.safeParse({ mpesaMobileNumber: '07123' }).success, false)
})

test('M-Pesa verification normalizes Kenyan phones and Nairobi transaction times', () => {
  assert.equal(normalizeKenyanPhone('0712 345 678'), '254712345678')
  assert.equal(normalizeKenyanPhone('+254 712 345 678'), '254712345678')
  assert.equal(normalizeKenyanPhone('0612 345 678'), null)
  assert.equal(parseDarajaTimestamp('20261231235959')?.toISOString(), '2026-12-31T20:59:59.000Z')
  assert.equal(parseDarajaTimestamp('20260229010101'), null)
  assert.equal(parseDarajaTimestamp('bad-time'), null)
})

test('Daraja callback URL matches the mounted application route', () => {
  const token = 'a'.repeat(40)
  const expectedPath = `/api/v1${darajaCallbackRoute.replace(':token', token)}`
  const expected = `https://payments.example.org${expectedPath}`
  assert.equal(darajaCallbackRoute, '/orders/mpesa/callback/:token')
  assert.equal(buildDarajaCallbackUrl('https://payments.example.org', token), expected)
  assert.equal(buildDarajaCallbackUrl(expected, token), expected)
  assert.throws(() => buildDarajaCallbackUrl('https://payments.example.org/callback', token))
  assert.throws(() => buildDarajaCallbackUrl('http://payments.example.org', token))
})

test('Daraja callback tokens require an exact constant-time match', () => {
  const expectedToken = 'a'.repeat(40)
  assert.equal(matchesCallbackToken(expectedToken, expectedToken), true)
  assert.equal(matchesCallbackToken('b'.repeat(40), expectedToken), false)
  assert.equal(matchesCallbackToken('a'.repeat(39), expectedToken), false)
  assert.equal(matchesCallbackToken(expectedToken, undefined), false)
})

test('Daraja callback processing treats completed payment states as final', () => {
  assert.equal(isFinalDarajaPaymentStatus('succeeded'), true)
  assert.equal(isFinalDarajaPaymentStatus('failed'), true)
  assert.equal(isFinalDarajaPaymentStatus('pending'), false)
  assert.equal(isFinalDarajaPaymentStatus('initiated'), false)
})

test('Daraja payment amount validation requires matching KES amounts', () => {
  assert.equal(isValidDarajaPaymentAmount('KES', 1250, '1250.00', '1250.00'), true)
  assert.equal(isValidDarajaPaymentAmount('USD', 1250, '1250.00', '1250.00'), false)
  assert.equal(isValidDarajaPaymentAmount('KES', 1249, '1250.00', '1250.00'), false)
  assert.equal(isValidDarajaPaymentAmount('KES', 1250, '1249.00', '1250.00'), false)
})

test('order status transitions allow Pay on Delivery and reject invalid jumps', () => {
  assert.equal(canTransitionOrderStatus('pending_payment', 'processing', 'pay_on_delivery'), true)
  assert.equal(canTransitionOrderStatus('pending_payment', 'processing', 'mpesa'), false)
  assert.equal(canTransitionOrderStatus('paid', 'processing', 'mpesa'), true)
  assert.equal(canTransitionOrderStatus('processing', 'dispatched', 'pay_on_delivery'), true)
  assert.equal(canTransitionOrderStatus('pending_payment', 'delivered', 'pay_on_delivery'), false)
  assert.equal(canTransitionOrderStatus('delivered', 'cancelled', 'pay_on_delivery'), false)
})