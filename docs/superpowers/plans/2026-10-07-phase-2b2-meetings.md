# Phase 2b-2: webvue_meetings and the webvue_meetings_pmo Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every meeting item leaves `webvue_pmo` for a new application addon `webvue_meetings` (on top of `cyan_meeting_minutes`) and a new auto-install bridge `webvue_meetings_pmo` (everything that needs both meetings and projects/tasks), with no API surface change and with upgrades that keep every meeting, series, recommendation, task link, grant, group membership and meeting notification.

**Architecture:** First the meeting code is split *inside* `webvue_pmo` into files that are each either "meetings only" or "meetings + projects", with an AbstractModel `webvue.meeting.links` whose hooks return "no project, no linked task" and a second class that fills them from `project.project`/`project.task` (Task 5). Then those files move unchanged to `webvue_meetings` and `webvue_meetings_pmo` (Task 6), `webvue_pmo` drops `cyan_meeting_minutes`, and a `pre-` migration in `webvue_pmo` 19.0.1.4.0 plus a `pre_init_hook` in `webvue_meetings` rename every meeting `ir_model_data` row in place and install the two addons in the same upgrade run (Task 7). Shared layers get three small preparations first: a stable feature-gate order, registry-driven legacy grants in `webvue_platform`, and a faithful auto-install closure in `tools/webvue_cli`.

**Tech Stack:** Odoo 19 Community (`/Users/tariq/code/odoo`, read-only), Python 3, PostgreSQL scratch databases, `tools/arch_policy.py`, `tools/git_policy.py`, `tools/migration_guard.py`, `tools/api_surface.py`, `tools/catalog_check.py`, npm workspaces (zod contracts, Nuxt web, commercial-contracts, control-plane).

**Spec:** `docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md` §2, §2.1, §3.2.1 and §3.6 (R10) are binding. Roadmap: `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, "المرحلة 2ب" (2b-1 is merged at `b959e5cc`). Controller rulings for 2b-2 (2026-10-07) are folded into the Global Constraints. Models for structure and proofs: `docs/superpowers/plans/2026-10-06-phase-2b1-notify-directory.md` (Deviations, Task 5, Task 7) and `odoo-addons/webvue_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py`. Read the spec sections and the roadmap entry before starting.

## Deviations from rulings

Each item is a place where a ruling is impossible, incomplete or ambiguous against the source, with the design used instead. The reviewer can reject any of them.

1. **H.5, "rename vs adopt-then-delete" per row — the real load order, and a `pre_init_hook` the rulings did not name.** Unlike 2b-1's `webvue_notify`, `webvue_meetings` is *not* a dependency of `webvue_pmo`. In update mode Odoo orders the graph by *phase* first (`odoo/modules/module_graph.py`, `ModuleNode.phase`: a module whose install state differs from a dependency's moves one phase later), then depth, then name.
   - **Upgrade from current `main`** (`-u` of the installed addons, no `-i`): `webvue_pmo` is "to upgrade" with only installed dependencies (phase 1). `webvue_meetings` is not marked at all; `webvue_pmo`'s pre-migration marks it (and the bridge) "to install", and `load_modules` STEP 3 picks them up in its next pass (`loading.py` "loop this step in case extra modules' states are changed"). So `webvue_pmo`'s pre-migration always runs before `webvue_meetings` creates anything ⇒ **plain rename** of every `ir_model_data` row, and plain re-pointing of the `ir_model_constraint`/`ir_model_relation` rows. If an operator adds `-i webvue_meetings`, `webvue_meetings` is "to install" (phase 2) and still loads after `webvue_pmo` (phase 1): same outcome.
   - **Upgrade from `release/19.0.1.0.0` with `-i` (as CI will do, Task 8):** `webvue_pmo` now depends on `webvue_notify`/`webvue_directory`/`webvue_platform`, which are installed in the same run, so `webvue_pmo` lands in phase 5 while `webvue_meetings` lands in phase 4 (computed from the manifests in Task 0 Step 8). `webvue_meetings` then loads **before** `webvue_pmo`'s pre-migration and would create a second copy of every group, permission (unique `key` ⇒ the install aborts), rule and cron. 2b-1's adopt-then-delete cannot repair data records (users and roles point at the old ids). **Design used:** `webvue_meetings` gets a `pre_init_hook` (`hooks.py`) that renames the same rows by ORM *before* Odoo reflects or loads anything for it (`loading.py` calls `pre_init_hook` before `registry.load`). It only touches `ir_model_data` and the permissions' `group_xmlid`; Odoo then reflects fresh `ir_model_constraint`/`ir_model_relation` rows for `webvue_meetings`, so for those two tables `webvue_pmo`'s migration uses **adopt-then-delete** (drop `webvue_pmo`'s copy when the target already holds a row of the same name) and re-points otherwise. The bridge always loads after `webvue_pmo` (it depends on it), so its rows are always a plain rename by `webvue_pmo`'s migration. The hook's list equals the migration's list; a bridge test pins it.
   - Per-row technique is the table in Task 7 Step 3 (`MEETINGS_XMLIDS`, `BRIDGE_XMLIDS`, `MEETINGS_CONSTRAINTS`, `BRIDGE_CONSTRAINTS`, `MEETINGS_RELATIONS`, `LEFT_TO_ODOO`).
2. **H.5, rows that are not meeting rows.** `webvue_pmo` holds `ir_model_data` rows for shared models it extended only for meetings: `model_calendar_event`, `model_cyan_meeting_minute`, `model_cyan_meeting_resolution`, `model_res_users` and the `id`/`display_name` field rows of `calendar.event`, `cyan.meeting.minute`, `cyan.meeting.resolution`, `res.users` (verified on a fresh scratch install of `main`). Their owners (`base`, `calendar`, `cyan_meeting_minutes`) keep their own xml ids, so Odoo's `_process_end` only drops `webvue_pmo`'s xml id ("if the record has other associated xids, only remove the xid", `ir_model.py`), and `webvue_meetings`/the bridge create their own. They are listed in `LEFT_TO_ODOO` and not renamed.
3. **H.5, fail closed.** The five meeting record rules are closed (`[(0, '=', 1)]`) only when `webvue_meetings` cannot be installed (no `ir_module_module` row because it is not on the addons path, or `uninstallable`); the rows are still renamed so the tables survive and wait for `webvue_meetings`. In that case the bridge is not marked either. When `webvue_meetings` can be installed, the migration marks it "to install" instead of closing anything.
4. **H.5, "CI upgrade/deploy commands add the two modules explicitly".** `-u` of a not-installed module is a no-op (`loading.py` STEP 2 searches installed modules), so listing them in `-u` alone proves nothing. The CI upgrade step keeps `-u "$MODULES"` and adds `-i "$MODULES"` with the same ten-module list (Odoo only installs the uninstalled ones). From the release tag this is exactly the phase-4-before-phase-5 path, so CI exercises the `pre_init_hook` on every run; Task 9 proves both paths locally (from `main` without `-i`, from the release tag with `-i`). Deploy scripts install only (`-i`); they get the two modules in their lists.
5. **H.1, where the hooks live and what "unsupported" means.** The hooks are methods of an AbstractModel `webvue.meeting.links` (composed through `super()` like `webvue.notify.registry`), called by the serializers, controllers and models; the bridge inherits it. Without the bridge: payloads keep `project_id: null` and `project: null`; `?project_id=` on the meeting and series lists is validated as a positive integer and then ignored; a non-null `project_id` on meeting, series or recommendation create/patch answers **422 `invalid`** with `field: 'project_id'` and message `project_id is not supported: the projects application is not installed` (`invalid` is the only 422 code in CLAUDE.md's error contract); `project_id: null` is accepted as "nothing to clear"; a minutes topic with a `project_id` is a 422 `invalid`; `POST …/resolutions/<rid>/convert` is not served (it falls through to the generic action route, which answers 404 `not_found` "unknown action").
6. **H.4, `CONVERT_MARKER`.** The precommit key moves with the bridge and is renamed from `webvue_pmo.resolution_convert_depth` to `webvue_meetings_pmo.resolution_convert_depth` (a transient per-transaction key; nothing stores it).
7. **H.10, descriptor.** No new descriptor key: legacy grants are derived from the feature definitions themselves. A selected application gets every feature it registers (booleans `True`, limits `None`), an installed unselected one gets them withheld (booleans `False`, limits `None`), platform-owned features are always present (booleans `True`, limits `None`). For every installed application this equals the old fixed table. `retained_read_features` becomes sorted (it is compared as a set everywhere).
8. **Carry-over, gate order.** `requires_registered_feature` checks the registered keys sorted. With both `pmo.enabled` and `meetings.enabled` off, the bell and `/people` now report `feature: 'pmo.enabled'` (was `meetings.enabled`): a visible error-detail change, as the ruling prefers. Owner decision 1.
9. **H.8, fields outside `x-webvue` that necessarily change.** As in 2b-1 Deviation 7, `tags` and `operationId` follow the addon and controller; for the convert route `x-webvue.controller` changes too (the route lives in a new bridge controller class). Handler names and summaries do not change. 26 operations change: 25 to `webvue_meetings`, `POST /api/v1/meetings/{meeting_id}/resolutions/{resolution_id}/convert` to `webvue_meetings_pmo`; the top-level `tags` gain both addons.
10. **H.7, what else the catalog edit touches.** Adding `webvue_meetings` to tier `projects` changes every policy derived from the catalog. Known pins updated in Task 6: `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts`, `apps/control-plane/src/__tests__/shared-onboarding-live.test.ts` (**needs the live control-plane PostgreSQL role `webvue_test`**), `tools/test_webvue_cli_operator.py`, and the module tuples `tools/webvue_cli/operator.py` `CREATE_MODULES`, `tools/shared_saas_lifecycle/odoo_effect.py` `ALLOWED_MODULES`, `deploy/check_isolated.py` `WEBVUE_ADDONS` (+ its pin). `base_modules` stays unchanged (2b-1 Deviation 8 stands).
11. **Tests that pinned `webvue_pmo.` for meeting items.** `TestAppXmlidMigration` (webvue_core) keeps the released Phase 2 migration untouched and reads the meeting rows through a `LATER_OWNER` mapping; it now also needs `webvue_meetings` installed to run. Mixed meeting tests that use projects or tasks move verbatim to the bridge; meetings-only coverage is added by `TestMeetingsWithoutProjects`, which runs only when the bridge is absent (the meetings-without-project install).
12. **Release-path payload comparison.** `serializers/meeting.py` is byte-identical between `release/19.0.1.0.0` and `main` (checked with `git diff`), so the upgrade proof compares full meeting payloads on both paths; Task 9 says how to tell a pre-existing difference from a regression if the release path ever disagrees.

**Inventory corrections found while reading the source (main `b959e5cc`):**

- `webvue_pmo` is already 19.0.1.3.0 (2b-1); this plan bumps it to **19.0.1.4.0**.
- 2b-1 already moved the bell (`webvue_notify`), `/api/v1/people` (`webvue_directory`) and the attachment validator (`webvue_api/serializers/attachment.py`); meetings already deliver through `webvue.notify.service._webvue_deliver` and read people through `webvue.directory`.
- R7 per file today: `meeting_access.py` 1, `meeting_history.py` 5, `meeting_minute.py` 2, `meeting_resolution.py` 1, `meeting_workspace.py` 6, `serializers/meeting.py` 3, `notification_types.py` 2 (total 85). After this plan: R7 **83** (the three converted-task lookups collapse into one documented bridge hook), R2 **4** (the platform loses its four app grant lines), R9 68, R10 0.
- `webvue_pmo` also owns the FK constraint rows of the meeting columns in `ir_model_constraint` (no xml ids) and `webvue_meeting_series_attendee_rel` in `ir_model_relation`; both are listed.
- The convert route and the generic `/<string:action>` route share a prefix; werkzeug matches the literal `convert` first regardless of which controller class declares it.

## Global Constraints

- No API surface change beyond the `x-webvue` ownership fields (ruling H.8 of 2b-1): identical set of `(method, path)`, params and request/response schemas; `docs/api/openapi.json` is regenerated; compare **generated-before vs generated-after**, not the committed file. Allowed differences: `x-webvue.addon`, `controller`, `contract_namespace`, `feature_keys`, and the `tags`/`operationId` derived from them (Deviation 9).
- Capability keys unchanged: the same 28 keys and role grants; the three `meetings.*` keys, their groups, permissions, rules and role grants move from `webvue_pmo` to `webvue_meetings` through the Phase 2 access hooks (composed via `super()`).
- No new `sudo()` and no new SQL on Odoo tables: R7 85 and R9 68 must not rise; moved code carries its counts. Expected after the plan: **R2 4, R7 83, R9 68, R10 0**, every other rule unchanged. `tools/arch_baseline.json` is only written by `python3 -B tools/arch_policy.py --write-baseline`; every commit leaves `python3 -B tools/arch_policy.py --base main` at exit 0.
- `tools/arch_layers.json`: `webvue_meetings` 4, `webvue_meetings_pmo` 5 with `auto_install` (new addons are a strengthening; no approval trailer).
- Tests green on: the full install (all ten addons: `webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat`), the partial `webvue_core,webvue_platform,webvue_api,webvue_hr`, `webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_meetings` without `project`, and `webvue_pmo` without `cyan_meeting_minutes`.
- Upgrade proofs from current `main` and from `release/19.0.1.0.0` (as CI does) keep meetings, series, recommendations, task links, grants, group membership and meeting notifications with the same visibility (Task 9).
- `webvue_pmo` drops `cyan_meeting_minutes` from `depends`; the `deadline` override on `cyan.meeting.resolution` moves with `webvue_meetings` in the same step (ruling H.12).
- The only contract/web edit: `WebVueModuleIdSchema` in `packages/contracts/src/common/me.ts` gains `webvue_meetings` (the bridge registers no module id, so `/api/v1/me.modules` never shows it), plus its label and tests in `apps/web` (ruling H.6). Catalog tier `projects` adds `webvue_meetings`; names and prices untouched (ruling H.7).
- `webvue_platform` keeps no application names (ruling H.10): legacy grants and the selected-module allow-list come from `webvue.feature.registry`.
- Application imports: `webvue_meetings` imports nothing from `webvue_pmo` and the reverse; only the bridge imports both. Shared services name no application.
- Versions (docs/migrations.md): `webvue_pmo` 19.0.1.3.0 → 19.0.1.4.0 with `migrations/19.0.1.4.0/pre-hand_meetings_to_webvue_meetings.py` (Task 7); `webvue_meetings` and `webvue_meetings_pmo` start at 19.0.1.0.0; `webvue_api` and `webvue_platform` keep their versions (code-only changes). Do not edit any released migration.
- Every new Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.` Manifests use `'license': 'LGPL-3'`, `'author': 'Tariq Alwalidi'`, `'category': 'Hidden'`, `'installable': True`, `'application': False`. `ruff check odoo-addons` stays clean (EM101: assign a literal exception message to a variable first; COM812: trailing commas; I001: relative imports sort before `odoo.addons.*` in the same block).
- Route handlers keep their names, parameters, `type='json2'`, `auth='user'`, methods, `readonly` and decorators, and get no docstring.
- Scratch databases are named `webvue_scratch_meetings_*`; `/tmp/webvue-meetings/odoo-run.sh` refuses any other name and any name containing `odoo19`. Never run anything against `odoo19`. Never point Odoo at a config whose `data_dir` or `logfile` is inside `/Users/tariq/code/odoo`. Do not upgrade any persistent database at an intermediate commit.
- Work only in `/Users/tariq/code/nasq-meetings` on branch `codex/pmo-meetings-split`. Do not touch the main checkout's uncommitted owner changes (`.gitignore`, `docs/WORKSPACE.md`, `package.json`, `package-lock.json`, untracked `.agents/`, `.planning/`, `docs/e2e.md`, `e2e.config.ts`, `e2e/`, `plans/`).
- Commit subjects are `type(scope): subject`, at most 72 characters, scope from `core platform api pmo hr chat web cp deploy tools docs ci`. The `Co-Authored-By` trailer goes in the commit **body**, never on the subject line: every commit in this plan is written as `git commit -m "<subject>" -m "<TRAILER>"`, where you type the exact `Co-Authored-By: …` line your dispatch gives in place of `<TRAILER>`. Do not merge, push, delete branches or change Git config.
- A full ten-addon Odoo run takes 10–25 minutes. Start it with `run_in_background` and wait on the log; never shorten a run by dropping modules from `-i`.

## Review Focus

- **An upgrade drops meeting tables, columns or records because a row was not handed over** (a name missing from the rename lists, or listed but not re-declared by the receiving addon, so `_process_end` deletes it). Expected: every meeting row keeps its database id; nothing is dropped. Pinned by `test_a_fresh_install_owns_every_listed_row` and `test_rows_are_renamed_in_place_and_a_rerun_is_a_no_op` (Task 7) and by `meetings_assert.py`'s "ownership equals a fresh install" and "rows unchanged" checks on both upgrade paths (Task 9).
- **The release-path upgrade with `-i` installs `webvue_meetings` before `webvue_pmo`'s migration and duplicates groups, permissions and rules.** Expected: the install adopts the old rows; no duplicate, no failed unique `key`. Pinned by `test_the_hook_adopts_the_meeting_rows_before_webvue_pmo_upgrades` and `test_rows_the_target_already_reflected_are_adopted` (Task 7) and the release-path proof run with `-i` (Task 9).
- **With the bridge installed, a payload changes or leaks** (a hook loses a project reference, a converted task's state, or shows a task id/state to a user without `pmo.tasks.read`). Expected: identical payloads per user. Pinned by the moved bridge tests (`TestResolutionConvert`, `TestMeetingHistoryProjects`, `TestMeetingWorkspaceProjects`, `TestMeetingSeriesProjects`, `TestMeetingsApiProjects`, run unchanged) and by the per-user `dump_meeting`/`dump_series` comparison in `meetings_assert.py` (carol has `meetings.read` only).
- **`webvue_meetings` alone accepts or crashes on project links** (a 500 instead of 422, a silently stored project, a served convert route, a list filter that errors). Expected: the behaviour of Deviation 5. Pinned by `TestMeetingsWithoutProjects` (Task 6) in the meetings-without-project install.
- **A feature gate or grant silently changes owner** (`meetings.enabled` not granted to a new tenant, the bell/people gate depending on load order, `/me.modules` failing the zod enum). Expected: identical grants for installed applications; the gate reports the sorted-last failing key; `webvue_meetings` accepted by the contract. Pinned by `TestLegacyGrants` (Task 2), `test_the_reported_key_does_not_follow_registration_order` (Task 1), `TestMeetingFeatureGates` (Task 5/6), the schema test (Task 3) and `catalog_check` (Task 6).

## File Structure

| File | Responsibility |
|---|---|
| `odoo-addons/webvue_api/controllers/common.py` (modify) | `requires_registered_feature` checks keys sorted |
| `odoo-addons/webvue_platform/models/entitlement_service.py`, `tenant_profile.py` (modify); `tests/test_legacy_grants.py` (create) | Registry-driven legacy grants and selected-module allow-list |
| `packages/contracts/src/common/me.ts`, `apps/web/app/utils/vendorPackages.ts`, `apps/web/i18n/locales/{ar,en}/vendor.json` (modify) + tests | `webvue_meetings` module id and label |
| `tools/webvue_cli/module_closure.py`, `tools/test_module_closure.py` (modify) | Faithful auto-install closure |
| `odoo-addons/webvue_meetings/**` (create, mostly moved from `webvue_pmo`) | Meetings application: models, controllers, serializers, data, security, report, tests, `hooks.py` |
| `odoo-addons/webvue_meetings/models/meeting_links.py` (create) | `webvue.meeting.links`: link hooks with "no project, no linked task" defaults |
| `odoo-addons/webvue_meetings_pmo/**` (create, moved from `webvue_pmo`) | Bridge: `project_id` fields, link hooks, task origin fields, convert route and its tests |
| `odoo-addons/webvue_pmo/**` (modify) | Projects and tasks only; `project.task._webvue_extra_create_fields` hook; migration 19.0.1.4.0 |
| `odoo-addons/webvue_core/tests/test_app_xmlid_migration.py`, `webvue_api/tests/test_access_composition.py`, `test_access_admin.py`, `webvue_platform/tests/test_entitlements.py` (modify) | Owner pins |
| `deploy/catalog/solutions/platform.json`, `platform_v2.json` (modify) + pins | Tier `projects` installs `webvue_meetings` |
| `tools/arch_layers.json`, `tools/arch_baseline.json` (modify) | Ranks; regenerated baseline |
| `.woodpecker.yml`, `deploy/**`, `tools/**` module lists (modify) | Install and test the two addons |
| `docs/api/openapi.json` (regenerated), `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/parallel-work.md`, roadmap (modify) | Ownership text and phase status |

---

### Task 0: Worktree, scratch runner and baselines

**Files:**
- Create (outside the repo): `/tmp/webvue-meetings/odoo-run.sh`, `/tmp/webvue-meetings/scratch-only.conf`, `/tmp/webvue-meetings/openapi-before.json`
- Create: `docs/superpowers/plans/2026-10-07-phase-2b2-meetings.md` (copy of this plan)

**Interfaces:**
- Produces: `/tmp/webvue-meetings/odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | upgrade DB MODULES [INSTALL] | shell DB ROOT | drop DB`; `test` prints `INSTALLED_PROBE <comma list>` of `cyan_meeting_minutes,webvue_meetings,webvue_meetings_pmo,webvue_pmo,project` that are installed, before it drops a green database. The ten-module list and tag list below are used by every later task.

```
TEN=webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat
TEN_TAGS=/webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat
EIGHT=webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat
EIGHT_TAGS=/webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat
```

Shell variables do not persist between commands: every command below spells the lists out.

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/tariq/code/nasq
git fetch origin
git rev-parse main origin/main
git worktree add -b codex/pmo-meetings-split /Users/tariq/code/nasq-meetings main
cd /Users/tariq/code/nasq-meetings
git status --short
git log -1 --oneline
npm ci --ignore-scripts
```

Expected: empty status; `main` at `b959e5cc` or later (record it). If `main` and `origin/main` differ, continue from local `main` and report it. Run every later command from `/Users/tariq/code/nasq-meetings` unless a step says otherwise.

- [ ] **Step 2: Create the scratch directory, config and runner**

```bash
mkdir -p /tmp/webvue-meetings/logs /tmp/webvue-meetings/data /tmp/webvue-meetings/classification
printf '[options]\nlist_db = False\n' > /tmp/webvue-meetings/scratch-only.conf
cat > /tmp/webvue-meetings/odoo-run.sh <<'RUNNER'
#!/usr/bin/env bash
# Phase 2b-2 scratch runner (plan 2026-10-07-phase-2b2-meetings.md).
# Every database must match webvue_scratch_meetings_[a-z0-9_]+; odoo19 is never touched.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
WORKTREE=/Users/tariq/code/nasq-meetings
SCRATCH=/tmp/webvue-meetings
CONF="$SCRATCH/scratch-only.conf"
HTTP_PORT=8209
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-tariq}"

die() { echo "odoo-run: $*" >&2; exit 2; }
guard_db() {
  [[ "$1" != *odoo19* ]] || die "refusing database '$1' (odoo19 is the development database)"
  [[ "$1" =~ ^webvue_scratch_meetings_[a-z0-9_]+$ ]] || die "refusing database '$1' (scratch names match webvue_scratch_meetings_[a-z0-9_]+)"
}
guard_root() {
  [[ "$1" == "$WORKTREE" || "$1" == "$SCRATCH"/base-* ]] || die "refusing addons root '$1'"
  [[ -d "$1/odoo-addons" ]] || die "no odoo-addons under '$1'"
}
addons() { echo "$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$1/odoo-addons"; }
classify() {  # classify DB: a new file per run, because classification.py opens its output exclusively
  local out="$SCRATCH/classification/$1-$(date +%Y%m%d%H%M%S)-$$-$RANDOM.json"
  python3 "$WORKTREE/deploy/classification.py" fixture --database "$1" --mode saas --output "$out"
  export WEBVUE_COMMERCIAL_CONFIG="$out"
}
probe() {  # probe DB: which of the split-relevant modules are installed
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -Atc \
    "SELECT 'INSTALLED_PROBE ' || coalesce(string_agg(name, ',' ORDER BY name), '') FROM ir_module_module WHERE state = 'installed' AND name IN ('cyan_meeting_minutes', 'webvue_meetings', 'webvue_meetings_pmo', 'webvue_pmo', 'project')"
}
run_odoo() {  # run_odoo DB ROOT LOG [odoo args...]
  local db=$1 root=$2 log=$3
  shift 3
  "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$CONF" --addons-path="$(addons "$root")" \
    --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
    -d "$db" --db-filter="^${db}\$" --data-dir="$SCRATCH/data" \
    --http-port="$HTTP_PORT" --workers=0 --max-cron-threads=0 "$@" 2>&1 | tee "$log"
}

cmd=${1:-}
shift || true
case "$cmd" in
  test)  # test DB MODULES TAGS: fresh install of the worktree with tests, then drop the database
    db=$1 modules=$2 tags=$3
    guard_db "$db"
    dropdb --if-exists "$db"
    classify "$db"
    run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db.log" -i "$modules" --test-tags "$tags" \
      --stop-after-init --log-level=test || true
    grep -E 'odoo.tests.result:' "$SCRATCH/logs/$db.log" | tail -n 1 || true
    grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests' "$SCRATCH/logs/$db.log" \
      || die "tests failed or did not run: $SCRATCH/logs/$db.log (database kept for inspection)"
    probe "$db"
    dropdb --if-exists "$db"
    echo "ODOO_RUN_TEST_OK $db" ;;
  base)  # base DB ROOT MODULES: install a checkout without tests; unclassified when it has no webvue_platform (as CI installs the release tag)
    db=$1 root=$2 modules=$3
    guard_db "$db"
    guard_root "$root"
    dropdb --if-exists "$db"
    if [[ -d "$root/odoo-addons/webvue_platform" ]]; then classify "$db"; else unset WEBVUE_COMMERCIAL_CONFIG; fi
    run_odoo "$db" "$root" "$SCRATCH/logs/$db-base.log" -i "$modules" --without-demo=all --stop-after-init
    echo "ODOO_RUN_BASE_OK $db" ;;
  upgrade)  # upgrade DB MODULES [INSTALL]: upgrade with the worktree code; INSTALL is also passed to -i (as CI does)
    db=$1 modules=$2 install=${3:-}
    guard_db "$db"
    classify "$db"
    if [[ -n "$install" ]]; then
      run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db-upgrade.log" -u "$modules" -i "$install" --stop-after-init
    else
      run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db-upgrade.log" -u "$modules" --stop-after-init
    fi
    python3 -B "$WORKTREE/tools/upgrade_log_guard.py" "$SCRATCH/logs/$db-upgrade.log"
    echo "ODOO_RUN_UPGRADE_OK $db" ;;
  shell)  # shell DB ROOT < script.py
    db=$1 root=$2
    guard_db "$db"
    guard_root "$root"
    "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell -c "$CONF" --addons-path="$(addons "$root")" \
      --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
      -d "$db" --db-filter="^${db}\$" --data-dir="$SCRATCH/data" --no-http ;;
  drop)
    guard_db "$1"
    dropdb --if-exists "$1" ;;
  *)
    die "usage: odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | upgrade DB MODULES [INSTALL] | shell DB ROOT | drop DB" ;;
esac
RUNNER
chmod +x /tmp/webvue-meetings/odoo-run.sh
bash -n /tmp/webvue-meetings/odoo-run.sh && echo runner-ok
/tmp/webvue-meetings/odoo-run.sh drop odoo19 || echo "guard refused odoo19 as expected"
/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_odoo19_copy || echo "guard refused an odoo19 lookalike as expected"
/tmp/webvue-meetings/odoo-run.sh drop webvue_test || echo "guard refused a non-scratch name as expected"
```

Expected: `runner-ok`, then three `odoo-run: refusing database ...` lines, each followed by its `guard refused ... as expected` line. The runner never removes files; it only drops scratch databases it guarded. Classification files accumulate under `/tmp/webvue-meetings/classification/` (one per run, never reused).

- [ ] **Step 3: Check the port and the database names are free**

```bash
lsof -nP -iTCP:8209 -sTCP:LISTEN || echo "port 8209 free"
psql -h 127.0.0.1 -U tariq -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'webvue_scratch_meetings_%'"
```

Expected: `port 8209 free`. If a `webvue_scratch_meetings_inventory` database is listed, it was left by the plan author's read-only inventory run: drop it with `/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_inventory`. No other database may be listed. If 8209 is taken, change `HTTP_PORT` in the runner and say so in your report.

- [ ] **Step 4: Commit this plan on the branch**

```bash
cp /Users/tariq/code/nasq/docs/superpowers/plans/2026-10-07-phase-2b2-meetings.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-07-phase-2b2-meetings.md
git commit -m "docs(docs): add the phase 2b-2 meetings split plan" -m "<TRAILER>"
git log -1 --format=%B
```

Expected: the body shows the subject, a blank line and the trailer line. The main checkout keeps an untracked copy of the same file; tell the orchestrator it must be removed from the main checkout before the merge.

- [ ] **Step 5: Record the guard baselines**

```bash
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/catalog_check.py; echo "catalog_check exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
PY
```

Expected: four `exit=0` lines (`CATALOG_OK solutions=2` before the last one) and totals `R1 0, R10 0, R2 8, R3 4, R4 0, R5 8, R6 0, R7 85, R8 1, R9 68`.

- [ ] **Step 6: Record the API surface baseline**

```bash
python3 -B tools/api_surface.py
cp docs/api/openapi.json /tmp/webvue-meetings/openapi-before.json
git checkout -- docs/api/openapi.json
git status --short
```

Expected: `wrote docs/api/openapi.json: ...` and an empty status after the checkout.

- [ ] **Step 7: Run the full suite and the partial install once on the unmodified branch (background, sequentially)**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_base \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_partial_base \
  webvue_core,webvue_platform,webvue_api,webvue_hr \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_hr
```

Expected: `ODOO_RUN_TEST_OK` for both after `odoo.tests.result: 0 failed, 0 error(s) of N tests`. Record both N. If a run is not green, list the failures with `grep -E '(FAIL|ERROR): ' /tmp/webvue-meetings/logs/<db>.log`; those are pre-existing and every later run is compared against that list.

- [ ] **Step 8: Confirm the loading phases Deviation 1 relies on**

```bash
python3 -B - <<'PY'
import ast
from pathlib import Path

# Phases of Odoo's update graph (odoo/modules/module_graph.py ModuleNode.phase): base is 0;
# a module whose "to install" state differs from a dependency's moves one phase later.
# Addons outside odoo-addons (project, mail, calendar ...) count as installed, phase 1.
deps = {p.parent.name: ast.literal_eval(p.read_text())['depends'] for p in Path('odoo-addons').glob('*/__manifest__.py')}
# The manifests after Task 6:
deps['webvue_pmo'] = ['webvue_api', 'webvue_platform', 'webvue_directory', 'webvue_notify', 'project', 'mail', 'bus']
deps['webvue_meetings'] = ['webvue_api', 'webvue_platform', 'webvue_notify', 'webvue_directory', 'cyan_meeting_minutes', 'calendar', 'mail']


def phases(new):
    memo = {}

    def phase(name):
        if name == 'base':
            return 0
        if name not in deps:
            return 1
        if name not in memo:
            memo[name] = max(
                (phase(dep) + ((name in new) != (dep in new)) + (dep == 'base') for dep in deps[name]),
                default=1,
            )
        return memo[name]
    return {name: phase(name) for name in ('webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_pmo', 'webvue_meetings')}


print('main + -i webvue_meetings:', phases({'webvue_meetings'}))
print('release + -i webvue_meetings:', phases({'webvue_platform', 'webvue_notify', 'webvue_directory', 'webvue_meetings'}))
PY
```

