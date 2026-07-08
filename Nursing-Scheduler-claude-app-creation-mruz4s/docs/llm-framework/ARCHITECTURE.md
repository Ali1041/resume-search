# Nursing Scheduler — LLM Architecture Deep-Dive

**Last reviewed:** 2026-07-09

**Load this file when:** you are changing the entity hierarchy, coverage model, API route structure, deployment topology, or secrets management. For day-to-day rules, see `CLAUDE.md` / `AGENTS.md`.

---

## Entity hierarchy and roll-up behavior

### Model

- `Entity` has a self-referencing relation via `parentId` (`packages/db/prisma/schema.prisma`).
- `EntityType` is either `STANDALONE` or `PARENT` (`packages/db/prisma/schema.prisma`).
- `PARENT` entities are containers. They do not own `Area`, `Shift`, `RateCard`, or `BudgetTarget` directly. Their values are derived from child entities (`STANDALONE` or other `PARENT` sub-entities).
- `STANDALONE` entities are the schedulable units. They own areas, employees, shifts, staffing requirements, rate cards, and budget targets.

### Roll-up mechanics

- `GET /api/budget` checks `entity.type` and, if `PARENT`, loads `subEntities` where `parentId === entityId`.
- It then aggregates across sub-entities in SQL rather than computing per child in JavaScript.
- Period multipliers (`weekly`, `pay-period`, `monthly`, `quarterly`, `yearly`) are applied after aggregation.
- **Target implementation:** Raw SQL or Prisma `groupBy` + `_sum` over the requested entity range. Do not load all child shifts into memory. See `docs/SCALABILITY_CRITIQUE.md` finding CRIT-2 and the migration spec `BudgetService` example.

### Authorization across hierarchy

- `request.getAccessibleEntityIds()` returns `null` for admins and the user's assigned entity IDs for non-admins (`apps/api/src/plugins/auth.ts`).
- Non-admin users should only receive entities explicitly assigned to them. The parent/child relationship is not automatically expanded into the session; if a manager needs access to a parent, the parent must be in their assigned list.
- **Guardrail:** Do not add "implicit parent access" logic without a design review. Any expansion of accessible IDs must happen server-side and be cached, not computed from the client.

---

## Coverage model

### Core definition

- Coverage is calculated as the time overlap between a scheduled shift and a staffing requirement.
- The helper `coveredMinutes(shiftStart, shiftEnd, reqStart, reqEnd)` in `apps/api/src/lib/hours.ts` returns the overlap in minutes, handling overnight shifts by adding 24h when `endTime <= startTime`.
- `neededMinutes` for a slot is derived from the requirement's own span or `rawHours * 60`.
- `coveredHours` is the sum of overlap minutes across all shifts assigned to that area, capped at `neededMinutes`.
- `openHours = max(0, neededHours - coveredHours)`.

### Current implementation path

- `GET /api/dashboard/coverage` loads `staffingRequirement`, `shift`, and `area` rows for the requested `entityId` and date range, then computes coverage in the Fastify service layer.
- The synchronous endpoint caps the date range to 31 days.
- Long-term scale is handled by a `CoverageSnapshot` table updated by BullMQ workers after shift mutations.

### Known complexity

- The legacy implementation ran in approximately `O(days × areas × requirements × shifts)` JavaScript loops. A 28-day window with 20 areas and 500 shifts could perform tens of thousands of comparisons.
- The migration target moves the heavy computation to SQL or pre-computed snapshots.

### Future architecture options

- Pre-compute per-day, per-area coverage buckets in a `CoverageSnapshot` table updated by a background job or trigger.
- Store requirement intervals as integer minutes (or PostgreSQL `tstzrange`) and use range operators to push overlap math into the database.
- Cache the response keyed by `(entityId, startDate, endDate, lastModifiedShiftAt)` in Redis or an Azure Cache.

---

## Target application architecture

### Current state

V1 is being migrated from a single Next.js application into a pnpm-workspace monorepo. The legacy Next.js app lives in `apps/legacy` during the strangler-fig migration. New backend code lives in `apps/api` and the new frontend lives in `apps/web`.

### Monorepo layout

