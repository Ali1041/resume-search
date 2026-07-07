# Nursing Scheduler — LLM Architecture Deep-Dive

**Last reviewed:** 2026-07-07

**Load this file when:** you are changing the entity hierarchy, coverage model, API route structure, deployment topology, or secrets management. For day-to-day rules, see `CLAUDE.md` / `AGENTS.md`.

---

## Entity hierarchy and roll-up behavior

### Model

- `Entity` has a self-referencing relation via `parentId` (`prisma/schema.prisma:79–80`).
- `EntityType` is either `STANDALONE` or `PARENT` (`prisma/schema.prisma:37–40`).
- `PARENT` entities are containers. They do not own `Area`, `Shift`, `RateCard`, or `BudgetTarget` directly. Their values are derived from child entities (`STANDALONE` or other `PARENT` sub-entities).
- `STANDALONE` entities are the schedulable units. They own areas, employees, shifts, staffing requirements, rate cards, and budget targets.

### Roll-up mechanics

- `GET /api/budget` checks `entity.type` and, if `PARENT`, loads `subEntities` where `parentId === entityId` (`src/app/api/budget/route.ts:104–108`).
- It then calls `computeEntityBudget` per sub-entity in `Promise.all` and sums the results (`src/app/api/budget/route.ts:120–136`).
- Period multipliers (`weekly`, `pay-period`, `monthly`, `quarterly`, `yearly`) are applied after aggregation (`src/app/api/budget/route.ts:94–101, 138–141`).
- **Current limitation:** This is full in-memory aggregation per child. With many sub-entities or many shifts, the request becomes a query-amplification and CPU hotspot. See `docs/SCALABILITY_CRITIQUE.md` finding CRIT-2.

### Authorization across hierarchy

- `getAccessibleEntityIds(session)` returns `null` for admins and `session.user.entityIds` for non-admins (`src/lib/permissions.ts:36–39`).
- Non-admin users should only receive entities explicitly assigned to them. The parent/child relationship is not automatically expanded into the session; if a manager needs access to a parent, the parent must be in their assigned list.
- **Guardrail:** Do not add "implicit parent access" logic without a design review. Any expansion of accessible IDs must happen server-side and be cached, not computed from the client.

---

## Coverage model

### Core definition

- Coverage is calculated as the time overlap between a scheduled shift and a staffing requirement.
- The helper `coveredMinutes(shiftStart, shiftEnd, reqStart, reqEnd)` in `src/lib/hours.ts:78–95` returns the overlap in minutes, handling overnight shifts by adding 24h when `endTime <= startTime`.
- `neededMinutes` for a slot is derived from `coveredMinutes(req.startTime, req.endTime, req.startTime, req.endTime)` or `rawHours * 60` (`src/app/api/dashboard/coverage/route.ts:63–64`).
- `coveredHours` is the sum of overlap minutes across all shifts assigned to that area, capped at `neededMinutes` (`src/app/api/dashboard/coverage/route.ts:72–77`).
- `openHours = max(0, neededHours - coveredHours)`.

### Current implementation path

- `GET /api/dashboard/coverage` loads `staffingRequirement`, `shift`, and `area` rows for the requested `entityId` and date range, then computes coverage in nested JavaScript loops (`src/app/api/dashboard/coverage/route.ts:33–113`).
- No DB pre-computation or materialized view exists.

### Known complexity

- Runtime is approximately `O(days × areas × requirements × shifts)`. A 28-day window with 20 areas and 500 shifts can perform tens of thousands of comparisons.
- Overnight shifts are the only non-trivial time logic; the rest is straightforward interval overlap.

### Future architecture options

- Pre-compute per-day, per-area coverage buckets in a `CoverageSnapshot` table updated by a background job or trigger.
- Store requirement intervals as integer minutes (or PostgreSQL `tstzrange`) and use range operators to push overlap math into the database.
- Cache the response keyed by `(entityId, startDate, endDate, lastModifiedShiftAt)` in Redis or an Azure Cache.

---

## Target application architecture

### Current state

V1 colocates the UI, API routes, domain logic, and database access in a single Next.js application. This is reflected in `src/app/api/**/route.ts` files that import `prisma` directly and perform heavy aggregation, bulk writes, and coverage computation.

### Target state

```
Next.js (frontend + thin BFF)
    │
    └── Backend service (NestJS or FastAPI)
            │
            ├── PostgreSQL (primary)
            ├── Read replica / cache for dashboards
            └── Background worker queue
```

### Responsibilities

| Layer | Owns | Does not own |
|---|---|---|
| **Next.js** | Server-component rendering, client components, auth session hydration, calling backend APIs | Direct DB queries, business logic, heavy aggregation, bulk operations |
| **Backend service** | Domain logic, validation, aggregation, bulk writes, migrations, all DB access | UI rendering, client state |
| **Worker queue** | Bulk import, weekly copy, coverage pre-computation, roll-up snapshots | Synchronous request handling |

### Transition notes

- New routes must be added to the backend, not to `src/app/api`.
- Existing `src/app/api` routes are technical debt and should be migrated incrementally (see Known technical debt).
- API contracts should be defined in the backend and consumed by Next.js.

---

## API route conventions and error handling

### Route structure

