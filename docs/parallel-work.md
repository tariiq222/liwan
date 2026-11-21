# Parallel work and workspace operations

واجهة العميل: [DESIGN.md](../DESIGN.md). التقارير المؤرخة ليست تعليمات واجهة.

LiwanOS development runs in a pool of lanes (owner decision 2026-11-16, replacing the four named lanes of
2026-11-13). A lane is a permanent worktree under `/Users/tariq/code/liwan/.worktrees/`. One task is one
branch, one lane and one writing session, whichever tool the session runs (Claude, Codex or OpenCode).
The main checkout `/Users/tariq/code/liwan` rests on `main` and
belongs to the owner, for manual testing and the one running development stack; no agent develops in it.
One writer owns each file. One orchestrator
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

1. Inspect the lane's branch, status, remotes, and changed paths. Preserve unrelated edits.
   Use any normal task branch name (for example `<area>-<slug>`).
2. Decide file ownership and list collisions before editing. Keep dependent work in one branch and one
   session; independent tasks go to separate lanes.
3. Take a lane with `npm run wt -- take <branch> --owner <who>` (see "Lane pool"). The lane already has its
   own `node_modules`, `.nuxt`, ports and scratch database name, so there is nothing else to set up.
4. Each lane has its own `NUXT_ODOO_URL`, `NUXT_ODOO_DB`, `NUXT_PUBLIC_WS_URL`, Nuxt port and Odoo
   HTTP port. They live in the git-ignored `.env.worktree`; `npm run dev` (`tools/dev_web.mjs`) reads that
   file and rejects command-line overrides, so do not pass `--port` or export those variables by hand.
   Never symlink dependency or generated-state directories between worktrees.

### Lane pool

A lane is any worktree under `<main checkout>/.worktrees/` that holds a take record
(the file liwan-take.json in its git directory: branch, holder, task, `taken_at` and the hash of
`package-lock.json` at the last install). Lanes have no fixed names and no tool split. The number of lanes
is the owner's choice and grows with `lane add`.

| Command | What it does |
| --- | --- |
| `npm run wt -- lane add <name> [--owner X --task Y] [--no-install]` | Creates a new lane from the fetched `origin/main` and prepares it: ports, scratch database name, `.env.worktree` and dependencies. Given an existing worktree folder under `.worktrees/`, it adopts that folder in place: it records the folder's current branch with `--owner` and `--task` and deletes the old lane and claim record files. |
| `npm run wt -- take <branch> --owner <who> [--task <what>] [--lane <name>]` | Takes the named lane, or the first resting clean one. Fetches `origin/main`, creates the branch from it (or switches to the local branch when it exists, which resumes a parked task), records the holder, reinstalls dependencies when `package-lock.json` changed since the last install, and prints the lane path. Refuses `main` and `HEAD`, an occupied or dirty lane, and reports "no free lane" with the holders and a pointer to `lane add`. |
| `npm run wt -- done [--lane <name>] [--park]` | Needs a clean tree. Without `--park` the branch must be merged into `origin/main`: the lane detaches to `origin/main`, the local branch is deleted and the record is emptied. With `--park` the local branch stays and the lane rests; resume later with `take <branch>`. |
| `npm run wt -- status` | Lists lanes with holder, branch, ahead/behind, dirty state, ports and database, then a "shared files" section with the files changed in two occupied lanes at once. It only reports. |
| `npm run wt -- check` | Read-only; exit 1 on a violation. See the rules below. |
| `npm run wt -- lane remove <name>` | Removes a resting, clean lane (a parked branch survives as a local branch and can be taken again). Refuses an occupied, dirty, missing or in-use lane; drops the lane's scratch database when nobody is connected. |
| `npm run wt -- gc [--apply] [--branch ...]` | Cleans merged, clean, idle worktrees that are not lanes (leftovers from before the pool). It never removes a lane. |

Rules:

1. **One writing session per lane.** The session that takes a lane is its only writer, whatever the tool.
   Subagents of that session work in the same lane under its direction. Read-only and review sessions take no
   lane. Two sessions never write in one lane, and no agent develops in the main checkout.
2. **Open the tool in the lane.** Each tool starts with the lane folder as its working directory and its
   built-in worktree option off. No tool-owned worktree (the Claude app's `worktrees` folder under `.claude`
   and the like) is created.
3. **Free use of Git inside the lane.** On its own unpublished branch a session may use any git command
   (stash, reset, rebase and amend included). Published history is never rewritten, and a push, a PR, a
   merge and an auto-merge still need the owner's explicit words.
4. **One schema writer per addon.** A schema change (version bump and migration) of one addon stays in one
   lane. `wt check` fails when two lanes both change the same `odoo-addons/<addon>/migrations/`.
5. **Shared files.** `wt status` lists files changed in two occupied lanes at once. Report only: the
   coordinating session follows the shared-file protocol above and merges `origin/main` into its branch
   before the PR.
