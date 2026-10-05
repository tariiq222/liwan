# Phase 2: Decouple nasq_core from the Applications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `nasq_core` depends on `base` only: every HR, PMO and meetings capability, group, role, record rule and access row moves into `nasq_hr` or `nasq_pmo`, the project usage counter moves from `nasq_platform` to `nasq_pmo`, and the API, the 28 capability keys and every existing role grant and group membership stay exactly as they are.

**Architecture:** `nasq.access.service` gets compose-through-`super()` hooks (catalog, dependencies, built-in role grants, legacy group keys, record company, contextual grant, `/me` extras, customer-actor keys, legacy admin roles). `nasq_core` keeps only its own nine keys; `nasq_hr` and `nasq_pmo` extend the hooks and ship their own groups, permission records, role and rules. Built-in roles are `noupdate` records, so a superuser-only repair hook links app grants on install and on every upgrade. A `pre-` migration in `nasq_core` 19.0.1.1.0 renames the moved `ir_model_data` rows to their new module, so upgraded databases keep every record id.

**Tech Stack:** Odoo 19 Community (`/Users/tariq/code/odoo`, read-only), Python 3, PostgreSQL scratch databases, `tools/arch_policy.py`, `tools/git_policy.py`, `tools/api_surface.py`, `tools/migration_guard.py`.

**Spec:** `docs/superpowers/specs/2026-10-05-nasq-reference-architecture-and-git-workflow-design.md`, sections 2, 2.1 and 3.2 (binding). Roadmap entry: `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, "المرحلة 2". Read both before starting.

## Deviations from rulings

No ruling (R-A to R-H) is impossible against the source. The items below are additions or interpretations; they are listed so the reviewer can reject them explicitly.

1. **R-A, extended.** The `pre-` migration also rewrites `nasq_access_permission.group_xmlid` from `nasq_core.group_cap_*` to the new module for every moved group. Reason: during an upgrade `nasq_core` loads before `nasq_hr`/`nasq_pmo`; between the two, `res.users._nasq_sync_capability_groups()` resolves `group_xmlid` with `env.ref`, and a stale string would stop resolving. `nasq_hr` (19.0.1.0.0 → 19.0.1.1.0) and `nasq_pmo` (19.0.1.1.0 → 19.0.1.2.0) also bump their versions with a `README.md` migration, because each now ships a `noupdate` role record (docs/migrations.md).
2. **R-C, `_nasq_legacy_admin_roles()`.** The hook is composed as ruled, but `_nasq_apply_legacy_admin_snapshot` runs from `nasq_core`'s post data, before any application loads, so on a database that never finished the v1 access migration it would grant `system_admin` only. Every database installed from `release/19.0.1.0.0` already has `nasq_core.access_migration_v1_done = '1'` (the install sets it), so no database is affected. The plan does not add a second, later migration run.
3. **R-C, fresh installs.** `data/access_roles_org_admin.xml` is deleted. It existed only to give `system_admin` and `vendor_support` their meeting grants on fresh installs; `_nasq_repair_builtin_role_grants()` now does that on install and on upgrade. The duplicate `dependency_ids` stubs in `data/access_permissions.xml` are deleted too; `_nasq_configure_permission_dependencies()` writes the composed map and is the single source.
4. **R-F, hook name.** The counter hook is `nasq.entitlement.service._nasq_count_usage(limit_key)`: `nasq_platform` counts `users.limit` and returns 0 for unknown keys, `nasq_pmo` adds `projects.max_projects`. `_nasq_count_projects` and `_nasq_claim_projects` move to `nasq_pmo` unchanged. `tools/shared_saas_lifecycle/subscription_effect.py:127` (not in the inventory) calls `_nasq_count_projects()` on any database and switches to `_nasq_count_usage('projects.max_projects')`, so it still reports 0 when `nasq_pmo` is absent.
5. **R-E, where app assertions go.** The pre-split assertions from `nasq_core/tests` that name app keys, app groups or Odoo app groups move into one new post_install test, `nasq_api/tests/test_access_composition.py`, written in Task 1 so it guards Tasks 2–8. It identifies records by key or by `group_xmlid`, never by the moving xml ids, so it passes before and after each move.

**Inventory corrections found while reading the source:**

- `odoo-addons/nasq_core/models/access_service.py` line 1 is `import json`; the Odoo header is line 3. Task 1 puts the header first (CLAUDE.md rule).
- `group_vendor_support` implies `group_cap_meetings_manage` but not `group_cap_meetings_read`/`_create`; the composition test pins exactly that set.
- The `admin` user reaches `nasq_core.group_employee` only through `group_hr_manager`/`group_pmo_manager`, so `core/tests/test_groups.py:44` cannot stay in an `at_install` core test once core loads alone.
- Once `nasq_core` depends on `base` only, it loads right after `base`; its `at_install` tests then run before `mail`, `project` and `hr` exist. Every core test is rewritten in Task 1 to name no app record.
- `odoo-addons/nasq_hr/security/hr_people_rules.xml` is not in the `nasq_hr` manifest and is not loaded; no change.
- `docs/api/openapi.json` is already stale on `main` (`python3 -B tools/api_surface.py --check` exits 1 before any change). The API check therefore compares the generated document before and after, not `--check`.
- Odoo reflects `_inherit` models under the inheriting module, so the release database may hold `nasq_core.model_cyan_meeting_minute`, `nasq_core.model_cyan_meeting_resolution` and `nasq_core.model_calendar_event`. After `meeting_access.py` leaves core, `_process_end` drops only those extra xml ids (the models keep their own). The upgrade proof therefore snapshots only `res.groups`, `nasq.access.permission`, `nasq.access.role`, `ir.rule` and `ir.model.access` rows.

## Global Constraints

- No API surface change: the document generated by `python3 -B tools/api_surface.py` is byte-identical before and after (Task 0 Step 6, Task 8 Step 2). No controller, serializer or contract changes.
- The 28 capability keys are unchanged: 9 `access.*`/`settings.*`, 8 `hr.*`, 8 `pmo.*`, 3 `meetings.*`. With all six addons installed, `_nasq_capability_map()` and `nasq.access.permission` each hold exactly those 28 keys.
- `nasq_core` keeps the 9 system capabilities, the roles `employee`, `system_admin`, `vendor_support`, the access service, audit and identity protection (spec 3.2). `nasq.access.permission.domain` selection values and `project_contextual` stay in core unchanged (ruling R-D).
- No edit under `apps/` except the four e2e fixtures `apps/web/e2e/fixtures/charter-flow.py`, `projects-phase2.py`, `project-dashboard.py`, `project-charts.py`. `nasq_chat` is not edited. `packages/` is not edited.
- Never run anything against the `odoo19` database. Every scratch database is named `nasq_core_decouple_*`; `/tmp/nasq-core-decouple/odoo-run.sh` refuses any other name. Never point Odoo at a config whose `data_dir` or `logfile` is inside `/Users/tariq/code/odoo`.
- No new `sudo()` and no new SQL on Odoo tables: the R7 and R9 totals in `tools/arch_baseline.json` must not rise. Moved code keeps its existing `sudo()`/SQL (the per-file counts move with it; totals stay equal).
- Every new Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.` Manifests keep `'license': 'LGPL-3'` and `'author': 'Tariq Alwalidi'`.
- Versions follow docs/migrations.md: `nasq_core` 19.0.1.0.0 → 19.0.1.1.0 with `migrations/19.0.1.1.0/pre-move_app_xmlids.py`; `nasq_hr` 19.0.1.0.0 → 19.0.1.1.0 and `nasq_pmo` 19.0.1.1.0 → 19.0.1.2.0, each with `migrations/<version>/README.md`. `nasq_platform`, `nasq_api`, `nasq_chat` keep their versions. The migration file is not released until the branch is tagged, so Task 3 may still extend it.
- `tools/arch_baseline.json` is only written by `python3 -B tools/arch_policy.py --write-baseline`, never by hand. Every commit leaves `python3 -B tools/arch_policy.py` at exit 0.
- Work only in the worktree `/Users/tariq/code/nasq-core-decouple` on branch `codex/core-decouple-apps`. Do not touch the main checkout's uncommitted owner changes (`.gitignore`, `docs/WORKSPACE.md`, `package.json`, `package-lock.json`, untracked `.agents/`, `.planning/`, `docs/e2e.md`, `e2e.config.ts`, `e2e/`, `plans/`).
- Commit subjects are `type(scope): subject`, at most 72 characters, scope from `core platform api pmo hr chat web cp deploy tools docs ci`. End each commit message with the attribution line your session specifies. Do not merge, push, delete branches or change Git config. Do not upgrade any persistent database at an intermediate commit: the migration is complete only at Task 3, and the upgrade is proven in Task 7.
- A full six-addon Odoo run takes 10–25 minutes. Start it with `run_in_background` and wait on the log; never shorten a run by dropping modules from `-i`.

## Review Focus

- **An upgraded database silently loses a user's group or a role grant** (a moved `res.groups` or `nasq.access.permission` row is deleted by `_process_end` and recreated with a new id). Expected: every moved row keeps model, `res_id` and `noupdate`; every user keeps `group_ids`, role assignments and capability keys; every role keeps its permission ids. Pinned by `TestAppXmlidMigration` (Task 2, extended in Task 3) and the release-tag upgrade proof `upgrade_assert.py` (Task 7).
- **A capability key is emitted twice during the switch** (core still defines `hr.*` while `nasq_hr` starts to). Expected: never happens on any commit; `_nasq_capability_map()` raises `duplicate_or_invalid_capability` if it does. Pinned by `TestAccessComposition.test_catalog_is_the_same_28_keys_each_owned_by_one_addon` (Task 1, runs in every later task) and each app's ownership test (Tasks 2, 3).
- **A built-in role is created twice** (`UNIQUE(key)` failure when `nasq_hr.role_hr_manager` is created next to an unrenamed `nasq_core.role_hr_manager`). Expected: one role per key, owned by the app's xml id, and the migration stops before renaming anything when both xml ids exist. Pinned by `test_hr_manager_role_is_unique_and_owned_by_nasq_hr` (Task 2), `test_pmo_manager_role_is_unique_and_core_roles_get_pmo_grants` (Task 3) and `test_a_duplicate_row_stops_the_upgrade_before_any_rename` (Task 2).
- **An `at_install` test depends on an application** (core tests run right after `base` once the dependency goes). Expected: core tests name no app key, group or model; HR and PMO composition tests run `at_install` and pass without the other app. Pinned by the Task 1 core test rewrite, `TestHrAccessComposition`/`TestPmoAccessComposition` being `at_install`, and the two installs in Task 5 (`nasq_core` alone; `nasq_core,nasq_platform,nasq_api,nasq_hr` without `project`).
- **A capability check silently returns False because an app hook is not composed** (project owner loses `pmo.tasks.approve`, a milestone's company is no longer checked, a legacy HR manager loses `hr.*`). Expected: identical answers to the pre-split code. Pinned by `test_project_owner_grant_needs_the_pmo_hook` and `test_record_without_company_uses_its_project_company` (Task 3), `TestAccessComposition.test_legacy_groups_still_map_to_the_same_keys` and `test_actor_keys_and_legacy_admin_roles_are_composed` (Task 1).

## File Structure

| File | Responsibility |
|---|---|
| `odoo-addons/nasq_core/models/access_service.py` (modify) | Core keys only; the composition hooks and their core defaults; generic repair and dependency writers |
| `odoo-addons/nasq_core/models/res_users.py` (modify) | Customer-actor check reads `_nasq_customer_actor_keys()` |
| `odoo-addons/nasq_core/models/meeting_access.py` → `odoo-addons/nasq_pmo/models/meeting_access.py` (move) | Meeting capability checks on Cyan models (unchanged code) |
| `odoo-addons/nasq_core/security/meeting_access.xml` → `odoo-addons/nasq_pmo/security/meeting_access.xml` (move) | Global meeting record rules (unchanged) |
| `odoo-addons/nasq_core/security/nasq_access_groups.xml`, `nasq_core_security.xml`, `nasq_access_rules.xml`, `ir.model.access.csv` (modify) | Core groups, rules and access rows only |
| `odoo-addons/nasq_core/data/access_permissions.xml`, `access_roles.xml`, `access_migration_post.xml` (modify); `access_roles_org_admin.xml` (delete) | Core permission records and core built-in roles |
| `odoo-addons/nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py` (create) | Rename moved `ir_model_data` rows and `group_xmlid` strings |
| `odoo-addons/nasq_core/__manifest__.py` (modify) | `depends: ['base']`, version 19.0.1.1.0 |
| `odoo-addons/nasq_core/tests/*` (modify/create) | App-free core tests; migration test |
| `odoo-addons/nasq_hr/models/access_service.py` (modify) | HR hooks and `_nasq_disable_linked_user_from_hr` |
| `odoo-addons/nasq_hr/security/hr_capability_groups.xml`, `ir.model.access.csv` (modify); `data/hr_access_permissions.xml` (create) | HR groups, access rows, permissions and `hr_manager` role |
| `odoo-addons/nasq_pmo/models/access_service.py`, `entitlement_service.py` (create) | PMO and meeting hooks; project usage counter |
| `odoo-addons/nasq_pmo/security/pmo_capability_groups.xml` (create), `data/pmo_access_permissions.xml` (create), `security/ir.model.access*.csv` (modify) | PMO and meeting groups, permissions, `pmo_manager` role |
| `odoo-addons/nasq_platform/models/entitlement_service.py` (modify) | Generic `_nasq_count_usage`; no project knowledge |
| `odoo-addons/nasq_api/tests/test_access_composition.py` (create) | The 28-key, role, group and dependency invariants with all apps installed |
| `deploy/control-plane-outage/bootstrap.py`, `tools/shared_acceptance_live/seed_tenant.py` and README, `tools/shared_saas_lifecycle/odoo_effect.py` and its test, `tools/shared_saas_lifecycle/subscription_effect.py`, four e2e fixtures (modify) | Use the moved role xml ids and the usage hook |
| `tools/arch_baseline.json` (regenerated) | R1 empty, R2 lower |
| `CLAUDE.md`, `README.md`, roadmap (modify) | Ownership text and phase status |

---

### Task 0: Worktree, scratch runner and baselines

**Files:**
- Create (outside the repo): `/tmp/nasq-core-decouple/odoo-run.sh`, `/tmp/nasq-core-decouple/scratch-only.conf`
- Create: `docs/superpowers/plans/2026-10-05-phase-2-decouple-nasq-core.md` (copy of this plan)

**Interfaces:**
- Produces: `/tmp/nasq-core-decouple/odoo-run.sh test|install|baseline|upgrade|shell|drop` used by every later task; `/tmp/nasq-core-decouple/openapi-base.json`; the baseline test result in `/tmp/nasq-core-decouple/logs/nasq_core_decouple_base.log`.

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/tariq/code/nasq
git fetch origin
git rev-parse main origin/main
git worktree add -b codex/core-decouple-apps /Users/tariq/code/nasq-core-decouple main
cd /Users/tariq/code/nasq-core-decouple
git status --short
git log -1 --oneline
npm ci --ignore-scripts
```

Expected: empty status; `main` at `7eb4dc85` or later (note the actual commit in your report). If `main` and `origin/main` differ, continue from local `main` and report it. Run every later command from `/Users/tariq/code/nasq-core-decouple` unless a step says otherwise.

- [ ] **Step 2: Create the scratch directory, config and runner**

```bash
mkdir -p /tmp/nasq-core-decouple/logs /tmp/nasq-core-decouple/data
printf '[options]\nlist_db = False\n' > /tmp/nasq-core-decouple/scratch-only.conf
cat > /tmp/nasq-core-decouple/odoo-run.sh <<'RUNNER'
#!/usr/bin/env bash
# Phase 2 scratch runner (plan 2026-10-05-phase-2-decouple-nasq-core.md).
# Every database must be named nasq_core_decouple_*; odoo19 is never touched.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
WORKTREE=/Users/tariq/code/nasq-core-decouple
SCRATCH=/tmp/nasq-core-decouple
CONF="$SCRATCH/scratch-only.conf"
HTTP_PORT=8179
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-tariq}"

die() { echo "odoo-run: $*" >&2; exit 2; }
guard_db() { [[ "$1" == nasq_core_decouple_* ]] || die "refusing database '$1' (scratch names start with nasq_core_decouple_)"; }
addons() { echo "$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$1/odoo-addons"; }
classify() {
  python3 "$WORKTREE/deploy/classification.py" fixture --database "$1" --mode saas --output "$SCRATCH/$1-classification.json"
  export NASQ_COMMERCIAL_CONFIG="$SCRATCH/$1-classification.json"
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
  test)  # test DB MODULES TAGS: fresh install with tests, then drop the database
    db=$1 modules=$2 tags=$3
    guard_db "$db"
    dropdb --if-exists "$db"
    classify "$db"
    run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db.log" -i "$modules" --test-tags "$tags" \
      --stop-after-init --log-level=test || true
    grep -E 'odoo.tests.result:' "$SCRATCH/logs/$db.log" | tail -n 1 || true
    grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests' "$SCRATCH/logs/$db.log" \
      || die "tests failed or did not run: $SCRATCH/logs/$db.log (database kept for inspection)"
    dropdb --if-exists "$db"
    echo "ODOO_RUN_TEST_OK $db" ;;
  install)  # install DB MODULES: fresh install without demo or tests; keeps the database
    db=$1 modules=$2
    guard_db "$db"
    dropdb --if-exists "$db"
    classify "$db"
    run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db.log" -i "$modules" --without-demo=all --stop-after-init
    python3 -B "$WORKTREE/tools/upgrade_log_guard.py" "$SCRATCH/logs/$db.log"
    echo "ODOO_RUN_INSTALL_OK $db" ;;
  baseline)  # baseline DB MODULES: install the release tag checkout exactly like CI (no classification)
    db=$1 modules=$2
    guard_db "$db"
    dropdb --if-exists "$db"
    unset NASQ_COMMERCIAL_CONFIG
    run_odoo "$db" "$SCRATCH/baseline" "$SCRATCH/logs/$db-baseline.log" -i "$modules" --without-demo=all --stop-after-init
    echo "ODOO_RUN_BASELINE_OK $db" ;;
  upgrade)  # upgrade DB MODULES: upgrade with the worktree code exactly like CI
    db=$1 modules=$2
    guard_db "$db"
    classify "$db"
    run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db-upgrade.log" -u "$modules" --stop-after-init
    python3 -B "$WORKTREE/tools/upgrade_log_guard.py" "$SCRATCH/logs/$db-upgrade.log"
    echo "ODOO_RUN_UPGRADE_OK $db" ;;
  shell)  # shell DB ROOT < script.py   (ROOT is $WORKTREE or $SCRATCH/baseline)
    db=$1 root=$2
    guard_db "$db"
    "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell -c "$CONF" --addons-path="$(addons "$root")" \
      --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
      -d "$db" --db-filter="^${db}\$" --data-dir="$SCRATCH/data" --no-http ;;
  drop)
    guard_db "$1"
    dropdb --if-exists "$1" ;;
  *)
    die "usage: odoo-run.sh test DB MODULES TAGS | install DB MODULES | baseline DB MODULES | upgrade DB MODULES | shell DB ROOT | drop DB" ;;
esac
RUNNER
chmod +x /tmp/nasq-core-decouple/odoo-run.sh
bash -n /tmp/nasq-core-decouple/odoo-run.sh && echo runner-ok
/tmp/nasq-core-decouple/odoo-run.sh drop odoo19 || echo "guard refused odoo19 as expected"
```

Expected: `runner-ok`, then `odoo-run: refusing database 'odoo19' ...` and `guard refused odoo19 as expected`.

- [ ] **Step 3: Check the port and the database names are free**

```bash
lsof -nP -iTCP:8179 -sTCP:LISTEN || echo "port 8179 free"
psql -h 127.0.0.1 -U tariq -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'nasq_core_decouple_%'"
```

Expected: `port 8179 free` and no database listed. If 8179 is taken, change `HTTP_PORT` in the runner to a free port and say so in your report.

- [ ] **Step 4: Commit this plan on the branch**

```bash
cp /Users/tariq/code/nasq/docs/superpowers/plans/2026-10-05-phase-2-decouple-nasq-core.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-05-phase-2-decouple-nasq-core.md
git commit -m "docs(docs): add the phase 2 core decoupling plan"
```

The main checkout keeps an untracked copy of the same file; tell the orchestrator in the final report that it must be removed from the main checkout before the merge, or the merge refuses to overwrite it.

- [ ] **Step 5: Record the guard baselines**

```bash
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
PY
```

Expected: three `exit=0` lines and totals `R1 3, R2 125, R3 4, R5 8, R7 89, R8 1, R9 68, R10 2`, all others 0. Record them.

- [ ] **Step 6: Record the API surface baseline**

```bash
python3 -B tools/api_surface.py
cp docs/api/openapi.json /tmp/nasq-core-decouple/openapi-base.json
git checkout -- docs/api/openapi.json
git status --short
```

Expected: `wrote docs/api/openapi.json: ...` and an empty status after the checkout.

- [ ] **Step 7: Run the full Odoo suite once on the unmodified branch**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_base \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat
```

Expected: `odoo.tests.result: 0 failed, 0 error(s) of N tests` and `ODOO_RUN_TEST_OK nasq_core_decouple_base`. Record N. If it is not green, list the failing tests with `grep -E '(FAIL|ERROR): ' /tmp/nasq-core-decouple/logs/nasq_core_decouple_base.log`; those are pre-existing and every later run is compared against that list, not against zero. Drop the kept database with `/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_base`.

---

### Task 1: Composition hooks in nasq_core, behaviour unchanged

Core still owns all 28 keys in this task; only the shape changes. Every app-specific branch moves behind a hook whose core default still returns today's answer.

**Files:**
- Modify: `odoo-addons/nasq_core/models/access_service.py`
- Modify: `odoo-addons/nasq_core/models/res_users.py:38-46`
- Modify: `odoo-addons/nasq_core/data/access_permissions.xml:227-244` (delete the 18 `dependency_ids` stubs)
- Modify: `odoo-addons/nasq_core/data/access_migration_post.xml`
- Delete: `odoo-addons/nasq_core/data/access_roles_org_admin.xml`
- Modify: `odoo-addons/nasq_core/__manifest__.py:21`
- Modify: `odoo-addons/nasq_core/tests/test_access_models.py`, `test_access_migration.py`, `test_access_security.py:28-46`, `test_groups.py`
- Modify: `odoo-addons/nasq_platform/tests/test_entitlements.py:143-146`
- Create: `odoo-addons/nasq_api/tests/test_access_composition.py`; Modify: `odoo-addons/nasq_api/tests/__init__.py`
- Modify: `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Produces on `nasq.access.service` (all `@api.model`, composed with `super()` by apps in Tasks 2 and 3):
  - `_nasq_permission_dependencies() -> dict[str, set[str]]`
  - `_nasq_builtin_role_grants() -> dict[str, set[str]]` (role xml id → keys)
  - `_nasq_repair_builtin_role_grants() -> True` (superuser only; links missing grants by permission key; raises `ValidationError` for an unknown role, non-protected role or unknown key)
  - `_nasq_configure_permission_dependencies() -> True` (writes the composed map; raises `ValidationError` for an unknown key)
  - `_nasq_legacy_capability_keys(user) -> set[str]`
  - `_nasq_record_company(record) -> res.company recordset`
  - `_nasq_contextual_capability(user, key, record) -> bool`
  - `_nasq_identity_extra(user, capabilities) -> tuple[list[dict], set[str]]`
  - `_nasq_customer_actor_keys() -> set[str]`
  - `_nasq_legacy_admin_roles() -> list[str]`
- Removed: `_nasq_upgrade_builtin_meeting_permissions`, `BUILTIN_MEETING_PERMISSION_KEYS`.
- Kept importable: `NasqAccessRule`, `SYSTEM_PERMISSIONS`, `CAPABILITIES` (Task 3 narrows `CAPABILITIES` to the core keys).

- [ ] **Step 1: Write the failing composition test in nasq_api**

Create `odoo-addons/nasq_api/tests/test_access_composition.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

