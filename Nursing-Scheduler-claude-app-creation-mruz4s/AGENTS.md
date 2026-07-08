# Nursing Scheduler — Agent Guidance

**Last reviewed:** 2026-07-09

This file is a self-contained mirror of the core rules in `CLAUDE.md`. Tools that read `AGENTS.md` should follow the same guidance. For deeper context, also load the relevant topic doc when needed.

- Architecture decisions: `docs/llm-framework/ARCHITECTURE.md`
- Security, performance, and coding playbooks: `docs/llm-framework/PLAYBOOKS.md`
- How to keep these docs in sync: `docs/llm-framework/MAINTENANCE.md`
- Scalability findings: `docs/SCALABILITY_CRITIQUE.md`
- Migration spec: `docs/specs/2026-07-09-fastify-monorepo-migration.md`

## Project identity & V1 scope

- Nursing Scheduler for shift planning, coverage tracking, and budget management across a hierarchy of entities (facilities / regions).
- Stack: **pnpm workspaces**, **React + Vite** (frontend), **Fastify + TypeScript** (backend), **Prisma 7.8**, **PostgreSQL 15**, **Azure** (App Service / Container Apps / Static Web Apps / PostgreSQL Flexible Server), **Redis**, **BullMQ**, **Zod**.
- Data model: `User`, `Entity` (self-referencing hierarchy), `Area`, `Employee`, `Shift`, `StaffingRequirement`, `RateCard`, `BudgetTarget`, `TimeOff`, `RecurringAssignment`, `UserEntityAssignment`.
- Business logic: coverage is time-overlap based; paid hours deduct 30 min for shifts ≥ 8h; budget converts to a weekly base then scales to the requested period; parent entities aggregate sub-entity totals.

## Non-negotiables

1. **RBAC is enforced server-side.**
   - Every Fastify route and React protected route must verify the session before reading or writing data. Middleware only enforces authentication, not authorization.
   - In Fastify routes, call `request.requireAuth()` before any work. Use `request.requireRole([...])` for admin/manager gates.
   - In React, use a `ProtectedRoute` component that reads the current user from `GET /api/auth/me` before rendering the page.
   - Roles are `ADMIN`, `MANAGER`, `VIEWER`. Admins see all entities; non-admins see only the entities in their JWT session (`user.entityIds`).
   - Never rely on a route parameter alone to authorize access.

2. **Entity scoping is mandatory.**
   - Use `request.canAccessEntity(entityId)` or `request.getAccessibleEntityIds()` before querying data.
   - For single-resource mutations, load the record first, then call `request.canAccessEntity(existing.entityId)`.
   - If a user is an admin, `request.getAccessibleEntityIds()` returns `null` (meaning all entities); do not interpret `null` as "no access."

3. **Zod validates every API boundary.**
   - Every `POST`, `PATCH`, `PUT` body must be parsed with a Zod schema before touching Prisma.
   - Query params (`entityId`, `startDate`, `endDate`, etc.) should also be validated or coerced; do not pass raw strings into `where` clauses.
   - Return `400` on Zod failures with a clear message, not `500`.

4. **Migrations are forward-only.**
   - Never edit a deployed Prisma migration file. If a migration is broken, create a new migration that fixes it.
   - Avoid destructive migrations (column drops, table drops) in releases that still have active traffic. Prefer additive changes and deprecate old fields.
   - Production deploys run `prisma migrate deploy` from `packages/db`.

5. **Never trust client entity IDs.**
   - `entityId`, `areaId`, `employeeId`, and `userId` sent from the client must be validated against the user's accessible entity set before use.
   - Do not expose internal IDs (e.g., CUIDs) in URLs unless they are also scoped to the user's access.

6. **React + Vite does not touch the database.**
   - `apps/web` is the UI layer only. It calls the Fastify backend (`apps/api`); it does not import `prisma`, `@nursing/db`, or `@prisma/client` and does not query PostgreSQL directly.
   - All domain logic, aggregation, bulk operations, and migrations live in the Fastify backend.
   - Do not create new `src/app/api/**/route.ts` files or any other backend gateway inside the React frontend.

7. **Next.js is no longer the primary stack.**
   - The Next.js app only exists in `apps/legacy` during the strangler-fig migration. Do not add new Next.js API routes, server components, or database access.
   - New UI work goes to `apps/web` (React + Vite). New backend work goes to `apps/api` (Fastify).

## Stack rules of thumb