Expected: `main + -i webvue_meetings: {... 'webvue_pmo': 1, 'webvue_meetings': 2}` (webvue_pmo's migration first: plain rename) and `release + -i webvue_meetings: {'webvue_core': 1, 'webvue_platform': 2, 'webvue_api': 3, 'webvue_notify': 4, 'webvue_pmo': 5, 'webvue_meetings': 4}` (webvue_meetings first: the `pre_init_hook` does the rename). This is a reasoning aid only; Task 9's two upgrade proofs are the real check.

---

### Task 1: Report the registry gate's failing key in a stable order

**Files:**
- Modify: `odoo-addons/webvue_api/controllers/common.py` (`requires_registered_feature`)
- Modify: `odoo-addons/webvue_directory/tests/test_people.py`
- Modify: `odoo-addons/webvue_pmo/tests/test_feature_enforcement.py:47`, `odoo-addons/webvue_pmo/models/notification_types.py:2-12`, `odoo-addons/webvue_pmo/models/directory.py:10-13`

**Interfaces:**
- Produces: `requires_registered_feature` evaluates `tuple(sorted(set(keys)))`; with `match='any'` the 403 names the sorted-last failing key.

- [ ] **Step 1: Write the failing test**

Append to the class in `odoo-addons/webvue_directory/tests/test_people.py`:

```python

    def test_the_reported_key_does_not_follow_registration_order(self):
        second = 'zz_probe.enabled'
        register_probe_feature(self, second)
        # Write the new key first: every registered platform boolean must be present.
        set_probe_feature(self, second, enabled=False)
        set_probe_feature(self, enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        directory = type(self.env['webvue.directory'])
        for order in ((PROBE_FEATURE, second), (second, PROBE_FEATURE)):
            self.patch(directory, '_webvue_directory_feature_keys', lambda model, order=order: order)
            response = self.api('GET', '/api/v1/people')
            self.assertEqual(response.status_code, 403, order)
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': second}, order)
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t1 \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory \
  /webvue_directory:TestPeopleDirectory
```

Expected: `tests failed or did not run`; the log shows the order `(second, PROBE_FEATURE)` reporting `test_probe.enabled`. Drop the kept database: `/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_t1`.

- [ ] **Step 3: Sort the keys in the gate**

In `odoo-addons/webvue_api/controllers/common.py`, in `requires_registered_feature`, replace:

```python
    is never checked.
    """
```

with:

```python
    is never checked. The registered keys are checked sorted, so with
    ``match='any'`` the reported key is the last failing one in sorted order,
    whatever order the addons registered them in.
    """
```

and replace:

```python
            registered = tuple(getattr(request.env[model], method)())
```

with:

```python
            registered = tuple(sorted(set(getattr(request.env[model], method)())))
```

- [ ] **Step 4: Update the PMO pin and the two order comments**

In `odoo-addons/webvue_pmo/tests/test_feature_enforcement.py` replace:

```python
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'meetings.enabled'}, path)
```

with:

```python
            # The gate checks the keys sorted: with both off it names pmo.enabled.
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'pmo.enabled'}, path)
```

In `odoo-addons/webvue_pmo/models/notification_types.py` replace:

```python
Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until webvue_meetings exists (phase 2b-2). Keep the meeting class
second: the bell's feature gate checks keys in registration order, and with
both off it reports the last one (meetings.enabled), as it did before.
```

with:

```python
Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until webvue_meetings exists (phase 2b-2). The bell's feature gate
checks the registered keys sorted, so the order of these classes does not
matter.
```

In `odoo-addons/webvue_pmo/models/directory.py` replace:

```python
        # Projects and meetings both pick people. Keep this order: with both
        # keys off the gate reports the last one, as it did before the move.
        # meetings.enabled moves to webvue_meetings in phase 2b-2.
```

with:

```python
        # Projects and meetings both pick people; the gate checks the keys
        # sorted. meetings.enabled moves to webvue_meetings in phase 2b-2.
```

- [ ] **Step 5: Static checks**

```bash
ruff check odoo-addons
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
```

Expected: `All checks passed!` and `exit=0`.

- [ ] **Step 6: Run the focused tests**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t1 \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_directory,/webvue_notify,/webvue_pmo:TestPmoFeatureEnforcement
```

Expected: `ODOO_RUN_TEST_OK webvue_scratch_meetings_t1`.

- [ ] **Step 7: Commit**

```bash
git add odoo-addons/webvue_api/controllers/common.py odoo-addons/webvue_directory/tests/test_people.py \
  odoo-addons/webvue_pmo/tests/test_feature_enforcement.py odoo-addons/webvue_pmo/models/notification_types.py \
  odoo-addons/webvue_pmo/models/directory.py
git commit -m "fix(api): check registered feature keys in sorted order" -m "<TRAILER>"
```

---

### Task 2: Derive the legacy grants and the module allow-list from the registry

**Files:**
- Modify: `odoo-addons/webvue_platform/models/entitlement_service.py` (`_webvue_legacy_features_for`)
- Modify: `odoo-addons/webvue_platform/models/tenant_profile.py` (`_webvue_initialize_legacy_policy`)
- Create: `odoo-addons/webvue_platform/tests/test_legacy_grants.py`
- Modify: `odoo-addons/webvue_platform/tests/__init__.py`, `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Produces: `webvue.entitlement.service._webvue_legacy_features_for(selected_modules) -> dict` built from `webvue.feature.registry._webvue_feature_map()`; `_webvue_initialize_legacy_policy` accepts any id of `webvue.feature.registry._webvue_module_map()`. Task 6 relies on it to grant `meetings.enabled` to tenants that select `webvue_meetings` without editing the platform.

- [ ] **Step 1: Write the failing test**

Create `odoo-addons/webvue_platform/tests/test_legacy_grants.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

PROBE_APP = 'webvue_probe_app'


@tagged('post_install', '-at_install', 'webvue')
class TestLegacyGrants(TransactionCase):
    """The one-shot legacy grants come from the feature registry: the platform names no application (ruling H.10)."""

    def setUp(self):
        super().setUp()
        registry = type(self.env['webvue.feature.registry'])
        features, modules = registry._webvue_feature_definitions, registry._webvue_module_definitions
        probe = (
            {'key': 'probe_app.enabled', 'type': 'boolean', 'owner': PROBE_APP, 'module': PROBE_APP},
            {'key': 'probe_app.max_items', 'type': 'limit', 'owner': PROBE_APP, 'module': PROBE_APP},
        )
        self.patch(registry, '_webvue_feature_definitions', lambda model: (*features(model), *probe))
        self.patch(registry, '_webvue_module_definitions', lambda model: (*modules(model), {'id': PROBE_APP}))
        self.service = self.env['webvue.entitlement.service'].sudo()

    def test_a_selected_application_gets_every_feature_it_registers(self):
        features = self.service._webvue_legacy_features_for((PROBE_APP,))
        self.assertIs(features['probe_app.enabled'], True)
        self.assertIsNone(features['probe_app.max_items'])
        for key in ('users.limit', 'storage.limit_mb', 'branches.extra_limit'):
            self.assertIsNone(features[key], key)

    def test_an_application_neither_selected_nor_installed_gets_nothing(self):
        features = self.service._webvue_legacy_features_for(())
        self.assertNotIn('probe_app.enabled', features)
        self.assertNotIn('probe_app.max_items', features)

    def test_an_installed_unselected_application_is_withheld(self):
        registry = type(self.env['webvue.feature.registry'])
        installed = registry._webvue_installed_module_ids
        self.patch(registry, '_webvue_installed_module_ids', lambda model: (*installed(model), PROBE_APP))
        features = self.service._webvue_legacy_features_for(())
        self.assertIs(features['probe_app.enabled'], False)
        self.assertIsNone(features['probe_app.max_items'])

    def test_the_allow_list_is_the_registered_module_ids(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        self.env.cr.execute('UPDATE webvue_tenant_profile SET policy_revision = 0 WHERE id = %s', [profile.id])
        profile.invalidate_recordset()
        with self.assertRaisesRegex(ValidationError, 'webvue_not_registered'):
            profile._webvue_initialize_legacy_policy(('webvue_not_registered',))
        profile._webvue_initialize_legacy_policy((PROBE_APP,))
        self.assertIs(profile.features['probe_app.enabled'], True)
        self.assertIn('probe_app.enabled', profile.retained_read_features)
```

In `odoo-addons/webvue_platform/tests/__init__.py` add `    test_legacy_grants,` after `    test_entitlements,`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t2 \
  webvue_core,webvue_platform,webvue_api,webvue_hr \
  /webvue_platform:TestLegacyGrants
```

Expected: the run dies with `tests failed`; `test_a_selected_application_gets_every_feature_it_registers` fails with `KeyError: 'probe_app.enabled'`. Drop the kept database.

- [ ] **Step 3: Derive the grants from the registry**

In `odoo-addons/webvue_platform/models/entitlement_service.py` replace the whole method:

```python
    @api.model
    def _webvue_legacy_features_for(self, selected_modules):
        selected = set(selected_modules)
        installed = set(self._webvue_installed_modules())
        features = {
            'users.limit': None,
            'storage.limit_mb': None,
            'branches.extra_limit': None,
        }
        grants = {
            'webvue_pmo': (
                ('pmo.enabled', True),
                ('meetings.enabled', True),
                ('projects.max_projects', None),
            ),
            'webvue_hr': (
                ('hr.enabled', True),
            ),
            'webvue_chat': (
                ('chat.enabled', True),
            ),
        }
        for module_id, items in grants.items():
            if module_id in selected:
                for key, value in items:
                    features[key] = value
            elif module_id in installed:
                for key, value in items:
                    features[key] = False if isinstance(value, bool) else None
        return features
```

with:

```python
    @api.model
    def _webvue_legacy_features_for(self, selected_modules):
        """One-shot legacy grants, derived from the feature registry.

        Every feature an application registers is granted when the
        application is selected (booleans on, limits unlimited) and withheld
        when it is installed but not selected (booleans off, limits
        unlimited). Platform features are always present. Applications
        register their features, so the platform names none of them.
        """
        selected = set(selected_modules)
        installed = set(self._webvue_installed_modules())
        features = {}
        for key, item in sorted(self._webvue_registry()._webvue_feature_map().items()):
            module_id = item['module']
            boolean = item['type'] == 'boolean'
            if module_id == 'webvue_platform' or module_id in selected:
                features[key] = True if boolean else None
            elif module_id in installed:
                features[key] = False if boolean else None
        return features
```

In `odoo-addons/webvue_platform/models/tenant_profile.py` replace:

```python
        unknown = set(selected_modules) - {'webvue_pmo', 'webvue_hr', 'webvue_chat'}
```

with:

```python
        unknown = set(selected_modules) - set(self.env['webvue.feature.registry']._webvue_module_map())
```

- [ ] **Step 4: Regenerate the baseline and run the static checks**

```bash
ruff check odoo-addons
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
rg -n "webvue_pmo|webvue_hr|webvue_chat|meetings\.enabled|pmo\.enabled|hr\.enabled|chat\.enabled" odoo-addons/webvue_platform/models || echo "platform names no application in models"
```

Expected: `All checks passed!`; `exit=0`; R2 in `tools/arch_baseline.json` drops from 8 to 4 (only the terminology keys on lines 25-26 of `entitlement_service.py` remain); the last command prints only those two terminology lines.

- [ ] **Step 5: Run the focused tests on the full and the partial install**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t2 \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_platform,/webvue_api:TestAccessComposition,/webvue_pmo:TestProjectQuota
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t2_partial \
  webvue_core,webvue_platform,webvue_api,webvue_hr \
  /webvue_platform
```

Expected: two `ODOO_RUN_TEST_OK` lines. `TestEntitlements.test_legacy_initializer_grants_installed_pillars_once` still passes unchanged: that is the proof that the registry grants equal the old table.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_platform tools/arch_baseline.json
git commit -m "refactor(platform): derive legacy grants from the feature registry" -m "<TRAILER>"
```

---

### Task 3: Accept the webvue_meetings module id in the contract and the vendor labels

**Files:**
- Modify: `packages/contracts/src/common/me.ts:22`, `packages/contracts/src/common/__tests__/schemas.test.ts`
- Modify: `apps/web/app/utils/vendorPackages.ts:18`, `apps/web/app/utils/__tests__/vendorPackages.test.ts`, `apps/web/i18n/locales/ar/vendor.json`, `apps/web/i18n/locales/en/vendor.json`

**Interfaces:**
- Produces: `WebVueModuleIdSchema = z.enum(['webvue_chat', 'webvue_hr', 'webvue_meetings', 'webvue_pmo'])`; `packageLabel('module', 'webvue_meetings', t)` → `t('vendor.packages.apps.meetings')`. Lands before Task 6 so no commit ever serves a `/me.modules` value the contract rejects.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/src/common/__tests__/schemas.test.ts` replace:

```ts
      modules: ['webvue_pmo', 'webvue_hr'],
      entitlements: { 'pmo.enabled': true, 'users.limit': null, 'projects.max_projects': 12 },
```

with:

```ts
      modules: ['webvue_pmo', 'webvue_meetings', 'webvue_hr'],
      entitlements: { 'pmo.enabled': true, 'users.limit': null, 'projects.max_projects': 12 },
```

and after `    expect(me.terminology.ar.project).toBe('مبادرة')` add:

```ts
    expect(me.modules).toEqual(['webvue_pmo', 'webvue_meetings', 'webvue_hr'])
```

In `apps/web/app/utils/__tests__/vendorPackages.test.ts`, after `    expect(packageLabel('module', 'future_module', key => key)).toBe('future_module')` add:

```ts
    expect(packageLabel('module', 'webvue_meetings', key => key)).toBe('vendor.packages.apps.meetings')
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
npm -w packages/contracts run test 2>&1 | tail -n 15
npm -w apps/web run test -- app/utils/__tests__/vendorPackages.test.ts 2>&1 | tail -n 15
```

Expected: the schema test fails with an invalid enum value `webvue_meetings`; the label test fails expecting `vendor.packages.apps.meetings` and receiving `webvue_meetings`.

- [ ] **Step 3: Add the id, the label and its translations**

In `packages/contracts/src/common/me.ts` replace:

```ts
export const WebVueModuleIdSchema = z.enum(['webvue_chat', 'webvue_hr', 'webvue_pmo'])
```

with:

```ts
export const WebVueModuleIdSchema = z.enum(['webvue_chat', 'webvue_hr', 'webvue_meetings', 'webvue_pmo'])
```

In `apps/web/app/utils/vendorPackages.ts` replace:

```ts
  module: { webvue_core: 'core', webvue_platform: 'platform', webvue_api: 'api', webvue_pmo: 'projects', webvue_hr: 'people', webvue_chat: 'messaging' },
```

with:

```ts
  module: { webvue_core: 'core', webvue_platform: 'platform', webvue_api: 'api', webvue_pmo: 'projects', webvue_meetings: 'meetings', webvue_hr: 'people', webvue_chat: 'messaging' },
```

Add the label in both locale files with a JSON-preserving edit:

```bash
python3 - <<'PY'
import json
from pathlib import Path

labels = {'ar': 'الاجتماعات والقرارات', 'en': 'Meetings and decisions'}
for lang, label in labels.items():
    path = Path(f'apps/web/i18n/locales/{lang}/vendor.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    apps = data['vendor']['packages']['apps']
    assert 'meetings' not in apps, (lang, apps)
    apps['meetings'] = label
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(lang, sorted(apps))
PY
git diff --stat apps/web/i18n/locales
```

Expected: two lines listing `meetings` among the app keys; the diff touches exactly one added line per file. If the diff shows reformatting beyond that line (the files use another indentation), revert with `git checkout -- apps/web/i18n/locales` and insert the line `"meetings": "<label>",` by hand directly after the `"projects"` entry of `vendor.packages.apps` in each file.

- [ ] **Step 4: Run the tests and the type check**

```bash
npm -w packages/contracts run test 2>&1 | tail -n 5
npm -w apps/web run test 2>&1 | tail -n 8
npm -w apps/web run lint 2>&1 | tail -n 5
```

Expected: both suites green (the locale-parity tests still pass because both locales gained the same key) and the type check passes.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/common apps/web/app/utils apps/web/i18n/locales/ar/vendor.json apps/web/i18n/locales/en/vendor.json
git commit -m "feat(web): accept the webvue_meetings module id" -m "<TRAILER>"
```

---

### Task 4: Make the auto-install closure faithful to Odoo

**Files:**
- Modify: `tools/webvue_cli/module_closure.py`
- Modify: `tools/test_module_closure.py`

**Interfaces:**
- Produces: `install_closure(addons_paths, selected) -> set[str]` adds an `auto_install` WebVue module only when all its WebVue dependencies are in the closure **and** each of its other dependencies is `base` or a direct dependency of some module in the closure. Task 8 adds the real-bridge-manifest test.

- [ ] **Step 1: Write the failing test**

Append to the class in `tools/test_module_closure.py`:

```python

    def test_auto_install_module_needs_its_odoo_dependencies_in_the_closure(self):
        with tempfile.TemporaryDirectory() as root:
            for name, manifest in {
                'webvue_a': "{'depends': ['project']}",
                'webvue_b': "{'depends': ['hr']}",
                'webvue_glue_project': "{'depends': ['webvue_a', 'project'], 'auto_install': True}",
                'webvue_glue_mail': "{'depends': ['webvue_a', 'mail'], 'auto_install': True}",
                'webvue_glue_base': "{'depends': ['base'], 'auto_install': True}",
            }.items():
                (Path(root) / name).mkdir()
                (Path(root) / name / '__manifest__.py').write_text(manifest)
            self.assertEqual(
                module_closure.install_closure([root], ['webvue_a']),
                {'webvue_a', 'webvue_glue_project', 'webvue_glue_base'},
            )
            self.assertEqual(module_closure.install_closure([root], ['webvue_b']), {'webvue_b', 'webvue_glue_base'})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
python3 -B -m unittest discover -s tools -p 'test_module_closure.py' 2>&1 | tail -n 8
```

Expected: FAIL — the closure contains `webvue_glue_mail` and lacks `webvue_glue_base`.

- [ ] **Step 3: Implement the faithful rule**

Replace `tools/webvue_cli/module_closure.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Installation closure of a selected WebVue module set, read from real manifests.

Odoo installs a module's dependencies and any ``auto_install`` module whose
dependencies are all installed. The managed-tenant tooling therefore compares
what is installed with this closure, not with the raw selection. Odoo addons
(project, hr, mail ...) are not resolvable here: an ``auto_install`` WebVue
module joins only when each of its Odoo dependencies is ``base`` or a direct
dependency of some module already in the closure.
"""
from __future__ import annotations

import ast
from pathlib import Path

REPO_ADDONS = Path(__file__).resolve().parents[2] / 'odoo-addons'
_OWNED_PREFIXES = ('webvue_', 'customer_')


class ClosureError(Exception):
    """A selected or required WebVue module has no readable manifest."""


def _owned(name):
    return name.startswith(_OWNED_PREFIXES)


def _read_manifest(addons_paths, module):
    """``(webvue dependencies, other dependencies, auto_install)`` of ``module``."""
    for directory in addons_paths:
        manifest = Path(directory) / module / '__manifest__.py'
        if manifest.is_file():
            try:
                value = ast.literal_eval(manifest.read_text(encoding='utf-8'))
                depends = value.get('depends', [])
                auto = value.get('auto_install', False)
            except (OSError, ValueError, SyntaxError, AttributeError):
                raise ClosureError(module) from None
            if not isinstance(depends, list) or any(type(dep) is not str for dep in depends):
                raise ClosureError(module)
            owned = [dep for dep in depends if _owned(dep)]
            other = [dep for dep in depends if not _owned(dep)]
            return owned, other, bool(auto)
    raise ClosureError(module)


def install_closure(addons_paths, selected):
    """Return the set of WebVue modules Odoo installs for ``selected``."""
    paths = [addons_paths] if isinstance(addons_paths, (str, Path)) else list(addons_paths)
    manifests = {}
    pending = list(selected)
    while pending:
        name = pending.pop()
        if name in manifests:
            continue
        manifests[name] = _read_manifest(paths, name)
        pending.extend(manifests[name][0])
    closure = set(manifests)
    # Odoo addons the closure requires directly; Odoo installs them with it.
    required = {'base'}
    for _owned_deps, other_deps, _auto in manifests.values():
        required.update(other_deps)
    # Auto-install candidates: every owned module present in the addons paths.
    candidates = {}
    for directory in paths:
        root = Path(directory)
        if not root.is_dir():
            continue
        for entry in root.iterdir():
            if _owned(entry.name) and (entry / '__manifest__.py').is_file():
                candidates.setdefault(entry.name, None)
    changed = True
    while changed:
        changed = False
        for name in sorted(candidates):
            if name in closure:
                continue
            try:
                owned_deps, other_deps, auto = _read_manifest(paths, name)
            except ClosureError:
                continue
            if (
                auto and (owned_deps or other_deps)
                and all(dep in closure for dep in owned_deps)
                and all(dep in required for dep in other_deps)
            ):
                closure.add(name)
                required.update(other_deps)
                changed = True
    return closure
```

- [ ] **Step 4: Run the tools suite**

```bash
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
```

Expected: `OK` (the managed-tenant tests keep their closures: no repository addon is `auto_install` yet).

- [ ] **Step 5: Commit**

```bash
git add tools/webvue_cli/module_closure.py tools/test_module_closure.py
git commit -m "fix(tools): add auto_install modules only with their Odoo dependencies" -m "<TRAILER>"
```

---
### Task 5: Split the meeting code inside webvue_pmo into meetings-only and bridge files

Behaviour-preserving refactor, still inside `webvue_pmo` (which still depends on `cyan_meeting_minutes`). Afterwards every meeting file is either *meetings only* (moves to `webvue_meetings` in Task 6) or *bridge* (moves to `webvue_meetings_pmo`), and meetings code reaches projects and tasks only through `webvue.meeting.links`. The existing tests prove nothing changed; the mixed test files are split the same way.

**Files (all under `odoo-addons/webvue_pmo/`):**
- Create (meetings): `models/meeting_links.py`, `models/meeting_access_service.py`, `models/meeting_feature_registry.py`, `models/meeting_directory.py`, `models/meeting_notification_types.py`, `models/meeting_mail_message.py`, `serializers/meeting_notification.py`, `security/meeting_capability_groups.xml`, `data/meeting_access_permissions.xml`, `tests/meetings_common.py`, `tests/test_meeting_lifecycle.py`
- Create (bridge): `models/meeting_links_pmo.py`, `models/meeting_project.py`, `models/meeting_convert.py`, `models/project_task_meeting.py`, `controllers/meeting_convert.py`, `tests/test_meeting_feature_gates.py`, `tests/test_meeting_history_pmo.py`, `tests/test_meeting_series_pmo.py`, `tests/test_meeting_workspace_pmo.py`, `tests/test_meetings_pmo.py`
- Modify (meetings): `models/meeting_minute.py`, `models/meeting_series.py`, `models/meeting_workspace.py`, `models/meeting_history.py`, `models/meeting_resolution.py` (rewritten), `serializers/meeting.py` (rewritten), `controllers/meetings.py`, `controllers/meeting_series.py`, `controllers/meeting_workspace.py`, `tests/test_meeting_*.py`, `tests/test_meetings.py`
- Modify (pmo): `models/access_service.py`, `models/feature_registry.py`, `models/directory.py`, `models/notification_types.py`, `models/mail_notification_webvue.py`, `models/project_task.py`, `serializers/notification.py`, `security/pmo_capability_groups.xml`, `data/pmo_access_permissions.xml`, `models/__init__.py`, `controllers/__init__.py`, `tests/__init__.py`, `tests/test_feature_enforcement.py`, `tests/test_notifications.py`, `tests/test_pmo_access_composition.py`, `tests/test_resolution_convert.py`, `__manifest__.py`
- Modify: `tools/arch_baseline.json` (regenerated)
- Create (outside the repo): `/tmp/webvue-meetings/split_tests.py`

**Interfaces:**
- Produces: AbstractModel `webvue.meeting.links` with `@api.model` hooks
  `_webvue_link_fields() -> frozenset[str]`,
  `_webvue_project_id(record) -> int | None`,
  `_webvue_project_ref(record) -> dict | None`,
  `_webvue_project_ref_by_id(record, project_id) -> dict | None`,
  `_webvue_project_domain(project_id: int) -> list`,
  `_webvue_check_project(project_id: int) -> int` (raises `ApiError`),
  `_webvue_project_vals(project_id: int | False) -> dict` (raises `ApiError`),
  `_webvue_check_topic_project(project_id: int) -> None` (raises `ValidationError`),
  `_webvue_linked_resolution_ids(resolutions) -> set[int]`,
  `_webvue_readable_links(meeting, resolutions) -> dict[int, dict]` with entries `{'task_id': int, 'state': 'done'|'cancelled'|'in_progress', 'company_id': int, 'project_id': int}`.
- Produces: `webvue.meeting.series._webvue_extra_meeting_defaults() -> dict`; `project.task._webvue_extra_create_fields() -> frozenset[str]`; `serializers.meeting.dump_resolution(resolution, link=None)` (replaces `task_id=None`); `serializers.meeting_notification.dump_meeting_notification(notification)`; `CONVERT_MARKER = 'webvue_meetings_pmo.resolution_convert_depth'` in `models/project_task_meeting.py`; `MEETINGS_PERMISSIONS`, `EMPLOYEE_MEETINGS_PERMISSIONS` in `models/meeting_access_service.py`; `WebVueMeetingsCase` in `tests/meetings_common.py`.

- [ ] **Step 1: Add the link hooks (meetings default and the project/task implementation)**

Create `odoo-addons/webvue_pmo/models/meeting_links.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hooks that link meetings to the records of other applications.

The meetings application knows no other application. A bridge addon (for
projects and tasks: webvue_meetings_pmo) inherits this model and fills the
hooks; without one every meeting has no project and no linked task, and
the API keeps its payload shape with null values (ruling H.1). Every hook
runs in the caller's environment.
"""
from odoo import api, models
from odoo.exceptions import ValidationError

from odoo.addons.webvue_api.controllers.common import ApiError

UNSUPPORTED_PROJECT = 'project_id is not supported: the projects application is not installed'


class WebVueMeetingLinks(models.AbstractModel):
    _name = 'webvue.meeting.links'
    _description = 'Meeting links to other applications'
    _webvue_scope = 'global'

    @api.model
    def _webvue_link_fields(self):
        """Fields the bridges add to meetings; they follow the content edits of a scope."""
        return frozenset()

    @api.model
    def _webvue_project_id(self, record):
        """The id of the project linked to a meeting, series or recommendation, or None."""
        return None

    @api.model
    def _webvue_project_ref(self, record):
        """``{'id', 'name'}`` of the linked project when the caller may read it, else None."""
        return None

    @api.model
    def _webvue_project_ref_by_id(self, record, project_id):
        """Like ``_webvue_project_ref`` for a stored project id (minutes topics, snapshots)."""
        return None

    @api.model
    def _webvue_project_domain(self, project_id):
        """Domain of a list's ``?project_id=`` filter; without projects the filter is ignored."""
        return []

    @api.model
    def _webvue_check_project(self, project_id):
        """Validate the project requested for a recommendation and return its id."""
        raise ApiError(422, 'invalid', UNSUPPORTED_PROJECT, field='project_id')

    @api.model
    def _webvue_project_vals(self, project_id):
        """Values that link a record to ``project_id`` (an id) or clear the link (False)."""
        if not project_id:
            return {}
        raise ApiError(422, 'invalid', UNSUPPORTED_PROJECT, field='project_id')

    @api.model
    def _webvue_check_topic_project(self, project_id):
        """Validate the project of a minutes topic; raise ValidationError when it is not usable."""
        raise ValidationError(self.env._('Minutes topic projects need the projects application.'))

    @api.model
    def _webvue_linked_resolution_ids(self, resolutions):
        """Ids of ``resolutions`` followed on a linked record of another application, archived links included."""
        return set()

    @api.model
    def _webvue_readable_links(self, meeting, resolutions):
        """``{resolution_id: {'task_id', 'state', 'company_id', 'project_id'}}`` of links the caller can read now."""
        return {}
```

Create `odoo-addons/webvue_pmo/models/meeting_links_pmo.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Project and task links of meetings: the hooks of webvue.meeting.links, filled by the bridge.

Documented elevated read: ``_webvue_linked_resolution_ids`` searches converted
tasks, archived ones included, with an elevated search restricted to the
given recommendation ids, because a converted recommendation stays frozen
even when the caller cannot read its task. It returns ids only. Every other
hook reads projects and tasks in the caller's environment.
"""
from odoo import api, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.webvue_api.controllers.common import ApiError, get_record

TASK_EXECUTION_STATES = {
    '1_done': 'done',
    '1_canceled': 'cancelled',
}


class WebVueMeetingProjectLinks(models.AbstractModel):
    _inherit = 'webvue.meeting.links'

    @api.model
    def _webvue_link_fields(self):
        return super()._webvue_link_fields() | {'project_id'}

    @api.model
    def _webvue_project_id(self, record):
        return record.project_id.id or None

    @api.model
    def _webvue_project_ref(self, record):
        return self._webvue_visible_project_ref(record.project_id)

    @api.model
    def _webvue_project_ref_by_id(self, record, project_id):
        if not project_id:
            return None
        return self._webvue_visible_project_ref(self.env['project.project'].browse(project_id).exists())

    @api.model
    def _webvue_visible_project_ref(self, project):
        if not project or project.company_id != self.env.company:
            return None
        if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, 'pmo.projects.read'):
            return None
        try:
            project.check_access('read')
        except AccessError:
            return None
        return {'id': project.id, 'name': project.name}

    @api.model
    def _webvue_project_domain(self, project_id):
        return [('project_id', '=', project_id)]

    @api.model
    def _webvue_check_project(self, project_id):
        project = get_record('project.project', project_id)
        if project.company_id != self.env.company:
            raise ApiError(422, 'invalid', 'project_id must belong to the current company', field='project_id')
        project.check_access('read')
        return project.id

    @api.model
    def _webvue_project_vals(self, project_id):
        return {'project_id': project_id or False}

    @api.model
    def _webvue_check_topic_project(self, project_id):
        project = self.env['project.project'].browse(project_id).exists()
        if not project or project.company_id != self.env.company:
            raise ValidationError(self.env._('Minutes topic project is not available in the current company.'))
        project.check_access('read')

    @api.model
    def _webvue_linked_resolution_ids(self, resolutions):
        linked = super()._webvue_linked_resolution_ids(resolutions)
        if not resolutions:
            return linked
        tasks = self.env['project.task'].with_context(active_test=False).sudo().search_fetch(
            [('resolution_id', 'in', resolutions.ids)], ['resolution_id'],
        )
        return linked | {task.resolution_id for task in tasks}

    @api.model
    def _webvue_readable_links(self, meeting, resolutions):
        links = super()._webvue_readable_links(meeting, resolutions)
        Task = self.env['project.task']
        can_read_tasks = self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'pmo.tasks.read',
        ) and Task.has_access('read')
        if not can_read_tasks or not resolutions:
            return links
        tasks = Task.search([
            ('resolution_id', 'in', resolutions.ids),
            ('company_id', '=', self.env.company.id),
            ('project_id.company_id', '=', self.env.company.id),
            ('project_id.active', '=', True),
            ('active', '=', True),
        ])
        for task in tasks:
            if task.resolution_id:
                links[task.resolution_id] = {
                    'task_id': task.id,
                    'state': TASK_EXECUTION_STATES.get(task.state, 'in_progress'),
                    'company_id': task.company_id.id,
                    'project_id': task.project_id.id,
                }
        return links
```

- [ ] **Step 2: Move the project fields and the conversion into bridge files**

Create `odoo-addons/webvue_pmo/models/meeting_project.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The project a meeting, a series or a recommendation belongs to (the meetings/PMO bridge)."""
from odoo import fields, models

from .meeting_workspace import WebVueMeetingResolutionWorkspace, WebVueMeetingWorkspace


class CyanMeetingMinuteProject(models.Model):
    _inherit = 'cyan.meeting.minute'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _CONTENT_FIELDS = WebVueMeetingWorkspace._CONTENT_FIELDS | {'project_id'}


class CyanMeetingResolutionProject(models.Model):
    _inherit = 'cyan.meeting.resolution'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _DECISION_FIELDS = WebVueMeetingResolutionWorkspace._DECISION_FIELDS | {'project_id'}


class WebVueMeetingSeriesProject(models.Model):
    _inherit = 'webvue.meeting.series'

    project_id = fields.Many2one('project.project', check_company=True, index=True)

    def _webvue_extra_meeting_defaults(self):
        return {**super()._webvue_extra_meeting_defaults(), 'project_id': self.project_id.id}
```

Create `odoo-addons/webvue_pmo/models/project_task_meeting.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tasks converted from meeting recommendations (the meetings/PMO bridge)."""
from odoo import api, fields, models

ORIGIN_FIELDS = frozenset({'meeting_id', 'resolution_id'})
# Cursor-local marker set only around the checked conversion; never a context flag.
CONVERT_MARKER = 'webvue_meetings_pmo.resolution_convert_depth'


class ProjectTaskMeetingOrigin(models.Model):
    _inherit = 'project.task'

    # Opaque origin ids of the meeting and the recommendation a task was converted from.
    meeting_id = fields.Integer(copy=False, index=True)
    resolution_id = fields.Integer(copy=False, index=True)
    _webvue_resolution_task_unique = models.UniqueIndex(
        '(resolution_id) WHERE resolution_id IS NOT NULL AND resolution_id > 0',
    )

    @api.model
    def _webvue_extra_create_fields(self):
        extra = super()._webvue_extra_create_fields()
        if self.env.cr.precommit.data.get(CONVERT_MARKER):
            extra = extra | ORIGIN_FIELDS
        return extra
```

Create `odoo-addons/webvue_pmo/models/meeting_convert.py` (the body of `action_convert_to_task` is unchanged from `models/meeting_resolution.py:21-76`):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Convert a meeting recommendation into a PMO task (the meetings/PMO bridge)."""
from psycopg2 import IntegrityError

from odoo import fields, models
from odoo.exceptions import AccessError, UserError

from .project_task_meeting import CONVERT_MARKER


class CyanMeetingResolutionConvert(models.Model):
    _inherit = 'cyan.meeting.resolution'

    def action_convert_to_task(self, project_id):
        """Mint a PMO task from this recommendation. Origin ids are opaque integers."""
        self.ensure_one()
        self.check_access('read')
        meeting = self.meeting_id
        meeting.check_access('read')
        if meeting.company_id != self.env.company:
            raise AccessError(self.env._("Meeting is outside the current company."))
        service = self.env['webvue.access.service']
        if not (
            service._webvue_has_capability(self.env.user, 'meetings.manage')
            or self._cyan_is_meeting_editor(meeting)
        ):
            raise AccessError(self.env._(
                "Only a meeting editor or meetings manager can convert a recommendation to a task.",
            ))
        if meeting.state in meeting._LOCKED_STATES:
            raise UserError(self.env._("Reopen the meeting before converting a recommendation."))
        project = self.env['project.project'].browse(project_id).exists()
        if not project:
            raise UserError(self.env._("A visible current-company project is required."))
        project._webvue_check_visible_current()
        try:
            # Enter/flush before setting the creation marker: Odoo flush and
            # rollback clear precommit.data. Clear the marker before exit too.
            with self.env.cr.savepoint():
                marker = self.env.cr.precommit.data
                previous_depth = marker.get(CONVERT_MARKER, 0)
                marker[CONVERT_MARKER] = previous_depth + 1
                try:
                    task = self.env['project.task'].create({
                        'name': self.name,
                        'priority': self.priority,
                        'date_deadline': fields.Datetime.to_datetime(self.deadline) if self.deadline else False,
                        'user_ids': [(6, 0, [self.responsible_id.id])] if self.responsible_id else [],
                        'project_id': project.id,
                        'meeting_id': meeting.id,
                        'resolution_id': self.id,
                    })
                finally:
                    if previous_depth:
                        marker[CONVERT_MARKER] = previous_depth
                    else:
                        marker.pop(CONVERT_MARKER, None)
        except IntegrityError as error:
            if error.diag.constraint_name != 'project_task_webvue_resolution_task_unique':
                raise
            raise UserError(self.env._("This recommendation has already been converted.")) from error
        if self.responsible_id:
            meeting._webvue_notify_partners(
                self.responsible_id.partner_id,
                'meeting_converted',
                self.name,
                key=f'meeting-converted:{self.id}',
            )
        return task
```

Replace `odoo-addons/webvue_pmo/models/meeting_resolution.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import UserError


class CyanMeetingResolution(models.Model):
    _inherit = 'cyan.meeting.resolution'

    def write(self, vals):
        if not self.env.su and (self._DECISION_FIELDS | {'state', 'result'}) & set(vals):
            # A recommendation followed on a linked record (a converted task) is frozen here.
            if self.env['webvue.meeting.links']._webvue_linked_resolution_ids(self):
                raise UserError(self.env._("Follow this recommendation on its task."))
        return super().write(vals)
```

In `odoo-addons/webvue_pmo/models/project_task.py` replace:

```python
TASK_CREATE_FIELDS = TASK_WRITABLE_FIELDS | {'parent_id', 'project_id'}
ORIGIN_FIELDS = frozenset({'meeting_id', 'resolution_id'})
CONVERT_MARKER = 'webvue_pmo.resolution_convert_depth'
```

with:

```python
TASK_CREATE_FIELDS = TASK_WRITABLE_FIELDS | {'parent_id', 'project_id'}
```

replace:

```python
    webvue_deliverables = fields.Json(default=lambda self: [], copy=True)
    meeting_id = fields.Integer(copy=False, index=True)
    resolution_id = fields.Integer(copy=False, index=True)
    _webvue_resolution_task_unique = models.UniqueIndex(
        '(resolution_id) WHERE resolution_id IS NOT NULL AND resolution_id > 0',
    )

    @api.model
    def _webvue_template_population_domain(self):
```

with:

```python
    webvue_deliverables = fields.Json(default=lambda self: [], copy=True)

    @api.model
    def _webvue_extra_create_fields(self):
        """Fields a checked internal flow may set on create besides TASK_CREATE_FIELDS.

        None here. An addon that mints tasks from its own records (the
        meetings bridge) adds its origin fields while its cursor-local marker
        is set; a client can never set them.
        """
        return frozenset()

    @api.model
    def _webvue_template_population_domain(self):
```

and replace:

```python
            for vals in vals_list:
                allowed = TASK_CREATE_FIELDS
                if self.env.cr.precommit.data.get(CONVERT_MARKER):
                    allowed = allowed | ORIGIN_FIELDS
                if set(vals) - allowed:
```

with:

```python
            for vals in vals_list:
                allowed = TASK_CREATE_FIELDS | self._webvue_extra_create_fields()
                if set(vals) - allowed:
```

Create `odoo-addons/webvue_pmo/controllers/meeting_convert.py` and delete the same handler from `controllers/meetings.py` in Step 5:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_positive_int,
    requires_feature,
)


class MeetingResolutionConvertController(http.Controller):

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>/convert',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', 'pmo.enabled', operation='write')
    def convert_resolution(self, meeting_id, resolution_id, project_id=None, **_):
        request.env['webvue.access.service']._webvue_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        resolution = get_record('cyan.meeting.resolution', resolution_id)
        if resolution.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'resolution not found')
        task = resolution.action_convert_to_task(parse_positive_int(project_id, 'project_id'))
        return {'id': task.id, 'name': task.name}
```

- [ ] **Step 3: Route the meeting models through the hooks**

In `odoo-addons/webvue_pmo/models/meeting_minute.py`:

Replace:

```python
    series_id = fields.Many2one(
        'webvue.meeting.series', index=True, ondelete='restrict', check_company=True,
    )
    project_id = fields.Many2one('project.project', check_company=True, index=True)
```

with:

```python
    series_id = fields.Many2one(
        'webvue.meeting.series', index=True, ondelete='restrict', check_company=True,
    )
```

Replace:

```python
                series.check_access('read')
                if series.project_id:
                    vals.setdefault('project_id', series.project_id.id)
                vals.setdefault('organizer_id', series.organizer_id.id)
```

with:

```python
                series.check_access('read')
                for field, value in series._webvue_extra_meeting_defaults().items():
                    if value:
                        vals.setdefault(field, value)
                vals.setdefault('organizer_id', series.organizer_id.id)
```

Replace:

```python
        converted_ids = self.env['project.task'].with_context(active_test=False).sudo().search([
            ('resolution_id', 'in', resolutions.ids),
        ]).mapped('resolution_id')
        for resolution in resolutions.filtered(lambda item: item.id not in converted_ids):
```

with:

```python
        # A recommendation followed on a linked record (a converted task) gets no overdue reminder.
        linked_ids = self.env['webvue.meeting.links']._webvue_linked_resolution_ids(resolutions)
        for resolution in resolutions.filtered(lambda item: item.id not in linked_ids):
```

Replace:

```python
        allowed = {
            'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date',
            'agenda', 'minutes', 'attendee_ids', 'secretary_id', 'project_id',
        }
```

with:

```python
        link_fields = self.env['webvue.meeting.links']._webvue_link_fields()
        allowed = {
            'name', 'location', 'start_datetime', 'end_datetime', 'meeting_url', 'meeting_date',
            'agenda', 'minutes', 'attendee_ids', 'secretary_id',
        } | link_fields
```

Replace:

```python
        content_fields = {'agenda', 'minutes', 'attendee_ids', 'secretary_id', 'project_id'}
```

with:

```python
        content_fields = {'agenda', 'minutes', 'attendee_ids', 'secretary_id'} | link_fields
```

In `odoo-addons/webvue_pmo/models/meeting_series.py`:

Replace:

```python
    project_id = fields.Many2one('project.project', check_company=True, index=True)
    organizer_id = fields.Many2one(
```

with:

```python
    organizer_id = fields.Many2one(
```

Replace:

```python
    def _webvue_meeting_defaults(self):
        self.ensure_one()
        attendees = self.attendee_ids
        if self.secretary_id:
            attendees -= self.secretary_id
        return {
            'name': self.name,
            'state': 'draft',
            'company_id': self.company_id.id,
            'series_id': self.id,
            'project_id': self.project_id.id,
            'organizer_id': self.organizer_id.id,
            'secretary_id': self.secretary_id.id,
            'attendee_ids': [(6, 0, attendees.ids)],
            'location': self.location or False,
            'meeting_url': self.meeting_url or False,
        }
```

with:

```python
    def _webvue_extra_meeting_defaults(self):
        """Occurrence defaults other applications add through super(); none here."""
        self.ensure_one()
        return {}

    def _webvue_meeting_defaults(self):
        self.ensure_one()
        attendees = self.attendee_ids
        if self.secretary_id:
            attendees -= self.secretary_id
        return {
            'name': self.name,
            'state': 'draft',
            'company_id': self.company_id.id,
            'series_id': self.id,
            'organizer_id': self.organizer_id.id,
            'secretary_id': self.secretary_id.id,
            'attendee_ids': [(6, 0, attendees.ids)],
            'location': self.location or False,
            'meeting_url': self.meeting_url or False,
            **self._webvue_extra_meeting_defaults(),
        }
```

In `odoo-addons/webvue_pmo/models/meeting_workspace.py`:

Replace:

```python
        'minutes', 'meeting_url', 'series_id', 'project_id', 'minutes_form_data',
```

with:

```python
        'minutes', 'meeting_url', 'series_id', 'minutes_form_data',
```

Replace:

```python
                project = self.env['project.project'].browse(topic['project_id']).exists()
                if not project or project.company_id != self.env.company:
                    raise ValidationError(self.env._('Minutes topic project is not available in the current company.'))
                project.check_access('read')
```

with:

```python
                self.env['webvue.meeting.links']._webvue_check_topic_project(topic['project_id'])
```

Replace:

```python
    execution_period = fields.Char(size=500)
    project_id = fields.Many2one('project.project', check_company=True, index=True)

    _DECISION_FIELDS = frozenset({
        'name', 'description', 'responsible_id', 'deadline', 'priority',
        'meeting_id', 'sequence', 'execution_period', 'project_id',
    })
```

with:

```python
    execution_period = fields.Char(size=500)

    _DECISION_FIELDS = frozenset({
        'name', 'description', 'responsible_id', 'deadline', 'priority',
        'meeting_id', 'sequence', 'execution_period',
    })
```

In `odoo-addons/webvue_pmo/models/meeting_history.py`:

Replace:

```python
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_pmo.serializers.meeting import (
    _readable_task_ids_by_resolution,
    dump_minutes_form,
    dump_project_id,
)

_SNAPSHOT_WRITE = ContextVar('webvue_meeting_snapshot_write', default=False)
_SNAPSHOT_FIELDS = frozenset({'minutes_snapshot', 'minutes_snapshot_data', 'minutes_snapshot_at'})
_TASK_EXECUTION_STATES = {
    '1_done': 'done',
    '1_canceled': 'cancelled',
}
```

with:

```python
from ..serializers.meeting import dump_minutes_form
from odoo.addons.webvue_api.serializers.common import iso

_SNAPSHOT_WRITE = ContextVar('webvue_meeting_snapshot_write', default=False)
_SNAPSHOT_FIELDS = frozenset({'minutes_snapshot', 'minutes_snapshot_data', 'minutes_snapshot_at'})
```

Replace:

```python
    def _compute_minutes_snapshot(self):
        for meeting in self:
```

with:

```python
    def _compute_minutes_snapshot(self):
        links = self.env['webvue.meeting.links']
        for meeting in self:
```

Replace:

```python
            task_by_resolution = {}
            if resolution_ids:
                resolutions = self.env['cyan.meeting.resolution'].browse(resolution_ids).exists()
                readable_ids = _readable_task_ids_by_resolution(meeting, resolutions)
                if readable_ids:
                    tasks = self.env['project.task'].browse(set(readable_ids.values())).exists()
                    task_by_resolution = {
                        task.resolution_id: task for task in tasks if task.resolution_id
                    }

            projected = {
```

with:

```python
            readable = {}
            if resolution_ids:
                resolutions = self.env['cyan.meeting.resolution'].browse(resolution_ids).exists()
                readable = links._webvue_readable_links(meeting, resolutions)

            projected = {
```

Replace:

```python
                safe_row['project'] = dump_project_id(meeting, row.get('project_id'))
                provenance = row.get('task_provenance') or {}
                task = task_by_resolution.get(row.get('id'))
                same_task = task and task.id == provenance.get('task_id')
```

with:

```python
                safe_row['project'] = links._webvue_project_ref_by_id(meeting, row.get('project_id'))
                provenance = row.get('task_provenance') or {}
                link = readable.get(row.get('id'))
                same_task = link and link['task_id'] == provenance.get('task_id')
```

Replace:

```python
        all_resolution_ids = [resolution.id for _origin, resolution in origins]
        task_by_resolution = {}
        if all_resolution_ids:
            resolutions = self.env['cyan.meeting.resolution'].browse(all_resolution_ids).exists()
            readable_ids = _readable_task_ids_by_resolution(self, resolutions)
            if readable_ids:
                tasks = self.env['project.task'].browse(set(readable_ids.values())).exists()
                task_by_resolution = {
                    task.resolution_id: task for task in tasks if task.resolution_id
                }

        resolutions = []
        for origin, resolution in origins:
            task = task_by_resolution.get(resolution.id)
            provenance = None
            projected_state = resolution.state
            if task:
                provenance = {
                    'task_id': task.id,
                    'company_id': task.company_id.id,
                    'project_id': task.project_id.id,
                }
                projected_state = _TASK_EXECUTION_STATES.get(task.state, 'in_progress')
```

with:

```python
        all_resolution_ids = [resolution.id for _origin, resolution in origins]
        links = self.env['webvue.meeting.links']
        readable = {}
        if all_resolution_ids:
            resolutions = self.env['cyan.meeting.resolution'].browse(all_resolution_ids).exists()
            readable = links._webvue_readable_links(self, resolutions)

        resolutions = []
        for origin, resolution in origins:
            link = readable.get(resolution.id)
            provenance = None
            projected_state = resolution.state
            if link:
                provenance = {
                    'task_id': link['task_id'],
                    'company_id': link['company_id'],
                    'project_id': link['project_id'],
                }
                projected_state = link['state']
```

Replace:

```python
                'project_id': resolution.project_id.id if resolution.project_id else None,
```

with:

```python
                'project_id': links._webvue_project_id(resolution),
```

- [ ] **Step 4: Rewrite the meeting serializer on the hooks**

Replace `odoo-addons/webvue_pmo/serializers/meeting.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Meeting wire shapes.

Links to other applications (a project, a converted task) come from the
``webvue.meeting.links`` hooks; without a bridge they are null and every
shape stays the same.
"""
from datetime import date, datetime

from odoo import fields

from odoo.addons.webvue_api.serializers.common import iso


def dump_person(user):
    return {'id': user.id, 'name': user.name} if user else None


def _links(record):
    return record.env['webvue.meeting.links']


def dump_minutes_form(meeting, form):
    if not isinstance(form, dict):
        return None
    links = _links(meeting)
    topics = []
    for topic in form.get('topics', []):
        if not isinstance(topic, dict):
            continue
        project_id = topic.get('project_id')
        topics.append({
            'key': topic.get('key', ''),
            'title': topic.get('title', ''),
            'discussion': topic.get('discussion', ''),
            'project_id': project_id if not project_id or links._webvue_project_ref_by_id(meeting, project_id) else None,
            'resolution_ids': list(topic.get('resolution_ids') or []),
        })
    return {
        'opening': form.get('opening', ''),
        'closing': form.get('closing', ''),
        'chairperson': form.get('chairperson', ''),
        'approver_name': form.get('approver_name', ''),
        'approver_title': form.get('approver_title', ''),
        'topics': topics,
    }


def dump_snapshot_payload(meeting, snapshot):
    """Project a server-built snapshot through current visibility rules."""
    if not isinstance(snapshot, dict):
        return None
    links = _links(meeting)
    snapshot_rows = [row for row in snapshot.get('resolutions', []) if isinstance(row, dict)]
    readable = {}
    resolution_ids = [row.get('id') for row in snapshot_rows if row.get('id')]
    if resolution_ids:
        resolutions = meeting.env['cyan.meeting.resolution'].browse(resolution_ids).exists()
        readable = links._webvue_readable_links(meeting, resolutions)
    result = {
        'captured_at': snapshot.get('captured_at'),
        'name': snapshot.get('name', ''),
        'meeting_date': snapshot.get('meeting_date'),
        'start_datetime': snapshot.get('start_datetime'),
        'end_datetime': snapshot.get('end_datetime'),
        'location': snapshot.get('location', ''),
        'organizer': snapshot.get('organizer'),
        'secretary': snapshot.get('secretary'),
        'attendees': snapshot.get('attendees') or [],
        'agenda': snapshot.get('agenda', ''),
        'minutes': snapshot.get('minutes', ''),
        'resolutions': [
            {
                'id': row.get('id'),
                'name': row.get('name', ''),
                'deadline': row.get('deadline'),
                'priority': row.get('priority', '0'),
                'state': (
                    row.get('projected_state', row.get('state', 'open'))
                    if row.get('id') in readable
                    and readable[row.get('id')]['task_id'] == (row.get('task_provenance') or {}).get('task_id')
                    else row.get('state', 'open')
                ),
                'responsible': row.get('responsible'),
                'result': row.get('result', ''),
                'meeting_name': row.get('meeting_name', snapshot.get('name', '')),
                'execution_period': row.get('execution_period') or '',
                'project': row.get('project') or links._webvue_project_ref_by_id(meeting, row.get('project_id')),
            }
            for row in snapshot.get('resolutions', [])
            if isinstance(row, dict)
        ],
    }
    form = dump_minutes_form(meeting, snapshot.get('minutes_form'))
    if form is not None:
        result['minutes_form'] = form
    return result


def dump_minutes_snapshot(meeting):
    """Expose only a completed meeting's frozen, server-built payload."""
    if meeting.state != 'done' or not isinstance(meeting.minutes_snapshot, dict):
        return None
    return dump_snapshot_payload(meeting, meeting.minutes_snapshot)


def dump_event(event, meeting=None):
    meeting = meeting or event.meeting_id
    return {
        'id': event.id,
        'meeting_id': meeting.id,
        'meeting_name': meeting.name,
        'occurred_at': iso(event.occurred_at),
        'actor': dump_person(event.actor_id),
        'kind': event.kind,
        'summary': event.summary,
    }


def dump_version(version):
    meeting = version.meeting_id
    meeting.check_access('read')
    snapshot = version.sudo().snapshot
    return {
        'id': version.id,
        'number': version.number,
        'captured_at': iso(version.captured_at),
        'actor': dump_person(version.actor_id),
        'snapshot': dump_snapshot_payload(meeting, snapshot),
    }


def _resolution_allowed_actions(resolution, *, linked, task_readable):
    if linked:
        return []
    meeting = resolution.meeting_id
    if meeting.state == 'cancelled':
        return []
    manager = resolution._cyan_is_manager()
    editor = resolution._cyan_is_meeting_editor(meeting)
    assignee = resolution.env.user == resolution.responsible_id
    if resolution.state in ('done', 'cancelled'):
        return ['reopen'] if manager else []
    if not editor and not assignee:
        return []
    actions = []
    if resolution.state == 'open':
        actions.append('start')
    actions.append('complete')
    if editor:
        actions.append('cancel')
    actions.append('edit_result')
    return actions


def dump_resolution(resolution, link=None):
    """``link`` is this recommendation's entry of ``_webvue_readable_links``, when the caller can read it."""
    links = _links(resolution)
    linked = bool(link) or resolution.id in links._webvue_linked_resolution_ids(resolution)
    execution_state = link['state'] if link else resolution.state
    allowed_actions = _resolution_allowed_actions(
        resolution, linked=linked, task_readable=bool(link),
    )
    return {
        'id': resolution.id,
        'name': resolution.name,
        'deadline': str(resolution.deadline) if resolution.deadline else None,
        'priority': resolution.priority,
        'state': resolution.state,
        'responsible': dump_person(resolution.responsible_id),
        'task_id': link['task_id'] if link else None,
        'result': resolution.result or '',
        'can_update_execution': bool(set(allowed_actions) & {'start', 'complete', 'cancel'}),
        'can_edit_decision': bool(resolution.can_edit_decision) and not linked,
        'execution_state': execution_state,
        'task_linked': linked,
        'allowed_actions': allowed_actions,
        'execution_period': resolution.execution_period or '',
        'project': links._webvue_project_ref(resolution),
    }


def _meeting_order_key(meeting):
    day = meeting.meeting_date or date.min
    start = meeting.start_datetime or datetime.min
    return day, start, meeting.id


def _projected_resolution_counts(meeting, resolutions=None):
    resolutions = resolutions if resolutions is not None else meeting.resolution_ids
    readable = _links(meeting)._webvue_readable_links(meeting, resolutions)
    now = fields.Date.context_today(meeting)
    open_count = overdue_count = 0
    for resolution in resolutions:
        link = readable.get(resolution.id)
        state = link['state'] if link else resolution.state
        if state in ('done', 'cancelled'):
            continue
        open_count += 1
        if resolution.deadline and resolution.deadline < now:
            overdue_count += 1
    return open_count, overdue_count


def dump_meeting(meeting, *, detail=False):
    links = _links(meeting)
    payload = {
        'id': meeting.id,
        'name': meeting.name,
        'reference': meeting.reference,
        'meeting_date': str(meeting.meeting_date) if meeting.meeting_date else None,
        'start_datetime': iso(meeting.start_datetime),
        'end_datetime': iso(meeting.end_datetime),
        'state': meeting.state,
        'organizer': dump_person(meeting.organizer_id),
        'open_resolution_count': _projected_resolution_counts(meeting)[0],
        'series_id': meeting.series_id.id or None,
        'project_id': links._webvue_project_id(meeting),
    }
    if detail:
        readable = links._webvue_readable_links(meeting, meeting.resolution_ids)
        payload.update({
            'agenda': meeting.agenda or '',
            'minutes': meeting.minutes or '',
            'location': meeting.location or '',
            'meeting_url': meeting.meeting_url or '',
            'can_edit': bool(meeting.can_edit),
            'can_manage': bool(meeting.can_manage),
            'secretary': dump_person(meeting.secretary_id),
            'attendees': [dump_person(user) for user in meeting.attendee_ids],
            'resolutions': [
                dump_resolution(item, readable.get(item.id))
                for item in meeting.resolution_ids
            ],
            'series': dump_person(meeting.series_id) if meeting.series_id else None,
            'project': links._webvue_project_ref(meeting),
            'previous_resolutions': dump_previous_resolutions(meeting),
            'minutes_snapshot': dump_minutes_snapshot(meeting),
        })
        form = dump_minutes_form(meeting, meeting.sudo().minutes_form_data)
        if form is not None:
            payload['minutes_form'] = form
    return payload


def dump_previous_resolutions(meeting):
    if not meeting.series_id:
        return []
    rows = []
    current_key = _meeting_order_key(meeting)
    others = meeting.series_id.meeting_ids.filtered(
        lambda item: item.id != meeting.id and _meeting_order_key(item) < current_key,
    )
    readable = _links(meeting)._webvue_readable_links(meeting, others.mapped('resolution_ids'))
    for other in others.sorted(key=_meeting_order_key):
        for resolution in other.resolution_ids:
            row = dump_resolution(resolution, readable.get(resolution.id))
            row['meeting_id'] = other.id
            row['meeting_name'] = other.name
            rows.append(row)
    return rows


def dump_series(series, *, detail=False):
    meetings = series.meeting_ids
    payload = {
        'id': series.id,
        'name': series.name,
        'recurrence': series.recurrence,
        'until_date': str(series.until_date) if series.until_date else None,
        'until_count': series.until_count or None,
        'organizer': dump_person(series.organizer_id),
        'project': _links(series)._webvue_project_ref(series),
        'open_resolution_count': sum(_projected_resolution_counts(meeting)[0] for meeting in meetings),
        'overdue_resolution_count': sum(_projected_resolution_counts(meeting)[1] for meeting in meetings),
    }
    if detail:
        payload.update({
            'location': series.location or '',
            'meeting_url': series.meeting_url or '',
            'secretary': dump_person(series.secretary_id),
            'attendees': [dump_person(user) for user in series.attendee_ids],
            'meetings': [dump_meeting(meeting) for meeting in meetings.sorted(key=_meeting_order_key)],
            'can_edit': bool(series._webvue_is_editor()),
        })
    return payload
```

- [ ] **Step 5: Route the meeting controllers through the hooks**

In `odoo-addons/webvue_pmo/controllers/meetings.py`:

Replace:

```python
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.serializers.meeting import dump_meeting, dump_resolution
```

with:

```python
from ..serializers.meeting import dump_meeting, dump_resolution
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
```

Replace (list filter):

```python
        if args.get('project_id'):
            domain.append(('project_id', '=', parse_positive_int(args.get('project_id'), 'project_id')))
        if args.get('series_id'):
```

with:

```python
        if args.get('project_id'):
            domain += request.env['webvue.meeting.links']._webvue_project_domain(
                parse_positive_int(args.get('project_id'), 'project_id'),
            )
        if args.get('series_id'):
```

Replace (create):

```python
        if project_id:
            vals['project_id'] = parse_positive_int(project_id, 'project_id')
        with request.env.cr.savepoint():
```

with:

```python
        if project_id:
            vals.update(request.env['webvue.meeting.links']._webvue_project_vals(
                parse_positive_int(project_id, 'project_id'),
            ))
        with request.env.cr.savepoint():
```

Replace (patch):

```python
        if 'project_id' in payload:
            vals['project_id'] = parse_positive_int(payload['project_id'], 'project_id') if payload['project_id'] else False
```

with:

```python
        if 'project_id' in payload:
            project_id = parse_positive_int(payload['project_id'], 'project_id') if payload['project_id'] else False
            vals.update(request.env['webvue.meeting.links']._webvue_project_vals(project_id))
```

Replace (create resolution):

```python
        if project_id is not None:
            project = get_record('project.project', parse_positive_int(project_id, 'project_id'))
            if project.company_id != request.env.company:
                raise ApiError(422, 'invalid', 'project_id must belong to the current company', field='project_id')
            project.check_access('read')
            vals['project_id'] = project.id
```

with:

```python
        if project_id is not None:
            links = request.env['webvue.meeting.links']
            vals.update(links._webvue_project_vals(
                links._webvue_check_project(parse_positive_int(project_id, 'project_id')),
            ))
```

Delete the convert handler (it now lives in `controllers/meeting_convert.py`):

```python
    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>/convert',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', 'pmo.enabled', operation='write')
    def convert_resolution(self, meeting_id, resolution_id, project_id=None, **_):
        request.env['webvue.access.service']._webvue_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        resolution = get_record('cyan.meeting.resolution', resolution_id)
        if resolution.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'resolution not found')
        task = resolution.action_convert_to_task(parse_positive_int(project_id, 'project_id'))
        return {'id': task.id, 'name': task.name}

```

Replace (patch resolution):

```python
        if 'project_id' in payload:
            if payload['project_id']:
                project = get_record('project.project', parse_positive_int(payload['project_id'], 'project_id'))
                if project.company_id != request.env.company:
                    raise ApiError(422, 'invalid', 'project_id must belong to the current company', field='project_id')
                project.check_access('read')
                vals['project_id'] = project.id
            else:
                vals['project_id'] = False
```

with:

```python
        if 'project_id' in payload:
            links = request.env['webvue.meeting.links']
            project_id = (
                links._webvue_check_project(parse_positive_int(payload['project_id'], 'project_id'))
                if payload['project_id'] else False
            )
            vals.update(links._webvue_project_vals(project_id))
```

In `odoo-addons/webvue_pmo/controllers/meeting_series.py`:

Replace:

```python
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.controllers.meetings import _parse_url
from odoo.addons.webvue_pmo.serializers.meeting import dump_meeting, dump_series
```

with:

```python
from ..serializers.meeting import dump_meeting, dump_series
from .meetings import _parse_url
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
```

Replace:

```python
        if args.get('project_id'):
            domain.append(('project_id', '=', parse_positive_int(args.get('project_id'), 'project_id')))
        Series = request.env['webvue.meeting.series']
```

with:

```python
        if args.get('project_id'):
            domain += request.env['webvue.meeting.links']._webvue_project_domain(
                parse_positive_int(args.get('project_id'), 'project_id'),
            )
        Series = request.env['webvue.meeting.series']
```

Replace:

```python
        if project_id:
            vals['project_id'] = parse_positive_int(project_id, 'project_id')
        if secretary_id:
```

with:

```python
        if project_id:
            vals.update(request.env['webvue.meeting.links']._webvue_project_vals(
                parse_positive_int(project_id, 'project_id'),
            ))
        if secretary_id:
```

In `odoo-addons/webvue_pmo/controllers/meeting_workspace.py` replace:

```python
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.serializers.meeting import (
    dump_event,
    dump_resolution,
    dump_version,
)
```

with:

```python
from ..serializers.meeting import (
    dump_event,
    dump_resolution,
    dump_version,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    requires_feature,
)
```

Replace `odoo-addons/webvue_pmo/controllers/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    meeting_attachments,
    meeting_convert,
    meeting_series,
    meeting_workspace,
    meetings,
    milestones,
    notifications,
    personal_stages,
    project_charter_catalogs,
    project_finance,
    project_followers,
    project_governance,
    project_reports,
    project_schedule,
    project_stages,
    project_templates,
    project_updates,
    projects,
    settings,
    tags,
    task_archive,
    task_attachments,
    task_dependencies,
    tasks,
    timeline,
)
```

- [ ] **Step 6: Split access, features, directory and notification kinds into meeting files**

Replace `odoo-addons/webvue_pmo/models/access_service.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
})
EMPLOYEE_PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
})
PROJECT_CONTEXTUAL_PERMISSIONS = frozenset({
    'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve',
})
PMO_PERMISSION_DEPENDENCIES = {
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
}


class WebVuePmoAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_pmo'}
            for key in sorted(PMO_PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in PMO_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in (
            ('webvue_pmo.role_pmo_manager', PMO_PERMISSIONS),
            ('webvue_core.role_employee', EMPLOYEE_PMO_PERMISSIONS),
            ('webvue_core.role_vendor_support', PMO_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if (
            user.has_group('webvue_pmo.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_PMO_PERMISSIONS
        return keys

    @api.model
    def _webvue_legacy_admin_roles(self):
        return [*super()._webvue_legacy_admin_roles(), 'pmo_manager']

    @api.model
    def _webvue_record_company(self, record):
        if 'company_id' not in record._fields and 'project_id' in record._fields:
            return record.project_id.company_id
        return super()._webvue_record_company(record)

    @api.model
    def _webvue_contextual_capability(self, user, key, record):
        if key in PROJECT_CONTEXTUAL_PERMISSIONS:
            project = record if record._name == 'project.project' else record.project_id
            if project and project.user_id == user:
                return True
        return super()._webvue_contextual_capability(user, key, record)

    @api.model
    def _webvue_identity_extra(self, user, capabilities):
        roles, extra = super()._webvue_identity_extra(user, capabilities)
        company = self.env.company
        if (
            'pmo.projects.read' in capabilities
            and self.env['project.project'].with_user(user).search_count([
                ('user_id', '=', user.id), ('company_id', '=', company.id),
            ])
        ):
            roles.append({
                'id': None, 'key': 'project_owner',
                'name': {'ar': 'مسؤول مشروع', 'en': 'Project owner'},
                'type': 'contextual', 'protected': True, 'source': 'project_owner',
            })
            extra |= PROJECT_CONTEXTUAL_PERMISSIONS
        if (
            self._webvue_is_employee_principal(user, company=company)
            and self.env['webvue.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
            extra.add('pmo.projects.create')
        return roles, extra
```

Create `odoo-addons/webvue_pmo/models/meeting_access_service.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The meetings application's capabilities, grants and legacy keys (spec R2), composed through super()."""
from odoo import api, models

MEETINGS_PERMISSIONS = frozenset({
    'meetings.read', 'meetings.create', 'meetings.manage',
})
EMPLOYEE_MEETINGS_PERMISSIONS = frozenset({'meetings.read'})
MEETINGS_PERMISSION_DEPENDENCIES = {
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
}


class WebVueMeetingsAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_pmo'}
            for key in sorted(MEETINGS_PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in MEETINGS_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in (
            ('webvue_core.role_employee', EMPLOYEE_MEETINGS_PERMISSIONS),
            ('webvue_core.role_system_admin', MEETINGS_PERMISSIONS),
            ('webvue_core.role_vendor_support', MEETINGS_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if (
            user.has_group('webvue_core.group_access_admin')
            or user.has_group('webvue_core.group_customer_admin')
        ):
            keys |= MEETINGS_PERMISSIONS
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_MEETINGS_PERMISSIONS
        return keys
```

Replace `odoo-addons/webvue_pmo/models/feature_registry.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePmoFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'pmo.enabled',
                'type': 'boolean',
                'owner': 'webvue_pmo',
                'module': 'webvue_pmo',
            },
            {
                'key': 'projects.max_projects',
                'type': 'limit',
                'owner': 'webvue_pmo',
                'module': 'webvue_pmo',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_pmo'},
        )
```

Create `odoo-addons/webvue_pmo/models/meeting_feature_registry.py` (Task 6 replaces it with the `webvue_meetings` owner):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueMeetingsFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'meetings.enabled',
                'type': 'boolean',
                'owner': 'webvue_pmo',
                'module': 'webvue_pmo',
            },
        )