SYSTEM = frozenset({
    'access.users.read', 'access.users.grant', 'access.users.assign_roles',
    'access.users.disable', 'access.users.reset_password', 'access.roles.read',
    'access.roles.manage', 'access.audit.read', 'settings.branding.manage',
})
HR = frozenset({
    'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
})
PMO = frozenset({
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
})
MEETINGS = frozenset({'meetings.read', 'meetings.create', 'meetings.manage'})
EMPLOYEE = frozenset({
    'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
    'meetings.read',
})
CATALOG = SYSTEM | HR | PMO | MEETINGS
DEPENDENCIES = {
    'access.users.grant': {'access.users.read', 'access.roles.read'},
    'access.users.assign_roles': {'access.users.read', 'access.roles.read'},
    'access.users.disable': {'access.users.read'},
    'access.users.reset_password': {'access.users.read'},
    'access.roles.manage': {'access.roles.read'},
    'hr.employees.manage': {'hr.employees.read'},
    'hr.employees.archive': {'hr.employees.read'},
    'hr.employees.access_status.read': {'hr.employees.read'},
    'hr.departments.manage': {'hr.departments.read'},
    'hr.documents.manage': {'hr.documents.read'},
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
}


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestAccessComposition(TransactionCase):
    """With every application installed, the composed catalog, built-in roles and
    groups equal the pre-split nasq_core seed (spec 3.2, acceptance 3)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.Permission = cls.env['nasq.access.permission']

    def _role_keys(self, key):
        role = self.env['nasq.access.role'].search([('key', '=', key), ('type', '=', 'built_in')])
        self.assertEqual(len(role), 1, key)
        return set(role.permission_ids.mapped('key'))

    def _group(self, key):
        return self.env.ref(self.Permission.search([('key', '=', key)]).group_xmlid)

    def test_catalog_is_the_same_28_keys_each_owned_by_one_addon(self):
        catalog = self.service._nasq_capability_map()
        self.assertEqual(set(catalog), CATALOG)
        self.assertEqual(len(catalog), 28)
        permissions = self.Permission.search([])
        self.assertEqual(sorted(permissions.mapped('key')), sorted(CATALOG))
        xmlids = permissions.get_external_id()
        for permission in permissions:
            owner = catalog[permission.key]['owner']
            self.assertEqual(xmlids[permission.id].split('.')[0], owner, permission.key)
            self.assertEqual(permission.group_xmlid.split('.')[0], owner, permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.group_xmlid)

    def test_builtin_roles_hold_the_approved_grants(self):
        self.assertEqual(self._role_keys('employee'), EMPLOYEE)
        self.assertEqual(self._role_keys('hr_manager'), HR)
        self.assertEqual(self._role_keys('pmo_manager'), PMO)
        self.assertEqual(self._role_keys('system_admin'), SYSTEM | MEETINGS)
        self.assertEqual(self._role_keys('vendor_support'), CATALOG)
        self.assertEqual(
            set(self.env['nasq.access.role'].search([('type', '=', 'built_in')]).mapped('key')),
            {'employee', 'hr_manager', 'pmo_manager', 'system_admin', 'vendor_support'},
        )
        grants = self.service._nasq_builtin_role_grants()
        self.assertEqual(
            {self.env.ref(role_xmlid).key for role_xmlid in grants},
            {'employee', 'hr_manager', 'pmo_manager', 'system_admin', 'vendor_support'},
        )

    def test_permission_dependencies_are_unchanged(self):
        actual = {
            permission.key: set(permission.dependency_ids.mapped('key'))
            for permission in self.Permission.search([]) if permission.dependency_ids
        }
        self.assertEqual(actual, DEPENDENCIES)
        self.assertEqual(self.service._nasq_permission_dependencies(), DEPENDENCIES)

    def test_groups_keep_their_odoo_and_capability_implications(self):
        employee = self.env.ref('nasq_core.group_employee')
        self.assertIn(self.env.ref('project.group_project_user'), employee.all_implied_ids)
        vendor = self.env.ref('nasq_core.group_vendor_support')
        self.assertIn(self.env.ref('base.group_system'), vendor.all_implied_ids)
        implied_keys = {
            permission.key for permission in self.Permission.search([])
            if self.env.ref(permission.group_xmlid) in vendor.all_implied_ids
        }
        self.assertEqual(implied_keys, CATALOG - {'meetings.read', 'meetings.create'})
        access_admin = self.env.ref('nasq_core.group_access_admin')
        self.assertIn(self._group('meetings.manage'), access_admin.all_implied_ids)
        legacy_admin = self.env.ref('nasq_core.group_customer_admin')
        self.assertIn(self._group('access.users.assign_roles'), legacy_admin.all_implied_ids)
        for xmlid in (
            'nasq_core.group_employee', 'project.group_project_manager', 'hr.group_hr_manager',
            'base.group_erp_manager', 'base.group_system',
        ):
            self.assertNotIn(self.env.ref(xmlid), legacy_admin.all_implied_ids, xmlid)
        rule = self.env.ref('nasq_core.rule_access_users_company')
        self.assertEqual(rule.groups, self._group('access.users.read') | self._group('hr.employees.archive'))
        admin = self.env.ref('base.user_admin')
        self.assertTrue(admin.has_group('nasq_core.group_vendor_support'))
        self.assertTrue(admin.has_group('nasq_core.group_employee'))

    def test_system_admin_has_meetings_but_no_hr_or_pmo_management(self):
        admin = new_test_user(self.env, login='composition_system_admin', groups='base.group_user')
        self.service._nasq_replace_assignments(admin, [{
            'role_id': self.env.ref('nasq_core.role_system_admin').id,
            'company_id': self.env.company.id,
        }])
        self.assertEqual(self.service._nasq_capability_keys(admin), SYSTEM | MEETINGS)
        self.assertIn(self._group('meetings.manage'), admin.all_group_ids)
        self.assertFalse(admin.has_group('hr.group_hr_manager'))
        self.assertFalse(admin.has_group('project.group_project_manager'))

    def test_legacy_groups_still_map_to_the_same_keys(self):
        cases = (
            ('base.group_user,nasq_core.group_access_admin', SYSTEM | MEETINGS),
            ('base.group_user,hr.group_hr_manager', HR),
            ('base.group_user,project.group_project_manager', PMO),
            ('nasq_core.group_employee', EMPLOYEE),
        )
        for index, (groups, expected) in enumerate(cases):
            user = new_test_user(self.env, login=f'composition_legacy_{index}', groups=groups)
            self.assertEqual(self.service._nasq_capability_keys(user), expected, groups)

    def test_actor_keys_and_legacy_admin_roles_are_composed(self):
        self.assertEqual(self.service._nasq_customer_actor_keys(), {
            'access.users.grant', 'access.users.assign_roles', 'access.users.disable',
            'access.users.reset_password', 'hr.employees.archive',
        })
        self.assertEqual(
            set(self.service._nasq_legacy_admin_roles()), {'system_admin', 'hr_manager', 'pmo_manager'},
        )
```

In `odoo-addons/nasq_api/tests/__init__.py`, replace:

```python
    test_access_admin,
    test_branding,
```

with:

```python
    test_access_admin,
    test_access_composition,
    test_branding,
```

- [ ] **Step 2: Rewrite the core tests so they name no application record**

Replace the whole of `odoo-addons/nasq_core/tests/test_access_models.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_core.models.access_service import SYSTEM_PERMISSIONS


@tagged('nasq', 'nasq_access')
class TestNasqAccessModels(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.service = cls.env['nasq.access.service']
        cls.employee = new_test_user(
            cls.env, login='access_models_employee', groups='nasq_core.group_employee',
        )

    def _custom_role(self, name, keys):
        return self.env['nasq.access.role'].create({
            'name_ar': name, 'company_id': self.company.id,
            'permission_ids': [Command.set(
                self.env['nasq.access.permission'].search([('key', 'in', keys)]).ids,
            )],
        })

    def test_catalog_matches_the_composed_definitions_and_builtin_grants(self):
        catalog = self.service._nasq_capability_map()
        permissions = self.env['nasq.access.permission'].search([])
        self.assertEqual(set(permissions.mapped('key')), set(catalog))
        self.assertEqual(len(permissions), len(catalog))
        self.assertTrue(set(catalog) >= SYSTEM_PERMISSIONS)

        grants = self.service._nasq_builtin_role_grants()
        self.assertTrue({
            'nasq_core.role_employee', 'nasq_core.role_system_admin', 'nasq_core.role_vendor_support',
        } <= set(grants))
        for role_xmlid, keys in grants.items():
            role = self.env.ref(role_xmlid)
            self.assertEqual((role.type, role.protected), ('built_in', True), role_xmlid)
            self.assertTrue(keys <= set(role.permission_ids.mapped('key')), role_xmlid)
        vendor = self.env.ref('nasq_core.role_vendor_support')
        self.assertEqual(set(vendor.permission_ids.mapped('key')), set(catalog))
        self.assertFalse(vendor.assignable)
        system_admin = self.env.ref('nasq_core.role_system_admin')
        self.assertTrue(set(system_admin.permission_ids.mapped('key')) >= SYSTEM_PERMISSIONS)

    def test_custom_role_rejects_access_changing_permissions_and_dependencies(self):
        forbidden = self.env['nasq.access.permission'].search([
            ('key', '=', 'access.users.assign_roles'),
        ])
        with self.assertRaisesRegex(ValidationError, 'custom_role_permission_forbidden'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ممنوع', 'type': 'custom',
                'permission_ids': [(6, 0, forbidden.ids)],
            })

        Permission = self.env['nasq.access.permission']
        values = {
            'domain': 'settings', 'resource': 'widgets', 'name_ar': 'اختبار',
            'description_ar': 'اختبار', 'group_xmlid': 'nasq_core.group_cap_settings_branding_manage',
        }
        read = Permission.create({**values, 'key': 'test.widgets.read', 'action': 'read'})
        manage = Permission.create({
            **values, 'key': 'test.widgets.manage', 'action': 'manage',
            'dependency_ids': [Command.set(read.ids)],
        })
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ناقص', 'type': 'custom',
                'permission_ids': [(6, 0, manage.ids)],
            })

    def test_assignments_are_additive_company_scoped_and_disabled_role_stays_effective(self):
        users_role = self._custom_role('قراءة المستخدمين', ['access.users.read'])
        branding_role = self._custom_role('إدارة الهوية', ['settings.branding.manage'])
        self.service._nasq_replace_assignments(
            self.employee,
            [{'role_id': users_role.id, 'company_id': self.company.id},
             {'role_id': branding_role.id, 'company_id': self.company.id}],
        )
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'access.users.read',
        ))
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'settings.branding.manage',
        ))

        users_role.write({'active': False})
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'access.users.read',
        ))
        employee_role = self.env.ref('nasq_core.role_employee')
        self.service._nasq_replace_assignments(
            self.employee,
            [{'role_id': users_role.id, 'company_id': self.company.id},
             {'role_id': branding_role.id, 'company_id': self.company.id},
             {'role_id': employee_role.id, 'company_id': self.company.id}],
        )
        self.assertTrue(self.service._nasq_has_capability(
            self.employee, 'access.users.read',
        ))
        newcomer = new_test_user(
            self.env, login='access_models_newcomer', groups='base.group_user',
        )
        with self.assertRaisesRegex(ValidationError, 'role_disabled'):
            self.service._nasq_replace_assignments(
                newcomer,
                [{'role_id': users_role.id, 'company_id': self.company.id}],
            )

        with self.assertRaisesRegex(ValidationError, 'unsupported_scope'):
            self.service._nasq_replace_assignments(
                self.employee,
                [{'role_id': branding_role.id, 'company_id': self.company.id,
                  'scope_kind': 'project', 'scope_id': 1}],
            )

    def test_generic_sensitive_user_write_is_rejected(self):
        admin = new_test_user(
            self.env, login='access_models_admin', groups='nasq_core.group_access_admin',
        )
        with self.assertRaises(AccessError):
            self.employee.with_user(admin).write({'active': False})
        with self.assertRaises(AccessError):
            self.employee.with_user(admin).write({
                'group_ids': [(4, self.env.ref('base.group_system').id)],
            })

    def test_generic_role_mutations_are_rejected_for_access_admin(self):
        admin = new_test_user(
            self.env, login='access_models_role_admin', groups='nasq_core.group_access_admin',
        )
        Role = self.env['nasq.access.role'].with_user(admin)
        with self.assertRaises(AccessError):
            Role.create({
                'name_ar': 'تجاوز', 'type': 'built_in', 'protected': False,
                'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([]).ids)],
            })
        custom = self.env['nasq.access.role'].create({
            'name_ar': 'دور محمي', 'company_id': self.company.id,
        })
        with self.assertRaises(AccessError):
            custom.with_user(admin).write({'protected': True})
        with self.assertRaises(AccessError):
            custom.with_user(admin).unlink()

    def test_audit_rejects_sensitive_values_and_is_immutable(self):
        with self.assertRaisesRegex(ValidationError, 'sensitive_audit_key'):
            self.env['nasq.access.audit']._nasq_log(
                action='user.password_reset', target=self.employee,
                after={'password': 'never'},
            )
        event = self.env['nasq.access.audit']._nasq_log(
            action='user.password_reset', target=self.employee,
            after={'sessions_revoked': True},
        )
        with self.assertRaises(AccessError):
            event.with_user(self.employee).write({'reason': 'rewrite'})
```

Replace the whole of `odoo-addons/nasq_core/tests/test_access_migration.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq', 'nasq_access')
class TestNasqAccessMigration(TransactionCase):

    def test_builtin_role_repair_is_additive_and_idempotent(self):
        service = self.env['nasq.access.service']
        grants = service._nasq_builtin_role_grants()
        audit = self.env['nasq.access.permission'].search([('key', '=', 'access.audit.read')])
        roles = {role_xmlid: self.env.ref(role_xmlid) for role_xmlid in grants}

        # Recreate a database installed before access.audit.read was seeded.
        for role_xmlid in ('nasq_core.role_system_admin', 'nasq_core.role_vendor_support'):
            roles[role_xmlid].write({'permission_ids': [Command.unlink(audit.id)]})
        before = {
            role_xmlid: set(role.permission_ids.mapped('key'))
            for role_xmlid, role in roles.items()
        }
        custom = self.env['nasq.access.role'].create({
            'name_ar': 'دور اختبار الإصلاح',
            'name_en': 'Repair test role',
            'type': 'custom',
            'company_id': self.env.company.id,
            'permission_ids': [Command.link(audit.id)],
        })
        custom_keys = set(custom.permission_ids.mapped('key'))
        custom_version = custom.version

        self.assertTrue(service._nasq_repair_builtin_role_grants())

        for role_xmlid, role in roles.items():
            keys = set(role.permission_ids.mapped('key'))
            self.assertTrue(grants[role_xmlid] <= keys, role_xmlid)
            self.assertEqual(keys - before[role_xmlid], grants[role_xmlid] - before[role_xmlid], role_xmlid)
        self.assertIn('access.audit.read', roles['nasq_core.role_system_admin'].permission_ids.mapped('key'))
        self.assertIn('access.audit.read', roles['nasq_core.role_vendor_support'].permission_ids.mapped('key'))
        self.assertEqual(set(custom.permission_ids.mapped('key')), custom_keys)
        self.assertEqual(custom.version, custom_version)

        versions = {role_xmlid: role.version for role_xmlid, role in roles.items()}
        self.assertTrue(service._nasq_repair_builtin_role_grants())
        self.assertEqual({role_xmlid: role.version for role_xmlid, role in roles.items()}, versions)

    def test_builtin_role_repair_requires_superuser(self):
        user = new_test_user(
            self.env, login='role_repair_non_superuser', groups='base.group_user',
        )
        with self.assertRaisesRegex(AccessError, 'requires superuser'):
            self.env['nasq.access.service'].with_user(user)._nasq_repair_builtin_role_grants()

    def test_builtin_role_repair_refuses_an_unknown_permission(self):
        service_class = type(self.env['nasq.access.service'])
        with patch.object(
            service_class, '_nasq_builtin_role_grants',
            return_value={'nasq_core.role_employee': {'missing.capability.key'}},
        ), self.assertRaisesRegex(ValidationError, 'missing.capability.key'):
            self.env['nasq.access.service']._nasq_repair_builtin_role_grants()

    def test_dependencies_are_written_from_the_composed_map(self):
        service = self.env['nasq.access.service']
        Permission = self.env['nasq.access.permission']
        for key, required in service._nasq_permission_dependencies().items():
            permission = Permission.search([('key', '=', key)])
            self.assertEqual(set(permission.dependency_ids.mapped('key')), required, key)
        grant = Permission.search([('key', '=', 'access.users.grant')])
        grant.write({'dependency_ids': [Command.clear()]})
        self.assertTrue(service._nasq_configure_permission_dependencies())
        self.assertEqual(
            set(grant.dependency_ids.mapped('key')), {'access.users.read', 'access.roles.read'},
        )
        service_class = type(service)
        with patch.object(
            service_class, '_nasq_permission_dependencies',
            return_value={'access.users.grant': {'missing.capability.key'}},
        ), self.assertRaisesRegex(ValidationError, 'missing.capability.key'):
            service._nasq_configure_permission_dependencies()

    def test_legacy_admin_preservation_is_idempotent_and_excludes_vendor(self):
        legacy = new_test_user(
            self.env, login='legacy_admin_direct',
            groups='nasq_core.group_customer_admin',
        )
        inherited_group = self.env['res.groups'].create({
            'name': 'Legacy inheritor',
            'implied_ids': [(4, self.env.ref('nasq_core.group_customer_admin').id)],
        })
        inherited = new_test_user(
            self.env, login='legacy_admin_inherited', groups='base.group_user',
        )
        inherited.write({'group_ids': [(4, inherited_group.id)]})
        vendor = new_test_user(
            self.env, login='legacy_vendor', groups='nasq_core.group_vendor_support',
        )
        inactive = new_test_user(
            self.env, login='legacy_admin_inactive',
            groups='nasq_core.group_customer_admin',
        )
        inactive.write({'active': False})

        service = self.env['nasq.access.service']
        expected_roles = set(service._nasq_legacy_admin_roles())
        self.assertIn('system_admin', expected_roles)
        candidate_ids = service._nasq_capture_legacy_admin_ids()
        self.assertIn(legacy.id, candidate_ids)
        self.assertIn(inherited.id, candidate_ids)
        self.assertIn(inactive.id, candidate_ids)
        self.assertNotIn(vendor.id, candidate_ids)
        service._nasq_migrate_legacy_admins(candidate_ids)
        service._nasq_migrate_legacy_admins(candidate_ids)

        for user in (legacy, inherited, inactive):
            keys = set(self.env['nasq.access.assignment'].search([
                ('user_id', '=', user.id),
            ]).role_id.mapped('key'))
            self.assertEqual(keys, expected_roles)
            self.assertEqual(self.env['nasq.access.audit'].search_count([
                ('action', '=', 'migration.legacy_admin_preserved'),
                ('target_id', '=', user.id),
            ]), 1)

    def test_completed_upgrade_never_regrants_roles_removed_later(self):
        params = self.env['ir.config_parameter']
        params.set_param('nasq_core.access_migration_v1_done', '0')
        legacy = new_test_user(
            self.env, login='legacy_admin_one_time',
            groups='nasq_core.group_customer_admin',
        )
        service = self.env['nasq.access.service']
        params.set_param('nasq_core.legacy_access_admin_ids', '[%s]' % legacy.id)
        service._nasq_apply_legacy_admin_snapshot()
        system_role = self.env.ref('nasq_core.role_system_admin')
        self.env['nasq.access.assignment'].search([
            ('user_id', '=', legacy.id),
            ('role_id', '=', system_role.id),
        ]).unlink()

        service._nasq_snapshot_legacy_admins()
        service._nasq_apply_legacy_admin_snapshot()

        self.assertFalse(self.env['nasq.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
            ('role_id', '=', system_role.id),
        ]))

    def test_failed_migration_rolls_back_and_can_be_retried(self):
        legacy = new_test_user(
            self.env, login='legacy_admin_rollback',
            groups='nasq_core.group_customer_admin',
        )
        params = self.env['ir.config_parameter']
        params.set_param('nasq_core.access_migration_v1_done', '0')
        params.set_param(
            'nasq_core.legacy_access_admin_ids', '[%s]' % legacy.id,
        )
        service = self.env['nasq.access.service']
        audit_model = type(self.env['nasq.access.audit'])

        with self.assertRaisesRegex(RuntimeError, 'migration audit injection'):
            with self.env.cr.savepoint():
                with patch.object(
                    audit_model, '_nasq_log',
                    side_effect=RuntimeError('migration audit injection'),
                ):
                    service._nasq_apply_legacy_admin_snapshot()

        self.env.invalidate_all()
        self.assertFalse(self.env['nasq.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
        ]))
        self.assertFalse(self.env['nasq.access.audit'].search_count([
            ('action', '=', 'migration.legacy_admin_preserved'),
            ('target_id', '=', legacy.id),
        ]))
        self.assertEqual(
            params.get_param('nasq_core.access_migration_v1_done'), '0',
        )
        self.assertEqual(
            params.get_param('nasq_core.legacy_access_admin_ids'),
            '[%s]' % legacy.id,
        )

        service._nasq_apply_legacy_admin_snapshot()
        self.assertEqual(self.env['nasq.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
        ]), len(service._nasq_legacy_admin_roles()))
        self.assertEqual(self.env['nasq.access.audit'].search_count([
            ('action', '=', 'migration.legacy_admin_preserved'),
            ('target_id', '=', legacy.id),
        ]), 1)
        self.assertEqual(
            params.get_param('nasq_core.access_migration_v1_done'), '1',
        )
        self.assertEqual(
            params.get_param('nasq_core.legacy_access_admin_ids'), '[]',
        )
```

Replace the whole of `odoo-addons/nasq_core/tests/test_groups.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('nasq')
class TestNasqGroups(TransactionCase):

    def test_groups_imply_odoo_groups(self):
        employee = self.env.ref('nasq_core.group_employee')
        admin = self.env.ref('nasq_core.group_customer_admin')
        vendor = self.env.ref('nasq_core.group_vendor_support')

        self.assertIn(self.env.ref('base.group_user'), employee.all_implied_ids)

        # nasq has no time logging (spec 2026-09-04): the employee role must not
        # carry the timesheet group even on a database where hr_timesheet happens
        # to be installed.
        timesheet_group = self.env.ref('hr_timesheet.group_hr_timesheet_user', raise_if_not_found=False)
        if timesheet_group:
            self.assertNotIn(timesheet_group, employee.all_implied_ids)
        self.assertNotIn('hr_timesheet', self.env['ir.module.module']._get('nasq_core').dependencies_id.mapped('name'))

        self.assertIn(self.env.ref('base.group_user'), admin.all_implied_ids)
        self.assertIn(self.env.ref('nasq_core.group_cap_access_users_assign_roles'), admin.all_implied_ids)
        self.assertNotIn(employee, admin.all_implied_ids)
        self.assertNotIn(self.env.ref('base.group_erp_manager'), admin.all_implied_ids)
        self.assertNotIn(self.env.ref('base.group_system'), admin.all_implied_ids)

        self.assertIn(self.env.ref('base.group_system'), vendor.all_implied_ids)

    def test_company_branding_defaults(self):
        company = self.env.ref('base.main_company')
        self.assertEqual(company.font, 'IBM_Plex_Sans_Arabic')
        self.assertEqual(company.primary_color, '#18181b')
        selection = dict(self.env['res.company']._fields['font'].get_description(self.env)['selection'])
        self.assertEqual(selection['IBM_Plex_Sans_Arabic'], 'IBM Plex Sans Arabic')

    def test_admin_is_vendor_support(self):
        admin = self.env.ref('base.user_admin')
        self.assertTrue(admin.has_group('nasq_core.group_vendor_support'))
```

In `odoo-addons/nasq_core/tests/test_access_security.py`, replace:

```python
    def test_system_admin_has_no_hr_or_pmo_management(self):
        self.assertTrue(self.service._nasq_has_capability(
            self.admin_a, 'access.users.assign_roles',
        ))
        self.assertTrue(self.service._nasq_has_capability(
            self.admin_a, 'meetings.manage',
        ))
        self.assertFalse(self.service._nasq_has_capability(
            self.admin_a, 'hr.employees.manage',
        ))
        self.assertFalse(self.service._nasq_has_capability(
            self.admin_a, 'pmo.projects.manage',
        ))
        self.assertFalse(self.service._nasq_has_capability(
            self.admin_a, 'pmo.tasks.write',
        ))
        self.assertFalse(self.admin_a.has_group('base.group_erp_manager'))
        self.assertFalse(self.admin_a.has_group('hr.group_hr_manager'))
        self.assertFalse(self.admin_a.has_group('project.group_project_manager'))
```

with:

```python
    def test_system_admin_holds_exactly_its_role_grants(self):
        role = self.env.ref('nasq_core.role_system_admin')
        keys = self.service._nasq_capability_keys(self.admin_a)
        self.assertEqual(keys, set(role.permission_ids.mapped('key')))
        self.assertTrue(keys >= self.service._nasq_builtin_role_grants()['nasq_core.role_system_admin'])
        self.assertTrue(self.service._nasq_has_capability(
            self.admin_a, 'access.users.assign_roles',
        ))
        self.assertFalse(self.admin_a.has_group('base.group_erp_manager'))
        self.assertFalse(self.admin_a.has_group('base.group_system'))
```

In `odoo-addons/nasq_platform/tests/test_entitlements.py`, replace:

```python
        capability_map = self.env['nasq.access.service']._nasq_capability_map()
        self.assertEqual(set(capability_map), set(CAPABILITIES))
        self.assertEqual(len(capability_map), 28)
```

with:

```python
        capability_map = self.env['nasq.access.service']._nasq_capability_map()
        self.assertTrue(set(capability_map) >= CAPABILITIES)
        self.assertEqual(len(capability_map), 28)
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t1 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_api:TestAccessComposition
```

Expected: FAIL. The log shows `AttributeError` for `_nasq_builtin_role_grants`, `_nasq_repair_builtin_role_grants`, `_nasq_permission_dependencies`, `_nasq_customer_actor_keys` or `_nasq_legacy_admin_roles`. Drop the kept database: `/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_t1`.

- [ ] **Step 4: Add the hooks to `access_service.py`**

Apply these edits to `odoo-addons/nasq_core/models/access_service.py`, in order. Each "Replace" text occurs exactly once.

Edit 1. Replace:

```python
import json

# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
```

with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import api, models
```

Edit 2. Replace:

```python
MEETINGS_PERMISSIONS = {
    'meetings.read', 'meetings.create', 'meetings.manage',
}
# Keep this map aligned with the approved built-in role seeds.  The role XMLIDs
# are intentional: protected roles may have been created before meeting access
# was added to the seed files, so the upgrade must repair those exact records.
BUILTIN_MEETING_PERMISSION_KEYS = {
    'nasq_core.role_employee': {'meetings.read'},
    'nasq_core.role_system_admin': MEETINGS_PERMISSIONS,
    'nasq_core.role_vendor_support': MEETINGS_PERMISSIONS,
}
CAPABILITIES = frozenset(
    SYSTEM_PERMISSIONS | HR_PERMISSIONS | PMO_PERMISSIONS | MEETINGS_PERMISSIONS,
)
```

with:

```python
MEETINGS_PERMISSIONS = {
    'meetings.read', 'meetings.create', 'meetings.manage',
}
EMPLOYEE_APP_PERMISSIONS = {
    'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
    'meetings.read',
}
PROJECT_CONTEXTUAL_PERMISSIONS = {
    'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve',
}
CAPABILITIES = frozenset(
    SYSTEM_PERMISSIONS | HR_PERMISSIONS | PMO_PERMISSIONS | MEETINGS_PERMISSIONS,
)
```

Edit 3. Replace:

```python
        """Pure descriptors composed through super(); preserve the 28 baseline keys."""
```

with:

```python
        """Pure descriptors composed through super(); each addon adds only the keys it owns."""
```

Edit 4. Replace:

```python
    @api.model
    def _nasq_capability_map(self):
```

with:

```python
    @api.model
    def _nasq_permission_dependencies(self):
        """Permission key -> keys it requires. Applications extend this through super()."""
        return {key: set(required) for key, required in PERMISSION_DEPENDENCIES.items()}

    @api.model
    def _nasq_builtin_role_grants(self):
        """Built-in role xml id -> permission keys it must hold. Applications extend this through super().

        Built-in roles are noupdate records, so _nasq_repair_builtin_role_grants()
        links these grants on install and again on every upgrade.
        """
        return {
            'nasq_core.role_employee': set(EMPLOYEE_APP_PERMISSIONS),
            'nasq_core.role_pmo_manager': set(PMO_PERMISSIONS),
            'nasq_core.role_hr_manager': set(HR_PERMISSIONS),
            'nasq_core.role_system_admin': SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS,
            'nasq_core.role_vendor_support': set(CAPABILITIES),
        }

    @api.model
    def _nasq_legacy_capability_keys(self, user):
        """Keys a user not yet managed by roles holds through legacy groups. Applications extend this."""
        keys = set()
        if (
            user.has_group('nasq_core.group_access_admin')
            or user.has_group('nasq_core.group_customer_admin')
        ):
            keys |= SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS
        if (
            user.has_group('nasq_core.group_hr_manager')
            or user.has_group('hr.group_hr_manager')
        ):
            keys |= HR_PERMISSIONS
        if (
            user.has_group('nasq_core.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_APP_PERMISSIONS
        return keys

    @api.model
    def _nasq_record_company(self, record):
        """Company that scopes RECORD. Applications add fallbacks for records without company_id."""
        if 'company_id' in record._fields:
            return record.company_id
        return record.project_id.company_id

    @api.model
    def _nasq_contextual_capability(self, user, key, record):
        """Grant KEY on RECORD beyond assigned roles. Applications extend this through super()."""
        if key not in PROJECT_CONTEXTUAL_PERMISSIONS:
            return False
        project = record if record._name == 'project.project' else record.project_id
        return bool(project and project.user_id == user)

    @api.model
    def _nasq_identity_extra(self, user, capabilities):
        """Contextual roles for /me and the keys they add, as (roles, keys). Applications extend this."""
        roles = []
        extra = set()
        company = self.env.company
        if (
            'project.project' in self.env.registry.models
            and 'pmo.projects.read' in capabilities
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
            'nasq.pmo.settings' in self.env.registry.models
            and self._nasq_is_employee_principal(user, company=company)
            and self.env['nasq.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
            extra.add('pmo.projects.create')
        return roles, extra

    @api.model
    def _nasq_customer_actor_keys(self):
        """Keys that make a user a customer access actor. Applications extend this through super()."""
        return {
            'access.users.grant', 'access.users.assign_roles',
            'access.users.disable', 'access.users.reset_password',
            'hr.employees.archive',
        }

    @api.model
    def _nasq_legacy_admin_roles(self):
        """Role keys granted to a preserved legacy administrator. Applications extend this through super()."""
        return ['system_admin', 'hr_manager', 'pmo_manager']

    @api.model
    def _nasq_capability_map(self):
```

Edit 5. Replace:

```python
        keys = {row[0] for row in self.env.cr.fetchall()}
        managed, main_company_id = self._nasq_identity_management_state(user)
        legacy_current = not managed and main_company_id == company.id
        if legacy_current and (
            user.has_group('nasq_core.group_access_admin')
            or user.has_group('nasq_core.group_customer_admin')
        ):
            keys |= SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS
        if legacy_current and (
            user.has_group('nasq_core.group_hr_manager')
            or user.has_group('hr.group_hr_manager')
        ):
            keys |= HR_PERMISSIONS
        if legacy_current and (
            user.has_group('nasq_core.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if legacy_current and user.has_group('nasq_core.group_employee'):
            keys |= {
                'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
                'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
                'meetings.read',
            }
        return keys
```

with:

```python
        keys = {row[0] for row in self.env.cr.fetchall()}
        managed, main_company_id = self._nasq_identity_management_state(user)
        if not managed and main_company_id == company.id:
            keys |= self._nasq_legacy_capability_keys(user)
        return keys
```

Edit 6. Replace:

```python
        company = company or self.env.company
        if record:
            record_company = (
                record.company_id
                if 'company_id' in record._fields
                else record.project_id.company_id
            )
            if record_company and record_company != company:
                return False
        if key in self._nasq_capability_keys(user, company=company):
            return True
        if not record or key not in {
            'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve',
        }:
            return False
        project = record if record._name == 'project.project' else record.project_id
        return bool(project and project.user_id == user)
```

with:

```python
        company = company or self.env.company
        if record:
            record_company = self._nasq_record_company(record)
            if record_company and record_company != company:
                return False
        if key in self._nasq_capability_keys(user, company=company):
            return True
        if not record:
            return False
        return bool(self._nasq_contextual_capability(user, key, record))
```

Edit 7. Replace:

```python
        base_capabilities = self._nasq_capability_keys(user, company=company)
        if (
            'project.project' in self.env.registry.models
            and 'pmo.projects.read' in base_capabilities
            and self.env['project.project'].with_user(user).search_count([
            ('user_id', '=', user.id), ('company_id', '=', company.id),
            ])
        ):
            roles.append({
                'id': None, 'key': 'project_owner',
                'name': {'ar': 'مسؤول مشروع', 'en': 'Project owner'},
                'type': 'contextual', 'protected': True, 'source': 'project_owner',
            })
        if (
            'nasq.pmo.settings' in self.env.registry.models
            and self._nasq_is_employee_principal(user, company=company)
            and self.env['nasq.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
        capabilities = base_capabilities
        if any(role['key'] == 'project_owner' for role in roles):
            capabilities |= {'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'}
        if any(role['key'] == 'project_creation_policy' for role in roles):
            capabilities.add('pmo.projects.create')
        return {
```

with:

```python
        base_capabilities = self._nasq_capability_keys(user, company=company)
        extra_roles, extra_capabilities = self._nasq_identity_extra(user, base_capabilities)
        roles.extend(extra_roles)
        capabilities = base_capabilities | extra_capabilities
        return {
```

Edit 8. Replace:

```python
    @api.model
    def _nasq_configure_permission_dependencies(self):
        Permission = self.env['nasq.access.permission']
        records = {permission.key: permission for permission in Permission.search([])}
        for key, dependency_keys in PERMISSION_DEPENDENCIES.items():
            records[key].write({
                'dependency_ids': [(6, 0, [records[item].id for item in dependency_keys])],
            })
        return True

    @api.model
    def _nasq_upgrade_builtin_meeting_permissions(self):
        """Repair meeting grants on protected roles during a module upgrade.

        The built-in role records are seeded with ``noupdate=1``.  Updating the
        seed XML therefore cannot repair databases that were installed before
        meeting permissions were added.  This hook links only the approved
        missing meeting permissions and leaves every existing relation intact.
        It is private and must run as the superuser from trusted module data.
        """
        if not self.env.is_superuser():
            msg = 'builtin meeting permission upgrade requires superuser'
            raise AccessError(msg)

        Permission = self.env['nasq.access.permission']
        for role_xmlid, permission_keys in BUILTIN_MEETING_PERMISSION_KEYS.items():
            if not permission_keys <= MEETINGS_PERMISSIONS:
                msg = 'invalid built-in meeting permission upgrade'
                raise ValidationError(msg)

            role = self.env.ref(role_xmlid)
            if role.type != 'built_in' or not role.protected:
                msg = 'built-in meeting permission upgrade target is not protected'
                raise ValidationError(msg)

            permissions = Permission.browse([
                self.env.ref(
                    'nasq_core.permission_%s' % key.replace('.', '_'),
                ).id
                for key in sorted(permission_keys)
            ])
            missing = permissions - role.permission_ids
            if missing:
                role.write({
                    'permission_ids': [Command.link(permission.id) for permission in missing],
                })
        return True
```

with:

```python
    @api.model
    def _nasq_configure_permission_dependencies(self):
        """Write the composed dependency map. Every addon that adds permissions calls this from its data."""
        Permission = self.env['nasq.access.permission']
        dependencies = self._nasq_permission_dependencies()
        keys = set(dependencies).union(*dependencies.values())
        records = {
            permission.key: permission
            for permission in Permission.search([('key', 'in', sorted(keys))])
        }
        unknown = keys - set(records)
        if unknown:
            msg = 'permission dependency names unknown permissions: %s' % ', '.join(sorted(unknown))
            raise ValidationError(msg)
        for key, required in sorted(dependencies.items()):
            records[key].write({
                'dependency_ids': [Command.set([records[item].id for item in sorted(required)])],
            })
        return True

    @api.model
    def _nasq_repair_builtin_role_grants(self):
        """Link every missing built-in grant and never remove a link.

        Built-in roles are noupdate records, so seed XML cannot add a grant on
        an existing database. Every addon that contributes grants calls this
        from its data after its permission and role records. It is private and
        must run as the superuser from trusted module data.
        """
        if not self.env.is_superuser():
            msg = 'built-in role grant repair requires superuser'
            raise AccessError(msg)
        Permission = self.env['nasq.access.permission']
        for role_xmlid, keys in sorted(self._nasq_builtin_role_grants().items()):
            role = self.env.ref(role_xmlid, raise_if_not_found=False)
            if (
                not role
                or role._name != 'nasq.access.role'
                or role.type != 'built_in'
                or not role.protected
            ):
                msg = 'built-in role grant target is missing or not protected: %s' % role_xmlid
                raise ValidationError(msg)
            permissions = Permission.search([('key', 'in', sorted(keys))])
            unknown = set(keys) - set(permissions.mapped('key'))
            if unknown:
                msg = 'built-in role grant names unknown permissions: %s' % ', '.join(sorted(unknown))
                raise ValidationError(msg)
            missing = permissions - role.permission_ids
            if missing:
                role.write({
                    'permission_ids': [Command.link(permission.id) for permission in missing],
                })
        return True
```

Edit 9. Replace:

```python
    @api.model
    def _nasq_migrate_legacy_admins(self, candidate_ids):
        roles = self.env['nasq.access.role'].search([
            ('key', 'in', ['system_admin', 'hr_manager', 'pmo_manager']),
        ])
```

with:

```python
    @api.model
    def _nasq_migrate_legacy_admins(self, candidate_ids):
        role_keys = self._nasq_legacy_admin_roles()
        roles = self.env['nasq.access.role'].search([
            ('key', 'in', role_keys),
        ])
```

Edit 10. Replace:

```python
                    after={'roles': ['system_admin', 'hr_manager', 'pmo_manager']},
```

with:

```python
                    after={'roles': role_keys},
```

- [ ] **Step 5: Use the actor-key hook in `res_users.py`**

In `odoo-addons/nasq_core/models/res_users.py`, replace:

```python
    def _nasq_is_customer_actor(self):
        self.ensure_one()
        return not self.has_group('base.group_system') and bool(
            self.env['nasq.access.service']._nasq_capability_keys(self) & {
                'access.users.grant', 'access.users.assign_roles',
                'access.users.disable', 'access.users.reset_password',
                'hr.employees.archive',
            },
        )
```

with:

```python
    def _nasq_is_customer_actor(self):
        self.ensure_one()
        service = self.env['nasq.access.service']
        return not self.has_group('base.group_system') and bool(
            service._nasq_capability_keys(self) & service._nasq_customer_actor_keys(),
        )
```

- [ ] **Step 6: Make the hooks the single source for dependencies and built-in grants**

```bash
python3 - <<'PY'
from pathlib import Path
path = Path('odoo-addons/nasq_core/data/access_permissions.xml')
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
kept = [line for line in lines if '<field name="dependency_ids"' not in line]
assert len(lines) - len(kept) == 18, len(lines) - len(kept)
path.write_text(''.join(kept), encoding='utf-8')
PY
git rm -q odoo-addons/nasq_core/data/access_roles_org_admin.xml
```

Replace the whole of `odoo-addons/nasq_core/data/access_migration_post.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <function model="nasq.access.service" name="_nasq_repair_builtin_role_grants"/>
    <function model="nasq.access.service" name="_nasq_apply_legacy_admin_snapshot"/>
</odoo>
```

In `odoo-addons/nasq_core/__manifest__.py`, replace:

```python
        'data/access_roles.xml',
        'data/access_roles_org_admin.xml',
        'data/access_migration_post.xml',
```

with:

```python
        'data/access_roles.xml',
        'data/access_migration_post.xml',
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
ruff check odoo-addons
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t1 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo:TestPmoAccessCapabilityModels,/nasq_pmo:TestPmoAccessCapabilityApi,/nasq_hr:TestHrAccessSeparation
```

Expected: `All checks passed!`, then `0 failed, 0 error(s)` and `ODOO_RUN_TEST_OK nasq_core_decouple_t1`.

- [ ] **Step 8: Lower the architecture baseline**

```bash
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py; echo "exit=$?"
git diff --stat tools/arch_baseline.json
```

Expected: `exit=0`; R2 for `nasq_core/models/access_service.py` drops from 74 to 71 and the `nasq_core/models/res_users.py` R2 entry disappears. No total grows (the write refuses growth).

- [ ] **Step 9: Commit**

```bash
git add odoo-addons/nasq_core odoo-addons/nasq_api/tests odoo-addons/nasq_platform/tests/test_entitlements.py tools/arch_baseline.json
git status --short
git commit -m "refactor(core): compose the access catalog through app hooks"
```

Expected status before the commit: only the files listed under **Files** for this task.

---

### Task 2: Move HR access into nasq_hr

`nasq_core` stops declaring the 8 HR keys, their 8 capability groups, `group_hr_manager`, `role_hr_manager` and the two HR access rows in the same commit in which `nasq_hr` starts declaring them, so no commit emits a key twice. The `pre-` migration renames the release rows.

**Files:**
- Create: `odoo-addons/nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py`
- Modify: `odoo-addons/nasq_core/__manifest__.py:5` (version)
- Modify: `odoo-addons/nasq_core/models/access_service.py`
- Modify: `odoo-addons/nasq_core/data/access_permissions.xml`, `data/access_roles.xml`
- Modify: `odoo-addons/nasq_core/security/nasq_access_groups.xml`, `nasq_access_rules.xml:19`, `ir.model.access.csv:17,26`, `nasq_core_security.xml:28`
- Create: `odoo-addons/nasq_core/tests/test_app_xmlid_migration.py`; Modify: `odoo-addons/nasq_core/tests/__init__.py`
- Modify: `odoo-addons/nasq_hr/models/access_service.py`
- Modify: `odoo-addons/nasq_hr/security/hr_capability_groups.xml`, `security/ir.model.access.csv`, `__manifest__.py`
- Create: `odoo-addons/nasq_hr/data/hr_access_permissions.xml`, `odoo-addons/nasq_hr/migrations/19.0.1.1.0/README.md`
- Create: `odoo-addons/nasq_hr/tests/test_hr_access_composition.py`; Modify: `odoo-addons/nasq_hr/tests/__init__.py` and the 7 HR test files that name `nasq_core.role_hr_manager`
- Modify: `odoo-addons/nasq_api/tests/test_me.py:95-100`, `odoo-addons/nasq_api/tests/test_access_admin.py:347`
- Modify: `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Consumes (Task 1): `_nasq_capability_definitions`, `_nasq_permission_dependencies`, `_nasq_builtin_role_grants`, `_nasq_legacy_capability_keys`, `_nasq_customer_actor_keys`, `_nasq_legacy_admin_roles`, `_nasq_configure_permission_dependencies`, `_nasq_repair_builtin_role_grants`.
- Produces: `odoo.addons.nasq_hr.models.access_service.HR_PERMISSIONS`, `EMPLOYEE_HR_PERMISSIONS`, `HR_PERMISSION_DEPENDENCIES`; xml ids `nasq_hr.group_cap_hr_*`, `nasq_hr.group_hr_manager`, `nasq_hr.permission_hr_*`, `nasq_hr.role_hr_manager`, `nasq_hr.access_audit_hr_writer`, `nasq_hr.access_users_hr_archive`; `nasq_core` migration constant `MOVED_XMLIDS = {'nasq_hr': (...)}` (Task 3 adds `'nasq_pmo'`).
- `_nasq_disable_linked_user_from_hr(employee_id, user_id, expected_user_version)` keeps its name and signature and moves to `nasq_hr` (its only caller is `nasq_hr/models/hr_employee.py:152`).

- [ ] **Step 1: Write the failing tests**

Create `odoo-addons/nasq_hr/tests/test_hr_access_composition.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_hr.models.access_service import (
    EMPLOYEE_HR_PERMISSIONS,
    HR_PERMISSIONS,
)


@tagged('nasq', 'nasq_access')
class TestHrAccessComposition(TransactionCase):
    """nasq_hr owns its capabilities, groups and role (spec R2); it runs at install,
    so it also proves nasq_hr needs no other application."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.Permission = cls.env['nasq.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_hr_owns_its_eight_capabilities_and_their_groups(self):
        catalog = self.service._nasq_capability_map()
        self.assertEqual(len(HR_PERMISSIONS), 8)
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'nasq_hr'}, set(HR_PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(HR_PERMISSIONS))])
        self.assertEqual(len(permissions), 8)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('nasq_hr.permission_hr_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('nasq_hr.group_cap_hr_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_hr_manager_role_is_unique_and_owned_by_nasq_hr(self):
        role = self.env.ref('nasq_hr.role_hr_manager')
        self.assertEqual((role.key, role.type, role.protected), ('hr_manager', 'built_in', True))
        self.assertEqual(self.env['nasq.access.role'].search_count([('key', '=', 'hr_manager')]), 1)
        self.assertFalse(self.env.ref('nasq_core.role_hr_manager', raise_if_not_found=False))
        self.assertFalse(self.env.ref('nasq_core.group_hr_manager', raise_if_not_found=False))
        self.assertEqual(self._keys('nasq_hr.role_hr_manager'), set(HR_PERMISSIONS))
        self.assertTrue(self._keys('nasq_core.role_employee') >= EMPLOYEE_HR_PERMISSIONS)
        self.assertTrue(self._keys('nasq_core.role_vendor_support') >= HR_PERMISSIONS)

    def test_hr_links_reach_core_groups_and_rules(self):
        vendor = self.env.ref('nasq_core.group_vendor_support')
        self.assertIn(self.env.ref('nasq_hr.group_hr_manager'), vendor.all_implied_ids)
        rule = self.env.ref('nasq_core.rule_access_users_company')
        self.assertIn(self.env.ref('nasq_hr.group_cap_hr_employees_archive'), rule.groups)
        self.assertIn(
            self.env.ref('hr.group_hr_user'),
            self.env.ref('nasq_hr.group_cap_hr_employees_manage').all_implied_ids,
        )

    def test_dependencies_actor_keys_and_legacy_roles_include_hr(self):
        manage = self.Permission.search([('key', '=', 'hr.employees.manage')])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['hr.employees.read'])
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ناقص', 'type': 'custom',
                'permission_ids': [Command.set(manage.ids)],
            })
        self.assertIn('hr.employees.archive', self.service._nasq_customer_actor_keys())
        self.assertIn('hr_manager', self.service._nasq_legacy_admin_roles())

    def test_legacy_hr_groups_still_grant_hr_capabilities(self):
        nasq_group = new_test_user(self.env, login='hr_comp_nasq_group', groups='nasq_hr.group_hr_manager')
        odoo_group = new_test_user(self.env, login='hr_comp_odoo_group', groups='base.group_user,hr.group_hr_manager')
        employee = new_test_user(self.env, login='hr_comp_employee', groups='nasq_core.group_employee')
        self.assertTrue(self.service._nasq_capability_keys(nasq_group) >= HR_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(odoo_group) >= HR_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(employee) >= EMPLOYEE_HR_PERMISSIONS)

    def test_repair_relinks_a_missing_hr_grant(self):
        role = self.env.ref('nasq_hr.role_hr_manager')
        archive = self.Permission.search([('key', '=', 'hr.employees.archive')])
        role.write({'permission_ids': [Command.unlink(archive.id)]})
        self.assertNotIn(archive, role.permission_ids)
        self.assertTrue(self.service._nasq_repair_builtin_role_grants())
        self.assertIn(archive, role.permission_ids)
