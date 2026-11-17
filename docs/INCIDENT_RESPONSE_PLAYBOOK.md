# Incident Response Playbook

## Current workflow

The Operations incident API persists manual incidents, assignments, timeline notes, status changes, root-cause and resolution fields, with actor attribution and audit events. The monitoring worker creates deduplicated alerts for configured detection rules, including repeated WAF detections when the monitoring schema is available. Operators can review security-category telemetry and update incidents through role-protected routes.

## Triage

1. Confirm event source, timestamp, severity, application, request/correlation reference, and telemetry freshness. Treat 401/403/429 counts as signals, not proof of compromise.
2. Review only masked WAF rule IDs, route group, provider outcome codes, and safe event metadata. Never request cookies, passwords, raw callback payloads, or payment secrets.
3. For payment ambiguity, use the application's existing provider verification and reconciliation path. Do not mark a payment successful based on a client return or screenshot.
4. Open an incident manually, assign an owner, record factual evidence references, and track investigation/containment/resolution in the timeline.
5. Revoke a confirmed compromised grant/session through the existing central IT workflow. Avoid permanent admin disablement based on one signal.
6. Escalate production changes, IP blocking, external provider action, or database recovery through the approved owner/change process.

## Lifecycle and limitations

Existing incident status values include open, investigating, resolved, and closed. The Phase 5 requested detected/contained lifecycle, automatic event-to-incident conversion, notifications, evidence vaulting, closure reasons, and immutable evidence controls are not complete. Security alerts are not currently dispatched through email. Verify database persistence before relying on the incident register during a schema outage.