```

Replace `odoo-addons/webvue_pmo/models/directory.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePmoDirectory(models.AbstractModel):
    _inherit = 'webvue.directory'

    @api.model
    def _webvue_directory_feature_keys(self):
        # Projects pick owners, assignees and stakeholders.
        return (*super()._webvue_directory_feature_keys(), 'pmo.enabled')
```

Create `odoo-addons/webvue_pmo/models/meeting_directory.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueMeetingsDirectory(models.AbstractModel):
    _inherit = 'webvue.directory'

    @api.model
    def _webvue_directory_feature_keys(self):
        # Meetings pick organizers, secretaries and attendees.
        return (*super()._webvue_directory_feature_keys(), 'meetings.enabled')
```

Replace `odoo-addons/webvue_pmo/models/mail_notification_webvue.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueMailMessage(models.Model):
    _inherit = 'mail.message'

    # webvue_notify owns webvue_notification, webvue_notification_kind,
    # webvue_notification_key and its unique index. webvue_pmo adds its task and
    # digest kinds (registered in models/notification_types.py) and their
    # source columns.
    webvue_notification_kind = fields.Selection(selection_add=[
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('mention', 'Mention'),
        ('deadline', 'Deadline'),
        ('overdue_digest', 'Overdue digest'),
    ])
    webvue_task_id = fields.Many2one('project.task', string='webvue Task', index=True, copy=False, ondelete='cascade')
    webvue_digest_count = fields.Integer('webvue Digest Count', copy=False)
    webvue_digest_date = fields.Date('webvue Digest Date', copy=False)
    webvue_digest_task_ids = fields.Char('webvue Digest Task Ids', copy=False)
```

Create `odoo-addons/webvue_pmo/models/meeting_mail_message.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueMeetingMailMessage(models.Model):
    _inherit = 'mail.message'

    # The meeting kinds (registered in models/meeting_notification_types.py)
    # and the opaque id of the meeting a bell row points at.
    webvue_notification_kind = fields.Selection(selection_add=[
        ('meeting_invite', 'Meeting invite'),
        ('meeting_resolution', 'Meeting resolution'),
        ('meeting_converted', 'Meeting converted'),
        ('meeting_changed', 'Meeting changed'),
        ('meeting_cancelled', 'Meeting cancelled'),
        ('meeting_reminder', 'Meeting reminder'),
        ('meeting_resolution_overdue', 'Meeting resolution overdue'),
    ])
    webvue_meeting_id = fields.Integer(copy=False, index=True)
```

Replace `odoo-addons/webvue_pmo/serializers/notification.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.serializers.common import iso


def dump_notification(notification, live_tasks=None):
    message = notification.mail_message_id
    if message.webvue_notification_kind == 'overdue_digest':
        if live_tasks is None:
            message_text = 'live_tasks is required for overdue digest serialization'
            raise ValueError(message_text)
        tasks = live_tasks
        local_date = message.webvue_digest_date
        count = len(tasks)
        return {
            'id': notification.id,
            'kind': 'overdue_digest',
            'digest_id': notification.id,
            'overdue_count': count,
            'local_date': local_date.isoformat() if local_date else None,
            'body': f'{count} overdue tasks',
            'created_at': iso(message.date),
            'is_read': bool(notification.is_read),
        }
    task = message.webvue_task_id
    return {
        'id': notification.id,
        'kind': message.webvue_notification_kind,
        'task_id': task.id,
        'task_name': task.display_name,
        'body': html2plaintext(message.body or '', include_references=False).strip(),
        'created_at': iso(message.date),
        'is_read': bool(notification.is_read),
    }
```

Create `odoo-addons/webvue_pmo/serializers/meeting_notification.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.serializers.common import iso


def dump_meeting_notification(notification):
    message = notification.mail_message_id
    meeting = message.env['cyan.meeting.minute'].browse(message.webvue_meeting_id).exists()
    return {
        'id': notification.id,
        'kind': message.webvue_notification_kind,
        'meeting_id': message.webvue_meeting_id,
        'meeting_name': meeting.name if meeting else '',
        'body': html2plaintext(message.body or '', include_references=False).strip(),
        'created_at': iso(message.date),
        'is_read': bool(notification.is_read),
    }
```

In `odoo-addons/webvue_pmo/models/notification_types.py` replace the module docstring:

```python
"""webvue_pmo's notification kinds in the webvue_notify registry.

Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until webvue_meetings exists (phase 2b-2). The bell's feature gate
checks the registered keys sorted, so the order of these classes does not
matter.

Documented notification sudo: the candidate lookups below read only the
current partner's own inbox rows; whether the task or meeting is still
readable is decided by an ordinary search in the caller's environment.
"""
```

with:

```python
"""webvue_pmo's notification kinds in the webvue_notify registry: tasks and the overdue digest.

Documented notification sudo: the candidate lookup below reads only the
current partner's own inbox rows; whether the task is still readable is
decided by an ordinary search in the caller's environment.
"""
```

then delete `MEETING_KINDS` and its tuple:

```python
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)
```

delete the whole function `readable_active_meeting_ids(env)` (from `def readable_active_meeting_ids(env):` through its `]).ids` and the two blank lines after it), and delete the whole class `WebVuePmoMeetingNotificationTypes` at the end of the file (from `class WebVuePmoMeetingNotificationTypes(models.AbstractModel):` to the end of the file). The file then ends with `WebVuePmoTaskNotificationTypes._webvue_notify_dump`.

Create `odoo-addons/webvue_pmo/models/meeting_notification_types.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The meetings application's notification kinds in the webvue_notify registry.