```

Create `odoo-addons/nasq_core/tests/test_app_xmlid_migration.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

MIGRATION = 'nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py'


def _load_migration():
    spec = importlib.util.spec_from_file_location('nasq_core_pre_move_app_xmlids', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestAppXmlidMigration(TransactionCase):
    """The 19.0.1.1.0 pre-migration renames release rows in place (spec 3.2, ruling R-A)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.migration = _load_migration()
        cls.moved = [
            (module, name)
            for module, names in cls.migration.MOVED_XMLIDS.items()
            for name in names
        ]

    def _rows(self):
        self.env.cr.execute(
            'SELECT module, name, model, res_id, noupdate FROM ir_model_data WHERE module = ANY(%s) AND name = ANY(%s)',
            [['nasq_core', *self.migration.MOVED_XMLIDS], [name for _module, name in self.moved]],
        )
        return {(module, name): (model, res_id, noupdate) for module, name, model, res_id, noupdate in self.env.cr.fetchall()}

    def _group_xmlids(self):
        self.env.cr.execute('SELECT key, group_xmlid FROM nasq_access_permission')
        return dict(self.env.cr.fetchall())

    def _restore_release_state(self):
        for module, name in self.moved:
            self.env.cr.execute(
                "UPDATE ir_model_data SET module = 'nasq_core' WHERE module = %s AND name = %s",
                [module, name],
            )
            if name.startswith('group_cap_'):
                self.env.cr.execute(
                    'UPDATE nasq_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                    [f'nasq_core.{name}', f'{module}.{name}'],
                )

    def test_release_rows_are_renamed_in_place_and_a_rerun_is_a_no_op(self):
        installed = self._rows()
        self.assertEqual(sorted(key for key in installed if key in self.moved), sorted(self.moved))
        group_xmlids = self._group_xmlids()

        self._restore_release_state()
        release = self._rows()
        self.assertEqual({module for module, _name in release}, {'nasq_core'})
        self.assertEqual(self._group_xmlids(), {
            key: 'nasq_core.' + value.split('.', 1)[1] for key, value in group_xmlids.items()
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
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES ('nasq_core', %s, %s, %s, false)",
            [name, model, res_id],
        )
        before = self._rows()
        with self.assertRaisesRegex(ValueError, f'nasq_core.{name} and {module}.{name}'):
            self.migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(self._rows(), before)
```

In `odoo-addons/nasq_hr/tests/__init__.py`, replace:

```python
    test_hr_access,
    test_hr_departments,
```

with:

```python
    test_hr_access,
    test_hr_access_composition,
    test_hr_departments,
```

In `odoo-addons/nasq_core/tests/__init__.py`, replace:

```python
    test_access_security,
    test_groups,
```

with:

```python
    test_access_security,
    test_app_xmlid_migration,
    test_groups,
```

Point the existing tests at the new role xml id:

```bash
perl -pi -e 's/nasq_core\.role_hr_manager/nasq_hr.role_hr_manager/g; s/nasq_core\.role_\{key\}/nasq_hr.role_{key}/g' \
  odoo-addons/nasq_hr/tests/test_hr_documents.py odoo-addons/nasq_hr/tests/test_employee_model.py \
  odoo-addons/nasq_hr/tests/test_hr_employees.py odoo-addons/nasq_hr/tests/test_department_model.py \
  odoo-addons/nasq_hr/tests/test_hr_access.py odoo-addons/nasq_hr/tests/test_hr_document_acl.py \
  odoo-addons/nasq_hr/tests/test_hr_departments.py odoo-addons/nasq_api/tests/test_access_admin.py
rg -n "nasq_core\.role_hr_manager|nasq_core\.role_\{key\}" odoo-addons || echo "no stale HR role ids"
```

Expected: `no stale HR role ids`.

In `odoo-addons/nasq_api/tests/test_me.py`, replace:

```python
        for key in ('hr_manager', 'pmo_manager'):
            self.env['nasq.access.assignment'].create({
                'user_id': user.id,
                'role_id': self.env.ref(f'nasq_core.role_{key}').id,
                'company_id': self.env.company.id,
            })
```

with:

```python
        for role_xmlid in ('nasq_hr.role_hr_manager', 'nasq_core.role_pmo_manager'):
            self.env['nasq.access.assignment'].create({
                'user_id': user.id,
                'role_id': self.env.ref(role_xmlid).id,
                'company_id': self.env.company.id,
            })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t2 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core:TestAppXmlidMigration,/nasq_hr:TestHrAccessComposition,/nasq_hr:TestHrAccessSeparation
```

Expected: FAIL with `ImportError` for `HR_PERMISSIONS` from `odoo.addons.nasq_hr.models.access_service`, `FileNotFoundError` for the migration file, and `ValueError: External ID not found ... nasq_hr.role_hr_manager`. Drop the database: `/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_t2`.

- [ ] **Step 3: Add the migration and bump nasq_core**

Create `odoo-addons/nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hand the application access records from nasq_core to the addon that now owns them.

The ir_model_data rows are renamed in place, so every record keeps its
database id: users keep their capability groups and roles keep their grants.
Without the rename, the upgrade would delete the rows nasq_core no longer
declares and the owning addon would then create duplicates.

Rows are renamed even when the receiving addon is not installed; that addon
adopts them when it is installed. Re-running the script changes nothing.
"""

MOVED_XMLIDS = {
    'nasq_hr': (
        'group_cap_hr_employees_read',
        'group_cap_hr_employees_manage',
        'group_cap_hr_employees_archive',
        'group_cap_hr_employees_access_status_read',
        'group_cap_hr_departments_read',
        'group_cap_hr_departments_manage',
        'group_cap_hr_documents_read',
        'group_cap_hr_documents_manage',
        'group_hr_manager',
        'permission_hr_employees_read',
        'permission_hr_employees_manage',
        'permission_hr_employees_archive',
        'permission_hr_employees_access_status_read',
        'permission_hr_departments_read',
        'permission_hr_departments_manage',
        'permission_hr_documents_read',
        'permission_hr_documents_manage',
        'role_hr_manager',
        'access_audit_hr_writer',
        'access_users_hr_archive',
    ),
}


def _clashes(cr, module, names):
    cr.execute(
        '''
            SELECT core.name
              FROM ir_model_data core
              JOIN ir_model_data target
                ON target.module = %s AND target.name = core.name
             WHERE core.module = 'nasq_core' AND core.name = ANY(%s)
             ORDER BY core.name
        ''',
        [module, list(names)],
    )
    return [row[0] for row in cr.fetchall()]


def migrate(cr, version):
    if not version:
        return
    for module, names in MOVED_XMLIDS.items():
        clashes = _clashes(cr, module, names)
        if clashes:
            msg = (
                f'nasq_core migration: both nasq_core.{clashes[0]} and {module}.{clashes[0]} exist. '
                f'Check which record users and roles reference, delete the other ir_model_data row, '
                f'then run the upgrade again.'
            )
            raise ValueError(msg)
    for module, names in MOVED_XMLIDS.items():
        cr.execute(
            "UPDATE ir_model_data SET module = %s WHERE module = 'nasq_core' AND name = ANY(%s)",
            [module, list(names)],
        )
        for name in names:
            if name.startswith('group_cap_'):
                cr.execute(
                    'UPDATE nasq_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                    [f'{module}.{name}', f'nasq_core.{name}'],
                )
```

In `odoo-addons/nasq_core/__manifest__.py`, replace `'version': '19.0.1.0.0',` with `'version': '19.0.1.1.0',`.

- [ ] **Step 4: Give nasq_hr its groups, access rows, permissions and role**

Replace the whole of `odoo-addons/nasq_hr/security/hr_capability_groups.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_cap_hr_employees_read" model="res.groups"><field name="name">Capability: read employees</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.clear()]"/></record>
    <!-- Odoo's private employee model protects inherited hr.version fields
         behind hr.group_hr_user. HR management capability grants that model
         field access; the model override still keeps account and archive
         mutations behind their dedicated actions. -->
    <record id="group_cap_hr_employees_manage" model="res.groups"><field name="name">Capability: manage employees</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('hr.group_hr_user'))]"/></record>
    <record id="group_cap_hr_employees_archive" model="res.groups"><field name="name">Capability: archive employees</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('hr.group_hr_user'))]"/></record>
    <record id="group_cap_hr_employees_access_status_read" model="res.groups"><field name="name">Capability: read employee access status</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('hr.group_hr_user'))]"/></record>
    <record id="group_cap_hr_departments_read" model="res.groups"><field name="name">Capability: read departments</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_hr_departments_manage" model="res.groups"><field name="name">Capability: manage departments</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_hr_documents_read" model="res.groups"><field name="name">Capability: read HR documents</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_hr_documents_manage" model="res.groups"><field name="name">Capability: manage HR documents</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>

    <record id="group_hr_manager" model="res.groups">
        <field name="name">HR Manager</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[Command.set([ref('nasq_core.group_employee'),ref('group_cap_hr_employees_read'),ref('group_cap_hr_employees_manage'),ref('group_cap_hr_employees_archive'),ref('group_cap_hr_employees_access_status_read'),ref('group_cap_hr_departments_read'),ref('group_cap_hr_departments_manage'),ref('group_cap_hr_documents_read'),ref('group_cap_hr_documents_manage')])]"/>
    </record>

    <!-- nasq_core's support group and user-directory rule reach HR through these links. -->
    <record id="nasq_core.group_vendor_support" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('group_hr_manager'))]"/>
    </record>
    <record id="nasq_core.rule_access_users_company" model="ir.rule">
        <field name="groups" eval="[Command.link(ref('group_cap_hr_employees_archive'))]"/>
    </record>
