# Security Engine Reference

**Current source status: 2026-11-16.** Use this reference to distinguish functional engines from planned integrations.

| Engine | Runtime surface | Configuration | Persistence | State |
| --- | --- | --- | --- | --- |
| Operations sign-in | `/api/v1/admin/operations-login`, `/api/v1/operations/me` | Active, verified `it_admin` or `super_admin` account | Admin/Operations tables and audits | Source implemented; target DB baseline unknown |
| Application WAF | Express API middleware; `/api/v1/operations/security/waf` | `WAF_MODE=detect` default | Security-category monitoring event queue | Code implemented; storage depends on Operations schema |
| IDS | Monitoring event queue and detection worker; `/api/v1/operations/events`, `/alerts` | Existing rule rows and worker settings | `monitoring_events`, detection history, alerts | Partial; DB-backed worker requires schema |
| Dependency scanner | `/api/v1/operations/security/scans` | npm executable/runtime; scheduled scan row | `security_scans`, modules, findings | npm audit implemented; OSV not configured |
| Secret scanner | Scan scope `secrets` | Local filesystem only | Existing scan persistence | Local-only code; secret values masked |
| SBOM | `/api/v1/operations/security/sbom` | Checked-in npm lockfiles | Generated per request; audit metadata persisted | CycloneDX 1.5 implemented |
| Payments | `/api/v1/operations/payments` | Kitz DB; MarketHub feed URL and shared service token | Each application keeps its own records/audit | Read-only code; MarketHub connection unverified |
| Shared request limiting | Global/auth/admin/payment limits | `REDIS_URL` required in production | Redis counters | Code enforced; multi-instance test skipped without Redis |

External WAF, IP/CIDR policy management, automated IPS, bot challenge, OSV, secret-manager scanning, security notifications, scheduled payment reconciliation, and provider health APIs are not implemented or configured. Never infer operational status from a route or page alone.