Documented notification sudo: the candidate lookup reads only the current
partner's own inbox rows; whether the meeting is still readable is decided
by an ordinary search in the caller's environment.
"""
from odoo import api, models

from ..serializers.meeting_notification import dump_meeting_notification

MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)


def readable_active_meeting_ids(env):
    """Recipient-owned candidate ids, checked under the caller's meeting ACLs.

    Elevated notification reads do not grant access to the linked meeting.
    Explicit company scope also protects superusers with several companies.
    """
    Meeting = env['cyan.meeting.minute']
    if not env['webvue.access.service']._webvue_has_capability(env.user, 'meetings.read') or not Meeting.has_access('read'):
        return []
    rows = env['mail.notification'].sudo().search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.webvue_notification', '=', True),
        ('mail_message_id.model', '=', 'cyan.meeting.minute'),
        ('notification_type', '=', 'inbox'),
    ])
    candidate_ids = rows.mapped('mail_message_id.webvue_meeting_id')
    if not candidate_ids:
        return []
    return Meeting.search([
        ('id', 'in', candidate_ids),
        ('company_id', '=', env.company.id),
        ('active', '=', True),
    ]).ids


class WebVueMeetingNotificationTypes(models.AbstractModel):
    _inherit = 'webvue.notify.registry'

    @api.model
    def _webvue_notification_types(self):
        return (
            *super()._webvue_notification_types(),
            *(
                {'kind': kind, 'owner': 'webvue_pmo', 'model': 'cyan.meeting.minute', 'feature_key': 'meetings.enabled'}
                for kind in MEETING_KINDS
            ),
        )

    @api.model
    def _webvue_notify_visible_domain(self):
        meeting_ids = readable_active_meeting_ids(self.env)
        return [
            *super()._webvue_notify_visible_domain(),
            [
                ('mail_message_id.webvue_notification_kind', 'in', list(MEETING_KINDS)),
                ('mail_message_id.model', '=', 'cyan.meeting.minute'),
                ('mail_message_id.res_id', 'in', meeting_ids),
                ('mail_message_id.webvue_meeting_id', 'in', meeting_ids),
            ],
        ]

    @api.model
    def _webvue_notify_dump(self, row, extra):
        if row.mail_message_id.webvue_notification_kind in MEETING_KINDS:
            return dump_meeting_notification(row)
        return super()._webvue_notify_dump(row, extra)
```

Replace `odoo-addons/webvue_pmo/models/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    access_service,
    directory,
    entitlement_service,
    feature_registry,
    mail_notification_webvue,
    meeting_access,
    meeting_access_service,
    meeting_directory,
    meeting_feature_registry,
    meeting_links,
    meeting_links_pmo,
    meeting_mail_message,
    meeting_minute,
    meeting_notification_types,
    meeting_resolution,
    meeting_series,
    webvue_settings,
    notification_types,
    project_charter_reference,
    project_finance,
    project_governance,
    project_milestone,
    project_project,
    project_task,
    project_task_meeting,
    project_template,
    res_company,
    task_attachments,
    task_notifications,
)

# Load the history extension after the Cyan meeting model and PMO mixins so
# its completion override remains the final layer in the model MRO.
# isort: split
from . import meeting_history, meeting_workspace

# The project link extends the workspace's content and decision field sets.
# isort: split
from . import meeting_convert, meeting_project
```

- [ ] **Step 7: Split the capability groups and permissions XML**

Replace `odoo-addons/webvue_pmo/security/pmo_capability_groups.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_cap_pmo_projects_read" model="res.groups"><field name="name">Capability: read projects</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/><field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/></record>
    <record id="group_cap_pmo_projects_create" model="res.groups"><field name="name">Capability: create projects</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>
    <record id="group_cap_pmo_projects_manage" model="res.groups"><field name="name">Capability: manage projects</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>
    <record id="group_cap_pmo_settings_manage" model="res.groups"><field name="name">Capability: manage PMO settings</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>
    <record id="group_cap_pmo_tasks_read" model="res.groups"><field name="name">Capability: read tasks</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/><field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/></record>
    <record id="group_cap_pmo_tasks_create" model="res.groups"><field name="name">Capability: create tasks</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>
    <record id="group_cap_pmo_tasks_write" model="res.groups"><field name="name">Capability: write tasks</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>
    <record id="group_cap_pmo_tasks_approve" model="res.groups"><field name="name">Capability: approve tasks</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>

    <record id="group_pmo_manager" model="res.groups">
        <field name="name">PMO Manager</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/>
        <field name="implied_ids" eval="[Command.set([ref('webvue_core.group_employee'),ref('project.group_project_manager'),ref('group_cap_pmo_projects_read'),ref('group_cap_pmo_projects_create'),ref('group_cap_pmo_projects_manage'),ref('group_cap_pmo_settings_manage'),ref('group_cap_pmo_tasks_read'),ref('group_cap_pmo_tasks_create'),ref('group_cap_pmo_tasks_write'),ref('group_cap_pmo_tasks_approve')])]"/>
    </record>

    <!-- webvue_core's groups reach projects through these links. -->
    <record id="webvue_core.group_employee" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/>
    </record>
    <record id="webvue_core.group_vendor_support" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('group_pmo_manager'))]"/>
    </record>
</odoo>
```

Create `odoo-addons/webvue_pmo/security/meeting_capability_groups.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_cap_meetings_read" model="res.groups"><field name="name">Capability: read meetings</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/><field name="implied_ids" eval="[Command.link(ref('cyan_meeting_minutes.group_meeting_user'))]"/></record>
    <record id="group_cap_meetings_create" model="res.groups"><field name="name">Capability: create meetings</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/></record>
    <record id="group_cap_meetings_manage" model="res.groups"><field name="name">Capability: manage meetings</field><field name="privilege_id" ref="webvue_core.res_groups_privilege_webvue"/><field name="implied_ids" eval="[Command.link(ref('cyan_meeting_minutes.group_meeting_manager'))]"/></record>

    <!-- webvue_core's groups reach meetings through these links. -->
    <record id="webvue_core.group_access_admin" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('group_cap_meetings_manage'))]"/>
    </record>
    <record id="webvue_core.group_vendor_support" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('group_cap_meetings_manage'))]"/>
    </record>
</odoo>
```

Move the three meeting permission records out of `odoo-addons/webvue_pmo/data/pmo_access_permissions.xml` with this script (it cuts from `<record id="permission_meetings_read"` to the closing `</record>` of `permission_meetings_manage`, and writes the new file with the same two hook calls the PMO file ends with):

```bash
python3 - <<'PY'
from pathlib import Path

source = Path('odoo-addons/webvue_pmo/data/pmo_access_permissions.xml')
text = source.read_text(encoding='utf-8')
start = text.index('    <record id="permission_meetings_read"')
end_marker = '<field name="group_xmlid">webvue_pmo.group_cap_meetings_manage</field>'
end = text.index('</record>\n', text.index(end_marker)) + len('</record>\n')
block = text[start:end]
assert block.count('<record ') == 3, block.count('<record ')
source.write_text(text[:start] + text[end:], encoding='utf-8')
Path('odoo-addons/webvue_pmo/data/meeting_access_permissions.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<odoo>\n' + block
    + '    <!-- Built-in roles are noupdate records: these hooks link this addon\'s grants and\n'
    + '         dependencies on install and on every upgrade. -->\n'
    + '    <function model="webvue.access.service" name="_webvue_configure_permission_dependencies"/>\n'
    + '    <function model="webvue.access.service" name="_webvue_repair_builtin_role_grants"/>\n'
    + '</odoo>\n',
    encoding='utf-8',
)
print('moved', block.count('<record '), 'permission records')
PY
rg -c "permission_meetings" odoo-addons/webvue_pmo/data/pmo_access_permissions.xml || echo "pmo file holds no meeting permission"
python3 -c "import xml.dom.minidom as m; [m.parse(p) for p in ('odoo-addons/webvue_pmo/data/pmo_access_permissions.xml', 'odoo-addons/webvue_pmo/data/meeting_access_permissions.xml', 'odoo-addons/webvue_pmo/security/pmo_capability_groups.xml', 'odoo-addons/webvue_pmo/security/meeting_capability_groups.xml')]; print('xml ok')"
```

Expected: `moved 3 permission records`, `pmo file holds no meeting permission`, `xml ok`.

In `odoo-addons/webvue_pmo/__manifest__.py` replace:

```python
        'security/pmo_capability_groups.xml',
        'data/pmo_access_permissions.xml',
```

with:

```python
        'security/pmo_capability_groups.xml',
        'security/meeting_capability_groups.xml',
        'data/pmo_access_permissions.xml',
        'data/meeting_access_permissions.xml',
```

- [ ] **Step 8: Split the mixed test files**

Create `odoo-addons/webvue_pmo/tests/meetings_common.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueMeetingsCase(WebVueApiCase):
    """The shared webvue_api fixture plus a second internal user; no project records."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='api_mgr', password='api_mgr_pass_123',
                                    name='Mona', groups='webvue_core.group_employee')
```

Create the method mover:

```bash
cat > /tmp/webvue-meetings/split_tests.py <<'SPLIT'
"""Move named test methods from one test class to another (plan 2b-2, Task 5).

usage: split_tests.py SOURCE DESTINATION METHOD [METHOD ...]
SOURCE holds exactly one class; DESTINATION already holds its header and
class. Methods move verbatim, in the order given.
"""
import ast
import sys
from pathlib import Path


def main(source, destination, names):
    src = Path(source)
    lines = src.read_text(encoding='utf-8').splitlines(keepends=True)
    tree = ast.parse(''.join(lines))
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
    assert len(classes) == 1, f'{source}: expected one class, found {len(classes)}'
    methods = {node.name: node for node in classes[0].body if isinstance(node, ast.FunctionDef)}
    missing = [name for name in names if name not in methods]
    assert not missing, f'{source}: missing {missing}'
    blocks, spans = {}, []
    for name in names:
        node = methods[name]
        start = min([node.lineno, *(dec.lineno for dec in node.decorator_list)]) - 1
        stop = node.end_lineno
        blocks[name] = ''.join(lines[start:stop])
        while stop < len(lines) and not lines[stop].strip():
            stop += 1
        spans.append((start, stop))
    for start, stop in sorted(spans, reverse=True):
        del lines[start:stop]
    src.write_text(''.join(lines).rstrip('\n') + '\n', encoding='utf-8')
    dst = Path(destination)
    out = dst.read_text(encoding='utf-8').rstrip('\n') + '\n'
    for name in names:
        out += '\n' + blocks[name].rstrip('\n') + '\n'
    dst.write_text(out, encoding='utf-8')
    print(f'{source} -> {destination}: {len(names)} method(s)')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
SPLIT
python3 -m py_compile /tmp/webvue-meetings/split_tests.py && echo "mover ok"
```

Create the destination headers.

`odoo-addons/webvue_pmo/tests/test_meeting_series_pmo.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingSeriesProjects(WebVuePmoCase):
    """Meeting series with projects and converted tasks (the meetings/PMO bridge)."""

    def setUp(self):
        super().setUp()
        self.employee.group_ids |= self.env.ref('webvue_pmo.group_cap_meetings_read') | self.env.ref('webvue_pmo.group_cap_meetings_create')
        self.manager.group_ids |= self.env.ref('webvue_pmo.group_cap_meetings_read') | self.env.ref('webvue_pmo.group_cap_meetings_manage')
```

`odoo-addons/webvue_pmo/tests/test_meeting_workspace_pmo.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingWorkspaceProjects(WebVuePmoCase):
    """Minutes topics with projects and snapshots of converted tasks (the meetings/PMO bridge)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_read')
            | cls.env.ref('webvue_pmo.group_cap_meetings_create')
            | cls.env.ref('webvue_pmo.group_cap_pmo_projects_read')
            | cls.env.ref('webvue_pmo.group_cap_pmo_tasks_read')
        )
        permissions = cls.env['webvue.access.permission'].search([
            ('key', 'in', ['meetings.read', 'meetings.create', 'pmo.projects.read', 'pmo.tasks.read']),
        ])
        role = cls.env['webvue.access.role'].create({
            'key': 'meeting_workspace_editor',
            'name_ar': 'محرر مساحة الاجتماعات',
            'name_en': 'Meeting workspace editor',
            'type': 'custom',
            'permission_ids': [(6, 0, permissions.ids)],
        })
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.employee.id,
            'role_id': role.id,
            'company_id': cls.env.company.id,
        })
        cls.outsider = new_test_user(
            cls.env, login='meeting_workspace_outsider', password='meeting_workspace_outsider_pass',
            name='Workspace outsider', groups='webvue_core.group_employee',
            company_id=cls.env.company.id, company_ids=[cls.env.company.id],
        )
        cls.outsider.group_ids |= cls.env.ref('webvue_pmo.group_cap_meetings_read')
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.outsider.id,
            'role_id': role.id,
            'company_id': cls.env.company.id,
        })

    def _authenticate_employee(self):
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _meeting(self, **values):
        vals = {
            'name': 'Workspace review',
            'state': 'draft',
            'organizer_id': self.employee.id,
            'meeting_date': '2026-09-09',
        }
        vals.update(values)
        return self.env['cyan.meeting.minute'].create(vals)
```

`odoo-addons/webvue_pmo/tests/test_meeting_history_pmo.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase
from odoo.addons.webvue_pmo.serializers.meeting import dump_meeting


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingHistoryProjects(WebVuePmoCase):
    """Frozen meeting snapshots of converted tasks (the meetings/PMO bridge)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_read')
            | cls.env.ref('webvue_pmo.group_cap_pmo_tasks_read')
        )
        cls.manager.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_manage')
            | cls.env.ref('webvue_pmo.group_cap_pmo_tasks_read')
        )
        permissions = cls.env['webvue.access.permission']
        assignments = cls.env['webvue.access.assignment']
        manager_role = cls.env['webvue.access.role'].create({
            'name_ar': 'مدير اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test manager',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', [
                    'meetings.read', 'meetings.manage',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
                ]),
            ]).ids)],
        })
        editor_role = cls.env['webvue.access.role'].create({
            'name_ar': 'محرر اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test editor',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', [
                    'meetings.read', 'meetings.create',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
                ]),
            ]).ids)],
        })
        assignments.create({
            'user_id': cls.manager.id, 'role_id': manager_role.id,
            'company_id': cls.env.company.id,
        })
        assignments.create({
            'user_id': cls.employee.id, 'role_id': editor_role.id,
            'company_id': cls.env.company.id,
        })
        cls.history_reader = new_test_user(
            cls.env, login='meeting_history_reader', password='meeting_history_reader_pass',
            name='History reader', groups='webvue_core.group_employee',
            company_id=cls.env.company.id, company_ids=[cls.env.company.id],
        )
        reader_role = cls.env['webvue.access.role'].create({
            'name_ar': 'قارئ اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test reader',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', ['meetings.read']),
            ]).ids)],
        })
        assignments.create({
            'user_id': cls.history_reader.id, 'role_id': reader_role.id,
            'company_id': cls.env.company.id,
        })
        cls.history_project = cls.env['project.project'].create({
            'name': 'Meeting history project',
            'company_id': cls.env.company.id,
        })

    def _meeting(self, **values):
        defaults = {
            'name': 'Weekly delivery review',
            'state': 'draft',
            'organizer_id': self.employee.id,
            'secretary_id': self.manager.id,
            'attendee_ids': [(6, 0, [self.employee.id, self.manager.id])],
            'meeting_date': '2026-09-08',
            'start_datetime': '2026-09-08 07:00:00',
            'end_datetime': '2026-09-08 08:00:00',
            'location': 'Room A',
            'agenda': '<p>Release agenda</p>',
            'minutes': '<p>Release minutes</p>',
        }
        defaults.update(values)
        return self.env['cyan.meeting.minute'].create(defaults)

    def _complete(self, meeting):
        meeting.with_user(self.manager).action_confirm()
        meeting.with_user(self.manager).action_done()
```

`odoo-addons/webvue_pmo/tests/test_meetings_pmo.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingsApiProjects(WebVuePmoCase):
    """Meeting list filters by project and the bell mixing meetings and tasks (the meetings/PMO bridge)."""
```

`odoo-addons/webvue_pmo/tests/test_meeting_feature_gates.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVuePmoCase
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingFeatureGates(WebVuePmoCase):
    """The bell and the people picker stay open while projects or meetings are readable."""
```

`odoo-addons/webvue_pmo/tests/test_meeting_lifecycle.py` (meetings side; the helpers are copied from `test_resolution_convert.py`, the roles hold meeting keys only):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_pmo.serializers.meeting import dump_meeting


@tagged('webvue')
class TestMeetingLifecycle(TransactionCase):
    """Calendar membership and recommendation actions of a meeting, without projects."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        meeting_user = 'webvue_core.group_employee,cyan_meeting_minutes.group_meeting_user'
        cls.organizer = new_test_user(
            cls.env, login='life_org', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.secretary = new_test_user(
            cls.env, login='life_sec', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.attendee = new_test_user(
            cls.env, login='life_att', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.manager_cap = new_test_user(
            cls.env, login='life_mgr', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        Assignment = cls.env['webvue.access.assignment']
        Permission = cls.env['webvue.access.permission']
        manage_role = cls.env['webvue.access.role'].create({
            'name_ar': 'إدارة الاجتماعات',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, Permission.search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        Assignment.create({'user_id': cls.manager_cap.id, 'role_id': manage_role.id, 'company_id': cls.company.id})
        create_role = cls.env['webvue.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات', 'company_id': cls.company.id,
            'permission_ids': [(6, 0, Permission.search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        Assignment.create({'user_id': cls.organizer.id, 'role_id': create_role.id, 'company_id': cls.company.id})
        cls.Meeting = cls.env['cyan.meeting.minute']
        cls.Resolution = cls.env['cyan.meeting.resolution']

    def _create_meeting(self, **extra):
        vals = {
            'name': 'Ops Review',
            'organizer_id': self.organizer.id,
            'secretary_id': self.secretary.id,
            'attendee_ids': [(6, 0, [self.attendee.id])],
            'meeting_date': fields.Date.today(),
            'start_datetime': fields.Datetime.now(),
            'end_datetime': fields.Datetime.now(),
            'agenda': '<p>Secret agenda</p>',
            'minutes': '<p>Secret minutes</p>',
        }
        vals.update(extra)
        return self.Meeting.with_user(self.organizer).create(vals)

    def _create_resolution(self, meeting, **extra):
        vals = {
            'meeting_id': meeting.id,
            'name': 'Follow up vendor',
            'responsible_id': self.attendee.id,
            'deadline': fields.Date.today(),
            'description': '<p>Do not copy me</p>',
        }
        vals.update(extra)
        return self.Resolution.with_user(self.organizer).create(vals)

    def _resolution_row(self, resolution, user):
        detail = dump_meeting(resolution.meeting_id.with_user(user), detail=True)
        return next(row for row in detail['resolutions'] if row['id'] == resolution.id)
```

Move the methods:

```bash
S=/tmp/webvue-meetings/split_tests.py
T=odoo-addons/webvue_pmo/tests
python3 $S $T/test_meeting_series.py $T/test_meeting_series_pmo.py \
  test_series_search_by_location_and_project test_converted_resolution_execution_is_frozen \
  test_converted_resolution_has_no_overdue_reminder_or_execution_actions
python3 $S $T/test_meeting_workspace.py $T/test_meeting_workspace_pmo.py \
  test_invalid_form_does_not_commit_ordinary_patch_and_foreign_access_is_denied \
  test_version_and_latest_snapshot_keep_captured_task_state
python3 $S $T/test_meeting_history.py $T/test_meeting_history_pmo.py \
  test_completion_freezes_snapshot_while_live_resolution_changes \
  test_later_task_cannot_change_an_earlier_snapshot \
  test_snapshot_has_no_task_ids_or_action_permissions \
  test_snapshot_does_not_copy_status_from_task_outside_current_read_scope \
  test_private_backing_is_hidden_and_projection_rechecks_current_reader_for_api_and_pdf \
  test_archived_task_does_not_project_into_history \
  test_converted_task_projection_uses_integer_resolution_id
python3 $S $T/test_meetings.py $T/test_meetings_pmo.py \
  test_meeting_project_and_date_filters_are_combined_with_correct_total \
  test_meeting_notifications_visibility_read_states_and_recipient_ownership
python3 $S $T/test_feature_enforcement.py $T/test_meeting_feature_gates.py \
  test_bell_and_people_stay_open_while_any_owner_feature_is_on
python3 $S $T/test_resolution_convert.py $T/test_meeting_lifecycle.py \
  test_allowed_actions_follow_actual_resolution_permissions \
  test_done_resolution_has_no_notes_action_and_manager_can_reopen_done_meeting \
  test_done_meeting_does_not_advertise_decision_edit_for_open_resolution \
  test_edit_meeting_schedule_updates_existing_calendar_event \
  test_calendar_import_does_not_create_an_extra_event \
  test_membership_stays_removed_after_rename_and_reschedule \
  test_simultaneous_membership_metadata_and_add_preserve_secretary \
  test_calendar_origin_membership_keeps_secretary_and_no_stale_attendee \
  test_forged_sync_context_does_not_skip_calendar_membership_sync \
  test_linked_membership_sync_survives_missing_schedule \
  test_clear_schedule_and_remove_membership_in_one_write
```

Expected: six `-> ...: N method(s)` lines (3, 2, 7, 2, 1, 11).

Point the meetings-only files at `WebVueMeetingsCase` and drop their PMO grants:

```bash
python3 - <<'PY'
from pathlib import Path

T = Path('odoo-addons/webvue_pmo/tests')
for name in ('test_meeting_history.py', 'test_meeting_people.py', 'test_meeting_permissions.py',
             'test_meeting_series.py', 'test_meeting_series_settings.py', 'test_meeting_workspace.py',
             'test_meetings.py'):
    path = T / name
    text = path.read_text(encoding='utf-8')
    assert text.count('from .common import WebVuePmoCase') == 1 and text.count('(WebVuePmoCase)') == 1, name
    text = text.replace('from .common import WebVuePmoCase', 'from .meetings_common import WebVueMeetingsCase')
    text = text.replace('(WebVuePmoCase)', '(WebVueMeetingsCase)')
    path.write_text(text, encoding='utf-8')
    print('meetings case:', name)
PY
```

Expected: seven `meetings case:` lines.

In `odoo-addons/webvue_pmo/tests/test_meeting_workspace.py` replace:

```python
        cls.employee.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_read')
            | cls.env.ref('webvue_pmo.group_cap_meetings_create')
            | cls.env.ref('webvue_pmo.group_cap_pmo_projects_read')
            | cls.env.ref('webvue_pmo.group_cap_pmo_tasks_read')
        )
        permissions = cls.env['webvue.access.permission'].search([
            ('key', 'in', ['meetings.read', 'meetings.create', 'pmo.projects.read', 'pmo.tasks.read']),
        ])
```

with:

```python
        cls.employee.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_read')
            | cls.env.ref('webvue_pmo.group_cap_meetings_create')
        )
        permissions = cls.env['webvue.access.permission'].search([
            ('key', 'in', ['meetings.read', 'meetings.create']),
        ])
```

In `odoo-addons/webvue_pmo/tests/test_meeting_history.py` replace:

```python
        cls.employee.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_read')
            | cls.env.ref('webvue_pmo.group_cap_pmo_tasks_read')
        )
        cls.manager.group_ids |= (
            cls.env.ref('webvue_pmo.group_cap_meetings_manage')
            | cls.env.ref('webvue_pmo.group_cap_pmo_tasks_read')
        )
```

with:

```python
        cls.employee.group_ids |= cls.env.ref('webvue_pmo.group_cap_meetings_read')
        cls.manager.group_ids |= cls.env.ref('webvue_pmo.group_cap_meetings_manage')
```

replace (both role lists, two occurrences each — use replace-all for each string):

```python
                    'meetings.read', 'meetings.manage',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
```

with:

```python
                    'meetings.read', 'meetings.manage',
```

and:

```python
                    'meetings.read', 'meetings.create',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
```

with:

```python
                    'meetings.read', 'meetings.create',
```

and delete:

```python
        cls.history_project = cls.env['project.project'].create({
            'name': 'Meeting history project',
            'company_id': cls.env.company.id,
        })
```

In `odoo-addons/webvue_pmo/tests/test_pmo_access_composition.py` replace:

```python
from odoo.addons.webvue_pmo.models.access_service import (
    EMPLOYEE_PMO_PERMISSIONS,
    MEETINGS_PERMISSIONS,
    PMO_PERMISSIONS,
)
```

with:

```python
from odoo.addons.webvue_pmo.models.access_service import EMPLOYEE_PMO_PERMISSIONS, PMO_PERMISSIONS
from odoo.addons.webvue_pmo.models.meeting_access_service import MEETINGS_PERMISSIONS
```

In `odoo-addons/webvue_pmo/tests/test_notifications.py` the PMO and meeting kinds are now registered by two classes whose MRO order follows file names; replace:

```python
        self.assertEqual(pmo, [
            'assignment', 'comment', 'mention', 'deadline', 'overdue_digest',
            'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
            'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
        ])
        self.assertEqual({types[kind]['feature_key'] for kind in pmo[:5]}, {'pmo.enabled'})
        self.assertEqual({types[kind]['feature_key'] for kind in pmo[5:]}, {'meetings.enabled'})
        self.assertEqual({types[kind]['model'] for kind in pmo[:4]}, {'project.task'})
        self.assertEqual(types['overdue_digest']['model'], 'res.company')
        self.assertEqual({types[kind]['model'] for kind in pmo[5:]}, {'cyan.meeting.minute'})
```

with:

```python
        task_kinds = ['assignment', 'comment', 'mention', 'deadline', 'overdue_digest']
        meeting_kinds = [
            'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
            'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
        ]
        self.assertEqual(sorted(pmo), sorted(task_kinds + meeting_kinds))
        self.assertEqual({types[kind]['feature_key'] for kind in task_kinds}, {'pmo.enabled'})
        self.assertEqual({types[kind]['feature_key'] for kind in meeting_kinds}, {'meetings.enabled'})
        self.assertEqual({types[kind]['model'] for kind in task_kinds[:4]}, {'project.task'})
        self.assertEqual(types['overdue_digest']['model'], 'res.company')
        self.assertEqual({types[kind]['model'] for kind in meeting_kinds}, {'cyan.meeting.minute'})
```

Replace `odoo-addons/webvue_pmo/tests/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    common,
    test_access_capabilities,
    test_bus,
    test_completion_approval,
    test_deadline_digest,
    test_feature_enforcement,
    test_meeting_access,
    test_meeting_feature_gates,
    test_meeting_history,
    test_meeting_history_pmo,
    test_meeting_lifecycle,
    test_meeting_people,
    test_meeting_permissions,
    test_meeting_series,
    test_meeting_series_pmo,
    test_meeting_series_settings,
    test_meeting_workspace,
    test_meeting_workspace_pmo,
    test_meetings,
    test_meetings_pmo,
    test_milestones,
    test_webvue_scope,
    test_notifications,
    test_notify_ownership_migration,
    test_personal_stages,
    test_pmo_access_composition,
    test_project_admin_model,
    test_project_charter,
    test_project_charter_catalogs,
    test_project_finance,
    test_project_followers,
    test_project_governance,
    test_project_quota,
    test_project_reports,
    test_project_schedule,
    test_project_settings_controls,
    test_project_stages,
    test_project_status,
    test_project_templates,
    test_project_updates,
    test_projects,
    test_resolution_convert,
    test_settings,
    test_tags,
    test_task_attachments,
    test_task_lifecycle,
    test_tasks,
    test_timeline,
    test_transition,
)
```

- [ ] **Step 9: Prove the split is clean, then run the static checks**

```bash
ruff check --fix --select F401,I odoo-addons/webvue_pmo
ruff check odoo-addons
T=odoo-addons/webvue_pmo
# Meetings-only files reach no project, task or PMO record.
rg -n "project\.(project|task)|pmo\.(projects|tasks)|webvue_pmo\.group_cap_pmo|WebVuePmoCase|history_project|self\.project\b|cls\.project\b" \
  $T/models/meeting_access.py $T/models/meeting_access_service.py $T/models/meeting_directory.py \
  $T/models/meeting_feature_registry.py $T/models/meeting_history.py $T/models/meeting_links.py \
  $T/models/meeting_mail_message.py $T/models/meeting_minute.py $T/models/meeting_notification_types.py \
  $T/models/meeting_resolution.py $T/models/meeting_series.py $T/models/meeting_workspace.py \
  $T/serializers/meeting.py $T/serializers/meeting_notification.py \
  $T/controllers/meetings.py $T/controllers/meeting_series.py $T/controllers/meeting_workspace.py $T/controllers/meeting_attachments.py \
  $T/tests/meetings_common.py $T/tests/test_meeting_access.py $T/tests/test_meeting_history.py \
  $T/tests/test_meeting_lifecycle.py $T/tests/test_meeting_people.py $T/tests/test_meeting_permissions.py \
  $T/tests/test_meeting_series.py $T/tests/test_meeting_series_settings.py $T/tests/test_meeting_workspace.py \
  $T/tests/test_meetings.py || echo "meetings-only files are clean"
# The PMO files reach no meeting record.
rg -n "cyan|meeting" $T/models/access_service.py $T/models/feature_registry.py $T/models/directory.py \
  $T/models/notification_types.py $T/models/mail_notification_webvue.py $T/models/project_task.py \
  $T/serializers/notification.py $T/security/pmo_capability_groups.xml $T/data/pmo_access_permissions.xml \
  || echo "pmo files are clean"
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
PY
```

Expected: `All checks passed!`; `meetings-only files are clean`; `pmo files are clean` except the one comment line in `models/project_task.py` that names "the meetings bridge" in `_webvue_extra_create_fields`'s docstring; `exit=0`; totals `R1 0, R10 0, R2 4, R3 4, R4 0, R5 8, R6 0, R7 83, R8 1, R9 68`. If ruff's `--fix` reorders imports in a file you did not touch, revert that file.

- [ ] **Step 10: Run the meeting, notification and access tests, then the full suite (background)**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t5 \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_pmo:TestMeetingsApi,/webvue_pmo:TestMeetingsApiProjects,/webvue_pmo:TestMeetingSeries,/webvue_pmo:TestMeetingSeriesProjects,/webvue_pmo:TestMeetingWorkspace,/webvue_pmo:TestMeetingWorkspaceProjects,/webvue_pmo:TestMeetingHistory,/webvue_pmo:TestMeetingHistoryProjects,/webvue_pmo:TestResolutionConvert,/webvue_pmo:TestMeetingLifecycle,/webvue_pmo:TestMeetingFeatureGates,/webvue_pmo:TestTaskNotifications,/webvue_pmo:TestPmoAccessComposition,/webvue_api:TestAccessComposition,/webvue_api:TestFeatureRouteCoverage
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t5_full \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat
```

Expected: two `ODOO_RUN_TEST_OK` lines; the full count equals Task 0's N plus the tests added in Tasks 1-2 (the split moved tests, it did not add any). Every moved test runs unchanged: that is the proof the hooks preserve behaviour.

- [ ] **Step 11: Commit**

```bash
git add odoo-addons/webvue_pmo tools/arch_baseline.json
git commit -m "refactor(pmo): split meetings from their project and task links" -m "<TRAILER>"
```

---
### Task 6: Move the files into webvue_meetings and webvue_meetings_pmo; webvue_pmo drops cyan_meeting_minutes

Mostly mechanical: the Task 5 files move unchanged, owners and xml id prefixes change, the two manifests are created, `webvue_pmo` stops depending on `cyan_meeting_minutes`, and every pin, catalog tier and module tuple that the move breaks is updated in the same commit so the commit stays green. Upgrades of existing databases are Task 7; do not upgrade any database at this commit.

**Files:**
- Create: `odoo-addons/webvue_meetings/{__init__.py,__manifest__.py}`, `models/__init__.py`, `controllers/__init__.py`, `serializers/__init__.py`, `tests/__init__.py`, `tests/test_meeting_notifications.py`, `tests/test_meetings_access_composition.py`, `tests/test_meetings_without_projects.py`
- Create: `odoo-addons/webvue_meetings_pmo/{__init__.py,__manifest__.py}`, `models/__init__.py`, `controllers/__init__.py`, `tests/__init__.py`
- Move (git mv): every file listed in Step 1
- Modify: `odoo-addons/webvue_meetings/models/feature_registry.py` (owner), `odoo-addons/webvue_pmo/{__manifest__.py,models/__init__.py,controllers/__init__.py,tests/__init__.py}`, `odoo-addons/webvue_pmo/tests/{test_notifications.py,test_pmo_access_composition.py,test_notify_ownership_migration.py}`
- Modify: `odoo-addons/webvue_core/tests/test_app_xmlid_migration.py`, `odoo-addons/webvue_api/tests/{test_access_composition.py,test_access_admin.py}`, `odoo-addons/webvue_platform/tests/test_entitlements.py`
- Modify: `tools/arch_layers.json`, `tools/arch_baseline.json` (regenerated)
- Modify: `deploy/catalog/solutions/platform.json:20`, `deploy/catalog/solutions/platform_v2.json:29-31`, `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts:22,30`, `apps/control-plane/src/__tests__/shared-onboarding-live.test.ts:37`, `tools/test_webvue_cli_operator.py:702-703`, `tools/webvue_cli/operator.py:44-45`, `tools/shared_saas_lifecycle/odoo_effect.py:25-28`, `deploy/check_isolated.py:23-26`, `deploy/test_operations.py:151-155`
- Create (outside the repo): `/tmp/webvue-meetings/move.py`

**Interfaces:**
- Consumes: every Task 5 file name.
- Produces: addons `webvue_meetings` (19.0.1.0.0, rank 4) and `webvue_meetings_pmo` (19.0.1.0.0, rank 5, `auto_install`); module id `webvue_meetings` registered in `webvue.feature.registry`; `meetings.enabled`, the three `meetings.*` capabilities and the seven meeting notification kinds owned by `webvue_meetings`; `odoo.addons.webvue_meetings.models.meeting_access_service.MEETINGS_PERMISSIONS`; `odoo.addons.webvue_meetings.tests.common.WebVueMeetingsCase`. Task 7 consumes the ownership of every xml id.

- [ ] **Step 1: Move the files**

```bash
cat > /tmp/webvue-meetings/move.py <<'MOVE'
"""git mv the Task 5 meeting files to webvue_meetings and webvue_meetings_pmo (plan 2b-2, Task 6)."""
import subprocess
from pathlib import Path

PMO = Path('odoo-addons/webvue_pmo')
MEETINGS = Path('odoo-addons/webvue_meetings')
BRIDGE = Path('odoo-addons/webvue_meetings_pmo')
MOVES = {
    MEETINGS: [
        'models/meeting_access.py', 'models/meeting_access_service.py', 'models/meeting_directory.py',
        ('models/meeting_feature_registry.py', 'models/feature_registry.py'),
        'models/meeting_history.py', 'models/meeting_links.py', 'models/meeting_mail_message.py',
        'models/meeting_minute.py', 'models/meeting_notification_types.py', 'models/meeting_resolution.py',
        'models/meeting_series.py', 'models/meeting_workspace.py',
        'controllers/meeting_attachments.py', 'controllers/meeting_series.py',
        'controllers/meeting_workspace.py', 'controllers/meetings.py',
        'serializers/meeting.py', 'serializers/meeting_notification.py',
        'security/meeting_capability_groups.xml', 'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml', 'security/meeting_access.xml',
        'data/meeting_access_permissions.xml', 'data/meeting_reminder_cron.xml',
        'report/meeting_report_history_templates.xml',
        ('tests/meetings_common.py', 'tests/common.py'),
        'tests/test_meeting_access.py', 'tests/test_meeting_history.py', 'tests/test_meeting_lifecycle.py',
        'tests/test_meeting_people.py', 'tests/test_meeting_permissions.py', 'tests/test_meeting_series.py',
        'tests/test_meeting_series_settings.py', 'tests/test_meeting_workspace.py', 'tests/test_meetings.py',
    ],
    BRIDGE: [
        'models/meeting_convert.py', 'models/meeting_links_pmo.py', 'models/meeting_project.py',
        'models/project_task_meeting.py', 'controllers/meeting_convert.py',
        'tests/test_meeting_feature_gates.py', 'tests/test_meeting_history_pmo.py',
        'tests/test_meeting_series_pmo.py', 'tests/test_meeting_workspace_pmo.py',
        'tests/test_meetings_pmo.py', 'tests/test_resolution_convert.py',
    ],
}
count = 0
for target, items in MOVES.items():
    for item in items:
        source, destination = item if isinstance(item, tuple) else (item, item)
        (target / destination).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'mv', str(PMO / source), str(target / destination)], check=True)
        count += 1
