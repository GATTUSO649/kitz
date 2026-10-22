# M-Pesa Daraja Setup

The checkout uses a server-side Daraja STK Push. Orders stay `pending_payment` until the API receives a callback, queries Daraja for the same checkout request, and verifies the receipt, amount, transaction time, and payer phone against the order and the signed-in customer's account phone.

## Configure the Till

In Admin → Business settings, enter the Buy Goods Till display name and Till number. The number is exposed to checkout as merchant information; it is not a credential.

## Configure Daraja

Add the following values to the API server environment or deployment secret manager. Do not use `VITE_` prefixes or put secrets in frontend settings.

```env
DARAJA_ENV=sandbox
DARAJA_CONSUMER_KEY=
DARAJA_CONSUMER_SECRET=
DARAJA_PASSKEY=
DARAJA_CALLBACK_BASE_URL=https://your-public-api.example.com
DARAJA_CALLBACK_TOKEN=use-a-random-secret-at-least-32-characters-long
```

The HTTPS callback URL registered with Daraja is `${DARAJA_CALLBACK_BASE_URL}/api/v1/orders/mpesa/callback/${DARAJA_CALLBACK_TOKEN}`. The public host must route that path to this API. Localhost is not reachable by Safaricom; use a secure public development tunnel for sandbox callback testing.

Select `sandbox` until the sandbox flow is tested. Use `production` only with production Daraja credentials and an approved business shortcode/Till. Restart the API after changing environment values. Checkout enables M-Pesa only when the Till and all required server settings are valid.

## Customer and Verification Rules

- The STK prompt is sent to the phone saved on the signed-in KitCulture account.
- For M-Pesa orders, the delivery recipient name and phone must match that account.
- The callback must match the order total, saved account phone, payment attempt, and a recent transaction timestamp. The API then queries Daraja before marking the payment successful.
- Duplicate callbacks are idempotent. A receipt cannot be reused because the provider receipt is unique.
- Admin → Payments displays the receipt code, account phone/name snapshot, transaction time, and verification outcome.
- Daraja STK callbacks do not supply a verified account-holder name. The name displayed to admins is the KitCulture account name, not proof from Safaricom. The callback-verified phone is the ownership check.

## Before Production

Run a sandbox order from checkout through callback and confirm the payment status and receipt in Admin → Payments. Then configure production credentials, callback host and approved Till, and verify against real Daraja responses before accepting live orders. Never mark an order paid based on a browser response or customer-entered receipt code.