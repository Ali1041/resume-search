# Nursing Scheduler — LLM Playbooks

**Last reviewed:** 2026-07-09

**Load this file when:** you are writing or reviewing code that touches auth, entity scoping, Prisma queries, API routes, or UI components. For architecture context, see `docs/llm-framework/ARCHITECTURE.md`. For the migration plan that produced this framework, see `docs/specs/2026-07-09-fastify-monorepo-migration.md`.

---

## Security & RBAC playbook

### 1. Verify the session first

- In Fastify routes, call `request.requireAuth()` before any database query. It returns the decoded `AuthUser` or throws `UnauthorizedError` (mapped to `401`).
- Use `request.requireRole(['ADMIN'])`, `request.requireRole(['ADMIN', 'MANAGER'])`, etc., for role gates. It throws `ForbiddenError` (mapped to `403`) on failure.
- In React, use a `ProtectedRoute` component that reads the current user from `GET /api/auth/me` and redirects to `/login` on 401.
- **Do not** redirect from Fastify API routes; return JSON status codes.

### 2. Enforce entity access before reading or writing

- Use `request.canAccessEntity(entityId)` for explicit entity IDs from query params or body.
- Use `request.getAccessibleEntityIds()` to build `IN` lists. Remember it returns `null` for admins, which means all entities, not none.
- For single-resource routes, load the record first, then check `request.canAccessEntity(existing.entityId)`.

### 3. Validate the role gate

- `ADMIN`: can do everything, including user/entity management and budget/rate targets.
- `MANAGER`: can schedule shifts, manage employees/areas/requirements, and upload schedules.
- `VIEWER`: read-only. No writes.
- If a route should be admin-only, use `request.requireRole(['ADMIN'])`. Do not rely on a feature name or URL path.

### 4. Sanitize IDs from the client

- Treat `entityId`, `areaId`, `employeeId`, `userId`, and route params (`id`) as untrusted until validated.
- Use Zod for body/query params. Use `z.string().cuid()` or `z.string().min(1)` as appropriate.
- Never forward a client-provided ID into a `where` clause without an entity-access check.

### 5. Do not expose internal data in errors

- Return generic `500` messages to the client: `{ error: 'Server error' }`.
- Log the full error with the Fastify logger for debugging.
- Do not return Prisma error messages, stack traces, or raw SQL to the client.

### 6. Fix known scoping gaps, do not replicate them

- The legacy Next.js routes `GET /api/rates/[entityId]`, `GET/PATCH /api/employees/[id]`, `PATCH/DELETE /api/areas/[id]`, and `DELETE /api/requirements/[id]` currently lack entity scoping (CRIT-1). Migrate them to Fastify and add the check there.
- `POST /api/upload` in the legacy app resolves entities from uploaded spreadsheets but does not verify the caller can access those entities (CRIT-3). When migrating upload to Fastify, validate every resolved `entityId` with `request.canAccessEntity(entityId)`.
- Do not add new Next.js routes that query the database. New routes must be added to `apps/api`.

### 7. Validate uploads before parsing

