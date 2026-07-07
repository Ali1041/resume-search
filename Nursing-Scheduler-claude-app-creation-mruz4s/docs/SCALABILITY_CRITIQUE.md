# Nursing Scheduler — Scalability Critique

**Date:** 2026-07-07  
**Target:** Medium scale (~50k shifts/month, ~500 employees, ~20 entities), extrapolated to Large (~200k shifts/month).  
**Scope:** Documentation-only review of the Next.js 14 / Prisma / PostgreSQL / Azure stack.

---

## 1. Workload model

- **Shifts:** ~50k/month at medium, ~200k/month at large. Schedule grids usually query a 1–4 week window, but weekly copy and bulk import can touch thousands of rows in a single request.
- **Employees:** ~500 at medium, ~2k at large. Roster and eligibility lookups are per-entity.
- **Entities:** ~20 at medium, ~100 at large. Parent entities aggregate child totals.
- **Concurrent users:** 20–50 during scheduling windows; bursts during weekly copy/import.
- **Read/write mix:** ~80% read, 20% write. Peak writes occur during weekly schedule copy (`/api/shifts/copy-week`) and spreadsheet upload (`/api/upload`).

**Inference:** No production telemetry (pg_stat_statements or Azure Monitor) was available, so these figures are planning estimates derived from the business domain and target growth.

---

## 2. Current stack assessment

- **Next.js 14** standalone output (`next.config.js`); App Router with server components and API routes.
- **Prisma 7.8** with a singleton client in `src/lib/prisma.ts:7–11`.
- **PostgreSQL 15** on Azure Flexible Server **Standard_B1ms**: 1 vCore, 2 GB RAM, burstable I/O.
- **Azure App Service B2**: 2 cores, 3.5 GB RAM, no auto-scale by default.
- **NextAuth.js v4** credentials provider + 8h JWT session.

**Azure tier limits (evidence from published Azure specs):**
- Standard_B1ms: ~1 vCore, 2 GB RAM, max connections bounded by PostgreSQL ~100 active, burstable credits limit sustained CPU.
- App Service B2: 2 cores / 3.5 GB RAM; no guaranteed horizontal scaling; cold starts depend on package size and Next.js standalone build.

**Evidence:** Prisma singleton is configured without explicit `connection_limit` or `pool_timeout` in `src/lib/prisma.ts:7–11`, and the schema uses only the `DATABASE_URL` env var (`prisma/schema.prisma:5–8`). At 50k+ shifts/month, the default pool size will become the first concurrency bottleneck.

---

## 3. Database layer analysis

### 3.1 Index coverage

The schema is well-modeled for the V1 domain but is missing several composite indexes that become load-bearing as `Shift` volume grows.

**Evidence:** `Shift` currently has three indexes:
```prisma
@@index([entityId, date])
@@index([employeeId])
@@index([date])
```
`prisma/schema.prisma:193–195`

**Finding — Missing core schedule-grid index:**
- The schedule grid is filtered by `entityId`, `areaId`, and `date`. `@@index([entityId, date])` can partially satisfy this by filtering on `entityId` first, but it cannot efficiently narrow by `areaId` and still requires scanning many rows or a second filter pass.
- **Evidence:** `GET /api/shifts` builds `where: { entityId, date, employeeId }` and returns `include: { employee, area, entity }` in `src/app/api/shifts/route.ts:69–75`.

**Finding — Missing employee cost / overtime index:**
- Weekly cost and overtime checks filter by `employeeId` and `date`. The existing `@@index([employeeId])` does not include `date`, so date-range scans must resolve rows by `employeeId` and then filter by date in-memory or via a secondary sort.
- **Evidence:** `checkOvertimeWarning` queries `shift.findMany({ where: { employeeId, date: { gte, lte } } })` in `src/app/api/shifts/route.ts:27–32`.

**Finding — Missing open-shift index:**
- Open-shift boards filter by `isOpen` and `date` (or `entityId`, `isOpen`, `date`). No index covers `isOpen`, which will table-scan as open shifts become a small fraction of total shifts.
- **Evidence:** `Shift` defines `isOpen Boolean @default(false)` in `prisma/schema.prisma:184` but no index includes it.