print(f'moved {count} files')
MOVE
python3 /tmp/webvue-meetings/move.py
git status --short | grep -c '^R'
```

Expected: `moved 46 files` and `46`.

- [ ] **Step 2: Rewrite owners, xml id prefixes and imports in the moved files**

```bash
python3 - <<'PY'
from pathlib import Path

REPLACE = {
    Path('odoo-addons/webvue_meetings'): (
        ('webvue_pmo.group_cap_meetings_', 'webvue_meetings.group_cap_meetings_'),
        ('webvue_pmo.permission_meetings_', 'webvue_meetings.permission_meetings_'),
        ('webvue_pmo.webvue_meeting_minutes_landscape', 'webvue_meetings.webvue_meeting_minutes_landscape'),
        ('odoo.addons.webvue_pmo.', 'odoo.addons.webvue_meetings.'),
        ("'owner': 'webvue_pmo'", "'owner': 'webvue_meetings'"),
        ('from .meetings_common import WebVueMeetingsCase', 'from .common import WebVueMeetingsCase'),
    ),
    Path('odoo-addons/webvue_meetings_pmo'): (
        ('webvue_pmo.group_cap_meetings_', 'webvue_meetings.group_cap_meetings_'),
        ('webvue_pmo.permission_meetings_', 'webvue_meetings.permission_meetings_'),
        ('odoo.addons.webvue_pmo.serializers.meeting', 'odoo.addons.webvue_meetings.serializers.meeting'),
        ('from .meeting_workspace import', 'from odoo.addons.webvue_meetings.models.meeting_workspace import'),
        ('from .common import WebVuePmoCase', 'from odoo.addons.webvue_pmo.tests.common import WebVuePmoCase'),
    ),
}
for root, pairs in REPLACE.items():
    for path in sorted(p for p in root.rglob('*') if p.suffix in ('.py', '.xml', '.csv')):
        text = path.read_text(encoding='utf-8')
        new = text
        for old, value in pairs:
            new = new.replace(old, value)
        if new != text:
            path.write_text(new, encoding='utf-8')
            print('rewrote', path)
PY
```

Expected: a `rewrote` line for, among others, `webvue_meetings/data/meeting_access_permissions.xml`, `report/meeting_report_history_templates.xml`, `models/meeting_access_service.py`, `models/meeting_notification_types.py`, `models/feature_registry.py`, every moved meetings test, and every bridge test and `webvue_meetings_pmo/models/meeting_project.py`.

Replace `odoo-addons/webvue_meetings/models/feature_registry.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueMeetingsFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'meetings.enabled',
                'type': 'boolean',
                'owner': 'webvue_meetings',
                'module': 'webvue_meetings',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_meetings'},
        )
```

- [ ] **Step 3: Create the addon skeletons**

`odoo-addons/webvue_meetings/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers, models
```

`odoo-addons/webvue_meetings/__manifest__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Meetings',
    'summary': 'webvue platform: meetings, series, minutes and recommendations — /api/v1/meetings, /api/v1/meeting-series',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: api_handler, ApiError, iso(), the shared attachment validator and WebVueApiCase.
    # webvue_platform: webvue.feature.registry, where meetings.enabled and the module id are registered.
    # webvue_notify: bell delivery and the type registry; webvue_meetings registers its seven kinds.
    # webvue_directory: the population of meeting participants and the keys that open /api/v1/people.
    # cyan_meeting_minutes: the LGPL meeting engine this addon extends. calendar: recurrences.
    # mail: the meeting source column of a bell row.
    # webvue_meetings owns the three meetings.* capabilities, their groups and the meeting
    # record rules (spec R2). Links to projects and tasks are the bridge webvue_meetings_pmo's.
    'depends': [
        'webvue_api', 'webvue_platform', 'webvue_notify', 'webvue_directory',
        'cyan_meeting_minutes', 'calendar', 'mail',
    ],
    'data': [
        'security/meeting_capability_groups.xml',
        'data/meeting_access_permissions.xml',
        'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml',
        'security/meeting_access.xml',
        'data/meeting_reminder_cron.xml',
        'report/meeting_report_history_templates.xml',
    ],
    'installable': True,
    'application': False,
}
```

`odoo-addons/webvue_meetings/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    feature_registry,
    meeting_access,
    meeting_access_service,
    meeting_directory,
    meeting_links,
    meeting_mail_message,
    meeting_minute,
    meeting_notification_types,
    meeting_resolution,
    meeting_series,
)

# Load the history extension after the Cyan meeting model and the other
# mixins so its completion override remains the final layer in the model MRO.
# isort: split
from . import meeting_history, meeting_workspace
```

`odoo-addons/webvue_meetings/controllers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import meeting_attachments, meeting_series, meeting_workspace, meetings
```

`odoo-addons/webvue_meetings/serializers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import meeting, meeting_notification
```

`odoo-addons/webvue_meetings/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    common,
    test_meeting_access,
    test_meeting_history,
    test_meeting_lifecycle,
    test_meeting_notifications,
    test_meeting_people,
    test_meeting_permissions,
    test_meeting_series,
    test_meeting_series_settings,
    test_meeting_workspace,
    test_meetings,
    test_meetings_access_composition,
    test_meetings_without_projects,
)
```

`odoo-addons/webvue_meetings_pmo/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers, models
```

`odoo-addons/webvue_meetings_pmo/__manifest__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Meetings and Projects',
    'summary': 'webvue platform: links meetings to projects and converts recommendations to tasks',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, layer 4): installed by
    # Odoo as soon as webvue_meetings and webvue_pmo are both installed. It owns the
    # project_id columns of meetings, series and recommendations, the task
    # origin columns and their unique index, the convert route, and the
    # project/task implementations of webvue.meeting.links. Uninstalling it
    # drops those columns (spec 2.1: removing an addon removes its data).
    'depends': ['webvue_meetings', 'webvue_pmo'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
```

`odoo-addons/webvue_meetings_pmo/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import meeting_convert, meeting_links_pmo, meeting_project, project_task_meeting
```

`odoo-addons/webvue_meetings_pmo/controllers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import meeting_convert
```

`odoo-addons/webvue_meetings_pmo/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    test_meeting_feature_gates,
    test_meeting_history_pmo,
    test_meeting_series_pmo,
    test_meeting_workspace_pmo,
    test_meetings_pmo,
    test_resolution_convert,
)
```

- [ ] **Step 4: Cut webvue_pmo loose from the meeting engine**

Replace `odoo-addons/webvue_pmo/__manifest__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue PMO',
    'summary': 'webvue platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages)',
    'version': '19.0.1.3.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError, the iso() serializer helper, the
    # shared attachment validator and WebVueApiCase.
    # webvue_platform: the pre-backfill migration reads webvue.tenant.profile, and a
    # `-u webvue_pmo` must install it directly instead of relying on the caller to
    # upgrade webvue_api as well.
    # webvue_directory: /api/v1/people and its population; webvue_pmo registers
    # pmo.enabled, which opens it. webvue_notify: bell delivery and the type
    # registry; webvue_pmo registers its task and digest kinds and keeps its producers.
    # project: _inherit'd model and CLOSED_STATES. mail: message_post /
    # _message_post_after_hook in the timeline. bus: bus.bus in the task notifier.
    # webvue_pmo owns the pmo.* capabilities, their groups and the pmo_manager role
    # (spec R2). Meetings are webvue_meetings'; their links to projects and tasks
    # are the bridge webvue_meetings_pmo's.
    'depends': [
        'webvue_api', 'webvue_platform', 'webvue_directory', 'webvue_notify',
        'project', 'mail', 'bus',
    ],
    'data': [
        'security/pmo_capability_groups.xml',
        'data/pmo_access_permissions.xml',
        'security/project_finance_rules.xml',
        'security/ir.model.access-finance.csv',
        'security/ir.model.access.csv',
        'security/ir.model.access-governance.csv',
        'security/project_governance_rules.xml',
        'security/ir.model.access-templates.csv',
        'security/project_template_rules.xml',
        'security/webvue_pmo_rules.xml',
        'security/project_charter_rules.xml',
        'data/webvue_pmo_data.xml',
        'data/webvue_project_sequence.xml',
        'data/project_charter_reference_data.xml',
        'data/webvue_notification_cron.xml',
        'data/project_completion_status_migration.xml',
    ],
    'installable': True,
    'application': False,
}
```

Replace `odoo-addons/webvue_pmo/models/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    access_service,
    directory,
    entitlement_service,
    feature_registry,
    mail_notification_webvue,
    webvue_settings,
    notification_types,
    project_charter_reference,
    project_finance,
    project_governance,
    project_milestone,
    project_project,
    project_task,
    project_template,
    res_company,
    task_attachments,
    task_notifications,
)
```

Replace `odoo-addons/webvue_pmo/controllers/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    milestones,
    notifications,
    personal_stages,
    project_charter_catalogs,
    project_finance,
    project_followers,
    project_governance,
    project_reports,
    project_schedule,
    project_stages,
    project_templates,
    project_updates,
    projects,
    settings,
    tags,
    task_archive,
    task_attachments,
    task_dependencies,
    tasks,
    timeline,
)
```

Replace `odoo-addons/webvue_pmo/tests/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    common,
    test_access_capabilities,
    test_bus,
    test_completion_approval,
    test_deadline_digest,
    test_feature_enforcement,
    test_milestones,
    test_webvue_scope,
    test_notifications,
    test_notify_ownership_migration,
    test_personal_stages,
    test_pmo_access_composition,
    test_project_admin_model,
    test_project_charter,
    test_project_charter_catalogs,
    test_project_finance,
    test_project_followers,
    test_project_governance,
    test_project_quota,
    test_project_reports,
    test_project_schedule,
    test_project_settings_controls,
    test_project_stages,
    test_project_status,
    test_project_templates,
    test_project_updates,
    test_projects,
    test_settings,
    test_tags,
    test_task_attachments,
    test_task_lifecycle,
    test_tasks,
    test_timeline,
    test_transition,
)
```

- [ ] **Step 5: Rewrite the PMO tests that still created meetings**

In `odoo-addons/webvue_pmo/tests/test_notifications.py` replace:

```python
        task_kinds = ['assignment', 'comment', 'mention', 'deadline', 'overdue_digest']
        meeting_kinds = [
            'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
            'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
        ]
        self.assertEqual(sorted(pmo), sorted(task_kinds + meeting_kinds))
        self.assertEqual({types[kind]['feature_key'] for kind in task_kinds}, {'pmo.enabled'})
        self.assertEqual({types[kind]['feature_key'] for kind in meeting_kinds}, {'meetings.enabled'})
        self.assertEqual({types[kind]['model'] for kind in task_kinds[:4]}, {'project.task'})
        self.assertEqual(types['overdue_digest']['model'], 'res.company')
        self.assertEqual({types[kind]['model'] for kind in meeting_kinds}, {'cyan.meeting.minute'})
```

with:

```python
        self.assertEqual(pmo, ['assignment', 'comment', 'mention', 'deadline', 'overdue_digest'])
        self.assertEqual({types[kind]['feature_key'] for kind in pmo}, {'pmo.enabled'})
        self.assertEqual({types[kind]['model'] for kind in pmo[:4]}, {'project.task'})
        self.assertEqual(types['overdue_digest']['model'], 'res.company')
```

replace:

```python
        self.assertLessEqual({'pmo.enabled', 'meetings.enabled'}, set(registry._webvue_notify_feature_keys()))
```

with:

```python
        self.assertIn('pmo.enabled', registry._webvue_notify_feature_keys())
```

and delete this block from `test_delivery_keys_keep_their_pre_split_format` (it moves to `webvue_meetings/tests/test_meeting_notifications.py` below):

```python
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Key format meeting', 'organizer_id': self.manager.id,
        })
        partners = self.other.partner_id | self.employee.partner_id
        expected = sorted(f'meeting-invite:{meeting.id}:{partner.id}' for partner in partners)
        meeting._webvue_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        count = Message.search_count([('webvue_meeting_id', '=', meeting.id)])
        meeting._webvue_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        self.assertEqual(Message.search_count([('webvue_meeting_id', '=', meeting.id)]), count)
        self.assertEqual(sorted(Message.search([('webvue_notification_key', 'in', expected)]).mapped('webvue_notification_key')), expected)
        meeting._webvue_notify_partners(self.other.partner_id, 'meeting_changed', 'Moved')
        meeting._webvue_notify_partners(self.other.partner_id, 'meeting_changed', 'Moved')
        changed = Message.search([('webvue_meeting_id', '=', meeting.id), ('webvue_notification_kind', '=', 'meeting_changed')])
        self.assertEqual(len(changed), 2, 'meeting_changed has no idempotency key')
        self.assertEqual(set(changed.mapped('webvue_notification_key')), {False})
```

In `odoo-addons/webvue_pmo/tests/test_notify_ownership_migration.py` replace:

```python
        for column in ('webvue_task_id', 'webvue_meeting_id', 'webvue_digest_count', 'webvue_digest_date', 'webvue_digest_task_ids'):
```

with:

```python
        for column in ('webvue_task_id', 'webvue_digest_count', 'webvue_digest_date', 'webvue_digest_task_ids'):
```

Replace `odoo-addons/webvue_pmo/tests/test_pmo_access_composition.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_pmo.models.access_service import EMPLOYEE_PMO_PERMISSIONS, PMO_PERMISSIONS


@tagged('webvue', 'webvue_access')
class TestPmoAccessComposition(TransactionCase):
    """webvue_pmo owns the eight PMO capabilities (spec 3.2, ruling R-B); it runs
    at install, so it also proves the hooks work without webvue_hr or webvue_meetings."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.Permission = cls.env['webvue.access.permission']
        cls.company = cls.env.company
        cls.owner = new_test_user(cls.env, login='pmo_comp_owner', groups='webvue_core.group_employee')
        cls.other = new_test_user(cls.env, login='pmo_comp_other', groups='webvue_core.group_employee')
        cls.owned = cls.env['project.project'].create({
            'name': 'Composition owned', 'user_id': cls.owner.id, 'company_id': cls.company.id,
        })
        cls.foreign = cls.env['project.project'].create({
            'name': 'Composition foreign', 'user_id': cls.other.id, 'company_id': cls.company.id,
        })
        cls.owned_task = cls.env['project.task'].create({'name': 'Owned', 'project_id': cls.owned.id})
        cls.foreign_task = cls.env['project.task'].create({'name': 'Foreign', 'project_id': cls.foreign.id})

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_pmo_owns_eight_capabilities_and_their_groups(self):
        catalog = self.service._webvue_capability_map()
        self.assertEqual(len(PMO_PERMISSIONS), 8)
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'webvue_pmo'}, set(PMO_PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(PMO_PERMISSIONS))])
        self.assertEqual(len(permissions), 8)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('webvue_pmo.permission_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('webvue_pmo.group_cap_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_pmo_manager_role_is_unique_and_core_roles_get_pmo_grants(self):
        role = self.env.ref('webvue_pmo.role_pmo_manager')
        self.assertEqual((role.key, role.type, role.protected), ('pmo_manager', 'built_in', True))
        self.assertEqual(self.env['webvue.access.role'].search_count([('key', '=', 'pmo_manager')]), 1)
        self.assertFalse(self.env.ref('webvue_core.role_pmo_manager', raise_if_not_found=False))
        self.assertFalse(self.env.ref('webvue_core.group_pmo_manager', raise_if_not_found=False))
        self.assertEqual(self._keys('webvue_pmo.role_pmo_manager'), set(PMO_PERMISSIONS))
        self.assertTrue(self._keys('webvue_core.role_employee') >= EMPLOYEE_PMO_PERMISSIONS)
        self.assertTrue(self._keys('webvue_core.role_vendor_support') >= PMO_PERMISSIONS)

    def test_pmo_links_reach_core_groups(self):
        self.assertIn(
            self.env.ref('project.group_project_user'),
            self.env.ref('webvue_core.group_employee').all_implied_ids,
        )
        vendor = self.env.ref('webvue_core.group_vendor_support')
        self.assertIn(self.env.ref('webvue_pmo.group_pmo_manager'), vendor.all_implied_ids)

    def test_project_owner_grant_needs_the_pmo_hook(self):
        held = self.service._webvue_capability_keys(self.owner)
        self.assertNotIn('pmo.projects.manage', held)
        self.assertNotIn('pmo.tasks.approve', held)
        for key in ('pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'):
            self.assertTrue(self.service._webvue_has_capability(self.owner, key, record=self.owned_task), key)
            self.assertTrue(self.service._webvue_has_capability(self.owner, key, record=self.owned), key)
        for key in ('pmo.projects.manage', 'pmo.tasks.approve'):
            self.assertFalse(self.service._webvue_has_capability(self.owner, key, record=self.foreign_task), key)
        self.assertFalse(self.service._webvue_has_capability(self.owner, 'pmo.settings.manage', record=self.owned))
        identity = self.service._webvue_identity(self.owner)
        self.assertIn('project_owner', {role['key'] for role in identity['roles']})
        self.assertTrue({'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'} <= set(identity['capabilities']))

    def test_record_without_company_uses_its_project_company(self):
        company_b = self.env['res.company'].create({'name': 'Composition company B'})
        project_b = self.env['project.project'].create({
            'name': 'Composition B', 'company_id': company_b.id, 'user_id': self.owner.id,
        })
        milestone = self.env['project.milestone'].create({'name': 'B milestone', 'project_id': project_b.id})
        self.assertNotIn('company_id', milestone._fields)
        self.assertEqual(self.service._webvue_record_company(milestone), company_b)
        self.assertFalse(self.service._webvue_has_capability(self.owner, 'pmo.projects.manage', record=milestone))

    def test_legacy_pmo_groups_still_grant_pmo_capabilities(self):
        webvue_group = new_test_user(self.env, login='pmo_comp_webvue_group', groups='webvue_pmo.group_pmo_manager')
        odoo_group = new_test_user(
            self.env, login='pmo_comp_odoo_group', groups='base.group_user,project.group_project_manager',
        )
        self.assertTrue(self.service._webvue_capability_keys(webvue_group) >= PMO_PERMISSIONS)
        self.assertTrue(self.service._webvue_capability_keys(odoo_group) >= PMO_PERMISSIONS)
        self.assertTrue(self.service._webvue_capability_keys(self.other) >= EMPLOYEE_PMO_PERMISSIONS)
        self.assertIn('pmo_manager', self.service._webvue_legacy_admin_roles())
```

- [ ] **Step 6: Add the webvue_meetings tests that replace the removed PMO assertions and cover meetings without projects**

Create `odoo-addons/webvue_meetings/tests/test_meetings_access_composition.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_meetings.models.meeting_access_service import (
    EMPLOYEE_MEETINGS_PERMISSIONS,
    MEETINGS_PERMISSIONS,
)

RULES = (
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
)


@tagged('webvue', 'webvue_access')
class TestMeetingsAccessComposition(TransactionCase):
    """webvue_meetings owns the three meetings.* capabilities, their groups and
    record rules (spec R2); it runs at install, so it also proves the hooks
    work without webvue_pmo or webvue_hr."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.Permission = cls.env['webvue.access.permission']
        cls.company = cls.env.company

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_meetings_own_three_capabilities_and_their_groups(self):
        catalog = self.service._webvue_capability_map()
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'webvue_meetings'}, set(MEETINGS_PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(MEETINGS_PERMISSIONS))])
        self.assertEqual(len(permissions), 3)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('webvue_meetings.permission_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('webvue_meetings.group_cap_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)
        self.assertEqual(
            {permission.key: set(permission.dependency_ids.mapped('key')) for permission in permissions if permission.dependency_ids},
            {'meetings.create': {'meetings.read'}, 'meetings.manage': {'meetings.read'}},
        )

    def test_core_roles_get_their_meeting_grants(self):
        self.assertEqual(self._keys('webvue_core.role_employee') & MEETINGS_PERMISSIONS, set(EMPLOYEE_MEETINGS_PERMISSIONS))
        self.assertNotIn('meetings.create', self._keys('webvue_core.role_employee'))
        self.assertTrue(self._keys('webvue_core.role_system_admin') >= MEETINGS_PERMISSIONS)
        self.assertTrue(self._keys('webvue_core.role_vendor_support') >= MEETINGS_PERMISSIONS)

    def test_core_groups_reach_meetings_and_the_rules_are_active(self):
        manage = self.env.ref('webvue_meetings.group_cap_meetings_manage')
        self.assertIn(manage, self.env.ref('webvue_core.group_access_admin').all_implied_ids)
        self.assertIn(manage, self.env.ref('webvue_core.group_vendor_support').all_implied_ids)
        self.assertIn(
            self.env.ref('cyan_meeting_minutes.group_meeting_user'),
            self.env.ref('webvue_meetings.group_cap_meetings_read').all_implied_ids,
        )
        for name in RULES:
            self.assertTrue(self.env.ref(f'webvue_meetings.{name}').active, name)

    def test_meeting_grants_are_repaired_additively_and_idempotently(self):
        roles = {key: self.env.ref(f'webvue_core.role_{key}') for key in ('employee', 'system_admin', 'vendor_support')}
        expected = {
            'employee': {'meetings.read'},
            'system_admin': set(MEETINGS_PERMISSIONS),
            'vendor_support': set(MEETINGS_PERMISSIONS),
        }
        meetings = self.Permission.search([('key', 'in', sorted(MEETINGS_PERMISSIONS))])
        for role in roles.values():
            role.write({'permission_ids': [Command.unlink(permission.id) for permission in meetings]})
        other_before = {key: set(role.permission_ids.mapped('key')) for key, role in roles.items()}
        custom = self.env['webvue.access.role'].create({
            'name_ar': 'دور اختبار الترحيل', 'name_en': 'Migration test role', 'type': 'custom',
            'company_id': self.company.id,
            'permission_ids': [Command.link(self.env.ref('webvue_meetings.permission_meetings_read').id)],
        })
        custom_keys, custom_version = set(custom.permission_ids.mapped('key')), custom.version

        self.assertTrue(self.service._webvue_repair_builtin_role_grants())
        for key, role in roles.items():
            keys = set(role.permission_ids.mapped('key'))
            self.assertEqual(keys & MEETINGS_PERMISSIONS, expected[key], key)
            self.assertEqual(keys - MEETINGS_PERMISSIONS, other_before[key], key)
        self.assertEqual(set(custom.permission_ids.mapped('key')), custom_keys)
        self.assertEqual(custom.version, custom_version)

        versions = {key: role.version for key, role in roles.items()}
        self.assertTrue(self.service._webvue_repair_builtin_role_grants())
        self.assertEqual({key: role.version for key, role in roles.items()}, versions)

    def test_legacy_groups_still_grant_meeting_capabilities(self):
        access_admin = new_test_user(self.env, login='meet_comp_access_admin', groups='webvue_core.group_access_admin')
        employee = new_test_user(self.env, login='meet_comp_employee', groups='webvue_core.group_employee')
        self.assertTrue(self.service._webvue_capability_keys(access_admin) >= MEETINGS_PERMISSIONS)
        self.assertIn('meetings.read', self.service._webvue_capability_keys(employee))
        self.assertNotIn('meetings.create', self.service._webvue_capability_keys(employee))
```

Create `odoo-addons/webvue_meetings/tests/test_meeting_notifications.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import WebVueMeetingsCase

MEETING_KINDS = [
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
]


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingNotificationTypes(WebVueMeetingsCase):

    def test_meetings_register_their_notification_kinds(self):
        registry = self.env['webvue.notify.registry']
        types = registry._webvue_notification_type_map()
        meetings = [kind for kind, item in types.items() if item['owner'] == 'webvue_meetings']
        self.assertEqual(meetings, MEETING_KINDS)
        self.assertEqual({types[kind]['feature_key'] for kind in meetings}, {'meetings.enabled'})
        self.assertEqual({types[kind]['model'] for kind in meetings}, {'cyan.meeting.minute'})
        self.assertIn('meetings.enabled', registry._webvue_notify_feature_keys())
        values = set(self.env['mail.message']._fields['webvue_notification_kind'].get_values(self.env))
        self.assertLessEqual(set(meetings), values)

    def test_meeting_delivery_keys_keep_their_pre_split_format(self):
        Message = self.env['mail.message'].sudo()
        other = new_test_user(self.env, login='meeting_key_nora', name='Nora', groups='webvue_core.group_employee')
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Key format meeting', 'organizer_id': self.manager.id,
        })
        partners = other.partner_id | self.employee.partner_id
        expected = sorted(f'meeting-invite:{meeting.id}:{partner.id}' for partner in partners)
        meeting._webvue_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        count = Message.search_count([('webvue_meeting_id', '=', meeting.id)])
        meeting._webvue_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        self.assertEqual(Message.search_count([('webvue_meeting_id', '=', meeting.id)]), count)
        self.assertEqual(sorted(Message.search([('webvue_notification_key', 'in', expected)]).mapped('webvue_notification_key')), expected)
        meeting._webvue_notify_partners(other.partner_id, 'meeting_changed', 'Moved')
        meeting._webvue_notify_partners(other.partner_id, 'meeting_changed', 'Moved')
        changed = Message.search([('webvue_meeting_id', '=', meeting.id), ('webvue_notification_kind', '=', 'meeting_changed')])
        self.assertEqual(len(changed), 2, 'meeting_changed has no idempotency key')
        self.assertEqual(set(changed.mapped('webvue_notification_key')), {False})
```

Create `odoo-addons/webvue_meetings/tests/test_meetings_without_projects.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from odoo.tests import tagged

from .common import WebVueMeetingsCase

UNSUPPORTED = 'project_id is not supported: the projects application is not installed'


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingsWithoutProjects(WebVueMeetingsCase):
    """webvue_meetings without the projects bridge keeps every payload shape and refuses project links (ruling H.1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        bridge = cls.env['ir.module.module'].search([('name', '=', 'webvue_meetings_pmo'), ('state', '=', 'installed')])
        if bridge:
            reason = 'the meetings/projects bridge is installed'
            raise unittest.SkipTest(reason)
        role = cls.env['webvue.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات بلا مشاريع', 'key': 'meetings_without_projects',
            'type': 'custom', 'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.employee.id, 'company_id': cls.env.company.id, 'role_id': role.id,
        })
        cls.series = cls.env['webvue.meeting.series'].create({
            'name': 'No project cadence', 'recurrence': 'none', 'organizer_id': cls.employee.id,
        })
        cls.meeting = cls.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'No project meeting', 'organizer_id': cls.employee.id,
            'series_id': cls.series.id, 'meeting_date': '2026-09-10',
        })
        cls.resolution = cls.env['cyan.meeting.resolution'].create({
            'meeting_id': cls.meeting.id, 'name': 'No project recommendation',
            'responsible_id': cls.employee.id, 'deadline': '2026-09-30',
        })

    def setUp(self):
        super().setUp()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _assert_unsupported(self, response):
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json(), {'code': 'invalid', 'message': UNSUPPORTED, 'field': 'project_id'})

    def test_no_model_carries_a_project_link(self):
        self.assertEqual(self.env['webvue.meeting.links']._webvue_link_fields(), frozenset())
        for model in ('cyan.meeting.minute', 'cyan.meeting.resolution', 'webvue.meeting.series'):
            self.assertNotIn('project_id', self.env[model]._fields, model)

    def test_payloads_keep_their_project_keys_as_null(self):
        detail = self.api('GET', f'/api/v1/meetings/{self.meeting.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        body = detail.json()
        self.assertIsNone(body['project_id'])
        self.assertIsNone(body['project'])
        row = next(item for item in body['resolutions'] if item['id'] == self.resolution.id)
        self.assertIsNone(row['project'])
        self.assertIsNone(row['task_id'])
        self.assertFalse(row['task_linked'])
        series = self.api('GET', f'/api/v1/meeting-series/{self.series.id}')
        self.assertEqual(series.status_code, 200, series.text)
        self.assertIsNone(series.json()['project'])

    def test_the_project_filter_is_validated_and_ignored(self):
        listed = self.api('GET', '/api/v1/meetings?project_id=987654&date_from=2026-09-10&date_to=2026-09-10')
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertIn(self.meeting.id, [item['id'] for item in listed.json()['items']])
        series = self.api('GET', '/api/v1/meeting-series?project_id=987654&q=No%20project')
        self.assertEqual(series.status_code, 200, series.text)
        self.assertIn(self.series.id, [item['id'] for item in series.json()['items']])
        invalid = self.api('GET', '/api/v1/meetings?project_id=abc')
        self.assertEqual(invalid.status_code, 422, invalid.text)
        self.assertEqual(invalid.json()['field'], 'project_id')

    def test_project_links_are_refused_and_clearing_is_a_no_op(self):
        self._assert_unsupported(self.api('POST', '/api/v1/meetings', {'name': 'With project', 'project_id': 5}))
        self._assert_unsupported(self.api('PATCH', f'/api/v1/meetings/{self.meeting.id}', {'project_id': 5}))
        self._assert_unsupported(self.api('POST', f'/api/v1/meetings/{self.meeting.id}/resolutions', {
            'name': 'With project', 'responsible_id': self.employee.id, 'deadline': '2026-09-30', 'project_id': 5,
        }))
        self._assert_unsupported(self.api(
            'PATCH', f'/api/v1/meetings/{self.meeting.id}/resolutions/{self.resolution.id}', {'project_id': 5},
        ))
        self._assert_unsupported(self.api('POST', '/api/v1/meeting-series', {'name': 'With project', 'project_id': 5}))
        cleared = self.api('PATCH', f'/api/v1/meetings/{self.meeting.id}', {'name': 'Renamed', 'project_id': None})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(cleared.json()['name'], 'Renamed')
        form = {
            'opening': '', 'closing': '', 'chairperson': '', 'approver_name': '', 'approver_title': '',
            'topics': [{'key': 'p', 'title': 'Project topic', 'discussion': '', 'project_id': 5, 'resolution_ids': []}],
        }
        topic = self.api('PATCH', f'/api/v1/meetings/{self.meeting.id}', {'minutes_form': form})
        self.assertEqual(topic.status_code, 422, topic.text)
        self.assertEqual(topic.json()['code'], 'invalid')

    def test_conversion_is_not_served(self):
        response = self.api(
            'POST', f'/api/v1/meetings/{self.meeting.id}/resolutions/{self.resolution.id}/convert', {'project_id': 5},
        )
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()['code'], 'not_found')
```

- [ ] **Step 7: Update the owner pins outside the two addons**

Replace `odoo-addons/webvue_core/tests/test_app_xmlid_migration.py` with (the released Phase 2 migration is not edited; the test reads the meeting rows under their current owner):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
import unittest

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

MIGRATION = 'webvue_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py'
# Phase 2b-2 handed these rows on from webvue_pmo to webvue_meetings (webvue_pmo
# 19.0.1.4.0). This test exercises the released Phase 2 step only: it reads
# the rows under their current owner and expects the Phase 2 owner back.
LATER_OWNER = {
    name: 'webvue_meetings'
    for name in (
        'group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage',
        'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
        'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    )
}
MEETING_RULES = ('rule_meeting_capability_scope', 'rule_resolution_capability_scope')
REQUIRED = {'webvue_hr', 'webvue_pmo', 'webvue_meetings'}


def _load_migration():
    spec = importlib.util.spec_from_file_location('webvue_core_pre_move_app_xmlids', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAppXmlidMigration(TransactionCase):
    """The 19.0.1.1.0 pre-migration renames release rows in place (spec 3.2, ruling R-A)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        installed = {
            module.name
            for module in cls.env['ir.module.module'].search([('name', 'in', sorted(REQUIRED)), ('state', '=', 'installed')])
        }
        if installed != REQUIRED:
            reason = 'needs webvue_hr, webvue_pmo and webvue_meetings installed'
            raise unittest.SkipTest(reason)
        cls.migration = _load_migration()
        cls.moved = [
            (module, name)
            for module, names in cls.migration.MOVED_XMLIDS.items()
            for name in names
        ]
        cls.current = {(module, name): (LATER_OWNER.get(name, module), name) for module, name in cls.moved}
        cls.modules = ['webvue_core', *cls.migration.MOVED_XMLIDS, 'webvue_meetings']

    def _rows(self):
        self.env.cr.execute(
            'SELECT module, name, model, res_id, noupdate FROM ir_model_data WHERE module = ANY(%s) AND name = ANY(%s)',
            [self.modules, [name for _module, name in self.moved]],
        )
        return {(module, name): (model, res_id, noupdate) for module, name, model, res_id, noupdate in self.env.cr.fetchall()}

    def _phase2_view(self, rows):
        """The rows as the Phase 2 migration leaves them: the meeting rows under webvue_pmo."""
        back = {current: phase2 for phase2, current in self.current.items()}
        return {back.get(key, key): value for key, value in rows.items()}

    def _group_xmlids(self):
        self.env.cr.execute('SELECT key, group_xmlid FROM webvue_access_permission')
        return dict(self.env.cr.fetchall())

    def _restore_release_state(self):
        for module, name in self.moved:
            owner = LATER_OWNER.get(name, module)
            self.env.cr.execute(
                "UPDATE ir_model_data SET module = 'webvue_core' WHERE module = %s AND name = %s",
                [owner, name],
            )
            if name.startswith('group_cap_'):
                self.env.cr.execute(
                    'UPDATE webvue_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                    [f'webvue_core.{name}', f'{owner}.{name}'],
                )

    def test_release_rows_are_renamed_in_place_and_a_rerun_is_a_no_op(self):
        installed = self._phase2_view(self._rows())
        self.assertEqual(sorted(key for key in installed if key in self.moved), sorted(self.moved))
        group_xmlids = {
            key: value.replace('webvue_meetings.', 'webvue_pmo.', 1) for key, value in self._group_xmlids().items()
        }

        self._restore_release_state()
        release = self._rows()
        self.assertEqual({module for module, _name in release}, {'webvue_core'})
        self.assertEqual(self._group_xmlids(), {
            key: 'webvue_core.' + value.split('.', 1)[1] for key, value in group_xmlids.items()
        })

        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), installed)
        self.assertEqual(self._group_xmlids(), group_xmlids)

        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), installed)
        self.assertEqual(self._group_xmlids(), group_xmlids)

    def test_fresh_install_skips_the_migration(self):
        before = self._rows()
        self._restore_release_state()
        release = self._rows()
        self.migration.migrate(self.env.cr, None)
        self.assertEqual(self._rows(), release)
        self.assertNotEqual(release, before)

    def test_a_duplicate_row_stops_the_upgrade_before_any_rename(self):
        module, name = self.moved[0]
        model, res_id, _noupdate = self._rows()[module, name]
        self.env.cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES ('webvue_core', %s, %s, %s, false)",
            [name, model, res_id],
        )
        before = self._rows()
        with self.assertRaisesRegex(ValueError, f'webvue_core.{name} and {module}.{name}'):
            self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), before)

    def _meeting_rules(self):
        rows = self._rows()
        res_ids = [(rows.get(('webvue_pmo', name)) or rows['webvue_meetings', name])[1] for name in MEETING_RULES]
        return self.env['ir.rule'].browse(res_ids)

    def _set_pmo_state(self, state):
        self.env.cr.execute("UPDATE ir_module_module SET state = %s WHERE name = 'webvue_pmo'", [state])

    def test_meeting_rules_fail_closed_when_webvue_pmo_is_not_installed(self):
        self._restore_release_state()
        self._set_pmo_state('uninstalled')
        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        rules = self._meeting_rules()
        self.env.invalidate_all()
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules.mapped('domain_force'), ["[(0, '=', 1)]"] * 2)
        self.assertTrue(all(rules.mapped('active')))

    def test_meeting_rules_are_left_alone_when_webvue_pmo_is_installed(self):
        before = self._meeting_rules().mapped('domain_force')
        self._restore_release_state()
        self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.env.invalidate_all()
        after = self._meeting_rules().mapped('domain_force')
        self.assertEqual(after, before)
        self.assertNotIn("[(0, '=', 1)]", after)
