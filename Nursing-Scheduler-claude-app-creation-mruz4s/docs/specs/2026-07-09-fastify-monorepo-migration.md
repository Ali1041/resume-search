# Nursing Scheduler — Fastify Monorepo Migration Spec

**Date:** 2026-07-09  
**Project:** Nursing Scheduler V1  
**Scope:** Documentation-only spec for migrating from a single Next.js app to a pnpm-workspace monorepo with a Fastify backend and React + Vite frontend.  
**Status:** Draft — reviewed for executability, not executed  
**Owner:** AI-assisted engineering team

---

## 0. Important execution note

This spec is a detailed, reviewed plan, **not a guarantee of a flawless first execution**. Real migrations like this always surface environment-specific issues (pnpm hoisting, TypeScript references, Prisma client generation, CORS/cookie quirks, UI component ports, etc.).

When executing, treat this document as the authoritative starting point, but **expect to iterate**. For every decision not explicitly covered here, use the current LLM framework docs as the source of truth:

- `CLAUDE.md` and `AGENTS.md` for non-negotiables and daily rules.
- `docs/llm-framework/ARCHITECTURE.md` for structure and boundaries.
- `docs/llm-framework/PLAYBOOKS.md` for auth, validation, error handling, performance, and security patterns.
- `docs/llm-framework/MAINTENANCE.md` for when to update the docs.

If you change the stack, the architecture, or any non-negotiable during execution, update the relevant LLM framework doc **before** continuing. Do not let the spec and the framework drift apart.

---

## 1. Context and goals

### 1.1 Problem statement

The current V1 application is a single Next.js 14 app that owns the UI, API routes, business logic, and database access. This has produced several critical and high-severity findings documented in `docs/SCALABILITY_CRITIQUE.md`:

- **CRIT-1:** Entity-scoping gaps in single-resource routes.
- **CRIT-2:** Parent-entity budget aggregation runs full query sets per child.
- **CRIT-3:** Upload endpoint resolves entities from spreadsheets without scoping or file limits.
- **HIGH-1:** No list endpoint uses pagination.
- **HIGH-2:** Missing composite indexes on `Shift`.
- **HIGH-3:** Bulk writes use sequential `create` loops.
- **HIGH-4:** All aggregation is done in JavaScript.
- **MED-4:** Coverage endpoint performs O(days × areas × requirements × shifts) in-memory comparisons.

The root cause is not Next.js itself but the fact that Next.js is being used as a full-stack backend framework. This spec defines a migration to a **dedicated Fastify backend** inside a **pnpm-workspace monorepo**, with a **React + Vite** frontend that only renders UI and calls the backend.

### 1.2 Goals

1. Separate the frontend from the backend with a clear, enforceable boundary.
2. Fix all CRIT and HIGH findings as part of the migration.
3. Provide a monorepo structure that scales and can be vibecoded safely.
4. Define API contracts in a shared package so frontend and backend cannot drift.
5. Keep the PostgreSQL schema and existing data intact.
6. Produce LLM-governance updates that prevent future AI assistants from regressing the architecture.

### 1.3 Non-goals

- This spec does not change application code. It is a planning and execution document for future implementation.
- It does not add new features (e.g., new dashboards, mobile apps, multi-tenancy).
- It does not migrate away from PostgreSQL.

### 1.4 Architecture decision override

This spec overrides the preliminary recommendation in `docs/llm-framework/ARCHITECTURE.md` (which suggested either Next.js + NestJS or Next.js + FastAPI). Because the frontend is being reduced to a thin React SPA and the goal is to minimize AI guardrail surface, the chosen stack is:

- **pnpm workspaces** for the monorepo.
- **React + Vite** for the frontend (replacing Next.js entirely).
- **Fastify + TypeScript** for the backend.

This decision will be reflected in the updated LLM framework docs after this spec is finalized.

---

## 2. Current state

```
Nursing-Scheduler-claude-app-creation-mruz4s/
├── next.config.js
├── package.json              # Next.js 14, NextAuth, Prisma, Tailwind, etc.
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app/                  # Next.js App Router (pages + API routes)
│   ├── components/
│   ├── lib/                  # prisma.ts, auth.ts, hours.ts, permissions.ts
│   └── middleware.ts
└── ...
```

### 2.1 Current issues

- All API routes import `prisma` directly from `src/lib/prisma.ts`.
- No pagination, no DB aggregation, no bulk `createMany`.
- Business logic is embedded in Next.js route handlers.
- Middleware only protects page routes; API routes are unprotected at the edge.
- The frontend and backend share the same `package.json` and dependency graph.

---

## 3. Target state

```
Nursing-Scheduler-claude-app-creation-mruz4s/
├── pnpm-workspace.yaml
├── package.json              # Root scripts, workspace config, no app deps
├── turbo.json                # Optional later; start without it
├── apps/
│   ├── web/                  # React + Vite + TypeScript + Tailwind
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── pages/        # React Router pages
│   │   │   ├── components/
│   │   │   └── lib/
│   │   │       └── api.ts    # Backend client
│   │   └── vite.config.ts
│   └── api/                  # Fastify + TypeScript + Prisma
│       ├── package.json
│       ├── src/
│       │   ├── index.ts      # Server bootstrap
│       │   ├── routes/       # HTTP route handlers
│       │   ├── services/     # Domain/business logic
│       │   ├── repositories/ # Prisma/data access
│       │   ├── plugins/      # Auth, error handling, swagger
│       │   └── lib/
│       └── prisma/
├── packages/
│   ├── shared/               # Zod schemas, types, auth contracts
│   │   ├── package.json
│   │   └── src/
│   │       ├── schemas/
│   │       ├── types/
│   │       └── auth.ts
│   └── db/                   # Prisma schema, client, migrations
│       ├── package.json
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── src/
│           └── client.ts
└── docs/
    └── specs/
        └── 2026-07-09-fastify-monorepo-migration.md   # This file
```

### 3.1 Responsibility boundaries

| Layer | Owns | Does NOT own |
|---|---|---|
| **apps/web** | React components, routing, forms, client state, calling backend API | DB access, business logic, auth session validation, domain aggregation |
| **apps/api** | HTTP routes, request/response validation, service orchestration, auth enforcement, all DB access | UI rendering, client state, browser APIs |
| **packages/shared** | Zod schemas, TypeScript interfaces, auth contract types, API route types | Runtime logic, DB queries |
| **packages/db** | Prisma schema, generated client, migration files, seed data | Business logic, HTTP handling |

---

## 4. Architecture decisions

### 4.1 Decision: pnpm workspaces instead of Turborepo

**Chosen:** pnpm workspaces with optional future upgrade to Turborepo.  
**Rationale:** For one frontend + one backend + two packages, Turborepo adds more config surface than value. pnpm workspaces is simpler, has excellent dependency deduplication, and is easier for AI assistants to reason about.  
**Trade-off:** We lose built-in task caching and pipelines. We mitigate this with simple root `package.json` scripts.

### 4.2 Decision: React + Vite instead of Next.js UI-only

**Chosen:** React + Vite for the frontend.  
**Rationale:** Next.js is designed for full-stack use. Keeping it as UI-only creates constant friction because every AI assistant will naturally try to use Next.js API routes, server components, and `next/cache`. Vite + React removes that entire class of mistakes.  
**Trade-off:** We lose file-based routing and built-in SSR/image optimization. We mitigate this with React Router and standard frontend tooling.

### 4.3 Decision: Fastify + TypeScript for the backend

**Chosen:** Fastify with TypeScript.  
**Rationale:** Fastify is high-performance, schema-first, and has a plugin architecture that maps well to service boundaries. TypeScript keeps the backend in the same language as the frontend, reducing context switching.  
**Trade-off:** Fastify is less opinionated than NestJS. We mitigate this with a strict service/repository folder structure and shared schemas.

### 4.4 Decision: Service/repository pattern

**Chosen:** Organize backend code into `routes/`, `services/`, and `repositories/`.

- **Routes** (`src/routes/`): parse and validate HTTP requests, call services, return responses.
- **Services** (`src/services/`): contain business logic, orchestration, and transactions.
- **Repositories** (`src/repositories/`): contain Prisma queries and data access.

**Rationale:** This pattern prevents business logic from leaking into HTTP handlers and makes the code easy to test and reason about.  
**Trade-off:** More files than a simple controller pattern. Mitigated by clear naming conventions.

### 4.5 Decision: Prisma lives in `packages/db`

**Chosen:** Move the Prisma schema and client into `packages/db`.