**Finding — Redundant indexes:**
- `User.@@index([email])` duplicates the `@unique` on `email` (`prisma/schema.prisma:54` and `prisma/schema.prisma:64`).
- `Entity.@@index([code])` duplicates the `@unique` on `code` (`prisma/schema.prisma:71` and `prisma/schema.prisma:90`).
- `UserEntityAssignment.@@index([userId])` is covered by the prefix of `@@unique([userId, entityId])` (`prisma/schema.prisma:102–103`).
- `EmployeeEntityEligibility.@@index([employeeId])` is covered by the prefix of `@@unique([employeeId, entityId])` (`prisma/schema.prisma:152–153`).
- **Evidence:** All of the above are visible in `prisma/schema.prisma` lines 52–155.

### 3.2 Query patterns and N+1 risks

**Finding — Parent-entity budget aggregation runs one query set per child:**
- `GET /api/budget` for `PARENT` entities loads `subEntities` (`src/app/api/budget/route.ts:105–108`), then calls `computeEntityBudget` for each child in `Promise.all` (`src/app/api/budget/route.ts:120–122`). Each child invocation runs `rateCard.findUnique`, `budgetTarget.findUnique`, `staffingRequirement.findMany`, and `shift.findMany`.
- **Evidence:** `src/app/api/budget/route.ts:25–48` and `src/app/api/budget/route.ts:104–122`.
- **Impact:** For a parent with 10 sub-entities, one budget request becomes 40+ sequential/parallel DB queries plus full in-memory aggregation of all matching shifts.

**Finding — No API route uses Prisma aggregation (`groupBy`, `_sum`, `_count`):**
- All hours, dollars, coverage, and agency-percentage math is computed in JavaScript after loading rows.
- **Evidence:** `src/app/api/budget/route.ts:52–67` iterates every shift and computes `rawHours`, `paidHours`, and `rateCard` lookups in JS. `src/app/api/dashboard/coverage/route.ts:52–113` iterates days, areas, requirements, and shifts in nested loops and computes overlap minutes in memory.
- **Impact:** At 50k shifts/month, this transfers far more rows to the Node process than necessary and wastes CPU on repeated `coveredMinutes` / `rawHours` calculations.

**Finding — Coverage endpoint loads the full date range into memory:**
- `GET /api/dashboard/coverage` loads `requirements`, `shifts`, and `areas` for the entire requested range, then builds per-day response objects in nested loops.
- **Evidence:** `src/app/api/dashboard/coverage/route.ts:33–50` and `src/app/api/dashboard/coverage/route.ts:52–113`.
- **Impact:** A 28-day request with 500 shifts and 20 areas performs ~40,000 requirement/shift comparisons in JavaScript; doubling shift count roughly quadruples comparisons.

### 3.3 Coverage-calculation complexity

**Finding — Coverage math is entirely client-side / application-side:**
- `coveredMinutes` in `src/lib/hours.ts:78–95` handles overnight shifts by adding 24h when `endTime <= startTime`. The same logic is repeated inside `src/app/api/dashboard/coverage/route.ts:67–74` for every requirement/shift pair.
- **Evidence:** `src/lib/hours.ts:78–95` and `src/app/api/dashboard/coverage/route.ts:62–77`.
- **Impact:** PostgreSQL cannot optimize this; the CPU cost is fixed per comparison and must scale horizontally by adding Node instances or by pre-computing coverage buckets.

---

## 4. Application layer analysis

### 4.1 API concurrency and request amplification

