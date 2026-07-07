# Schema Audit — Nursing Scheduler

## Model Inventory & Index Analysis

### `User` (`prisma/schema.prisma`, lines 52–66)

- **Fields:** `id` (PK), `email` (unique), `name`, `password`, `role`, `status`, `createdAt`, `updatedAt`
- **Indexes:**
  - `@@index([email])` (line 64) — **redundant** because `email` is already `@unique` (line 54)
  - `@@index([status])` (line 65)
- **Missing indexes for scale:**
  - `[role]` — every admin/manager check filters by role
  - `[role, status]` — common "active managers/admins" query pattern

### `Entity` (`prisma/schema.prisma`, lines 68–92)

- **Fields:** `id` (PK), `name`, `code` (unique), `type`, `parentId`, `notes`, `isActive`, `createdAt`, `updatedAt`
- **Indexes:**
  - `@@index([code])` (line 90) — **redundant** because `code` is already `@unique` (line 71)
  - `@@index([parentId])` (line 91)
- **Missing indexes for scale:**
  - `[isActive]` — dashboard/schedule pages repeatedly filter active entities
  - `[type]` — hierarchy queries filtering parents vs. standalone
  - `[isActive, type]` — combined active-parent/active-standalone filters

### `UserEntityAssignment` (`prisma/schema.prisma`, lines 94–105)

- **Fields:** `id` (PK), `userId`, `entityId`
- **Indexes:**
  - `@@unique([userId, entityId])` (line 102)
  - `@@index([userId])` (line 103) — partially redundant; the unique index on `[userId, entityId]` already supports `userId` prefix lookups
  - `@@index([entityId])` (line 104)
- **Missing indexes for scale:**
  - None critical; the current covering set handles the two access patterns ("entities for user" and "users for entity")

### `Area` (`prisma/schema.prisma`, lines 107–119)

- **Fields:** `id` (PK), `name`, `entityId`, `isActive`, `sortOrder`
- **Indexes:**
  - `@@index([entityId])` (line 118)
- **Missing indexes for scale:**
  - `[entityId, isActive]` — schedule grid loads active areas per entity
  - `[entityId, isActive, sortOrder]` — ordered active-area lists

### `Employee` (`prisma/schema.prisma`, lines 121–142)

- **Fields:** `id` (PK), `name`, `role`, `employmentType`, `employeeId`, `email`, `phone`, `notes`, `isActive`, `createdAt`, `updatedAt`
- **Indexes:**
  - `@@index([isActive])` (line 139)
  - `@@index([role])` (line 140)
  - `@@index([employmentType])` (line 141)
- **Missing indexes for scale:**
  - `[role, employmentType, isActive]` — roster filtering almost always combines these three columns
  - `[isActive, role]` / `[isActive, employmentType]` — active-staff vs. active-agency lookups
  - `[name]` — employee search/autocomplete will table-scan without it

### `EmployeeEntityEligibility` (`prisma/schema.prisma`, lines 144–155)

- **Fields:** `id` (PK), `employeeId`, `entityId`
- **Indexes:**
  - `@@unique([employeeId, entityId])` (line 152)
  - `@@index([employeeId])` (line 153) — partially redundant due to the unique index prefix
  - `@@index([entityId])` (line 154)
- **Missing indexes for scale:**
  - None critical; existing unique + FK indexes cover the two query directions

### `StaffingRequirement` (`prisma/schema.prisma`, lines 157–173)

- **Fields:** `id` (PK), `entityId`, `areaId`, `startTime`, `endTime`, `daysOfWeek`, `isActive`, `createdAt`, `updatedAt`
- **Indexes:**
  - `@@index([entityId])` (line 171)
  - `@@index([areaId])` (line 172)
- **Missing indexes for scale:**
  - `[entityId, areaId, isActive]` — the main "active requirements for this entity/area" query
  - `[isActive]` — global active-requirement filters
  - `[entityId, isActive]` / `[areaId, isActive]` — partial combined filters

### `Shift` (`prisma/schema.prisma`, lines 175–196)

- **Fields:** `id` (PK), `entityId`, `areaId`, `employeeId`, `date`, `startTime`, `endTime`, `notes`, `isOpen`, `requirementId`, `createdAt`, `updatedAt`
- **Indexes:**
  - `@@index([entityId, date])` (line 193)
  - `@@index([employeeId])` (line 194)
  - `@@index([date])` (line 195)