</odoo>
```

Replace the whole of `odoo-addons/nasq_hr/security/ir.model.access.csv` with:

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_nasq_hr_document_employee,nasq.hr.document.employee,model_nasq_hr_document,nasq_core.group_employee,1,0,0,0
access_nasq_hr_document_manager,nasq.hr.document.hr_manager,model_nasq_hr_document,group_cap_hr_documents_manage,1,1,1,0
access_nasq_hr_document_reader,nasq.hr.document.hr_reader,model_nasq_hr_document,group_cap_hr_documents_read,1,0,0,0
access_nasq_hr_employee_reader,hr.employee.hr_reader,model_hr_employee,group_cap_hr_employees_read,1,0,0,0
access_nasq_hr_employee_manager,hr.employee.hr_manager,model_hr_employee,group_cap_hr_employees_manage,1,1,1,0
access_nasq_hr_employee_archiver,hr.employee.hr_archiver,model_hr_employee,group_cap_hr_employees_archive,1,1,0,0
access_nasq_hr_department_reader,hr.department.hr_reader,model_hr_department,group_cap_hr_departments_read,1,0,0,0
access_nasq_hr_department_manager,hr.department.hr_manager,model_hr_department,group_cap_hr_departments_manage,1,1,1,0
access_audit_hr_writer,access.audit hr writer,nasq_core.model_nasq_access_audit,group_cap_hr_employees_archive,0,0,1,0
access_users_hr_archive,users hr archive,base.model_res_users,group_cap_hr_employees_archive,1,1,0,0
```

Create `odoo-addons/nasq_hr/data/hr_access_permissions.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="permission_hr_employees_read" model="nasq.access.permission">
        <field name="key">hr.employees.read</field><field name="domain">hr</field>
        <field name="resource">employees</field><field name="action">read</field>
        <field name="name_ar">قراءة الموظفين</field><field name="name_en">Read employees</field>
        <field name="description_ar">قراءة الموظفين</field><field name="description_en">Read employees</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_employees_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_employees_manage" model="nasq.access.permission">
        <field name="key">hr.employees.manage</field><field name="domain">hr</field>
        <field name="resource">employees</field><field name="action">manage</field>
        <field name="name_ar">إدارة الموظفين</field><field name="name_en">Manage employees</field>
        <field name="description_ar">إدارة الموظفين</field><field name="description_en">Manage employees</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_employees_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_employees_archive" model="nasq.access.permission">
        <field name="key">hr.employees.archive</field><field name="domain">hr</field>
        <field name="resource">employees</field><field name="action">archive</field>
        <field name="name_ar">أرشفة الموظفين</field><field name="name_en">Archive employees</field>
        <field name="description_ar">أرشفة الموظفين</field><field name="description_en">Archive employees</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_employees_archive</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_employees_access_status_read" model="nasq.access.permission">
        <field name="key">hr.employees.access_status.read</field><field name="domain">hr</field>
        <field name="resource">employees</field><field name="action">access_status_read</field>
        <field name="name_ar">قراءة حالة الوصول</field><field name="name_en">Read access status</field>
        <field name="description_ar">قراءة حالة الوصول</field><field name="description_en">Read access status</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_employees_access_status_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_departments_read" model="nasq.access.permission">
        <field name="key">hr.departments.read</field><field name="domain">hr</field>
        <field name="resource">departments</field><field name="action">read</field>
        <field name="name_ar">قراءة الأقسام</field><field name="name_en">Read departments</field>
        <field name="description_ar">قراءة الأقسام</field><field name="description_en">Read departments</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_departments_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_departments_manage" model="nasq.access.permission">
        <field name="key">hr.departments.manage</field><field name="domain">hr</field>
        <field name="resource">departments</field><field name="action">manage</field>
        <field name="name_ar">إدارة الأقسام</field><field name="name_en">Manage departments</field>
        <field name="description_ar">إدارة الأقسام</field><field name="description_en">Manage departments</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_departments_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_documents_read" model="nasq.access.permission">
        <field name="key">hr.documents.read</field><field name="domain">hr</field>
        <field name="resource">documents</field><field name="action">read</field>
        <field name="name_ar">قراءة المستندات</field><field name="name_en">Read documents</field>
        <field name="description_ar">قراءة المستندات</field><field name="description_en">Read documents</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_documents_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_hr_documents_manage" model="nasq.access.permission">
        <field name="key">hr.documents.manage</field><field name="domain">hr</field>
        <field name="resource">documents</field><field name="action">manage</field>
        <field name="name_ar">إدارة المستندات</field><field name="name_en">Manage documents</field>
        <field name="description_ar">إدارة المستندات</field><field name="description_en">Manage documents</field>
        <field name="group_xmlid">nasq_hr.group_cap_hr_documents_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <data noupdate="1">
        <record id="role_hr_manager" model="nasq.access.role">
            <field name="key">hr_manager</field><field name="name_ar">مدير الموارد البشرية</field><field name="name_en">HR manager</field>
            <field name="description">HR manager</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
            <field name="permission_ids" eval="[Command.set([ref('permission_hr_employees_read'),ref('permission_hr_employees_manage'),ref('permission_hr_employees_archive'),ref('permission_hr_employees_access_status_read'),ref('permission_hr_departments_read'),ref('permission_hr_departments_manage'),ref('permission_hr_documents_read'),ref('permission_hr_documents_manage')])]"/>
        </record>
    </data>
    <!-- Built-in roles are noupdate records: these hooks link this addon's grants and
         dependencies on install and on every upgrade. -->
    <function model="nasq.access.service" name="_nasq_configure_permission_dependencies"/>
    <function model="nasq.access.service" name="_nasq_repair_builtin_role_grants"/>
</odoo>
```

Replace the whole of `odoo-addons/nasq_hr/__manifest__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq HR',
    'summary': 'nasq platform: the HR pillar — /api/v1/hr departments, employees, documents',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: shared api_handler/ApiError + NasqApiCase. Pillars depend on
    # nasq_api, never the other way round, so a customer on the project pillar
    # alone never gets HR installed. nasq_hr owns its capabilities, groups and
    # the hr_manager role (spec R2).
    'depends': ['nasq_api', 'hr', 'mail'],
    'data': [
        'security/hr_capability_groups.xml',
        'security/hr_document_rules.xml',
        'security/ir.model.access.csv',
        'data/hr_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
```

Create `odoo-addons/nasq_hr/migrations/19.0.1.1.0/README.md`:

```markdown
# 19.0.1.1.0

ينقل هذا الإصدار قدرات الموارد البشرية الثماني ومجموعاتها ودور `hr_manager` وسطري الوصول المرتبطين بالأرشفة من
`nasq_core` إلى `nasq_hr`. لا يحتاج `nasq_hr` ترحيلاً خاصاً: ترحيل
`nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py` يعيد تسمية صفوف `ir_model_data` قبل تحميل البيانات،
فتتبنّاها ملفات `nasq_hr` بالمعرّفات نفسها دون إنشاء سجلات جديدة، وتبقى إسنادات الأدوار وعضويات المجموعات كما هي.
```

- [ ] **Step 5: Add the HR hooks to `nasq_hr/models/access_service.py`**

Apply these edits to `odoo-addons/nasq_hr/models/access_service.py`. Each "Replace" text occurs exactly once.

Edit 1. Replace:

```python
from odoo.addons.nasq_core.models.access_service import NasqAccessRule


class NasqHrAccessService(models.AbstractModel):
```

with:

```python
from odoo.addons.nasq_core.models.access_service import NasqAccessRule

HR_PERMISSIONS = frozenset({
    'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
})
EMPLOYEE_HR_PERMISSIONS = frozenset({
    'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
})
HR_PERMISSION_DEPENDENCIES = {
    'hr.employees.manage': {'hr.employees.read'},
    'hr.employees.archive': {'hr.employees.read'},
    'hr.employees.access_status.read': {'hr.employees.read'},
    'hr.departments.manage': {'hr.departments.read'},
    'hr.documents.manage': {'hr.documents.read'},
}


class NasqHrAccessService(models.AbstractModel):
```

Edit 2. Replace:

```python
        rule.write({'domain_force': "[('company_id', '=', company_id)]"})
        return True

```

with:

```python
        rule.write({'domain_force': "[('company_id', '=', company_id)]"})
        return True

    @api.model
    def _nasq_capability_definitions(self):
        return super()._nasq_capability_definitions() + tuple(
            {'key': key, 'owner': 'nasq_hr'} for key in sorted(HR_PERMISSIONS)
        )

    @api.model
    def _nasq_permission_dependencies(self):
        dependencies = super()._nasq_permission_dependencies()
        for key, required in HR_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _nasq_builtin_role_grants(self):
        grants = super()._nasq_builtin_role_grants()
        for role_xmlid, keys in (
            ('nasq_hr.role_hr_manager', HR_PERMISSIONS),
            ('nasq_core.role_employee', EMPLOYEE_HR_PERMISSIONS),
            ('nasq_core.role_vendor_support', HR_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _nasq_legacy_capability_keys(self, user):
        keys = super()._nasq_legacy_capability_keys(user)
        if (
            user.has_group('nasq_hr.group_hr_manager')
            or user.has_group('hr.group_hr_manager')
        ):
            keys |= HR_PERMISSIONS
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_HR_PERMISSIONS
        return keys

    @api.model
    def _nasq_customer_actor_keys(self):
        return super()._nasq_customer_actor_keys() | {'hr.employees.archive'}

    @api.model
    def _nasq_legacy_admin_roles(self):
        return [*super()._nasq_legacy_admin_roles(), 'hr_manager']

    @api.model
    def _nasq_disable_linked_user_from_hr(self, employee_id, user_id, expected_user_version):
        self._nasq_require_capability('hr.employees.archive')
        user = self.env['res.users'].browse(user_id).exists()
        if not user:
            msg = 'not_found'
            raise NasqAccessRule(msg, status=404)
        self._nasq_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise NasqAccessRule(msg)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        self._nasq_lock_company(user.company_id)
        self.env.invalidate_all()
        self._nasq_require_capability('hr.employees.archive')
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        self._nasq_assert_user_scope(user)
        self._nasq_check_user_version(user, expected_user_version)
        self._nasq_assert_user_scope(user)
        if self._nasq_has_capability(
            user, 'access.users.assign_roles', company=user.company_id,
        ):
            self._nasq_assert_admin_survives(user.company_id, excluding_user=user)
        user._nasq_access_write({'active': False}, 'hr.employees.archive')
        self.env['nasq.access.audit']._nasq_log(
            'employee.archived_access_disabled', user,
            before={'active': True, 'employee_id': employee_id},
            after={'active': False, 'employee_id': employee_id},
        )
        self._nasq_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)

```

- [ ] **Step 6: Remove HR from nasq_core**

Apply these edits to `odoo-addons/nasq_core/models/access_service.py`. Each "Replace"/"Delete" text occurs exactly once.

Edit 1. Delete:

```python
HR_PERMISSIONS = {
    'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
}
```

Edit 2. Replace:

```python
EMPLOYEE_APP_PERMISSIONS = {
    'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
```

with:

```python
EMPLOYEE_APP_PERMISSIONS = {
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
```

Edit 3. Replace:

```python
CAPABILITIES = frozenset(
    SYSTEM_PERMISSIONS | HR_PERMISSIONS | PMO_PERMISSIONS | MEETINGS_PERMISSIONS,
)
```

with:

```python
CAPABILITIES = frozenset(
    SYSTEM_PERMISSIONS | PMO_PERMISSIONS | MEETINGS_PERMISSIONS,
)
```

Edit 4. Replace:

```python
    'access.roles.manage': {'access.roles.read'},
    'hr.employees.manage': {'hr.employees.read'},
    'hr.employees.archive': {'hr.employees.read'},
    'hr.employees.access_status.read': {'hr.employees.read'},
    'hr.departments.manage': {'hr.departments.read'},
    'hr.documents.manage': {'hr.documents.read'},
```

with:

```python
    'access.roles.manage': {'access.roles.read'},
```

Edit 5. Replace:

```python
            'nasq_core.role_pmo_manager': set(PMO_PERMISSIONS),
            'nasq_core.role_hr_manager': set(HR_PERMISSIONS),
```

with:

```python
            'nasq_core.role_pmo_manager': set(PMO_PERMISSIONS),
```

Edit 6. Delete:

```python
        if (
            user.has_group('nasq_core.group_hr_manager')
            or user.has_group('hr.group_hr_manager')
        ):
            keys |= HR_PERMISSIONS
```

Edit 7. Replace:

```python
            'access.users.disable', 'access.users.reset_password',
            'hr.employees.archive',
        }
```

with:

```python
            'access.users.disable', 'access.users.reset_password',
        }
```

Edit 8. Replace:

```python
        return ['system_admin', 'hr_manager', 'pmo_manager']
```

with:

```python
        return ['system_admin', 'pmo_manager']
```

Edit 9. Delete:

```python
    @api.model
    def _nasq_disable_linked_user_from_hr(self, employee_id, user_id, expected_user_version):
        self._nasq_require_capability('hr.employees.archive')
        user = self.env['res.users'].browse(user_id).exists()
        if not user:
            msg = 'not_found'
            raise NasqAccessRule(msg, status=404)
        self._nasq_assert_user_scope(user)
        if user == self.env.user:
            msg = 'self_access_change'
            raise NasqAccessRule(msg)
        if user.has_group('nasq_core.group_vendor_support'):
            msg = 'protected_user'
            raise NasqAccessRule(msg, status=403)
        self._nasq_lock_company(user.company_id)
        self.env.invalidate_all()
        self._nasq_require_capability('hr.employees.archive')
        user = self.env['res.users'].with_context(active_test=False).browse(user.id).exists()
        self._nasq_assert_user_scope(user)
        self._nasq_check_user_version(user, expected_user_version)
        self._nasq_assert_user_scope(user)
        if self._nasq_has_capability(
            user, 'access.users.assign_roles', company=user.company_id,
        ):
            self._nasq_assert_admin_survives(user.company_id, excluding_user=user)
        user._nasq_access_write({'active': False}, 'hr.employees.archive')
        self.env['nasq.access.audit']._nasq_log(
            'employee.archived_access_disabled', user,
            before={'active': True, 'employee_id': employee_id},
            after={'active': False, 'employee_id': employee_id},
        )
        self._nasq_bump_policy(user.company_id)
        self.env.cr.postcommit.add(self.env.registry.clear_cache)

```