**Rationale:** The database is a shared concern. Any future worker, admin CLI, or migration tool can import `packages/db` without depending on the Fastify app.  
**Trade-off:** Adds a package dependency. Mitigated by pnpm workspaces making internal dependencies trivial.

### 4.6 Decision: Zod schemas in `packages/shared`

**Chosen:** Define all request/response and form schemas in `packages/shared` using Zod.

**Rationale:** Zod is already in the project. Sharing schemas between frontend and backend guarantees that a form cannot submit data the backend will reject.  
**Trade-off:** Both apps must depend on `packages/shared`. This is normal in a monorepo.

---

## 5. Monorepo setup

### 5.1 Root package.json

Create `package.json` at the monorepo root:

```json
{
  "name": "nursing-scheduler",
  "private": true,
  "version": "1.0.0",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter db generate",
    "db:migrate": "pnpm --filter db migrate",
    "db:studio": "pnpm --filter db studio"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

### 5.2 pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 5.3 .npmrc

Create `.npmrc` at the root:

```ini
shamefully-hoist=false
strict-peer-dependencies=false
```

### 5.4 .gitignore

Move or merge `.gitignore` to the root. Ensure it ignores:

```
node_modules/
.env
.env.local
*.log
.DS_Store
apps/web/dist/
apps/api/dist/
packages/*/dist/
apps/web/.vite/
```

---

## 6. Package details

### 6.1 `packages/db`

#### package.json

```json
{
  "name": "@nursing/db",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "prisma generate \u0026\u0026 tsc",
    "generate": "prisma generate",
    "migrate": "prisma migrate deploy",
    "studio": "prisma studio",
    "db:push": "prisma db push"
  },
  "dependencies": {
    "@prisma/client": "^7.8.0",
    "prisma": "^7.8.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

#### prisma/schema.prisma

Move the existing `prisma/schema.prisma` into `packages/db/prisma/schema.prisma`. Keep the schema identical for the initial migration. Add missing indexes later as a separate migration.

#### src/client.ts

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

#### src/index.ts

```typescript
export { prisma } from './client'
export * from '@prisma/client'
```

### 6.2 `packages/shared`

#### package.json

```json
{
  "name": "@nursing/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

#### src/schemas/

Create Zod schemas for every backend endpoint and every frontend form. Example:

```typescript
// src/schemas/shifts.ts
import { z } from 'zod'

export const createShiftSchema = z.object({
  entityId: z.string().min(1),
  areaId: z.string().min(1),
  employeeId: z.string().optional(),
  date: z.string().date(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().optional(),
})

export type CreateShiftInput = z.infer<typeof createShiftSchema>
```

#### src/auth.ts

Define the shared auth contract:

```typescript
export type UserRole = 'ADMIN' | 'MANAGER' | 'VIEWER'
export type UserStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
  status: UserStatus
  entityIds: string[] | null
}
```

#### src/index.ts

Re-export everything so consumers can import from `@nursing/shared` directly:

```typescript
export * from './auth'
export * from './schemas/shifts'
// ... export other schemas as they are added
```

### 6.3 `apps/api` (Fastify backend)

#### package.json

```json
{
  "name": "@nursing/api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "tsc --noEmit",
    "test": "vitest"
  },
  "dependencies": {
    "@fastify/cookie": "^9.0.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/helmet": "^11.0.0",
    "@fastify/jwt": "^8.0.0",
    "@fastify/multipart": "^8.0.0",
    "@fastify/rate-limit": "^9.0.0",
    "@fastify/swagger": "^8.0.0",
    "@fastify/swagger-ui": "^4.0.0",
    "@nursing/db": "workspace:*",
    "@nursing/shared": "workspace:*",
    "bcryptjs": "^3.0.3",
    "bullmq": "^5.0.0",
    "date-fns": "^4.4.0",
    "fastify": "^4.28.0",
    "fastify-plugin": "^4.5.0",
    "ioredis": "^5.0.0",
    "xlsx": "^0.18.5",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

#### src/index.ts

```typescript
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { routes } from './routes'
import { prismaPlugin } from './plugins/prisma'
import { authPlugin } from './plugins/auth'
import { errorHandler } from './plugins/errorHandler'

// Validate required environment variables early
const requiredEnv = ['JWT_SECRET', 'DATABASE_URL', 'WEB_URL']
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`)
    process.exit(1)
  }
}

if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'true') {
  console.error('COOKIE_SECURE must be true in production')
  process.exit(1)
}

const app = Fastify({
  logger: true,
  // Global request timeout to prevent long-running requests
  requestTimeout: 30000,
})

app.register(cookie, {
  secret: process.env.COOKIE_SECRET, // optional signed cookies
  parseOptions: {},
})

app.register(cors, {
  origin: process.env.WEB_URL,
  credentials: true,
})

app.register(jwt, {
  secret: process.env.JWT_SECRET!,
  // Read JWT from the HttpOnly cookie set by /api/auth/login
  cookie: {
    cookieName: 'access_token',
    signed: false,
  },
  // 8-hour sessions to match existing NextAuth behavior
  sign: { expiresIn: '8h' },
})

app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })
app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
})
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
})

// Only expose Swagger/OpenAPI in non-production environments
if (process.env.NODE_ENV !== 'production') {
  app.register(swagger, { /* openapi config */ })
  app.register(swaggerUi, { routePrefix: '/docs' })
}

app.register(prismaPlugin)
app.register(authPlugin)
app.register(errorHandler)
app.register(routes, { prefix: '/api' })

app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
```

#### src/plugins/prisma.ts

Register `app.prisma` so services can access the Prisma client without importing it directly.

```typescript
import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { prisma } from '@nursing/db'

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma
  }
}

export const prismaPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('prisma', prisma)
  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
})
```

#### src/lib/auth.ts

Keep pure auth helpers here so they can be used by both the Fastify plugin and domain services without coupling services to the request lifecycle.

```typescript
import { AuthUser, UserRole } from '@nursing/shared'
import { UnauthorizedError, ForbiddenError } from './errors'

export { UnauthorizedError, ForbiddenError } from './errors'

export function canAccessEntity(user: AuthUser | undefined, entityId: string): boolean {
  if (!user) return false
  if (user.role === 'ADMIN') return true
  return user.entityIds?.includes(entityId) ?? false
}

export function getAccessibleEntityIds(user: AuthUser | undefined): string[] | null {
  if (!user) return []
  if (user.role === 'ADMIN') return null
  return user.entityIds ?? []
}

export function requireRole(user: AuthUser, roles: UserRole[]): AuthUser {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError('Insufficient permissions')
  }
  return user
}
```

#### src/lib/errors.ts

Define domain-specific errors so the error handler can map them to the correct HTTP status codes.

```typescript
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
  }
}
```

`src/lib/auth.ts` re-exports `UnauthorizedError`, `ForbiddenError` from `src/lib/errors.ts` so routes and plugins can import from one predictable location:

```typescript
export { UnauthorizedError, ForbiddenError } from './errors'
```

#### src/plugins/auth.ts

Implement a Fastify plugin that decodes the JWT from the `access_token` `HttpOnly` cookie and adds request decorators.

```typescript
import fp from 'fastify-plugin'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AuthUser, UserRole } from '@nursing/shared'
import {
  canAccessEntity as canAccess,
  getAccessibleEntityIds as accessibleIds,
  UnauthorizedError,
  ForbiddenError,
} from '../lib/auth'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
    requireAuth: () => AuthUser
    requireRole: (roles: UserRole[]) => AuthUser
    canAccessEntity: (entityId: string) => boolean
    getAccessibleEntityIds: () => string[] | null
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', undefined)

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // @fastify/jwt is configured to read from the 'access_token' HttpOnly cookie
      const decoded = await request.jwtVerify<AuthUser>()
      // Reject tokens for inactive users at the edge
      if (decoded.status !== 'ACTIVE') {
        request.user = undefined
        return
      }
      request.user = decoded
    } catch {
      request.user = undefined
    }
  })

  app.decorateRequest('requireAuth', function (this: FastifyRequest) {
    if (!this.user) {
      throw new UnauthorizedError('Authentication required')
    }
    return this.user
  })

  app.decorateRequest('requireRole', function (this: FastifyRequest, roles: UserRole[]) {
    const user = this.requireAuth()
    if (!roles.includes(user.role)) {
      throw new ForbiddenError('Insufficient permissions')
    }
    return user
  })

  app.decorateRequest('canAccessEntity', function (this: FastifyRequest, entityId: string) {
    return canAccess(this.user, entityId)
  })

  app.decorateRequest('getAccessibleEntityIds', function (this: FastifyRequest) {
    return accessibleIds(this.user)
  })
})