```
Nursing-Scheduler-claude-app-creation-mruz4s/
├── pnpm-workspace.yaml
├── package.json              # Root scripts, workspace config, no app deps
├── apps/
│   ├── web/                  # React + Vite + TypeScript + Tailwind
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── pages/        # React Router pages
│   │   │   ├── components/
│   │   │   └── lib/
│   │   │       └── api.ts    # Axios client with withCredentials
│   │   └── vite.config.ts
│   ├── api/                  # Fastify + TypeScript + Prisma
│   │   ├── src/
│   │   │   ├── index.ts      # Server bootstrap
│   │   │   ├── routes/       # HTTP route handlers
│   │   │   ├── services/     # Domain/business logic
│   │   │   ├── repositories/ # Prisma/data access
│   │   │   ├── plugins/      # Auth, error handling, swagger
│   │   │   └── lib/
│   │   └── package.json
│   └── legacy/               # Existing Next.js app during migration
├── packages/
│   ├── shared/               # Zod schemas, types, auth contracts
│   └── db/                   # Prisma schema, client, migrations
└── docs/
    └── specs/
        └── 2026-07-09-fastify-monorepo-migration.md
```

### Responsibilities

| Layer | Owns | Does not own |
|---|---|---|
| **apps/web** | React components, routing, forms, client state, calling backend API | DB access, business logic, auth session validation, domain aggregation |
| **apps/api** | HTTP routes, request/response validation, service orchestration, auth enforcement, all DB access | UI rendering, client state, browser APIs |
| **packages/shared** | Zod schemas, TypeScript interfaces, auth contract types, API route types | Runtime logic, DB queries |
| **packages/db** | Prisma schema, generated client, migration files, seed data | Business logic, HTTP handling |
| **apps/legacy** (temporary) | Existing Next.js UI and API routes until fully migrated | New features, new DB access patterns |

### Transition notes

- The legacy Next.js app is moved to `apps/legacy` and remains deployable until the React + Vite frontend and Fastify backend fully replace it.
- New routes and features must be added to `apps/api`, not to `apps/legacy/src/app/api`.
- Existing `apps/legacy/src/app/api` routes are technical debt and should be migrated incrementally or proxied to Fastify (see Known technical debt).
- API contracts are defined in `packages/shared` and consumed by both `apps/web` and `apps/api`.

---

## API route conventions and error handling

### Route structure

- Fastify routes live in `apps/api/src/routes/` and are registered in `apps/api/src/index.ts` under the `/api` prefix.
- Each route file exports a function (e.g., `async function shiftRoutes(app: FastifyInstance)`) that registers verbs on the instance.
- Routes parse HTTP requests, validate inputs, call services, and return responses. They do not contain business logic.
- Auth is enforced by the auth plugin in `apps/api/src/plugins/auth.ts`. Every route must call `request.requireAuth()` (or `request.requireRole([...])`) and `request.canAccessEntity(entityId)` before reading or writing data.

### Service/repository structure

- **Routes** (`apps/api/src/routes/`): parse and validate HTTP requests, call services, return responses.
- **Services** (`apps/api/src/services/`): contain business logic, orchestration, and transactions.
- **Repositories** (`apps/api/src/repositories/`): contain Prisma queries and data access.

### Validation

- Validate request bodies with Zod schemas from `packages/shared`. Parse with `schema.parse(request.body)` and return `400` on failure.
- Coerce query params (`page`, `pageSize`, date strings) before using them. Cap `pageSize` to a maximum (e.g., 1000).

### Error handling

- `401` — unauthenticated (missing/invalid `request.requireAuth()`).
- `403` — authenticated but not authorized for this entity/action (failed `request.canAccessEntity()` or `request.requireRole()`).
- `400` — bad input (Zod or business rule violation).
- `404` — record not found.
- `500` — unexpected server error; log the full error but return a generic message.

### Entity scoping pattern

```ts
const session = request.requireAuth()
const query = parseShiftQuery(request.query)
const result = await service.list(session, query)
return reply.send(result)
```

For single-resource mutations, always load the existing record first:

```ts
const existing = await repo.findById(request.params.id)
if (!existing) return reply.status(404).send({ error: 'Not found' })
if (!request.canAccessEntity(existing.entityId)) {
  return reply.status(403).send({ error: 'Forbidden' })
}
const updated = await service.update(existing.id, updateSchema.parse(request.body))
return reply.send(updated)
```

**Known debt:** Several legacy Next.js routes do not follow this pattern yet. See `docs/SCALABILITY_CRITIQUE.md` ranked findings.

---

## Pagination expectations

### Current state

- The legacy Next.js routes under `apps/legacy/src/app/api` do not use `take`/`skip` or cursor-based pagination. This is a documented scalability risk.

### Target convention

