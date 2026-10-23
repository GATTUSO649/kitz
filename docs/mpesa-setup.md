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

Use `sandbox` only for development/testing. A production server requires `DARAJA_ENV=production` (or `MPESA_ENV=production`) and live credentials. Checkout enables STK Push only when the matching approved merchant details and all required server settings are valid.

## Production on Render

Set live payment values in Render's server environment, never in Vite variables, source files, or the local `.env`:

```env
NODE_ENV=production
MPESA_ENV=production
MPESA_CONSUMER_KEY=<live consumer key>
MPESA_CONSUMER_SECRET=<live consumer secret>
MPESA_SHORTCODE=<Safaricom-approved production shortcode>
MPESA_PASSKEY=<live Lipa na M-Pesa Online passkey>
MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
APP_URL=https://your-production-domain
MPESA_CALLBACK_TOKEN=<random secret of at least 32 characters>
MPESA_ACCOUNT_REFERENCE=KitZone
MPESA_TRANSACTION_DESC=Jersey Purchase
CLIENT_ORIGIN=https://your-production-domain
```

`DARAJA_*` names are also supported. `MPESA_CALLBACK_URL` may be supplied instead of `APP_URL`; the application uses its HTTPS origin and builds the callback path. Register the exact generated callback URL with the matching live Daraja app. The account reference is limited to 12 characters and the transaction description is truncated to Daraja's 13-character limit. Do not enable live mode until Safaricom has issued the live credentials and confirmed the shortcode, passkey, product activation, and transaction type.

For `CustomerBuyGoodsOnline`, set the approved shortcode in `MPESA_SHORTCODE` and the authorized receiving Till in Admin → Business settings. For `CustomerPayBillOnline`, set the approved PayBill shortcode in `MPESA_SHORTCODE`; the STK request uses that shortcode as `PartyB` and does not require a Till setting. The transaction type must match the Safaricom-approved account and product.

A personal mobile number is not interchangeable with an STK business shortcode or Till. This integration cannot direct STK settlement to a plain personal MSISDN. Ask Safaricom to provision and authorize the appropriate PayBill, Till, or Lipa na M-Pesa Online merchant details and settlement destination; do not put a personal phone number in `MPESA_SHORTCODE` or use an unapproved transaction type. The repository cannot verify credentials or merchant approval, so code and mocked tests alone do not establish live readiness.

## Customer and Verification Rules

- The STK prompt is sent to the Kenyan payer phone entered at checkout; it may differ from the delivery recipient phone.
- Orders are still created by an authenticated customer and retain their delivery recipient/address snapshot.
- The callback must match the order total, payment attempt, payer phone, and a recent transaction timestamp. The API queries Daraja and checks the query result before marking payment successful.
- Duplicate callbacks are idempotent. A receipt cannot be reused because the provider receipt is unique.
- Admin → Payments displays order, status, amount, receipt, transaction time, payer phone, provider result code, and sanitized diagnostics.
- Daraja does not provide a cryptographic callback signature here. The callback uses an unguessable HTTPS path token and the backend verifies the STK query plus transaction identifiers, amount, payer phone, and time. Browser responses and user-entered receipts never mark an order paid.
- A definite provider rejection is retryable. If the network times out or Safaricom returns HTTP 5xx after STK submission, the payment becomes `requires_review`; do not retry until its status is reconciled, because Safaricom may have received the first request.

## Before Production

The public callback route is `POST /api/v1/orders/mpesa/callback/:token` and does not require a customer session. Before enabling live checkout, verify a controlled production transaction and its callback/query reconciliation using Safaricom-approved merchant procedures. Sandbox tests and mocked tests can verify code paths, but do not prove production credentials or merchant configuration work. Never mark an order paid based on a browser response or customer-entered receipt code.
