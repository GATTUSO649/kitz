# Security Rollback Guide

## Application controls

- WAF false positives: set `WAF_MODE=detect` or `disabled` through an approved server configuration change. Do not remove event evidence; review rule IDs and timestamps.
- MarketHub feed outage: remove/disable `MARKETHUB_SECURITY_FEED_URL` or rotate the shared service token through both server secret stores. The Kitz Operations MarketHub view must fail closed with unavailable state; do not query MarketHub from a browser or use direct DB credentials in Kitz.
- Operations sign-in: roll back the application release or disable the affected administrator account, then invalidate its source-bound sessions. Preserve identity projections and audit records.
- Secret scanner/SBOM: these are read-only; disabling their UI does not remove scan/audit history.

## Database recovery

Do not run destructive down migrations to remove bridge identity links or payment evidence. Restore only for a separately approved disaster-recovery event after an isolated restore rehearsal. For migration failure, stop the release, retain additive schema, collect sanitized SQLSTATE/catalog evidence, and prepare a reviewed forward repair. Never edit migration ledgers or delete rows to make the application appear healthy.

## Payment recovery

Do not automatically retry uncertain STK requests or set payment status manually. Use the existing application-specific Daraja query/callback verification workflow; preserve callback fingerprints, audit metadata, and ambiguous states until authoritative evidence is available.

## Evidence retention

Preserve Operations audit records and app-specific payment/audit records. Do not place service tokens, Redis URLs, payer phone numbers, or raw session tokens in incident tickets.