export { UnauthorizedError, ForbiddenError }
```

Notes:
- `request.cookies` is provided by `@fastify/cookie`.
- `request.jwtVerify` is provided by `@fastify/jwt`.
- Decorators use `function` (not arrow functions) so `this` is bound to the `FastifyRequest`.
- The error handler plugin should translate `UnauthorizedError` → `401` and `ForbiddenError` → `403`.

#### src/plugins/errorHandler.ts

Implement a plugin that catches errors and maps them to safe HTTP responses.

```typescript
import fp from 'fastify-plugin'
import { FastifyInstance, FastifyError } from 'fastify'
import { ZodError } from 'zod'
import { Prisma } from '@nursing/db'
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../lib/errors'

export const errorHandler = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    app.log.error(error)

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      })
    }

    if (error instanceof BadRequestError) {
      return reply.status(400).send({ error: error.message })
    }

    if (error instanceof UnauthorizedError) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    if (error instanceof ForbiddenError) {
      return reply.status(403).send({ error: 'Forbidden' })
    }

    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: 'Not found' })
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return reply.status(404).send({ error: 'Not found' })
      }
    }

    return reply.status(500).send({ error: 'Server error' })
  })
})
```

#### src/routes/shifts.ts

Example route file:

```typescript
import { FastifyInstance } from 'fastify'
import { createShiftSchema } from '@nursing/shared'
import { ShiftService } from '../services/shiftService'

