# Nursing Scheduler — LLM Guidance

**Last reviewed:** 2026-07-07

This file is auto-loaded by Claude Code / Kimi Code. Keep it compact. For deeper context, load the relevant topic doc:

- Architecture decisions: `docs/llm-framework/ARCHITECTURE.md`
- Security, performance, and coding playbooks: `docs/llm-framework/PLAYBOOKS.md`
- How to keep these docs in sync: `docs/llm-framework/MAINTENANCE.md`
- Scalability findings that became guardrails: `docs/SCALABILITY_CRITIQUE.md`

## Project identity & V1 scope

- Nursing Scheduler for shift planning, coverage tracking, and budget management across a hierarchy of entities (facilities / regions).
- Stack: Next.js 14 App Router, TypeScript strict, Tailwind CSS, NextAuth.js v4 CredentialsProvider + JWT 8h, Prisma 7.8, PostgreSQL 15, Azure App Service B2, Azure PostgreSQL Flexible Server Standard_B1ms, Recharts, `@dnd-kit`, `xlsx`, `date-fns`, Zod.
- Data model: `User`, `Entity` (self-referencing hierarchy), `Area`, `Employee`, `Shift`, `StaffingRequirement`, `RateCard`, `BudgetTarget`, `TimeOff`, `RecurringAssignment`, `UserEntityAssignment`.
- Business logic: coverage is time-overlap based; paid hours deduct 30 min for shifts ≥ 8h; budget converts to a weekly base then scales to the requested period; parent entities aggregate sub-entity totals.

## Non-negotiables

1. **RBAC is enforced server-side.**
   - Every page, API route, and server action must verify the session before reading or writing data. Middleware only enforces authentication, not authorization (`src/middleware.ts:1–13`).
   - Roles are `ADMIN`, `MANAGER`, `VIEWER`. Admins see all entities; non-admins see only the entities in their JWT session (`session.user.entityIds`).
   - Never rely on a route parameter alone to authorize access.

2. **Entity scoping is mandatory.**
   - Use `canAccessEntity(session, entityId)` or `getAccessibleEntityIds(session)` before querying data.
   - For single-resource mutations, load the record first, then call `canAccessEntity(session, existing.entityId)`.
   - If a user is an admin, `getAccessibleEntityIds` returns `null` (meaning all entities); do not interpret `null` as "no access."

3. **Zod validates every API boundary.**
   - Every `POST`, `PATCH`, `PUT` body must be parsed with a Zod schema before touching Prisma.
   - Query params (`entityId`, `startDate`, `endDate`, etc.) should also be validated or coerced; do not pass raw strings into `where` clauses.
   - Return `400` on Zod failures with a clear message, not `500`.

4. **Migrations are forward-only.**
   - Never edit a deployed Prisma migration file. If a migration is broken, create a new migration that fixes it.
   - Avoid destructive migrations (column drops, table drops) in releases that still have active traffic. Prefer additive changes and deprecate old fields.
   - Production deploys run `prisma migrate deploy` (`package.json:11`).

5. **Never trust client entity IDs.**
   - `entityId`, `areaId`, `employeeId`, and `userId` sent from the client must be validated against the user's accessible entity set before use.
   - Do not expose internal IDs (e.g., CUIDs) in URLs unless they are also scoped to the user's access.

## Stack rules of thumb

- Prefer **server components** for read-only data; use **API routes** for mutations, bulk operations, and client-side polling.
- Prisma singleton is exported from `src/lib/prisma.ts`. Do not instantiate new `PrismaClient` instances.
- Use `date-fns` for date math; use `src/lib/hours.ts` for raw/paid-hour calculations and the `4.33` weeks/month factor.
- Tailwind + `class-variance-authority` + `clsx`/`tailwind-merge` for UI components. Keep components presentational; business logic belongs in `src/lib/` or API routes.
- Zod 4.x is installed. Use `z.object(...)` schemas, not `as` casts or `any`.

## Data model red lines

- **Parent entities are containers.** Do not attach shifts, rate cards, or budget targets directly to a `PARENT` entity. Parent totals are computed from their sub-entities.
- **Only schedulable entities have areas.** A `STANDALONE` entity can have areas and shifts; a `PARENT` entity aggregates sub-entities.
- **Hours vs. paid hours:** `rawHours` is used for coverage and scheduling; `paidHours` is used only for dollar-cost calculation (`src/lib/hours.ts:22–45`).
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

## Performance guardrails (derived from `docs/SCALABILITY_CRITIQUE.md`)

- Add `take`/`skip` to every list endpoint; default page size should be 100–500 depending on the entity.
- Use composite indexes when querying by two or more columns, especially on `Shift`.
- Use `createMany` and `$transaction` for bulk writes instead of sequential `create` loops.
- Prefer DB aggregation (`groupBy`, `_sum`, `_count`) over loading rows and summing in JavaScript.
- Do not load unbounded date ranges in dashboard or coverage endpoints; cap the maximum range and paginate.

## Security & RBAC quick reference

- `requireAuth()` / `requireAdmin()` / `requireManagerOrAdmin()` are for **server components** and redirect on failure. Do not use them inside API routes.
- In API routes, use `getServerSession(authOptions)` and return `401`/`403` JSON responses.
- `assertEntityAccess` throws a generic `Error`; wrap it in API routes and translate to `403`.
- `GET /api/rates/[entityId]`, `GET/PATCH /api/employees/[id]`, `PATCH/DELETE /api/areas/[id]`, and `DELETE /api/requirements/[id]` currently have entity-scoping gaps. Do not replicate those patterns; fix them when touching those files.

## Maintenance process

- If you change auth, entity hierarchy, migrations, rate/budget logic, or an API contract, update the relevant LLM doc.
- If the same pattern is touched 2–3 times without doc updates, update the doc before the next feature (three-touch rule).
- Review `CLAUDE.md` quarterly; move detail to `ARCHITECTURE.md` or `PLAYBOOKS.md` and keep this file under 400 lines.
- Update the `Last reviewed:` date in every file you change.
- See `docs/llm-framework/MAINTENANCE.md` for the full process.