**Finding — Every list endpoint is unbounded:**
- No `route.ts` under `src/app/api` uses `take`/`skip` or cursor pagination for its primary `findMany`.
- **Evidence:** `src/app/api/shifts/route.ts:69`, `src/app/api/employees/route.ts:34`, `src/app/api/areas/route.ts:31`, `src/app/api/entities/route.ts:24`, `src/app/api/requirements/route.ts:33`, `src/app/api/users/route.ts:12`, `src/app/api/dashboard/agency/route.ts:27–45`, and `src/app/api/dashboard/coverage/route.ts:33–50`.
- **Impact:** A single user requesting an unbounded date range or a manager requesting all accessible shifts can pull thousands of rows into the App Service container and serialize them to JSON.

**Finding — Write amplification in bulk operations:**
- `POST /api/shifts/copy-week` loads one week of shifts, then creates each new shift in a sequential `for...of` loop (`src/app/api/shifts/copy-week/route.ts:38–53`).
- `POST /api/upload` creates entities, employees, requirements, and shifts one record per iteration (`src/app/api/upload/route.ts:143–173, 228–238, 292–296, 366–369`).
- **Evidence:** Verified line ranges in the files above; no `$transaction` with `createMany` is used.
- **Impact:** Each insert is a separate round-trip plus transaction commit. At 500 shifts/week copy, this creates 500+ round-trips and holds the request open for multiple seconds, exhausting concurrent slots.

### 4.2 Cold starts and memory

**Finding — Next.js standalone build and App Service B2 memory ceiling:**
- The container is limited to 3.5 GB on a B2 plan. A large response (e.g., unbounded shift list with three nested includes) plus JavaScript aggregation can temporarily spike heap usage.
- **Inference:** No observed memory telemetry was available, but the combination of unbounded `findMany` and nested in-memory loops is a known risk on this tier.

### 4.3 Server components and drag-and-drop state

**Finding — Server components fetch data directly without API pagination:**
- **Inference:** Based on project conventions, schedule pages load shifts via server components or API calls. Because the API routes are unbounded, server components inherit the same row-limit risk.
- **Finding — Drag-and-drop state is client-side:**
- `@dnd-kit` state lives in the browser. This is acceptable for UX but means any optimistic update must eventually reconcile with the unbounded API responses.
- **Inference:** No direct code risk, but client-side complexity grows with the size of the unbounded shift payloads.

---

## 5. Operational limits

### 5.1 Connection limits

**Finding — Default Prisma pool and PostgreSQL B1ms connection ceiling are unverified:**
- `src/lib/prisma.ts:7–11` does not set `connection_limit` or `pool_timeout`. The Azure PostgreSQL Standard_B1ms tier supports a relatively small number of active connections before CPU/IO becomes the bottleneck.
- **Evidence:** `src/lib/prisma.ts:7–11` and `prisma/schema.prisma:5–8`.
- **Impact:** At 50k shifts/month with ~20–50 concurrent users and many parallel dashboard queries, the app can exhaust connections or queue requests waiting for pool slots.

### 5.2 Backups and monitoring

**Finding — No explicit backup or slow-query monitoring is visible in the codebase:**
- Azure Flexible Server provides managed backups, but RPO/RTO and alert thresholds are not described in code or docs in this repository.
- **Inference:** This is a deployment/ops gap, not an application bug. It should be tracked in runbooks.

### 5.3 Migration-at-deploy risk

**Finding — `npm run db:migrate` runs `prisma migrate deploy`:**
- **Evidence:** `package.json:11` defines `db:migrate` as `prisma migrate deploy`.
- **Impact:** Long-running migrations (e.g., adding the missing indexes above) can lock tables or cause deploy timeouts if run during traffic. Plan index additions as `CONCURRENTLY` or use `CREATE INDEX CONCURRENTLY` outside the default migration path if downtime is unacceptable.

---

## 6. Ranked findings