```

In `odoo-addons/webvue_api/tests/test_access_composition.py` replace:

```python
            for module in cls.env['ir.module.module'].search([('name', 'in', ['webvue_hr', 'webvue_pmo']), ('state', '=', 'installed')])
        }
        if installed != {'webvue_hr', 'webvue_pmo'}:
            reason = 'needs webvue_hr and webvue_pmo installed'
```

with:

```python
            for module in cls.env['ir.module.module'].search([('name', 'in', ['webvue_hr', 'webvue_pmo', 'webvue_meetings']), ('state', '=', 'installed')])
        }
        if installed != {'webvue_hr', 'webvue_pmo', 'webvue_meetings'}:
            reason = 'needs webvue_hr, webvue_pmo and webvue_meetings installed'
```

In `odoo-addons/webvue_api/tests/test_access_admin.py` replace:

```python
                ('name', 'in', ['webvue_hr', 'webvue_pmo']), ('state', '=', 'installed'),
            ])
        }
        # 9 core capabilities, plus 8 for HR and 11 (8 + 3 meetings) for PMO.
        total = 9 + 8 * ('webvue_hr' in installed) + 11 * ('webvue_pmo' in installed)
        self.assertEqual((len(body['items']), body['total']), (total, total))
        self.assertEqual(
            {item['key'] for item in body['items'] if item['key'].startswith('meetings.')},
            {'meetings.read', 'meetings.create', 'meetings.manage'} if 'webvue_pmo' in installed else set(),
        )
```

with:

```python
                ('name', 'in', ['webvue_hr', 'webvue_pmo', 'webvue_meetings']), ('state', '=', 'installed'),
            ])
        }
        # 9 core capabilities, plus 8 for HR, 8 for PMO and 3 for meetings.
        total = (
            9 + 8 * ('webvue_hr' in installed) + 8 * ('webvue_pmo' in installed)
            + 3 * ('webvue_meetings' in installed)
        )
        self.assertEqual((len(body['items']), body['total']), (total, total))
        self.assertEqual(
            {item['key'] for item in body['items'] if item['key'].startswith('meetings.')},
            {'meetings.read', 'meetings.create', 'meetings.manage'} if 'webvue_meetings' in installed else set(),
        )
```

In `odoo-addons/webvue_platform/tests/test_entitlements.py` replace:

```python
    APP_BOOLEANS = {
        'webvue_pmo': {'pmo.enabled', 'meetings.enabled'},
        'webvue_hr': {'hr.enabled'},
        'webvue_chat': {'chat.enabled'},
    }
```

with:

```python
    APP_BOOLEANS = {
        'webvue_pmo': {'pmo.enabled'},
        'webvue_meetings': {'meetings.enabled'},
        'webvue_hr': {'hr.enabled'},
        'webvue_chat': {'chat.enabled'},
    }
