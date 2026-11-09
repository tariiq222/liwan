# Parallel work and workspace operations

واجهة العميل: [DESIGN.md](../DESIGN.md). التقارير المؤرخة ليست تعليمات واجهة.

LiwanOS uses temporary worktrees for bounded tasks. The canonical checkout is `/Users/tariq/code/webvue` on `main`; a task worktree is not a
permanent product pillar checkout. One writer owns each file. One orchestrator
owns shared files, Git integration, runtime state, and final verification.

## Checkout and delivery context

Use [WORKSPACE.md](WORKSPACE.md) for the checkout map and delivery records;
verify the selected branch and working tree before starting. Historical
integration and recovery reports describe their own checkpoints only.

Account administration belongs to the access capability domain; HR archival
can disable a linked account but cannot grant roles or reactivate access.
Customer branding settings edit only the primary colour; Odoo system administrators
own institution identity. PMO collaboration preserves record and company guards.

## File ownership

| Surface | Shared | PMO | HR |
| --- | --- | --- | --- |
| Odoo addon | `liwan_core` (access, system groups), `liwan_platform`, `liwan_api`, `liwan_notify` (bell), `liwan_directory` (people picker); each app owns its capability groups | `liwan_pmo`; meetings `liwan_meetings`; bridge `liwan_meetings_pmo` | `liwan_hr` |
| Controllers and serializers | `liwan_api` common/auth/branding/me/attachment, `liwan_notify` bell routes, `liwan_directory` people route | `liwan_pmo/**`, `liwan_meetings/**`, `liwan_meetings_pmo/**` | `liwan_hr/**` |
| Tests | shared fixture, `liwan_api`, `liwan_notify` and `liwan_directory` tests | `liwan_pmo/tests/**`, `liwan_meetings/tests/**`, `liwan_meetings_pmo/tests/**` | `liwan_hr/tests/**` |
| Contracts | `packages/contracts/src/common/**` | `packages/contracts/src/pmo/**` | `packages/contracts/src/hr/**` |
| Locale namespace | `common.json` | `tasks.json`, `projects.json`, `settings.json` | `hr.json` |
| Web surface | layout, UI primitives, `useApi`, `useMe`, `useBranding` | task/project pages and `components/pmo/**` | `/hr`, HR composables/components |

Every other application (a rank-4 addon in `tools/arch_layers.json`) and every bridge (rank 5) owns, in
the same way as the columns above, its own addon folder, its `packages/contracts/src/<app>/**` namespace,
its locale namespace and its `apps/web` `pages/` and `components/` folders (`web_apps` in the same file). The rank
list in `tools/arch_layers.json` is the single source; the table is not extended per application.

Vendor administration and the shared UI layers have their own owners; none of them is an Odoo pillar:

| Surface | Owner | Notes |
| --- | --- | --- |
| `apps/vendor-admin` | vendor administration (git area `cp`) | Pages, BFF routes, e2e and `i18n` of the staff console. Imports only the shared UI layers and `@liwan/commercial-contracts` (rule `VA1`). |
| `packages/ui` | shared design layer | Tokens, theme, shell, presentational components. Shared by `apps/web` and `apps/vendor-admin`; a change needs both apps' checks (rule `UI1`). |
| `packages/commercial-ui` | shared billing presentation | Price breakdown and invoice components. Extends `@liwan/ui`; used by both apps (rule `UI1`). |

`liwan_directory` owns `/api/v1/people` (the user-id picker; its `id` is a
`res.users` id) and its feature keys are registered by the applications that
pick people. HR owns `/api/v1/hr/*`, where employee records use `hr.employee`
ids. Keep these contracts separate.

## Shared-file protocol

Application web surfaces and locale files are discovered automatically
(`apps/web/app/modules/<app>/manifest.ts`, `apps/web/i18n/locales/{ar,en}/<name>.json`),
so adding an application edits no navigation or `nuxt.config.ts` file. Only the
orchestrator edits these shared integration points, or coordinates a single
one-line addition from the owning team:

- `tools/arch_layers.json` — the addon rank (weakening it needs the owner's approval).
- The active release catalog under `deploy/catalog/solutions/` — currently `deploy/catalog/solutions/platform_v4.json`, selected by `tools/catalog_check.py::current_release`; follow `docs/agents/odoo-rules.md` for publication and versioning. Older catalogs are not the registration target.
- `packages/contracts/src/index.ts` — one pillar barrel export.
- The release module lists in `deploy/provision.sh`, `deploy/check_isolated.py` and `deploy/OPERATIONS.md`
  are synced from the catalog by `python3 -B tools/catalog_check.py --sync-release-copies`; do not edit them
  by hand. A new application's registration files and the sync are described in `docs/agents/odoo-rules.md`
  (`tools/new_app.py`).
- `apps/web/i18n/locales/{ar,en}/common.json` — shared navigation labels.

Merge/integrate a pillar before touching a shared file. Do not edit another
pillar's controllers, serializers, tests, components, composables, contracts,
or locale namespace to make integration convenient. A new feature that needs a
shared change must state the contract and the single writer before work starts.

## Starting a task

1. Inspect the selected worktree's branch, status, remotes, and changed paths.
   Preserve unrelated edits. Use any normal task branch name (for example `<area>-<slug>`).
2. Decide file ownership and list collisions before editing. Keep dependent
   work sequential; run independent slices in separate worktrees.
3. Give each worktree independent `node_modules` and `.nuxt` directories. Use
   `npm ci --ignore-scripts`; if offline, use the available local npm cache.
   Never symlink dependency or generated-state directories between worktrees.
4. Give each worktree its own `NUXT_ODOO_URL`, `NUXT_ODOO_DB`, `NUXT_PUBLIC_WS_URL`, Nuxt port and Odoo
   HTTP port. They live in the git-ignored `.env.worktree`; `npm run dev` (`tools/dev_web.mjs`) reads that
   file and rejects command-line overrides, so do not pass `--port` or export those variables by hand.

`npm run wt -- new <area>-<slug> --owner <who> --task <what> --scope <path>` performs the worktree
creation, steps 3 and 4 (ports and scratch database name are written to `.env.worktree`) and the
ownership claim in one command (`tools/wt.py`).

### Worktree rules

These rules apply to every worktree created from 2026-10-20 on, by a person, a Codex task or a Claude
session or subagent. A worktree that predates them is reported by `wt check`, never moved, renamed or
removed by it; its owner records a claim with `wt claim` or finishes and merges it as it is.

1. **One location.** Task worktrees live only in `<main checkout>/.worktrees/<area>-<slug>` (git-ignored),
   where `wt new` creates them, also when run from another worktree. Never create one with a bare
   `git worktree add`, under `../liwan-wt/`, or in a tool's own folder (the Claude app's `worktrees` folder under `.claude`); a
   Claude subagent or session that needs isolation runs `wt new` instead of its built-in worktree option.
2. **One name.** Any valid Git branch name is accepted; descriptive names are recommended.
   `wt new <suffix>` creates branch `codex/<suffix>` and folder `.worktrees/<suffix>`.
   Other valid task branch names may be claimed; `wt check` checks their folder suffix and claim.
   In `AGENTS.md` and `docs/agents/integration-rules.md`, `<prefix>/...` for an integration candidate
   means `codex/...`, the prefix `wt new` adds (for example `codex/tools-integrate-<slug>`).
   Throwaway `spike/<slug>` experiments are created with plain `git switch -c spike/<slug>` (`wt new` only
   makes `codex/` branches) and are never merged.
3. **One base.** `main` is the default `--base`; any valid branch name is accepted.
   Use the agreed integration branch for a dependent lane.
   Fetch and compare local `main` with `origin/main` first. When local `main` is dirty or stale,
   preserve it; after creation update the clean task candidate to the recorded remote baseline
   before implementation. Do not call the default local base current without checking.
4. **One owner.** Every worktree has a claim: its owner (session, agent or person), its task and the
   workspace-relative paths it will change (`--scope`, repeatable; `.` is the whole repository, used by an
   integration worktree). The claim lives in the worktree's own git directory, so it is never tracked and
   goes away with the worktree.
5. **No silent overlap.** `wt new` and `wt claim` refuse scopes that overlap another worktree's active claim.
   `--allow-overlap "<reason>"` is the explicit permission: use it only after agreeing with the other
   owner; the reason is stored in the claim and shown by `wt status`.
6. **Expiry.** A claim with no commit, no edited file and no refresh for 24 hours is expired: it is still
   listed, but no longer blocks. Its owner refreshes it with `wt claim --owner <same owner>`; another owner
   may take over an expired claim with `wt claim`, never an active one.