- **Missing indexes for scale (this is the high-volume table at 50k+ shifts/month):**
  - `[areaId]` — every schedule cell/area view filters by area; currently requires a lookup through `[entityId, date]` or table scan
  - `[entityId, areaId, date]` — the core schedule-grid query
  - `[entityId, employeeId, date]` — employee schedule lookups and cost rollups
  - `[date, isOpen]` / `[entityId, isOpen, date]` — open-shift board queries
  - `[requirementId]` — linking generated shifts back to their staffing requirement
  - `[employeeId, date]` — weekly hour/cost aggregations per employee
  - `[entityId, date, isOpen]` — entity-scoped open-shift filtering

### `RateCard` (`prisma/schema.prisma`, lines 198–208)

- **Fields:** `id` (PK), `entityId` (unique), `rnStaff`, `rnAgency`, `lpnStaff`, `lpnAgency`, `updatedAt`
- **Indexes:**
  - `entityId @unique` (line 200) — creates an implicit unique index
- **Missing indexes for scale:**
  - None; one-to-one with `Entity`

### `BudgetTarget` (`prisma/schema.prisma`, lines 210–218)

- **Fields:** `id` (PK), `entityId` (unique), `dollarTarget`, `budgetBasis`, `updatedAt`
- **Indexes:**
  - `entityId @unique` (line 212) — creates an implicit unique index
- **Missing indexes for scale:**
  - None; one-to-one with `Entity`

### `TimeOff` (`prisma/schema.prisma`, lines 220–232)

- **Fields:** `id` (PK), `employeeId`, `startDate`, `endDate`, `reason`, `createdAt`
- **Indexes:**
  - `@@index([employeeId])` (line 230)
  - `@@index([startDate, endDate])` (line 231)
- **Missing indexes for scale:**
  - `[employeeId, startDate, endDate]` — overlap checks for a single employee
  - `[startDate, endDate]` alone does not efficiently support "is this employee off on date X?"

### `RecurringAssignment` (`prisma/schema.prisma`, lines 234–251)

- **Fields:** `id` (PK), `employeeId`, `entityId`, `areaId`, `startTime`, `endTime`, `dayOfWeek`, `isActive`, `startDate`, `endDate`, `createdAt`
- **Indexes:**
  - `@@index([employeeId])` (line 249)
  - `@@index([entityId])` (line 250)
- **Missing indexes for scale:**
  - `[employeeId, entityId, areaId, isActive]` — the main "active recurring assignments for this employee/entity/area" query
  - `[isActive]` — global active-recurring filters
  - `[entityId, areaId, isActive]` — entity/area recurring assignment lists

## Summary of Critical Missing Indexes

| Model | Missing Index | Why It Matters at Scale |
|-------|---------------|------------------------|
| `Shift` | `[areaId]` | Area-scoped schedule views are extremely common |
| `Shift` | `[entityId, areaId, date]` | Core schedule-grid fetch pattern |
| `Shift` | `[entityId, employeeId, date]` | Employee schedules, payroll, cost rollups |
| `Shift` | `[date, isOpen]` / `[entityId, isOpen, date]` | Open-shift board |
| `Shift` | `[employeeId, date]` | Weekly hours/cost aggregation per employee |
| `Shift` | `[requirementId]` | Link generated shifts to requirements |
| `Employee` | `[role, employmentType, isActive]` | Roster filtering combines all three |
| `Employee` | `[name]` | Employee search/autocomplete |
| `StaffingRequirement` | `[entityId, areaId, isActive]` | Active requirement lookup per entity/area |
| `Area` | `[entityId, isActive]` | Active area list per entity |
| `RecurringAssignment` | `[employeeId, entityId, areaId, isActive]` | Active recurring assignment lookup |
| `TimeOff` | `[employeeId, startDate, endDate]` | Employee date-overlap checks |
| `Entity` | `[isActive]` / `[isActive, type]` | Active-entity / hierarchy filtering |
| `User` | `[role]` / `[role, status]` | Role-based access queries |

## Redundant Indexes to Consider Removing

- `User.@@index([email])` — duplicate of `@unique` on `email` (line 54 / line 64)
- `Entity.@@index([code])` — duplicate of `@unique` on `code` (line 71 / line 90)
- `UserEntityAssignment.@@index([userId])` — covered by `@@unique([userId, entityId])` prefix (line 102 / line 103)
- `EmployeeEntityEligibility.@@index([employeeId])` — covered by `@@unique([employeeId, entityId])` prefix (line 152 / line 153)

## Note

This audit is documentation-only. No schema or application code was modified.
