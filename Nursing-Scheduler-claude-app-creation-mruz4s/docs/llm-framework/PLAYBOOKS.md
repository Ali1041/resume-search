# Nursing Scheduler — LLM Playbooks

**Last reviewed:** 2026-07-07

**Load this file when:** you are writing or reviewing code that touches auth, entity scoping, Prisma queries, API routes, or UI components. For architecture context, see `docs/llm-framework/ARCHITECTURE.md`.

---

## Security & RBAC playbook

### 1. Verify the session first

- In API routes, call `getServerSession(authOptions)` before any database query.
- Return `401` if no session exists.
- In server components, use `requireAuth()`, `requireAdmin()`, or `requireManagerOrAdmin()` from `src/lib/permissions.ts`.
- **Do not** use the redirect helpers inside API routes.

### 2. Enforce entity access before reading or writing

- Use `canAccessEntity(session, entityId)` for explicit entity IDs from query params or body.
- Use `getAccessibleEntityIds(session)` to build `IN` lists. Remember it returns `null` for admins, which means all entities, not none.
- For single-resource routes, load the record first, then check `canAccessEntity(session, existing.entityId)`.

### 3. Validate the role gate

- `ADMIN`: can do everything, including user/entity management and budget/rate targets.
- `MANAGER`: can schedule shifts, manage employees/areas/requirements, and upload schedules.
- `VIEWER`: read-only. No writes.
- If a route should be admin-only, check `session.user.role === 'ADMIN'` explicitly. Do not rely on a feature name or URL path.

### 4. Sanitize IDs from the client

- Treat `entityId`, `areaId`, `employeeId`, `userId`, and route `params.id` as untrusted until validated.
- Use Zod for body/query params. Use `z.string().cuid()` or `z.string().min(1)` as appropriate.
- Never forward a client-provided ID into a `where` clause without an entity-access check.

### 5. Do not expose internal data in errors

- Return generic `500` messages to the client: `{ error: 'Server error' }`.
- Log the full error with `console.error` for debugging.
- Do not return Prisma error messages, stack traces, or raw SQL to the client.

### 6. Fix known scoping gaps, do not replicate them

- The legacy Next.js routes `GET /api/rates/[entityId]`, `GET/PATCH /api/employees/[id]`, `PATCH/DELETE /api/areas/[id]`, and `DELETE /api/requirements/[id]` currently lack entity scoping (CRIT-1). Migrate them to the backend and add the check there.
- `POST /api/upload` resolves entities from uploaded spreadsheets but does not verify the caller can access those entities (CRIT-3). When migrating upload to the backend, validate every resolved `entityId` with `canAccessEntity(session, entityId)`.
- Do not add new Next.js routes that query the database. New routes must be added to the backend service.

### 7. Validate uploads before parsing

- Enforce max file size (e.g., 5–10 MB), allowed content types, and row-count limits before reading a spreadsheet into memory.
- Validate every entity referenced inside the file against the caller's accessible entity set before writing or previewing.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` CRIT-3.

---

## Performance guardrails

These rules are derived from `docs/SCALABILITY_CRITIQUE.md` and apply to new code. Existing violations are listed in `docs/llm-framework/ARCHITECTURE.md` under "Known technical debt."

### 1. Paginate every list endpoint

- Add `take` and `skip` to every `findMany` that returns a list.
- Default page size:
  - Shifts: 500
  - Employees: 500
  - Areas, requirements, entities: 500
  - Users: 100
- Cap `limit` at 1000.
- Return a pagination envelope: `{ data, pagination: { page, pageSize, total, hasNext } }`.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` ranked finding HIGH-1.

### 2. Use DB aggregation, not in-memory loops

- For sums, counts, averages, use Prisma `groupBy`, `_sum`, `_count`, `_avg`.
- Example: budget rollups should group shifts by `(entityId, employee.role, employee.employmentType)` and sum `paidHours * rate` directly in SQL where possible.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` ranked finding HIGH-4.

### 3. Add composite indexes for multi-column filters

- When a query filters by two or more columns together, add a composite index with the most selective column first.
- High-priority targets on `Shift`:
  - `(entityId, areaId, date)` for schedule grids
  - `(entityId, employeeId, date)` for employee schedules and cost rollups
  - `(employeeId, date)` for weekly overtime/cost checks
  - `(entityId, isOpen, date)` for open-shift boards
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` ranked finding HIGH-2.

### 4. Bulk-write with `createMany` and transactions

- Never write inside a `for...of` loop unless the writes are logically independent and small.
- Use `prisma.$transaction([ ... ])` with `createMany` or batched `create` calls.
- For `copy-week`, collect all new shift objects and insert them in one `createMany`.
- For upload, process each sheet type in a single transaction.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` ranked finding HIGH-3.