- Every list endpoint must accept `page`/`pageSize` or `take`/`skip` query params.
- Default page size should be between 100 and 500 depending on use case (shifts: 500; users: 100).
- Return a consistent envelope: `{ data, pagination: { page, pageSize, total, hasNext } }`.
- Cap `pageSize` to a maximum (e.g., 1000) to prevent abuse.

### Dashboard endpoints

- `GET /api/dashboard/coverage` and `GET /api/dashboard/agency` should cap the date range (e.g., max 31 days) and split large requests into multiple pageable calls if needed.
- If pre-computed coverage snapshots are introduced, pagination becomes trivial on the snapshot table.

---

## Azure deployment topology and secrets management

### Compute

- **apps/api**: Azure Container Apps or App Service (Node.js 20, Fastify + TypeScript).
- **apps/web**: Azure Static Web Apps or App Service serving the Vite build output.
- **apps/legacy**: Azure App Service B2 plan running Next.js 14 standalone output during the transition.

### Database

- Azure PostgreSQL Flexible Server Standard_B1ms: 1 vCore, 2 GB RAM.
- Connection string is provided through `DATABASE_URL` env var (`packages/db/prisma/schema.prisma`).
- Prisma client singleton is created in `packages/db/src/client.ts` with no explicit pool tuning by default.

### Redis / workers

- Redis (Azure Cache for Redis or self-hosted) is used by BullMQ for background workers: bulk upload processing, coverage snapshot updates, budget snapshot updates.
- Worker processes are registered in `apps/api/src/workers/` and started via `pnpm worker`.

### Secrets

- `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `API_URL`, `WEB_URL`, `REDIS_URL`, and `VITE_API_URL` are environment variables. They are not present in this repository.
- Do not commit secrets, API keys, or production connection strings to git.
- If adding third-party integrations (SMS, email, external payroll), follow the same env-var pattern and add validation in Zod schemas or runtime checks.

### Network security

- Ensure Azure compute is configured to allow outbound traffic only to the PostgreSQL server and Redis, not open to the internet unless required by a feature.
- Consider VNet integration or private endpoints for the database before scaling to sensitive health data or multi-tenant deployments.

---

## Known technical debt

This list maps directly to `docs/SCALABILITY_CRITIQUE.md`. Do not treat these as acceptable patterns for new code. Items marked **[MIGRATING]** are being resolved by the move to `apps/api` and `apps/legacy`.

1. **ARCH-1: Next.js is the backend**
   - V1 colocated UI, API routes, domain logic, and DB access in one Next.js app. This is the root cause that amplified CRIT-2, HIGH-3, HIGH-4, MED-4, and CRIT-3.
   - **[MIGRATING]** The legacy Next.js app is moved to `apps/legacy`. New routes, business logic, and DB access belong in `apps/api`. `apps/web` is a thin React + Vite frontend.
2. **CRIT-1: Entity-scoping gaps in single-resource routes**
   - `PATCH/DELETE /api/areas/[id]`, `GET/PATCH /api/employees/[id]`, `GET /api/rates/[entityId]`, `DELETE /api/requirements/[id]` in the legacy app.
   - Fix by loading the record and calling `request.canAccessEntity(existing.entityId)` before mutation/return in Fastify.
3. **CRIT-3: Upload endpoint scoping and file limits**
   - `POST /api/upload` in the legacy app resolves entities by `code` from uploaded spreadsheets but never verifies the caller can access those entities.
   - No max file size, content-type validation, or row-count limit in the legacy route.
   - Fix by validating every resolved `entityId` with `request.canAccessEntity()` and adding upload size/row limits in Fastify.
4. **HIGH-1: Unbounded list queries**
   - All legacy list endpoints lack `take`/`skip`. Add pagination before adding new list endpoints.
5. **HIGH-4: In-memory aggregation**
   - Legacy budget and coverage endpoints aggregate in JavaScript. New features must use DB aggregation or pre-computed snapshots.
6. **HIGH-3: Sequential bulk writes**
   - Legacy `copy-week` and `upload` use `create` loops. New bulk operations must use `createMany` inside a transaction or a BullMQ worker.
7. **MED-2: Missing Prisma pool configuration**
   - Tune pool size or introduce PgBouncer if scaling horizontally.
8. **MED-1: Middleware does not protect API routes or enforce RBAC/entity scoping**
   - Authorization must be explicit in every Fastify route handler via `request.requireAuth()` and `request.canAccessEntity()`.

---

*For the coding patterns that guard against this debt, see `docs/llm-framework/PLAYBOOKS.md`.*
