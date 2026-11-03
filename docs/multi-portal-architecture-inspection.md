# KitCulture multi-portal architecture inspection

Date: 2026-11-03
Status: Phase 1 inspection complete. Documentation only; no application, database, credential, or production configuration changes were made.

## Executive summary

KitCulture currently has one customer/customer-account Vite application that also owns the existing administration experiences. The Express API is centralized and already serves customer, administrator, and IT operations modules through the same PostgreSQL database. Administrator identities, sessions, role numbers, invitations, permissions tables, role portal definitions, and several onboarding/bootstrap flows are already present.

The repository is therefore partway through the requested architecture. The next implementation should preserve existing contracts, extract independent frontends around the existing capabilities, and harden the backend before moving additional business workflows.

## Existing application topology

### Customer and shared frontend

- Entry point: `src/main.tsx`
- Application and route dispatch: `src/App.tsx`
- Build configuration: `vite.config.ts`
- Development API proxy: `/api` and `/health` to `http://localhost:4000`
- Administrator routes are lazy-loaded from the same bundle by `src/App.tsx`.

This means customer, account, Sales/legacy business administration, Super Administrator, and IT administration currently share one frontend build. It is not yet the required independent-application topology.

### Existing IT Administrator frontend

The repository identifies the existing IT experience as the Operations portal rather than a separately runnable frontend:

- Route modules: `src/pages/OperationsPages.tsx`
- Styling: `src/operations-theme.css`
- Legacy routes: `/operations`
- New compatibility route: paths beginning `/it-admin`
- API prefix: `/api/v1/operations`
- Session/API identity: operations API authentication and operations users/operators

The operations frontend owns IT dashboards, traffic, observability, security, vulnerability management, database health, incidents, support, backups, deployments, reports, audit, settings, and IT operator permissions. It is already substantial and must be preserved during extraction.

Backend ownership is primarily `server/src/modules/operations/routes.ts`, with supporting operations schemas, incident/audit entities, telemetry, security, monitoring, and IT access modules.

The existing IT implementation uses its own operations identity/session mechanisms in addition to links from `admin_users` through `operations_operators`. A compatibility migration must bridge, but not replace, that system until regression-tested.

### Existing Sales and Customer Management frontend

The Sales portal is currently the legacy business administration experience:

- Route modules: `src/pages/AdminPages.tsx`
- Styling: `src/admin-theme.css`
- Route: `/admin`
- Authentication routes: `/admin/login`, `/admin/register`, `/admin/onboarding`, and `/admin/verify`
- API prefix: `/api/v1/admin`
- Backend ownership: `server/src/modules/admin/auth.ts`, `server/src/modules/admin/routes.ts`, and related administration modules

The existing `/admin` frontend currently mixes Sales and Customer Management with IT navigation, products, homepage, inventory, delivery, payments, reports, expenses, settings, and audit modules. Server-side role restrictions exist for broad route families, but this frontend is not an independently separated Sales application.

Preserving backward compatibility should keep `/admin`, `/admin/login`, `/admin/*`, and `/api/v1/admin/*` working while a dedicated Sales frontend is extracted using the current route/API contracts as the compatibility boundary.

## Existing role portal implementation

`src/pages/RolePortalPages.tsx` provides generic dashboards for Sales, Finance, Inventory, Marketing, and Content. These are currently mounted inside the shared customer bundle at paths such as `/sales-admin/*` and `/finance-admin/*`.

Backend support exists in:

- `server/src/modules/admin/ecosystem.ts`
- `server/src/modules/admin/administration.ts`
- `server/src/modules/admin/role-number.ts`
- `server/src/modules/admin/auth.ts`

Assessment: these components are route shells, not independent applications. The generic Sales, Finance, Inventory, Marketing, and Content features also need domain-specific UX, real mutation APIs, complete states, and dedicated builds before they meet the acceptance criteria.

## Backend architecture

### Runtime

- Express application: `server/src/app.ts`
- Server entry point: `server/src/server.ts`
- Port in the current Vite proxy configuration: backend `4000`
- Centralized API mounts include customer auth/account, catalogue/orders, administrator auth, administrator ecosystem, operations, and business administration routes.

The requested backend arrangement is substantially compatible with the existing centralization. A repository move into a top-level `backend/` directory is not required and would create avoidable regressions. Backend modules can be expanded in place before creating compatibility wrapper folders or reviewing a migration.

### Database

- PostgreSQL is the active runtime database through `server/src/config/database.ts`.
- Store and administrator schemas share the active PostgreSQL pool.
- ORM: Drizzle ORM with `server/src/database/schema.ts` and `server/src/database/admin-schema.ts`.
- The repository includes legacy MySQL adapters, but active PostgreSQL configuration rejects a non-PostgreSQL `DATABASE_URL`.
- The migration guard in `package.json` prevents automatic Drizzle migrations.

The administrator schema already defines:

- Administrator roles and statuses
- Administrator users and sessions
- Verification tokens
- Audit logs
- Setup locks
- Permission and role-permission tables
- User permission overrides
- Invitations
- Login attempts
- IT operations users, sessions, and grants
- Operations incidents and audit entities

## Authentication, onboarding, and RBAC observations

- Administrator login uses opaque hashed `kc_admin_session` cookies and database session records.
- Login accepts email or role number and checks account status and role.
- Customer sessions use separate cookies and middleware. Customer and administrator authentication are already structurally isolated.
- Server middleware derives administrator identity, role, status, and session state from the database rather than frontend role values.
- Broad route-family role checks exist in `server/src/modules/admin/routes.ts`.
- Centralized role permission definitions exist, but route coverage must be expanded and verified against the operations and ecosystem routers.
- Super Administrator bootstrap and administrator invitations/onboarding contain substantial implementation.
- SMTP and email delivery code exists and must be configuration-validated rather than simulated.
- Legacy public Sales administrator registration also remains and could conflict with invitation-only onboarding unless explicitly disabled or constrained after existing account migration.

