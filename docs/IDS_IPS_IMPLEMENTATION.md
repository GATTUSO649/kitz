# IDS and IPS Implementation

## IDS

The existing Operations pipeline receives HTTP status signals, database/provider measurements, runtime samples, and WAF inspection events. Monitoring events are queued and persisted into the existing PostgreSQL `monitoring_events` table when the Operations schema is available. The detection worker uses a PostgreSQL advisory lock, seeds rules, correlates event counts, and writes deduplicated alert rows. A repeated-WAF-detection rule groups by safe route group; alerts are not proof of compromise.

The Security Events page filters persisted security events by severity, event type, source service, and time. No raw request body, cookie, secret, payer phone, or raw client address is included in WAF event metadata.

## IPS

The only enforcement added is explicit `WAF_MODE=block` handling for high-confidence application request patterns. There is no IP block, account disable, session revocation, automated API throttle policy, or autonomous incident containment engine. No permanent admin lockout occurs from a single signal.

## Limitations

No DB-backed staging test was possible. Missing Operations tables cause telemetry writes to be dropped/backed off; do not call alert persistence operational until the migration baseline and worker heartbeat are verified. Security email/Slack escalation is not connected. Human investigation and resolution continue through existing incident APIs.