| Severity | Finding | Evidence | Affected scale |
|---|---|---|---|
| **Critical** | **CRIT-1** Entity-scoping gaps in single-resource routes: `PATCH/DELETE /api/areas/[id]`, `GET/PATCH /api/employees/[id]`, `GET /api/rates/[entityId]`, `DELETE /api/requirements/[id]` do not verify the caller can access the record's entity. | **Evidence:** `src/app/api/areas/[id]/route.ts:13–37`; `src/app/api/employees/[id]/route.ts:19–66`; `src/app/api/rates/[entityId]/route.ts:14–19`; `src/app/api/requirements/[id]/route.ts:6–13`. | All scales |
| **Critical** | **CRIT-2** `GET /api/budget` for parent entities runs full query sets per sub-entity with no `take`/`skip` and in-memory aggregation. | **Evidence:** `src/app/api/budget/route.ts:25–48`, `src/app/api/budget/route.ts:104–122`. | Medium+ |
| **Critical** | **CRIT-3** `POST /api/upload` resolves entities by `code` from uploaded spreadsheets but never calls `canAccessEntity(session, entityId)`; also accepts arbitrary `.xlsx`/`.csv` files with no size or row-count limits. | **Evidence:** `src/app/api/upload/route.ts:243–298`, `300–372`; `src/app/api/upload/route.ts:38–54`. | All scales |
| **High** | **HIGH-1** No list API uses pagination (`take`/`skip` or cursor). | **Evidence:** `src/app/api/shifts/route.ts:69`; `src/app/api/employees/route.ts:34`; `src/app/api/areas/route.ts:31`; `src/app/api/entities/route.ts:24`; `src/app/api/requirements/route.ts:33`; `src/app/api/users/route.ts:12`; `src/app/api/dashboard/agency/route.ts:27–45`; `src/app/api/dashboard/coverage/route.ts:33–50`. | Medium+ |
| **High** | **HIGH-2** Missing `Shift` indexes for `areaId`, `(entityId, areaId, date)`, `(employeeId, date)`, and open-shift queries. | **Evidence:** `prisma/schema.prisma:193–196`; query patterns in `src/app/api/shifts/route.ts:69`, `src/app/api/dashboard/coverage/route.ts:33–50`. | Medium+ |
| **High** | **HIGH-3** Bulk writes in `copy-week` and `upload` are sequential loops of single `create` calls. | **Evidence:** `src/app/api/shifts/copy-week/route.ts:38–53`; `src/app/api/upload/route.ts:143–173, 228–238, 292–296, 366–369`. | Medium+ |
| **High** | **HIGH-4** All aggregation is done in JavaScript; no `groupBy`/`_sum`/`_count`. | **Evidence:** `src/app/api/budget/route.ts:52–67`; `src/app/api/dashboard/coverage/route.ts:52–113`. | Medium+ |
| **Medium** | **MED-1** `middleware.ts` only protects page routes; API routes are not in the matcher, and RBAC/entity scoping is not enforced at the edge. | **Evidence:** `src/middleware.ts:1–13`. | All scales |
| **Medium** | **MED-2** `PrismaClient` has no explicit pool config; connection pool size is untuned for the B1ms tier. | **Evidence:** `src/lib/prisma.ts:7–11`; `prisma/schema.prisma:5–8`. | Medium+ |
| **Medium** | **MED-3** Redundant indexes on `User.email`, `Entity.code`, and prefix-covered indexes waste write throughput and storage. | **Evidence:** `prisma/schema.prisma:54,64`; `prisma/schema.prisma:71,90`; `prisma/schema.prisma:102–103`; `prisma/schema.prisma:152–153`. | Medium+ |
| **Medium** | **MED-4** `GET /api/dashboard/coverage` performs O(days × areas × requirements × shifts) in-memory comparisons. | **Evidence:** `src/app/api/dashboard/coverage/route.ts:52–113`. | Medium+ |
| **Low** | **LOW-1** `requireAdmin` and `requireManagerOrAdmin` use `redirect()` rather than returning HTTP errors, which is only safe in server components, not API routes. | **Evidence:** `src/lib/permissions.ts:13–23`. | All scales (pattern risk) |
| **Low** | **LOW-2** `assertEntityAccess` throws a generic `Error`; API routes must translate it themselves and may leak stack traces. | **Evidence:** `src/lib/permissions.ts:30–34`. | All scales (pattern risk) |

---

## 7. Phased roadmap

