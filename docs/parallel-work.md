# Parallel work and workspace operations

واجهة العميل: [DESIGN.md](../DESIGN.md). التقارير المؤرخة ليست تعليمات واجهة.

WebVue uses temporary worktrees for bounded tasks. The canonical checkout is `/Users/tariq/code/webvue` on `main`; a task worktree is not a
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
| Odoo addon | `webvue_core` (access, system groups), `webvue_platform`, `webvue_api`, `webvue_notify` (bell), `webvue_directory` (people picker); each app owns its capability groups | `webvue_pmo`; meetings `webvue_meetings`; bridge `webvue_meetings_pmo` | `webvue_hr` |
| Controllers and serializers | `webvue_api` common/auth/branding/me/attachment, `webvue_notify` bell routes, `webvue_directory` people route | `webvue_pmo/**`, `webvue_meetings/**`, `webvue_meetings_pmo/**` | `webvue_hr/**` |
| Tests | shared fixture, `webvue_api`, `webvue_notify` and `webvue_directory` tests | `webvue_pmo/tests/**`, `webvue_meetings/tests/**`, `webvue_meetings_pmo/tests/**` | `webvue_hr/tests/**` |
| Contracts | `packages/contracts/src/common/**` | `packages/contracts/src/pmo/**` | `packages/contracts/src/hr/**` |
| Locale namespace | `common.json` | `tasks.json`, `projects.json`, `settings.json` | `hr.json` |
| Web surface | layout, UI primitives, `useApi`, `useMe`, `useBranding` | task/project pages and `components/pmo/**` | `/hr`, HR composables/components |

Vendor administration and the shared UI layers have their own owners; none of them is an Odoo pillar:

| Surface | Owner | Notes |
| --- | --- | --- |
| `apps/vendor-admin` | vendor administration (git area `cp`) | Pages, BFF routes, e2e and `i18n` of the staff console. Imports only the shared UI layers and `@webvue/commercial-contracts` (rule `VA1`). |
| `packages/ui` | shared design layer | Tokens, theme, shell, presentational components. Shared by `apps/web` and `apps/vendor-admin`; a change needs both apps' checks (rule `UI1`). |
| `packages/commercial-ui` | shared billing presentation | Price breakdown and invoice components. Extends `@webvue/ui`; used by both apps (rule `UI1`). |

`webvue_directory` owns `/api/v1/people` (the user-id picker; its `id` is a
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

Task worktrees live in one place only: `<main checkout>/.worktrees/<area>-<slug>` (git-ignored), which is
where `wt new` creates them, also when run from another worktree. Do not create them under `../webvue-wt/`
or the Claude app's own worktree folder; `wt status` marks such a worktree with `*`. `npm run wt -- status` answers
"which worktrees exist, which are merged, which are dirty"; `npm run wt -- gc` lists what is safe to
remove (merged, clean, behind `main`, no process inside) and `--apply` removes it, which needs the
owner's authorization.

The Odoo checkout at `/Users/tariq/code/odoo` is upstream and its source,
configuration, and Git state are read-only. Source inspection and read-only Git
audits there are allowed. Authorized test or development commands may mutate an
explicitly isolated scratch database; do not operate on arbitrary databases or
run tests against the dev `odoo19` database. Start Odoo with the selected WebVue
worktree's addons path explicitly, an isolated scratch database, and a unique
`--http-port`.

For example, for a worktree at `/path/to/webvue-worktree`:

```sh
cd /Users/tariq/code/odoo
.venv/bin/python odoo-bin -c /Users/tariq/code/odoo/odoo.conf \
  --addons-path=/Users/tariq/code/odoo/addons,/path/to/webvue-worktree/odoo-addons \
  -d webvue_scratch --http-port=8169

cd /path/to/webvue-worktree
NUXT_ODOO_URL=http://127.0.0.1:8169 \
NUXT_ODOO_DB=webvue_scratch \
NUXT_PUBLIC_WS_URL=ws://localhost:8169/websocket \
npm -w apps/web run dev -- --port 3200
```

The ordinary local development topology is Odoo `:8069` and Nuxt `:3000`. Port `3100` is reserved for
`apps/vendor-admin` (its default, see its README) and `3103` for its live-proof build; give `apps/web` worktrees other ports.
Use distinct database, Odoo port, Nuxt port, and log paths for concurrent
worktrees. Temporary integration values are disposable and must not be
presented as production evidence.

## Finishing a task

The task owner reports the files changed and focused verification. The
orchestrator then runs the relevant final checks once, resolves shared-file
conflicts, and records the resulting branch and runtime state. A passing local
test, health endpoint, or UI observation proves only the checked layer; it does
not prove deployment, DNS, or release approval.

The WebVue Git remote is `origin` (`https://github.com/tariiq222/webvue.git`),
tracked by `main`. Push only with explicit authorization, never force-push
published history, and do not imply that a push occurred. Do not remove a
branch or worktree until its content is preserved and no process is using it. A production deployment or DNS cutover
requires separate authorization; local `:8069`/`:3000` development is not
production evidence.
