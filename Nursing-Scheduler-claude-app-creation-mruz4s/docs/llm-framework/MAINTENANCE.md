# Nursing Scheduler — LLM Framework Maintenance

**Last reviewed:** 2026-07-09

**Load this file when:** you need to know whether a code change requires updating the LLM docs, or how to recover from an incorrect guardrail.

---

## Doc-impact check

The following changes require updating one or more LLM docs before the PR is considered complete. If a change is purely presentational (CSS, labels, icons) with no data or auth impact, it usually does not need a doc update.

| Change type | Docs to update | What to update |
|---|---|---|
| Authentication or session shape | `CLAUDE.md`, `AGENTS.md`, `PLAYBOOKS.md` | RBAC rules, role meanings, session field usage, Fastify auth plugin helpers |
| Entity hierarchy or `EntityType` | `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md` | Hierarchy rules, roll-up behavior, parent/standalone red lines |
| Prisma migrations (forward-only or destructive) | `CLAUDE.md`, `AGENTS.md` | Migration rules, destructive-change policy, `packages/db` location |
| Monorepo package layout or workspace boundaries | `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md` | Package ownership, import boundaries, frontend/backend separation |
| Backend architecture change (new service, migration of routes) | `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md` | Boundary rules, route ownership, Fastify conventions |
| Rate card, budget, or hours math | `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md` | Data model red lines, roll-up mechanics |
| API contract changes (new routes, pagination, response shape) | `CLAUDE.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md` | Route conventions, pagination envelope, error handling |
| New security boundary or RBAC change | `PLAYBOOKS.md` | Security playbook, scoping patterns, Fastify auth decorators |
| Performance fix (index, aggregation, bulk write) | `PLAYBOOKS.md`, `SCALABILITY_CRITIQUE.md` | Update the relevant finding or playbook rule |
| Known technical debt is resolved | `ARCHITECTURE.md` | Remove or mark the debt item as resolved |

---

## Three-touch rule

- If the same pattern is touched 2–3 times without a corresponding doc update, update the relevant doc before the next feature.
- "Touched" means the pattern is modified, copied to a new file, or referenced in a new way.
- Examples:
  - Adding a third unbounded `findMany` list endpoint means it is time to add the pagination playbook rule or update the critique finding.
  - A second route bypassing entity scoping means the security playbook needs a stronger example or a fix to the known-debt list.

---

## Quarterly compact review

Every quarter, one owner should review the LLM docs and perform the following:

1. **Trim `CLAUDE.md` and `AGENTS.md`.**
   - Remove details that are only needed for architectural work. Move them to `ARCHITECTURE.md`.
   - Remove code examples that are now duplicated in `PLAYBOOKS.md`.
   - Ensure the non-negotiables are still prominent and accurate.
2. **Verify cross-links.**
   - All links from `CLAUDE.md` to `docs/llm-framework/*.md` must exist and be accurate.
   - `AGENTS.md` must mirror `CLAUDE.md` core rules without stale divergence.
3. **Refresh `Last reviewed:` dates.**
   - Update the date in every LLM doc that changed.
4. **Reconcile with `docs/SCALABILITY_CRITIQUE.md`.**
   - If a finding was fixed, move it from "Known technical debt" to a resolved section or remove it.
   - If a new pattern matches an existing finding, update the finding and add a reference.

---

## Version hooks

### `Last reviewed:` header

Every LLM doc must include a `Last reviewed:` header near the top:

```markdown
**Last reviewed:** 2026-07-09
```

Update this date every time the file is meaningfully changed. Trivial typo fixes do not require a date change; adding rules, examples, or findings does.

### Changelog

Keep a brief changelog in this file (`MAINTENANCE.md`). Each entry should include the date, the changed file(s), and a one-line reason. Example format:

```markdown
### Changelog

- **2026-07-07** — Created `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md`, `MAINTENANCE.md`, and `docs/SCALABILITY_CRITIQUE.md` from the 2026-07-07 scalability critique and LLM framework plan.
- **2026-10-07** — Added pagination playbook rule after `GET /api/shifts` was paginated.
- **2026-10-07** — Removed entity-scoping debt item from `ARCHITECTURE.md` after fixing `PATCH /api/areas/[id]`.
```

---

## Error recovery for incorrect guardrails

If an LLM (or a human) discovers that a guardrail in these docs is wrong, outdated, or misleading:

1. **Stop propagating the bad rule.** Do not copy it into new code or other docs.
2. **Fix the doc in a focused PR.**
   - Update the rule in the relevant file(s).
   - Add or update the `Last reviewed:` date.
   - Add a changelog entry in this file explaining the correction.
3. **Audit the codebase for damage.**
   - Search for code that followed the bad rule.
   - File follow-up issues or PRs to fix affected code separately; do not mix doc fixes with large code refactors unless the fix is trivial.
4. **Escalate if the error crosses boundaries.**
   - If the bad rule affects auth, entity scoping, migrations, or data integrity, escalate to the project owner or a senior reviewer before closing the issue.
5. **Add a regression test where possible.**
   - If the rule was about Zod validation, add a test case for the invalid input.
   - If the rule was about RBAC, add an authorization test for the affected route.

---

## Changelog

- **2026-07-07** — Created `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md`, `MAINTENANCE.md`, and `docs/SCALABILITY_CRITIQUE.md` from the 2026-07-07 scalability critique and LLM framework plan.
- **2026-07-07** — Added finding IDs and CRIT-3 (upload scoping/file limits) to `docs/SCALABILITY_CRITIQUE.md`; propagated CRIT-3 to `ARCHITECTURE.md` and `PLAYBOOKS.md` after security audit.
- **2026-07-07** — Added section 8 to `docs/SCALABILITY_CRITIQUE.md` recommending a dedicated backend service; updated `ARCHITECTURE.md`, `PLAYBOOKS.md`, `CLAUDE.md`, `AGENTS.md`, and `MAINTENANCE.md` to reflect the backend-for-frontend architecture.
- **2026-07-09** — Updated `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`, `PLAYBOOKS.md`, and `MAINTENANCE.md` to reflect the Fastify + React + Vite pnpm-workspace monorepo architecture described in `docs/specs/2026-07-09-fastify-monorepo-migration.md`.
