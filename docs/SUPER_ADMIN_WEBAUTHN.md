# Super-Admin WebAuthn Verification

## Scope

The IT Portal now supports server-verified WebAuthn platform authenticators for Super-Admin sessions. The browser requests a platform authenticator with user verification required. The server verifies each registration or authentication response against a one-time challenge, the configured site origin, the relying-party ID, credential ownership, and the stored public key/sign counter.

This is not fingerprint-only authentication. WebAuthn user verification can be satisfied by a device PIN, fingerprint, or face, and browsers do not reliably disclose which modality was used. The UI therefore reports platform-authenticator verification and explicitly does not claim that a fingerprint was used. Do not market or configure this as fingerprint-only without a trusted, separately deployed local integration that can prove the modality.

No fingerprint images, templates, or other raw biometric data are collected or stored. The administrator database stores credential IDs, public keys, authenticator metadata, one-time challenges, session verification timestamps, and security events.

## Routes

All routes require an active Super-Admin session. Mutations also require an allowed browser origin.

- `POST /api/v1/super-admin/biometrics/register/options`
- `POST /api/v1/super-admin/biometrics/register/verify`
- `POST /api/v1/super-admin/biometrics/authenticate/options`
- `POST /api/v1/super-admin/biometrics/authenticate/verify`
- `GET /api/v1/super-admin/biometrics/status`
- `GET /api/v1/super-admin/biometrics/devices`
- `POST /api/v1/super-admin/biometrics/revoke`

Challenges expire after two minutes and are bound to the current administrator session and ceremony purpose. Successful verification is fresh for five minutes. Five failed authentication attempts in the rolling 15-minute window lock verification until the oldest counted failure expires. Revocation requires the administrator password and clears WebAuthn freshness for every session belonging to that Super-Admin.

## Deployment

1. Set `CLIENT_ORIGIN` to the exact HTTPS origin hosting the IT Portal. Its hostname is used as the WebAuthn RP ID; localhost is allowed for development.
2. Review the additive migration at `server/src/database/admin-postgres-migrations/0004_lying_madame_hydra.sql` and the generated schema snapshot.
3. Apply the migration to the separate administrator PostgreSQL database only through the approved administrator migration process, after the required backup and staging checks. It is not applied automatically at API startup.
4. Deploy the server and client together, then sign in as Super Admin. The initial authenticator must be enrolled within five minutes of a password sign-in; subsequent sessions must verify an enrolled authenticator before Super-Admin data and write controls are enabled.
5. Keep a working password recovery path. If every authenticator is revoked or lost, sign out, sign in with the administrator password, and enroll a replacement within the fresh-login window. Revoking a device requires password confirmation and invalidates verification on all current sessions.

The WebAuthn page is served by the IT Portal and does not redirect to a platform-branded sign-in page. Other administrator roles and MarketHub authentication flows are not enrolled or changed by this feature.
