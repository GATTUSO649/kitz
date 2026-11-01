# Origin Security

## Verified status

The repository configures a public Render web service and currently trusts three proxy hops in Express. Render documents that public web services are reachable from the internet at both their `onrender.com` hostname and configured custom domains. The repository does not identify the production hostname, Cloudflare zone, DNS records, or account plan. Cloudflare credentials and account-inspection tools are not available in this workspace, so DNS proxy coverage, historical DNS, WAF, bot controls, TLS mode, and direct-origin reachability remain **UNKNOWN**. No production DNS, Render, or Cloudflare setting was changed.

Render documents its private-service option as unreachable from the public internet and reachable by other Render services on the same private network. Using it for a public storefront would require an additional supported ingress/tunnel design; do not convert the current service without testing that architecture and the M-PESA callback path.

## Optional origin authentication

The Express origin gate is disabled when `ORIGIN_AUTH_TOKEN` is unset. When enabled, every request must carry the configured token in `x-kitculture-origin-auth`, compared in constant time. Only `GET` and `HEAD` requests to `/health/live` and `/health/ready` are exempt for platform health checks. The token header is redacted from application logs. This is an application-level backstop, not a network firewall; it does not hide the Render hostname or prevent traffic from reaching Render's load balancer.

Cloudflare documents Request Header Transform Rules that can set a static header and overwrite a visitor-supplied value. Account-plan availability is not verified; confirm that **Request Header Transform Rule** is available in the zone dashboard before enabling the origin gate.

### Staged activation

1. Generate a unique random token with at least 32 characters. Never put it in source control or send it in chat.
2. In the Cloudflare zone, create a Request Header Transform Rule scoped to the exact proxied production hostname(s). Set `x-kitculture-origin-auth` to the token. Use **Set static** so the rule overwrites any visitor-supplied header. Do not challenge the M-PESA callback separately; it must pass through this same rule.
3. Confirm the rule is deployed and test the storefront, customer login, admin login, product APIs, checkout, and a controlled M-PESA callback in staging.
4. Add the same token as the Render secret `ORIGIN_AUTH_TOKEN` and deploy. Do not activate the Render secret before the Cloudflare rule is live, or all non-health requests will receive 403 responses.
5. Verify the Cloudflare hostname and Render `onrender.com` hostname separately. The Cloudflare hostname should work; the direct Render hostname should return 403 for application routes and 200 for the health-check routes.

### Rollback

If the Cloudflare hostname returns 403, first remove or correct the Render `ORIGIN_AUTH_TOKEN` secret and redeploy. This disables the application gate. Then correct the Cloudflare transform rule and repeat staging checks before re-enabling the secret. Removing the transform rule alone while the Render secret remains set will block legitimate traffic.

## Required external checks

- Record the exact production and staging hostnames and Cloudflare zone.
- Inspect A, AAAA, CNAME, MX, and all subdomain records in the authorized Cloudflare account. Keep mail-related records DNS-only unless their service explicitly supports proxying.
- Confirm the Render public hostname and any custom domains; test origin access only after ownership and staging authorization are confirmed.
- Verify Cloudflare proxy status, WAF/bot/rate-limit feature availability, SSL/TLS mode, edge certificate, and origin certificate. Do not select Full (strict) until the origin certificate is valid for the hostname.
- Verify whether Cloudflare transforms are available on the current plan; do not assume plan features from public documentation.
- Review email headers and historical DNS only with authorized artifacts/services; no such evidence was available during this repository audit.
- Preserve the existing callback path token, provider verification, and idempotency behavior. Cloudflare origin authentication must not replace callback authentication.