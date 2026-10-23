# M-Pesa Daraja Setup

The checkout uses a server-side Daraja STK Push. Orders stay `pending_payment` until the API receives a callback, queries Daraja for the same checkout request, and verifies the receipt, amount, transaction time, payer phone, and order association. The payer phone can differ from the delivery recipient phone.

## Configure the Till

In Admin → Business settings, enter the Buy Goods Till display name and Till number. The number is exposed to checkout as merchant information; it is not a credential.

## Configure Daraja

Add the following values to the API server environment or deployment secret manager. Do not use `VITE_` prefixes or put secrets in frontend settings.

```env
DARAJA_ENV=sandbox
DARAJA_CONSUMER_KEY=
DARAJA_CONSUMER_SECRET=
DARAJA_PASSKEY=
DARAJA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
DARAJA_SHORTCODE=
DARAJA_CALLBACK_BASE_URL=https://your-public-api.example.com
DARAJA_CALLBACK_TOKEN=use-a-random-secret-at-least-32-characters-long
```

Use `CustomerBuyGoodsOnline` only for a Buy Goods Till and `CustomerPayBillOnline` only for a PayBill shortcode. Production requires an explicit `DARAJA_ENV` and `DARAJA_TRANSACTION_TYPE`; only development/test defaults to sandbox and Buy Goods.

The HTTPS callback URL registered with Daraja is `${DARAJA_CALLBACK_BASE_URL}/api/v1/orders/mpesa/callback/${DARAJA_CALLBACK_TOKEN}`. The public host must route that path to this API. Localhost is not reachable by Safaricom; use a secure public development tunnel for sandbox callback testing.

Select `sandbox` until the sandbox flow is tested. Use `production` only with production Daraja credentials and an approved business shortcode/Till. Restart the API after changing environment values. Checkout enables M-Pesa only when the Till and all required server settings are valid.

## Customer and Verification Rules

- The STK prompt is sent to the Kenyan payer phone entered at checkout; it may differ from the delivery recipient phone.
- Orders are still created by an authenticated customer and retain their delivery recipient/address snapshot.
- The callback must match the order total, payment attempt, payer phone, and a recent transaction timestamp. The API queries Daraja and checks the query result before marking payment successful.
- Duplicate callbacks are idempotent. A receipt cannot be reused because the provider receipt is unique.
- Admin → Payments displays order, status, amount, receipt, transaction time, payer phone, provider result code, and sanitized diagnostics.
- Daraja does not provide a cryptographic callback signature here. The callback uses an unguessable HTTPS path token and the backend verifies the STK query plus transaction identifiers, amount, payer phone, and time. Browser responses and user-entered receipts never mark an order paid.
- A definite provider rejection is retryable. If the network times out after STK submission, the payment becomes `requires_review`; do not retry until its status is reconciled, because Safaricom may have received the first request.

## Before Production

Run mocked tests, then a sandbox order from checkout through callback and confirm its status and receipt in Admin → Payments. The public callback route is `POST /api/v1/orders/mpesa/callback/:token` and does not require a customer session. Then configure production credentials, callback host, explicit transaction type, and approved Till, and verify against real Daraja responses before accepting live orders. Mocked tests and a successful build do not prove production payments work. Never mark an order paid based on a browser response or customer-entered receipt code.