export async function shiftRoutes(app: FastifyInstance) {
  const service = new ShiftService(app.prisma)

  app.get('/', async (request, reply) => {
    const session = request.requireAuth()
    const query = parseShiftQuery(request.query) // validate
    const result = await service.list(session, query)
    return reply.send(result)
  })

  app.post('/', async (request, reply) => {
    const session = request.requireAuth()
    const data = createShiftSchema.parse(request.body)
    const shift = await service.create(session, data)
    return reply.status(201).send(shift)
  })
}
```

#### src/services/

Each domain has a service class:

- `ShiftService`
- `BudgetService`
- `CoverageService`
- `EmployeeService`
- `EntityService`
- `AreaService`
- `RequirementService`
- `RateService`
- `UploadService`
- `UserService`
- `AuthService`

Services call repositories and enforce business rules. Services do not import Fastify types; they receive `prisma` or repository instances via constructor injection.

#### src/repositories/

Each domain has a repository class:

- `ShiftRepository`
- `BudgetRepository`
- `CoverageRepository`
- etc.

Repositories contain only Prisma queries. They do not enforce business rules; they enforce data access patterns (pagination, includes, aggregation).

### 6.4 `apps/web` (React + Vite frontend)

#### package.json

```json
{
  "name": "@nursing/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "tsc --noEmit",
    "test": "vitest"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@hookform/resolvers": "^5.4.0",
    "@nursing/shared": "workspace:*",
    "@tanstack/react-query": "^5.0.0",
    "axios": "^1.7.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.4.0",
    "lucide-react": "^0.408.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.80.0",
    "react-router-dom": "^6.24.0",
    "recharts": "^2.12.7",
    "tailwind-merge": "^3.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

#### src/lib/api.ts

Create a typed Axios instance that:

- Reads `VITE_API_URL`.
- Sends cookies automatically with `withCredentials: true` (the Fastify backend sets the JWT in an `HttpOnly` cookie).
- Redirects to `/login` on 401.
- Returns typed errors.

Example:

```typescript
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)
```

#### src/lib/auth.ts

Replace `next-auth` with a small auth client:

- `login(email, password)` → POST to `/api/auth/login` (the backend sets the `HttpOnly` cookie; the frontend does not touch the token).
- `logout()` → POST to `/api/auth/logout`.
- `useAuth()` hook → calls `GET /api/auth/me` to fetch the current user. If it returns 401, redirect to `/login`.

#### src/pages/

Port existing Next.js pages to React Router pages. Keep the same UI components but replace data fetching with React Query + the API client.

---

## 7. Endpoint migration plan

The following table maps every existing Next.js API route to its new Fastify route and notes which findings it addresses.

| Next.js route | Fastify route | Service | Findings addressed |
|---|---|---|---|
| `POST /api/auth/register` | `POST /api/auth/register` | `AuthService` | Role gate (admin-only) |
| `POST /api/auth/login` | `POST /api/auth/login` | `AuthService` | Replaces NextAuth JWT |
| `GET /api/auth/session` | `GET /api/auth/me` | `AuthService` | Replaces NextAuth session |
| `GET /api/entities` | `GET /api/entities` | `EntityService` | HIGH-1 (pagination) |
| `POST /api/entities` | `POST /api/entities` | `EntityService` | CRIT-1 (admin-only) |
| `GET /api/entities/[id]` | `GET /api/entities/:id` | `EntityService` | CRIT-1 |
| `PATCH /api/entities/[id]` | `PATCH /api/entities/:id` | `EntityService` | CRIT-1 |
| `GET /api/areas` | `GET /api/areas` | `AreaService` | HIGH-1, CRIT-1 |
| `POST /api/areas` | `POST /api/areas` | `AreaService` | CRIT-1 |
| `PATCH /api/areas/[id]` | `PATCH /api/areas/:id` | `AreaService` | CRIT-1 |
| `DELETE /api/areas/[id]` | `DELETE /api/areas/:id` | `AreaService` | CRIT-1 |
| `GET /api/employees` | `GET /api/employees` | `EmployeeService` | HIGH-1, CRIT-1 |
| `GET /api/employees/[id]` | `GET /api/employees/:id` | `EmployeeService` | CRIT-1 |
| `POST /api/employees` | `POST /api/employees` | `EmployeeService` | CRIT-1 |
| `PATCH /api/employees/[id]` | `PATCH /api/employees/:id` | `EmployeeService` | CRIT-1 |
| `GET /api/requirements` | `GET /api/requirements` | `RequirementService` | HIGH-1, CRIT-1 |
| `POST /api/requirements` | `POST /api/requirements` | `RequirementService` | CRIT-1 |
| `DELETE /api/requirements/[id]` | `DELETE /api/requirements/:id` | `RequirementService` | CRIT-1 |
| `GET /api/rates/[entityId]` | `GET /api/rates/:entityId` | `RateService` | CRIT-1 |
| `PATCH /api/rates/[entityId]` | `PATCH /api/rates/:entityId` | `RateService` | CRIT-1 |
| `GET /api/shifts` | `GET /api/shifts` | `ShiftService` | HIGH-1, HIGH-2, HIGH-4 |
| `POST /api/shifts` | `POST /api/shifts` | `ShiftService` | CRIT-1, HIGH-3 |
| `PATCH /api/shifts/[id]` | `PATCH /api/shifts/:id` | `ShiftService` | CRIT-1 |
| `DELETE /api/shifts/[id]` | `DELETE /api/shifts/:id` | `ShiftService` | CRIT-1 |
| `POST /api/shifts/copy-week` | `POST /api/shifts/copy-week` | `ShiftService` | HIGH-3, CRIT-1 |
| `POST /api/upload` | `POST /api/upload` | `UploadService` | CRIT-3, HIGH-3 |
| `GET /api/users` | `GET /api/users` | `UserService` | HIGH-1, CRIT-1 (admin-only) |
| `PATCH /api/users/[id]` | `PATCH /api/users/:id` | `UserService` | CRIT-1 (admin-only) |
| `GET /api/budget` | `GET /api/budget` | `BudgetService` | CRIT-2, HIGH-4 |
| `GET /api/dashboard/coverage` | `GET /api/dashboard/coverage` | `CoverageService` | MED-4, HIGH-4, HIGH-1 |
| `GET /api/dashboard/agency` | `GET /api/dashboard/agency` | `DashboardService` | HIGH-1, HIGH-4 |

---

## 8. Addressing each finding in the migration

### CRIT-1: Entity-scoping gaps in single-resource routes

**Fix in Fastify:** Every route that operates on a single resource must:

1. Load the record from the repository by ID.
2. Call `request.canAccessEntity(record.entityId)`.
3. Return `404` if the record does not exist, `403` if the user cannot access it.

```typescript
const existing = await repo.findById(id)
if (!existing) return reply.status(404).send({ error: 'Not found' })
if (!request.canAccessEntity(existing.entityId)) {
  return reply.status(403).send({ error: 'Forbidden' })
}
```

Apply this to: `areas`, `employees`, `requirements`, `rates`, `shifts`, `users`.

### CRIT-2: Parent budget aggregation query fan-out

**Fix in Fastify:** Replace the per-sub-entity `Promise.all` with a single query that aggregates across all sub-entities.

```typescript
// Use Prisma groupBy + _sum
const shifts = await prisma.shift.groupBy({
  by: ['entityId'],
  where: { entityId: { in: subEntityIds }, date: { gte, lte } },
  _sum: { /* paid hours derived in query or computed field */ },
})
```

If the math cannot be expressed in Prisma, use a raw SQL query or a materialized view. Do not load all shifts into memory.

### CRIT-3: Upload scoping and file limits

**Fix in Fastify:**

1. Add a Fastify `preValidation` hook on the upload route that rejects files larger than 10 MB and validates content type (`multipart/form-data`).
2. Validate each row's resolved `entityId` against `request.canAccessEntity(entityId)` before writing or returning a preview.
3. Use `prisma.<model>.createMany` inside a `$transaction` for bulk writes.
4. Cap rows at a configurable maximum (e.g., 5,000 rows per upload).

### HIGH-1: No pagination

**Fix in Fastify:** Every list endpoint must accept `page` and `pageSize` query params.

```typescript
const page = Math.max(1, Number(query.page ?? 1))
const pageSize = Math.min(1000, Math.max(1, Number(query.pageSize ?? 100)))
const skip = (page - 1) * pageSize

const [data, total] = await Promise.all([
  prisma.shift.findMany({ where, skip, take: pageSize }),
  prisma.shift.count({ where }),
])

return { data, pagination: { page, pageSize, total, hasNext: page * pageSize < total } }
```

### HIGH-2: Missing composite indexes

**Fix in `packages/db`:** Add a Prisma migration.

```prisma
model Shift {
  // ... existing fields

  @@index([entityId, areaId, date])
  @@index([entityId, employeeId, date])
  @@index([employeeId, date])
  @@index([entityId, isOpen, date])
  @@index([areaId])
}

model StaffingRequirement {
  // ... existing fields
  @@index([entityId, areaId, isActive])
}
```

Use `CREATE INDEX CONCURRENTLY` for production deployment if downtime is unacceptable.

### HIGH-3: Sequential bulk writes

**Fix in Fastify:** Replace `for...of` loops with `createMany` inside a transaction.

```typescript
await prisma.$transaction([
  prisma.shift.createMany({ data: shifts }),
])
```

For very large uploads, use a background worker queue instead of a synchronous HTTP request.

### HIGH-4: All aggregation in JavaScript

**Fix in Fastify:** Use Prisma `groupBy`, `_sum`, `_count`, and raw SQL where needed. Budget and coverage endpoints should not load full rows into memory.

### MED-4: Coverage endpoint O(n⁴) complexity

**Fix in Fastify:** Move coverage computation to a background worker or pre-compute `CoverageSnapshot` rows. For the synchronous endpoint, cap the date range to 31 days and use a SQL query or a pre-computed snapshot table.

### MED-1: Middleware does not protect API routes

**Fix in Fastify:** Every route is protected by the Fastify auth plugin. There is no middleware equivalent to bypass; auth is explicit in each route via `request.requireAuth()` and `request.canAccessEntity()`.

### MED-2: Missing Prisma pool configuration

**Fix in Fastify:** Set `connection_limit` in the `DATABASE_URL` or use a Prisma connection string parameter. For multiple app instances, introduce PgBouncer.

### MED-3: Redundant indexes

**Fix in `packages/db`:** Remove redundant indexes in a new Prisma migration.

### LOW-1 / LOW-2: Permission helpers

**Fix in Fastify:** Remove the `redirect()` helpers. The Fastify auth plugin always returns JSON `401`/`403`. Replace `assertEntityAccess` with explicit `request.canAccessEntity()` checks and `403` responses.

### Heavy endpoint recipes

These recipes show the intended implementation for the endpoints that are too complex for a simple CRUD migration.

#### BudgetService

The legacy `/api/budget` loads every sub-entity and computes in JavaScript. The Fastify version must aggregate in SQL to satisfy CRIT-2 and HIGH-4.

For the initial migration, use a raw SQL query that computes paid hours per entity, role, and employment type, joins rate cards, and joins budget targets. This avoids loading all `Shift` rows into the Fastify process.

```typescript
// apps/api/src/services/budgetService.ts
import { Prisma, PrismaClient } from '@nursing/db'
import type { AuthUser } from '@nursing/shared'
import { hours, toWeeklyRate } from '../lib/hours'
import { ForbiddenError, NotFoundError } from '../lib/errors'

export class BudgetService {
  constructor(private readonly prisma: PrismaClient) {}

  async getEntityBudget(
    entityId: string,
    startDate: Date,
    endDate: Date,
    period: 'weekly' | 'pay-period' | 'monthly' | 'quarterly' | 'yearly',
    accessibleEntityIds: string[] | null
  ) {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } })
    if (!entity) throw new NotFoundError()

    const entityIds = entity.type === 'PARENT'
      ? await this.getSubEntityIds(entityId, accessibleEntityIds)
      : this.filterAccessible([entityId], accessibleEntityIds)

    if (entityIds.length === 0) {
      throw new ForbiddenError()
    }

    // Raw SQL aggregation: paid hours per entity / role / employmentType
    const rawResult: Array<{
      entityId: string
      role: string
      employmentType: string
      paidHours: number
    }> = await this.prisma.$queryRaw`
      SELECT
        s."entityId",
        e.role,
        e."employmentType",
        SUM(
          EXTRACT(EPOCH FROM (s."endTime" - s."startTime")) / 3600
          - CASE
              WHEN EXTRACT(EPOCH FROM (s."endTime" - s."startTime")) / 3600 >= 8
              THEN 0.5
              ELSE 0
            END
        )::float AS "paidHours"
      FROM "Shift" s
      JOIN "Employee" e ON e.id = s."employeeId"
      WHERE s."entityId" IN (${Prisma.join(entityIds)})
        AND s.date >= ${startDate}::date
        AND s.date <= ${endDate}::date
      GROUP BY s."entityId", e.role, e."employmentType"
    `
    const rateCards = await this.prisma.rateCard.findMany({
      where: { entityId: { in: entityIds } },
    })

    const budgetTargets = await this.prisma.budgetTarget.findMany({
      where: { entityId: { in: entityIds } },
    })

    return this.buildBudgetResponse(rawResult, rateCards, budgetTargets, entityId, period)
  }

  private async getSubEntityIds(
    parentId: string,
    accessibleEntityIds: string[] | null
  ): Promise<string[]> {
    const all = await this.prisma.entity.findMany({
      where: { parentId },
      select: { id: true },
    })
    const ids = all.map((e) => e.id)
    return this.filterAccessible(ids, accessibleEntityIds)
  }

  private filterAccessible(ids: string[], accessibleEntityIds: string[] | null): string[] {
    if (accessibleEntityIds === null) return ids
    return ids.filter((id) => accessibleEntityIds.includes(id))
  }

  private buildBudgetResponse(
    rawResult: Array<{ entityId: string; role: string; employmentType: string; paidHours: number }>,
    rateCards: RateCard[],
    budgetTargets: BudgetTarget[],
    entityId: string,
    period: string
  ) {
    // ... match rate card, apply weekly rate, compare to budget target ...
  }
}
```

If the SQL becomes unwieldy as more rules are added, move the calculation to a materialized `BudgetSnapshot` table updated by a worker or a nightly job.

#### CoverageService

For the synchronous coverage endpoint:

1. Cap the date range to 31 days.
2. Load `staffingRequirement`, `shift`, and `area` rows for the requested entity and date range.
3. Use the existing `coveredMinutes` helper from `apps/api/src/lib/hours.ts`.
4. Return per-day, per-area coverage buckets.

For long-term scale, add a `CoverageSnapshot` table:

```prisma
model CoverageSnapshot {
  id           String   @id @default(cuid())
  entityId     String
  areaId       String
  date         DateTime @db.Date
  neededHours  Float
  coveredHours Float
  openHours    Float
  updatedAt    DateTime @updatedAt

  @@unique([entityId, areaId, date])
  @@index([entityId, date])
}
```

Update snapshots via a background worker after shift mutations.

#### CopyWeekService

```typescript
// apps/api/src/services/copyWeekService.ts
import { PrismaClient } from '@nursing/db'
import { addDays, differenceInDays } from 'date-fns'
import { canAccessEntity, ForbiddenError } from '../lib/auth'
import { BadRequestError } from '../lib/errors'
import type { AuthUser } from '@nursing/shared'

export class CopyWeekService {
  constructor(private readonly prisma: PrismaClient) {}

  async copyWeek(
    entityId: string,
    sourceWeekStart: Date,
    targetWeekStart: Date,
    session: AuthUser
  ) {
    if (!canAccessEntity(session, entityId)) throw new ForbiddenError()

    const dayOffset = differenceInDays(targetWeekStart, sourceWeekStart)
    if (dayOffset % 7 !== 0) {
      throw new BadRequestError('Target week must be a whole week offset from source week')
    }

    const sourceShifts = await this.prisma.shift.findMany({
      where: {
        entityId,
        date: { gte: sourceWeekStart, lte: addDays(sourceWeekStart, 6) },
      },
    })

    const newShifts = sourceShifts.map((shift) => ({
      entityId: shift.entityId,
      areaId: shift.areaId,
      employeeId: shift.employeeId,
      date: addDays(shift.date, dayOffset),
      startTime: shift.startTime,
      endTime: shift.endTime,
      notes: shift.notes,
    }))

    await this.prisma.$transaction(async (tx) => {
      await tx.shift.deleteMany({
        where: {
          entityId,
          date: { gte: targetWeekStart, lte: addDays(targetWeekStart, 6) },
        },
      })
      await tx.shift.createMany({ data: newShifts })
    })

    return { copied: newShifts.length }
  }
}
```

The route checks `request.canAccessEntity(entityId)` before calling the service; the service re-checks with the shared helper as a defense-in-depth measure.

#### UploadService

```typescript
// apps/api/src/services/uploadService.ts
import { PrismaClient } from '@nursing/db'
import { canAccessEntity, ForbiddenError } from '../lib/auth'
import { BadRequestError } from '../lib/errors'
import type { AuthUser } from '@nursing/shared'
import * as xlsx from 'xlsx'

export class UploadService {
  constructor(private readonly prisma: PrismaClient) {}

  async handleShiftsUpload(file: Buffer, session: AuthUser) {
    // Parse the spreadsheet (pseudocode; choose a parser that streams large files)
    const rows = this.parseExcel(file)
    if (rows.length > 5000) {
      throw new BadRequestError('Maximum 5,000 rows allowed')
    }

    const entityCodes = [...new Set(rows.map((r) => r.entityCode))]
    const entities = await this.prisma.entity.findMany({
      where: { code: { in: entityCodes } },
      select: { id: true, code: true },
    })
    const entityByCode = new Map(entities.map((e) => [e.code, e]))

    for (const code of entityCodes) {
      const entity = entityByCode.get(code)
      if (!entity) throw new BadRequestError(`Unknown facility: ${code}`)
      if (!canAccessEntity(session, entity.id)) throw new ForbiddenError()
    }

    // Resolve areas, employees, validate rows, then bulk insert (pseudocode)
    const validShifts = this.buildShifts(rows, entityByCode)

    await this.prisma.$transaction(async (tx) => {
      await tx.shift.createMany({ data: validShifts })
    })

    return { inserted: validShifts.length }
  }

  private parseExcel(file: Buffer): Array<{ entityCode: string; /* other fields */ }> {
    // Implementation: use `xlsx` streaming or `xlsx.read` with a row limit
    return []
  }

  private buildShifts(
    rows: Array<{ entityCode: string; /* other fields */ }>,
    entityByCode: Map<string, { id: string; code: string }>
  ): Array<{ /* Shift create input */ }> {
    // Implementation: resolve area/employee IDs, validate dates/times, map to Prisma input
    return []
  }
}
```

The route enforces a max file size (10 MB), content-type (`multipart/form-data`), and file extension before forwarding to the service.

```typescript
// apps/api/src/routes/upload.ts
import { FastifyInstance } from 'fastify'
import { UploadService } from '../services/uploadService'

const ALLOWED_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]

export async function uploadRoutes(app: FastifyInstance) {
  const service = new UploadService(app.prisma)

  app.post('/upload', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const session = request.requireAuth()
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No file provided' })

    const mimetype = data.mimetype
    const filename = data.filename.toLowerCase()
    if (!ALLOWED_MIMETYPES.includes(mimetype) || (!filename.endsWith('.xlsx') && !filename.endsWith('.csv'))) {
      return reply.status(400).send({ error: 'Only .xlsx and .csv files are allowed' })
    }

    const buffer = await data.toBuffer()
    const result = await service.handleShiftsUpload(buffer, session)
    return reply.status(201).send(result)
  })
}
```

#### DashboardService

The legacy dashboard endpoints (e.g., `GET /api/dashboard/agency`) aggregate cost or utilization metrics for widgets. Use the same SQL-aggregation approach as `BudgetService` and `CoverageService`.

```typescript
// apps/api/src/services/dashboardService.ts
import { Prisma, PrismaClient } from '@nursing/db'
import type { AuthUser } from '@nursing/shared'
import { canAccessEntity, ForbiddenError } from '../lib/auth'
import { NotFoundError } from '../lib/errors'

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async getAgencyMetrics(
    entityId: string,
    startDate: Date,
    endDate: Date,
    session: AuthUser,
    accessibleEntityIds: string[] | null
  ) {
    if (!canAccessEntity(session, entityId)) throw new ForbiddenError()

    const entityIds = await this.getScopedEntityIds(entityId, accessibleEntityIds)

    const result = await this.prisma.$queryRaw`
      SELECT
        s."entityId",
        e.role,
        SUM(
          EXTRACT(EPOCH FROM (s."endTime" - s."startTime")) / 3600
          - CASE
              WHEN EXTRACT(EPOCH FROM (s."endTime" - s."startTime")) / 3600 >= 8
              THEN 0.5
              ELSE 0
            END
        )::float AS "paidHours"
      FROM "Shift" s
      JOIN "Employee" e ON e.id = s."employeeId"
      WHERE s."entityId" IN (${Prisma.join(entityIds)})
        AND e."employmentType" = 'AGENCY'
        AND s.date >= ${startDate}::date
        AND s.date <= ${endDate}::date
      GROUP BY s."entityId", e.role
    `

    return result
  }

  private async getScopedEntityIds(
    entityId: string,
    accessibleEntityIds: string[] | null
  ): Promise<string[]> {
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } })
    if (!entity) throw new NotFoundError()

    const ids = entity.type === 'PARENT'
      ? (await this.prisma.entity.findMany({ where: { parentId: entityId }, select: { id: true } })).map((e) => e.id)
      : [entityId]

    if (accessibleEntityIds === null) return ids
    return ids.filter((id) => accessibleEntityIds.includes(id))
  }
}
```

### Worker queue (Phase 5)

Use **BullMQ** with Redis for:

- Bulk upload processing (large files).
- Coverage snapshot updates.
- Weekly budget snapshot updates.

Add `bullmq` and `ioredis` to `apps/api` dependencies (already shown in the package template). Create `apps/api/src/workers/` for processors.

#### Redis connection setup

`apps/api/src/lib/redis.ts`:

```typescript
import IORedis from 'ioredis'

const url = process.env.REDIS_URL || 'redis://localhost:6379'

export const redisConnection = new IORedis(url, {
  maxRetriesPerRequest: null,
  tls: url.startsWith('rediss://') ? {} : undefined,
})
```

Use `rediss://` for TLS in production (e.g., Azure Cache for Redis).

#### Queue and worker registration

`apps/api/src/lib/queues.ts`:

```typescript
import { Queue } from 'bullmq'
import { redisConnection } from './redis'

export const uploadQueue = new Queue('bulk-upload', { connection: redisConnection })
export const coverageSnapshotQueue = new Queue('coverage-snapshot', { connection: redisConnection })
export const budgetSnapshotQueue = new Queue('budget-snapshot', { connection: redisConnection })
```

`apps/api/src/workers/uploadWorker.ts`:

```typescript
import { Worker, Job } from 'bullmq'
import { redisConnection } from '../lib/redis'
import { prisma } from '@nursing/db'
import { parseUploadFile } from '../services/uploadService'

export const uploadWorker = new Worker(
  'bulk-upload',
  async (job: Job<{ uploadId: string; filePath: string; requestedById: string }>) => {
    const { uploadId, filePath, requestedById } = job.data
    const result = await parseUploadFile(uploadId, filePath, requestedById)
    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: result.errors.length ? 'PARTIAL' : 'COMPLETED',
        result: JSON.stringify(result),
      },
    })
  },
  { connection: redisConnection }
)
```

Run workers as a separate process (recommended for production). Do not import them into `apps/api/src/index.ts`; the web process should not host long-running job processors.

```bash
cd apps/api && pnpm worker
```

Use an `Upload` model to track status:

```prisma
model Upload {
  id        String   @id @default(cuid())
  fileName  String
  status    UploadStatus @default(PENDING)
  result    String?
  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum UploadStatus {
  PENDING
  PROCESSING
  COMPLETED
  PARTIAL
  FAILED
}
```

Start the worker process in development:

```bash
cd apps/api && pnpm worker
```

Add a `worker` script to `apps/api/package.json`:

```json
"worker": "tsx src/workers/index.ts"
```

Create `apps/api/src/workers/index.ts` to load all worker definitions:

```typescript
import './uploadWorker'
import './coverageSnapshotWorker'
import './budgetSnapshotWorker'

// Keep the process alive while workers listen for jobs
setInterval(() => {}, 1 << 30)
```

---

## 9. Auth and session strategy

### 9.1 Replace NextAuth with Fastify JWT

NextAuth is tied to the Next.js app. Since the frontend is being replaced with React + Vite, the monorepo will use a stateless JWT managed by the Fastify backend.

**Mechanism: HttpOnly cookie**

1. **Login:** `POST /api/auth/login` validates email/password with bcrypt, signs a JWT, and sets an `HttpOnly`, `Secure`, `SameSite=Lax` cookie named `access_token`.
2. **Token usage:** The browser automatically sends the cookie on every request. The Fastify backend reads `access_token` from the cookie via the auth plugin.
3. **No localStorage:** Do not store the JWT in `localStorage` or `sessionStorage`. This avoids XSS token theft.
4. **Logout:** `POST /api/auth/logout` clears the cookie.
5. **Session shape:** Match the existing `session.user` shape:
   ```json
   { "id": "...", "email": "...", "name": "...", "role": "ADMIN", "status": "ACTIVE", "entityIds": ["..."] }
   ```
6. **Registration:** `POST /api/auth/register` creates a `PENDING` user. Only an `ADMIN` can approve users via `PATCH /api/users/:id`.

### 9.2 Login route cookie code

```typescript
// apps/api/src/routes/auth.ts
import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body)

    const user = await app.prisma.user.findUnique({ where: { email } })
    if (!user || user.status !== 'ACTIVE') {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const token = await app.jwt.sign({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      entityIds: user.entityIds,
    })

    reply.setCookie('access_token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60, // 8 hours
    })

    const { passwordHash, ...safeUser } = user
    return { user: safeUser }
  })

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('access_token', { path: '/' })
    return { success: true }
  })

  app.get('/me', async (request, reply) => {
    const user = request.requireAuth()
    return reply.send(user)
  })
}
```

### 9.3 Password migration

Existing bcrypt hashes are portable. The Fastify backend validates the same bcrypt hashes with the same number of rounds.

### 9.4 Frontend auth

Replace `next-auth` with a small auth client in `apps/web/src/lib/auth.ts`:

- `login(email, password)` → POST to `/api/auth/login` (cookie is set by the browser).
- `logout()` → POST to `/api/auth/logout`.
- `useAuth()` hook reads the decoded user from a lightweight `/api/auth/me` endpoint (or from a JWT payload exposed safely).
- Use a React Router `ProtectedRoute` component to guard pages.
- Remove `src/middleware.ts` from the old Next.js app.

Example `ProtectedRoute`:

```tsx
// apps/web/src/components/ProtectedRoute.tsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

export function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />
  return children
}
```

### 9.5 Environment variable transition

| Old variable | New variable | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | `JWT_SECRET` | Generate a new strong secret; do not reuse the NextAuth key for a different token format. |
| `NEXTAUTH_URL` | `WEB_URL` | URL of the React + Vite frontend. |
| `DATABASE_URL` | `DATABASE_URL` | Unchanged. |
| N/A | `COOKIE_SECRET` | Secret for signing cookies (optional; can be the same as `JWT_SECRET` in dev, separate in prod). |
| N/A | `API_URL` | Public URL of the Fastify backend. |
| N/A | `PORT` | Port for Fastify (default 3001). |
| N/A | `NODE_ENV` | `development` or `production`. |

---

## 10. Database and migration strategy

### 10.1 Keep PostgreSQL and the existing schema

Do not rename tables, columns, or enums. The existing migrations are forward-compatible. Move the Prisma schema into `packages/db/prisma/schema.prisma` without changing models initially.

### 10.2 Add missing indexes in a new migration

After the monorepo is set up, create a new Prisma migration in `packages/db` that adds the missing indexes and removes redundant ones.

```bash
cd packages/db
npx prisma migrate dev --name add_schedule_indexes
```

### 10.3 Connection pooling

Set `connection_limit` in the database URL or in the Prisma client options. Example:

```env
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=20"
```

For multiple `apps/api` instances, route through PgBouncer with `pgbouncer=true` in the connection string.

---

## 11. Testing strategy

### 11.1 Backend tests

Use **integration tests with a real PostgreSQL test database**. Do not use in-memory stubs for repositories; they give poor confidence for Prisma queries and migrations.

1. **Test database setup:** Use `testcontainers` (Node.js) or a dedicated `nursing_scheduler_test` database on the same Postgres server. Run `prisma migrate deploy` against the test database before each test run.
2. **Test isolation:** Wrap each test in a transaction that rolls back, or use `prisma.$disconnect()` and re-migrate between test files. Prefer transaction rollback for speed.
3. **Fastify test helper:** Create `apps/api/src/test/buildApp.ts` that builds the Fastify app with the test database URL and returns `app` for testing.
4. **Test coverage:** Every route must have tests for:
   - Auth: 401 when unauthenticated, 403 when unauthorized.
   - Entity scoping: users cannot access records outside their assigned entities.
   - Pagination: list endpoints return `{ data, pagination }`.
   - Validation: Zod failures return 400 with clear messages.
   - Business logic: budget and coverage calculations match the legacy `src/lib/hours.ts` logic.

### 11.2 Frontend tests

- Use **Vitest + React Testing Library** for component behavior.
- Mock the API client (`apps/web/src/lib/api.ts`) with MSW or a simple mock.
- Do not call the real backend in unit tests.
- Test `ProtectedRoute` behavior for each role.

### 11.3 End-to-end tests

After migration, run a full smoke test against the deployed stack:

```
login → create entity → create area → create employee → create shift → view budget → view coverage → logout
```

---

## 12. CI/CD and deployment

### 12.1 Environment variables

Create a root `.env.example` file:

> ⚠️ **Security note:** JWTs carry the user's `entityIds`. If an admin changes a user's entity assignments, the change will not take effect until the user logs in again or the 8‑hour cookie expires. This is an accepted trade-off for stateless sessions. For sensitive operations, consider an additional freshness check against the database.

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/nursing_scheduler

# Backend
JWT_SECRET=replace-with-a-256-bit-secret
COOKIE_SECRET=replace-with-a-256-bit-secret
COOKIE_SECURE=false # set to true in production
API_URL=http://localhost:3001
PORT=3001

# Frontend
WEB_URL=http://localhost:5173
VITE_API_URL=http://localhost:3001

# Redis (for BullMQ workers; optional until Phase 5)
REDIS_URL=redis://localhost:6379

NODE_ENV=development
```

### 12.2 GitHub Actions workflow

Replace the existing `.github/workflows/azure-deploy.yml` with the following structure. Note: the workflow file itself stays at the root, not inside `apps/legacy`.

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install

      - name: Generate Prisma client
        run: pnpm db:generate

      - name: Build workspace packages
        run: pnpm --filter shared build && pnpm --filter db build

      - name: Build
        run: pnpm build

      - name: Apply migrations to test database
        run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}

      - name: Test
        run: pnpm test
        env:
          # Use a dedicated test database, not production
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}

  deploy-api:
    needs: build-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm db:generate
      - run: pnpm --filter shared build && pnpm --filter db build
      - run: pnpm --filter api build
      - name: Apply migrations
        run: pnpm db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      # Deploy apps/api/dist to Azure App Service or Container Apps
      # Replace the step below with your Azure publish-profile action
      - name: Deploy API
        run: echo "Deploy apps/api to Azure"

  deploy-web:
    needs: build-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm --filter shared build
      - run: pnpm --filter web build
      # Deploy apps/web/dist to Azure Static Web Apps or CDN
      - name: Deploy Web
        run: echo "Deploy apps/web to Azure Static Web Apps"
```

### 12.3 Rate limiting

Add `@fastify/rate-limit` to `apps/api` and configure it globally:

```typescript
import rateLimit from '@fastify/rate-limit'

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
})
```

For heavy endpoints (`/api/budget`, `/api/dashboard/coverage`, `/api/upload`, `/api/shifts/copy-week`), apply stricter limits:

```typescript
app.get('/budget', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, handler)
```

For auth endpoints, apply per-IP brute-force limits:

```typescript
app.post('/login', {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
}, handler)

app.post('/register', {
  config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
}, handler)
```

### 12.4 Deployment topology

Recommended for production:

- **Azure Container Apps** or **App Service** for `apps/api`.
- **Azure Static Web Apps** or **App Service** for `apps/web`.
- **Azure PostgreSQL Flexible Server** for the database.
- **Azure Cache for Redis** or a self-hosted Redis for BullMQ.

---

## 13. LLM framework updates

After this spec is finalized, update the following files so future AI assistants do not regress the architecture:

### 13.1 `CLAUDE.md` and `AGENTS.md`

- Update the project identity to mention the pnpm monorepo, React + Vite, Fastify backend.
- Add or update the non-negotiable: **"Next.js does not exist in this project. The frontend is React + Vite; the backend is Fastify."**
- Update stack rules: frontend calls backend APIs; backend owns DB, auth, and business logic.
- Update performance guardrails: pagination, DB aggregation, `createMany`, index usage apply to the Fastify backend.
- Update security quick reference: Fastify auth plugin returns `401`/`403`; every route checks `canAccessEntity`.

### 13.2 `docs/llm-framework/ARCHITECTURE.md`

- Replace the "Target application architecture" section with the final monorepo structure.
- Update the "API route conventions" section to describe Fastify plugin conventions.
- Update "Known technical debt" to reflect that the legacy Next.js app is being migrated.

### 13.3 `docs/llm-framework/PLAYBOOKS.md`

- Update "Next.js App Router" section to "React + Vite frontend".
- Update "Prisma" section to "backend-only Prisma via `packages/db`".
- Add "Fastify service/repository pattern" section with examples.
- Update upload, auth, and error-handling playbooks for Fastify.

### 13.4 `docs/llm-framework/MAINTENANCE.md`

- Update the doc-impact check table to include monorepo structure changes and Fastify route changes.
- Add a changelog entry for this architecture decision.

---

## 14. Migration phases

> **Golden rule:** The existing Next.js app must remain deployable until the React + Vite frontend and Fastify backend can fully replace it. This is a **strangler-fig migration**, not a big-bang rewrite.

### Phase 0: Monorepo skeleton without breaking the existing app

> **Golden rule:** The existing Next.js app must remain deployable throughout this phase. Do not change its behavior; only reorganize files.

#### 0.1 Prerequisites

- Node.js 20+ installed.
- pnpm 9+ installed (or run `corepack enable`).
- PostgreSQL running locally or accessible.
- A `main-legacy` branch created from the current `main` before any changes.

#### 0.2 Switch from npm to pnpm

Before moving files, switch the package manager on the current Next.js app:

```bash
cd /Users/aliamin/Documents/Work/resume-app/Nursing-Scheduler-claude-app-creation-mruz4s
rm -rf node_modules package-lock.json
pnpm install
# Verify the app still works
pnpm dev
```

Commit the `pnpm-lock.yaml` on the migration branch. The original npm-based branch remains as a rollback point until the migration is complete.

#### 0.3 Create monorepo root files

Create at the project root:

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```ini
# .npmrc
shamefully-hoist=false
strict-peer-dependencies=false
```

```json
# package.json
{
  "name": "nursing-scheduler",
  "private": true,
  "version": "1.0.0",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter db generate",
    "db:migrate": "pnpm --filter db migrate",
    "db:studio": "pnpm --filter db studio"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

#### 0.4 Move existing Next.js app into apps/legacy

Move the following files and directories from the project root into `apps/legacy/`:

| From root | To apps/legacy |
|---|---|
| `.next/` | `.next/` |
| `.nextignore` | `.nextignore` |
| `.eslintrc.json` | `.eslintrc.json` |
| `.gitignore` | merge into root `.gitignore` (keep app-specific rules) |
| `next.config.js` | `next.config.js` |
| `next-env.d.ts` | `next-env.d.ts` |
| `package.json` | `package.json` (see template below) |
| `package-lock.json` | DELETE |
| `postcss.config.mjs` | `postcss.config.mjs` |
| `public/` | `public/` |
| `src/` | `src/` |
| `tailwind.config.ts` | `tailwind.config.ts` |
| `tsconfig.json` | `tsconfig.json` |
| `azure-deploy-setup.md` | `azure-deploy-setup.md` |
| `notes/api-audit.md` | `notes/api-audit.md` (optional, can stay at root) |

Do NOT move:
- `.github/` (workflows stay at root so Azure/GitHub Actions can find them)
- `prisma/` (goes to `packages/db`)
- `docs/` (stays at root)
- `notes/` (can stay at root or move; keep at root for cross-project visibility)
- `CLAUDE.md`, `AGENTS.md` (stay at root)

#### 0.5 apps/legacy/package.json

```json
{
  "name": "@nursing/legacy",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@hookform/resolvers": "^5.4.0",
    "@nursing/db": "workspace:*",
    "@nursing/shared": "workspace:*",
    "autoprefixer": "^10.5.2",
    "axios": "^1.7.0",
    "bcryptjs": "^3.0.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.4.0",
    "lucide-react": "^0.408.0",
    "multer": "^1.4.5-lts.1",
    "next": "^14.2.5",
    "next-auth": "^4.24.14",
    "postcss": "^8.4.38",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.80.0",
    "recharts": "^2.12.7",
    "tailwind-merge": "^3.6.0",
    "tailwindcss": "^3.4.0",
    "xlsx": "^0.18.5",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/multer": "^2.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.5",
    "typescript": "^5.5.0"
  }
}
```

> **Version note:** The legacy app may retain the versions that were installed at the root before migration (e.g., `zod ^4.4.3`, `tailwindcss ^4.3.2`, `typescript ^6.0.3`). This template uses stable, widely-supported versions for the new monorepo apps. If the legacy app cannot be upgraded immediately, keep its existing versions and only align with the new apps when a legacy route is migrated to `apps/web` or `apps/api`.

#### 0.6 Update apps/legacy/src/lib/prisma.ts

Replace the contents of `apps/legacy/src/lib/prisma.ts` with:

```typescript
export { prisma } from '@nursing/db'
```

#### 0.7 Create empty monorepo directories

```
packages/
  db/
    package.json
    tsconfig.json
    src/
      client.ts
      index.ts
    prisma/
      schema.prisma
      migrations/
      seed.ts
  shared/
    package.json
    tsconfig.json
    src/
      index.ts
      schemas/
      types/
      auth.ts