- Enforce max file size (e.g., 10 MB), allowed content types (`multipart/form-data`), and row-count limits (e.g., 5,000 rows) before reading a spreadsheet into memory.
- Validate every entity referenced inside the file against the caller's accessible entity set before writing or previewing.
- Use `prisma.$transaction` with `createMany` for bulk writes; for very large uploads, queue a BullMQ job.
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
- Example: budget rollups should group shifts by `(entityId, employee.role, employee.employmentType)` and sum paid hours directly in SQL where possible.
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
- For upload, process each sheet type in a single transaction or queue a worker.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` ranked finding HIGH-3.

### 5. Bound date ranges and payload sizes

- Cap dashboard date ranges (e.g., max 31 days for coverage).
- Reject requests with a date range larger than the cap; return `400` with a clear message.
- Limit the number of included relations per query; split into multiple targeted queries if needed.
- **Map to finding:** `docs/SCALABILITY_CRITIQUE.md` section 4.1 and **MED-4**.

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

### React + Vite frontend

- `apps/web` is a React SPA built with Vite. Pages live in `src/pages/` and are routed with `react-router-dom`.
- Fetch data from the Fastify backend using the typed Axios client in `src/lib/api.ts` (`withCredentials: true`).
- Use **TanStack Query (React Query)** for server-state caching, invalidation, and polling. Do not mirror the full backend dataset in React state.
- Components are presentational. Business logic belongs in `apps/api` services.
- `apps/web` must never import `@nursing/db`, `@prisma/client`, or any backend-only package. Shared code comes from `packages/shared` only.
- Use `react-hook-form` with `@hookform/resolvers` for forms. Submit to the Fastify backend, not to Prisma.

### Fastify backend

- All domain logic, DB access, aggregation, and bulk operations live in `apps/api`.
- Define API contracts in `packages/shared`. Both `apps/web` and `apps/api` consume them.
- Validate every request body, query param, and route param before touching the database.
- Enforce RBAC and entity scoping in `apps/api`; do not rely on the frontend for authorization.
- Use service/repository layers. Do not put business logic directly in HTTP handlers.
- Register cross-cutting concerns as Fastify plugins: auth (`apps/api/src/plugins/auth.ts`), error handling (`apps/api/src/plugins/errorHandler.ts`), Prisma (`apps/api/src/plugins/prisma.ts`), CORS, cookie, JWT, multipart, rate-limit, swagger.

### Fastify service/repository pattern

```ts
// apps/api/src/repositories/shiftRepository.ts
import { PrismaClient } from '@nursing/db'

export class ShiftRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.shift.findUnique({ where: { id } })
  }

  async list(session: AuthUser, query: ShiftListQuery) {
    const where = buildWhere(session, query)
    const skip = (query.page - 1) * query.pageSize
    const [data, total] = await Promise.all([
      this.prisma.shift.findMany({ where, skip, take: query.pageSize }),
      this.prisma.shift.count({ where }),
    ])
    return { data, pagination: { page: query.page, pageSize: query.pageSize, total, hasNext: query.page * query.pageSize < total } }
  }
}
```

```ts
// apps/api/src/services/shiftService.ts
import { AuthUser } from '@nursing/shared'
import { ShiftRepository } from '../repositories/shiftRepository'
import { canAccessEntity, ForbiddenError } from '../lib/auth'

export class ShiftService {
  constructor(private readonly repo: ShiftRepository) {}

  async create(session: AuthUser, input: CreateShiftInput) {
    if (!canAccessEntity(session, input.entityId)) throw new ForbiddenError()
    return this.repo.create(input)
  }
}
```

```ts
// apps/api/src/routes/shifts.ts
import { FastifyInstance } from 'fastify'
import { createShiftSchema } from '@nursing/shared'
import { ShiftService } from '../services/shiftService'
import { ShiftRepository } from '../repositories/shiftRepository'