### 5. Bound date ranges and payload sizes

- Cap dashboard date ranges (e.g., max 90 days for coverage and agency).
- Reject requests with a date range larger than the cap; return `400` with a clear message.
- Limit the number of included relations per query; split into multiple targeted queries if needed.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` section 4.1 and MEDIUM-3.

### 6. Avoid N+1 queries

- Use `include` or `select` to fetch related data in the same query when the relation is one-to-one or few-to-one.
- Do not load a list of IDs and then query each related record in a loop.
- For parent-entity roll-ups, prefer a single query with `groupBy`/`_sum` over one query per child.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` ranked finding CRIT-2.

### 7. Profile before over-optimizing

- If you add an index, write down the query pattern it supports and the expected cardinality.
- If you pre-compute data (e.g., coverage snapshots), document the invalidation trigger.
- Do not add caching before measuring the bottleneck.

---

## Coding patterns

### Next.js App Router

- Server components are the default for read-only pages. Fetch data from the backend service, not directly from the database.
- Next.js `src/app/api` routes should be thin BFF/gateway routes that forward to the backend. Do not add new routes that query Prisma or contain business logic.
- Use `loading.tsx` and `error.tsx` conventions where appropriate.
- Client components must be marked with `'use client'`; keep their data-fetch logic minimal and call backend APIs through the Next.js BFF or directly if CORS/auth allows.

### Backend service

- All domain logic, DB access, aggregation, and bulk operations live in the backend service (NestJS or FastAPI).
- Define API contracts in the backend. Next.js consumes those contracts.
- Validate every request body, query param, and route param before touching the database.
- Enforce RBAC and entity scoping in the backend; do not rely on the frontend or Next.js BFF for authorization.
- Use service/repository layers. Do not put business logic directly in HTTP handlers.

### Prisma

- Prisma is a **backend-only** dependency. Next.js must not import `prisma` or any Prisma-generated types.
- In the backend service, use a single PrismaClient instance. Do not create `new PrismaClient()` anywhere.
- Use explicit `select` or `include` to avoid over-fetching. Do not return full Prisma objects to the client if only a few fields are needed.
- Use `where: { entityId: { in: accessibleIds } }` only when `accessibleIds` is non-null. For admins, omit the `entityId` filter entirely.
- Prefer `findUnique` for single-record lookups; `findFirst` is acceptable when the query is not on a unique key.
- Use `prisma.$transaction` for multi-step writes that must succeed or fail together.

### Zod schemas / Pydantic models

- Define a validation schema for every route body, query params, and form submission.
- In NestJS, use DTOs + class-validator. In FastAPI, use Pydantic models.
- Coerce dates where needed: `z.string().date()` or `z.coerce.date()` depending on language and input source.
- Reject empty strings for required IDs: `z.string().min(1)`.
- Return the first error message: `return NextResponse.json({ error: err.errors[0].message }, { status: 400 })` (Next.js) or the framework-equivalent `400` response from the backend.

### Form handling

- Use `react-hook-form` with `@hookform/resolvers` for client forms.
- The validation schema should live near the backend route so the server and client can share it (place in a shared package or copy with a comment noting the source of truth).
- On submit, call the backend API via the Next.js BFF; do not mutate Prisma from the client or from Next.js.

### Error handling

- Always wrap backend handlers in `try/catch` if they call Prisma or perform complex logic.
- Distinguish:
  - `401` — not authenticated
  - `403` — authenticated but not authorized for this entity/action
  - `400` — bad input (Zod/Pydantic or business rule)
  - `404` — record not found
  - `500` — unexpected server error
- Use `console.error(err)` for observability; return only a generic message to the client.

### Drag-and-drop and client state

- `@dnd-kit` is used for shift scheduling UI. Keep the drag state local to the component.
- After a successful drop, call the backend API (via the Next.js BFF) to persist the change; do not optimistically update the server without a rollback plan.
- If the UI needs real-time shift data, re-fetch or use a server-side revalidation strategy; do not mirror the full shift table in React state.

---

*For maintenance and doc-sync rules, see `docs/llm-framework/MAINTENANCE.md`.*