apps/
  api/
    package.json
    tsconfig.json
    src/
      index.ts
      routes/
      services/
      repositories/
      plugins/
      lib/
  web/
    package.json
    tsconfig.json
    index.html
    vite.config.ts
    postcss.config.js
    tailwind.config.ts
    src/
      main.tsx
      App.tsx
      pages/
      components/
      lib/
```

#### 0.8 tsconfig.json templates

Create `tsconfig.base.json` at the root (optional but recommended):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Root `tsconfig.json` (if using project references):

```json
{
  "extends": "./tsconfig.base.json",
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/db" },
    { "path": "./apps/api" },
    { "path": "./apps/web" }
  ],
  "files": []
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Node",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true
  },
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/db" }
  ],
  "include": ["src/**/*"]
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "allowSyntheticDefaultImports": true
  },
  "references": [{ "path": "../../packages/shared" }],
  "include": ["src/**/*"]
}
```

#### 0.9 Move Prisma schema

```bash
mv prisma/schema.prisma packages/db/prisma/schema.prisma
mv prisma/migrations packages/db/prisma/migrations
mv prisma/seed.ts packages/db/prisma/seed.ts
rmdir prisma  # if empty
```

#### 0.10 Move hours helpers

```bash
mv apps/legacy/src/lib/hours.ts apps/api/src/lib/hours.ts
```

#### 0.11 Verify Phase 0

```bash
pnpm install
pnpm db:generate
pnpm --filter @nursing/legacy build
```

If `apps/legacy` builds successfully, Phase 0 is complete.

### Phase 0.5: Strangler-fig bridge

Until the React + Vite frontend is fully ready, keep the existing Next.js app running. The React app and the Next.js app can coexist:

- New React pages are deployed under a `/v2` path or on a separate subdomain (e.g., `https://v2.nursing-scheduler.example.com`).
- The React app calls the Fastify backend directly with `withCredentials: true`.
- The Next.js app continues to call its own API routes until they are migrated.