Remove the HR permission records:

```bash
python3 - <<'PY'
import re
from pathlib import Path
path = Path('odoo-addons/nasq_core/data/access_permissions.xml')
text = path.read_text(encoding='utf-8')
for name in (
    'permission_hr_employees_read', 'permission_hr_employees_manage', 'permission_hr_employees_archive',
    'permission_hr_employees_access_status_read', 'permission_hr_departments_read',
    'permission_hr_departments_manage', 'permission_hr_documents_read', 'permission_hr_documents_manage',
):
    text, count = re.subn(
        r'    <record id="%s" model="nasq\.access\.permission">\n(?:        .*\n)+?    </record>\n' % name, '', text,
    )
    assert count == 1, name
path.write_text(text, encoding='utf-8')
PY
grep -c 'model="nasq.access.permission"' odoo-addons/nasq_core/data/access_permissions.xml
```

Expected: `20`.

Replace the whole of `odoo-addons/nasq_core/security/nasq_access_groups.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_cap_access_users_read" model="res.groups"><field name="name">Capability: read users</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_grant" model="res.groups"><field name="name">Capability: grant users</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_assign_roles" model="res.groups"><field name="name">Capability: assign roles</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_disable" model="res.groups"><field name="name">Capability: disable users</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_reset_password" model="res.groups"><field name="name">Capability: reset password</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_roles_read" model="res.groups"><field name="name">Capability: read roles</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_roles_manage" model="res.groups"><field name="name">Capability: manage roles</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_audit_read" model="res.groups"><field name="name">Capability: read access audit</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_projects_read" model="res.groups"><field name="name">Capability: read projects</field><field name="privilege_id" ref="res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/></record>
    <record id="group_cap_pmo_projects_create" model="res.groups"><field name="name">Capability: create projects</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_projects_manage" model="res.groups"><field name="name">Capability: manage projects</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_settings_manage" model="res.groups"><field name="name">Capability: manage PMO settings</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_tasks_read" model="res.groups"><field name="name">Capability: read tasks</field><field name="privilege_id" ref="res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/></record>
    <record id="group_cap_pmo_tasks_create" model="res.groups"><field name="name">Capability: create tasks</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_tasks_write" model="res.groups"><field name="name">Capability: write tasks</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_tasks_approve" model="res.groups"><field name="name">Capability: approve tasks</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_settings_branding_manage" model="res.groups"><field name="name">Capability: manage branding</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_meetings_read" model="res.groups"><field name="name">Capability: read meetings</field><field name="privilege_id" ref="res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('cyan_meeting_minutes.group_meeting_user'))]"/></record>
    <record id="group_cap_meetings_create" model="res.groups"><field name="name">Capability: create meetings</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_meetings_manage" model="res.groups"><field name="name">Capability: manage meetings</field><field name="privilege_id" ref="res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('cyan_meeting_minutes.group_meeting_manager'))]"/></record>

    <record id="group_pmo_manager" model="res.groups">
        <field name="name">PMO Manager</field><field name="privilege_id" ref="res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[Command.set([ref('group_employee'),ref('project.group_project_manager'),ref('group_cap_pmo_projects_read'),ref('group_cap_pmo_projects_create'),ref('group_cap_pmo_projects_manage'),ref('group_cap_pmo_settings_manage'),ref('group_cap_pmo_tasks_read'),ref('group_cap_pmo_tasks_create'),ref('group_cap_pmo_tasks_write'),ref('group_cap_pmo_tasks_approve')])]"/>
    </record>
    <record id="group_access_admin" model="res.groups">
        <field name="name">System Administrator</field><field name="privilege_id" ref="res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[Command.set([ref('base.group_user'),ref('group_cap_meetings_manage'),ref('group_cap_access_users_read'),ref('group_cap_access_users_grant'),ref('group_cap_access_users_assign_roles'),ref('group_cap_access_users_disable'),ref('group_cap_access_users_reset_password'),ref('group_cap_access_roles_read'),ref('group_cap_access_roles_manage'),ref('group_cap_access_audit_read'),ref('group_cap_settings_branding_manage')])]"/>
    </record>
    <record id="group_customer_admin" model="res.groups">
        <field name="name">Legacy Customer Administrator</field>
        <field name="comment">Compatibility alias for system access administration only.</field>
        <field name="implied_ids" eval="[Command.set([ref('group_access_admin')])]"/>
    </record>
    <record id="group_vendor_support" model="res.groups">
        <field name="implied_ids" eval="[Command.set([ref('group_customer_admin'),ref('group_pmo_manager'),ref('group_cap_meetings_manage'),ref('base.group_system')])]"/>
    </record>
</odoo>
```

Replace the whole of `odoo-addons/nasq_core/data/access_roles.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo noupdate="1">
    <record id="role_employee" model="nasq.access.role">
        <field name="key">employee</field><field name="name_ar">موظف</field><field name="name_en">Employee</field>
        <field name="description">Employee</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
        <field name="permission_ids" eval="[Command.set([ref('permission_pmo_projects_read'),ref('permission_pmo_tasks_read'),ref('permission_pmo_tasks_create'),ref('permission_pmo_tasks_write'),ref('permission_meetings_read')])]"/>
    </record>
    <record id="role_pmo_manager" model="nasq.access.role">
        <field name="key">pmo_manager</field><field name="name_ar">مدير مكتب المشاريع</field><field name="name_en">PMO manager</field>
        <field name="description">PMO manager</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
        <field name="permission_ids" eval="[Command.set([ref('permission_pmo_projects_read'),ref('permission_pmo_projects_create'),ref('permission_pmo_projects_manage'),ref('permission_pmo_settings_manage'),ref('permission_pmo_tasks_read'),ref('permission_pmo_tasks_create'),ref('permission_pmo_tasks_write'),ref('permission_pmo_tasks_approve')])]"/>
    </record>
    <record id="role_system_admin" model="nasq.access.role">
        <field name="key">system_admin</field><field name="name_ar">مدير النظام</field><field name="name_en">System administrator</field>
        <field name="description">System administrator</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
        <field name="permission_ids" eval="[Command.set([ref('permission_access_users_read'),ref('permission_access_users_grant'),ref('permission_access_users_assign_roles'),ref('permission_access_users_disable'),ref('permission_access_users_reset_password'),ref('permission_access_roles_read'),ref('permission_access_roles_manage'),ref('permission_access_audit_read'),ref('permission_settings_branding_manage')])]"/>
    </record>
    <record id="role_vendor_support" model="nasq.access.role">
        <field name="key">vendor_support</field><field name="name_ar">دعم المورّد</field><field name="name_en">Vendor support</field>
        <field name="description">Vendor support</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="False"/>
        <field name="permission_ids" eval="[Command.set([ref('permission_access_users_read'),ref('permission_access_users_grant'),ref('permission_access_users_assign_roles'),ref('permission_access_users_disable'),ref('permission_access_users_reset_password'),ref('permission_access_roles_read'),ref('permission_access_roles_manage'),ref('permission_access_audit_read'),ref('permission_pmo_projects_read'),ref('permission_pmo_projects_create'),ref('permission_pmo_projects_manage'),ref('permission_pmo_settings_manage'),ref('permission_pmo_tasks_read'),ref('permission_pmo_tasks_create'),ref('permission_pmo_tasks_write'),ref('permission_pmo_tasks_approve'),ref('permission_settings_branding_manage')])]"/>
    </record>
</odoo>

```

In `odoo-addons/nasq_core/security/nasq_access_rules.xml`, replace:

```xml
        <field name="groups" eval="[Command.set([ref('group_cap_access_users_read'), ref('group_cap_hr_employees_archive')])]"/>
```

with:

```xml
        <field name="groups" eval="[Command.set([ref('group_cap_access_users_read')])]"/>
```

In `odoo-addons/nasq_core/security/ir.model.access.csv`, delete these two lines:

```csv
access_audit_hr_writer,access.audit hr writer,model_nasq_access_audit,nasq_core.group_cap_hr_employees_archive,0,0,1,0
access_users_hr_archive,users hr archive,base.model_res_users,nasq_core.group_cap_hr_employees_archive,1,1,0,0
```

In `odoo-addons/nasq_core/security/nasq_core_security.xml`, delete this line inside `group_customer_admin`:

```xml
            (4, ref('hr.group_hr_manager')),
```

Check that nothing in `nasq_core` (outside its migration and tests) still names a moved HR id:

```bash
rg -n "group_cap_hr_|group_hr_manager|role_hr_manager|permission_hr_|hr_writer|hr_archive|HR_PERMISSIONS|_nasq_disable_linked_user_from_hr" \
  odoo-addons/nasq_core --glob '!migrations/**' --glob '!tests/**' || echo "core is HR-free"
```

Expected: `core is HR-free`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
ruff check odoo-addons
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t2 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_hr,/nasq_api
```

Expected: `All checks passed!`, `migration_guard exit=0`, `0 failed, 0 error(s)`, `ODOO_RUN_TEST_OK nasq_core_decouple_t2`.

- [ ] **Step 8: Lower the architecture baseline**

```bash
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py; echo "exit=$?"
git diff tools/arch_baseline.json
```

Expected: `exit=0`; R2 drops for `nasq_core/models/access_service.py` (71 → 45), `data/access_permissions.xml` (19 → 11), `security/nasq_access_groups.xml` (8 → 5), `security/nasq_core_security.xml` (3 → 2).

- [ ] **Step 9: Commit**

```bash
git add odoo-addons/nasq_core odoo-addons/nasq_hr odoo-addons/nasq_api/tests tools/arch_baseline.json
git status --short
git commit -m "refactor(hr): move HR capabilities, groups and role into nasq_hr"
```

---

### Task 3: Move PMO and meetings access into nasq_pmo

**Files:**
- Modify: `odoo-addons/nasq_core/models/access_service.py`, `models/__init__.py`
- Move: `odoo-addons/nasq_core/models/meeting_access.py` → `odoo-addons/nasq_pmo/models/meeting_access.py`
- Move: `odoo-addons/nasq_core/security/meeting_access.xml` → `odoo-addons/nasq_pmo/security/meeting_access.xml`
- Move: `odoo-addons/nasq_core/tests/test_meeting_access.py` → `odoo-addons/nasq_pmo/tests/test_meeting_access.py`
- Modify: `odoo-addons/nasq_core/__manifest__.py`, `data/access_permissions.xml`, `data/access_roles.xml`, `security/nasq_access_groups.xml`, `security/nasq_core_security.xml`
- Modify: `odoo-addons/nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py`
- Modify: `odoo-addons/nasq_core/tests/__init__.py`, `tests/test_access_models.py`
- Create: `odoo-addons/nasq_pmo/models/access_service.py`, `security/pmo_capability_groups.xml`, `data/pmo_access_permissions.xml`, `migrations/19.0.1.2.0/README.md`, `tests/test_pmo_access_composition.py`
- Modify: `odoo-addons/nasq_pmo/__manifest__.py`, `models/__init__.py`, `tests/__init__.py`, the four `security/ir.model.access*.csv` files and 9 test files
- Modify: `odoo-addons/nasq_api/tests/test_me.py`
- Modify: `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Consumes (Task 1): every hook listed there, plus `_nasq_record_company`, `_nasq_contextual_capability`, `_nasq_identity_extra`, `_nasq_is_employee_principal(user, company)`.
- Produces: `odoo.addons.nasq_pmo.models.access_service.PMO_PERMISSIONS`, `MEETINGS_PERMISSIONS`, `EMPLOYEE_PMO_PERMISSIONS`, `PROJECT_CONTEXTUAL_PERMISSIONS`, `PMO_PERMISSION_DEPENDENCIES`; xml ids `nasq_pmo.group_cap_pmo_*`, `nasq_pmo.group_cap_meetings_*`, `nasq_pmo.group_pmo_manager`, `nasq_pmo.permission_pmo_*`, `nasq_pmo.permission_meetings_*`, `nasq_pmo.role_pmo_manager`, `nasq_pmo.rule_meeting_capability_scope`, `nasq_pmo.rule_resolution_capability_scope`; `res.users._nasq_meeting_access_domain(company_id, resolution=False)` now defined in `nasq_pmo` (same signature; `nasq_pmo/security/meeting_series_rules.xml` already calls it).
- After this task `odoo.addons.nasq_core.models.access_service.CAPABILITIES == frozenset(SYSTEM_PERMISSIONS)`.

- [ ] **Step 1: Write the failing tests**

Create `odoo-addons/nasq_pmo/tests/test_pmo_access_composition.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_pmo.models.access_service import (
    EMPLOYEE_PMO_PERMISSIONS,
    MEETINGS_PERMISSIONS,
    PMO_PERMISSIONS,
)


@tagged('nasq', 'nasq_access')
class TestPmoAccessComposition(TransactionCase):
    """nasq_pmo owns the PMO and meeting capabilities (spec 3.2, ruling R-B); it runs
    at install, so it also proves the hooks work without nasq_hr."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.Permission = cls.env['nasq.access.permission']
        cls.company = cls.env.company
        cls.owner = new_test_user(cls.env, login='pmo_comp_owner', groups='nasq_core.group_employee')
        cls.other = new_test_user(cls.env, login='pmo_comp_other', groups='nasq_core.group_employee')
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

    def test_pmo_owns_eleven_capabilities_and_their_groups(self):
        owned = PMO_PERMISSIONS | MEETINGS_PERMISSIONS
        catalog = self.service._nasq_capability_map()
        self.assertEqual(len(owned), 11)
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'nasq_pmo'}, set(owned))
        permissions = self.Permission.search([('key', 'in', sorted(owned))])
        self.assertEqual(len(permissions), 11)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('nasq_pmo.permission_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('nasq_pmo.group_cap_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_pmo_manager_role_is_unique_and_core_roles_get_pmo_grants(self):
        role = self.env.ref('nasq_pmo.role_pmo_manager')
        self.assertEqual((role.key, role.type, role.protected), ('pmo_manager', 'built_in', True))
        self.assertEqual(self.env['nasq.access.role'].search_count([('key', '=', 'pmo_manager')]), 1)
        self.assertFalse(self.env.ref('nasq_core.role_pmo_manager', raise_if_not_found=False))
        self.assertFalse(self.env.ref('nasq_core.group_pmo_manager', raise_if_not_found=False))
        self.assertEqual(self._keys('nasq_pmo.role_pmo_manager'), set(PMO_PERMISSIONS))
        self.assertTrue(self._keys('nasq_core.role_employee') >= EMPLOYEE_PMO_PERMISSIONS)
        self.assertTrue(self._keys('nasq_core.role_system_admin') >= MEETINGS_PERMISSIONS)
        self.assertTrue(self._keys('nasq_core.role_vendor_support') >= PMO_PERMISSIONS | MEETINGS_PERMISSIONS)
        self.assertNotIn('meetings.create', self._keys('nasq_core.role_employee'))

    def test_pmo_links_reach_core_groups(self):
        self.assertIn(
            self.env.ref('project.group_project_user'),
            self.env.ref('nasq_core.group_employee').all_implied_ids,
        )
        meetings_manage = self.env.ref('nasq_pmo.group_cap_meetings_manage')
        self.assertIn(meetings_manage, self.env.ref('nasq_core.group_access_admin').all_implied_ids)
        vendor = self.env.ref('nasq_core.group_vendor_support')
        self.assertIn(self.env.ref('nasq_pmo.group_pmo_manager'), vendor.all_implied_ids)
        self.assertIn(meetings_manage, vendor.all_implied_ids)
        self.assertTrue(self.env.ref('nasq_pmo.rule_meeting_capability_scope').active)
        self.assertTrue(self.env.ref('nasq_pmo.rule_resolution_capability_scope').active)

    def test_meeting_grants_are_repaired_additively_and_idempotently(self):
        roles = {
            'employee': self.env.ref('nasq_core.role_employee'),
            'pmo_manager': self.env.ref('nasq_pmo.role_pmo_manager'),
            'system_admin': self.env.ref('nasq_core.role_system_admin'),
            'vendor_support': self.env.ref('nasq_core.role_vendor_support'),
        }
        expected = {
            'employee': {'meetings.read'},
            'pmo_manager': set(),
            'system_admin': set(MEETINGS_PERMISSIONS),
            'vendor_support': set(MEETINGS_PERMISSIONS),
        }
        meetings = self.Permission.search([('key', 'in', sorted(MEETINGS_PERMISSIONS))])
        for role in roles.values():
            role.write({'permission_ids': [Command.unlink(permission.id) for permission in meetings]})
        other_before = {key: set(role.permission_ids.mapped('key')) for key, role in roles.items()}
        custom = self.env['nasq.access.role'].create({
            'name_ar': 'دور اختبار الترحيل', 'name_en': 'Migration test role', 'type': 'custom',
            'company_id': self.company.id,
            'permission_ids': [Command.link(self.env.ref('nasq_pmo.permission_meetings_read').id)],
        })
        custom_keys, custom_version = set(custom.permission_ids.mapped('key')), custom.version

        self.assertTrue(self.service._nasq_repair_builtin_role_grants())
        for key, role in roles.items():
            keys = set(role.permission_ids.mapped('key'))
            self.assertEqual(keys & MEETINGS_PERMISSIONS, expected[key], key)
            self.assertEqual(keys - MEETINGS_PERMISSIONS, other_before[key], key)
        self.assertEqual(set(custom.permission_ids.mapped('key')), custom_keys)
        self.assertEqual(custom.version, custom_version)

        versions = {key: role.version for key, role in roles.items()}
        self.assertTrue(self.service._nasq_repair_builtin_role_grants())
        self.assertEqual({key: role.version for key, role in roles.items()}, versions)

    def test_project_owner_grant_needs_the_pmo_hook(self):
        held = self.service._nasq_capability_keys(self.owner)
        self.assertNotIn('pmo.projects.manage', held)
        self.assertNotIn('pmo.tasks.approve', held)
        for key in ('pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'):
            self.assertTrue(self.service._nasq_has_capability(self.owner, key, record=self.owned_task), key)
            self.assertTrue(self.service._nasq_has_capability(self.owner, key, record=self.owned), key)
        for key in ('pmo.projects.manage', 'pmo.tasks.approve'):
            self.assertFalse(self.service._nasq_has_capability(self.owner, key, record=self.foreign_task), key)
        self.assertFalse(self.service._nasq_has_capability(self.owner, 'pmo.settings.manage', record=self.owned))
        identity = self.service._nasq_identity(self.owner)
        self.assertIn('project_owner', {role['key'] for role in identity['roles']})
        self.assertTrue({'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve'} <= set(identity['capabilities']))

    def test_record_without_company_uses_its_project_company(self):
        company_b = self.env['res.company'].create({'name': 'Composition company B'})
        project_b = self.env['project.project'].create({
            'name': 'Composition B', 'company_id': company_b.id, 'user_id': self.owner.id,
        })
        milestone = self.env['project.milestone'].create({'name': 'B milestone', 'project_id': project_b.id})
        self.assertNotIn('company_id', milestone._fields)
        self.assertEqual(self.service._nasq_record_company(milestone), company_b)
        self.assertFalse(self.service._nasq_has_capability(self.owner, 'pmo.projects.manage', record=milestone))

    def test_legacy_pmo_groups_still_grant_pmo_and_meeting_capabilities(self):
        nasq_group = new_test_user(self.env, login='pmo_comp_nasq_group', groups='nasq_pmo.group_pmo_manager')
        odoo_group = new_test_user(
            self.env, login='pmo_comp_odoo_group', groups='base.group_user,project.group_project_manager',
        )
        access_admin = new_test_user(self.env, login='pmo_comp_access_admin', groups='nasq_core.group_access_admin')
        self.assertTrue(self.service._nasq_capability_keys(nasq_group) >= PMO_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(odoo_group) >= PMO_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(access_admin) >= MEETINGS_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(self.other) >= EMPLOYEE_PMO_PERMISSIONS)
        self.assertIn('pmo_manager', self.service._nasq_legacy_admin_roles())
```

Move the meeting access test with its code:

```bash
git mv odoo-addons/nasq_core/tests/test_meeting_access.py odoo-addons/nasq_pmo/tests/test_meeting_access.py
```

In `odoo-addons/nasq_core/tests/__init__.py`, replace:

```python
    test_groups,
    test_meeting_access,
    test_nasq_scope,
```

with:

```python
    test_groups,
    test_nasq_scope,
```

In `odoo-addons/nasq_pmo/tests/__init__.py`, replace:

```python
    test_feature_enforcement,
    test_meeting_history,
```

with:

```python
    test_feature_enforcement,
    test_meeting_access,
    test_meeting_history,
```

and replace:

```python
    test_personal_stages,
    test_project_admin_model,
```

with:

```python
    test_personal_stages,
    test_pmo_access_composition,
    test_project_admin_model,
```

In `odoo-addons/nasq_core/tests/test_access_models.py`, replace:

```python
from odoo.addons.nasq_core.models.access_service import SYSTEM_PERMISSIONS
```

with:

```python
from odoo.addons.nasq_core.models.access_service import CAPABILITIES, SYSTEM_PERMISSIONS
```

and replace:

```python
    def test_custom_role_rejects_access_changing_permissions_and_dependencies(self):
```

with:

```python
    def test_core_owns_only_the_nine_system_capabilities(self):
        catalog = self.service._nasq_capability_map()
        self.assertEqual(
            {key for key, item in catalog.items() if item['owner'] == 'nasq_core'}, SYSTEM_PERMISSIONS,
        )
        self.assertEqual(len(SYSTEM_PERMISSIONS), 9)
        self.assertEqual(CAPABILITIES, frozenset(SYSTEM_PERMISSIONS))
        group = self.env.ref('base.group_user')
        self.assertFalse(self.service._nasq_record_company(group))
        self.assertFalse(self.service._nasq_contextual_capability(self.employee, 'access.users.read', group))

    def test_custom_role_rejects_access_changing_permissions_and_dependencies(self):
```

Point the PMO tests at the new xml ids:

```bash
perl -pi -e 's/nasq_core\.(group_cap_pmo_|group_cap_meetings_|group_pmo_manager|role_pmo_manager|permission_meetings_)/nasq_pmo.$1/g' \
  odoo-addons/nasq_pmo/tests/test_access_capabilities.py odoo-addons/nasq_pmo/tests/test_meeting_history.py \
  odoo-addons/nasq_pmo/tests/test_meeting_series.py odoo-addons/nasq_pmo/tests/test_meeting_workspace.py \
  odoo-addons/nasq_pmo/tests/test_meetings.py odoo-addons/nasq_pmo/tests/test_project_admin_model.py \
  odoo-addons/nasq_pmo/tests/test_project_settings_controls.py odoo-addons/nasq_pmo/tests/test_settings.py \
  odoo-addons/nasq_pmo/tests/test_transition.py
perl -pi -e "s/'nasq_core\.role_pmo_manager'/'nasq_pmo.role_pmo_manager'/" odoo-addons/nasq_api/tests/test_me.py
rg -n "nasq_core\.(group_cap_pmo_|group_cap_meetings_|group_pmo_manager|role_pmo_manager|permission_(pmo|meetings)_)" odoo-addons \
  || echo "no stale PMO ids in odoo-addons"
```