- `apps/web` uses **React Router DOM** for routing. Pages live in `src/pages/`. No file-based routing.
- The frontend calls `apps/api` through an Axios instance configured with `withCredentials: true` so the HttpOnly JWT cookie is sent automatically.
- Use **TanStack Query (React Query)** for server-state caching. Do not mirror full backend data in React state.
- `apps/web` does not import backend-only packages (`@nursing/db`, `@prisma/client`) or internal backend paths. Shared code lives in `packages/shared` only.
- In the Fastify backend, use the single PrismaClient instance provided by `packages/db`. Do not instantiate new `PrismaClient` instances.
- Use `date-fns` for date math; use `apps/api/src/lib/hours.ts` for raw/paid-hour calculations and the `4.33` weeks/month factor.
- Tailwind + `class-variance-authority` + `clsx`/`tailwind-merge` for UI components. Keep components presentational; business logic belongs in `apps/api` services.
- Use Zod object schemas, not `as` casts or `any`.

## Data model red lines

- **Parent entities are containers.** Do not attach shifts, rate cards, or budget targets directly to a `PARENT` entity. Parent totals are computed from their sub-entities.
- **Only schedulable entities have areas.** A `STANDALONE` entity can have areas and shifts; a `PARENT` entity aggregates sub-entities.
- **Hours vs. paid hours:** `rawHours` is used for coverage and scheduling; `paidHours` is used only for dollar-cost calculation.
- **Rate cards are 1:1 with entity.** Match `role` (`RN`/`LPN`) × `employmentType` (`STAFF`/`AGENCY`) to the correct column.
- **Budget basis conversion:** normalize budget targets to a weekly rate using `toWeeklyRate`, then multiply by the requested period (`weekly`, `pay-period`, `monthly`, `quarterly`, `yearly`).

## When to escalate

Escalate to a human or a dedicated planning session before making any of these changes:

- Adding a new entity type or changing the `EntityType` enum.
- Modifying the `Shift` data model or adding new shift states.
- Removing or renaming fields in `User`, `Entity`, or `Employee`.
- Changing the rate-card or budget math.
- Introducing a background worker, message queue, cache, or read replica.
- Any schema migration that drops a column, changes a column type, or renames a table.
- Changing the auth cookie/session strategy or JWT shape.
- Modifying the monorepo package layout or workspace boundaries.

## Performance guardrails (derived from `docs/SCALABILITY_CRITIQUE.md`)

- Add `take`/`skip` to every list endpoint; default page size should be 100–500 depending on the entity.
- Use composite indexes when querying by two or more columns, especially on `Shift`.
- Use `createMany` and `$transaction` for bulk writes instead of sequential `create` loops.
- Prefer DB aggregation (`groupBy`, `_sum`, `_count`) over loading rows and summing in JavaScript.
- Do not load unbounded date ranges in dashboard or coverage endpoints; cap the maximum range and paginate.
- For very large uploads or heavy rollups, use BullMQ workers backed by Redis.

## Security & RBAC quick reference

- Fastify auth is implemented as a plugin in `apps/api/src/plugins/auth.ts`. It reads the `access_token` HttpOnly cookie set by `POST /api/auth/login` and exposes helpers on the `request` object:
  - `request.user` — decoded JWT payload (may be undefined).
  - `request.requireAuth()` — returns `AuthUser` or throws `401`.
  - `request.requireRole(['ADMIN' | 'MANAGER' | 'VIEWER'])` — returns `AuthUser` or throws `403`.
  - `request.canAccessEntity(entityId)` — `true` if the user is admin or the entity is in their assigned list.
  - `request.getAccessibleEntityIds()` — returns `null` for admin (all entities) or the user's assigned entity IDs.
- Fastify routes must return JSON `401`/`403` responses; do not redirect.
- The React frontend never stores the JWT in `localStorage` or `sessionStorage`. The cookie is HttpOnly and managed by the Fastify backend.
- Legacy Next.js API routes (`GET /api/rates/[entityId]`, `GET/PATCH /api/employees/[id]`, `PATCH/DELETE /api/areas/[id]`, `DELETE /api/requirements/[id]`) currently have entity-scoping gaps. Do not replicate those patterns in Fastify; fix them when migrating those routes.

## Maintenance process

- If you change auth, entity hierarchy, migrations, rate/budget logic, or an API contract, update the relevant LLM doc.
- If the same pattern is touched 2–3 times without doc updates, update the doc before the next feature (three-touch rule).
- Review `AGENTS.md` and `CLAUDE.md` quarterly; move detail to `ARCHITECTURE.md` or `PLAYBOOKS.md` and keep root files compact.
- Update the `Last reviewed:` date in every file you change.
- See `docs/llm-framework/MAINTENANCE.md` for the full process.
