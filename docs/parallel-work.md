# Parallel work and workspace operations

Nasq uses temporary worktrees for bounded tasks. The canonical runtime after
integration is `/Users/tariq/code/nasq` on `main`; a task worktree is not a
permanent product pillar checkout. One writer owns each file. One orchestrator
owns shared files, Git integration, runtime state, and final verification.

## File ownership

| Surface | Shared | PMO | HR |
| --- | --- | --- | --- |
| Odoo addon | `nasq_api`, plus `nasq_core` groups/branding | `nasq_pmo` | `nasq_hr` |
| Controllers and serializers | `nasq_api` common/auth/branding/me | `nasq_pmo/**` | `nasq_hr/**` |
| Tests | shared fixture and `nasq_api` tests | `nasq_pmo/tests/**` | `nasq_hr/tests/**` |
| Contracts | `packages/contracts/src/common/**` | `packages/contracts/src/pmo/**` | `packages/contracts/src/hr/**` |
| Locale namespace | `common.json` | `tasks.json`, `projects.json`, `settings.json` | `hr.json` |
| Web surface | layout, UI primitives, `useApi`, `useMe`, `useBranding` | task/project pages and components | `/hr`, HR composables/components |

The PMO pillar owns `/api/v1/people` because it is the task assignee picker.
Its `id` is a `res.users` id. HR owns `/api/v1/hr/*`, where employee records
use `hr.employee` ids. Keep these contracts separate.

## Shared-file protocol

Only the orchestrator edits these shared integration points, or coordinates a
single one-line addition from the owning team:

- `packages/contracts/src/index.ts` — one pillar barrel export.
- `apps/web/nuxt.config.ts` — one locale file entry per pillar.
- `apps/web/app/composables/useNav.ts` — the pillar navigation item.
- `deploy/provision.sh` — the pillar addon in the install list.
- `apps/web/i18n/locales/{ar,en}/common.json` — shared navigation labels.

Merge/integrate a pillar before touching a shared file. Do not edit another
pillar's controllers, serializers, tests, components, composables, contracts,
or locale namespace to make integration convenient. A new feature that needs a
shared change must state the contract and the single writer before work starts.

## Starting a task

1. Inspect the selected worktree's branch, status, remotes, and changed paths.
   Preserve unrelated edits. Use `codex/<task>` for a task branch.
2. Decide file ownership and list collisions before editing. Keep dependent
   work sequential; run independent slices in separate worktrees.
3. Give each worktree independent `node_modules` and `.nuxt` directories. Use
   `npm ci --ignore-scripts`; if offline, use the available local npm cache.
   Never symlink dependency or generated-state directories between worktrees.
4. Set per-worktree `NUXT_ODOO_URL`, `NUXT_ODOO_DB`, and
   `NUXT_PUBLIC_WS_URL`, and choose a distinct Nuxt `--port`.

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
NUXT_PUBLIC_WS_URL=ws://127.0.0.1:8169/websocket \
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

No Nasq Git remote is currently configured. Do not invent one or imply that a
push occurred. Do not remove a branch or worktree until its content is
preserved and no process is using it. A production deployment or DNS cutover
requires separate authorization; local `:8069`/`:3000` development is not
production evidence.