`npm run wt -- check` reports every worktree that breaks a rule and exits 1 when there is one; it only reads.
`npm run wt -- status` answers "which worktrees exist, who owns them, which are merged, which are dirty"
and ends with the same report; it marks a worktree outside `.worktrees/` with `*`. `npm run wt -- gc` lists
what is safe to remove (merged, clean, behind `main`, no process inside) and `--apply` removes it; after a merge that falls under
the standing authorization in [integration-rules.md](agents/integration-rules.md#standing-authorization-owner-decision-2026-11-08), and any other removal needs the owner.

These are workflow rules carried by the tool, not an operating-system lock: a bare `git worktree add` or
an edit outside the claimed scopes is still possible. `wt check` makes it visible; the integration checks
in `docs/agents/integration-rules.md` remain the binding gate.

The Odoo checkout at `/Users/tariq/code/odoo` is upstream and its source,
configuration, and Git state are read-only. Source inspection and read-only Git
audits there are allowed. Authorized test or development commands may mutate an
explicitly isolated scratch database; do not operate on arbitrary databases or
run tests against the dev `liwan_dev` database. Start Odoo with the selected LiwanOS
worktree's addons path explicitly, an isolated scratch database, and a unique
`--http-port`.

For example, for a worktree at `/path/to/liwan-worktree`:

```sh
cd /Users/tariq/code/odoo
# Use a scratch-only config; data_dir and logfile stay outside this checkout.
.venv/bin/python odoo-bin -c /absolute/path/to/scratch-only.conf \
  --addons-path=/Users/tariq/code/odoo/addons,/path/to/liwan-worktree/odoo-addons,$(python3 -B /path/to/liwan-worktree/tools/oca_addons.py path) \
  -d liwan_scratch_example --http-port=8171

# Match Odoo's database and port above to the allocated .env.worktree profile.
cd /path/to/liwan-worktree
npm run dev
```

The ordinary local development topology is Odoo `:8069` and Nuxt `:3000`. Port `3100` is reserved for
`apps/vendor-admin` (its default, see its README) and `3103` for its live-proof build.
The allocator excludes both for new `apps/web` worktrees, even when idle; existing `.env.worktree`
allocations remain unchanged. `npm run dev` loads that worktree file automatically. Install independent
local dependencies and regenerate Nuxt files first; main uses its private apps/web/.env configuration.
The Odoo database/port above are placeholders; match the allocated `.env.worktree` values before launch. Worktree dev rejects CLI overrides. Check current worktree claims before selecting values. Use distinct database, Odoo port, Nuxt port, and log paths for concurrent
worktrees. Temporary integration values are disposable and must not be
presented as production evidence.

## Generated files and integration branches

The generated API files (openapi.json and route-capabilities.json in docs/api) are produced by
`python3 tools/api_surface.py`. A task branch (any name other than an integration branch) never commits either file:
`tools/git_policy.py` refuses such a commit, because every parallel branch that touched them would
conflict. The orchestrator regenerates both once, on the integration branch
`<prefix>/tools-integrate-<slug>` (the only branches allowed to carry them), after merging
the task branches, and runs `python3 tools/api_surface.py --check` there. The per-branch route gate is
`tools/route_gate_policy.py`, run inside `npm test`: it needs no generated file.

## Finishing a task

Use [integration-rules.md](agents/integration-rules.md) for delivery: one draft PR
per independent task or agreed integration batch, followed by review, checks and
a protected merge under the standing authorization after current-head `ci-result`
and review of the actual combined diff. CI does not repair code, merge PRs or create tags. `wt status` compares ancestry with **local** `main`; when it is stale, compare
with current remote `main` too. A merged head with dirty files still contains
undelivered work. A child sharing its parent's head is dependent work, not a
second independent delivery.

The task owner reports the files changed and verification evidence. The
orchestrator resolves shared-file conflicts, verifies the combined candidate
under the [local verification policy](testing.md#fast-local-loop), and records
the resulting branch and runtime state. A passing local
test, health endpoint, or UI observation proves only the checked layer; it does
not prove deployment, DNS, or release approval.

The LiwanOS Git remote is `origin` (`https://github.com/tariiq222/liwan.git`),
tracked by `main`. Push task branches under the standing authorization; `main` changes only
through a merged PR; never force-push published history, and do not imply that a push occurred. Do not remove a
branch or worktree until its content is preserved and no process is using it. A production deployment or DNS cutover
requires separate authorization; local `:8069`/`:3000` development is not
production evidence.