#### Auth bridge during Phase 0.5

During the bridge, the legacy Next.js app still uses NextAuth. The Fastify backend uses its own JWT cookie. To keep both working:

1. **Login:** Users still log in via the legacy Next.js app. NextAuth sets its own session cookie.
2. **Fastify token:** Add an internal `POST /api/auth/exchange` endpoint that the legacy Next.js app can call with the NextAuth session. It returns a short-lived Fastify JWT or sets the `access_token` cookie.
3. **Alternatively:** implement the Fastify login route first and make the legacy Next.js app proxy `/api/auth/login` to Fastify. This is simpler but requires UI changes.

Recommended: implement Fastify login first and proxy the legacy login route to Fastify. This way, the `access_token` cookie is set by the backend and shared by both apps.

#### Legacy route proxy template

When a route is migrated to Fastify, create a temporary proxy in `apps/legacy/src/app/api/<resource>/route.ts`:

```typescript
// apps/legacy/src/app/api/shifts/route.ts (temporary proxy)
const API_URL = process.env.API_URL ?? 'http://localhost:3001'

async function proxyToApi(request: Request, method: string) {
  const url = new URL(request.url)
  const targetUrl = `${API_URL}/api/shifts${url.search ? `?${url.searchParams}` : ''}`

  const body = ['GET', 'HEAD'].includes(method)
    ? undefined
    : await request.arrayBuffer()

  const res = await fetch(targetUrl, {
    method,
    headers: {
      cookie: request.headers.get('cookie') ?? '',
      // Forward the original content-type (including multipart boundary)
      'content-type': request.headers.get('content-type') ?? 'application/json',
    },
    body,
  })

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

export async function GET(request: Request) {
  return proxyToApi(request, 'GET')
}

export async function POST(request: Request) {
  return proxyToApi(request, 'POST')
}

export async function PATCH(request: Request) {
  return proxyToApi(request, 'PATCH')
}

export async function DELETE(request: Request) {
  return proxyToApi(request, 'DELETE')
}
```

