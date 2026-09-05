# Nasq workspace index

The canonical Nasq checkout is `/Users/tariq/code/nasq` on `main`. Main is
local-only; no Nasq Git remote is configured. The Odoo checkout at
`/Users/tariq/code/odoo` is the unchanged Odoo 19 source checkout. Keep its
source, configuration, and Git state read-only for Nasq work. Authorized tests
or development may use an explicitly isolated database, but never operate on
an arbitrary database.

The retired HR and documentation worktrees and their merged branches have
been removed after preserving the original documents and verifying ancestry. The recovery archive is
tagged `archive/pre-reorganization-20260905` at `e4e8e9b`, with the preserved bundle at
`/Users/tariq/code/nasq-recovery-20260905/preserved-work.bundle`. WIP contract
material in recovery is quarantined and is not delivered product content.

Phase 3b remains pending. Its current execution documents are:

- [`people-branding plan`](superpowers/plans/2026-09-05-nasq-phase-3b-people-branding.md)
- [`handoff`](superpowers/plans/2026-09-05-nasq-phase-3b-handoff.md)
- [`parallel-work`](parallel-work.md)

## Start and inspect

Use these read-only commands before starting work:

```sh
cd /Users/tariq/code/nasq
git status --short --branch
git worktree list
git branch --show-current
```

Inspect the upstream checkout separately when needed:

```sh
cd /Users/tariq/code/odoo
git status --short --branch
```

Create a future bounded task in a temporary worktree with a task branch:

```sh
cd /Users/tariq/code/nasq
task_slug=hr-access
git worktree add "../nasq-$task_slug" -b "codex/$task_slug" main
cd "../nasq-$task_slug"
npm ci --ignore-scripts
```

Give each worktree its own `node_modules` and `.nuxt`, and use unique Odoo and
Nuxt ports, database names, logs, and `NUXT_ODOO_URL`/
`NUXT_ODOO_DB`/`NUXT_PUBLIC_WS_URL` values. One writer owns each file; the
orchestrator owns shared files, integration, runtime state, and final checks.
See [`docs/parallel-work.md`](parallel-work.md) for the ownership map and
runtime example.

Do not auto-delete worktrees or branches. Do not overwrite, reset, clean, or
discard files to resolve a collision. Inspect status and preserve content
before any explicitly authorized cleanup or integration action.


## Reorganization record — 2026-09-05

| Area | Decision |
| --- | --- |
| Canonical source/runtime | `/Users/tariq/code/nasq`, `main`; Odoo `8069`, Nuxt `3000`, DB `odoo19` |
| `nasq-hr` / `phase-hr` | Retired; all commits were already in main. Dependency symlinks were removed without touching their targets. |
| `nasq-docs-hr` / `docs/hr` | Retired; original untracked HR documents are preserved under `docs/archive/` and the external recovery directory. |
| Old `phase-3b` | Renamed `archive/phase-3b-wip-20260905`, with recovery tag and bundle; incomplete contracts are excluded from the integrated product. |
| `nasq-integration` | Temporary verification worktree; remove after integration and runtime verification. Future tasks create fresh worktrees from main. |
| Odoo repository | Source, config, and branches unchanged. Its `web-theme-shadcn` branch is outside this cleanup. |
| HR architecture | Stock `hr` plus `nasq_hr`; stock `project` plus `nasq_pmo`. `/hr` stays; the dead `/people` page is removed. |
| Next product work | Reconciled phase 3b: 10 tasks in 4 dependency waves; Codex team only. No phase-3b features claimed delivered. |

### Recovery

`/Users/tariq/code/nasq-recovery-20260905/` contains source snapshots and SHA256
manifests, original and preserved Git bundles, original HR documents, removed
symlink targets, test logs, and the `odoo19` database/filestore backup taken
before installing `nasq_hr`. The recovery directory intentionally remains
outside Git. Database backups can contain local business data; keep them local.

The preserved WIP commit is `e4e8e9b`. Read a named hunk when needed; do not merge
its full tree, which combines obsolete contracts with the recovered UI.

### Verified layers

- Fresh isolated Odoo installation: **144 tests**, zero failures/errors.
- Contracts: **41 tests passed**; web unit: **136 tests passed**.
- Full Playwright gate: **42 tests passed**, on `nasq_reorg_e2e_20260905`.
- Final ruff and web type/lint check: passed.
- Focused browser check after review: cap warning remains visible when a
  200-project response is filtered to zero matches; correct filtered-empty
  copy. This check mocked responses and wrote no business data.
- `npm run build`: passed (contracts TypeScript and Nuxt production build).
- Canonical runtime verification is recorded after integration in the local
  recovery logs; local results do not establish a deployment.

### Database scope

`nasq_hr` was installed on `odoo19` after a database and filestore backup.
Tests run only on isolated databases. Retire `nasq_hr_e2e` after backing it up
and verifying the canonical HR runtime; retire this reorganization's two
scratch databases after their services stop. Other historical test databases
(`nasq_p2*`, `nasq_p3*`, `nasq_split*`, `nasq_test`, `oca_test`, `shadcn_test`)
are not needed for the canonical runtime, but were not deleted: their contents
and ownership were not part of the verified worktree preservation.
