# Security Environment Variables

This inventory covers security-sensitive configuration referenced by the implementations inspected in this remediation pass. Values are never recorded here.

## Existing variables

| Variable | Application | Purpose / requirement |
|---|---|---|
| `DATABASE_URL` | Kitz | Store/runtime PostgreSQL connection. Production role grants and elevated attributes must be independently verified. |
| `ADMIN_DATABASE_URL` | Kitz | Administrator pool connection. Configure a distinct URL and dedicated least-privilege role to activate the separate pool. If omitted or equal to `DATABASE_URL`, the current backward-compatible shared pool is used. |
| `REDIS_URL` | Kitz + MarketHub | Shared Redis-compatible store for all named rate-limit policies. Required by production server processes. Uses `redis://` or `rediss://`; credentials must be stored in the deployment secret manager. Uses `redis@6.3.1` and `rate-limit-redis@6.0.2`. Startup fails before listening if the connection cannot be established within eight seconds. |
| `REDIS_TEST_URL` | Tests only | Optional isolated Redis database for two-instance rate-limit integration tests. Tests are skipped when unset. Never point it at production. |
| `SUPABASE_CA_CERT_FILE` / `SUPABASE_CA_CERT` | Kitz | Production PostgreSQL CA configuration used by Kitz TLS validation. |
| `WAF_MODE` | Kitz | `disabled`, `detect` (default), or `block`; block mode only rejects selected high-confidence API findings and must be staging-tested. |
| `OPERATIONS_IDENTITY_BRIDGE_ENABLED` | Kitz | Defaults to `false`; must remain false until approved staging verification and separate activation approval. |
| `MARKETHUB_SECURITY_FEED_URL` | Kitz | Optional exact same-origin HTTPS server endpoint `/api/v1/admin/marketplace/security-payments`; validated against `MARKETHUB_PUBLIC_URL`. |
| `MARKETHUB_SERVICE_TOKEN` | Kitz | Existing server-only token shared with MarketHub for service auth; never expose to Vite or logs. |
| `MARKETPLACE_DATABASE_URL` | MarketHub | Marketplace runtime PostgreSQL connection, restricted by startup configuration to the approved Supabase host/database/user/schema. |
| `MARKETPLACE_DATABASE_USER` | MarketHub | Expected runtime role name used by preflight validation. |
| `MARKETPLACE_DATABASE_NAME` | MarketHub | Must match the configured shared Supabase database (`postgres`). |
| `MARKETPLACE_DATABASE_HOST` | MarketHub | Must exactly match the runtime URL host. |
| `MARKETPLACE_DATABASE_SCHEMA` | MarketHub | Must be `marketplace`; this schema remains excluded from the Supabase Data API exposed schema list. |
| `MARKETPLACE_DATABASE_CA` | MarketHub | Required in production for certificate-verified TLS. |
| `KITCULTURE_MARKETPLACE_SERVICE_TOKEN` | MarketHub | Existing server-only shared token used for Kitz service authentication and the read-only Operations payment feed. |
| `MARKETHUB_PREFLIGHT_DATABASE_URL` | MarketHub release preflight | Separate read-only credential for preflight-only database inspection. |
| `MARKETPLACE_MIGRATION_DATABASE_URL` | MarketHub release execution | Separate migration credential; production use remains behind the approved migration manifest and protected deployment workflow. |
| `MARKETPLACE_MIGRATION_DATABASE_USER` | MarketHub release execution | Expected migration role identity. |

## Not configured in this workspace

- `REDIS_URL`: The application code now consumes it, but no production value or Redis service was available. All production rate-limit policies use Redis when configured; development/test processes without `REDIS_URL` intentionally use in-memory storage. Store failures fail closed with HTTP 503. Configure Redis before production deploy or horizontal scaling.
- MFA encryption key: No variable name or format has been selected because central Kitz MFA enrollment/storage is not implemented. Choose a managed secret/key-management approach before designing the migration; do not use a source-code key.
- `MARKETHUB_SECURITY_FEED_URL` and `MARKETHUB_SERVICE_TOKEN` are present only as example/configuration interfaces; actual deployment values and connectivity were not inspected or verified in this workspace.

No database migration was introduced in this remediation pass. Production role grants, migration-role separation for Kitz, deployed TLS, and Redis availability/recovery behavior remain to be verified with approved production-equivalent infrastructure.