```

replace:

```python
        if self._installed_apps() == {'webvue_pmo', 'webvue_hr', 'webvue_chat'}:
            self.assertEqual(set(self.record.retained_read_features), {
```

with:

```python
        if self._installed_apps() == {'webvue_pmo', 'webvue_meetings', 'webvue_hr', 'webvue_chat'}:
            self.assertEqual(set(self.record.retained_read_features), {
```

replace:

```python
        self._require_app('webvue_pmo')
        self._operator().write({
            'features': {**self.record.features, 'meetings.enabled': False},
```

with:

```python
        self._require_app('webvue_meetings')
        self._operator().write({
            'features': {**self.record.features, 'meetings.enabled': False},
```

replace (the meetings-without-project install has neither PMO nor HR, so the key must come from an installed application):

```python
    def _readable_key(self):
        # pmo.enabled when webvue_pmo is installed, else the HR key.
        return 'pmo.enabled' if 'webvue_pmo' in self._installed_apps() else 'hr.enabled'
```

with:

```python
    def _readable_key(self):
        # A boolean of an installed application: pmo.enabled first, as before.
        for app in ('webvue_pmo', 'webvue_hr', 'webvue_meetings', 'webvue_chat'):
            if app in self._installed_apps():
                return sorted(self.APP_BOOLEANS[app])[0]
        reason = 'needs an application installed'
        raise unittest.SkipTest(reason)
```

and replace:

```python
        # 9 core capabilities, plus 8 for HR and 8 + 3 meetings for PMO (28 in all).
        expected = 9 + 8 * ('webvue_hr' in apps) + 11 * ('webvue_pmo' in apps)
        self.assertEqual(len(capability_map), expected)
        if apps == {'webvue_pmo', 'webvue_hr', 'webvue_chat'}:
            self.assertEqual(set(self.features._webvue_module_map()), {
                'webvue_pmo', 'webvue_hr', 'webvue_chat',
            })
```

with:

```python
        # 9 core capabilities, plus 8 for HR, 8 for PMO and 3 for meetings (28 in all).
        expected = 9 + 8 * ('webvue_hr' in apps) + 8 * ('webvue_pmo' in apps) + 3 * ('webvue_meetings' in apps)
        self.assertEqual(len(capability_map), expected)
        if apps == {'webvue_pmo', 'webvue_meetings', 'webvue_hr', 'webvue_chat'}:
            self.assertEqual(set(self.features._webvue_module_map()), {
                'webvue_pmo', 'webvue_meetings', 'webvue_hr', 'webvue_chat',
            })
```

In `odoo-addons/webvue_api/tests/test_access_admin.py` (`TestAccessAdminRoles`) replace (any other built-in role works for the count check, and `webvue_hr` is absent from the meetings-without-project install):

```python
        other = self.env.ref('webvue_hr.role_hr_manager')
```

with:

```python
        other = self.env.ref('webvue_core.role_system_admin')
```

- [ ] **Step 8: Register the ranks, the catalog tier and the module tuples**

In `tools/arch_layers.json` replace:

```json
    "webvue_pmo": 4,
    "webvue_hr": 4,
    "webvue_chat": 4
  },
```

with:

```json
    "webvue_pmo": 4,
    "webvue_meetings": 4,
    "webvue_hr": 4,
    "webvue_chat": 4,
    "webvue_meetings_pmo": 5
  },
```

Add `webvue_meetings` to tier `projects` of both solutions (names and prices untouched):

```bash
python3 - <<'PY'
from pathlib import Path

EDITS = {
    'deploy/catalog/solutions/platform.json': ('"modules": ["webvue_pmo"],', '"modules": ["webvue_pmo", "webvue_meetings"],'),
    'deploy/catalog/solutions/platform_v2.json': (
        '"modules": [\n        "webvue_pmo"\n      ],',
        '"modules": [\n        "webvue_pmo",\n        "webvue_meetings"\n      ],',
    ),
}
for name, (old, new) in EDITS.items():
    path = Path(name)
    text = path.read_text(encoding='utf-8')
    assert text.count(old) == 1, (name, text.count(old))
    path.write_text(text.replace(old, new), encoding='utf-8')
    print('tier projects installs webvue_meetings:', name)
PY
```

In `tools/webvue_cli/operator.py` replace:

```python
CREATE_MODULES = ('webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify',
                  'webvue_directory', 'webvue_pmo', 'webvue_hr', 'webvue_chat')
```

with:

```python
CREATE_MODULES = ('webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify',
                  'webvue_directory', 'webvue_pmo', 'webvue_meetings', 'webvue_meetings_pmo',
                  'webvue_hr', 'webvue_chat')
```

In `tools/shared_saas_lifecycle/odoo_effect.py` replace:

```python
ALLOWED_MODULES = {
    'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory',
    'webvue_pmo', 'webvue_hr', 'webvue_chat',
}
```

with:

```python
ALLOWED_MODULES = {
    'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory',
    'webvue_pmo', 'webvue_meetings', 'webvue_meetings_pmo', 'webvue_hr', 'webvue_chat',
}
```

In `deploy/check_isolated.py` replace:

```python
WEBVUE_ADDONS = (
    'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory',
    'webvue_pmo', 'webvue_hr', 'webvue_chat',
)
```

with:

```python
WEBVUE_ADDONS = (
    'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory',
    'webvue_pmo', 'webvue_meetings', 'webvue_meetings_pmo', 'webvue_hr', 'webvue_chat',
)
```

In `deploy/test_operations.py` replace:

```python
            (
                'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory',
                'webvue_pmo', 'webvue_hr', 'webvue_chat',
            ),
```

with:

```python
            (
                'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory',
                'webvue_pmo', 'webvue_meetings', 'webvue_meetings_pmo', 'webvue_hr', 'webvue_chat',
            ),
```

Update the catalog-derived pins. In `tools/test_webvue_cli_operator.py` replace:

```python
            self.assertEqual(policy['modules'], ['webvue_core', 'webvue_platform',
                                                  'webvue_api', 'webvue_pmo'])
```

with:

```python
            self.assertEqual(policy['modules'], ['webvue_core', 'webvue_platform',
                                                  'webvue_api', 'webvue_pmo', 'webvue_meetings'])
```

In `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts` replace:

```ts
    expect(apps[1].modules).toEqual(['webvue_pmo'])
```

with:

```ts
    expect(apps[1].modules).toEqual(['webvue_pmo', 'webvue_meetings'])
```

and replace:

```ts
    expect(result.modules).toEqual(['webvue_api', 'webvue_core', 'webvue_hr', 'webvue_platform', 'webvue_pmo'])
```

with:

```ts
    expect(result.modules).toEqual(['webvue_api', 'webvue_core', 'webvue_hr', 'webvue_meetings', 'webvue_platform', 'webvue_pmo'])
```

In `apps/control-plane/src/__tests__/shared-onboarding-live.test.ts` replace:

```ts
expect(jobs.rows[0].payload.policy.modules).toEqual(['webvue_core','webvue_platform','webvue_api','webvue_pmo'])
```

with:

```ts
expect(jobs.rows[0].payload.policy.modules).toEqual(['webvue_core','webvue_platform','webvue_api','webvue_pmo','webvue_meetings'])
```

- [ ] **Step 9: Static checks and the baseline**

```bash
ruff check --fix --select F401,I odoo-addons/webvue_meetings odoo-addons/webvue_meetings_pmo odoo-addons/webvue_pmo
ruff check odoo-addons
rg -n "webvue_pmo" odoo-addons/webvue_meetings || echo "webvue_meetings names no webvue_pmo"
rg -n "odoo\.addons\.webvue_meetings" odoo-addons/webvue_pmo; rg -n "odoo\.addons\.webvue_pmo" odoo-addons/webvue_meetings
rg -n "cyan|meeting" odoo-addons/webvue_pmo --glob '!migrations/**' --glob '!tests/test_notify_ownership_migration.py'
rg -n "webvue_pmo\.(group_cap_meetings|permission_meetings)|from \.common import WebVuePmoCase|from \.meeting_workspace import" odoo-addons/webvue_meetings_pmo || echo "bridge references are absolute"
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
PY
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/catalog_check.py
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
npm -w packages/commercial-contracts run test 2>&1 | tail -n 5
npm test 2>&1 | tail -n 8
```

Expected: `All checks passed!`; `webvue_meetings names no webvue_pmo`; both cross-import searches print nothing; the `cyan|meeting` search over `webvue_pmo` prints only the docstring line of `_webvue_extra_create_fields` in `models/project_task.py` and the two dependency-comment lines of `__manifest__.py` that name the meeting addons; `bridge references are absolute`; `arch_policy exit=0` with totals unchanged from Task 5 (`R2 4, R7 83, R9 68, R10 0`; R7 keys now under `webvue_meetings/` and `webvue_meetings_pmo/`); `migration_guard exit=0` (webvue_pmo keeps 19.0.1.3.0 until Task 7; new addons have no base version); `CATALOG_OK solutions=2`; deploy and tools suites `OK`; the commercial-contracts suite green; `npm test` green. If `tools/catalog_check.py` reports a tier problem or a tools/commercial test pins the old `projects` composition somewhere not listed in Step 8, stop and report it with the failing assertion.

- [ ] **Step 10: Run the control-plane suites (live PostgreSQL)**

```bash
export CONTROL_TEST_DATABASE_URL="postgres://webvue_test:odoo@127.0.0.1:5432/webvue_control_scratch_meetings"
PGPASSWORD=odoo dropdb -h 127.0.0.1 -U webvue_test --if-exists webvue_control_scratch_meetings
PGPASSWORD=odoo createdb -h 127.0.0.1 -U webvue_test webvue_control_scratch_meetings && npm -w apps/control-plane test 2>&1 | tail -n 12
PGPASSWORD=odoo dropdb -h 127.0.0.1 -U webvue_test --if-exists webvue_control_scratch_meetings
```

Expected: the control-plane suite is green, including `shared-onboarding-live.test.ts`. If `createdb` fails (role or password missing on this machine), do not invent credentials: report that the live control-plane suite was not run and that CI's `control-plane` step must prove the pin.

- [ ] **Step 11: Run the four install proofs (background, one after the other)**

```bash
# 1. Full install: nine addons listed, the bridge must auto-install (ten installed).
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t6_full \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat
# 2. Foundation and HR only.
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t6_hr \
  webvue_core,webvue_platform,webvue_api,webvue_hr \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_hr
# 3. Meetings without project.
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t6_meetings \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_meetings \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_meetings
# 4. webvue_pmo without the meeting engine (the eight addons of 2b-1).
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t6_pmo \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat
```

Expected, in order:
1. `INSTALLED_PROBE cyan_meeting_minutes,webvue_meetings,webvue_meetings_pmo,webvue_pmo,project` and `ODOO_RUN_TEST_OK`; the count is Task 5's full count plus the new webvue_meetings tests (`TestMeetingsWithoutProjects` skips here).
2. `INSTALLED_PROBE ` (empty list) and `ODOO_RUN_TEST_OK`.
3. `INSTALLED_PROBE cyan_meeting_minutes,webvue_meetings` (no `project`, no PMO, no bridge) and `ODOO_RUN_TEST_OK`; `TestMeetingsWithoutProjects` runs here.
4. `INSTALLED_PROBE webvue_pmo,project` (no `cyan_meeting_minutes`) and `ODOO_RUN_TEST_OK`.

Any failure: list it with `grep -E '(FAIL|ERROR): ' /tmp/webvue-meetings/logs/<db>.log` and compare with Task 0's pre-existing list. A shared-layer test (webvue_core, webvue_platform, webvue_api) that fails in proof 3 only because it assumes `webvue_hr` or `webvue_pmo` is installed is a latent assumption this new install shape exposes: make it skip, or use an installed application's key or a `webvue_core` role, the way Step 7 does for `_readable_key` and `TestAccessAdminRoles`, and list it in your report. Any other failure is a regression: fix it and re-run that proof.

- [ ] **Step 12: Commit**

```bash
git add -A odoo-addons/webvue_meetings odoo-addons/webvue_meetings_pmo odoo-addons/webvue_pmo \
  odoo-addons/webvue_core/tests/test_app_xmlid_migration.py odoo-addons/webvue_api/tests/test_access_composition.py \
  odoo-addons/webvue_api/tests/test_access_admin.py odoo-addons/webvue_platform/tests/test_entitlements.py \
  tools/arch_layers.json tools/arch_baseline.json tools/webvue_cli/operator.py tools/shared_saas_lifecycle/odoo_effect.py \
  tools/test_webvue_cli_operator.py deploy/check_isolated.py deploy/test_operations.py deploy/catalog/solutions \
  packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts \
  apps/control-plane/src/__tests__/shared-onboarding-live.test.ts
git status --short
git commit -m "refactor(pmo): move meetings to webvue_meetings and webvue_meetings_pmo" -m "<TRAILER>"
```

Expected: `git status --short` before the commit shows only staged entries (no `??` under `odoo-addons/`).

---
### Task 7: Hand the meeting records over on upgrade (webvue_pmo 19.0.1.4.0 and webvue_meetings' pre_init_hook)

**Files:**
- Create: `odoo-addons/webvue_pmo/migrations/19.0.1.4.0/pre-hand_meetings_to_webvue_meetings.py`
- Create: `odoo-addons/webvue_meetings/hooks.py`
- Create: `odoo-addons/webvue_meetings_pmo/tests/test_meetings_ownership_migration.py`
- Modify: `odoo-addons/webvue_meetings/__init__.py`, `odoo-addons/webvue_meetings/__manifest__.py`, `odoo-addons/webvue_meetings_pmo/tests/__init__.py`, `odoo-addons/webvue_pmo/__manifest__.py:5`

**Interfaces:**
- Consumes: the xml id owners produced by Task 6.
- Produces: migration constants `SOURCE`, `MEETINGS`, `BRIDGE`, `CLOSED_DOMAIN`, `GROUPS`, `RULES`, `MEETING_KINDS`, `MEETINGS_XMLIDS`, `BRIDGE_XMLIDS`, `MEETINGS_CONSTRAINTS`, `BRIDGE_CONSTRAINTS`, `MEETINGS_RELATIONS`, `LEFT_TO_ODOO` and `migrate(cr, version)`; `odoo.addons.webvue_meetings.hooks.pre_init_hook(env)` with `SOURCE`, `TARGET`, `GROUPS`, `OWNED_XMLIDS`. Task 9's assertion script consumes the migration constants.

The per-row technique (Deviation 1):

| Rows | Receiving addon | From `main` (and from the release without `-i`) | From the release with `-i webvue_meetings` |
|---|---|---|---|
| `MEETINGS_XMLIDS` (groups, permissions, rules, ACL rows, cron and its server action, paper format, report view, the three models and their fields, the seven `cyan.meeting.*`/`mail.*` columns and the selection values) | `webvue_meetings` | renamed by the migration | renamed by `pre_init_hook` before `webvue_meetings` loads; the migration finds nothing left |
| `BRIDGE_XMLIDS` (three `project_id` fields, `project.task.meeting_id`/`resolution_id`, the unique index) | `webvue_meetings_pmo` | renamed by the migration | renamed by the migration (the bridge always loads after `webvue_pmo`) |
| `MEETINGS_CONSTRAINTS`, `BRIDGE_CONSTRAINTS` (`ir_model_constraint`) and `MEETINGS_RELATIONS` (`ir_model_relation`) | same | re-pointed by the migration | adopt-then-delete: Odoo already reflected the target's own rows, the migration drops `webvue_pmo`'s copy |
| `LEFT_TO_ODOO` (shared models' `ir.model` and `id`/`display_name` rows) | — | not touched; `_process_end` drops only `webvue_pmo`'s xml id | same |
| An `ir_model_data` row the target already holds for the same record | — | adopt: drop `webvue_pmo`'s duplicate | same |
| An `ir_model_data` row the target holds for a different record | — | stop the upgrade before any change | stop the install before any change |

- [ ] **Step 1: Write the failing migration test**

Create `odoo-addons/webvue_meetings_pmo/tests/test_meetings_ownership_migration.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

from odoo.addons.webvue_meetings import hooks

MIGRATION = 'webvue_pmo/migrations/19.0.1.4.0/pre-hand_meetings_to_webvue_meetings.py'


def _load_migration():
    spec = importlib.util.spec_from_file_location('webvue_pmo_pre_hand_meetings', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingsOwnershipMigration(TransactionCase):
    """webvue_pmo 19.0.1.4.0 and webvue_meetings' pre_init_hook hand the meeting rows over in place (plan 2b-2, Deviation 1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.m = _load_migration()
        cls.owners = {
            **{name: cls.m.MEETINGS for name in cls.m.MEETINGS_XMLIDS},
            **{name: cls.m.BRIDGE for name in cls.m.BRIDGE_XMLIDS},
        }
        cls.constraint_owners = {
            **{name: cls.m.MEETINGS for name in cls.m.MEETINGS_CONSTRAINTS},
            **{name: cls.m.BRIDGE for name in cls.m.BRIDGE_CONSTRAINTS},
        }

    # The rows move under the ORM's feet: every reader below is plain SQL.

    def _module_id(self, name):
        self.env.cr.execute('SELECT id FROM ir_module_module WHERE name = %s', [name])
        return self.env.cr.fetchone()[0]

    def _xmlids(self):
        self.env.cr.execute(
            'SELECT module, name, model, res_id FROM ir_model_data WHERE name = ANY(%s) AND module IN %s',
            [list(self.owners), (self.m.SOURCE, self.m.MEETINGS, self.m.BRIDGE)],
        )
        return {(module, name): (model, res_id) for module, name, model, res_id in self.env.cr.fetchall()}

    def _owned_rows(self, table, names):
        self.env.cr.execute(
            f'SELECT t.name, m.name FROM {table} t JOIN ir_module_module m ON m.id = t.module WHERE t.name = ANY(%s)',
            [list(names)],
        )
        return sorted(self.env.cr.fetchall())

    def _group_xmlids(self):
        self.env.cr.execute("SELECT key, group_xmlid FROM webvue_access_permission WHERE key LIKE 'meetings.%%' ORDER BY key")
        return self.env.cr.fetchall()

    def _rule_domains(self):
        self.env.cr.execute(
            "SELECT d.name, r.domain_force FROM ir_rule r JOIN ir_model_data d ON d.model = 'ir.rule' AND d.res_id = r.id "
            'WHERE d.name = ANY(%s) AND d.module IN %s ORDER BY d.name',
            [list(self.m.RULES), (self.m.SOURCE, self.m.MEETINGS)],
        )
        return self.env.cr.fetchall()

    def _states(self):
        self.env.cr.execute('SELECT name, state FROM ir_module_module WHERE name IN %s', [(self.m.MEETINGS, self.m.BRIDGE)])
        return dict(self.env.cr.fetchall())

    def _snapshot(self):
        return (
            self._xmlids(),
            self._owned_rows('ir_model_constraint', self.constraint_owners),
            self._owned_rows('ir_model_relation', self.m.MEETINGS_RELATIONS),
            self._group_xmlids(),
            self._rule_domains(),
        )

    def _restore_upgrade_state(self):
        """What the pre-migration meets on a 19.0.1.3.0 database: webvue_pmo owns every row, neither addon is installed."""
        m, cr = self.m, self.env.cr
        for name, owner in self.owners.items():
            cr.execute('UPDATE ir_model_data SET module = %s WHERE module = %s AND name = %s', [m.SOURCE, owner, name])
        source = self._module_id(m.SOURCE)
        for name, owner in self.constraint_owners.items():
            cr.execute(
                'UPDATE ir_model_constraint SET module = %s WHERE name = %s AND module = %s',
                [source, name, self._module_id(owner)],
            )
        for name in m.MEETINGS_RELATIONS:
            cr.execute(
                'UPDATE ir_model_relation SET module = %s WHERE name = %s AND module = %s',
                [source, name, self._module_id(m.MEETINGS)],
            )
        for name in m.GROUPS:
            cr.execute(
                'UPDATE webvue_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                [f'{m.SOURCE}.{name}', f'{m.MEETINGS}.{name}'],
            )
        cr.execute("UPDATE ir_module_module SET state = 'uninstalled' WHERE name IN %s", [(m.MEETINGS, m.BRIDGE)])
        self.env.invalidate_all()

    def test_a_fresh_install_owns_every_listed_row(self):
        m = self.m
        xmlids = self._xmlids()
        for name, owner in self.owners.items():
            self.assertIn((owner, name), xmlids, name)
            self.assertNotIn((m.SOURCE, name), xmlids, name)
        self.assertEqual(self._owned_rows('ir_model_constraint', self.constraint_owners), sorted(self.constraint_owners.items()))
        self.assertEqual(
            self._owned_rows('ir_model_relation', m.MEETINGS_RELATIONS),
            [(name, m.MEETINGS) for name in sorted(m.MEETINGS_RELATIONS)],
        )
        self.env.cr.execute('SELECT name FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [m.SOURCE, list(m.LEFT_TO_ODOO)])
        self.assertEqual(self.env.cr.fetchall(), [])
        self.assertEqual({value for _key, value in self._group_xmlids()}, {f'{m.MEETINGS}.{name}' for name in m.GROUPS})
        self.assertEqual(self._states(), {m.MEETINGS: 'installed', m.BRIDGE: 'installed'})

    def test_the_hook_and_the_migration_name_the_same_rows(self):
        self.assertEqual(set(hooks.OWNED_XMLIDS), set(self.m.MEETINGS_XMLIDS))
        self.assertEqual(tuple(hooks.GROUPS), tuple(self.m.GROUPS))
        self.assertEqual((hooks.SOURCE, hooks.TARGET), (self.m.SOURCE, self.m.MEETINGS))

    def test_rows_are_renamed_in_place_and_a_rerun_is_a_no_op(self):
        before = self._snapshot()
        self._restore_upgrade_state()
        self.assertNotEqual(self._snapshot(), before)
        for _run in range(2):
            self.m.migrate(self.env.cr, '19.0.1.3.0')
            self.assertEqual(self._snapshot(), before)
            self.assertEqual(self._states(), {self.m.MEETINGS: 'to install', self.m.BRIDGE: 'to install'})

    def test_a_fresh_install_skips_the_migration(self):
        self._restore_upgrade_state()
        restored = (self._snapshot(), self._states())
        self.m.migrate(self.env.cr, None)
        self.assertEqual((self._snapshot(), self._states()), restored)

    def test_the_hook_adopts_the_meeting_rows_before_webvue_pmo_upgrades(self):
        m = self.m
        before = self._snapshot()
        self._restore_upgrade_state()
        hooks.pre_init_hook(self.env)
        xmlids = self._xmlids()
        for name in m.MEETINGS_XMLIDS:
            self.assertIn((m.MEETINGS, name), xmlids, name)
        for name in m.BRIDGE_XMLIDS:
            self.assertIn((m.SOURCE, name), xmlids, name)
        self.assertEqual({value for _key, value in self._group_xmlids()}, {f'{m.MEETINGS}.{name}' for name in m.GROUPS})
        hooks.pre_init_hook(self.env)
        m.migrate(self.env.cr, '19.0.1.3.0')
        self.assertEqual(self._snapshot(), before)

    def test_rows_the_target_already_reflected_are_adopted(self):
        m, cr = self.m, self.env.cr
        before = self._snapshot()
        self._restore_upgrade_state()
        hooks.pre_init_hook(self.env)
        meetings = self._module_id(m.MEETINGS)
        cr.execute(
            '''
                INSERT INTO ir_model_constraint
                       (name, module, model, type, definition, message, create_date, write_date, create_uid, write_uid)
                SELECT name, %s, model, type, definition, message, create_date, write_date, create_uid, write_uid
                  FROM ir_model_constraint WHERE name = 'webvue_meeting_series_company_id_fkey'
            ''',
            [meetings],
        )
        cr.execute(
            '''
                INSERT INTO ir_model_relation (name, module, model, create_date, write_date, create_uid, write_uid)
                SELECT name, %s, model, create_date, write_date, create_uid, write_uid
                  FROM ir_model_relation WHERE name = 'webvue_meeting_series_attendee_rel'
            ''',
            [meetings],
        )
        m.migrate(cr, '19.0.1.3.0')
        self.assertEqual(self._snapshot(), before)

    def test_a_duplicate_reflection_xml_id_is_adopted(self):
        m, cr = self.m, self.env.cr
        before = self._snapshot()
        self._restore_upgrade_state()
        cr.execute(
            "SELECT model, res_id FROM ir_model_data WHERE module = %s AND name = 'field_webvue_meeting_series__name'",
            [m.SOURCE],
        )
        model, res_id = cr.fetchone()
        cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES (%s, 'field_webvue_meeting_series__name', %s, %s, false)",
            [m.MEETINGS, model, res_id],
        )
        m.migrate(cr, '19.0.1.3.0')
        self.assertEqual(self._snapshot(), before)

    def test_a_clash_stops_before_any_change(self):
        m, cr = self.m, self.env.cr
        self._restore_upgrade_state()
        other = self.env['res.groups'].create({'name': 'Ownership clash group'})
        self.env.flush_all()
        cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES (%s, 'group_cap_meetings_read', 'res.groups', %s, false)",
            [m.MEETINGS, other.id],
        )
        restored = (self._snapshot(), self._states())
        with self.assertRaisesRegex(ValueError, 'group_cap_meetings_read'):
            m.migrate(cr, '19.0.1.3.0')
        self.assertEqual((self._snapshot(), self._states()), restored)
        with self.assertRaisesRegex(ValueError, 'group_cap_meetings_read'):
            hooks.pre_init_hook(self.env)
        self.assertEqual((self._snapshot(), self._states()), restored)

    def test_the_rules_fail_closed_when_webvue_meetings_cannot_be_installed(self):
        m, cr = self.m, self.env.cr
        self._restore_upgrade_state()
        cr.execute("UPDATE ir_module_module SET state = 'uninstallable' WHERE name = %s", [m.MEETINGS])
        m.migrate(cr, '19.0.1.3.0')
        self.assertEqual(self._states(), {m.MEETINGS: 'uninstallable', m.BRIDGE: 'uninstalled'})
        self.assertEqual([domain for _name, domain in self._rule_domains()], [m.CLOSED_DOMAIN] * len(m.RULES))
        xmlids = self._xmlids()
        for name, owner in self.owners.items():
            self.assertIn((owner, name), xmlids, name)
```

In `odoo-addons/webvue_meetings_pmo/tests/__init__.py` add `    test_meetings_ownership_migration,` after `    test_meetings_pmo,`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t7 \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_hr,webvue_chat \
  /webvue_meetings_pmo:TestMeetingsOwnershipMigration
```

Expected: the run dies with `tests failed or did not run`; the log shows `ImportError` for `odoo.addons.webvue_meetings.hooks` (or `FileNotFoundError` for the migration path). Drop the kept database: `/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_t7`.

- [ ] **Step 3: Write the migration, the hook and the version bump**

Create `odoo-addons/webvue_pmo/migrations/19.0.1.4.0/pre-hand_meetings_to_webvue_meetings.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hand webvue_pmo's meeting records to webvue_meetings and webvue_meetings_pmo.

webvue_meetings is not a dependency of webvue_pmo, so upgrading webvue_pmo does not
install it by itself. This script runs before webvue_pmo loads and:

1. renames, in place, every ir_model_data row of the meetings application
   to webvue_meetings and every project/task link row to the bridge
   webvue_meetings_pmo, so each record keeps its database id: users keep their
   groups, roles keep their grants, tables and columns survive. When the
   receiving addon already holds the same xml id for the same record,
   webvue_pmo's duplicate is dropped; a holder pointing at another record
   stops the upgrade before anything changes;
2. re-points the matching ir_model_constraint and ir_model_relation rows,
   or drops webvue_pmo's copy when the receiving addon reflected its own;
3. rewrites the permissions' group_xmlid;
4. marks webvue_meetings and webvue_meetings_pmo 'to install' while they are
   uninstalled, so they load later in this run, before Odoo removes the
   rows webvue_pmo no longer declares.

When webvue_meetings cannot be installed (not on the addons path, or not
installable), the meeting record rules would call a helper nobody defines,
so they are closed; the rows still move and wait for webvue_meetings.

LEFT_TO_ODOO lists rows webvue_pmo held only because it extended shared
models for meetings. Their owners keep their own xml ids, so Odoo drops
only webvue_pmo's; this script does not touch them.

webvue_meetings' pre_init_hook renames MEETINGS_XMLIDS the same way when an
upgrade installs it before this script runs. Re-running changes nothing; a
fresh install skips it.
"""

SOURCE = 'webvue_pmo'
MEETINGS = 'webvue_meetings'
BRIDGE = 'webvue_meetings_pmo'
CLOSED_DOMAIN = "[(0, '=', 1)]"

GROUPS = ('group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage')
RULES = (
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
)
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)
SERIES_FIELDS = (
    'attendee_ids', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'location',
    'meeting_ids', 'meeting_url', 'name', 'organizer_id', 'recurrence', 'secretary_id',
    'until_count', 'until_date', 'write_date', 'write_uid',
)
EVENT_FIELDS = (
    'actor_id', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'kind',
    'meeting_id', 'occurred_at', 'summary', 'write_date', 'write_uid',
)
VERSION_FIELDS = (
    'actor_id', 'captured_at', 'company_id', 'create_date', 'create_uid', 'display_name', 'id',
    'meeting_id', 'number', 'snapshot', 'write_date', 'write_uid',
)
MINUTE_FIELDS = (
    'meeting_url', 'minutes_form', 'minutes_form_data', 'minutes_snapshot',
    'minutes_snapshot_at', 'minutes_snapshot_data', 'series_id',
)
MEETINGS_XMLIDS = (
    *GROUPS,
    'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
    *RULES,
    'access_webvue_meeting_series_read', 'access_webvue_meeting_series_create',
    'access_webvue_meeting_series_manage', 'access_webvue_meeting_event_read',
    'access_webvue_meeting_event_manage_read', 'access_webvue_meeting_minutes_version_read',
    'access_webvue_meeting_minutes_version_manage_read',
    'ir_cron_webvue_meeting_reminders', 'ir_cron_webvue_meeting_reminders_ir_actions_server',
    'webvue_meeting_minutes_landscape', 'report_meeting_minutes_document_history',
    'model_webvue_meeting_series', 'model_webvue_meeting_event', 'model_webvue_meeting_minutes_version',
    *(f'field_webvue_meeting_series__{name}' for name in SERIES_FIELDS),
    *(f'field_webvue_meeting_event__{name}' for name in EVENT_FIELDS),
    *(f'field_webvue_meeting_minutes_version__{name}' for name in VERSION_FIELDS),
    *(f'selection__webvue_meeting_series__recurrence__{value}' for value in ('none', 'weekly', 'biweekly', 'monthly')),
    'constraint_webvue_meeting_minutes_version_number_unique',
    *(f'field_cyan_meeting_minute__{name}' for name in MINUTE_FIELDS),
    'field_cyan_meeting_resolution__deadline', 'field_cyan_meeting_resolution__execution_period',
    'field_mail_message__webvue_meeting_id', 'field_mail_mail__webvue_meeting_id',
    *(f'selection__mail_message__webvue_notification_kind__{kind}' for kind in MEETING_KINDS),
)
BRIDGE_XMLIDS = (
    'field_cyan_meeting_minute__project_id', 'field_cyan_meeting_resolution__project_id',
    'field_webvue_meeting_series__project_id', 'field_project_task__meeting_id',
    'field_project_task__resolution_id', 'constraint_project_task_webvue_resolution_task_unique',
)
MEETINGS_CONSTRAINTS = (
    'webvue_meeting_minutes_version_number_unique', 'cyan_meeting_minute_series_id_fkey',
    *(f'webvue_meeting_event_{name}_fkey' for name in ('actor_id', 'company_id', 'create_uid', 'meeting_id', 'write_uid')),
    *(f'webvue_meeting_minutes_version_{name}_fkey' for name in ('actor_id', 'company_id', 'create_uid', 'meeting_id', 'write_uid')),
    'webvue_meeting_series_attendee_rel_series_id_fkey', 'webvue_meeting_series_attendee_rel_user_id_fkey',
    *(f'webvue_meeting_series_{name}_fkey' for name in ('company_id', 'create_uid', 'organizer_id', 'secretary_id', 'write_uid')),
)
BRIDGE_CONSTRAINTS = (
    'project_task_webvue_resolution_task_unique', 'cyan_meeting_minute_project_id_fkey',
    'cyan_meeting_resolution_project_id_fkey', 'webvue_meeting_series_project_id_fkey',
)
MEETINGS_RELATIONS = ('webvue_meeting_series_attendee_rel',)
LEFT_TO_ODOO = (
    'model_calendar_event', 'model_cyan_meeting_minute', 'model_cyan_meeting_resolution', 'model_res_users',
    'field_calendar_event__display_name', 'field_calendar_event__id',
    'field_cyan_meeting_minute__display_name', 'field_cyan_meeting_minute__id',
    'field_cyan_meeting_resolution__display_name', 'field_cyan_meeting_resolution__id',
    'field_res_users__display_name', 'field_res_users__id',
)


def _stop(problem):
    msg = (
        f'webvue_pmo migration: {problem}. The upgrade stopped before any meeting row moved. '
        f'Check which record users and roles reference, delete the other ir_model_data row, '
        f'then run the upgrade again.'
    )
    raise ValueError(msg)


def _xmlids(cr, module, names):
    cr.execute('SELECT name, model, res_id FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [module, list(names)])
    return {name: (model, res_id) for name, model, res_id in cr.fetchall()}


def _plan(cr, target, names):
    """``(rename, drop)`` name lists for ``target``; stops on a clash without changing anything."""
    source = _xmlids(cr, SOURCE, names)
    held = _xmlids(cr, target, source)
    rename, drop = [], []
    for name, row in sorted(source.items()):
        if name not in held:
            rename.append(name)
        elif held[name] == row:
            drop.append(name)
        else:
            _stop(f'both {SOURCE}.{name} and {target}.{name} exist and point at different records')
    return rename, drop


def _module(cr, name):
    cr.execute('SELECT id, state FROM ir_module_module WHERE name = %s', [name])
    return cr.fetchone()


def _hand_over(cr, table, names, source_id, target_id):
    """Re-point webvue_pmo's rows of ``table`` to the target, or drop them when the target reflected its own."""
    for name in names:
        cr.execute(f'SELECT 1 FROM {table} WHERE name = %s AND module = %s', [name, target_id])
        if cr.fetchone():
            cr.execute(f'DELETE FROM {table} WHERE name = %s AND module = %s', [name, source_id])
        else:
            cr.execute(f'UPDATE {table} SET module = %s WHERE name = %s AND module = %s', [target_id, name, source_id])


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        "SELECT 1 FROM ir_model_data WHERE module IN %s AND name = 'model_webvue_meeting_series'",
        [(SOURCE, MEETINGS)],
    )
    if not cr.fetchone():
        return
    plans = {MEETINGS: _plan(cr, MEETINGS, MEETINGS_XMLIDS), BRIDGE: _plan(cr, BRIDGE, BRIDGE_XMLIDS)}
    for target, (rename, drop) in plans.items():
        if drop:
            cr.execute('DELETE FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [SOURCE, drop])
        if rename:
            cr.execute('UPDATE ir_model_data SET module = %s WHERE module = %s AND name = ANY(%s)', [target, SOURCE, rename])
    source = _module(cr, SOURCE)
    meetings = _module(cr, MEETINGS)
    bridge = _module(cr, BRIDGE)
    if meetings:
        _hand_over(cr, 'ir_model_constraint', MEETINGS_CONSTRAINTS, source[0], meetings[0])
        _hand_over(cr, 'ir_model_relation', MEETINGS_RELATIONS, source[0], meetings[0])
    if bridge:
        _hand_over(cr, 'ir_model_constraint', BRIDGE_CONSTRAINTS, source[0], bridge[0])
    for name in GROUPS:
        cr.execute(
            'UPDATE webvue_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
            [f'{MEETINGS}.{name}', f'{SOURCE}.{name}'],
        )
    if not meetings or meetings[1] == 'uninstallable':
        cr.execute(
            """
                UPDATE ir_rule SET domain_force = %s
                 WHERE id IN (SELECT res_id FROM ir_model_data
                               WHERE module = %s AND model = 'ir.rule' AND name = ANY(%s))
            """,
            [CLOSED_DOMAIN, MEETINGS, list(RULES)],
        )
        return
    cr.execute("UPDATE ir_module_module SET state = 'to install' WHERE name = %s AND state = 'uninstalled'", [MEETINGS])
    if bridge and bridge[1] != 'uninstallable':
        cr.execute("UPDATE ir_module_module SET state = 'to install' WHERE name = %s AND state = 'uninstalled'", [BRIDGE])
```

Create `odoo-addons/webvue_meetings/hooks.py` (the same names as the migration's `MEETINGS_XMLIDS`, written out because an application may not import another application; `test_the_hook_and_the_migration_name_the_same_rows` pins them):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Adopt the meeting records an older webvue_pmo created, before webvue_meetings loads.

When an upgrade from release/19.0.1.0.0 installs webvue_meetings with -i,
Odoo loads webvue_meetings in an earlier phase than webvue_pmo's upgrade
(webvue_pmo now depends on addons installed in the same run), so webvue_pmo's
19.0.1.4.0 pre-migration has not run yet. Without this hook webvue_meetings
would create a second copy of every group, permission, rule and cron. The
hook renames webvue_pmo's rows in place exactly like that migration does and
rewrites the permissions' group_xmlid. The project/task rows and the
constraint and relation rows stay for that migration. A fresh install finds
nothing to rename.
"""

SOURCE = 'webvue_pmo'
TARGET = 'webvue_meetings'
GROUPS = ('group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage')
_RULES = (
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
)
_MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)
_SERIES_FIELDS = (
    'attendee_ids', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'location',
    'meeting_ids', 'meeting_url', 'name', 'organizer_id', 'recurrence', 'secretary_id',
    'until_count', 'until_date', 'write_date', 'write_uid',
)
_EVENT_FIELDS = (
    'actor_id', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'kind',
    'meeting_id', 'occurred_at', 'summary', 'write_date', 'write_uid',
)
_VERSION_FIELDS = (
    'actor_id', 'captured_at', 'company_id', 'create_date', 'create_uid', 'display_name', 'id',
    'meeting_id', 'number', 'snapshot', 'write_date', 'write_uid',
)
_MINUTE_FIELDS = (
    'meeting_url', 'minutes_form', 'minutes_form_data', 'minutes_snapshot',
    'minutes_snapshot_at', 'minutes_snapshot_data', 'series_id',
)
OWNED_XMLIDS = (
    *GROUPS,
    'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
    *_RULES,
    'access_webvue_meeting_series_read', 'access_webvue_meeting_series_create',
    'access_webvue_meeting_series_manage', 'access_webvue_meeting_event_read',
    'access_webvue_meeting_event_manage_read', 'access_webvue_meeting_minutes_version_read',
    'access_webvue_meeting_minutes_version_manage_read',
    'ir_cron_webvue_meeting_reminders', 'ir_cron_webvue_meeting_reminders_ir_actions_server',
    'webvue_meeting_minutes_landscape', 'report_meeting_minutes_document_history',
    'model_webvue_meeting_series', 'model_webvue_meeting_event', 'model_webvue_meeting_minutes_version',
    *(f'field_webvue_meeting_series__{name}' for name in _SERIES_FIELDS),
    *(f'field_webvue_meeting_event__{name}' for name in _EVENT_FIELDS),
    *(f'field_webvue_meeting_minutes_version__{name}' for name in _VERSION_FIELDS),
    *(f'selection__webvue_meeting_series__recurrence__{value}' for value in ('none', 'weekly', 'biweekly', 'monthly')),
    'constraint_webvue_meeting_minutes_version_number_unique',
    *(f'field_cyan_meeting_minute__{name}' for name in _MINUTE_FIELDS),
    'field_cyan_meeting_resolution__deadline', 'field_cyan_meeting_resolution__execution_period',
    'field_mail_message__webvue_meeting_id', 'field_mail_mail__webvue_meeting_id',
    *(f'selection__mail_message__webvue_notification_kind__{kind}' for kind in _MEETING_KINDS),
)


def pre_init_hook(env):
    Data = env['ir.model.data']
    rows = Data.search([('module', '=', SOURCE), ('name', 'in', list(OWNED_XMLIDS))])
    if not rows:
        return
    held = {
        data.name: (data.model, data.res_id)
        for data in Data.search([('module', '=', TARGET), ('name', 'in', rows.mapped('name'))])
    }
    duplicates = Data.browse()
    for data in rows:
        if data.name not in held:
            continue
        if held[data.name] != (data.model, data.res_id):
            msg = (
                f'webvue_meetings install: both {SOURCE}.{data.name} and {TARGET}.{data.name} exist and '
                f'point at different records. Check which record users and roles reference, delete '
                f'the other ir_model_data row, then install again.'
            )
            raise ValueError(msg)
        duplicates |= data
    duplicates.unlink()
    (rows - duplicates).write({'module': TARGET})
    Permission = env['webvue.access.permission']
    for name in GROUPS:
        Permission.search([('group_xmlid', '=', f'{SOURCE}.{name}')]).write({'group_xmlid': f'{TARGET}.{name}'})
    env.flush_all()
```

Replace `odoo-addons/webvue_meetings/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers, models
from .hooks import pre_init_hook
```

In `odoo-addons/webvue_meetings/__manifest__.py` replace:

```python
    'installable': True,
    'application': False,
}
```

with:

```python
    # Adopts the meeting rows of an older webvue_pmo when an upgrade installs
    # this addon before webvue_pmo's 19.0.1.4.0 migration (plan 2b-2, Deviation 1).
    'pre_init_hook': 'pre_init_hook',
    'installable': True,
    'application': False,
}
```

In `odoo-addons/webvue_pmo/__manifest__.py` replace `    'version': '19.0.1.3.0',` with `    'version': '19.0.1.4.0',`.

- [ ] **Step 4: Static checks**

```bash
ruff check odoo-addons
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B - <<'PY'
import importlib.util
spec = importlib.util.spec_from_file_location('m', 'odoo-addons/webvue_pmo/migrations/19.0.1.4.0/pre-hand_meetings_to_webvue_meetings.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
spec = importlib.util.spec_from_file_location('h', 'odoo-addons/webvue_meetings/hooks.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
assert set(h.OWNED_XMLIDS) == set(m.MEETINGS_XMLIDS), set(h.OWNED_XMLIDS) ^ set(m.MEETINGS_XMLIDS)
assert not set(m.MEETINGS_XMLIDS) & set(m.BRIDGE_XMLIDS) and not set(m.LEFT_TO_ODOO) & set(m.MEETINGS_XMLIDS)
print('lists ok', len(m.MEETINGS_XMLIDS), len(m.BRIDGE_XMLIDS), len(m.MEETINGS_CONSTRAINTS), len(m.BRIDGE_CONSTRAINTS), len(m.LEFT_TO_ODOO))
PY
```

Expected: `All checks passed!`; both `exit=0` (`webvue_pmo` 19.0.1.3.0 → 19.0.1.4.0 ships `migrations/19.0.1.4.0/pre-*.py`; neither file is scanned by R7/R9: the migration lives under `migrations/` and the hook uses the ORM only); `lists ok 89 6 19 4 12`.

- [ ] **Step 5: Run the migration test, then the full suite (background)**

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t7 \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_hr,webvue_chat \
  /webvue_meetings_pmo:TestMeetingsOwnershipMigration,/webvue_core:TestAppXmlidMigration,/webvue_pmo:TestNotifyOwnershipMigration
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_t7_full \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat
```

Expected: two `ODOO_RUN_TEST_OK` lines. If `test_a_fresh_install_owns_every_listed_row` fails on a name, that name is not declared by the receiving addon (or is declared by another): fix the list, never the assertion — renaming a row the target does not re-declare makes Odoo delete it at the end of the upgrade.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_pmo/migrations/19.0.1.4.0 odoo-addons/webvue_pmo/__manifest__.py \
  odoo-addons/webvue_meetings/hooks.py odoo-addons/webvue_meetings/__init__.py odoo-addons/webvue_meetings/__manifest__.py \
  odoo-addons/webvue_meetings_pmo/tests
git commit -m "feat(pmo): hand meeting records to webvue_meetings on upgrade" -m "<TRAILER>"
```

---

### Task 8: Install and test the two addons everywhere the addons are listed

**Files:**
- Modify: `.woodpecker.yml` (odoo, upgrade, restore-drill, image steps), `deploy/woodpecker/image.yml:56`, `deploy/provision.sh:106`, `deploy/verification-checks.json:52-54`, `deploy/OPERATIONS.md:83-84,200`, `deploy/control-plane-outage/outage-fixture:23`, `deploy/control-plane-outage/README.md:16`, `tools/check_cp1_scratch.py:20`, `tools/shared_acceptance_live/up.sh:233`
- Modify: `tools/test_module_closure.py`, `tools/shared_saas_lifecycle/readback.py:37`

**Interfaces:**
- Produces: the canonical ten-module list and tag list of Task 0, used by CI and Tasks 9-10. The CI upgrade runs `-u "$MODULES" -i "$MODULES"` (Deviation 4).

`tools/shared_saas_lifecycle/lifecycle.py:168` and `tools/saas_commercial_acceptance/commercial_lifecycle.py:180` seed the *vendor* database with `webvue_core,webvue_platform,webvue_api,webvue_pmo,webvue_hr` for its bootstrap roles; they are left alone, as in 2b-1.

- [ ] **Step 1: Replace the comma-separated lists**

```bash
python3 - <<'PY'
from pathlib import Path

OLD_I = 'webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat'
NEW_I = 'webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat'
OLD_T = '/webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat'
NEW_T = '/webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat'
EXPECTED = {  # path: (module lists, test-tag lists)
    '.woodpecker.yml': (4, 1),
    'deploy/woodpecker/image.yml': (1, 0),
    'deploy/provision.sh': (1, 0),
    'deploy/verification-checks.json': (1, 1),
    'deploy/OPERATIONS.md': (2, 1),
    'deploy/control-plane-outage/outage-fixture': (1, 0),
    'deploy/control-plane-outage/README.md': (1, 0),
    'tools/check_cp1_scratch.py': (1, 0),
    'tools/shared_acceptance_live/up.sh': (1, 0),
}
for name, (modules, tags) in EXPECTED.items():
    path = Path(name)
    text = path.read_text(encoding='utf-8')
    found = (text.count(OLD_I), text.count(OLD_T))
    assert found == (modules, tags), f'{name}: found {found}, expected {(modules, tags)}'
    path.write_text(text.replace(OLD_T, NEW_T).replace(OLD_I, NEW_I), encoding='utf-8')
    print(f'{name}: {modules} module list(s), {tags} test-tag list(s)')
PY
```

Expected: nine lines, one per file, and no assertion error.

- [ ] **Step 2: Install the new addons in the CI upgrade run**

In `.woodpecker.yml` (upgrade step) replace:

```yaml
        # Upgrade to this commit
```

with:

```yaml
        # Upgrade to this commit. -i installs the addons the previous release did
        # not have (webvue_meetings, webvue_meetings_pmo); Odoo skips the installed ones.
```

and replace:

```yaml
          -d "$SCRATCH_DB" -u "$MODULES" --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init 2>&1 | tee "$SCRATCH_ROOT/upgrade-output.log"
```

with:

```yaml
          -d "$SCRATCH_DB" -u "$MODULES" -i "$MODULES" --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init 2>&1 | tee "$SCRATCH_ROOT/upgrade-output.log"
```

- [ ] **Step 3: Pin the real bridge manifest in the closure tests and the acceptance readback**

In `tools/test_module_closure.py` replace:

```python
    'projects': (BASE + ['webvue_pmo'],
                 {'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory', 'webvue_pmo'}),
```

with:

```python
    'projects': (BASE + ['webvue_pmo', 'webvue_meetings'],
                 {'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory', 'webvue_pmo',
                  'webvue_meetings', 'webvue_meetings_pmo'}),
```

and append to the class:

```python

    def test_the_real_meetings_bridge_joins_only_with_both_applications(self):
        shared = {'webvue_core', 'webvue_platform', 'webvue_api', 'webvue_notify', 'webvue_directory'}
        self.assertEqual(
            module_closure.install_closure([ADDONS], BASE + ['webvue_meetings']), shared | {'webvue_meetings'},
        )
        self.assertEqual(module_closure.install_closure([ADDONS], BASE + ['webvue_pmo']), shared | {'webvue_pmo'})
        self.assertIn(
            'webvue_meetings_pmo', module_closure.install_closure([ADDONS], BASE + ['webvue_meetings', 'webvue_pmo']),
        )
```

In `tools/shared_saas_lifecycle/readback.py` replace:

```python
    expected_modules = ['webvue_api', 'webvue_core', 'webvue_platform', 'webvue_pmo']
```

with:

```python
    # The installation closure of the projects tier (base modules + webvue_pmo + webvue_meetings).
    expected_modules = [
        'webvue_api', 'webvue_core', 'webvue_directory', 'webvue_meetings', 'webvue_meetings_pmo',
        'webvue_notify', 'webvue_platform', 'webvue_pmo',
    ]
```

- [ ] **Step 4: Run the repository checks these files feed**

```bash
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
python3 -B tools/catalog_check.py
python3 -c "import yaml; yaml.safe_load(open('.woodpecker.yml')); yaml.safe_load(open('deploy/woodpecker/image.yml')); print('yaml ok')"
bash -n deploy/provision.sh && bash -n tools/shared_acceptance_live/up.sh && bash -n deploy/control-plane-outage/outage-fixture && echo "shell ok"
python3 -c "import json; json.load(open('deploy/verification-checks.json')); print('json ok')"
rg -n "webvue_directory,webvue_pmo,webvue_hr|/webvue_directory,/webvue_pmo,/webvue_hr" .woodpecker.yml deploy tools --glob '!**/node_modules/**' || echo "no eight-module list left"
```

Expected: both unittest runs `OK`; `CATALOG_OK solutions=2`; `yaml ok` (if `yaml` is not importable, skip that line and say so); `shell ok`; `json ok`; `no eight-module list left`.

- [ ] **Step 5: Commit**

```bash
git add .woodpecker.yml deploy/woodpecker/image.yml deploy/provision.sh deploy/verification-checks.json \
  deploy/OPERATIONS.md deploy/control-plane-outage/outage-fixture deploy/control-plane-outage/README.md \
  tools/check_cp1_scratch.py tools/shared_acceptance_live/up.sh tools/test_module_closure.py \
  tools/shared_saas_lifecycle/readback.py
git commit -m "ci(ci): install and test webvue_meetings and webvue_meetings_pmo" -m "<TRAILER>"
```

---
### Task 9: Prove both upgrade paths keep every meeting record, grant and notification

This mirrors the CI `upgrade` step twice: from the commit this branch started from (current `main`, upgraded with `-u` only, so `webvue_pmo`'s migration installs the two addons) and from `release/19.0.1.0.0` (upgraded with `-u` and `-i` as CI now does, so `webvue_meetings` loads before `webvue_pmo` and its `pre_init_hook` does the rename). Nothing is committed in this task.

**Files:**
- Create (outside the repo): `/tmp/webvue-meetings/ownership_dump.py`, `/tmp/webvue-meetings/meetings_fixture.py`, `/tmp/webvue-meetings/meetings_assert.py`, `/tmp/webvue-meetings/fresh-ownership.json`, `/tmp/webvue-meetings/base-main`, `/tmp/webvue-meetings/base-release` (temporary detached worktrees)

**Interfaces:**
- Consumes: the Task 7 migration constants; `webvue.notify.service._webvue_domain/_webvue_visible_rows/_webvue_visible_count`, `webvue.notify.registry._webvue_notify_dump`; `dump_meeting`/`dump_series` (base code: `odoo.addons.webvue_pmo.serializers.meeting`; branch: `odoo.addons.webvue_meetings.serializers.meeting`).

- [ ] **Step 1: Write the three scripts**

```bash
cat > /tmp/webvue-meetings/ownership_dump.py <<'DUMP'
# Piped into `odoo-bin shell` on a fresh install of the branch: who owns which row.
import json
import sys

MODULES = ('webvue_pmo', 'webvue_meetings', 'webvue_meetings_pmo')
assert env.cr.dbname.startswith('webvue_scratch_meetings_'), env.cr.dbname  # noqa: F821
cr = env.cr  # noqa: F821
cr.execute('SELECT module, name, model FROM ir_model_data WHERE module IN %s ORDER BY 1, 2', [MODULES])
xmlids = [list(row) for row in cr.fetchall()]
cr.execute(
    'SELECT c.name, c.type, m.name FROM ir_model_constraint c JOIN ir_module_module m ON m.id = c.module '
    'WHERE m.name IN %s ORDER BY 1, 3',
    [MODULES],
)
constraints = [list(row) for row in cr.fetchall()]
cr.execute(
    'SELECT r.name, m.name FROM ir_model_relation r JOIN ir_module_module m ON m.id = r.module '
    'WHERE m.name IN %s ORDER BY 1, 2',
    [MODULES],
)
relations = [list(row) for row in cr.fetchall()]
with open('/tmp/webvue-meetings/fresh-ownership.json', 'w', encoding='utf-8') as handle:
    json.dump({'xmlids': xmlids, 'constraints': constraints, 'relations': relations}, handle, indent=1)
print(f'OWNERSHIP_DUMP_OK xmlids={len(xmlids)} constraints={len(constraints)} relations={len(relations)}')
sys.exit(0)
DUMP
cat > /tmp/webvue-meetings/meetings_fixture.py <<'FIXTURE'
# Piped into `odoo-bin shell` on a base database running the base code
# (current main or release/19.0.1.0.0). Creates a series with occurrences,
# recommendations, a converted task, a completed meeting with its frozen
# snapshot, a minutes topic with a project, capability grants and meeting
# notifications, then snapshots the rows and what each user sees.
import json
import sys
from datetime import timedelta
from types import SimpleNamespace

from odoo import Command, fields
from odoo.fields import Domain

from odoo.addons.webvue_pmo.serializers.meeting import dump_meeting, dump_series

assert env.cr.dbname.startswith('webvue_scratch_meetings_'), env.cr.dbname  # noqa: F821
SNAPSHOT = f'/tmp/webvue-meetings/upgrade-before-{env.cr.dbname}.json'  # noqa: F821
LOGINS = ('meet_mona', 'meet_alice', 'meet_bob', 'meet_carol')
KEY_RECORDS = (
    'group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage',
    'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
    'ir_cron_webvue_meeting_reminders', 'ir_cron_webvue_meeting_reminders_ir_actions_server',
    'webvue_meeting_minutes_landscape', 'report_meeting_minutes_document_history',
    'model_webvue_meeting_series', 'model_webvue_meeting_event', 'model_webvue_meeting_minutes_version',
)
ROWS = {
    'meetings': 'SELECT id, name, state, company_id, series_id, project_id, meeting_url, minutes_snapshot_data::text, '
                'minutes_snapshot_at::text, minutes_form_data::text FROM cyan_meeting_minute ORDER BY id',
    'resolutions': 'SELECT id, meeting_id, name, state, deadline::text, execution_period, project_id, responsible_id '
                   'FROM cyan_meeting_resolution ORDER BY id',
    'series': 'SELECT id, name, company_id, project_id, organizer_id, secretary_id, recurrence FROM webvue_meeting_series ORDER BY id',
    'series_attendees': 'SELECT series_id, user_id FROM webvue_meeting_series_attendee_rel ORDER BY 1, 2',
    'versions': 'SELECT id, meeting_id, number, snapshot::text FROM webvue_meeting_minutes_version ORDER BY id',
    'events': 'SELECT meeting_id, count(*) FROM webvue_meeting_event GROUP BY meeting_id ORDER BY 1',
    'task_links': 'SELECT id, meeting_id, resolution_id FROM project_task WHERE resolution_id IS NOT NULL ORDER BY id',
    'bell': 'SELECT n.id, n.res_partner_id, n.is_read, m.id, m.webvue_notification_kind, m.webvue_notification_key, '
            'm.model, m.res_id, m.webvue_meeting_id FROM mail_notification n JOIN mail_message m ON m.id = n.mail_message_id '
            'WHERE m.webvue_notification ORDER BY n.id',
    'permissions': "SELECT key, split_part(group_xmlid, '.', 2) FROM webvue_access_permission WHERE key LIKE 'meetings.%' ORDER BY 1",
}
cr = env.cr  # noqa: F821
company = env.company  # noqa: F821
Users = env['res.users'].with_context(no_reset_password=True)  # noqa: F821


def ref(*xmlids):
    for xmlid in xmlids:
        record = env.ref(xmlid, raise_if_not_found=False)  # noqa: F821
        if record:
            return record
    print(f'UPGRADE_FIXTURE_FAIL none of {xmlids} exists')
    sys.exit(1)


def make_user(login, groups):
    return Users.create({
        'name': login, 'login': login, 'password': login + '_pass_123',
        'company_id': company.id, 'company_ids': [Command.set([company.id])],
        'group_ids': [Command.set([group.id for group in groups])],
    })


def bell(user):
    if 'webvue.notify.service' in env:  # noqa: F821 - main: the bell is webvue_notify's
        user_env = env(user=user.id)  # noqa: F821
        service, registry = user_env['webvue.notify.service'], user_env['webvue.notify.registry']
        domain = service._webvue_domain()
        return {
            'items': [registry._webvue_notify_dump(row, extra) for row, extra in service._webvue_visible_rows(domain)],
            'total': service._webvue_visible_count(domain),
            'unread_count': service._webvue_visible_count(domain & Domain('is_read', '=', False)),
        }
    from odoo.addons.webvue_pmo.controllers import notifications as old_bell  # noqa: PLC0415 - release: the bell was webvue_pmo's
    from odoo.addons.webvue_pmo.serializers.notification import dump_notification  # noqa: PLC0415
    old_bell.request = SimpleNamespace(env=env(user=user.id))  # noqa: F821
    controller = old_bell.NotificationController()
    domain = controller._domain()
    return {
        'items': [dump_notification(row, live) for row, live in controller._visible_rows(domain)],
        'total': controller._visible_count(domain),
        'unread_count': controller._visible_count(domain + [('is_read', '=', False)]),
    }


def seen(user):
    user_env = env(user=user.id)  # noqa: F821
    return json.loads(json.dumps({
        'capabilities': sorted(env['webvue.access.service']._webvue_capability_keys(user)),  # noqa: F821
        'cap_groups': sorted(
            name.split('.', 1)[1] for name in user.all_group_ids.get_external_id().values()
            if '.group_cap_meetings_' in name
        ),
        'meetings': [dump_meeting(meeting, detail=True) for meeting in user_env['cyan.meeting.minute'].search([], order='id')],
        'series': [dump_series(series, detail=True) for series in user_env['webvue.meeting.series'].search([], order='id')],
        'resolutions': user_env['cyan.meeting.resolution'].search([], order='id').ids,
        'bell': bell(user),
    }))


employee = ref('webvue_core.group_employee')
mona = make_user('meet_mona', [employee, ref('project.group_project_manager')])
alice = make_user('meet_alice', [employee])
bob = make_user('meet_bob', [employee])
carol = make_user('meet_carol', [ref('base.group_user')])
users = mona | alice | bob | carol
Assignment = env['webvue.access.assignment']  # noqa: F821
for role in (ref('webvue_core.role_system_admin'), ref('webvue_pmo.role_pmo_manager', 'webvue_core.role_pmo_manager')):
    Assignment.create({'user_id': mona.id, 'role_id': role.id, 'company_id': company.id})
reader = env['webvue.access.role'].create({  # noqa: F821
    'name_ar': 'قارئ اجتماعات الترقية', 'name_en': 'Upgrade meetings reader', 'type': 'custom',
    'company_id': company.id,
    'permission_ids': [Command.set(env['webvue.access.permission'].search([('key', '=', 'meetings.read')]).ids)],  # noqa: F821
})
Assignment.create({'user_id': carol.id, 'role_id': reader.id, 'company_id': company.id})

now = fields.Datetime.now().replace(microsecond=0)
today = fields.Date.today()
project = env['project.project'].create({'name': 'Meetings upgrade project', 'company_id': company.id, 'user_id': mona.id})  # noqa: F821
series = env['webvue.meeting.series'].with_user(mona).create({  # noqa: F821
    'name': 'Upgrade weekly review', 'recurrence': 'none', 'project_id': project.id,
    'attendee_ids': [Command.set([alice.id, carol.id])], 'location': 'Room 1',
})
first = series.action_add_occurrence(now - timedelta(days=7), now - timedelta(days=7) + timedelta(hours=1), 'Upgrade review 1')
second = series.action_add_occurrence(now + timedelta(hours=2), now + timedelta(hours=3), 'Upgrade review 2')
Resolution = env['cyan.meeting.resolution'].with_user(mona)  # noqa: F821
converted = Resolution.create({
    'meeting_id': first.id, 'name': 'Upgrade follow-up task', 'responsible_id': alice.id,
    'deadline': today - timedelta(days=2),
})
Resolution.create({
    'meeting_id': first.id, 'name': 'Upgrade overdue item', 'responsible_id': alice.id,
    'deadline': today - timedelta(days=1),
})
Resolution.create({
    'meeting_id': first.id, 'name': 'Upgrade ongoing item', 'responsible_id': carol.id,
    'execution_period': 'continuous', 'project_id': project.id,
})
first._webvue_notify_partners(alice.partner_id, 'meeting_resolution', converted.name, key=f'meeting-res:{converted.id}')
task = converted.action_convert_to_task(project.id)
first.action_confirm()
first.action_done()
second._webvue_set_minutes_form({
    'opening': 'Open', 'closing': '', 'chairperson': 'Mona', 'approver_name': 'Mona', 'approver_title': 'Lead',
    'topics': [{'key': 't1', 'title': 'Delivery', 'discussion': '', 'project_id': project.id, 'resolution_ids': []}],
})
Meeting = env['cyan.meeting.minute'].with_user(mona)  # noqa: F821
standalone = Meeting.create({
    'name': 'Upgrade standalone', 'state': 'draft', 'project_id': project.id,
    'attendee_ids': [Command.set([bob.id])],
    'start_datetime': now + timedelta(days=2), 'end_datetime': now + timedelta(days=2, hours=1),
    'meeting_date': (now + timedelta(days=2)).date(),
})
standalone.write({'location': 'Room 2'})
Resolution.create({
    'meeting_id': standalone.id, 'name': 'Upgrade bob item', 'responsible_id': bob.id,
    'deadline': today - timedelta(days=3),
})
cancelled = Meeting.create({
    'name': 'Upgrade cancelled', 'state': 'draft', 'attendee_ids': [Command.set([alice.id])],
    'start_datetime': now + timedelta(days=3), 'end_datetime': now + timedelta(days=3, hours=1),
    'meeting_date': (now + timedelta(days=3)).date(),
})
cancelled.action_cancel()
hidden = env['cyan.meeting.minute'].create({'name': 'Upgrade hidden', 'state': 'draft', 'organizer_id': mona.id})  # noqa: F821
hidden._webvue_notify_partners(bob.partner_id, 'meeting_invite', 'Hidden meeting', key=f'meeting-invite:{hidden.id}')
env['cyan.meeting.minute']._webvue_run_meeting_reminders()  # noqa: F821
first_row = env['mail.notification'].search([  # noqa: F821
    ('res_partner_id', '=', alice.partner_id.id), ('mail_message_id.webvue_notification', '=', True),
], order='id', limit=1)
first_row.is_read = True
env.flush_all()  # noqa: F821

views = {user.login: seen(user) for user in users}
kinds = {login: {item['kind'] for item in view['bell']['items']} for login, view in views.items()}
expect = {
    'meet_alice': {'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_cancelled',
                   'meeting_reminder', 'meeting_resolution_overdue'},
    'meet_bob': {'meeting_invite', 'meeting_changed', 'meeting_resolution_overdue'},
    'meet_carol': {'meeting_invite', 'meeting_reminder'},
}
problems = [
    f'{login} sees {sorted(kinds[login])}, expected at least {sorted(wanted)}'
    for login, wanted in expect.items() if not wanted <= kinds[login]
]
if any(item.get('meeting_id') == hidden.id for item in views['meet_bob']['bell']['items']):
    problems.append('bob sees the hidden meeting before the upgrade')
alice_meetings = {meeting['id'] for meeting in views['meet_alice']['meetings']}
if not {first.id, second.id, cancelled.id} <= alice_meetings or {standalone.id, hidden.id} & alice_meetings:
    problems.append(f'alice sees meetings {sorted(alice_meetings)}')
carol_first = next((meeting for meeting in views['meet_carol']['meetings'] if meeting['id'] == first.id), None)
carol_row = carol_first and next(row for row in carol_first['resolutions'] if row['id'] == converted.id)
if not carol_row or carol_row['task_id'] is not None or not carol_row['task_linked']:
    problems.append(f'carol (meetings.read only) sees the converted recommendation as {carol_row}')
if not views['meet_alice']['bell']['total'] > views['meet_alice']['bell']['unread_count']:
    problems.append('alice has no read row')
rows = {}
for name, query in ROWS.items():
    cr.execute(query)
    rows[name] = [list(row) for row in cr.fetchall()]
cr.execute(
    "SELECT name, model, res_id FROM ir_model_data WHERE name = ANY(%s) AND module IN ('webvue_core', 'webvue_pmo')",
    [list(KEY_RECORDS)],
)
records = {name: [model, res_id] for name, model, res_id in cr.fetchall()}
problems += [f'{name} has no row before the upgrade' for name in KEY_RECORDS if name not in records]
roles = {
    role.key or role.name_ar: sorted(role.permission_ids.mapped('key'))
    for role in env['webvue.access.role'].search([])  # noqa: F821
}
for problem in problems:
    print(f'UPGRADE_FIXTURE_FAIL {problem}')
if problems:
    sys.exit(1)
with open(SNAPSHOT, 'w', encoding='utf-8') as handle:
    json.dump({
        'rows': rows, 'views': views, 'records': records, 'roles': roles,
        'mona': mona.id, 'alice': alice.id, 'hidden_meeting_id': hidden.id, 'converted_id': converted.id,
        'task_id': task.id,
    }, handle, ensure_ascii=False, indent=1, sort_keys=True)
env.cr.commit()  # noqa: F821
print(f"UPGRADE_FIXTURE_OK bell={len(rows['bell'])} meetings={len(rows['meetings'])} users={len(views)}")
sys.exit(0)
FIXTURE
cat > /tmp/webvue-meetings/meetings_assert.py <<'ASSERT'
# Piped into `odoo-bin shell` on the upgraded database, running the branch code.
# Every meeting row, grant, group membership and bell row survives with the
# same ids; every user sees exactly what they saw; ownership equals a fresh
# install; producers neither duplicate nor stop working.
import importlib.util
import json
import sys

from odoo import Command
from odoo.exceptions import UserError
from odoo.fields import Domain
from odoo.tools.misc import file_path

from odoo.addons.webvue_meetings.serializers.meeting import dump_meeting, dump_series

SNAPSHOT = f'/tmp/webvue-meetings/upgrade-before-{env.cr.dbname}.json'  # noqa: F821
FRESH = '/tmp/webvue-meetings/fresh-ownership.json'
KEY_RECORDS = (
    'group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage',
    'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
    'ir_cron_webvue_meeting_reminders', 'ir_cron_webvue_meeting_reminders_ir_actions_server',
    'webvue_meeting_minutes_landscape', 'report_meeting_minutes_document_history',
    'model_webvue_meeting_series', 'model_webvue_meeting_event', 'model_webvue_meeting_minutes_version',
)
ROWS = {
    'meetings': 'SELECT id, name, state, company_id, series_id, project_id, meeting_url, minutes_snapshot_data::text, '
                'minutes_snapshot_at::text, minutes_form_data::text FROM cyan_meeting_minute ORDER BY id',
    'resolutions': 'SELECT id, meeting_id, name, state, deadline::text, execution_period, project_id, responsible_id '
                   'FROM cyan_meeting_resolution ORDER BY id',
    'series': 'SELECT id, name, company_id, project_id, organizer_id, secretary_id, recurrence FROM webvue_meeting_series ORDER BY id',
    'series_attendees': 'SELECT series_id, user_id FROM webvue_meeting_series_attendee_rel ORDER BY 1, 2',
    'versions': 'SELECT id, meeting_id, number, snapshot::text FROM webvue_meeting_minutes_version ORDER BY id',
    'events': 'SELECT meeting_id, count(*) FROM webvue_meeting_event GROUP BY meeting_id ORDER BY 1',
    'task_links': 'SELECT id, meeting_id, resolution_id FROM project_task WHERE resolution_id IS NOT NULL ORDER BY id',
    'bell': 'SELECT n.id, n.res_partner_id, n.is_read, m.id, m.webvue_notification_kind, m.webvue_notification_key, '
            'm.model, m.res_id, m.webvue_meeting_id FROM mail_notification n JOIN mail_message m ON m.id = n.mail_message_id '
            'WHERE m.webvue_notification ORDER BY n.id',
    'permissions': "SELECT key, split_part(group_xmlid, '.', 2) FROM webvue_access_permission WHERE key LIKE 'meetings.%' ORDER BY 1",
}
spec = importlib.util.spec_from_file_location(
    'webvue_pmo_pre_hand_meetings', file_path('webvue_pmo/migrations/19.0.1.4.0/pre-hand_meetings_to_webvue_meetings.py'),
)
move = importlib.util.module_from_spec(spec)
spec.loader.exec_module(move)
with open(SNAPSHOT, encoding='utf-8') as handle:
    before = json.load(handle)
with open(FRESH, encoding='utf-8') as handle:
    fresh = json.load(handle)
cr = env.cr  # noqa: F821
problems = []


def bell(user):
    user_env = env(user=user.id)  # noqa: F821
    service, registry = user_env['webvue.notify.service'], user_env['webvue.notify.registry']
    domain = service._webvue_domain()
    return {
        'items': [registry._webvue_notify_dump(row, extra) for row, extra in service._webvue_visible_rows(domain)],
        'total': service._webvue_visible_count(domain),
        'unread_count': service._webvue_visible_count(domain & Domain('is_read', '=', False)),
    }


def seen(user):
    user_env = env(user=user.id)  # noqa: F821
    return json.loads(json.dumps({
        'capabilities': sorted(env['webvue.access.service']._webvue_capability_keys(user)),  # noqa: F821
        'cap_groups': sorted(
            name.split('.', 1)[1] for name in user.all_group_ids.get_external_id().values()
            if '.group_cap_meetings_' in name
        ),
        'meetings': [dump_meeting(meeting, detail=True) for meeting in user_env['cyan.meeting.minute'].search([], order='id')],
        'series': [dump_series(series, detail=True) for series in user_env['webvue.meeting.series'].search([], order='id')],
        'resolutions': user_env['cyan.meeting.resolution'].search([], order='id').ids,
        'bell': bell(user),
    }))


def ownership():
    modules = ('webvue_pmo', 'webvue_meetings', 'webvue_meetings_pmo')
    cr.execute('SELECT module, name, model FROM ir_model_data WHERE module IN %s ORDER BY 1, 2', [modules])
    xmlids = [list(row) for row in cr.fetchall()]
    cr.execute(
        'SELECT c.name, c.type, m.name FROM ir_model_constraint c JOIN ir_module_module m ON m.id = c.module '
        'WHERE m.name IN %s ORDER BY 1, 3',
        [modules],
    )
    constraints = [list(row) for row in cr.fetchall()]
    cr.execute(
        'SELECT r.name, m.name FROM ir_model_relation r JOIN ir_module_module m ON m.id = r.module '
        'WHERE m.name IN %s ORDER BY 1, 2',
        [modules],
    )
    return {'xmlids': xmlids, 'constraints': constraints, 'relations': [list(row) for row in cr.fetchall()]}


# 1. Every row survives with the same ids.
for name, query in ROWS.items():
    cr.execute(query)
    rows = [list(row) for row in cr.fetchall()]
    if rows != before['rows'][name]:
        problems.append(f'{name} rows changed: before={len(before["rows"][name])} after={len(rows)}')
# 2. Every user sees exactly what they saw: capabilities, groups, meetings, series, recommendations, bell.
Users = env['res.users']  # noqa: F821
for login, expected in sorted(before['views'].items()):
    actual = seen(Users.search([('login', '=', login)]))
    for part in sorted(expected):
        if actual[part] != expected[part]:
            problems.append(f'{login}: {part} changed: before={expected[part]} after={actual[part]}')
roles = {
    role.key or role.name_ar: sorted(role.permission_ids.mapped('key'))
    for role in env['webvue.access.role'].search([])  # noqa: F821
}
if roles != before['roles']:
    problems.append(f'role grants changed: before={before["roles"]} after={roles}')
# 3. The key records kept their ids and now belong to webvue_meetings.
cr.execute('SELECT name, module, model, res_id FROM ir_model_data WHERE name = ANY(%s)', [list(KEY_RECORDS)])
owned = {}
for name, module, model, res_id in cr.fetchall():
    owned.setdefault(name, []).append([module, model, res_id])
for name in KEY_RECORDS:
    if owned.get(name) != [['webvue_meetings', *before['records'][name]]]:
        problems.append(f'{name}: before={before["records"][name]} after={owned.get(name)}')
# 4. Ownership equals a fresh install of the branch.
now_owned = ownership()
for module in ('webvue_meetings', 'webvue_meetings_pmo'):
    for part in ('xmlids', 'constraints', 'relations'):
        have = sorted(row for row in now_owned[part] if row[-1 if part != 'xmlids' else 0] == module)
        want = sorted(row for row in fresh[part] if row[-1 if part != 'xmlids' else 0] == module)
        if have != want:
            problems.append(f'{module} {part}: missing={[r for r in want if r not in have]} extra={[r for r in have if r not in want]}')
listed = {*move.MEETINGS_XMLIDS, *move.BRIDGE_XMLIDS, *move.LEFT_TO_ODOO}
stale = sorted(
    row[1] for row in now_owned['xmlids']
    if row[0] == 'webvue_pmo' and row not in fresh['xmlids'] and row[1] in listed
)
if stale:
    problems.append(f'webvue_pmo still owns meeting rows: {stale}')
# 5. Modules, columns, index and rules.
cr.execute("SELECT name, state FROM ir_module_module WHERE name IN ('webvue_meetings', 'webvue_meetings_pmo', 'cyan_meeting_minutes')")
states = dict(cr.fetchall())
if states != {'webvue_meetings': 'installed', 'webvue_meetings_pmo': 'installed', 'cyan_meeting_minutes': 'installed'}:
    problems.append(f'module states {states}')
cr.execute(
    """
        SELECT table_name || '.' || column_name, is_nullable FROM information_schema.columns
         WHERE (table_name, column_name) IN (
            ('cyan_meeting_minute', 'project_id'), ('cyan_meeting_minute', 'series_id'),
            ('cyan_meeting_minute', 'meeting_url'), ('cyan_meeting_minute', 'minutes_form_data'),
            ('cyan_meeting_minute', 'minutes_snapshot_data'), ('cyan_meeting_minute', 'minutes_snapshot_at'),
            ('cyan_meeting_resolution', 'project_id'), ('cyan_meeting_resolution', 'execution_period'),
            ('cyan_meeting_resolution', 'deadline'), ('webvue_meeting_series', 'project_id'),
            ('project_task', 'meeting_id'), ('project_task', 'resolution_id'), ('mail_message', 'webvue_meeting_id'))
    """,
)
columns = dict(cr.fetchall())
if len(columns) != 13 or columns.get('cyan_meeting_resolution.deadline') != 'YES':
    problems.append(f'columns {columns}')
cr.execute("SELECT indexdef FROM pg_indexes WHERE indexname = 'project_task_webvue_resolution_task_unique'")
index = cr.fetchone()
if not index or 'UNIQUE' not in index[0]:
    problems.append(f'unique task index missing: {index}')
cr.execute(
    "SELECT d.name, r.domain_force FROM ir_rule r JOIN ir_model_data d ON d.model = 'ir.rule' AND d.res_id = r.id "
    "WHERE d.module = 'webvue_meetings' AND d.name = ANY(%s)",
    [list(move.RULES)],
)
rules = dict(cr.fetchall())
if len(rules) != len(move.RULES) or move.CLOSED_DOMAIN in rules.values():
    problems.append(f'meeting rules {rules}')
# 6. Producers neither duplicate nor stop working (rolled back below).
Meeting = env['cyan.meeting.minute']  # noqa: F821
count_sql = 'SELECT count(*) FROM mail_notification n JOIN mail_message m ON m.id = n.mail_message_id WHERE m.webvue_notification'
cr.execute(count_sql)
[[bell_rows]] = cr.fetchall()
Meeting._webvue_run_meeting_reminders()
bob = Users.search([('login', '=', 'meet_bob')])
key = f"meeting-invite:{before['hidden_meeting_id']}"
Meeting.browse(before['hidden_meeting_id'])._webvue_notify_partners(bob.partner_id, 'meeting_invite', 'again', key=key)
env.flush_all()  # noqa: F821
cr.execute(count_sql)
if cr.fetchone()[0] != bell_rows:
    problems.append('a reminder, overdue or invite key delivered twice')
mona = Users.browse(before['mona'])
alice = Users.browse(before['alice'])
alice_total = bell(alice)['total']
Meeting.with_user(mona).create({
    'name': 'Post-upgrade invite', 'state': 'draft', 'attendee_ids': [Command.set([alice.id])],
})
env.flush_all()  # noqa: F821
if bell(alice)['total'] != alice_total + 1:
    problems.append('a new meeting did not reach the invitee bell')
try:
    env['cyan.meeting.resolution'].with_user(alice).browse(before['converted_id']).write({'result': 'changed'})  # noqa: F821
    problems.append('a converted recommendation accepted an execution write')
except UserError:
    pass
cr.rollback()

for problem in problems:
    print(f'UPGRADE_PROOF_FAIL {problem}')
print('UPGRADE_PROOF_FAILED' if problems else f"UPGRADE_PROOF_OK bell={len(before['rows']['bell'])} users={len(before['views'])}")
sys.exit(1 if problems else 0)
ASSERT
python3 -m py_compile /tmp/webvue-meetings/ownership_dump.py /tmp/webvue-meetings/meetings_fixture.py /tmp/webvue-meetings/meetings_assert.py && echo "scripts compile"
```

Expected: `scripts compile`.

- [ ] **Step 2: Dump the ownership of a fresh install of the branch**

```bash
/tmp/webvue-meetings/odoo-run.sh base webvue_scratch_meetings_fresh /Users/tariq/code/nasq-meetings \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_fresh /Users/tariq/code/nasq-meetings \
  < /tmp/webvue-meetings/ownership_dump.py | tee /tmp/webvue-meetings/logs/fresh-ownership.log
grep -q OWNERSHIP_DUMP_OK /tmp/webvue-meetings/logs/fresh-ownership.log && echo "fresh ownership recorded"
/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_fresh
```

Expected: `ODOO_RUN_BASE_OK`, `OWNERSHIP_DUMP_OK xmlids=… constraints=… relations=1`, `fresh ownership recorded`.

- [ ] **Step 3: Upgrade from the current main (no `-i`: webvue_pmo's migration installs the two addons)**

```bash
git worktree add --detach /tmp/webvue-meetings/base-main "$(git merge-base HEAD main)"
git -C /tmp/webvue-meetings/base-main log -1 --oneline
/tmp/webvue-meetings/odoo-run.sh base webvue_scratch_meetings_up_main /tmp/webvue-meetings/base-main \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_up_main /tmp/webvue-meetings/base-main \
  < /tmp/webvue-meetings/meetings_fixture.py | tee /tmp/webvue-meetings/logs/up-main-fixture.log
grep -q UPGRADE_FIXTURE_OK /tmp/webvue-meetings/logs/up-main-fixture.log && echo "fixture ok"
/tmp/webvue-meetings/odoo-run.sh upgrade webvue_scratch_meetings_up_main \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat
grep -n "pre-hand_meetings_to_webvue_meetings\|Loading module webvue_meetings \|Loading module webvue_meetings_pmo " \
  /tmp/webvue-meetings/logs/webvue_scratch_meetings_up_main-upgrade.log
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_up_main /Users/tariq/code/nasq-meetings \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/webvue-meetings/logs/up-main-smoke.log
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_up_main /Users/tariq/code/nasq-meetings \
  < /tmp/webvue-meetings/meetings_assert.py | tee /tmp/webvue-meetings/logs/up-main-assert.log
grep -q UPGRADE_PROOF_OK /tmp/webvue-meetings/logs/up-main-assert.log && echo "upgrade from main ok"
```

Expected: the merge-base commit (`b959e5cc` unless `main` moved); `ODOO_RUN_BASE_OK`; `UPGRADE_FIXTURE_OK bell=N meetings=6 users=4`; `fixture ok`; `ODOO_RUN_UPGRADE_OK` (no `ERROR`/`CRITICAL` and no not-null warning in the log); the `grep -n` shows the `pre-hand_meetings_to_webvue_meetings` line **before** the `Loading module webvue_meetings` and `Loading module webvue_meetings_pmo` lines (the migration flipped them); `UPGRADE_SMOKE_OK installed=10`; `UPGRADE_PROOF_OK bell=N users=4`; `upgrade from main ok`. Any `UPGRADE_FIXTURE_FAIL` or `UPGRADE_PROOF_FAIL` is a blocker: stop and report it with the log.

- [ ] **Step 4: Upgrade from release/19.0.1.0.0 with `-i`, as CI does (webvue_meetings loads first)**

```bash
git worktree add --detach /tmp/webvue-meetings/base-release release/19.0.1.0.0
git -C /tmp/webvue-meetings/base-release log -1 --oneline
/tmp/webvue-meetings/odoo-run.sh base webvue_scratch_meetings_up_release /tmp/webvue-meetings/base-release \
  webvue_core,webvue_api,webvue_pmo,webvue_hr,webvue_chat
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_up_release /tmp/webvue-meetings/base-release \
  < /tmp/webvue-meetings/meetings_fixture.py | tee /tmp/webvue-meetings/logs/up-release-fixture.log
grep -q UPGRADE_FIXTURE_OK /tmp/webvue-meetings/logs/up-release-fixture.log && echo "fixture ok"
/tmp/webvue-meetings/odoo-run.sh upgrade webvue_scratch_meetings_up_release \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat
grep -n "pre-move_app_xmlids\|pre-hand_bell_columns_to_webvue_notify\|pre-hand_meetings_to_webvue_meetings\|Loading module webvue_meetings \|Loading module webvue_pmo " \
  /tmp/webvue-meetings/logs/webvue_scratch_meetings_up_release-upgrade.log
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_up_release /Users/tariq/code/nasq-meetings \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/webvue-meetings/logs/up-release-smoke.log
/tmp/webvue-meetings/odoo-run.sh shell webvue_scratch_meetings_up_release /Users/tariq/code/nasq-meetings \
  < /tmp/webvue-meetings/meetings_assert.py | tee /tmp/webvue-meetings/logs/up-release-assert.log
grep -q UPGRADE_PROOF_OK /tmp/webvue-meetings/logs/up-release-assert.log && echo "upgrade from release ok"
```

Expected: `f9b961b5` for the tag (no `webvue_platform` there, so the base install is unclassified, as in CI); `ODOO_RUN_BASE_OK`; `UPGRADE_FIXTURE_OK`; `fixture ok`; `ODOO_RUN_UPGRADE_OK`; the `grep -n` shows `pre-move_app_xmlids` first, then `Loading module webvue_meetings` **before** `Loading module webvue_pmo` and before `pre-hand_meetings_to_webvue_meetings` (the `pre_init_hook` path), and `pre-hand_bell_columns_to_webvue_notify`; `UPGRADE_SMOKE_OK installed=10`; `UPGRADE_PROOF_OK`; `upgrade from release ok`.

If only the release path reports `UPGRADE_PROOF_FAIL … changed` for a payload part, decide whether the difference predates this branch: re-run Step 4 with a third detached worktree of the merge-base as the *target* (copy the runner to `/tmp/webvue-meetings/odoo-run-base.sh`, set its `WORKTREE` to that worktree, and use the 2b-1 assertion approach: run the fixture before and the same `seen()` after). A difference that also appears there is pre-existing: report it with both diffs. A difference that appears only with this branch is a blocker.

- [ ] **Step 5: Clean up**

```bash
/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_up_main
/tmp/webvue-meetings/odoo-run.sh drop webvue_scratch_meetings_up_release
git worktree remove /tmp/webvue-meetings/base-main
git worktree remove /tmp/webvue-meetings/base-release
git worktree list
```

Expected: both base worktrees are gone; the main checkout and `/Users/tariq/code/nasq-meetings` remain. Keep the logs for the report.

---

### Task 10: API surface, final gates, documentation and roadmap

**Files:**
- Create (outside the repo): `/tmp/webvue-meetings/openapi_compare.py`
- Modify: `docs/api/openapi.json` (regenerated)
- Modify: `CLAUDE.md` (repository layout, sudo policy, check commands), `AGENTS.md` (versions and dependencies), `README.md`, `docs/parallel-work.md`, `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`

The `## Architecture rules (R1–R10)` block of `CLAUDE.md` and `AGENTS.md` is not touched, so the two copies stay identical.

- [ ] **Step 1: Compare the API surface under ruling H.8**

```bash
cat > /tmp/webvue-meetings/openapi_compare.py <<'COMPARE'
"""Compare two generated openapi.json documents under ruling H.8 (plan 2b-2, Deviation 9)."""
import copy
import json
import sys

PREFIXES = ('/api/v1/meetings', '/api/v1/meeting-series')
CONVERT = ('post', '/api/v1/meetings/{meeting_id}/resolutions/{resolution_id}/convert')
ALLOWED = ('addon', 'controller', 'contract_namespace', 'feature_keys')


def operations(doc):
    return {(method, path): op for path, item in doc['paths'].items() for method, op in item.items()}


def normalized(op):
    op = copy.deepcopy(op)
    for name in ALLOWED:
        op['x-webvue'].pop(name, None)
    op.pop('tags', None)
    op.pop('operationId', None)
    return op


with open(sys.argv[1], encoding='utf-8') as handle:
    before = json.load(handle)
with open(sys.argv[2], encoding='utf-8') as handle:
    after = json.load(handle)
problems = []
old, new = operations(before), operations(after)
if set(old) != set(new):
    problems.append(f'operations differ: removed={sorted(set(old) - set(new))} added={sorted(set(new) - set(old))}')
expected = {
    key: ('webvue_meetings_pmo' if key == CONVERT else 'webvue_meetings')
    for key, op in old.items()
    if op['x-webvue']['addon'] == 'webvue_pmo' and key[1].startswith(PREFIXES)
}
changed = {}
for key in sorted(set(old) & set(new)):
    if old[key] == new[key]:
        continue
    changed[key] = new[key]['x-webvue']['addon']
    if normalized(old[key]) != normalized(new[key]):
        problems.append(f'{key}: differs outside x-webvue {ALLOWED}, tags and operationId')
    if old[key]['x-webvue']['feature_keys'] != new[key]['x-webvue']['feature_keys']:
        problems.append(f'{key}: feature keys changed')
if changed != expected:
    problems.append(f'changed {sorted(changed.items())} != expected {sorted(expected.items())}')
print(f'convert: controller {old[CONVERT]["x-webvue"]["controller"]} -> {new[CONVERT]["x-webvue"]["controller"]}')
if {k: v for k, v in before.items() if k not in ('paths', 'tags')} != {k: v for k, v in after.items() if k not in ('paths', 'tags')}:
    problems.append('components, info or servers differ')
if after['tags'] != sorted({*before['tags'], 'webvue_meetings', 'webvue_meetings_pmo'}):
    problems.append(f'tags {after["tags"]}')
for problem in problems:
    print(f'API_SURFACE_FAIL {problem}')
print('API_SURFACE_FAILED' if problems else f'API_SURFACE_OK operations={len(new)} moved={len(changed)}')
sys.exit(1 if problems else 0)
COMPARE
python3 -B tools/api_surface.py
python3 /tmp/webvue-meetings/openapi_compare.py /tmp/webvue-meetings/openapi-before.json docs/api/openapi.json
```

Expected: `convert: controller MeetingController -> MeetingResolutionConvertController` and `API_SURFACE_OK operations=… moved=26`. Any `API_SURFACE_FAIL` is a blocker. Keep the regenerated `docs/api/openapi.json` (it also absorbs any staleness already on `main`).

- [ ] **Step 2: Commit the regenerated document**

```bash
python3 -B tools/api_surface.py --check
git add docs/api/openapi.json
git commit -m "docs(docs): regenerate openapi.json after the meetings split" -m "<TRAILER>"
```

Expected: `openapi.json is up to date`.

- [ ] **Step 3: Update CLAUDE.md**

Replace:

```markdown
- `odoo-addons/webvue_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, and its notification kinds,
  producers and `/api/v1/notification-digests`.
```

with:

```markdown
- `odoo-addons/webvue_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, its task and digest notification
  kinds, producers and `/api/v1/notification-digests`, and the eight `pmo.*`
  capabilities, their groups and the `pmo_manager` role. It does not depend on
  the meeting engine.
```

Replace:

```markdown
- `odoo-addons/cyan_meeting_minutes` provides the preserved LGPL meeting engine.
  WebVue meeting routes, serializers, task conversion and recipient notifications
  extend it through `webvue_pmo`, which also owns the eight `pmo.*` and three
  `meetings.*` capabilities, their groups, the `pmo_manager` role and the meeting
  record rules until `webvue_meetings` exists (spec 3.2.1).
```

with:

```markdown
- `odoo-addons/cyan_meeting_minutes` provides the preserved LGPL meeting engine.
- `odoo-addons/webvue_meetings` (application, rank 4) extends it: the meeting,
  series, minutes and recommendation routes (`/api/v1/meetings`,
  `/api/v1/meeting-series`), their serializers, the seven meeting notification
  kinds, `meetings.enabled`, the three `meetings.*` capabilities, their groups
  and the meeting record rules. It knows no other application: links to other
  records go through the `webvue.meeting.links` hooks, which answer "no project,
  no linked task" by default.
- `odoo-addons/webvue_meetings_pmo` (bridge, rank 5, `auto_install`) is installed
  whenever `webvue_meetings` and `webvue_pmo` both are. It owns the `project_id`
  columns of meetings, series and recommendations, the task origin columns and
  their unique index, recommendation-to-task conversion and its route, and the
  project/task implementation of `webvue.meeting.links`.
```

Replace:

```markdown
  `webvue_notify` uses it only for bell delivery and recipient-owned bell reads.
  Do not add another case without documenting it and fixing ACLs/rules where
  possible.
```

with:

```markdown
  `webvue_notify` uses it only for bell delivery and recipient-owned bell reads.
  `webvue_meetings` uses it only for its server-controlled minutes, snapshot,
  version and event records, the company-wide organizer-overlap check, the
  meeting-manager group lookup and the recipient-owned bell candidates;
  `webvue_meetings_pmo` only for the id-only lookup of converted tasks. Do not add
  another case without documenting it and fixing ACLs/rules where possible.
```

Replace in the check-commands block:

```
  -i webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  --test-tags /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat \
```

with:

```
  -i webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat \
  --test-tags /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat \
```

- [ ] **Step 4: Update AGENTS.md, README.md and docs/parallel-work.md**

In `AGENTS.md` replace:

```markdown
  `19.0.X.Y.Z` (core/HR `19.0.1.0.0`, PMO `19.0.1.3.0`). Follow
```

with:

```markdown
  `19.0.X.Y.Z` (core/HR/meetings `19.0.1.0.0`, PMO `19.0.1.4.0`). Follow
```

and replace:

```markdown
  `webvue_directory` (`webvue_api`) know no application; PMO also uses
  `webvue_platform`, `webvue_notify`, `webvue_directory`, `project`, `bus`,
  `cyan_meeting_minutes` (see manifests). Preserve pillar direction: shared
  `webvue_api` and the shared services never import a pillar.
```

with:

```markdown
  `webvue_directory` (`webvue_api`) know no application; PMO also uses
  `webvue_platform`, `webvue_notify`, `webvue_directory`, `project`, `bus`; meetings
  use `webvue_platform`, `webvue_notify`, `webvue_directory`, `cyan_meeting_minutes`,
  `calendar`, `mail`; the bridge `webvue_meetings_pmo` (`auto_install`) uses
  `webvue_meetings` and `webvue_pmo` (see manifests). Preserve pillar direction:
  shared `webvue_api` and the shared services never import a pillar, and one
  application never imports another; only a bridge imports both.
```

In `README.md` replace:

```markdown
  application; `webvue_pmo` owns projects/tasks; `webvue_hr` owns HR routes,
  documents, and employee directory behavior.
```

with:

```markdown
  application; `webvue_pmo` owns projects/tasks; `webvue_meetings` owns meetings,
  series and minutes, and the bridge `webvue_meetings_pmo` links them to projects
  and tasks; `webvue_hr` owns HR routes, documents, and employee directory
  behavior.
```

In `docs/parallel-work.md` replace:

```markdown
| Odoo addon | `webvue_api`, `webvue_notify`, `webvue_directory`, plus `webvue_core` system/access groups and branding; each app owns its capability groups | `webvue_pmo` | `webvue_hr` |
| Controllers and serializers | `webvue_api` common/auth/branding/me/attachment, `webvue_notify` bell routes, `webvue_directory` people route | `webvue_pmo/**` | `webvue_hr/**` |
| Tests | shared fixture, `webvue_api`, `webvue_notify` and `webvue_directory` tests | `webvue_pmo/tests/**` | `webvue_hr/tests/**` |
```

with:

```markdown
| Odoo addon | `webvue_api`, `webvue_notify`, `webvue_directory`, plus `webvue_core` system/access groups and branding; each app owns its capability groups | `webvue_pmo`; meetings `webvue_meetings`; bridge `webvue_meetings_pmo` | `webvue_hr` |
| Controllers and serializers | `webvue_api` common/auth/branding/me/attachment, `webvue_notify` bell routes, `webvue_directory` people route | `webvue_pmo/**`, `webvue_meetings/**`, `webvue_meetings_pmo/**` | `webvue_hr/**` |
| Tests | shared fixture, `webvue_api`, `webvue_notify` and `webvue_directory` tests | `webvue_pmo/tests/**`, `webvue_meetings/tests/**`, `webvue_meetings_pmo/tests/**` | `webvue_hr/tests/**` |
```

- [ ] **Step 5: Update the roadmap**

In `docs/superpowers/plans/2026-10-05-architecture-roadmap.md` replace:

```markdown
**آخر تحديث:** 2026-10-06، عند `350e7eb1` على `main`، مع فرع المرحلة 2ب-1.
```

with:

```markdown
**آخر تحديث:** 2026-10-07، عند `b959e5cc` على `main`، مع فرع المرحلة 2ب-2.
```

replace:

```markdown
| 2ب | فصل الخدمات والاجتماعات | `webvue_pmo` = مشاريع ومهام فقط | 2 | 2ب-1 منفذة على `codex/api-notify-directory`، بانتظار الدمج؛ 2ب-2 لم تبدأ |
```

with:

```markdown
| 2ب | فصل الخدمات والاجتماعات | `webvue_pmo` = مشاريع ومهام فقط | 2 | 2ب-1 **مدموجة** (`b959e5cc`)؛ 2ب-2 منفذة على `codex/pmo-meetings-split`، بانتظار الدمج |
```

replace:

```markdown
([الخطة](2026-10-06-phase-2b1-notify-directory.md))؛ 2ب-2 = `webvue_meetings` والجسر `webvue_meetings_pmo`، تُكتب خطتها
بعد دمج 2ب-1.
```

with:

```markdown
([الخطة](2026-10-06-phase-2b1-notify-directory.md))؛ 2ب-2 = `webvue_meetings` والجسر `webvue_meetings_pmo`
([الخطة](2026-10-07-phase-2b2-meetings.md)).
```

replace:

```markdown
**خط الأساس بعد 2ب-1** (المجموع): R7 85، R9 68، R10 0؛ الباقي كما بعد المرحلة 2.
```

with:

```markdown
**خط الأساس بعد 2ب-1** (المجموع): R7 85، R9 68، R10 0؛ الباقي كما بعد المرحلة 2.

**خط الأساس بعد 2ب-2** (المجموع): R2 4، R7 83، R9 68، R10 0؛ الباقي كما بعد 2ب-1. انخفض R2 لأن منح الميزات
الأولية صارت تُشتق من سجل الميزات، وانخفض R7 لأن البحث عن المهام المحوّلة صار في دالة جسر واحدة.
```

and replace:

```markdown
**تنبيه للاختبارات:** `TestAppXmlidMigration` و`test_pmo_links_reach_core_groups` تثبّتان صفوف الاجتماعات تحت `webvue_pmo`، ويجب تحديثهما عند انتقال الاجتماعات إلى `webvue_meetings`.
```

with:

```markdown
**الاختبارات:** `TestAppXmlidMigration` تقرأ صفوف الاجتماعات تحت مالكها الحالي `webvue_meetings` دون تعديل ترحيل المرحلة 2،
و`test_pmo_links_reach_core_groups` لم تعد تذكر الاجتماعات؛ صار لها مقابل في `webvue_meetings`.
```

- [ ] **Step 6: Run the final gates**

```bash
ruff check odoo-addons
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/catalog_check.py
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
rg -n "odoo\.addons\.webvue_pmo" odoo-addons/webvue_meetings odoo-addons/webvue_notify odoo-addons/webvue_directory odoo-addons/webvue_hr odoo-addons/webvue_chat
rg -n "odoo\.addons\.webvue_meetings" odoo-addons/webvue_pmo odoo-addons/webvue_notify odoo-addons/webvue_directory
rg -n "cyan_meeting_minutes" odoo-addons/webvue_pmo || echo "webvue_pmo knows no meeting engine"
rg -n "webvue_pmo|webvue_hr|webvue_chat|webvue_meetings" odoo-addons/webvue_platform/models || echo "platform names no application"
diff <(sed -n '/^## Architecture rules (R1–R10)/,/^## /p' CLAUDE.md) <(sed -n '/^## Architecture rules (R1–R10)/,/^## /p' AGENTS.md) && echo "R1-R10 blocks identical"
npm test 2>&1 | tail -n 15
npm -w apps/web run lint 2>&1 | tail -n 5
npm -w packages/commercial-contracts run test 2>&1 | tail -n 5
```

Expected: `All checks passed!`; three `exit=0`; `CATALOG_OK solutions=2`; deploy suite `OK`; the two cross-import searches print nothing; `webvue_pmo knows no meeting engine`; `platform names no application`; `R1-R10 blocks identical` (if the two files format that block differently on `main` already, compare the result with `main`'s and report — this plan does not edit it); `npm test`, the type check and the commercial suite green.

Then run the four install proofs once more in the background, one after the other:

```bash
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_final \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_final_hr \
  webvue_core,webvue_platform,webvue_api,webvue_hr \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_hr
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_final_meetings \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_meetings \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_meetings
/tmp/webvue-meetings/odoo-run.sh test webvue_scratch_meetings_final_pmo \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_hr,/webvue_chat
```

Expected: four `ODOO_RUN_TEST_OK` lines with the probes of Task 6 Step 11 (`…,project` for the full run; empty; `cyan_meeting_minutes,webvue_meetings`; `webvue_pmo,project`). Record the four test counts.

- [ ] **Step 7: Commit the documentation**

```bash
git add CLAUDE.md AGENTS.md README.md docs/parallel-work.md docs/superpowers/plans/2026-10-05-architecture-roadmap.md
git commit -m "docs(docs): record webvue_meetings and webvue_meetings_pmo ownership" -m "<TRAILER>"
git log --format='%h %s' main..HEAD
git log --format=%B -n 1
git status --short
```

Expected: eleven commits on the branch (plan, Tasks 1-8, `openapi.json`, docs), each subject `type(scope): subject` of at most 72 characters with the trailer in its body (the last command shows a body ending with the trailer line), and a clean status.

- [ ] **Step 8: Report**

Report to the orchestrator: the base commit; the eleven commit hashes and subjects; the arch totals before (Task 0 Step 5) and after (`R2 4`, `R7 83`, the rest unchanged); the `API_SURFACE_OK` line and the convert controller change; the Odoo test counts of Task 0 and of the four final runs with their `INSTALLED_PROBE` lines; the two `UPGRADE_PROOF_OK` lines and the two `grep -n` orderings of Task 9 (migration-first from `main`, hook-first from the release); whether the live control-plane suite ran (Task 6 Step 10); any latent shared-test assumption fixed in Task 6 Step 11; the untracked copy of this plan in the main checkout that must be removed before the merge. Do not merge or push.