- All API routes live under `src/app/api/**/route.ts` using the Next.js App Router convention.
- Each route handler is named `GET`, `POST`, `PATCH`, `PUT`, or `DELETE` as appropriate.
- No centralized authorization middleware exists; each route must call `getServerSession(authOptions)` and enforce its own checks (`src/lib/permissions.ts`).

### Error handling

- Use `getServerSession` to verify the session, then return `401` for missing sessions and `403` for insufficient role or entity access.
- Validate request bodies with Zod; return `400` with `err.errors[0].message` on failure.
- Catch unexpected errors, log to `console.error`, and return `500` with `{ error: 'Server error' }`. Do not leak stack traces to the client.
- Example pattern from `src/app/api/shifts/route.ts:82–143`.

### Entity scoping pattern

```ts
const session = await getServerSession(authOptions)
if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
if (!canAccessEntity(session, entityId)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

For single-resource mutations, always load the existing record first:

```ts
const existing = await prisma.area.findUnique({ where: { id: params.id } })
if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
if (!canAccessEntity(session, existing.entityId)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

**Known debt:** Several routes do not follow this pattern yet. See `docs/SCALABILITY_CRITIQUE.md` ranked findings.

---

## Pagination expectations

### Current state

- No route under `src/app/api` uses `take`/`skip` or cursor-based pagination for its primary list query. This is a documented scalability risk.

### Target convention

- Every list endpoint must accept `page`/`limit` or `take`/`skip` query params.
- Default page size should be between 100 and 500 depending on use case (shifts: 500; users: 100).
- Return a consistent envelope: `{ data, pagination: { page, pageSize, total, hasNext } }`.
- Cap `limit` to a maximum (e.g., 1000) to prevent abuse.

### Dashboard endpoints

- `GET /api/dashboard/coverage` and `GET /api/dashboard/agency` should cap the date range (e.g., max 90 days) and split large requests into multiple pageable calls if needed.
- If pre-computed coverage snapshots are introduced, pagination becomes trivial on the snapshot table.

---

## Azure deployment topology and secrets management

### Compute

- Azure App Service B2 plan, Next.js 14 standalone output.
- The container runs the Next.js server and Prisma client. No separate worker tier exists yet.
- Cold starts depend on the standalone build size and App Service warm-up. No health probes or readiness endpoints are visible in code.

### Database

- Azure PostgreSQL Flexible Server Standard_B1ms: 1 vCore, 2 GB RAM.
- Connection string is provided through `DATABASE_URL` env var (`prisma/schema.prisma:5–8`).
- Prisma client singleton is created in `src/lib/prisma.ts:7–11` with no explicit pool tuning.

### Secrets

- `DATABASE_URL` and NextAuth secrets (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`) are environment variables. They are not present in this repository.
- Do not commit secrets, API keys, or production connection strings to git.
- If adding third-party integrations (SMS, email, external payroll), follow the same env-var pattern and add validation in Zod schemas or runtime checks.

### Network security

- Ensure the Azure App Service is configured to allow outbound traffic only to the PostgreSQL server, not open to the internet unless required by a feature.
- Consider VNet integration or private endpoints for the database before scaling to sensitive health data or multi-tenant deployments.

---

## Known technical debt

This list maps directly to `docs/SCALABILITY_CRITIQUE.md`. Do not treat these as acceptable patterns for new code.

1. **ARCH-1: Next.js is the backend**
   - V1 colocates UI, API routes, domain logic, and DB access in one Next.js app. This is the root cause that amplifies CRIT-2, HIGH-3, HIGH-4, MED-4, and CRIT-3.
   - Fix by migrating to the backend-for-frontend architecture documented in `docs/SCALABILITY_CRITIQUE.md` section 8.
2. **CRIT-1: Entity-scoping gaps in single-resource routes**
   - `PATCH/DELETE /api/areas/[id]`, `GET/PATCH /api/employees/[id]`, `GET /api/rates/[entityId]`, `DELETE /api/requirements/[id]`.
   - Fix by loading the record and calling `canAccessEntity(session, existing.entityId)` before mutation/return.
3. **CRIT-3: Upload endpoint scoping and file limits**
   - `POST /api/upload` resolves entities by `code` from uploaded spreadsheets but never verifies the caller can access those entities (`src/app/api/upload/route.ts:243–298`, `300–372`).
   - No max file size, content-type validation, or row-count limit (`src/app/api/upload/route.ts:38–54`).
   - Fix by validating every resolved `entityId` with `canAccessEntity` and adding upload size/row limits.
4. **HIGH-1: Unbounded list queries**
   - All list endpoints lack `take`/`skip`. Add pagination before adding new list endpoints.
5. **HIGH-4: In-memory aggregation**
   - Budget and coverage endpoints aggregate in JavaScript. New features should use DB aggregation or pre-computed snapshots.
6. **HIGH-3: Sequential bulk writes**
   - `copy-week` and `upload` use `create` loops. New bulk operations should use `createMany` inside a transaction.
7. **MED-2: Missing Prisma pool configuration**
   - Tune pool size or introduce PgBouncer if scaling horizontally.
8. **MED-1: Middleware does not protect API routes or enforce RBAC/entity scoping**
   - Authorization must be explicit in every route handler.

---

*For the coding patterns that guard against this debt, see `docs/llm-framework/PLAYBOOKS.md`.*
