# Architecture

The workspace currently contains a Vite/React client at the repository root and an Express API under `server/src`. During development, Vite proxies `/api` and `/health` to the API. The API uses Zod-validated environment/query input, Pino logging, Helmet, exact-origin CORS, and rate limiting. Drizzle models the MySQL domain in `server/src/database/schema.ts`; migrations are generated and applied with Drizzle Kit.

The implemented request path is the public read-only catalogue: client query -> `GET /api/v1/products` -> published product/category/variant rows. Database absence is surfaced as `503`, not substituted with fixture data. No write, checkout, identity, or payment path exists yet.

Product prices and inventory are persisted in MySQL. Historical order snapshot tables are present in the schema, but order creation/stock reservation has not been implemented. The browser bag is local storage only and is not authoritative.