6. **Checks.** The session runs the focused checks of its own paths, and the combined branch's checks once,
   on a clean tree, before the PR.
7. **Batching.** Small finished branches are batched at delivery in one `<prefix>/tools-integrate-<slug>`
   branch and one PR; a sensitive task (money, authorization, schema or migrations, security, tenant
   isolation) gets its own PR. Delivery steps are in [integration-rules.md](agents/integration-rules.md).

`wt check` exits 1 on:

- a worktree that is neither the main checkout nor a lane;
- a lane whose checked-out branch differs from its record;
- an occupied lane with no holder;
- two lanes that both change the same `odoo-addons/<addon>/migrations/`.

The pre-commit guard (`tools/hooks.py`) runs for every tool. It refuses a commit on `main`; in a lane it
refuses when the lane is resting or the branch differs from the record; in a linked worktree with no take
record it refuses and names `wt lane add` and `wt take`. It has no session identity and no path check. During a rebase in a lane it compares the rebase's branch
to the record.
It is a commit-time check, not a lock: Git has no hook that stops a branch switch, so `wt check` reports a
lane that left its branch.

Rollout: an existing worktree is adopted with `lane add` only when it rests, or after its branch has merged
the new `main`. An older branch runs its own older copy of the hook.

### Other worktrees

Never create another worktree (no `git worktree add`, no tool-owned worktree folder) unless the owner asks
for one in words for that task. `wt check` reports it, and the pre-commit guard refuses a commit in it. A
worktree the owner asks for is a lane too: add it with `npm run wt -- lane add <name> [--owner X --task Y]`
and remove it when it rests and is clean with `npm run wt -- lane remove <name>` (a parked branch survives as a local branch and can be taken again). `lane remove` refuses an
occupied, dirty, missing or in-use lane, removes the worktree and drops its scratch database when nobody is
connected. Throwaway `spike/<slug>` experiments use plain
`git switch -c spike/<slug>` inside a lane and are never merged.

`npm run wt -- check` only reads. `npm run wt -- gc` never removes a lane. It lists the non-lane worktrees
left from before the pool (merged, clean, no process inside) and `--apply` removes them; after a merge that falls under
the standing authorization in [integration-rules.md](agents/integration-rules.md#standing-authorization-owner-decision-2026-11-11), and any other removal needs the owner.

These are workflow rules carried by the tool, not an operating-system lock: a bare `git worktree add` is
still possible. `wt check` makes it visible; the integration checks
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
The Odoo database/port above are placeholders; match the allocated `.env.worktree` values before launch. Worktree dev rejects CLI overrides. Check `wt status` for the ports and databases of the other lanes before selecting values. Use distinct database, Odoo port, Nuxt port, and log paths for concurrent
worktrees. Temporary integration values are disposable and must not be
presented as production evidence.

## Generated files and integration branches

The generated API files (openapi.json and route-capabilities.json in docs/api) are produced by
`python3 tools/api_surface.py`. A task branch (any name other than an integration branch) never commits either file:
`tools/git_policy.py` refuses such a commit, because every parallel branch that touched them would
conflict. The orchestrator regenerates both once, on the integration branch
`<prefix>/tools-integrate-<slug>` (the only branches allowed to carry them), after merging
the task branches, and runs `python3 tools/api_surface.py --check` there. Staleness is detected by a full manual CI
dispatch and by `npm run check:fast`, never by pull-request CI. The per-branch route gate is
`tools/route_gate_policy.py`, run inside `npm test`: it needs no generated file.

## Finishing a task

Use [integration-rules.md](agents/integration-rules.md) for delivery: one draft PR
per independent task or agreed integration batch, opened after the independent review that
precedes every push, followed by checks and
a protected merge on the owner's explicit words after current-head `ci-result`
and review of the actual combined diff. CI does not repair code, merge PRs or create tags. `wt status` compares ancestry with **local** `main`; when it is stale, compare
with current remote `main` too. A merged head with dirty files still contains
undelivered work. A child sharing its parent's head is dependent work, not a
second independent delivery.

After the merge, the session returns its lane with `wt done`; a lane the owner
asked for as a temporary one is removed with `wt lane remove <name>`.

The task owner reports the files changed and verification evidence. The
orchestrator resolves shared-file conflicts, verifies the combined candidate
under the [local verification policy](testing.md#fast-local-loop), and records
the resulting branch and runtime state. A passing local
test, health endpoint, or UI observation proves only the checked layer; it does
not prove deployment, DNS, or release approval.

The LiwanOS Git remote is `origin` (`https://github.com/tariiq222/liwan.git`),
tracked by `main`. Push a task branch only on the owner's explicit words; `main` changes only
through a merged PR; never force-push published history, and do not imply that a push occurred. Do not remove a
branch or worktree until its content is preserved and no process is using it. A production deployment or DNS cutover
requires separate authorization; local `:8069`/`:3000` development is not
production evidence.
