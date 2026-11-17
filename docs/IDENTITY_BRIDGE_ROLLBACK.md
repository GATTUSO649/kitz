# Identity Bridge Rollback and Recovery

This procedure is designed to preserve central administrator records, legacy Operations accounts, identity links, and audit evidence. No automatic migration rollback is authorized.

## Trigger and containment

- Stop bridge exchange first by deploying the approved compatible application configuration/code with exchange disabled, or remove the bridge route through an emergency-reviewed release. Do not disable existing administrator authentication.
- Revoke the named central IT grant through the central IT super-admin workflow. The next bridged request fails current-grant validation.
- Invalidate affected bridged Operations sessions by deleting only sessions whose `admin_session_id` maps to the affected source sessions, or revoke the source admin sessions through the existing administrator session control. Preserve Operations projections and audit rows.
- Verify the bridged cookie no longer authenticates; do not log or request its value.

## Application rollback

Prefer rollback to an application version compatible with the additive schema. Extra nullable columns, FKs, and indexes can remain in place. Keep bridge grants revoked and exchange disabled until a compatible forward release is deployed. Confirm legacy central-admin login, unlinked Operations login, Operations authorization, and Kitz/MarketHub isolation after the application rollback.

Do not roll back to code that interprets browser-provided roles or performs unsafe account linking. Do not re-enable independent authentication for linked identities.

## Migration limitations and forward recovery

- 0013 replaces role constraints. Restoring the prior check is only possible if no records use the Chief Security Operator role and the exact prior constraint definition is known.
- 0014 makes password hashes nullable and adds identity links/session relationships. A down migration that deletes linked projections or sessions violates the identity-preservation rule. Re-adding `password_hash NOT NULL` is not safe while passwordless projections remain.
- Routine recovery is forward-only: leave additive schema and identity links intact, keep role grants revoked and bridge exchange disabled, repair application/database causes with a reviewed forward migration, and preserve audit records.
- Never delete central administrator records, identity projections, audit records, or migration history to make rollback appear successful.

## Database restore

Use a database restore only for a separately assessed data-corruption/disaster event, not to reverse bridge activation. Restore from a verified backup into an isolated recovery target first; validate the migration ledger, identities, Operations legacy records, and audit history. Obtain database-owner approval before any production cutover. Preserve audit records from the failed interval and reconcile them after recovery.

## Access recovery

If all IT super-admin access is lost, use the existing audited central IT super-admin recovery/bootstrap procedure with owner approval, identity verification, and change record. Do not grant a CSO or Operations super-admin automatically, and do not bypass the administrator authentication system. Record the actor, approval, target, time, and recovery action in the authorized central audit workflow.