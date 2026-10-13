# Parallel work and workspace operations

واجهة العميل: [DESIGN.md](../DESIGN.md). التقارير المؤرخة ليست تعليمات واجهة.

Nasq uses temporary worktrees for bounded tasks. The canonical checkout is `/Users/tariq/code/nasq` on `main`; a task worktree is not a
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
| Odoo addon | `nasq_core` (access, system groups), `nasq_platform`, `nasq_api`, `nasq_notify` (bell), `nasq_directory` (people picker); each app owns its capability groups | `nasq_pmo`; meetings `nasq_meetings`; bridge `nasq_meetings_pmo` | `nasq_hr` |
| Controllers and serializers | `nasq_api` common/auth/branding/me/attachment, `nasq_notify` bell routes, `nasq_directory` people route | `nasq_pmo/**`, `nasq_meetings/**`, `nasq_meetings_pmo/**` | `nasq_hr/**` |
| Tests | shared fixture, `nasq_api`, `nasq_notify` and `nasq_directory` tests | `nasq_pmo/tests/**`, `nasq_meetings/tests/**`, `nasq_meetings_pmo/tests/**` | `nasq_hr/tests/**` |
| Contracts | `packages/contracts/src/common/**` | `packages/contracts/src/pmo/**` | `packages/contracts/src/hr/**` |
| Locale namespace | `common.json` | `tasks.json`, `projects.json`, `settings.json` | `hr.json` |
| Web surface | layout, UI primitives, `useApi`, `useMe`, `useBranding` | task/project pages and components | `/hr`, HR composables/components |

`nasq_directory` owns `/api/v1/people` (the user-id picker; its `id` is a
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
- `deploy/catalog/solutions/platform_v3.json` — the application in the catalog.
- `packages/contracts/src/index.ts` — one pillar barrel export.
- `deploy/provision.sh` — the pillar addon in the install list.
- `apps/web/i18n/locales/{ar,en}/common.json` — shared navigation labels.

Merge/integrate a pillar before touching a shared file. Do not edit another
pillar's controllers, serializers, tests, components, composables, contracts,
or locale namespace to make integration convenient. A new feature that needs a
shared change must state the contract and the single writer before work starts.

## Starting a task

1. Inspect the selected worktree's branch, status, remotes, and changed paths.
   Preserve unrelated edits. Use `codex/<area>-<slug>` for a task branch.
2. Decide file ownership and list collisions before editing. Keep dependent
   work sequential; run independent slices in separate worktrees.
3. Give each worktree independent `node_modules` and `.nuxt` directories. Use
   `npm ci --ignore-scripts`; if offline, use the available local npm cache.
   Never symlink dependency or generated-state directories between worktrees.
4. Set per-worktree `NUXT_ODOO_URL`, `NUXT_ODOO_DB`, and
   `NUXT_PUBLIC_WS_URL`, and choose a distinct Nuxt `--port`.

`npm run wt -- new <area>-<slug>` performs the worktree creation, steps 3 and 4 (ports and
scratch database name go to the git-ignored `.env.worktree`) in one command (`tools/wt.py`).

The Odoo checkout at `/Users/tariq/code/odoo` is upstream and its source,
configuration, and Git state are read-only. Source inspection and read-only Git
audits there are allowed. Authorized test or development commands may mutate an
explicitly isolated scratch database; do not operate on arbitrary databases or
run tests against the dev `odoo19` database. Start Odoo with the selected Nasq
worktree's addons path explicitly, an isolated scratch database, and a unique
`--http-port`.

For example, for a worktree at `/path/to/nasq-worktree`:

```sh
cd /Users/tariq/code/odoo
.venv/bin/python odoo-bin -c /Users/tariq/code/odoo/odoo.conf \
  --addons-path=/Users/tariq/code/odoo/addons,/path/to/nasq-worktree/odoo-addons \
  -d nasq_scratch --http-port=8169

cd /path/to/nasq-worktree
NUXT_ODOO_URL=http://127.0.0.1:8169 \
NUXT_ODOO_DB=nasq_scratch \
NUXT_PUBLIC_WS_URL=ws://localhost:8169/websocket \
npm -w apps/web run dev -- --port 3100
```

The ordinary local development topology is Odoo `:8069` and Nuxt `:3000`.
Use distinct database, Odoo port, Nuxt port, and log paths for concurrent
worktrees. Temporary integration values are disposable and must not be
presented as production evidence.

## Finishing a task

The task owner reports the files changed and focused verification. The
orchestrator then runs the relevant final checks once, resolves shared-file
conflicts, and records the resulting branch and runtime state. A passing local
test, health endpoint, or UI observation proves only the checked layer; it does
not prove deployment, DNS, or release approval.

The Nasq Git remote is `origin` (`https://github.com/tariiq222/nasq.git`),
tracked by `main`. Push only with explicit authorization, never force-push
published history, and do not imply that a push occurred. Do not remove a
branch or worktree until its content is preserved and no process is using it. A production deployment or DNS cutover
requires separate authorization; local `:8069`/`:3000` development is not
production evidence.