> **Order matters.** Do the foundation re-architecture first. Scaling the current Next.js-all-in architecture is wasteful because every optimization must be done inside the same process that renders the UI. A backend service gives you a clean boundary to scale, test, and guardrail with LLM docs.

### Foundation re-architecture (strategic priority)

1. **Introduce a dedicated backend service.**
   - Choose **NestJS + TypeScript** (same language, strong module structure) or **FastAPI + Pydantic** (strict validation, excellent for data-heavy domains).
   - Next.js becomes a UI / API-gateway layer; it should not import `prisma` or query the database directly.
2. **Migrate the heaviest endpoints first:**
   - `/api/budget` (CRIT-2)
   - `/api/dashboard/coverage` (MED-4)
   - `/api/shifts/copy-week` (HIGH-3)
   - `/api/upload` (CRIT-3)
3. **Migrate remaining CRUD routes** one resource at a time.
4. **Remove Prisma from Next.js** once all routes are migrated.
5. **Update LLM framework docs** (`CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md`) to enforce the new boundary.

### Quick wins (1–2 days, low risk)

1. **Add missing indexes on `Shift`:**
   - `@@index([areaId])`
   - `@@index([entityId, areaId, date])`
   - `@@index([entityId, employeeId, date])`
   - `@@index([employeeId, date])`
   - `@@index([entityId, isOpen, date])`
   - Use `CREATE INDEX CONCURRENTLY` or deploy during low-traffic window to avoid table locks.
2. **Remove redundant indexes:** `User.email`, `Entity.code`, `UserEntityAssignment.userId`, `EmployeeEntityEligibility.employeeId`.
3. **Add pagination to list endpoints:** `take`/`skip` default (e.g., 100–500) with optional query params for `GET /api/shifts`, `/api/employees`, `/api/areas`, `/api/entities`, `/api/requirements`, `/api/users`, and dashboard list queries.
4. **Fix entity-scoping gaps** in single-resource routes by loading the record, then calling `canAccessEntity(existing.entityId)` before mutation or return.

### Medium changes (1–2 weeks)

1. **Replace JS aggregation with DB aggregation:**
   - Use `prisma.shift.groupBy` with `_sum` and `_count` for budget/cost rollups.
   - Move coverage bucketing to a materialized view or a scheduled pre-computation job if the overlap math is stable enough.
2. **Bulk-write optimization:**
   - Use `prisma.shift.createMany` inside a `$transaction` in `copy-week` and `upload` to reduce round-trips.
3. **Tune Prisma connection pool:**
   - Set `connection_limit` and `pool_timeout` appropriate to the B1ms tier or migrate to a larger tier; consider PgBouncer if scaling vertically first.
4. **Add query logging / slow-query monitoring:**
   - Enable Azure PostgreSQL slow-query logs and pg_stat_statements; ship to Azure Monitor.
5. **Add rate limiting / request timeouts** for heavy endpoints (`budget`, `coverage`, `copy-week`, `upload`).

### Larger architectural changes (1–3 months)

1. **Introduce a read replica or cache layer:**
   - Dashboard and coverage reads can be served from a read replica or a Redis cache keyed by `(entityId, dateRange)`.
2. **Background job queue:**
   - Move weekly copy, bulk upload, and coverage pre-computation to Azure Queue Storage / Azure Functions or a BullMQ worker.
3. **Dedicated worker service for coverage pre-computation:**
   - Pre-compute per-day, per-area coverage buckets and store them in a `CoverageSnapshot` table.
4. **Connection pooling with PgBouncer:**
   - If the app is scaled to multiple App Service instances, route Prisma through PgBouncer with `pgbouncer=true` in the connection string.
5. **Evaluate horizontal scaling:**
   - Move from App Service B2 to a scale-out plan with auto-scaling rules based on CPU/response time; consider containerizing with health probes.
6. **Sharded entity roll-ups:**
   - If parent entities grow past 100 children, store denormalized roll-up totals updated asynchronously rather than recomputing on every request.

---

## 8. Application architecture recommendation — Next.js vs. dedicated backend

