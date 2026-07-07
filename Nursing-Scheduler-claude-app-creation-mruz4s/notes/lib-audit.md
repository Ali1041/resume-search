# Library Audit — Nursing Scheduler

## `getAccessibleEntityIds()` (`src/lib/permissions.ts`, lines 36–39)

```ts
export function getAccessibleEntityIds(session: any): string[] | null {
  if (session.user.role === 'ADMIN') return null // null = all entities
  return session.user.entityIds as string[]
}
```

- **Behavior:**
  - Returns `null` when the user has the `ADMIN` role; callers must interpret `null` as "access to all entities."
  - For non-admin users (`MANAGER` / `VIEWER`), returns `session.user.entityIds` as a `string[]`.
- **Data source:** The `entityIds` array is injected into the session by the NextAuth `session` callback (assumed to be in `src/lib/auth.ts`, not audited here).
- **Coupling:** Callers must explicitly branch on `null` versus an array when building Prisma `where` clauses; this is a common source of bugs if a caller forgets the admin case and filters by `IN []`.

## `canAccessEntity()` (`src/lib/permissions.ts`, lines 25–28)

```ts
export function canAccessEntity(session: any, entityId: string): boolean {
  if (session.user.role === 'ADMIN') return true
  return (session.user.entityIds as string[]).includes(entityId)
}
```

- **Behavior:**
  - Admins always pass.
  - Non-admins pass only if `entityId` is present in `session.user.entityIds`.
- **Runtime note:** Uses loose `any` typing for `session`; no compile-time guarantee that `entityIds` exists.

## `assertEntityAccess()` (`src/lib/permissions.ts`, lines 30–34)

```ts
export function assertEntityAccess(session: any, entityId: string) {
  if (!canAccessEntity(session, entityId)) {
    throw new Error('Access denied to entity')
  }
}
```

- **Behavior:** Thin wrapper around `canAccessEntity()` that throws a generic `Error` on denial.
- **Observations:**
  - Throws a plain `Error`, not an HTTP-specific error, so callers must catch and translate for API routes / server actions.
  - Does not distinguish between "not authenticated" and "authenticated but no entity access."

## Auth Helpers (`src/lib/permissions.ts`, lines 7–23)

- `requireAuth()` (lines 7–11): Uses `getServerSession(authOptions)`; redirects to `/login` if no session.
- `requireAdmin()` (lines 13–17): Calls `requireAuth()`; redirects to `/dashboard` if role is not `ADMIN`.
- `requireManagerOrAdmin()` (lines 19–23): Calls `requireAuth()`; redirects to `/dashboard` if role is `VIEWER`.
- All three are **server-side only** because they rely on `next-auth`'s server session helper.

## Raw / Paid Hours Computation (`src/lib/hours.ts`)

### `rawHours(startTime, endTime)` (`src/lib/hours.ts`, lines 22–27)

```ts
export function rawHours(startTime: string, endTime: string): number {
  const startMin = parseTimeToMinutes(startTime)
  let endMin = parseTimeToMinutes(endTime)
  if (endMin <= startMin) endMin += 24 * 60 // overnight
  return minutesToHours(endMin - startMin)
}
```

- **What it computes:** Actual clock duration in hours.
- **Overnight handling:** When `endTime <= startTime`, adds 24 hours (1,440 minutes) to `endMin`.
- **Usage:** Used everywhere except dollar-cost calculation.

### `paidHours(startTime, endTime)` (`src/lib/hours.ts`, lines 34–38)

```ts
export function paidHours(startTime: string, endTime: string): number {
  const raw = rawHours(startTime, endTime)
  if (raw >= 8) return raw - 0.5
  return raw
}
```

- **What it computes:** Paid duration, used **only** for dollar cost.
- **Break rule:** Deducts a 30-minute unpaid lunch for shifts of 8 hours or more.
- **Explicitly not deducted:** 15-minute breaks at 12+ hours are paid (documented in comment at lines 32–33).

### `shiftCost(startTime, endTime, hourlyRate)` (`src/lib/hours.ts`, lines 43–45)

```ts
export function shiftCost(startTime: string, endTime: string, hourlyRate: number): number {
  return paidHours(startTime, endTime) * hourlyRate
}
```

- **Formula:** `paidHours × hourlyRate`.
- **Rate source:** RateCard values (`rnStaff`, `rnAgency`, `lpnStaff`, `lpnAgency`) matched by employee role and employment type.

### Supporting utilities (`src/lib/hours.ts`)

- `parseTimeToMinutes(time)` (lines 9–12): Splits `"HH:MM"` string and returns total minutes.
- `minutesToHours(minutes)` (lines 14–16): Divides by 60.
- `coveredMinutes(...)` (lines 78–95): Computes overlap minutes between a shift and a required time span; handles overnight.
- `weeklyToMonthly(weekly)` (lines 52–54): Uses `4.33` weeks/month factor.
- `weeklyToPeriod(weekly, period)` (lines 56–64): Converts weekly value to pay-period, monthly, quarterly, or yearly.
- `toWeeklyRate(value, basis)` (lines 69–72): Normalizes a budget entry to a weekly rate.
- `OVERTIME_THRESHOLD = 40` (line 100): Raw-hour threshold for overtime; no logic was present in the audited file that actually consumes it.

## Prisma Connection Handling (`src/lib/prisma.ts`, lines 1–13)

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- **Pattern:** Standard Next.js singleton to avoid exhausting the connection pool during hot reload in development.
- **Production behavior:** In production, the same `PrismaClient` instance is created once per Node process and reused; `globalForPrisma` is **not** used.
- **Logging:**
  - Development: logs `query`, `error`, and `warn`.
  - Production: logs only `error`.
- **Connection string:** Pulled from `DATABASE_URL` via `datasource db` in `prisma/schema.prisma` (line 7).
- **No explicit pool configuration:** `connection_limit` and `pool_timeout` are not set here or in the schema; defaults to Prisma/PostgreSQL defaults.
- **Scaling concern:** At 50k+ shifts/month with heavy dashboard aggregation, the default connection pool may become a bottleneck; consider tuning `connection_limit` or using a PgBouncer-compatible `DATABASE_URL` (with `pgbouncer=true`) if deployed behind a connection pooler.

## Middleware Auth Enforcement (`src/middleware.ts`, lines 1–13)

```ts
export { default } from 'next-auth/middleware'

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/schedule/:path*',
    '/employees/:path*',
    '/budget/:path*',
    '/agency/:path*',
    '/upload/:path*',
    '/admin/:path*',
  ],
}
```

- **What it does:** Re-exports the default `next-auth/middleware`, which checks for a valid session cookie and redirects unauthenticated requests to the sign-in page.
- **Protected routes:**
  - `/dashboard/*`
  - `/schedule/*`
  - `/employees/*`
  - `/budget/*`
  - `/agency/*`
  - `/upload/*`
  - `/admin/*`
- **What it does NOT do:**
  - It does **not** enforce role-based access control (ADMIN / MANAGER / VIEWER).
  - It does **not** enforce entity-level access control (`canAccessEntity` / `getAccessibleEntityIds`).
  - It does **not** protect API routes under `/api/*` unless they are explicitly added to the matcher.
- **Authorization gap:** Any authenticated user can navigate to any protected page; fine-grained authorization must be enforced inside page components, server actions, and API route handlers.

## Note

This audit is documentation-only. No schema or application code was modified.