Expected: `no stale PMO ids in odoo-addons`. (`deploy/`, `tools/` and the e2e fixtures still name the old role ids; Task 6 fixes them.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t3 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_pmo:TestPmoAccessComposition,/nasq_core:TestNasqAccessModels
```

Expected: FAIL with `ImportError` for `PMO_PERMISSIONS` from `odoo.addons.nasq_pmo.models.access_service` and an assertion error in `test_core_owns_only_the_nine_system_capabilities`. Drop the database: `/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_t3`.

- [ ] **Step 3: Extend the migration**

In `odoo-addons/nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py`, replace:

```python
        'access_users_hr_archive',
    ),
}
```

with:

```python
        'access_users_hr_archive',
    ),
    'nasq_pmo': (
        'group_cap_pmo_projects_read',
        'group_cap_pmo_projects_create',
        'group_cap_pmo_projects_manage',
        'group_cap_pmo_settings_manage',
        'group_cap_pmo_tasks_read',
        'group_cap_pmo_tasks_create',
        'group_cap_pmo_tasks_write',
        'group_cap_pmo_tasks_approve',
        'group_pmo_manager',
        'group_cap_meetings_read',
        'group_cap_meetings_create',
        'group_cap_meetings_manage',
        'permission_pmo_projects_read',
        'permission_pmo_projects_create',
        'permission_pmo_projects_manage',
        'permission_pmo_settings_manage',
        'permission_pmo_tasks_read',
        'permission_pmo_tasks_create',
        'permission_pmo_tasks_write',
        'permission_pmo_tasks_approve',
        'permission_meetings_read',
        'permission_meetings_create',
        'permission_meetings_manage',
        'role_pmo_manager',
        'rule_meeting_capability_scope',
        'rule_resolution_capability_scope',
    ),
}
```

- [ ] **Step 4: Move the meeting code and rules into nasq_pmo**

```bash
git mv odoo-addons/nasq_core/models/meeting_access.py odoo-addons/nasq_pmo/models/meeting_access.py
git mv odoo-addons/nasq_core/security/meeting_access.xml odoo-addons/nasq_pmo/security/meeting_access.xml
```

The moved files keep their content byte for byte. In `odoo-addons/nasq_core/models/__init__.py`, replace:

```python
    ir_attachment,
    meeting_access,
    nasq_model,
```

with:

```python
    ir_attachment,
    nasq_model,
```

In `odoo-addons/nasq_core/__manifest__.py`, replace:

```python
        'data/access_migration_post.xml',
        'security/meeting_access.xml',
        'data/res_company_data.xml',
```

with:

```python
        'data/access_migration_post.xml',
        'data/res_company_data.xml',
```

- [ ] **Step 5: Give nasq_pmo its hooks, groups, permissions and role**

Create `odoo-addons/nasq_pmo/models/access_service.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
})
MEETINGS_PERMISSIONS = frozenset({
    'meetings.read', 'meetings.create', 'meetings.manage',
})
EMPLOYEE_PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
    'meetings.read',
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
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
}


class NasqPmoAccessService(models.AbstractModel):
    _inherit = 'nasq.access.service'

    @api.model
    def _nasq_capability_definitions(self):
        # Meetings stay with nasq_pmo until nasq_meetings exists (spec 3.2.1).
        return super()._nasq_capability_definitions() + tuple(
            {'key': key, 'owner': 'nasq_pmo'}
            for key in sorted(PMO_PERMISSIONS | MEETINGS_PERMISSIONS)
        )

    @api.model
    def _nasq_permission_dependencies(self):
        dependencies = super()._nasq_permission_dependencies()
        for key, required in PMO_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _nasq_builtin_role_grants(self):
        grants = super()._nasq_builtin_role_grants()
        for role_xmlid, keys in (
            ('nasq_pmo.role_pmo_manager', PMO_PERMISSIONS),
            ('nasq_core.role_employee', EMPLOYEE_PMO_PERMISSIONS),
            ('nasq_core.role_system_admin', MEETINGS_PERMISSIONS),
            ('nasq_core.role_vendor_support', PMO_PERMISSIONS | MEETINGS_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _nasq_legacy_capability_keys(self, user):
        keys = super()._nasq_legacy_capability_keys(user)
        if (
            user.has_group('nasq_core.group_access_admin')
            or user.has_group('nasq_core.group_customer_admin')
        ):
            keys |= MEETINGS_PERMISSIONS
        if (
            user.has_group('nasq_pmo.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_PMO_PERMISSIONS
        return keys

    @api.model
    def _nasq_legacy_admin_roles(self):
        return [*super()._nasq_legacy_admin_roles(), 'pmo_manager']

    @api.model
    def _nasq_record_company(self, record):
        if 'company_id' not in record._fields and 'project_id' in record._fields:
            return record.project_id.company_id
        return super()._nasq_record_company(record)

    @api.model
    def _nasq_contextual_capability(self, user, key, record):
        if key in PROJECT_CONTEXTUAL_PERMISSIONS:
            project = record if record._name == 'project.project' else record.project_id
            if project and project.user_id == user:
                return True
        return super()._nasq_contextual_capability(user, key, record)

    @api.model
    def _nasq_identity_extra(self, user, capabilities):
        roles, extra = super()._nasq_identity_extra(user, capabilities)
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
            self._nasq_is_employee_principal(user, company=company)
            and self.env['nasq.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
            extra.add('pmo.projects.create')
        return roles, extra
```

In `odoo-addons/nasq_pmo/models/__init__.py`, replace:

```python
from . import (
    feature_registry,
    mail_notification_nasq,
    meeting_minute,
```

with:

```python
from . import (
    access_service,
    feature_registry,
    mail_notification_nasq,
    meeting_access,
    meeting_minute,
```

`meeting_access` must stay before `meeting_minute`, `meeting_history` and `meeting_workspace`: it used to load from `nasq_core`, below every `nasq_pmo` extension of the Cyan models, and this order keeps it lowest in the method resolution order.

Create `odoo-addons/nasq_pmo/security/pmo_capability_groups.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_cap_pmo_projects_read" model="res.groups"><field name="name">Capability: read projects</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/></record>
    <record id="group_cap_pmo_projects_create" model="res.groups"><field name="name">Capability: create projects</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_projects_manage" model="res.groups"><field name="name">Capability: manage projects</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_settings_manage" model="res.groups"><field name="name">Capability: manage PMO settings</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_tasks_read" model="res.groups"><field name="name">Capability: read tasks</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/></record>
    <record id="group_cap_pmo_tasks_create" model="res.groups"><field name="name">Capability: create tasks</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_tasks_write" model="res.groups"><field name="name">Capability: write tasks</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_pmo_tasks_approve" model="res.groups"><field name="name">Capability: approve tasks</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_meetings_read" model="res.groups"><field name="name">Capability: read meetings</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('cyan_meeting_minutes.group_meeting_user'))]"/></record>
    <record id="group_cap_meetings_create" model="res.groups"><field name="name">Capability: create meetings</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/></record>
    <record id="group_cap_meetings_manage" model="res.groups"><field name="name">Capability: manage meetings</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/><field name="implied_ids" eval="[Command.link(ref('cyan_meeting_minutes.group_meeting_manager'))]"/></record>

    <record id="group_pmo_manager" model="res.groups">
        <field name="name">PMO Manager</field><field name="privilege_id" ref="nasq_core.res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[Command.set([ref('nasq_core.group_employee'),ref('project.group_project_manager'),ref('group_cap_pmo_projects_read'),ref('group_cap_pmo_projects_create'),ref('group_cap_pmo_projects_manage'),ref('group_cap_pmo_settings_manage'),ref('group_cap_pmo_tasks_read'),ref('group_cap_pmo_tasks_create'),ref('group_cap_pmo_tasks_write'),ref('group_cap_pmo_tasks_approve')])]"/>
    </record>

    <!-- nasq_core's groups reach projects and meetings through these links. -->
    <record id="nasq_core.group_employee" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('project.group_project_user'))]"/>
    </record>
    <record id="nasq_core.group_access_admin" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('group_cap_meetings_manage'))]"/>
    </record>
    <record id="nasq_core.group_vendor_support" model="res.groups">
        <field name="implied_ids" eval="[Command.link(ref('group_pmo_manager')), Command.link(ref('group_cap_meetings_manage'))]"/>
    </record>
</odoo>
```

Create `odoo-addons/nasq_pmo/data/pmo_access_permissions.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="permission_pmo_projects_read" model="nasq.access.permission">
        <field name="key">pmo.projects.read</field><field name="domain">pmo</field>
        <field name="resource">projects</field><field name="action">read</field>
        <field name="name_ar">قراءة المشاريع</field><field name="name_en">Read projects</field>
        <field name="description_ar">قراءة المشاريع</field><field name="description_en">Read projects</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_projects_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_pmo_projects_create" model="nasq.access.permission">
        <field name="key">pmo.projects.create</field><field name="domain">pmo</field>
        <field name="resource">projects</field><field name="action">create</field>
        <field name="name_ar">إنشاء المشاريع</field><field name="name_en">Create projects</field>
        <field name="description_ar">إنشاء المشاريع</field><field name="description_en">Create projects</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_projects_create</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_pmo_projects_manage" model="nasq.access.permission">
        <field name="key">pmo.projects.manage</field><field name="domain">pmo</field>
        <field name="resource">projects</field><field name="action">manage</field>
        <field name="name_ar">إدارة المشاريع</field><field name="name_en">Manage projects</field>
        <field name="description_ar">إدارة المشاريع</field><field name="description_en">Manage projects</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_projects_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="True"/>
    </record>
    <record id="permission_pmo_settings_manage" model="nasq.access.permission">
        <field name="key">pmo.settings.manage</field><field name="domain">pmo</field>
        <field name="resource">settings</field><field name="action">manage</field>
        <field name="name_ar">إدارة إعدادات المشاريع</field><field name="name_en">Manage PMO settings</field>
        <field name="description_ar">إدارة إعدادات المشاريع</field><field name="description_en">Manage PMO settings</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_settings_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_pmo_tasks_read" model="nasq.access.permission">
        <field name="key">pmo.tasks.read</field><field name="domain">pmo</field>
        <field name="resource">tasks</field><field name="action">read</field>
        <field name="name_ar">قراءة المهام</field><field name="name_en">Read tasks</field>
        <field name="description_ar">قراءة المهام</field><field name="description_en">Read tasks</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_tasks_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_pmo_tasks_create" model="nasq.access.permission">
        <field name="key">pmo.tasks.create</field><field name="domain">pmo</field>
        <field name="resource">tasks</field><field name="action">create</field>
        <field name="name_ar">إنشاء المهام</field><field name="name_en">Create tasks</field>
        <field name="description_ar">إنشاء المهام</field><field name="description_en">Create tasks</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_tasks_create</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_pmo_tasks_write" model="nasq.access.permission">
        <field name="key">pmo.tasks.write</field><field name="domain">pmo</field>
        <field name="resource">tasks</field><field name="action">write</field>
        <field name="name_ar">تعديل المهام</field><field name="name_en">Write tasks</field>
        <field name="description_ar">تعديل المهام</field><field name="description_en">Write tasks</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_tasks_write</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="True"/>
    </record>
    <record id="permission_pmo_tasks_approve" model="nasq.access.permission">
        <field name="key">pmo.tasks.approve</field><field name="domain">pmo</field>
        <field name="resource">tasks</field><field name="action">approve</field>
        <field name="name_ar">اعتماد المهام</field><field name="name_en">Approve tasks</field>
        <field name="description_ar">اعتماد المهام</field><field name="description_en">Approve tasks</field>
        <field name="group_xmlid">nasq_pmo.group_cap_pmo_tasks_approve</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="True"/>
    </record>
    <record id="permission_meetings_read" model="nasq.access.permission">
        <field name="key">meetings.read</field><field name="domain">meetings</field>
        <field name="resource">meetings</field><field name="action">read</field>
        <field name="name_ar">قراءة الاجتماعات والسلاسل</field><field name="name_en">Read meetings and series</field>
        <field name="description_ar">قراءة الاجتماعات والسلاسل المتاحة ضمن الشركة الحالية وحسب نطاق المشاركة</field><field name="description_en">Read meetings and series available in the current company and the participant scope</field>
        <field name="group_xmlid">nasq_pmo.group_cap_meetings_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_meetings_create" model="nasq.access.permission">
        <field name="key">meetings.create</field><field name="domain">meetings</field>
        <field name="resource">meetings</field><field name="action">create</field>
        <field name="name_ar">إنشاء الاجتماعات والسلاسل</field><field name="name_en">Create meetings and series</field>
        <field name="description_ar">إنشاء الاجتماعات والسلاسل الجديدة ضمن الشركة الحالية مع احترام نطاق المشاركة</field><field name="description_en">Create new meetings and series in the current company while respecting participant scope</field>
        <field name="group_xmlid">nasq_pmo.group_cap_meetings_create</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_meetings_manage" model="nasq.access.permission">
        <field name="key">meetings.manage</field><field name="domain">meetings</field>
        <field name="resource">meetings</field><field name="action">manage</field>
        <field name="name_ar">إدارة ومتابعة الاجتماعات والسلاسل</field><field name="name_en">Manage and follow meetings and series</field>
        <field name="description_ar">إدارة الاجتماعات والسلاسل ومتابعة سجلاتها ضمن الشركة الحالية وفق نطاق الإدارة</field><field name="description_en">Manage meetings and series and follow their records in the current company within the manager scope</field>
        <field name="group_xmlid">nasq_pmo.group_cap_meetings_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <data noupdate="1">
        <record id="role_pmo_manager" model="nasq.access.role">
            <field name="key">pmo_manager</field><field name="name_ar">مدير مكتب المشاريع</field><field name="name_en">PMO manager</field>
            <field name="description">PMO manager</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
            <field name="permission_ids" eval="[Command.set([ref('permission_pmo_projects_read'),ref('permission_pmo_projects_create'),ref('permission_pmo_projects_manage'),ref('permission_pmo_settings_manage'),ref('permission_pmo_tasks_read'),ref('permission_pmo_tasks_create'),ref('permission_pmo_tasks_write'),ref('permission_pmo_tasks_approve')])]"/>
        </record>
    </data>
    <!-- Built-in roles are noupdate records: these hooks link this addon's grants and
         dependencies on install and on every upgrade. -->
    <function model="nasq.access.service" name="_nasq_configure_permission_dependencies"/>
    <function model="nasq.access.service" name="_nasq_repair_builtin_role_grants"/>
</odoo>
```

Point the PMO access rows at the local groups:

```bash
perl -pi -e 's/nasq_core\.group_cap_(pmo|meetings)_/group_cap_$1_/g' \
  odoo-addons/nasq_pmo/security/ir.model.access.csv odoo-addons/nasq_pmo/security/ir.model.access-governance.csv \
  odoo-addons/nasq_pmo/security/ir.model.access-templates.csv odoo-addons/nasq_pmo/security/ir.model.access-meetings.csv
rg -n "nasq_core\.group_cap_" odoo-addons/nasq_pmo/security || echo "pmo access rows use local groups"
```

Expected: `pmo access rows use local groups`.

Replace the whole of `odoo-addons/nasq_pmo/__manifest__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq PMO',
    'summary': 'nasq platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages), people',
    'version': '19.0.1.2.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: shared api_handler/ApiError + the iso() serializer helper + NasqApiCase.
    # nasq_platform: the pre-backfill migration reads nasq.tenant.profile, and a
    # `-u nasq_pmo` must install it directly instead of relying on the caller to
    # upgrade nasq_api as well.
    # project: _inherit'd model and CLOSED_STATES. hr: hr.employee.public in
    # controllers/people.py. mail: message_post / _message_post_after_hook in the
    # timeline. bus: bus.bus in the task notifier.
    # nasq_pmo owns the pmo.* and meetings.* capabilities, their groups, the
    # pmo_manager role and the meeting record rules (spec R2); the meeting part
    # moves to nasq_meetings in phase 2b.
    'depends': ['nasq_api', 'nasq_platform', 'project', 'hr', 'mail', 'bus', 'cyan_meeting_minutes'],
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
        'security/nasq_pmo_rules.xml',
        'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml',
        'security/meeting_access.xml',
        'security/project_charter_rules.xml',
        'data/nasq_pmo_data.xml',
        'data/nasq_project_sequence.xml',
        'data/project_charter_reference_data.xml',
        'data/nasq_notification_cron.xml',
        'data/meeting_reminder_cron.xml',
        'data/project_completion_status_migration.xml',
        'report/meeting_report_history_templates.xml',
    ],
    'installable': True,
    'application': False,
}
```

Create `odoo-addons/nasq_pmo/migrations/19.0.1.2.0/README.md`:

```markdown
# 19.0.1.2.0

ينقل هذا الإصدار قدرات المشاريع الثماني وقدرات الاجتماعات الثلاث ومجموعاتها ودور `pmo_manager` وقاعدتي سجلات
الاجتماعات من `nasq_core` إلى `nasq_pmo`. لا يحتاج `nasq_pmo` ترحيلاً خاصاً: ترحيل
`nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py` يعيد تسمية صفوف `ir_model_data` قبل تحميل البيانات،
فتتبنّاها ملفات `nasq_pmo` بالمعرّفات نفسها دون إنشاء سجلات جديدة، وتبقى إسنادات الأدوار وعضويات المجموعات كما هي.
```

- [ ] **Step 6: Remove PMO and meetings from nasq_core**

Apply these edits to `odoo-addons/nasq_core/models/access_service.py`. Each "Replace" text occurs exactly once.

Edit 1. Replace:

```python
PMO_PERMISSIONS = {
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
}
MEETINGS_PERMISSIONS = {
    'meetings.read', 'meetings.create', 'meetings.manage',
}
EMPLOYEE_APP_PERMISSIONS = {
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
    'meetings.read',
}
PROJECT_CONTEXTUAL_PERMISSIONS = {
    'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve',
}
CAPABILITIES = frozenset(
    SYSTEM_PERMISSIONS | PMO_PERMISSIONS | MEETINGS_PERMISSIONS,
)
```

with:

```python
# The keys nasq_core owns. Each application adds its own through
# _nasq_capability_definitions(); the composed map is the catalog.
CAPABILITIES = frozenset(SYSTEM_PERMISSIONS)
```

Edit 2. Replace:

```python
    'access.roles.manage': {'access.roles.read'},
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
}
```

with:

```python
    'access.roles.manage': {'access.roles.read'},
}
```

Edit 3. Replace:

```python
        return {
            'nasq_core.role_employee': set(EMPLOYEE_APP_PERMISSIONS),
            'nasq_core.role_pmo_manager': set(PMO_PERMISSIONS),
            'nasq_core.role_system_admin': SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS,
            'nasq_core.role_vendor_support': set(CAPABILITIES),
        }
```

with:

```python
        return {
            'nasq_core.role_employee': set(),
            'nasq_core.role_system_admin': set(SYSTEM_PERMISSIONS),
            'nasq_core.role_vendor_support': set(SYSTEM_PERMISSIONS),
        }
