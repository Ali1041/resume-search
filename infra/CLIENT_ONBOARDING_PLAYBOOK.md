# Client Onboarding Playbook — "I have an app on my laptop" to "here's your URL"

**What this is:** the complete company process for a new client with a local
app — technical AND non-technical, in chronological order. Follow it top to
bottom; nothing here is optional unless marked.

**Time:** ~half a day for a brand-new org (mostly waiting on the client),
~1 hour if the org is already set up. The client's own effort: ~30 minutes.

---

## Stage 0 — The first conversation (~15 min, non-technical)

Goal: qualify the app and set expectations BEFORE promising anything.

**Ask them (the intake questions):**
1. What does the app do, in one sentence?
2. What's it built with? (You're listening for: Node or Python ✅ — anything
   else = custom quote)
3. Does it use a database? Which one? Do they have the server already?
4. Does it have background jobs/workers, a Dockerfile, or a monorepo setup
   (pnpm workspaces/turbo)? — **any YES = out of contract**, custom quote,
   do NOT proceed on this playbook
5. Do they have a GitHub account/organization? An Azure subscription?
6. Who pays for hosting — them (their Azure) or us (managed, on our bill)?

**Tell them (the expectation script):**
- "Your code lives in GitHub. You'll have two long-lived branches: `staging`
  and `main`. Merge to `staging` → your staging site updates. Merge to `main`
  → production updates. That's the whole workflow."
- "You never touch Azure, servers, or deploy scripts. That's our side."
- "First deploy takes about half a day. After that, every update is just a merge."
- "Databases and secrets are handled by us by hand — never put passwords in code."

**If out of contract (Q4 = yes):** stop here, quote a custom deployment, do not
force them through the automation.

## Stage 1 — Decisions (~10 min, with the client)

| Decision | Options | Default |
|---|---|---|
| Whose Azure? | Their subscription (they give us Contributor) / ours (managed hosting, we bill them) | Ours if they don't have one |
| Whose GitHub org? | Their existing org / we create one for them / (solo dev: their personal org) | Create `clientname-apps` with them owner, us owner |
| Scenario | A: slots, S1 ~$73/mo / B: separate staging apps, B1 ~$13/mo | B unless they ask for swap-to-prod |
| Secrets posture | Env-var (staging OK) / vault (prod required) | per README §4 |
| Region | data-residency answer | ask, don't assume |

Record everything in the intake block (NEW_ORG_CHECKLIST §0.5).

## Stage 2 — Foundations (~30 min, technical)

Run NEW_ORG_CHECKLIST Part 0 verbatim: accounts exist, operator access verified
(Contributor, Entra App Admin, GitHub org owner, DB admin if applicable),
decisions written down. **Do not proceed with anything missing** — every
skipped check becomes a mid-deploy stall.

## Stage 3 — Code to GitHub (~20 min, technical, ideally on a call with them)

1. Create the repo in the org (`<client>-<app>`), private.
2. Add the client as collaborator (write is enough).
3. Copy template files in (`infra/templates/app-repo/`): `azure-deploy.json`,
   `CLAUDE.md`, `.github/workflows/deploy.yml`. **We fill these in, not the
   client** — day one is not the day they learn the contract; the repo's
   CLAUDE.md teaches it over time.
4. Contract values from intake: runtime, startup command (we determine it from
   their code — e.g. `node dist/index.js` / gunicorn), health path, DB fields
   if applicable.
5. `staging` branch created and pushed. Chore PR opened to `staging`.

## Stage 4 — Platform + provision (~35 min for new org, ~6 min existing)

- New org: tfstate (5m) → platform apply (5m) → done.
- Deploy:
  ```bash
  export OPERATOR_OBJECT_ID=$(az ad signed-in-user show --query id -o tsv)
  export DEPLOY_SP_OBJECT_ID=<created-in-stage-5-below-or-existing>
  export BACKEND_CONFIG_ARGS="-backend-config=backend.hcl"
  infra/scripts/deploy.sh deploy https://github.com/<org>/<repo> \
    --app-name <org>-<app> --env staging --staging-mode app
  ```
  Type the app name at the gate. Smoke test exit 2 = expected (empty house).
- **Create ONLY what was requested** — staging-only for an app with existing
  prod means `--no-prod`.

## Stage 5 — Database + secrets (~15 min if app has a DB)

1. Create `<app>_staging` (+ `<app>_prod` when going to prod) on the DB server.
2. Firewall rule for operator IP; run migrations from the repo
   (`DATABASE_URL=... pnpm run db:push` or equivalent).
3. Secrets per posture decision: env-var overlay (local, uncommitted) or
   `az keyvault secret set` (vault mode).
4. OIDC (new org): app registration → SP → federated credentials for
   `staging` + `main` → Website Contributor on the app. **Never RG-level.**
5. GitHub secrets: org-level `AZURE_*` triple; repo-level `DATABASE_URL_*`.

## Stage 6 — First deploy (~10 min)

Merge the chore PR → watch Actions: build → migrate → deploy → green.
`curl -I https://<org>-<app>-staging.azurewebsites.net` (503 → restart once).
Click through the app yourself before the client does.

## Stage 7 — Handover (~10 min, non-technical)

Send **the handover message** (adapt, don't improvise):

> Your staging site is live: **https://\<org\>-\<app\>-staging.azurewebsites.net**
>
> How your workflow runs from here:
> - Work in a feature branch → open a PR into **`staging`** → merge → the
>   staging site updates itself in ~4 minutes.
> - When you're happy, PR **`staging` → `main`** → production updates.
> - The rules (also in your repo's CLAUDE.md): never push directly to `main`
>   or `staging`; database migrations are forward-only (never edit an old
>   one); never commit secrets — ask us and we'll set them.
> - If a deploy fails, the failing step is visible in your repo's Actions tab;
>   if it's not obvious, ping us — that's what we're here for.
>
> Production URL goes live the first time you merge to `main`: <prod URL or "on cutover">

Also give them: the support channel (Slack/email), and what ongoing care
looks like (we watch failures; you just merge PRs).

## Stage 8 — After the URL (the actual product)

- Client merges to `main` whenever → auto-deploy. **Zero contact needed.**
- Failure triage is OUR loop: every failure pattern becomes a preflight rule
  or doc fix same-week (README §6).
- Quarterly: review their usage/costs; scenario A/B upgrades are a
  one-variable change.

---

## Failure modes of THIS process (non-technical)

| Mistake | Cost | Prevention |
|---|---|---|
| Promising a deploy before Stage 0 qualification | Custom-app client forced through automation, days lost | Stage 0 Q4 is a hard gate |
| Letting the client fill the contract day one | Bad values, stalled run | We fill it at Stage 3 |
| Client in the Azure portal poking resources | Drift vs Terraform, "it changed itself" | They never get portal access (0.3) |
| Skipping the handover message | Client pushes to main directly, breaks prod, blames us | Stage 7 verbatim |
| No named operator per org | "who runs deploy.sh this week?" | Intake block, one name |