For dynamic routes (e.g., `/api/shifts/[id]`), forward the `id` from `params`:

```typescript
// apps/legacy/src/app/api/shifts/[id]/route.ts
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${API_URL}/api/shifts/${params.id}`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
  })
  return new Response(res.body, { status: res.status, headers: res.headers })
}
```

When the React frontend page is ready and smoke-tested, delete the corresponding legacy route.

#### Legacy migration security checklist

During the strangler-fig migration, the legacy Next.js app remains reachable and may still expose routes with the CRIT-1 scoping gaps. Before the final DNS cutover:

1. Audit every route under `apps/legacy/src/app/api` and confirm it is either:
   - Migrated to Fastify with proper entity scoping, or
   - Proxied to Fastify and no longer queries the database directly.
2. Remove or disable any unmigrated route that writes data without entity scoping.
3. Verify the `access_token` cookie is set by Fastify and shared by both apps during the bridge.
4. Run the same auth test suite against both the legacy proxied routes and the new Fastify routes.

### Phase 1: Auth and shared infrastructure

1. Implement `POST /api/auth/login` and `POST /api/auth/register` in Fastify.
2. Implement the Fastify auth plugin with `canAccessEntity`, `requireAuth`, `requireRole`.
3. Set up `packages/shared` with user types and basic Zod schemas.
4. Implement the React + Vite `login` page and `useAuth()` hook.
5. Verify JWT cookie flow works end-to-end.

### Phase 2: CRUD resources

Migrate in this order:

1. `entities`
2. `areas`
3. `employees`
4. `requirements`
5. `rates`
6. `users`

For each:

1. Write repository, service, and Fastify routes.
2. Add Zod schemas to `packages/shared`.
3. Add backend tests for auth, scoping, and validation.
4. If the React page exists, update it to call Fastify.
5. Proxy the legacy Next.js route to Fastify so the old UI keeps working.

### Phase 3: Heavy endpoints

1. `shifts` (CRUD + copy-week)
2. `upload`
3. `budget`
4. `dashboard/coverage`
5. `dashboard/agency`

These require pagination, DB aggregation, bulk inserts, and/or background workers. Address each finding listed in section 8.

### Phase 4: Frontend cutover

1. Ensure all React pages are functional and match the Next.js pages.
2. Switch traffic from the Next.js app to the React + Vite app.
3. Remove `apps/legacy` (the old Next.js app).
4. Verify the full smoke test passes.

### Phase 5: Optimization and cleanup

1. Add missing indexes and remove redundant ones.
2. Tune Prisma pool.
3. Add rate limiting and request timeouts.
4. Add coverage snapshot or background worker if needed.
5. Update CI/CD.
6. Update LLM framework docs.

---

## 15. Validation checklist (dry-run criteria)

Before declaring the migration complete, verify:

- [ ] `pnpm install` succeeds at the root.
- [ ] `pnpm db:generate` produces the Prisma client.
- [ ] `pnpm build` builds all packages and apps.
- [ ] `pnpm dev` starts both frontend and backend.
- [ ] The legacy Next.js app (`apps/legacy`) remains deployable and passes its own build.
- [ ] Login sets an `HttpOnly` cookie and `GET /api/auth/me` returns the current user.
- [ ] No `prisma` imports exist in `apps/web`.
- [ ] No `src/app/api` routes remain in the final React + Vite app (legacy routes are proxied or removed).
- [ ] Every list endpoint returns `{ data, pagination }`.
- [ ] Every single-resource endpoint checks `canAccessEntity`.
- [ ] The upload endpoint validates file size, row count, and entity scoping.
- [ ] Bulk writes use `createMany` inside a transaction.
- [ ] Budget and coverage use DB aggregation, not JS loops.
- [ ] Missing `Shift` indexes are added.
- [ ] All backend tests pass.
- [ ] Full smoke test passes (login → entity → area → employee → shift → budget → coverage).
- [ ] Rollback to `main-legacy` succeeds and is documented.
- [ ] `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md`, and `MAINTENANCE.md` are updated.

---

## 16. Rollback strategy

### 16.1 Pre-migration baseline

Before starting Phase 0, create a `main-legacy` branch that contains the working Next.js app. This branch must be deployable at any time.

### 16.2 Per-phase rollback

| Phase | Rollback action |
|---|---|
| Phase 0 | Revert `apps/legacy/src/lib/prisma.ts` to use its own local Prisma client. Delete the monorepo root files. |
| Phase 0.5 | Remove proxy routes in `apps/legacy`. Point traffic back to the legacy API. |
| Phase 1 | Keep NextAuth running in `apps/legacy`; disable Fastify login routes. |
| Phase 2–3 | Delete the migrated Fastify route and re-enable the legacy Next.js route. |
| Phase 4 | Point DNS/load balancer back to `apps/legacy`. |

### 16.3 Production rollback trigger

If any phase causes production issues, the rollback is:

```bash
git checkout main-legacy
# or redeploy the `main-legacy` branch via Azure App Service
```

DNS/load balancer changes should be the last step in Phase 4, not the first. Until then, the legacy app remains warm and deployable.

---

## 17. Appendices

### Appendix A: TypeScript config

Use `tsconfig.json` in each package/app with `composite: true` for project references if needed, or keep them independent at first. Root `tsconfig.json` should only list references if using project references.

### Appendix B: Inter-package imports

Internal packages are referenced via workspace protocol:

```json
"dependencies": {
  "@nursing/db": "workspace:*",
  "@nursing/shared": "workspace:*"
}
```

TypeScript will resolve them via the `main`/`types` fields in each package's `package.json`.

### Appendix C: Common mistakes for LLMs to avoid

1. **Do not put Prisma in the frontend.** `apps/web` must never import `@nursing/db` or `@prisma/client`.
2. **Do not put business logic in Fastify routes.** Routes call services; services contain logic.
3. **Do not use `any`.** Every request body, query param, and response must be typed.
4. **Do not skip entity scoping.** Every route must call `request.canAccessEntity()` or `request.requireAdmin()`.
5. **Do not load unbounded lists.** Every `findMany` must have `skip`/`take`.
6. **Do not aggregate in JavaScript.** Use `groupBy`, `_sum`, `_count`, or raw SQL.
7. **Do not write bulk operations in loops.** Use `createMany` or a worker queue.

---

*End of spec. This document is intended to be executable by any LLM with the appropriate toolchain permissions. Before implementation, run a dry-run review to verify no steps are missing.*
