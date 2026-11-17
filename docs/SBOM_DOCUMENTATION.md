# SBOM Documentation

The Operations API provides an authenticated, read-only CycloneDX 1.5 JSON download at `GET /api/v1/operations/security/sbom`. It reads npm `package-lock.json` files discovered for Kitz and MarketHub, includes root/application and package components, versions, package URLs, available license metadata, project path, and locked dependency relationships. It does not install packages, call a third-party service, persist the full BOM, or expose database credentials.

Each download requires the normal Operations route permission and a persisted audit write. The audit records actor/source session where applicable, BOM format/version, and component count, not the BOM contents. If Operations audit storage is unavailable, the endpoint fails closed.

The generated BOM is a point-in-time lockfile inventory. It is not signed, attested, archived, or proof of a running deployment image. OS packages, container layers, runtime-loaded plugins, and deployment artifacts are not included. The local test verifies both lockfiles and that dependency references resolve.