```

Edit 4. Replace:

```python
            keys |= SYSTEM_PERMISSIONS | MEETINGS_PERMISSIONS
        if (
            user.has_group('nasq_core.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_APP_PERMISSIONS
        return keys
```

with:

```python
            keys |= SYSTEM_PERMISSIONS
        return keys
```

Edit 5. Replace:

```python
        if 'company_id' in record._fields:
            return record.company_id
        return record.project_id.company_id
```

with:

```python
        if 'company_id' in record._fields:
            return record.company_id
        return self.env['res.company']
```

Edit 6. Replace:

```python
        if key not in PROJECT_CONTEXTUAL_PERMISSIONS:
            return False
        project = record if record._name == 'project.project' else record.project_id
        return bool(project and project.user_id == user)
```

with:

```python
        return False
```

Edit 7. Replace:

```python
        roles = []
        extra = set()
        company = self.env.company
        if (
            'project.project' in self.env.registry.models
            and 'pmo.projects.read' in capabilities
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
            'nasq.pmo.settings' in self.env.registry.models
            and self._nasq_is_employee_principal(user, company=company)
            and self.env['nasq.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
            extra.add('pmo.projects.create')
        return roles, extra
```

with:

```python
        return [], set()
```

Edit 8. Replace:

```python
        return ['system_admin', 'pmo_manager']
```

with:

```python
        return ['system_admin']
```

Replace the whole of `odoo-addons/nasq_core/data/access_permissions.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="permission_access_users_read" model="nasq.access.permission">
        <field name="key">access.users.read</field><field name="domain">access</field>
        <field name="resource">users</field><field name="action">read</field>
        <field name="name_ar">قراءة المستخدمين</field><field name="name_en">Read users</field>
        <field name="description_ar">قراءة المستخدمين</field><field name="description_en">Read users</field>
        <field name="group_xmlid">nasq_core.group_cap_access_users_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_users_grant" model="nasq.access.permission">
        <field name="key">access.users.grant</field><field name="domain">access</field>
        <field name="resource">users</field><field name="action">grant</field>
        <field name="name_ar">منح حساب</field><field name="name_en">Grant account</field>
        <field name="description_ar">منح حساب</field><field name="description_en">Grant account</field>
        <field name="group_xmlid">nasq_core.group_cap_access_users_grant</field>
        <field name="custom_role_allowed" eval="False"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_users_assign_roles" model="nasq.access.permission">
        <field name="key">access.users.assign_roles</field><field name="domain">access</field>
        <field name="resource">users</field><field name="action">assign_roles</field>
        <field name="name_ar">إسناد الأدوار</field><field name="name_en">Assign roles</field>
        <field name="description_ar">إسناد الأدوار</field><field name="description_en">Assign roles</field>
        <field name="group_xmlid">nasq_core.group_cap_access_users_assign_roles</field>
        <field name="custom_role_allowed" eval="False"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_users_disable" model="nasq.access.permission">
        <field name="key">access.users.disable</field><field name="domain">access</field>
        <field name="resource">users</field><field name="action">disable</field>
        <field name="name_ar">تعطيل المستخدمين</field><field name="name_en">Disable users</field>
        <field name="description_ar">تعطيل المستخدمين</field><field name="description_en">Disable users</field>
        <field name="group_xmlid">nasq_core.group_cap_access_users_disable</field>
        <field name="custom_role_allowed" eval="False"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_users_reset_password" model="nasq.access.permission">
        <field name="key">access.users.reset_password</field><field name="domain">access</field>
        <field name="resource">users</field><field name="action">reset_password</field>
        <field name="name_ar">إعادة كلمة المرور</field><field name="name_en">Reset passwords</field>
        <field name="description_ar">إعادة كلمة المرور</field><field name="description_en">Reset passwords</field>
        <field name="group_xmlid">nasq_core.group_cap_access_users_reset_password</field>
        <field name="custom_role_allowed" eval="False"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_roles_read" model="nasq.access.permission">
        <field name="key">access.roles.read</field><field name="domain">access</field>
        <field name="resource">roles</field><field name="action">read</field>
        <field name="name_ar">قراءة الأدوار</field><field name="name_en">Read roles</field>
        <field name="description_ar">قراءة الأدوار</field><field name="description_en">Read roles</field>
        <field name="group_xmlid">nasq_core.group_cap_access_roles_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_roles_manage" model="nasq.access.permission">
        <field name="key">access.roles.manage</field><field name="domain">access</field>
        <field name="resource">roles</field><field name="action">manage</field>
        <field name="name_ar">إدارة الأدوار</field><field name="name_en">Manage roles</field>
        <field name="description_ar">إدارة الأدوار</field><field name="description_en">Manage roles</field>
        <field name="group_xmlid">nasq_core.group_cap_access_roles_manage</field>
        <field name="custom_role_allowed" eval="False"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_access_audit_read" model="nasq.access.permission">
        <field name="key">access.audit.read</field><field name="domain">access</field>
        <field name="resource">audit</field><field name="action">read</field>
        <field name="name_ar">قراءة سجل الصلاحيات</field><field name="name_en">Read access audit</field>
        <field name="description_ar">قراءة سجل الصلاحيات</field><field name="description_en">Read access audit</field>
        <field name="group_xmlid">nasq_core.group_cap_access_audit_read</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="False"/><field name="project_contextual" eval="False"/>
    </record>
    <record id="permission_settings_branding_manage" model="nasq.access.permission">
        <field name="key">settings.branding.manage</field><field name="domain">settings</field>
        <field name="resource">branding</field><field name="action">manage</field>
        <field name="name_ar">إدارة الهوية</field><field name="name_en">Manage branding</field>
        <field name="description_ar">إدارة الهوية</field><field name="description_en">Manage branding</field>
        <field name="group_xmlid">nasq_core.group_cap_settings_branding_manage</field>
        <field name="custom_role_allowed" eval="True"/><field name="sensitive" eval="True"/><field name="project_contextual" eval="False"/>
    </record>
</odoo>
```

Replace the whole of `odoo-addons/nasq_core/security/nasq_access_groups.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_cap_access_users_read" model="res.groups"><field name="name">Capability: read users</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_grant" model="res.groups"><field name="name">Capability: grant users</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_assign_roles" model="res.groups"><field name="name">Capability: assign roles</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_disable" model="res.groups"><field name="name">Capability: disable users</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_users_reset_password" model="res.groups"><field name="name">Capability: reset password</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_roles_read" model="res.groups"><field name="name">Capability: read roles</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_roles_manage" model="res.groups"><field name="name">Capability: manage roles</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_access_audit_read" model="res.groups"><field name="name">Capability: read access audit</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>
    <record id="group_cap_settings_branding_manage" model="res.groups"><field name="name">Capability: manage branding</field><field name="privilege_id" ref="res_groups_privilege_nasq"/></record>

    <record id="group_access_admin" model="res.groups">
        <field name="name">System Administrator</field><field name="privilege_id" ref="res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[Command.set([ref('base.group_user'),ref('group_cap_access_users_read'),ref('group_cap_access_users_grant'),ref('group_cap_access_users_assign_roles'),ref('group_cap_access_users_disable'),ref('group_cap_access_users_reset_password'),ref('group_cap_access_roles_read'),ref('group_cap_access_roles_manage'),ref('group_cap_access_audit_read'),ref('group_cap_settings_branding_manage')])]"/>
    </record>
    <record id="group_customer_admin" model="res.groups">
        <field name="name">Legacy Customer Administrator</field>
        <field name="comment">Compatibility alias for system access administration only.</field>
        <field name="implied_ids" eval="[Command.set([ref('group_access_admin')])]"/>
    </record>
    <record id="group_vendor_support" model="res.groups">
        <field name="implied_ids" eval="[Command.set([ref('group_customer_admin'),ref('base.group_system')])]"/>
    </record>
</odoo>
```

Replace the whole of `odoo-addons/nasq_core/data/access_roles.xml` with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo noupdate="1">
    <record id="role_employee" model="nasq.access.role">
        <field name="key">employee</field><field name="name_ar">موظف</field><field name="name_en">Employee</field>
        <field name="description">Employee</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
        <field name="permission_ids" eval="[Command.set([])]"/>
    </record>
    <record id="role_system_admin" model="nasq.access.role">
        <field name="key">system_admin</field><field name="name_ar">مدير النظام</field><field name="name_en">System administrator</field>
        <field name="description">System administrator</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="True"/>
        <field name="permission_ids" eval="[Command.set([ref('permission_access_users_read'),ref('permission_access_users_grant'),ref('permission_access_users_assign_roles'),ref('permission_access_users_disable'),ref('permission_access_users_reset_password'),ref('permission_access_roles_read'),ref('permission_access_roles_manage'),ref('permission_access_audit_read'),ref('permission_settings_branding_manage')])]"/>
    </record>
    <record id="role_vendor_support" model="nasq.access.role">
        <field name="key">vendor_support</field><field name="name_ar">دعم المورّد</field><field name="name_en">Vendor support</field>
        <field name="description">Vendor support</field><field name="type">built_in</field><field name="protected" eval="True"/><field name="assignable" eval="False"/>
        <field name="permission_ids" eval="[Command.set([ref('permission_access_users_read'),ref('permission_access_users_grant'),ref('permission_access_users_assign_roles'),ref('permission_access_users_disable'),ref('permission_access_users_reset_password'),ref('permission_access_roles_read'),ref('permission_access_roles_manage'),ref('permission_access_audit_read'),ref('permission_settings_branding_manage')])]"/>
    </record>
</odoo>

```

In `odoo-addons/nasq_core/security/nasq_core_security.xml`, delete these two lines (the first inside `group_employee`, the second inside `group_customer_admin`):

```xml
            (4, ref('project.group_project_user')),
            (4, ref('project.group_project_manager')),
```

Check that `nasq_core` names no application any more:

```bash
python3 -B - <<'PY'
import re
from pathlib import Path
token = re.compile(r'\b(?:(?:project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(?:pmo|hr|chat)\.)')
hits = [
    f'{path}:{number}: {line.strip()}'
    for path in sorted(Path('odoo-addons/nasq_core').rglob('*'))
    if path.suffix in ('.py', '.xml', '.csv') and 'tests' not in path.parts and path.name != '__manifest__.py'
    for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1)
    if token.search(line)
]
print('\n'.join(hits) or 'core names no application')
PY
```

Expected: `core names no application`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
ruff check odoo-addons
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t3 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_pmo,/nasq_hr,/nasq_api
```

Expected: `All checks passed!`, `migration_guard exit=0`, `0 failed, 0 error(s)`, `ODOO_RUN_TEST_OK nasq_core_decouple_t3`.

- [ ] **Step 8: Lower the architecture baseline**

```bash
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py; echo "exit=$?"
git diff tools/arch_baseline.json
```

Expected: `exit=0`; every R2 entry under `odoo-addons/nasq_core/` disappears; R7 `odoo-addons/nasq_core/models/meeting_access.py: 1` becomes `odoo-addons/nasq_pmo/models/meeting_access.py: 1` (moved, total unchanged at 89).

- [ ] **Step 9: Commit**

```bash
git add -A odoo-addons/nasq_core odoo-addons/nasq_pmo odoo-addons/nasq_api/tests/test_me.py tools/arch_baseline.json
git status --short
git commit -m "refactor(pmo): move PMO and meeting access into nasq_pmo"
```

---

### Task 4: Project usage counter moves to nasq_pmo

**Files:**
- Modify: `odoo-addons/nasq_platform/models/entitlement_service.py:276-281,309-311`
- Modify: `odoo-addons/nasq_platform/tests/test_quotas.py:31-45`
- Create: `odoo-addons/nasq_pmo/models/entitlement_service.py`, `odoo-addons/nasq_pmo/tests/test_project_quota.py`
- Modify: `odoo-addons/nasq_pmo/models/__init__.py`, `odoo-addons/nasq_pmo/tests/__init__.py`
- Modify: `tools/shared_saas_lifecycle/subscription_effect.py:127`
- Modify: `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Produces: `nasq.entitlement.service._nasq_count_usage(limit_key: str) -> int` (platform: `users.limit` → `_nasq_count_users()`, other keys → 0; `nasq_pmo`: `projects.max_projects` → `_nasq_count_projects()`). `_nasq_count_projects() -> int` and `_nasq_claim_projects(delta) -> True` keep their names and now live in `nasq_pmo`; their callers (`nasq_pmo/models/project_project.py:293,355,359` and the PMO tests) are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `odoo-addons/nasq_pmo/tests/test_project_quota.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestProjectQuota(TransactionCase):
    """nasq_pmo registers the project counter that nasq_platform's limits use (ruling R-F)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('nasq_platform.tenant_profile')
        cls.record._nasq_initialize_legacy_policy(
            cls.env['nasq.feature.registry']._nasq_installed_module_ids(),
        )
        cls.service = cls.env['nasq.entitlement.service'].sudo()

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def test_usage_counter_is_registered_by_nasq_pmo(self):
        self.env['project.project'].create({'name': 'Counted project'})
        self.assertEqual(
            self.service._nasq_count_usage('projects.max_projects'),
            self.service._nasq_count_projects(),
        )
        self.assertGreaterEqual(self.service._nasq_count_projects(), 1)
        self.assertEqual(self.service._nasq_count_usage('users.limit'), self.service._nasq_count_users())

    def test_project_limit_blocks_create_and_restore(self):
        project = self.env['project.project'].create({'name': 'Quota project'})
        current = self.service._nasq_count_projects()
        self._operator().write({'features': {**self.record.features, 'projects.max_projects': current}})
        with self.assertRaises(NasqAccessRule):
            self.env['project.project'].create({'name': 'Over quota'})
        project.write({'active': False})
        self.assertEqual(self.service._nasq_count_projects(), current - 1)
        extra = self.env['project.project'].create({'name': 'Takes freed slot'})
        self.assertEqual(self.service._nasq_count_projects(), current)
        with self.assertRaises(NasqAccessRule):
            project.write({'active': True})
        extra.unlink()
        project.write({'active': True})
        self.assertEqual(self.service._nasq_count_projects(), current)
```

In `odoo-addons/nasq_pmo/tests/__init__.py`, replace:

```python
    test_project_governance,
    test_project_reports,
```

with:

```python
    test_project_governance,
    test_project_quota,
    test_project_reports,
```

In `odoo-addons/nasq_platform/tests/test_quotas.py`, replace the whole method `test_project_limit_blocks_create_and_restore` (lines 31-45, from `    def test_project_limit_blocks_create_and_restore(self):` through `        self.assertEqual(self.service._nasq_count_projects(), current)`) with:

```python
    def test_usage_counter_counts_users_and_leaves_unknown_limits_at_zero(self):
        self.assertEqual(self.service._nasq_count_usage('users.limit'), self.service._nasq_count_users())
        self.assertEqual(self.service._nasq_count_usage('unknown.limit'), 0)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t4 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_pmo:TestProjectQuota,/nasq_platform:TestTenantQuotas
```

Expected: FAIL with `AttributeError: ... '_nasq_count_usage'`. Drop the database: `/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_t4`.

- [ ] **Step 3: Replace the project counter in nasq_platform**

In `odoo-addons/nasq_platform/models/entitlement_service.py`, replace:

```python
    @api.model
    def _nasq_count_projects(self):
        if 'project.project' not in self.env.registry:
            return 0
        self.env.cr.execute('SELECT count(*) FROM project_project WHERE active')
        return self.env.cr.fetchone()[0]
```

with:

```python
    @api.model
    def _nasq_count_usage(self, limit_key):
        """Usage counted against LIMIT_KEY. The addon that registers a limit extends this through super()."""
        if limit_key == 'users.limit':
            return self._nasq_count_users()
        return 0
```

and delete:

```python
    @api.model
    def _nasq_claim_projects(self, delta):
        return self._nasq_claim('projects.max_projects', self._nasq_count_projects(), delta)

```

- [ ] **Step 4: Register the counter in nasq_pmo**

Create `odoo-addons/nasq_pmo/models/entitlement_service.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqPmoEntitlementService(models.AbstractModel):
    _inherit = 'nasq.entitlement.service'

    @api.model
    def _nasq_count_usage(self, limit_key):
        if limit_key == 'projects.max_projects':
            return self._nasq_count_projects()
        return super()._nasq_count_usage(limit_key)

    @api.model
    def _nasq_count_projects(self):
        self.env.cr.execute('SELECT count(*) FROM project_project WHERE active')
        return self.env.cr.fetchone()[0]

    @api.model
    def _nasq_claim_projects(self, delta):
        return self._nasq_claim('projects.max_projects', self._nasq_count_projects(), delta)
```

In `odoo-addons/nasq_pmo/models/__init__.py`, replace:

```python
    access_service,
    feature_registry,
```

with:

```python
    access_service,
    entitlement_service,
    feature_registry,
```

In `tools/shared_saas_lifecycle/subscription_effect.py`, replace:

```python
    usage = {'users': service._nasq_count_users(), 'projects': service._nasq_count_projects(),
```

with:

```python
    usage = {'users': service._nasq_count_users(), 'projects': service._nasq_count_usage('projects.max_projects'),
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
ruff check odoo-addons
python3 -B -m unittest discover -s tools/shared_saas_lifecycle -p 'test_subscription_effect.py'
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t4 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_platform,/nasq_pmo:TestProjectQuota,/nasq_pmo:TestProjects,/nasq_pmo:TestProjectTemplates,/nasq_pmo:TestProjectTemplatesHttp
```

Expected: `All checks passed!`, `OK` for the tools test, `0 failed, 0 error(s)`, `ODOO_RUN_TEST_OK nasq_core_decouple_t4`.

- [ ] **Step 6: Lower the architecture baseline**

```bash
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py; echo "exit=$?"
git diff tools/arch_baseline.json
```

Expected: `exit=0`; R2 `nasq_platform/models/entitlement_service.py` 9 → 8; R9 `sql odoo-addons/nasq_platform/models/entitlement_service.py` 5 → 4 and a new `sql odoo-addons/nasq_pmo/models/entitlement_service.py: 1` (moved query, R9 total unchanged at 68).

- [ ] **Step 7: Commit**

```bash
git add odoo-addons/nasq_platform odoo-addons/nasq_pmo tools/shared_saas_lifecycle/subscription_effect.py tools/arch_baseline.json
git status --short
git commit -m "refactor(pmo): register the project usage counter in nasq_pmo"
```

---

### Task 5: nasq_core depends on base only

**Files:**
- Modify: `odoo-addons/nasq_core/__manifest__.py`
- Modify: `odoo-addons/nasq_core/tests/test_groups.py`
- Create (outside the repo): `/tmp/nasq-core-decouple/check_install.py`
- Modify: `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Produces: `nasq_core` manifest `'depends': ['base']`; `/tmp/nasq-core-decouple/check_install.py` (reads `EXPECT=core|hr|full`), used again in Task 8.

- [ ] **Step 1: Write the failing test**

In `odoo-addons/nasq_core/tests/test_groups.py`, replace:

```python
    def test_company_branding_defaults(self):
```

with:

```python
    def test_core_depends_on_base_only(self):
        module = self.env['ir.module.module']._get('nasq_core')
        self.assertEqual(module.dependencies_id.mapped('name'), ['base'])

    def test_company_branding_defaults(self):
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t5 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core:TestNasqGroups
```

Expected: FAIL in `test_core_depends_on_base_only` (`['base', 'cyan_meeting_minutes', 'hr', 'project']` != `['base']`, in any order). Drop the database: `/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_t5`.

- [ ] **Step 3: Drop the application dependencies**

In `odoo-addons/nasq_core/__manifest__.py`, replace:

```python
    # project / hr: security/nasq_core_security.xml's groups imply
    # project.group_project_user + _manager and hr.group_hr_manager; res.company.font /
    # primary_color are base fields. No hr_timesheet: nasq has no time logging.
    'depends': ['base', 'project', 'hr', 'cyan_meeting_minutes'],
```

with:

```python
    # base only (spec R1): each application adds its own capabilities, groups,
    # roles and record rules from its addon through nasq.access.service hooks.
    # res.company.font / primary_color are base fields. No hr_timesheet: nasq
    # has no time logging.
    'depends': ['base'],
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
ruff check odoo-addons
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_t5 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_hr,/nasq_chat
```

Expected: `All checks passed!`, `0 failed, 0 error(s)`, `ODOO_RUN_TEST_OK nasq_core_decouple_t5`. `nasq_core`'s `at_install` tests now run with only `base` loaded; if one fails only because an application record is missing, that assertion is app-specific: move it into `nasq_api/tests/test_access_composition.py` (post_install). Never add a dependency back to `nasq_core`.

- [ ] **Step 5: Prove the two partial installs (spec 3.2 acceptance 1 and 2)**

```bash
cat > /tmp/nasq-core-decouple/check_install.py <<'CHECK'
# Piped into `odoo-bin shell` (the shell provides `env`). Spec 3.2 acceptance 1 and 2.
# EXPECT=core: nasq_core alone on base. EXPECT=hr: nasq_core,nasq_platform,nasq_api,nasq_hr.
# EXPECT=full: all six nasq addons (acceptance 3: exactly the 28 keys).
import os
import sys

SYSTEM = {
    'access.users.read', 'access.users.grant', 'access.users.assign_roles',
    'access.users.disable', 'access.users.reset_password', 'access.roles.read',
    'access.roles.manage', 'access.audit.read', 'settings.branding.manage',
}
HR = {
    'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage', 'hr.documents.read', 'hr.documents.manage',
}
PMO_AND_MEETINGS = {
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
    'meetings.read', 'meetings.create', 'meetings.manage',
}
EXPECT = os.environ['EXPECT']
CASES = {
    'core': {
        'installed': {'nasq_core'},
        'absent': {'project', 'hr', 'mail', 'cyan_meeting_minutes', 'nasq_platform', 'nasq_api'},
        'keys': SYSTEM,
        'roles': {'employee', 'system_admin', 'vendor_support'},
    },
    'hr': {
        'installed': {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_hr'},
        'absent': {'project', 'cyan_meeting_minutes', 'nasq_pmo', 'nasq_chat'},
        'keys': SYSTEM | HR,
        'roles': {'employee', 'system_admin', 'vendor_support', 'hr_manager'},
    },
    'full': {
        'installed': {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_hr', 'nasq_pmo', 'nasq_chat'},
        'absent': set(),
        'keys': SYSTEM | HR | PMO_AND_MEETINGS,
        'roles': {'employee', 'system_admin', 'vendor_support', 'hr_manager', 'pmo_manager'},
    },
}
case = CASES[EXPECT]
installed = set(env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))  # noqa: F821
problems = [f'{name} is not installed' for name in sorted(case['installed'] - installed)]
problems += [f'{name} is installed' for name in sorted(case['absent'] & installed)]
service = env['nasq.access.service']  # noqa: F821
catalog = set(service._nasq_capability_map())
keys = set(env['nasq.access.permission'].search([]).mapped('key'))  # noqa: F821
if catalog != case['keys']:
    problems.append(f'catalog {sorted(catalog ^ case["keys"])} differs')
if keys != case['keys']:
    problems.append(f'permission records {sorted(keys ^ case["keys"])} differ')
roles = set(env['nasq.access.role'].search([]).mapped('key'))  # noqa: F821
if roles != case['roles']:
    problems.append(f'roles {sorted(roles)} != {sorted(case["roles"])}')
vendor = env.ref('nasq_core.role_vendor_support')  # noqa: F821
if set(vendor.permission_ids.mapped('key')) != case['keys']:
    problems.append('vendor_support does not hold exactly the installed keys')
for problem in problems:
    print(f'INSTALL_CHECK_FAIL {EXPECT}: {problem}')
print(f'INSTALL_CHECK_FAILED {EXPECT}' if problems else f'INSTALL_CHECK_OK {EXPECT} modules={len(installed)} keys={len(keys)}')
sys.exit(1 if problems else 0)
CHECK
/tmp/nasq-core-decouple/odoo-run.sh install nasq_core_decouple_core_alone nasq_core
EXPECT=core /tmp/nasq-core-decouple/odoo-run.sh shell nasq_core_decouple_core_alone /Users/tariq/code/nasq-core-decouple \
  < /tmp/nasq-core-decouple/check_install.py | tee /tmp/nasq-core-decouple/logs/check-core.log
grep -q 'INSTALL_CHECK_OK core' /tmp/nasq-core-decouple/logs/check-core.log && echo "acceptance 1 ok"
/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_core_alone

/tmp/nasq-core-decouple/odoo-run.sh install nasq_core_decouple_hr_only nasq_core,nasq_platform,nasq_api,nasq_hr
EXPECT=hr /tmp/nasq-core-decouple/odoo-run.sh shell nasq_core_decouple_hr_only /Users/tariq/code/nasq-core-decouple \
  < /tmp/nasq-core-decouple/check_install.py | tee /tmp/nasq-core-decouple/logs/check-hr.log
grep -q 'INSTALL_CHECK_OK hr' /tmp/nasq-core-decouple/logs/check-hr.log && echo "acceptance 2 ok"
/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_hr_only
```

Expected: `ODOO_RUN_INSTALL_OK` twice, `INSTALL_CHECK_OK core modules=... keys=9`, `acceptance 1 ok`, `INSTALL_CHECK_OK hr modules=... keys=17`, `acceptance 2 ok`. An `INSTALL_CHECK_FAIL` line names the module, key or role that is wrong.

- [ ] **Step 6: Empty R1 in the architecture baseline**

```bash
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py; echo "exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print('R1', baseline['R1'])
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
PY
```

Expected: `exit=0`, `R1 {}`, totals `R1 0, R2 8, R3 4, R5 8, R7 89, R8 1, R9 68, R10 2`, others 0.

- [ ] **Step 7: Commit**

```bash
git add odoo-addons/nasq_core tools/arch_baseline.json
git status --short
git commit -m "refactor(core): make nasq_core depend on base only"
```

---

### Task 6: External references use the moved role xml ids

**Files:**
- Modify: `tools/shared_saas_lifecycle/test_odoo_effect.py:127-128`, `tools/shared_saas_lifecycle/odoo_effect.py:335`
- Modify: `tools/shared_acceptance_live/seed_tenant.py:23-26`, `tools/shared_acceptance_live/README.md:206-207`
- Modify: `deploy/control-plane-outage/bootstrap.py:34-35`
- Modify: `apps/web/e2e/fixtures/charter-flow.py:9-10,21`, `projects-phase2.py:7-9,18-19`, `project-dashboard.py:9,11`, `project-charts.py:14,21`

**Interfaces:**
- Consumes (Tasks 2, 3): `nasq_hr.role_hr_manager`, `nasq_pmo.role_pmo_manager`; `nasq_core.role_employee` and `nasq_core.role_system_admin` keep their ids.

- [ ] **Step 1: Make the lifecycle test require the new ids**

In `tools/shared_saas_lifecycle/test_odoo_effect.py`, replace:

```python
                if xmlid.startswith('nasq_core.role_'):
                    return SimpleNamespace(id=xmlid.removeprefix('nasq_core.role_'))
```

with:

```python
                role_keys = {
                    'nasq_core.role_system_admin': 'system_admin',
                    'nasq_pmo.role_pmo_manager': 'pmo_manager',
                    'nasq_hr.role_hr_manager': 'hr_manager',
                }
                if xmlid in role_keys:
                    return SimpleNamespace(id=role_keys[xmlid])
```

- [ ] **Step 2: Run it to verify it fails**

```bash
python3 -B -m unittest discover -s tools/shared_saas_lifecycle -p 'test_odoo_effect.py'
```

Expected: FAIL; the generated admin script calls `env.ref('nasq_core.role_pmo_manager')`, which the fake now rejects (`'verified': False`).

- [ ] **Step 3: Update the lifecycle effect**

In `tools/shared_saas_lifecycle/odoo_effect.py`, replace:

```python
            role = env.ref('nasq_core.role_' + key)
```

with:

```python
            role = env.ref({'pmo_manager': 'nasq_pmo', 'hr_manager': 'nasq_hr'}.get(key, 'nasq_core') + '.role_' + key)
```

```bash
python3 -B -m unittest discover -s tools/shared_saas_lifecycle -p 'test_odoo_effect.py'
```

Expected: `OK`.

- [ ] **Step 4: Update the acceptance seed, the outage bootstrap and the e2e fixtures**

In `tools/shared_acceptance_live/seed_tenant.py`, replace:

```python
role_keys = ['system_admin', 'pmo_manager', 'hr_manager']
roles = []
for key in role_keys:
    role = env.ref('nasq_core.role_%s' % key, raise_if_not_found=False)
```

with:

```python
role_xmlids = {
    'system_admin': 'nasq_core.role_system_admin',
    'pmo_manager': 'nasq_pmo.role_pmo_manager',
    'hr_manager': 'nasq_hr.role_hr_manager',
}
role_keys = list(role_xmlids)
roles = []
for key in role_keys:
    role = env.ref(role_xmlids[key], raise_if_not_found=False)
```

In `tools/shared_acceptance_live/README.md`, replace:

```markdown
   `nasq_core.role_system_admin`, `nasq_core.role_pmo_manager`,
   `nasq_core.role_hr_manager` through nasq_core's own model;
```

with:

```markdown
   `nasq_core.role_system_admin`, `nasq_pmo.role_pmo_manager`,
   `nasq_hr.role_hr_manager` through nasq_core's own model;
```

In `deploy/control-plane-outage/bootstrap.py`, replace:

```python
hr_role = env.ref('nasq_core.role_hr_manager')
project_role = env.ref('nasq_core.role_pmo_manager')
```

with:

```python
hr_role = env.ref('nasq_hr.role_hr_manager')
project_role = env.ref('nasq_pmo.role_pmo_manager')
```

In `apps/web/e2e/fixtures/charter-flow.py`, replace:

```python
    ('charter_manager', 'Charter Manager', 'role_pmo_manager'),
    ('charter_reader', 'Charter Reader', 'role_employee'),
```

with:

```python
    ('charter_manager', 'Charter Manager', 'nasq_pmo.role_pmo_manager'),
    ('charter_reader', 'Charter Reader', 'nasq_core.role_employee'),
```

and replace:

```python
            'user_id': user.id, 'role_id': env.ref('nasq_core.' + role).id,
```

with:

```python
            'user_id': user.id, 'role_id': env.ref(role).id,
```

In `apps/web/e2e/fixtures/projects-phase2.py`, replace:

```python
    ('phase2_manager', 'Phase Two Manager', 'role_pmo_manager'),
    ('phase2_reader', 'Phase Two Reader', 'role_employee'),
    ('phase2_no_pmo', 'Phase Two Access Admin', 'role_system_admin'),
```

with:

```python
    ('phase2_manager', 'Phase Two Manager', 'nasq_pmo.role_pmo_manager'),
    ('phase2_reader', 'Phase Two Reader', 'nasq_core.role_employee'),
    ('phase2_no_pmo', 'Phase Two Access Admin', 'nasq_core.role_system_admin'),
```

and replace:

```python
    if not env['nasq.access.assignment'].search_count([('user_id', '=', user.id), ('role_id', '=', env.ref('nasq_core.' + role).id), ('company_id', '=', company.id)]):
        env['nasq.access.assignment']._nasq_access_create([{'user_id': user.id, 'role_id': env.ref('nasq_core.' + role).id, 'company_id': company.id}])
```

with:

```python
    if not env['nasq.access.assignment'].search_count([('user_id', '=', user.id), ('role_id', '=', env.ref(role).id), ('company_id', '=', company.id)]):
        env['nasq.access.assignment']._nasq_access_create([{'user_id': user.id, 'role_id': env.ref(role).id, 'company_id': company.id}])
```

In `apps/web/e2e/fixtures/project-dashboard.py`, replace:

```python
for login, name, role in [('dashboard_manager', 'مدير المشاريع', 'role_pmo_manager'), ('dashboard_other', 'مدير آخر', 'role_pmo_manager'), ('dashboard_reader', 'قارئ المشاريع', 'role_employee')]:
```

with:

```python
for login, name, role in [('dashboard_manager', 'مدير المشاريع', 'nasq_pmo.role_pmo_manager'), ('dashboard_other', 'مدير آخر', 'nasq_pmo.role_pmo_manager'), ('dashboard_reader', 'قارئ المشاريع', 'nasq_core.role_employee')]:
```

and replace:

```python
    env['nasq.access.assignment']._nasq_access_create([{'user_id': user.id, 'role_id': env.ref('nasq_core.' + role).id, 'company_id': company.id}])
```

with:

```python
    env['nasq.access.assignment']._nasq_access_create([{'user_id': user.id, 'role_id': env.ref(role).id, 'company_id': company.id}])
```

In `apps/web/e2e/fixtures/project-charts.py`, replace:

```python
for login, name, role in [('chart_manager', 'مدير المشاريع', 'role_pmo_manager'), ('chart_other', 'مدير آخر', 'role_pmo_manager')]:
```

with:

```python
for login, name, role in [('chart_manager', 'مدير المشاريع', 'nasq_pmo.role_pmo_manager'), ('chart_other', 'مدير آخر', 'nasq_pmo.role_pmo_manager')]:
```

and replace:

```python
        'user_id': user.id, 'role_id': env.ref('nasq_core.' + role).id, 'company_id': company.id,
```

with:

```python
        'user_id': user.id, 'role_id': env.ref(role).id, 'company_id': company.id,
```

- [ ] **Step 5: Verify**

```bash
python3 -B -m py_compile tools/shared_acceptance_live/seed_tenant.py deploy/control-plane-outage/bootstrap.py \
  apps/web/e2e/fixtures/charter-flow.py apps/web/e2e/fixtures/projects-phase2.py \
  apps/web/e2e/fixtures/project-dashboard.py apps/web/e2e/fixtures/project-charts.py && echo compiled
python3 -B -m unittest discover -s deploy -p 'test_*.py'
python3 -B -m unittest discover -s tools/shared_saas_lifecycle -p 'test_*.py'
rg -n "nasq_core\.role_(hr|pmo)_manager|'nasq_core\.' \+ role|nasq_core\.role_%s|'nasq_core\.role_' \+" \
  --glob '!docs/**' --glob '!odoo-addons/nasq_core/migrations/**' . || echo "no stale role ids"
```

Expected: `compiled`, both unittest runs `OK`, `no stale role ids`. (Historical documents under `docs/` keep their wording.)

- [ ] **Step 6: Commit**

```bash
git add tools/shared_saas_lifecycle tools/shared_acceptance_live deploy/control-plane-outage/bootstrap.py apps/web/e2e/fixtures
git status --short
git commit -m "fix(tools): use the moved role xml ids in tools and fixtures"
```

---

### Task 7: Prove the upgrade from release/19.0.1.0.0

This mirrors the CI `upgrade` step (`.woodpecker.yml` lines 88-125) and adds the data assertions the spec requires (acceptance 4). Nothing is committed in this task.

**Files:**
- Create (outside the repo): `/tmp/nasq-core-decouple/upgrade_fixture.py`, `/tmp/nasq-core-decouple/upgrade_assert.py`, `/tmp/nasq-core-decouple/baseline` (temporary detached worktree of the tag)

**Interfaces:**
- Consumes: `MOVED_XMLIDS` from `nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py` (Tasks 2, 3).

- [ ] **Step 1: Write the fixture and assertion scripts**

```bash
cat > /tmp/nasq-core-decouple/upgrade_fixture.py <<'FIXTURE'
# Piped into `odoo-bin shell` on the release/19.0.1.0.0 database, running the release code.
# Creates users and roles that use the moved records, then snapshots ids and grants.
import json
import sys

from odoo import Command

assert env.cr.dbname.startswith('nasq_core_decouple_'), env.cr.dbname  # noqa: F821
SNAPSHOT = '/tmp/nasq-core-decouple/upgrade-before.json'
MODELS = ('res.groups', 'nasq.access.permission', 'nasq.access.role', 'ir.rule', 'ir.model.access')
company = env.company  # noqa: F821
service = env['nasq.access.service']  # noqa: F821
Permission = env['nasq.access.permission']  # noqa: F821
Users = env['res.users'].with_context(no_reset_password=True)  # noqa: F821


def make_user(login, groups):
    return Users.create({
        'name': login, 'login': login, 'password': login + '_pass_123',
        'company_id': company.id, 'company_ids': [Command.set([company.id])],
        'group_ids': [Command.set([env.ref(xmlid).id for xmlid in groups])],  # noqa: F821
    })


custom = env['nasq.access.role'].create({  # noqa: F821
    'name_ar': 'دور مخصص لاختبار الترقية', 'type': 'custom', 'company_id': company.id,
    'permission_ids': [Command.set(Permission.search([('key', 'in', [
        'access.users.read', 'hr.employees.read', 'pmo.projects.read', 'meetings.read',
    ])]).ids)],
})
users = env.ref('base.user_admin')  # noqa: F821
for login, role_xmlid in (
    ('upgrade_hr_manager', 'nasq_core.role_hr_manager'),
    ('upgrade_pmo_manager', 'nasq_core.role_pmo_manager'),
    ('upgrade_employee', 'nasq_core.role_employee'),
    ('upgrade_system_admin', 'nasq_core.role_system_admin'),
):
    user = make_user(login, ['base.group_user'])
    service._nasq_replace_assignments(user, [{'role_id': env.ref(role_xmlid).id, 'company_id': company.id}])  # noqa: F821
    users |= user
custom_user = make_user('upgrade_custom', ['base.group_user'])
service._nasq_replace_assignments(custom_user, [{'role_id': custom.id, 'company_id': company.id}])
legacy = make_user('upgrade_legacy', [
    'base.group_user', 'nasq_core.group_hr_manager', 'nasq_core.group_pmo_manager',
    'nasq_core.group_cap_meetings_read',
])
users |= custom_user | legacy
env.flush_all()  # noqa: F821

env.cr.execute(  # noqa: F821
    "SELECT name, model, res_id, noupdate FROM ir_model_data WHERE module = 'nasq_core' AND model IN %s",
    [MODELS],
)
Assignment = env['nasq.access.assignment']  # noqa: F821
snapshot = {
    'xmlids': {name: [model, res_id, noupdate] for name, model, res_id, noupdate in env.cr.fetchall()},  # noqa: F821
    'permissions': {permission.key: permission.id for permission in Permission.search([])},
    'roles': {role.key: sorted(role.permission_ids.ids) for role in env['nasq.access.role'].search([])},  # noqa: F821
    'users': {
        user.login: {
            'groups': sorted(user.group_ids.ids),
            'roles': sorted(Assignment.search([('user_id', '=', user.id)]).role_id.mapped('key')),
            'capabilities': sorted(service._nasq_capability_keys(user, company=company)),
        }
        for user in users
    },
}
with open(SNAPSHOT, 'w', encoding='utf-8') as handle:
    json.dump(snapshot, handle, ensure_ascii=False, indent=1, sort_keys=True)
env.cr.commit()  # noqa: F821
print(f"UPGRADE_FIXTURE_OK xmlids={len(snapshot['xmlids'])} roles={len(snapshot['roles'])} users={len(snapshot['users'])}")
sys.exit(0)
FIXTURE
cat > /tmp/nasq-core-decouple/upgrade_assert.py <<'ASSERT'
# Piped into `odoo-bin shell` on the upgraded database, running the branch code.
# Spec 3.2 acceptance 4: moved records keep their ids, users keep groups, roles keep grants.
import importlib.util
import json
import sys

from odoo.tools.misc import file_path

SNAPSHOT = '/tmp/nasq-core-decouple/upgrade-before.json'
spec = importlib.util.spec_from_file_location(
    'nasq_core_pre_move_app_xmlids', file_path('nasq_core/migrations/19.0.1.1.0/pre-move_app_xmlids.py'),
)
move = importlib.util.module_from_spec(spec)
spec.loader.exec_module(move)
owner_of = {name: module for module, names in move.MOVED_XMLIDS.items() for name in names}
with open(SNAPSHOT, encoding='utf-8') as handle:
    before = json.load(handle)
company = env.company  # noqa: F821
service = env['nasq.access.service']  # noqa: F821
Permission = env['nasq.access.permission']  # noqa: F821
Assignment = env['nasq.access.assignment']  # noqa: F821
cr = env.cr  # noqa: F821
problems = []

missing = sorted(set(owner_of) - set(before['xmlids']))
if missing:
    problems.append(f'release snapshot lacks moved xml ids {missing}')
for name, expected in sorted(before['xmlids'].items()):
    module = owner_of.get(name, 'nasq_core')
    cr.execute('SELECT model, res_id, noupdate FROM ir_model_data WHERE module = %s AND name = %s', [module, name])
    row = cr.fetchone()
    if row is None or list(row) != expected:
        problems.append(f'{module}.{name}: {row} != {expected}')
    if module != 'nasq_core':
        cr.execute("SELECT 1 FROM ir_model_data WHERE module = 'nasq_core' AND name = %s", [name])
        if cr.fetchone():
            problems.append(f'nasq_core.{name} still exists next to {module}.{name}')

permissions = {permission.key: permission.id for permission in Permission.search([])}
if permissions != before['permissions'] or len(permissions) != 28:
    problems.append(f'permission ids changed: {sorted(set(permissions.items()) ^ set(before["permissions"].items()))}')
catalog = service._nasq_capability_map()
if set(catalog) != set(permissions):
    problems.append('capability definitions differ from permission records')
owners = {}
for key, item in catalog.items():
    owners[item['owner']] = owners.get(item['owner'], 0) + 1
if owners != {'nasq_core': 9, 'nasq_hr': 8, 'nasq_pmo': 11}:
    problems.append(f'owners {owners}')
for permission in Permission.search([]):
    if permission.group_xmlid.split('.')[0] != catalog[permission.key]['owner']:
        problems.append(f'{permission.key} group {permission.group_xmlid} not owned by {catalog[permission.key]["owner"]}')
    if not env.ref(permission.group_xmlid, raise_if_not_found=False):  # noqa: F821
        problems.append(f'{permission.key} group {permission.group_xmlid} does not resolve')

roles = {role.key: sorted(role.permission_ids.ids) for role in env['nasq.access.role'].search([])}  # noqa: F821
if roles != before['roles']:
    problems.append(f'role grants changed: before={before["roles"]} after={roles}')

for login, expected in sorted(before['users'].items()):
    user = env['res.users'].with_context(active_test=False).search([('login', '=', login)])  # noqa: F821
    actual = {
        'groups': sorted(user.group_ids.ids),
        'roles': sorted(Assignment.search([('user_id', '=', user.id)]).role_id.mapped('key')),
        'capabilities': sorted(service._nasq_capability_keys(user, company=company)),
    }
    if actual != expected:
        problems.append(f'{login}: before={expected} after={actual}')

for problem in problems:
    print(f'UPGRADE_PROOF_FAIL {problem}')
print('UPGRADE_PROOF_FAILED' if problems else (
    f"UPGRADE_PROOF_OK xmlids={len(before['xmlids'])} roles={len(roles)} users={len(before['users'])}"
))
sys.exit(1 if problems else 0)
ASSERT
```

- [ ] **Step 2: Install the release tag and create the fixture data**

```bash
git worktree add --detach /tmp/nasq-core-decouple/baseline release/19.0.1.0.0
git -C /tmp/nasq-core-decouple/baseline log -1 --oneline
/tmp/nasq-core-decouple/odoo-run.sh baseline nasq_core_decouple_upgrade nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat
/tmp/nasq-core-decouple/odoo-run.sh shell nasq_core_decouple_upgrade /tmp/nasq-core-decouple/baseline \
  < /tmp/nasq-core-decouple/upgrade_fixture.py | tee /tmp/nasq-core-decouple/logs/upgrade-fixture.log
grep -q UPGRADE_FIXTURE_OK /tmp/nasq-core-decouple/logs/upgrade-fixture.log && echo "fixture ok"
```

Expected: `f9b961b5` for the tag, `ODOO_RUN_BASELINE_OK`, `UPGRADE_FIXTURE_OK xmlids=... roles=6 users=7`, `fixture ok`. (`nasq_platform` does not exist at the tag; the upgrade installs it, as in CI.)

- [ ] **Step 3: Upgrade with the branch code**

```bash
/tmp/nasq-core-decouple/odoo-run.sh upgrade nasq_core_decouple_upgrade nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat
grep -n "pre-move_app_xmlids" /tmp/nasq-core-decouple/logs/nasq_core_decouple_upgrade-upgrade.log
/tmp/nasq-core-decouple/odoo-run.sh shell nasq_core_decouple_upgrade /Users/tariq/code/nasq-core-decouple \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/nasq-core-decouple/logs/upgrade-smoke.log
grep -q UPGRADE_SMOKE_OK /tmp/nasq-core-decouple/logs/upgrade-smoke.log && echo "smoke ok"
```

Expected: `ODOO_RUN_UPGRADE_OK` (the log guard found no `ERROR`/`CRITICAL` line), at least one log line naming `pre-move_app_xmlids` (the migration ran), `UPGRADE_SMOKE_OK installed=6`, `smoke ok`.

- [ ] **Step 4: Assert that nothing was lost**

```bash
/tmp/nasq-core-decouple/odoo-run.sh shell nasq_core_decouple_upgrade /Users/tariq/code/nasq-core-decouple \
  < /tmp/nasq-core-decouple/upgrade_assert.py | tee /tmp/nasq-core-decouple/logs/upgrade-assert.log
grep -q UPGRADE_PROOF_OK /tmp/nasq-core-decouple/logs/upgrade-assert.log && echo "upgrade proof ok"
```

Expected: `UPGRADE_PROOF_OK xmlids=... roles=6 users=7` and `upgrade proof ok`: every moved row kept its model, `res_id` and `noupdate` under the new module, no `nasq_core.` copy is left, the 28 permission ids are unchanged and owned 9/8/11 by `nasq_core`/`nasq_hr`/`nasq_pmo`, every role kept its permission ids, and every fixture user (including `admin` and the legacy-group user) kept its groups, role assignments and capability keys. Any `UPGRADE_PROOF_FAIL` line is a blocker: stop and report it with the log.

- [ ] **Step 5: Clean up**

```bash
/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_upgrade
git worktree remove /tmp/nasq-core-decouple/baseline
git worktree list
```

Expected: the baseline worktree is gone; the main checkout and `/Users/tariq/code/nasq-core-decouple` remain. Keep the logs for the report.

---

### Task 8: Documentation, roadmap and final gates

**Files:**
- Modify: `CLAUDE.md:95,104-109` and the "Odoo addon and API rules" list
- Modify: `README.md:99-102`
- Modify: `docs/superpowers/plans/2026-10-05-architecture-roadmap.md:16,53-55`

- [ ] **Step 1: Update the ownership text**

In `CLAUDE.md`, replace:

```markdown
- `odoo-addons/nasq_core` owns the capability catalog, roles, assignments, access audit, migration and identity protection.
```

with:

```markdown
- `odoo-addons/nasq_core` depends on `base` only. It owns the access service, the nine system capabilities, the
  built-in `employee`, `system_admin` and `vendor_support` roles, assignments, access audit, migration and identity
  protection. Applications add their capabilities to the catalog through `nasq.access.service` hooks.
```

replace:

```markdown
- `odoo-addons/nasq_hr` owns the HR directory, departments, documents, HR
  serializers/controllers, and `/api/v1/hr/*` (employee ids are
  `hr.employee` ids).
- `odoo-addons/cyan_meeting_minutes` provides the preserved LGPL meeting engine.
  Nasq meeting routes, serializers, task conversion and recipient notifications
  extend it through `nasq_pmo`; `nasq_core` owns meeting capability grants.
```

with:

```markdown
- `odoo-addons/nasq_hr` owns the HR directory, departments, documents, HR
  serializers/controllers, `/api/v1/hr/*` (employee ids are
  `hr.employee` ids), and the eight `hr.*` capabilities, their groups and the
  `hr_manager` role.
- `odoo-addons/cyan_meeting_minutes` provides the preserved LGPL meeting engine.
  Nasq meeting routes, serializers, task conversion and recipient notifications
  extend it through `nasq_pmo`, which also owns the eight `pmo.*` and three
  `meetings.*` capabilities, their groups, the `pmo_manager` role and the meeting
  record rules until `nasq_meetings` exists (spec 3.2.1).
```

In the "Odoo addon and API rules" list of `CLAUDE.md`, replace:

```markdown
- Serializers whitelist fields explicitly: shared shapes belong in
```

with:

```markdown
- An application registers its capabilities by extending `nasq.access.service`
  through `super()`: `_nasq_capability_definitions` (with `owner` set to the
  addon), `_nasq_permission_dependencies`, `_nasq_builtin_role_grants`, and when
  needed `_nasq_legacy_capability_keys`, `_nasq_record_company`,
  `_nasq_contextual_capability`, `_nasq_identity_extra`,
  `_nasq_customer_actor_keys` and `_nasq_legacy_admin_roles`. Its data declares
  its groups, permission records and role, then calls
  `_nasq_configure_permission_dependencies` and `_nasq_repair_builtin_role_grants`.
  Moving an xml id between addons needs a `pre-` migration that renames the
  `ir_model_data` row.
- Serializers whitelist fields explicitly: shared shapes belong in
```

In `README.md`, replace:

```markdown
- `odoo-addons/nasq_core` owns groups and branding defaults;
```

with:

```markdown
- `odoo-addons/nasq_core` depends on `base` only and owns the access service,
  the system capabilities and branding defaults; each application owns its own
  capabilities, groups and roles;
```

- [ ] **Step 2: Run the final gates**

```bash
cd /Users/tariq/code/nasq-core-decouple
ruff check odoo-addons
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/arch_policy.py --write-baseline
git diff --exit-code tools/arch_baseline.json && echo "baseline already current"
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/api_surface.py
diff -u /tmp/nasq-core-decouple/openapi-base.json docs/api/openapi.json && echo "API surface unchanged"
git checkout -- docs/api/openapi.json
npm test
```

Expected: `All checks passed!`, `migration_guard exit=0`, `baseline already current`, `arch_policy exit=0`, `git_policy exit=0`, `API surface unchanged`, `npm test` green. A non-empty `diff` is a blocker (this phase must not change any route).

- [ ] **Step 3: Run all six addons' tests and the full-install key check**

```bash
/tmp/nasq-core-decouple/odoo-run.sh test nasq_core_decouple_final \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-core-decouple/odoo-run.sh install nasq_core_decouple_full nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat
EXPECT=full /tmp/nasq-core-decouple/odoo-run.sh shell nasq_core_decouple_full /Users/tariq/code/nasq-core-decouple \
  < /tmp/nasq-core-decouple/check_install.py | tee /tmp/nasq-core-decouple/logs/check-full.log
grep -q 'INSTALL_CHECK_OK full' /tmp/nasq-core-decouple/logs/check-full.log && echo "acceptance 3 ok"
/tmp/nasq-core-decouple/odoo-run.sh drop nasq_core_decouple_full
```

Expected: `0 failed, 0 error(s) of N tests` with N at least the Task 0 count plus the new tests, `ODOO_RUN_TEST_OK nasq_core_decouple_final`, `INSTALL_CHECK_OK full modules=... keys=28`, `acceptance 3 ok`. Compare any failure with the Task 0 list; only pre-existing failures are acceptable, and they must be named in the report.

- [ ] **Step 4: Update the roadmap**

In `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, replace:

```markdown
| 2 | فك الأساس | `nasq_core` لا يعرف أي تطبيق | 1 | لم تبدأ |
```

with:

```markdown
| 2 | فك الأساس | `nasq_core` لا يعرف أي تطبيق | 1 | منفذة على `codex/core-decouple-apps`، بانتظار الدمج |
```

and replace:

```markdown
## المرحلة 2 — فك الأساس عن التطبيقات

**الهدف:** أن يعتمد `nasq_core` على `base` فقط، فيصبح إضافة تطبيق جديد ممكناً دون تعديل الأساس.
```

with:

```markdown
## المرحلة 2 — فك الأساس عن التطبيقات

**الخطة:** [2026-10-05-phase-2-decouple-nasq-core.md](2026-10-05-phase-2-decouple-nasq-core.md)

**الهدف:** أن يعتمد `nasq_core` على `base` فقط، فيصبح إضافة تطبيق جديد ممكناً دون تعديل الأساس.

**خط الأساس بعد التنفيذ** (المجموع): R1 0، R2 8 (كلها في `nasq_platform/models/entitlement_service.py`: مفاتيح
المصطلحات والمزايا)، R7 89، R9 68؛ الباقي كما في المرحلة 1.
```

If Task 5 Step 6 or Step 2 above printed different totals, write the printed numbers instead and explain the difference in your report.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/plans/2026-10-05-architecture-roadmap.md
git status --short
git commit -m "docs(docs): record phase 2 ownership and roadmap status"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
git log --oneline main..HEAD
```

Expected: a clean status after the commit, `git_policy exit=0`, eight commits on the branch (plan, Tasks 1–6, Task 8).

- [ ] **Step 6: Report**

Report to the orchestrator, without merging or pushing: the branch and its commits; the Task 0 and Task 8 test counts; the acceptance results (core alone, HR without `project`, 28 keys, API diff empty, upgrade proof, all six addons' tests, `arch_policy --base main`, `git_policy --base main`); the old and new baseline totals; the untracked copy of this plan in the main checkout that must be removed before the merge; and these residual risks:

- A database that has `nasq_core` but never had `nasq_pmo` keeps the renamed meeting rules as orphans under `nasq_pmo`; they call `res.users._nasq_meeting_access_domain`, which only `nasq_pmo` defines, so reading Cyan meetings through the Odoo back office would fail there. No such database exists (every release install includes `nasq_pmo`), and customers do not open Odoo.
- The development database `odoo19` is still at the old layout. Its upgrade belongs to the owner after the merge (`-u nasq_core --no-http --stop-after-init` upgrades every dependent addon).
- `_nasq_apply_legacy_admin_snapshot` grants only `system_admin` on a database that never finished the v1 access migration (see Deviations, item 2).