## Current route and port findings

- Current frontend development proxy is compatible with backend port `4000`.
- The requested suggested backend default is `5000`, but the code currently targets `4000`; the implementation must preserve `4000` unless configuration and deployment review authorize a change.
- Independent portal development ports should be added in later phases, starting with the customer `5173` rather than assuming `5173` is free, because the repository has existing frontend defaults that depend on Vite defaulting to `5173`.
- Proposed ports must be checked against live listeners and existing deployment configuration before scripts are created.

## Preservation conflicts

1. `OperationsPages.tsx` is being called by both `/operations` and `/it-admin`, but only the route is separate from legacy `/admin`; the frontend is not independently runnable.
2. Existing IT authentication includes a compatibility bridge and separate operations identity records. It must not be migrated directly to one administrator session without inventory and regression testing.
3. The legacy Sales `/admin` frontend combines multiple business areas. Those modules should be retained and reused in extracted applications, not deleted or duplicated.
4. Generic role portals currently exist in one shared bundle. They must not be mistaken for completed independent Finance, Inventory, Marketing, or Content applications.
5. Legacy public Sales registration uses `ADMIN_SIGNUP_SECRET`. After ecosystem onboarding is stable, it should be disabled or replaced only through a documented backward-compatible cutover. Existing Sales accounts must remain unaffected.
6. Some implementation-plan statements about missing schema fields are historical; current source already contains many of those fields. The implementation should reconcile the plan against source and migrations rather than reproduce migrations.

## Super Administrator authentication update

The Super Administrator frontend now has a dedicated `/super-admin/login` entry and uses `/api/v1/admin/super-admin/login`. The backend reuses the existing administrator identity and session records, but rejects credentials whose database role is not `super_admin`.

The legacy `/admin/login` endpoint and existing Sales authentication remain available for backward compatibility. This split is at the authentication entry point; independent frontend build extraction remains a separate later phase.

## Proposed implementation plan

### Phase 2: frontend extraction and shared contracts

1. Extract customer to its own stable application boundary without changing customer URLs.
2. Create independent portal workspace folders and minimal Vite entries only after names and ports are verified.
3. Keep existing IT and legacy Sales source as compatibility builds while extraction proceeds.
4. Add a root-level `applications:*` script set and common environment types only where duplication would otherwise occur.
5. Inventory all current business APIs used by `AdminPages.tsx` and `OperationsPages.tsx`.

### Phase 3/4: Super Administrator

- Finish and stabilize the existing Super Administrator backend and frontend.
- Keep `/super-admin` and `/admin/verify` compatibility paths.
- Extract the Super Administrator UI into its independent frontend.
- Add tests for bootstrap one-time behavior, invitations, role assignment, and audit history.

### Phase 5: authentication and RBAC hardening

- Make role and permission checks authoritative in backend middleware.
- Validate every administrator mutation route, session state, permission, role mismatch, status, and customer isolation.
- Keep legacy operations session compatibility under an explicit bridge.
- Do not trust or infer roles from frontend state or login portal names.

### Phase 6-9: domain portals

Create each portal independently, preserving existing APIs first:

- Finance: payments, reports, expenses, and real revenue aggregates.
- Inventory: current stock and movement APIs, plus fulfilment and supplier capabilities where data already exists.
- Marketing: notification campaigns and promotion data already represented in the backend.
- Content: current product, category, image/video, homepage, and catalogue APIs.
- Sales: extract the existing `/admin` modules that are already authorized for Sales and Customer Management.

Use additive API endpoints only when an existing operation cannot meet a portal contract safely.

### Phase 10: analytics, notifications, and audit

- Add authorized portal summaries with bounded date ranges.
- Render only server-computed real database aggregates.
- Preserve unavailable/empty/error states separately.
- Centralize audit emission and notification delivery.

### Phase 11/12: validation and deployment

- Run type checking, builds, linting, focused backend tests, and regression suites.
- Build and run each frontend independently.
- Test customer, IT, Sales, and administrator sessions separately.
- Add deployment descriptors only after owners approve hosts and CORS domains.
- Use the existing migration guard and review process for any additive Supabase migration.

## Acceptance gates before implementation begins

1. Git working tree remains clean, with user changes preserved if introduced during later work.
2. All existing Sales and IT frontend routes are captured as compatibility contracts.
3. Backend API permissions are mapped to the exact operations owned by each existing frontend.
4. Independent frontend entry/build conventions are agreed without moving existing files.
5. Development port availability is checked against running processes.
6. Production domains and DNS remain unchanged until explicit deployment authorization.
7. Existing database records are not reset, dropped, or automatically migrated.

## Files inspected

Primary frontend files:

- `src/App.tsx`
- `src/pages/AdminPages.tsx`
- `src/pages/OperationsPages.tsx`
- `src/pages/RolePortalPages.tsx`
- `src/pages/SuperAdminPages.tsx`
- `vite.config.ts`
- `package.json`

Primary backend files:

- `server/src/app.ts`
- `server/src/config/database.ts`
- `server/src/middleware/authenticate.ts`
- `server/src/modules/admin/auth.ts`
- `server/src/modules/admin/ecosystem.ts`
- `server/src/modules/admin/administration.ts`
- `server/src/modules/admin/routes.ts`
- `server/src/modules/operations/routes.ts`
- `server/src/database/admin-schema.ts`
