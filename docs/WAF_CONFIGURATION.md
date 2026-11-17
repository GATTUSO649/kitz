# WAF Configuration

## Current application WAF

Kitz has a central Express API inspector at `server/src/security/waf.ts`. It inspects bounded parsed query/body values, API path encoding/traversal, method, and mutation content type. It does not retain request payloads, query values, authorization headers, cookies, or client IPs. Events contain rule IDs, method, route group, components, severity, and action.

`WAF_MODE` values:

- `disabled`: inspection is skipped.
- `detect` (default): findings emit security telemetry and requests continue.
- `block`: only high-confidence path traversal, malformed path encoding, active script markup, and disallowed HTTP methods are blocked. SQL/command-like patterns remain detection-only.

A block returns generic `403 REQUEST_REJECTED_BY_SECURITY_POLICY` with `Cache-Control: no-store`. JSON request bodies are separately capped at 100 KB by Express; requests over the parser limit return 413 before WAF inspection.

Malformed JSON is rejected by the parser boundary with a generic 400 and a payload-free `security.request.malformed` monitoring event. Parser errors do not include submitted bytes or values in logs or event metadata.

The Operations page is read-only. Rule definitions are code-based, not persisted/editable. No “test rule” or promote-to-block control exists. `externalEdgeProtection` is reported `unknown`; this Express control is not a network/CDN WAF or DDoS service.

## Verification

Focused tests cover detection, API-only scope, bounded depth, detect-only SQL/command signals, high-confidence blocking, and no-store response. Security event persistence depends on the existing Operations monitoring schema and queue. Database-backed event persistence has not been verified because no isolated staging DB was available.

Do not set `WAF_MODE=block` in production until staging false-positive analysis, route regression tests, an approved change window, and an external-edge plan are complete.