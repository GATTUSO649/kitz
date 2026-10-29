# M-Pesa Daraja Setup

The checkout uses a server-side Daraja STK Push. Orders stay `pending_payment` until the API receives a callback, queries Daraja for the same checkout request, and verifies the receipt, amount, transaction time, payer phone, and order association. The payer phone can differ from the delivery recipient phone.

## Configure the Till

In Admin → Business settings, enter the Buy Goods Till display name and Till number. The number is exposed to checkout as merchant information; it is not a credential.

## Configure Daraja

Add the following values to the API server environment or deployment secret manager. Do not use `VITE_` prefixes or put secrets in frontend settings.

```env
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_PASSKEY=
MPESA_TRANSACTION_TYPE=CustomerPayBillOnline
MPESA_SHORTCODE=
MPESA_CALLBACK_TOKEN=use-a-random-url-safe-secret-32-to-128-characters-long
MPESA_CALLBACK_URL=https://your-public-api.example.com/api/v1/orders/mpesa/callback/<same-token>
MPESA_ACCOUNT_REFERENCE=KitCulture
MPESA_TRANSACTION_DESC=Jersey Purchase
```

For the Sandbox test shortcode `174379`, use `CustomerPayBillOnline` with its matching Sandbox passkey. Use `CustomerBuyGoodsOnline` only for an approved Buy Goods Till. Production requires explicit `MPESA_ENV=production` and `MPESA_TRANSACTION_TYPE`; development/test defaults to Sandbox PayBill.

Register the exact HTTPS callback URL from `MPESA_CALLBACK_URL` with Daraja. The URL token must match `MPESA_CALLBACK_TOKEN`; the public host must route the path to this API. Alternatively, set `DARAJA_CALLBACK_BASE_URL` (or `APP_URL`) and the API constructs the route. Localhost is not reachable by Safaricom; use a secure public development tunnel for sandbox callback testing.

Use `sandbox` only for development/testing. A production server requires `MPESA_ENV=production` and live credentials (`DARAJA_*` aliases are accepted). The application fails at startup if production settings are missing or inconsistent; checkout requires matching approved merchant details and all required server settings.

## Production on Render

Set live payment values in Render's server environment, never in Vite variables, source files, or the local `.env`:

```env
NODE_ENV=production
MPESA_ENV=production
MPESA_CONSUMER_KEY=<Safaricom-issued production consumer key>
MPESA_CONSUMER_SECRET=<Safaricom-issued production consumer secret>
MPESA_SHORTCODE=<Safaricom-approved production shortcode>
MPESA_PASSKEY=<production Lipa na M-Pesa Online passkey>
MPESA_TRANSACTION_TYPE=<approved CustomerPayBillOnline or CustomerBuyGoodsOnline>
MPESA_CALLBACK_TOKEN=<random URL-safe secret, 32-128 characters>
MPESA_CALLBACK_URL=https://your-production-domain/api/v1/orders/mpesa/callback/<same-token>
MPESA_ACCOUNT_REFERENCE=KitCulture
MPESA_TRANSACTION_DESC=Jersey Purchase
MPESA_TRANSACTION_DESC=Jersey Purchase
CLIENT_ORIGIN=https://your-production-domain
```

`DARAJA_*` names are also supported. Production startup requires explicit production mode, credentials, shortcode, transaction type, callback token, and a public HTTPS callback URL. Register the exact callback URL with the matching live Daraja app. The account reference is limited to 12 characters and the transaction description is truncated to Daraja's 13-character limit. Do not enable live mode until Safaricom has issued the live credentials and confirmed the shortcode, passkey, product activation, and transaction type.

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