export async function shiftRoutes(app: FastifyInstance) {
  const service = new ShiftService(new ShiftRepository(app.prisma))

  app.get('/', async (request, reply) => {
    const session = request.requireAuth()
    const query = parseShiftQuery(request.query)
    return service.list(session, query)
  })

  app.post('/', async (request, reply) => {
    const session = request.requireAuth()
    const data = createShiftSchema.parse(request.body)
    const shift = await service.create(session, data)
    return reply.status(201).send(shift)
  })
}
```

### Prisma

- Prisma is a **backend-only** dependency. `apps/web` must not import `prisma`, `@nursing/db`, or any Prisma-generated types.
- In `apps/api`, use the single PrismaClient instance from `packages/db`. Do not create `new PrismaClient()` anywhere.
- Use explicit `select` or `include` to avoid over-fetching. Do not return full Prisma objects to the client if only a few fields are needed.
- Use `where: { entityId: { in: accessibleIds } }` only when `accessibleIds` is non-null. For admins, omit the `entityId` filter entirely.
- Prefer `findUnique` for single-record lookups; `findFirst` is acceptable when the query is not on a unique key.
- Use `prisma.$transaction` for multi-step writes that must succeed or fail together.
- Migrations and the Prisma schema live in `packages/db`. Run Prisma commands from that package (`pnpm --filter db ...`).

### Zod schemas

- Define a validation schema for every route body, query params, and form submission in `packages/shared`.
- Reject empty strings for required IDs: `z.string().min(1)`.
- Coerce dates where needed: `z.string().date()` for HTTP inputs; `z.coerce.date()` where appropriate.
- Return the first error message from the Fastify error handler: `reply.status(400).send({ error: err.errors[0]?.message ?? 'Validation failed' })`.
- The frontend should use the same schema from `packages/shared` with `react-hook-form` resolvers so client and server cannot drift.

### Form handling

- Use `react-hook-form` with `@hookform/resolvers` for client forms.
- The validation schema source of truth is `packages/shared`.
- On submit, call the Fastify backend via the Axios client; do not mutate Prisma from the client or from the frontend.

### Error handling

- Fastify routes should not wrap every call in `try/catch` because the error handler plugin in `apps/api/src/plugins/errorHandler.ts` does this globally. It maps:
  - Zod errors → `400`
  - `UnauthorizedError` → `401`
  - `ForbiddenError` → `403`
  - Prisma `P2025` → `404`
  - everything else → `500`
- Use `console.error(err)` or `request.log.error(err)` for observability; return only a generic message to the client.

### Authentication

- The Fastify backend sets an `HttpOnly`, `Secure` (controlled by `COOKIE_SECURE=true`), `SameSite=Lax` cookie named `access_token` on `POST /api/auth/login`.
- The React frontend sends the cookie automatically via the Axios client with `withCredentials: true`.
- `POST /api/auth/logout` clears the cookie.
- `GET /api/auth/me` returns the decoded user or `401` if unauthenticated.
- The frontend uses this endpoint in a `useAuth()` hook and a `ProtectedRoute` component.
- Do not store the JWT in `localStorage` or `sessionStorage`.
- Apply per-IP rate limits to `/login` and `/register` (e.g., 5 attempts per 15 minutes) to mitigate brute force.
- The auth plugin rejects tokens for users whose status is not `ACTIVE`.

### Security headers

- Register `@fastify/helmet` in `apps/api/src/index.ts` with a CSP appropriate for the React SPA.
- Enable HSTS in production (`process.env.NODE_ENV === 'production'`).
- Disable or gate Swagger UI in production (`/docs` should not be public).

### Upload handling

- Use `@fastify/multipart` with a file size limit (e.g., 10 MB) in `apps/api/src/index.ts`.
- In the upload route, validate the content type, file extension (`.xlsx`, `.csv`), and cap rows (e.g., 5,000).
- Resolve entity codes to IDs, then validate each ID with `request.canAccessEntity(entityId)` before writing or previewing.
- Use `prisma.$transaction` with `createMany` for bulk writes. For very large files, queue a BullMQ job and return an upload ID.

### Drag-and-drop and client state

- `@dnd-kit` is used for shift scheduling UI. Keep the drag state local to the component.
- After a successful drop, call the Fastify backend API to persist the change; do not optimistically update the server without a rollback plan.
- Re-fetch or use TanStack Query invalidation to refresh shift data; do not mirror the full shift table in React state.

---

## Testing

### Backend tests

- Use **integration tests with a real PostgreSQL test database**. Do not use in-memory stubs for repositories; they give poor confidence for Prisma queries and migrations.
- Use `testcontainers` or a dedicated `nursing_scheduler_test` database. Run `prisma migrate deploy` against the test database before each test run.
- Wrap each test in a transaction that rolls back, or use `prisma.$disconnect()` and re-migrate between test files. Prefer transaction rollback for speed.
- Create `apps/api/src/test/buildApp.ts` that builds the Fastify app with the test database URL and returns `app` for testing.
- Every route must have tests for:
  - Auth: `401` when unauthenticated, `403` when unauthorized.
  - Entity scoping: users cannot access records outside their assigned entities.
  - Pagination: list endpoints return `{ data, pagination }`.
  - Validation: Zod failures return `400` with clear messages.
  - Business logic: budget and coverage calculations match the legacy `apps/api/src/lib/hours.ts` logic.

### Frontend tests

- Use **Vitest + React Testing Library** for component behavior.
- Mock the API client (`apps/web/src/lib/api.ts`) with MSW or a simple mock.
- Do not call the real backend in unit tests.
- Test `ProtectedRoute` behavior for each role.

### End-to-end tests

- After migration, run a full smoke test against the deployed stack:
  - `login → create entity → create area → create employee → create shift → view budget → view coverage → logout`.

---

*For maintenance and doc-sync rules, see `docs/llm-framework/MAINTENANCE.md`.*
