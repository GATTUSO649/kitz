# Daraja Security and Reconciliation

## Current protections

Kitz and MarketHub keep separate Daraja credentials, payment rows, callbacks, and verification code. Existing callback handling checks configured secret path/token, provider IDs, transaction result, amount, payer phone using normalized matching, receipt, transaction time, and state transitions. MarketHub stores callback fingerprints/outcomes and offers a permission-protected manual reconciliation path using supported STK query APIs. Kitz records provider results and `requires_review` states but does not have a dedicated callback-event table.

## Phase 5 status

- STK attempts and provider outcomes are recorded by each application's own payment service.
- MarketHub callback, verification, and reconciliation timestamps/attempts are exposed through a separate authenticated server feed; payer phone is masked.
- Operations payment inspection is read-only and records an audit event. It cannot change payment state or declare a payment successful.
- Provider health is unknown unless an authorized live integration reports otherwise. No live payment or provider request was made for this work.
- Scheduled cross-application reconciliation and Kitz callback lifecycle persistence are not implemented.

## Safe operation

Never retry a payment charge as a reconciliation action. Never turn ambiguous into successful without authoritative provider query and matching persisted transaction evidence. Preserve duplicate callback fingerprints and use existing transactional state transitions. Keep credentials in the respective server environment; do not share raw callback payloads or secrets with Operations.