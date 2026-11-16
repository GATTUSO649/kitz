# Security Testing

## Verification run

The following checks passed in the current workspace after the security changes:

| Application | Command | Result |
|---|---|---|
| Kitz | `npm run test` | 149 passed, 0 failed, 1 Redis integration skipped |
| Kitz | `npm run typecheck` | Passed |
| Kitz | `npm run build:deploy` | Passed |
| MarketHub | `npm --prefix platform test` | 93 passed, 0 failed, 1 Redis integration skipped |
| MarketHub | `npm --prefix platform run typecheck` | Passed |
| MarketHub | `npm --prefix platform run build:deploy` | Passed |
| Kitz | `npm run test` with process-only CA override | 146 passed, 0 failed, 1 Redis integration skipped |
| MarketHub | `npm --prefix platform test` | 90 passed, 0 failed, 1 Redis integration skipped |

MarketHub build emitted a non-blocking chunk-size warning for a bundle over 500 kB. Both Vite builds emitted a non-blocking message that `NODE_ENV` is not supported in the `.env` file; neither prevented production output.

## Security-specific regression coverage

- MarketHub payment initiation endpoint limit returns 429 after the configured budget; production storage is Redis-backed when configured.
- MarketHub payment reservation is made under a listing-row transaction lock and checks unresolved payment states before inserting a reservation.
- Existing unresolved MarketHub payment state is not expired by a ten-minute time window; uncertain transactions do not automatically trigger another STK request.
- Existing Daraja callback and transaction-query validation tests remain in the MarketHub suite.
- Public MarketHub worker/readiness routes return generic bodies; the detailed worker snapshot route is registered behind central administrator permission middleware. With no test database configured, the route test only confirms no diagnostics are returned; it does not exercise the database-backed authorization decision.
- Kitz public readiness returns only generic ready/not-ready state; existing payment status, callback, and Kitz order-lock tests remain in its suite.
- MarketHub database-preflight sequence logic rejects missing sequence `USAGE` and runtime-owned Marketplace sequences.
- Both apps test hashed account/IP keys and HTTP 503 on a simulated shared-store command failure.
- Both apps test that varying an untrusted `X-Forwarded-For` header does not change the rate-limit bucket when Express does not trust that proxy.
- Two independent HTTP instances using separate Redis clients and an identical policy prefix are covered by opt-in tests using `REDIS_TEST_URL`; skipped because no Redis service is available.

## Required but not verified

No isolated production-equivalent PostgreSQL URL was available. Therefore the following have not been verified:

- Simultaneous HTTP payment initiations competing on actual PostgreSQL row locks.
- Concurrent callback delivery and settlement against a database.
- Database privilege escalation attempts, sequence grants, schema/table ownership, or RLS bypass under configured production-equivalent roles.
- Authenticated successful access to detailed MarketHub diagnostics using the live Kitz identity/authorization service.
- Session revocation across actual deployed Kitz/MarketHub instances.
- Distributed rate limiting across multiple instances (Redis integration test skipped; production Redis endpoint is not configured).
- MFA enrollment, verification, recovery, step-up, and bypass tests (MFA is not implemented).

Never run destructive security tests against production. To close the payment race test gap, provision a disposable PostgreSQL database with the reviewed Marketplace schema and Daraja calls replaced by an injected test provider. Run competing requests from separate database connections and assert exactly one `initiated` reservation/provider invocation. The test must not use production credentials or call live Daraja.

## Release gate

Passing unit tests, typechecks, and builds is not a production security certification. Before production rollout, configure and verify the shared Redis service, run the multi-instance rate-limit integration test, run the approved read-only database preflight, validate actual runtime/admin/migration role grants, and execute isolated payment concurrency tests. Kitz tests used a process-only override for the missing `.env` CA file; no environment file or migration was changed.