### Finding

**Next.js is a frontend framework, not a backend framework.** The current codebase places heavy domain logic, aggregation, bulk operations, and direct database access inside Next.js API routes.

**Evidence:**
- `src/app/api/budget/route.ts:25–48` and `src/app/api/budget/route.ts:104–122` run full query sets and in-memory aggregation for parent entities (CRIT-2).
- `src/app/api/dashboard/coverage/route.ts:52–113` performs `O(days × areas × requirements × shifts)` comparisons in JavaScript (MED-4).
- `src/app/api/shifts/copy-week/route.ts:38–53` and `src/app/api/upload/route.ts:143–173, 228–238, 292–296, 366–369` do sequential `create` calls (HIGH-3).
- `src/app/api/upload/route.ts:243–298, 300–372` resolves entities by code from uploaded spreadsheets and writes directly to the database without a domain layer (CRIT-3).
- Every API route under `src/app/api` imports `prisma` directly and queries the database; there is no service layer or backend boundary.

### Impact

At small scale this is convenient, but as volume grows the Next.js process becomes responsible for:
- UI rendering
- Lightweight CRUD
- Heavy aggregation
- Bulk writes
- Coverage pre-computation
- Connection pooling

This coupling makes the system harder to reason about, harder to test, harder to scale, and easier for AI-generated code to violate boundaries. The existing findings are symptoms of this architectural mismatch.

### Recommendation

**Introduce a dedicated backend service.** Next.js should own UI rendering and thin API-gateway orchestration; the backend should own all domain logic, database access, aggregation, and bulk operations.

### Recommended target architecture

```
Next.js (frontend + BFF)
    │
    └── Backend service (NestJS or FastAPI)
            │
            ├── PostgreSQL (primary)
            ├── Read replica / cache for dashboards
            └── Background worker queue
```

### Why now

- **Hard boundary for AI-generated code:** Telling an LLM "business logic lives in the backend, Next.js only renders UI and calls APIs" creates a clear box that is easier to enforce in `CLAUDE.md` / `AGENTS.md` guardrails.
- **Independent scaling:** Dashboard/coverage/backend workloads can be scaled separately.
- **Better testing:** Domain logic can be unit-tested in isolation from React components and route handlers.
- **Cheaper than refactoring later:** The current V1 has ~20 API routes. Migrating them incrementally is far cheaper than rewriting a 200-route vibecoded monolith.

### Backend framework options

| Option | Best for | Trade-off |
|---|---|---|
| **NestJS + TypeScript** | Same language as Next.js; strong module/service structure; easy for a vibecoded TS codebase to grow into. | Heavier framework; can be over-engineered if not disciplined. |
| **FastAPI + Pydantic** | Strict validation, excellent data/schedule math libraries, very clear request/response contracts. | Different language from frontend; more context switching. |

**Recommendation:** NestJS if you want to keep one language. FastAPI if you want the strongest validation and domain-model discipline.

### Migration strategy

Do not rewrite everything at once. Migrate in this order:

1. **Set up the backend skeleton** and define the API contract shape.
2. **Migrate the heaviest endpoints first:** `/api/budget`, `/api/dashboard/coverage`, `/api/shifts/copy-week`, `/api/upload`.
3. **Migrate remaining CRUD routes** one resource at a time.
4. **Remove Prisma imports from Next.js** once all routes are migrated.
5. **Update LLM framework docs** to enforce the new boundary.

### LLM governance impact

This decision changes the foundational stack assumption. The following docs must be updated:
- `CLAUDE.md` / `AGENTS.md`: add "Next.js does not touch the database" as a non-negotiable.
- `ARCHITECTURE.md`: document the target backend-for-frontend architecture.
- `PLAYBOOKS.md`: add coding patterns for calling the backend from Next.js and keeping business logic out of API routes.

---

*End of critique. All findings are labeled with evidence or inference and are intended to inform both operational decisions and the LLM governance guardrails in `CLAUDE.md` / `docs/llm-framework/PLAYBOOKS.md`.*
