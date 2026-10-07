# Phase 3a — Packages Engine (release install, release-complete policies) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every application of the release is installed in every shared-SaaS tenant and a plan («باقة») controls only feature keys and limits: a policy or compiled entitlement always carries every key of every release application (closed apps `false` / `0`), so downgrading closes an application without an install or a rejected write, and upgrading reopens it without an install job.

**Architecture:** Odoo stays strict (`_nasq_validate_features` unchanged). A new Odoo method `_nasq_close_unlisted_features` lets the operator scripts complete a target with default-closed values, which fixes the latent downgrade failure (ruling E11) and, called from `nasq.tenant.profile._register_hook`, registers a newly installed application's keys closed on an existing tenant (G5). A schema-3 catalog (`platform_v3.json`) is parsed identically in TypeScript (`feature-descriptor.ts`) and Python (`managed_policy.py`): every tier composes to the release module list and a release-complete feature map, pinned by a shared fixture. The commercial compiler becomes `commercial-compiler/2` (release modules, release-complete features). Managed create verification compares with the installation closure the Python readback reports, and the package administrator's roles follow the entitlement.

**Tech Stack:** Odoo 19 Community (`/Users/tariq/code/odoo`, read-only), Python 3 (`tools/`), PostgreSQL scratch databases, TypeScript + Zod + Vitest (`packages/commercial-contracts`, `apps/control-plane`), Nuxt 4 + vue-i18n + Vitest (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-10-05-nasq-reference-architecture-and-git-workflow-design.md` §3.6 (amended by the owner decisions of 2026-10-07), roadmap `docs/superpowers/plans/2026-10-05-architecture-roadmap.md` «المرحلة 3» and residual risks (أ)/(ب) of 2ب-2, `docs/superpowers/specs/2026-10-02-package-management-design.md`, `docs/superpowers/specs/2026-10-02-saas-commercial-product.md`, `docs/superpowers/specs/nasq-cp0-commercial-contracts.md`. Rulings: owner O1–O5, engineering E2–E11, G5 (folded into Global Constraints and Deviations). Model for structure, runner and gates: `docs/superpowers/plans/2026-10-07-open-app-lists.md`.

**This is plan 3a of two.** Phase 3 is split because one document holding every code step of the six ruled groups would exceed what one reviewer can gate (it touches Odoo, tools, the control plane, the commercial contracts, CI and the web). Both plans run in the same worktree on the same branch, in order: **3a** = ruled groups (1) Odoo downgrade test + generic key registration, (2) catalog v3 + completeness + release module list, (3) release-complete compile + compiler v2 + `worker.ts:73` + admin roles + `ALLOWED_MODULES`; **3b** (`2026-10-07-phase-3b-packages-commerce.md`) = groups (4) usage collector, (5) Track A retirement + vocabulary, (6) spec 3.6 acceptance + docs. 3a leaves every suite green and is mergeable alone; 3b starts from 3a's last commit.

## Deviations from rulings

1. **E11's fix lands in Task 1 in Odoo + the apply script, before the release-complete compiler (Task 5).** The latent failure is in `tools/shared_saas_lifecycle/subscription_effect.py` `_APPLY_BODY`, which back-fills only booleans (`:174-179`). The Odoo test cannot execute that script (a `TransactionCase` forbids `cr.commit()`, `odoo/tests/common.py:1071`), so Task 1 first reproduces the failure with the **real** generated script on a scratch database through `odoo-run.sh shell` (Step 2), then adds `nasq.entitlement.service._nasq_close_unlisted_features` (installed application keys a target omits → `False`/`0`, platform keys never filled) and makes the apply script call it instead of its inline loop. The Odoo validator is not relaxed (E2): `test_incomplete_target_is_still_refused` pins it. After Task 5 the control plane always sends complete maps, so the completion only matters for keys newer than a tenant's pinned release (the G5 case).
2. **G5 runs from `_register_hook`, not from each application's `post_init_hook`.** At `post_init_hook` time the new module is still `to install` (`odoo/modules/loading.py:239-268` sets `installed` after the hook), and a hook per application would not cover a key an application adds in a later version (spec 3.6 level 2 keys). `nasq.tenant.profile._register_hook` runs once per registry load (`loading.py:588-595`), writes only when an initialized policy lacks an installed application's key, never grants, and logs (does not raise) when a platform key is missing, so a broken policy cannot stop the server.
3. **E4's "one canonical release module list" is the install closure of the newest schema-3 catalog, printed by `tools/catalog_check.py --release-modules`.** `.woodpecker.yml` uses that command; four copies that run where the repository tools are not available (`deploy/provision.sh`, `deploy/woodpecker/image.yml`, `tools/shared_acceptance_live/up.sh`, `deploy/check_isolated.py`) keep their literal list and `catalog_check` fails when any of them differs. The vendor-console installs in `tools/shared_saas_lifecycle/lifecycle.py:168` and `tools/saas_commercial_acceptance/commercial_lifecycle.py:180` (`core,platform,api,pmo,hr`) are a different database and stay.
4. **E2's "same derivation in TS and Python" covers the catalog policy derivation; the commercial compiler is TypeScript only.** Python never compiles plans (it receives the compiled snapshot), so the shared fixture `deploy/catalog/fixtures/release_features.json` pins `deriveCatalogPolicy` (TS) against `_catalog_compositions` (Python). The compiler's completion reads the same `CatalogRelease.applications` and is pinned by `commercial-entitlements.test.ts`.
5. **An included application's limit that no bundle sets keeps the catalog value (`ceiling ?? null`), a left-out application's limits are `0`.** E3 fixes only the closed value. Refusing an unset limit would break every existing bundle created with `domain_limits: {}` (for example `tools/saas_commercial_acceptance/commercial-journey.spec.mjs`), and `null` is the catalog's own meaning of `limit:<key>` (feature-descriptor grammar, `managed_policy.py:20`). Listed as an owner decision.
6. **The paid enrollment still provisions the `core` composition and the reconfigure applies the plan** (`commercial/fulfillment.ts:106-112`). With v3 the `core` composition already installs the whole release (closed), so the reconfigure never installs (`missing` is empty). The administrator therefore receives only `system_admin` at provisioning on that path, as today; granting application manager roles after a reconfigure is not part of this phase (recorded in the roadmap by 3b).

**Inventory corrections found while reading the source (`main` `9336317e`):**
- `tools/catalog_check.py` imports nothing from `nasq_cli` today; Task 4 imports `nasq_cli.module_closure` (allowed by `test_checker_never_imports_network_odoo_or_subprocess`).
- `apps/control-plane/src/commercial/usage.ts` `getUsage` is called by `customer-http.ts:85` and `routes-b.ts:53` with limit keys (`users.limit`), while snapshots are stored with unit keys (`users`), so customer usage is always `not_collected` today. 3b fixes this with the collector.
- The admin role script (`odoo_effect.py:329-332`) assigns `pmo_manager` / `hr_manager`; `system_admin` already holds meeting permissions (`nasq_meetings/models/meeting_access_service.py:37`), so a naive "every permission domain must be entitled" rule would drop `system_admin` when meetings are closed. Task 7 uses "a role with any platform permission is always assigned".

## Global Constraints

- Owner O1/O4: all release applications installed in every shared-SaaS tenant database; a plan controls feature keys and limits only. No customers exist before the first server deploy: no live-tenant migration tooling.
- Owner O5: names, prices, cadences, limit numbers are commercial and never set by code. Seed or fixture values appear in tests only.
- E2: release-complete features are computed in the control plane against the tenant's pinned release: every boolean of every release application present (`false` when not entitled), every limit present (`0` when closed). `_nasq_validate_features` is not relaxed.
- E3: a closed application's limit is `0`.
- E4: `deploy/catalog/solutions/platform_v3.json` (`schema_version: 3`) is added; `platform.json` and `platform_v2.json` are not edited (their digests pin existing rows).
- E6: `entitlement.modules` is the release module list (`commercial-compiler/2`) and is never used for display or roles.
- E7: `worker.ts:73` compares installed `nasq_*` modules with `expected_modules` returned by the Python readback.
- E9: the package administrator's roles follow the entitlement; `ALLOWED_MODULES` is removed.
- Capability keys unchanged (the same 28). No new `sudo()` and no new SQL on Odoo tables: `python3 -B tools/arch_policy.py --base main` stays exit 0 with the totals of Task 0 Step 5; `tools/arch_baseline.json` and `tools/arch_layers.json` are not edited.
- No addon version changes (code-only Odoo changes; `docs/migrations.md` «التغييرات البرمجية البحتة لا ترفع الإصدار»). Do not edit a released migration.
- Contracts stay backward compatible for the current web build: `entitlementSnapshotSchema` and `sharedPolicySchema` are unchanged (they already accept `false` and any module list).
- Every new Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; `ruff check odoo-addons` stays clean.
- Web: user-facing strings through `t()` in `ar` and `en`; logical Tailwind classes only; new util names (`entitledFeaturePrefixes`, `entitledSelections`) are unused in Nuxt's flat `utils/` namespace today.
- Odoo scratch databases match `nasq_scratch_packages_[a-z0-9_]+`, plus the one fixed acceptance tenant `nasq_scratch_ffff0000000000000000000000000003` of plan 3b (the effect scripts accept only `nasq_scratch_<32 hex>`); the runner refuses any other name and any name containing `odoo19`. Never run anything against `odoo19`. Odoo HTTP port 8239.
- Control-plane live suites run only with `CONTROL_TEST_DATABASE_URL=postgres://tariq@127.0.0.1:5432/nasq_control_scratch_packages` through `/tmp/nasq-packages/cp-live.sh`, never against any non-scratch database.
- Work only in `/Users/tariq/code/nasq-packages` on branch `codex/cp-packages`. Do not touch the main checkout's uncommitted owner changes (`.gitignore`, `docs/WORKSPACE.md`, `package.json`, `package-lock.json`, untracked `.agents/`, `.planning/`, `docs/e2e.md`, `e2e.config.ts`, `e2e/`, `plans/`).
- Commit subjects are `type(scope): subject`, at most 72 characters, type in `feat fix refactor perf test docs ci build chore`, scope in `core platform api pmo hr chat meetings web cp deploy tools docs ci`. Every commit is `git commit -m "<subject>" -m "<TRAILER>"`, typing the exact trailer line your dispatch gives in place of `<TRAILER>`. Do not merge, push, delete branches or change Git config.
- A full ten-addon Odoo run takes 10–25 minutes. Start it in the background and wait on the log; never shorten a run by dropping modules from `-i`. Never `rm` a variable path; the runners only drop guarded scratch databases.

## Review Focus

- **A feature map missing one key, so Odoo rejects the policy write** (for example a catalog tier that forgets `projects.max_projects`, or a compile path still on `commercial-compiler/1` semantics). Expected: every schema-3 composition and every compiled snapshot holds every release key. Pinned by the `release_features.json` cases in both runtimes (Task 3), the `catalog_check` completeness rule (Task 4), `closes every application the plan leaves out` (Task 5) and the scratch reproduction re-run (Task 1 Step 9).
- **A downgrade deletes or hides data.** Expected: rows stay, reads stay open through `retained_read_features`, writes answer 403 `feature_not_included`. Pinned by `test_downgrade_without_pmo_closes_writes_keeps_reads_and_data` (Task 1), which counts projects and tasks before and after and reads the list over HTTP.
- **An upgrade needs an install job.** Expected: reopening `pmo.enabled` makes `POST /api/v1/projects` succeed with the installed module set unchanged. Pinned by the same Task 1 test (`installed_before == installed_after`) and by `test_subscription_effect.py` `test_release_complete_target_installs_nothing` (Task 5).
- **Registration at registry load grants something or crashes the server.** Expected: only missing keys of installed applications are added, always closed; existing values never change; a policy it cannot complete is logged and left alone. Pinned by the five tests of `test_feature_registration.py` (Task 2).
- **Managed create verification accepts a wrong install or rejects the true closure.** Expected: the auto-installed bridge and implied services (`nasq_notify`, `nasq_directory`, `nasq_meetings_pmo`) are accepted only when the Python readback reports them; a missing `expected_modules`, one without a policy module, or an extra installed module is refused. Pinned by the new `worker-managed.test.ts` cases (Task 6).

## File Structure

| File | Responsibility |
|---|---|
| `odoo-addons/nasq_platform/models/entitlement_service.py` (modify) | `_nasq_close_unlisted_features`, `_nasq_entitled_admin_roles` |
| `odoo-addons/nasq_platform/models/tenant_profile.py` (modify) | `_register_hook` → `_nasq_register_missing_features` |
| `odoo-addons/nasq_platform/tests/test_feature_registration.py` (create), `tests/__init__.py` | Registration tests |
| `odoo-addons/nasq_pmo/tests/test_package_change.py` (create), `tests/__init__.py` | Downgrade/upgrade with pmo installed; admin roles by entitlement |
| `tools/shared_saas_lifecycle/subscription_effect.py`, `test_subscription_effect.py` | Apply script uses the Odoo completion |
| `packages/commercial-contracts/src/commercial/feature-descriptor.ts`, `__tests__/release-features.test.ts` | Schema 3, `releaseModules`, `deriveCatalogPolicy` |
| `tools/nasq_cli/managed_policy.py`, `tools/test_managed_policy.py` | Python mirror of schema 3 |
| `deploy/catalog/fixtures/release_features.json` (create), `descriptor_parity.json` (modify) | Shared fixtures |
| `apps/control-plane/src/shared/catalog-features.ts`, `shared/job-store.ts`, `packages.ts`, `worker.ts` | Policy modules from the shared derivation |
| `deploy/catalog/solutions/platform_v3.json` (create), `deploy/catalog/schema/solution.schema.json` | Catalog v3 |
| `tools/catalog_check.py`, `tools/test_catalog_check.py` | Completeness, release modules, copy guard |
| `apps/control-plane/src/shared/catalog-source.ts` (+test), `tools/nasq_cli/catalog_source.py`, `tools/test_catalog_source.py` | Register v3 |
| `.woodpecker.yml` | Module lists from `catalog_check.py --release-modules` |
| `packages/commercial-contracts/src/commercial/entitlements.ts`, `__tests__/commercial-entitlements.test.ts` | Compiler 2 |
| `apps/web/app/utils/entitlementApps.ts` (create) + test, `pages/subscription/index.vue`, `pages/vendor/customers/[id].vue`, `pages/vendor/customers/index.vue`, `i18n/locales/{ar,en}/subscription.json` | Display entitled apps from features |
| `tools/nasq_cli/managed_verify.py`, `managed_runtime.py`, `tools/test_managed_runtime.py`, `apps/control-plane/src/worker.ts`, `__tests__/worker-managed.test.ts`, `__tests__/worker-v2-policy.test.ts` | `expected_modules` |
| `tools/shared_saas_lifecycle/odoo_effect.py`, `test_odoo_effect.py` | Admin roles by entitlement; generic module validation |

---

### Task 0: Worktree, scratch runners and baselines

**Files:**
- Create (outside the repo): `/tmp/nasq-packages/odoo-run.sh`, `/tmp/nasq-packages/cp-live.sh`, `/tmp/nasq-packages/scratch-only.conf`
- Create: `docs/superpowers/plans/2026-10-07-phase-3a-packages-engine.md`, `docs/superpowers/plans/2026-10-07-phase-3b-packages-commerce.md` (copies of the two plans)

**Interfaces:**
- Produces: `/tmp/nasq-packages/odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | shell DB ROOT | drop DB` and `/tmp/nasq-packages/cp-live.sh [vitest args]`. Module and tag lists used by every later task (shell variables do not persist between commands, so every command spells them out):

```
TEN=nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat
TEN_TAGS=/nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
HR=nasq_core,nasq_platform,nasq_api,nasq_hr
HR_TAGS=/nasq_core,/nasq_platform,/nasq_api,/nasq_hr
MEET=nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings
MEET_TAGS=/nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
```

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/tariq/code/nasq
git fetch origin
git rev-parse main origin/main
git worktree add -b codex/cp-packages /Users/tariq/code/nasq-packages main
cd /Users/tariq/code/nasq-packages
git status --short
git log -1 --oneline
npm ci --ignore-scripts
npm -w apps/web run postinstall
```

Expected: empty status; `main` at `9336317e` or later (record it). If `main` and `origin/main` differ, continue from local `main` and report it. Run every later command from `/Users/tariq/code/nasq-packages` unless a step says otherwise.

- [ ] **Step 2: Create the Odoo scratch runner**

```bash
mkdir -p /tmp/nasq-packages/logs /tmp/nasq-packages/data /tmp/nasq-packages/classification
printf '[options]\nlist_db = False\n' > /tmp/nasq-packages/scratch-only.conf
cat > /tmp/nasq-packages/odoo-run.sh <<'RUNNER'
#!/usr/bin/env bash
# Phase 3 packages scratch runner (plans 2026-10-07-phase-3a/3b).
# Every database must match nasq_scratch_packages_[a-z0-9_]+; odoo19 is never touched.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
WORKTREE=/Users/tariq/code/nasq-packages
SCRATCH=/tmp/nasq-packages
CONF="$SCRATCH/scratch-only.conf"
HTTP_PORT=8239
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-tariq}"

# Plan 3b's acceptance tenant: the effect scripts accept only nasq_scratch_<32 hex>, so this one
# fixed name is allowed next to the plan prefix.
ACCEPT_DB=nasq_scratch_ffff0000000000000000000000000003

die() { echo "odoo-run: $*" >&2; exit 2; }
guard_db() {
  [[ "$1" != *odoo19* ]] || die "refusing database '$1' (odoo19 is the development database)"
  [[ "$1" == "$ACCEPT_DB" || "$1" =~ ^nasq_scratch_packages_[a-z0-9_]+$ ]] \
    || die "refusing database '$1' (scratch names match nasq_scratch_packages_[a-z0-9_]+ or $ACCEPT_DB)"
}
guard_root() {
  [[ "$1" == "$WORKTREE" ]] || die "refusing addons root '$1'"
  [[ -d "$1/odoo-addons" ]] || die "no odoo-addons under '$1'"
}
addons() { echo "$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$1/odoo-addons"; }
classify() {  # a new classification file per run: classification.py opens its output exclusively
  local out="$SCRATCH/classification/$1-$(date +%Y%m%d%H%M%S)-$$-$RANDOM.json"
  python3 "$WORKTREE/deploy/classification.py" fixture --database "$1" --mode saas --output "$out"
  export NASQ_COMMERCIAL_CONFIG="$out"
}
latest_classification() {  # the newest classification written for DB (shell reuses the base install's)
  ls -t "$SCRATCH/classification/$1-"*.json 2>/dev/null | head -n 1
}
probe() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -Atc \
    "SELECT 'INSTALLED_PROBE ' || coalesce(string_agg(name, ',' ORDER BY name), '') FROM ir_module_module WHERE state = 'installed' AND name IN ('nasq_chat', 'nasq_hr', 'nasq_meetings', 'nasq_meetings_pmo', 'nasq_pmo', 'nasq_registry_probe', 'project')"
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
    probe "$db"
    dropdb --if-exists "$db"
    echo "ODOO_RUN_TEST_OK $db" ;;
  base)  # base DB ROOT MODULES: install without tests, keep the database
    db=$1 root=$2 modules=$3
    guard_db "$db"
    guard_root "$root"
    dropdb --if-exists "$db"
    classify "$db"
    run_odoo "$db" "$root" "$SCRATCH/logs/$db-base.log" -i "$modules" --without-demo=all --stop-after-init
    probe "$db"
    echo "ODOO_RUN_BASE_OK $db" ;;
  shell)  # shell DB ROOT < script.py
    db=$1 root=$2
    guard_db "$db"
    guard_root "$root"
    NASQ_COMMERCIAL_CONFIG="$(latest_classification "$db")"
    [[ -n "$NASQ_COMMERCIAL_CONFIG" ]] || die "no classification for '$db' (run base first)"
    export NASQ_COMMERCIAL_CONFIG
    "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell -c "$CONF" --addons-path="$(addons "$root")" \
      --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
      -d "$db" --db-filter="^${db}\$" --data-dir="$SCRATCH/data" --no-http ;;
  serve)  # serve DB: HTTP server on 8239 for the acceptance in plan 3b (foreground; stop with kill)
    db=$1
    guard_db "$db"
    NASQ_COMMERCIAL_CONFIG="$(latest_classification "$db")"
    [[ -n "$NASQ_COMMERCIAL_CONFIG" ]] || die "no classification for '$db' (run base first)"
    export NASQ_COMMERCIAL_CONFIG
    run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db-serve.log" ;;
  drop)
    guard_db "$1"
    dropdb --if-exists "$1" ;;
  *)
    die "usage: odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | shell DB ROOT | serve DB | drop DB" ;;
esac
RUNNER
chmod +x /tmp/nasq-packages/odoo-run.sh
bash -n /tmp/nasq-packages/odoo-run.sh && echo runner-ok
/tmp/nasq-packages/odoo-run.sh drop odoo19 || echo "guard refused odoo19 as expected"
/tmp/nasq-packages/odoo-run.sh drop nasq_scratch_packages_odoo19_copy || echo "guard refused an odoo19 lookalike as expected"
/tmp/nasq-packages/odoo-run.sh drop nasq_scratch_openlists_x || echo "guard refused another plan's prefix as expected"
```

Expected: `runner-ok`, then three `odoo-run: refusing database ...` lines, each followed by its `guard refused ... as expected` line.

- [ ] **Step 3: Create the control-plane live-suite runner**

```bash
cat > /tmp/nasq-packages/cp-live.sh <<'CPLIVE'
#!/usr/bin/env bash
# Runs the control-plane suites against the one scratch control database of this plan,
# created fresh and dropped afterwards. Never any other database.
set -euo pipefail
DB=nasq_control_scratch_packages
[[ "$DB" =~ ^nasq_control_scratch_[a-z0-9]+$ ]] || { echo "cp-live: refusing $DB" >&2; exit 2; }
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-tariq}"
cd /Users/tariq/code/nasq-packages
dropdb --if-exists "$DB"
createdb "$DB"
set +e
CONTROL_TEST_DATABASE_URL="postgres://$PGUSER@$PGHOST:$PGPORT/$DB" npm -w apps/control-plane test -- "$@"
code=$?
set -e
dropdb --if-exists "$DB"
echo "CP_LIVE_EXIT $code"
exit $code
CPLIVE
chmod +x /tmp/nasq-packages/cp-live.sh
bash -n /tmp/nasq-packages/cp-live.sh && echo cp-live-ok
```

Expected: `cp-live-ok`. If the local PostgreSQL needs a password, export `PGPASSWORD` in the shell before calling; never put it on a command line or in the script.

- [ ] **Step 4: Check the port and the database names are free**

```bash
lsof -nP -iTCP:8239 -sTCP:LISTEN || echo "port 8239 free"
psql -h 127.0.0.1 -U tariq -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'nasq_scratch_packages_%' OR datname IN ('nasq_control_scratch_packages', 'nasq_scratch_ffff0000000000000000000000000003')"
```

Expected: `port 8239 free` and no database listed. If 8239 is taken, change `HTTP_PORT` in the runner and report it. If a database is listed, stop and report it.

- [ ] **Step 5: Commit both plans on the branch**

```bash
cp /Users/tariq/code/nasq/docs/superpowers/plans/2026-10-07-phase-3a-packages-engine.md docs/superpowers/plans/
cp /Users/tariq/code/nasq/docs/superpowers/plans/2026-10-07-phase-3b-packages-commerce.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-07-phase-3a-packages-engine.md docs/superpowers/plans/2026-10-07-phase-3b-packages-commerce.md
git commit -m "docs(docs): add the phase 3 packages plans" -m "<TRAILER>"
git log -1 --format=%B
```

Expected: the body shows the subject, a blank line and the trailer. The main checkout keeps untracked copies of both files; tell the orchestrator they must be removed from the main checkout before the merge.

- [ ] **Step 6: Record the guard, tool and web baselines**

```bash
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/catalog_check.py
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
PY
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
npm -w packages/commercial-contracts run test 2>&1 | tail -n 5
npm -w packages/commercial-contracts run build 2>&1 | tail -n 3
npm -w apps/control-plane run build 2>&1 | tail -n 3
npm test 2>&1 | tail -n 12
npm -w apps/web run lint 2>&1 | tail -n 5
```

Expected: three `exit=0`; `CATALOG_OK solutions=2`; the totals (record them: every later `arch_policy --base main` must keep them); tools `OK`; commercial tests, both builds, `npm test` and the type check green. Record any red result as pre-existing; every later run is compared with that list.

- [ ] **Step 7: Record the control-plane live baseline**

```bash
/tmp/nasq-packages/cp-live.sh 2>&1 | tail -n 15
```

Expected: `CP_LIVE_EXIT 0` with the number of passed and skipped tests (record both). Failures here are pre-existing; record their titles.

- [ ] **Step 8: Run the three Odoo installs once on the unmodified branch (background, one after the other)**

```bash
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_base \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_base_hr \
  nasq_core,nasq_platform,nasq_api,nasq_hr /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_base_meet \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
```

Expected: three `ODOO_RUN_TEST_OK`; record the three test counts N. A red run's failures (`grep -E '(FAIL|ERROR): ' /tmp/nasq-packages/logs/<db>.log`) are pre-existing.

---

### Task 1: Reproduce the pmo downgrade failure, then close unlisted keys in the operator

**Files:**
- Create (outside the repo): `/tmp/nasq-packages/repro_downgrade.py`
- Create: `odoo-addons/nasq_pmo/tests/test_package_change.py`
- Modify: `odoo-addons/nasq_pmo/tests/__init__.py`
- Modify: `odoo-addons/nasq_platform/models/entitlement_service.py` (add one method after `_nasq_merge_retained`, `:510-519`)
- Modify: `tools/shared_saas_lifecycle/subscription_effect.py:172-179`
- Modify: `tools/shared_saas_lifecycle/test_subscription_effect.py` (append one test to the class that builds `se.SubscriptionEffect`)

**Interfaces:**
- Produces: `env['nasq.entitlement.service']._nasq_close_unlisted_features(features: dict) -> dict` — a new dict holding `features` plus, for every registry key whose module is installed, not `nasq_platform`, and absent from `features`: `False` for a boolean, `0` for a limit. Used by the apply script (this task), by registration (Task 2) and by the 3b acceptance.

- [ ] **Step 1: Write the reproduction driver (real generated apply script, scratch database)**

```bash
cat > /tmp/nasq-packages/repro_downgrade.py <<'REPRO'
"""Ruling E11: downgrade a tenant that has nasq_pmo installed to a plan without pmo,
with the real generated subscription apply script. Run from the worktree:
    python3 -B /tmp/nasq-packages/repro_downgrade.py nasq_scratch_packages_repro
"""
import json
import subprocess
import sys

WORKTREE = '/Users/tariq/code/nasq-packages'
RUNNER = '/tmp/nasq-packages/odoo-run.sh'
sys.path.insert(0, WORKTREE)
from tools.shared_saas_lifecycle.subscription_effect import SENTINEL, build_apply_script  # noqa: E402

# What commercial-compiler/1 emits for a plan whose only bundle is the people app.
TODAY = {'branches.extra_limit': 0, 'hr.enabled': True, 'storage.limit_mb': None, 'users.limit': None}


def shell(db, script):
    done = subprocess.run([RUNNER, 'shell', db, WORKTREE], input=script, text=True,
                          capture_output=True, timeout=900, check=False)
    return done.stdout


def tagged(output, tag):
    lines = [line for line in output.splitlines() if line.startswith(tag)]
    return lines[-1] if lines else f'{tag} <missing>'


def main(db):
    init = (
        "profile = env.ref('nasq_platform.tenant_profile')\n"
        "profile._nasq_initialize_legacy_policy(env['nasq.feature.registry']._nasq_installed_module_ids())\n"
        "env.cr.commit()\n"
        "print('REPRO_INIT', profile.policy_revision, sorted(k for k, v in profile.features.items() if v is True))\n"
    )
    print(tagged(shell(db, init), 'REPRO_INIT'))
    request = {
        'tenant': {'database': db, 'host': 'repro.example.test'},
        'operation_id': '11111111-1111-4111-8111-111111111111',
        'previous_revision_id': None,
        'target_revision_id': '33333333-3333-4333-8333-333333333333',
        'entitlement': {'modules': [], 'features': TODAY, 'digest': 'b' * 64,
                        'compiler_version': 'commercial-compiler/1'},
        'branches': {'apply': [], 'archive': []},
    }
    print('REPRO_APPLY', tagged(shell(db, build_apply_script(request)), SENTINEL)[len(SENTINEL):])
    # The same write the pre-fix script performed (booleans back-filled only), to print the cause.
    old_loop = (
        "from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT\n"
        f"features = dict({TODAY!r})\n"
        "installed = set(env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))\n"
        "for key, item in env['nasq.feature.registry']._nasq_feature_map().items():\n"
        "    if item['type'] == 'boolean' and key not in features and item['module'] != 'nasq_platform' and item['module'] in installed:\n"
        "        features[key] = False\n"
        "try:\n"
        "    env.ref('nasq_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})\n"
        "    print('REPRO_OLD_LOOP accepted')\n"
        "except Exception as exc:\n"
        "    print('REPRO_OLD_LOOP', type(exc).__name__, exc)\n"
        "env.cr.rollback()\n"
    )
    print(tagged(shell(db, old_loop), 'REPRO_OLD_LOOP'))
    state = (
        "import json\n"
        "p = env.ref('nasq_platform.tenant_profile')\n"
        "print('REPRO_STATE', json.dumps({k: p.features.get(k) for k in ('pmo.enabled', 'projects.max_projects', 'hr.enabled')}), p.commercial_revision_id)\n"
    )
    print(tagged(shell(db, state), 'REPRO_STATE'))


if __name__ == '__main__':
    main(sys.argv[1])
REPRO
python3 -B -c "import ast; ast.parse(open('/tmp/nasq-packages/repro_downgrade.py').read()); print('repro-ok')"
```

Expected: `repro-ok`.

- [ ] **Step 2: Run the reproduction on a scratch tenant with every application installed (background)**

```bash
/tmp/nasq-packages/odoo-run.sh base nasq_scratch_packages_repro /Users/tariq/code/nasq-packages \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat
python3 -B /tmp/nasq-packages/repro_downgrade.py nasq_scratch_packages_repro
/tmp/nasq-packages/odoo-run.sh drop nasq_scratch_packages_repro
```

Expected (the latent bug, confirmed):
```
REPRO_INIT 1 ['chat.enabled', 'hr.enabled', 'meetings.enabled', 'pmo.enabled']
REPRO_APPLY {"error_code": "subscription_script_failed"}
REPRO_OLD_LOOP ValidationError nasq_platform: features payload is missing required keys: projects.max_projects
REPRO_STATE {"pmo.enabled": true, "projects.max_projects": null, "hr.enabled": true} False
```
Record these four lines in your report. If `REPRO_APPLY` is `{"applied": true}`, stop and report: the inventory's finding 4 would be wrong.

- [ ] **Step 3: Write the failing Odoo test**

Create `odoo-addons/nasq_pmo/tests/test_package_change.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

from .common import NasqPmoCase

# What commercial-compiler/1 emitted for a plan without the projects application:
# the platform limits and the selected booleans only (inventory finding 4).
TARGET_WITHOUT_PMO = {'users.limit': None, 'storage.limit_mb': None, 'branches.extra_limit': 0}


@tagged('post_install', '-at_install', 'nasq')
class TestPackageChange(NasqPmoCase):
    """Spec 3.6: a plan change flips keys and limits only, on a tenant with every app installed."""

    def _profile(self):
        return self.env.ref('nasq_platform.tenant_profile')

    def _write(self, features):
        self._profile().with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})

    def _installed(self):
        return set(self.env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))

    def test_downgrade_without_pmo_closes_writes_keeps_reads_and_data(self):
        service = self.env['nasq.entitlement.service']
        installed_before = self._installed()
        projects_before = self.env['project.project'].search_count([])
        tasks_before = self.env['project.task'].search_count([])

        features = service._nasq_close_unlisted_features(TARGET_WITHOUT_PMO)
        self.assertIs(features['pmo.enabled'], False)
        self.assertEqual(features['projects.max_projects'], 0)
        self.assertIs(type(features['projects.max_projects']), int)
        self.assertNotIn('pmo.enabled', TARGET_WITHOUT_PMO)  # the input is not mutated
        self._write(features)

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/projects?minimal=1').status_code, 200)
        created = self.api('POST', '/api/v1/projects', {'name': 'Closed by plan', 'date_end': '2030-12-31'})
        self.assertEqual((created.status_code, created.json()['code']), (403, 'feature_not_included'))
        with self.assertRaises(NasqAccessRule):
            service.require('pmo.enabled')
        self.assertTrue(service._nasq_feature_read('pmo.enabled'))
        self.assertEqual(self.env['project.project'].search_count([]), projects_before)
        self.assertEqual(self.env['project.task'].search_count([]), tasks_before)
        self.assertTrue(self.project.exists())

        upgraded = service._nasq_close_unlisted_features({
            **TARGET_WITHOUT_PMO, 'pmo.enabled': True, 'projects.max_projects': None,
        })
        self._write(upgraded)
        created = self.api('POST', '/api/v1/projects', {'name': 'Open again', 'date_end': '2030-12-31'})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self._installed(), installed_before)

    def test_incomplete_target_is_still_refused(self):
        # Ruling E2: Odoo stays strict; only the operator completes a target.
        registry = self.env['nasq.feature.registry']._nasq_feature_map()
        installed = set(self.env['nasq.feature.registry']._nasq_installed_module_ids())
        booleans_only = dict(TARGET_WITHOUT_PMO)
        for key, item in registry.items():
            if item['type'] == 'boolean' and item['module'] in installed:
                booleans_only[key] = False
        with self.assertRaisesRegex(ValidationError, r'missing required keys: .*projects\.max_projects'):
            self._write(booleans_only)

    def test_completion_never_fills_platform_keys_or_changes_listed_values(self):
        service = self.env['nasq.entitlement.service']
        completed = service._nasq_close_unlisted_features({'pmo.enabled': True})
        self.assertIs(completed['pmo.enabled'], True)
        for key in ('users.limit', 'storage.limit_mb', 'branches.extra_limit'):
            self.assertNotIn(key, completed)
```

In `odoo-addons/nasq_pmo/tests/__init__.py` insert `    test_package_change,` between `    test_notify_ownership_migration,` and `    test_personal_stages,`.

- [ ] **Step 4: Run it to see it fail**

```bash
ruff check odoo-addons
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t1 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_pmo:TestPackageChange || true
grep -E "AttributeError|_nasq_close_unlisted_features" /tmp/nasq-packages/logs/nasq_scratch_packages_t1.log | head -n 3
/tmp/nasq-packages/odoo-run.sh drop nasq_scratch_packages_t1
```

Expected: `All checks passed!`; the runner dies with `tests failed`; the grep shows `AttributeError: ... '_nasq_close_unlisted_features'` for two tests (`test_incomplete_target_is_still_refused` passes already).

- [ ] **Step 5: Add the operator completion to the entitlement service**

In `odoo-addons/nasq_platform/models/entitlement_service.py`, insert after `_nasq_merge_retained` (after the line `        return retained` that ends it, before `    @api.model\n    def _nasq_legacy_features_for`):

```python
    @api.model
    def _nasq_close_unlisted_features(self, features):
        """Return FEATURES plus the closed value of every installed application key it omits.

        A target lists what it grants. Every other key whose application is
        installed closes: booleans ``False``, limits ``0`` (default-deny). Keys
        the target lists are never changed, and platform keys are never filled
        in, so ``_nasq_validate_features`` still refuses a target without them.
        Operator scripts call this before a policy write; it writes nothing.
        """
        result = dict(features or {})
        installed = set(self._nasq_installed_modules())
        for key, item in sorted(self._nasq_registry()._nasq_feature_map().items()):
            module_id = item['module']
            if key in result or module_id == 'nasq_platform' or module_id not in installed:
                continue
            result[key] = False if item['type'] == 'boolean' else 0
        return result

```

- [ ] **Step 6: Make the apply script use it**

In `tools/shared_saas_lifecycle/subscription_effect.py` replace:

```python
    if current != values['target_revision_id']:
        features = dict(values['features'])
        # Modules stay installed after removal from the target; switch their flags off.
        installed = set(env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))
        for key, item in env['nasq.feature.registry']._nasq_feature_map().items():
            if (item['type'] == 'boolean' and key not in features
                    and item['module'] != 'nasq_platform' and item['module'] in installed):
                features[key] = False
        operator.write({'features': features, 'commercial_revision_id': values['target_revision_id'],
```

with:

```python
    if current != values['target_revision_id']:
        # Every application stays installed; keys the target omits close (booleans
        # false, limits 0). Odoo still refuses a target without its platform keys.
        features = env['nasq.entitlement.service']._nasq_close_unlisted_features(values['features'])
        operator.write({'features': features, 'commercial_revision_id': values['target_revision_id'],
```

Append to `class ReconfigureTests(Base)` in `tools/shared_saas_lifecycle/test_subscription_effect.py` (after `test_script_error_codes_are_whitelisted`, before `class ObserveTests(Base):`):

```python

    def test_apply_script_closes_unlisted_keys_through_odoo(self):
        script = se.build_apply_script(make_request())
        self.assertIn("._nasq_close_unlisted_features(values['features'])", script)
        self.assertNotIn("item['type'] == 'boolean' and key not in features", script)
```

- [ ] **Step 7: Run the tool tests**

```bash
python3 -B -m unittest tools.shared_saas_lifecycle.test_subscription_effect -v 2>&1 | tail -n 4
```

Expected: `OK`.

- [ ] **Step 8: Run the Odoo test and the full ten-addon suite (background)**

```bash
ruff check odoo-addons
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t1 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
```

Expected: `All checks passed!`; `ODOO_RUN_TEST_OK` with Task 0's count + 3.

- [ ] **Step 9: Re-run the reproduction (background)**

```bash
/tmp/nasq-packages/odoo-run.sh base nasq_scratch_packages_repro /Users/tariq/code/nasq-packages \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat
python3 -B /tmp/nasq-packages/repro_downgrade.py nasq_scratch_packages_repro
/tmp/nasq-packages/odoo-run.sh drop nasq_scratch_packages_repro
```

Expected: `REPRO_APPLY {"applied": true}`; `REPRO_OLD_LOOP ValidationError ...` unchanged (it replays the old loop on purpose); `REPRO_STATE {"pmo.enabled": false, "projects.max_projects": 0, "hr.enabled": true} 33333333-3333-4333-8333-333333333333`.

- [ ] **Step 10: Commit**

```bash
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
git add odoo-addons/nasq_platform/models/entitlement_service.py odoo-addons/nasq_pmo/tests/test_package_change.py \
  odoo-addons/nasq_pmo/tests/__init__.py tools/shared_saas_lifecycle/subscription_effect.py \
  tools/shared_saas_lifecycle/test_subscription_effect.py
git commit -m "fix(platform): close unlisted app keys when a plan drops an app" -m "<TRAILER>"
```

Expected: `arch_policy exit=0`.

---

### Task 2: Register a newly installed application's keys closed on existing tenants

**Files:**
- Modify: `odoo-addons/nasq_platform/models/tenant_profile.py` (imports `:1-9`; new methods after `_nasq_initialize_legacy_policy`, `:127-155`)
- Create: `odoo-addons/nasq_platform/tests/test_feature_registration.py`
- Modify: `odoo-addons/nasq_platform/tests/__init__.py`

**Interfaces:**
- Consumes: `_nasq_close_unlisted_features` (Task 1).
- Produces: `nasq.tenant.profile._nasq_register_missing_features() -> bool` (True when it wrote) and `_register_hook()` calling it once per registry load.

- [ ] **Step 1: Write the failing tests**

Create `odoo-addons/nasq_platform/tests/test_feature_registration.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

LOGGER = 'odoo.addons.nasq_platform.models.tenant_profile'


@tagged('post_install', '-at_install', 'nasq')
class TestFeatureRegistration(TransactionCase):
    """G5: an application installed after the one-shot policy gets its keys, closed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('nasq_platform.tenant_profile')
        cls.features = cls.env['nasq.feature.registry']
        cls.apps = cls.features._nasq_installed_module_ids()

    def _app(self):
        if not self.apps:
            self.skipTest('needs an installed application')
        return self.apps[0]

    def _initialize(self):
        self.record._nasq_initialize_legacy_policy(self.apps)

    def _grow_registry(self, *extra):
        registry = type(self.features)
        definitions = registry._nasq_feature_definitions
        self.patch(registry, '_nasq_feature_definitions', lambda model: (*definitions(model), *extra))

    def _keys(self, app):
        return (
            {'key': 'zz_probe.enabled', 'type': 'boolean', 'owner': app, 'module': app},
            {'key': 'zz_probe.max_items', 'type': 'limit', 'owner': app, 'module': app},
        )

    def test_installed_application_keys_are_registered_closed_once(self):
        app = self._app()
        self._initialize()
        before = self.record.policy_revision
        retained = list(self.record.retained_read_features)
        self._grow_registry(*self._keys(app))
        self.assertTrue(self.record._nasq_register_missing_features())
        self.assertIs(self.record.features['zz_probe.enabled'], False)
        self.assertEqual(self.record.features['zz_probe.max_items'], 0)
        self.assertIs(type(self.record.features['zz_probe.max_items']), int)
        self.assertEqual(self.record.policy_revision, before + 1)
        self.assertEqual(self.record.retained_read_features, retained)
        self.assertFalse(self.env['nasq.entitlement.service']._nasq_feature_read('zz_probe.enabled'))
        self.assertFalse(self.record._nasq_register_missing_features())
        self.assertEqual(self.record.policy_revision, before + 1)

    def test_registry_load_runs_the_registration(self):
        app = self._app()
        self._initialize()
        self._grow_registry(*self._keys(app))
        self.record._register_hook()
        self.assertIs(self.record.features['zz_probe.enabled'], False)

    def test_an_existing_value_is_never_changed(self):
        app = self._app()
        self._initialize()
        self._grow_registry(*self._keys(app))
        self.record.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**self.record.features, 'zz_probe.enabled': True, 'zz_probe.max_items': 7},
        })
        self.assertFalse(self.record._nasq_register_missing_features())
        self.assertIs(self.record.features['zz_probe.enabled'], True)
        self.assertEqual(self.record.features['zz_probe.max_items'], 7)

    def test_a_policy_it_cannot_complete_is_logged_not_raised(self):
        app = self._app()
        self._initialize()
        before = dict(self.record.features)
        # A new platform key needs its own migration; registration never invents one.
        platform = {'key': 'zz_platform.limit', 'type': 'limit', 'owner': 'nasq_platform', 'module': 'nasq_platform'}
        self._grow_registry(*self._keys(app), platform)
        with self.assertLogs(LOGGER, level='WARNING'):
            self.assertFalse(self.record._nasq_register_missing_features())
        self.assertEqual(dict(self.record.features), before)

    def test_an_uninitialized_tenant_is_left_alone(self):
        if self.record._nasq_policy_initialized(self.record):
            self.skipTest('the tenant policy is already initialized in this database')
        app = self._app()
        self._grow_registry(*self._keys(app))
        self.assertFalse(self.record._nasq_register_missing_features())
        self.assertEqual(self.record.policy_revision, 0)
```

In `odoo-addons/nasq_platform/tests/__init__.py` insert `    test_feature_registration,` between `    test_entitlements,` and `    test_legacy_grants,`.

- [ ] **Step 2: Run them to see them fail**

```bash
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t2 \
  nasq_core,nasq_platform,nasq_api,nasq_hr /nasq_platform:TestFeatureRegistration || true
grep -cE "AttributeError: .*_nasq_register_missing_features" /tmp/nasq-packages/logs/nasq_scratch_packages_t2.log
/tmp/nasq-packages/odoo-run.sh drop nasq_scratch_packages_t2
```

Expected: the runner dies with `tests failed`; the count is at least 4.

- [ ] **Step 3: Implement the registration**

In `odoo-addons/nasq_platform/models/tenant_profile.py` replace the import block:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
```

with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
```

and add after the existing imports (after the closing `)` of the `entitlement_service` import):

```python

_logger = logging.getLogger(__name__)
```

Then insert after `_nasq_initialize_legacy_policy` (after its `        return profile`, before `    def _nasq_lock(self):`):

```python
    def _register_hook(self):
        super()._register_hook()
        self._nasq_register_missing_features()

    @api.model
    def _nasq_register_missing_features(self):
        """Close, in the stored policy, every installed application key it lacks.

        Runs once per registry load, so an application installed (or a key an
        application adds in an upgrade) after the tenant's one-shot policy gets
        its default-closed value once, and the next full policy write is not
        refused for omitting it. It never grants and never changes a stored
        value. An uninitialized tenant is left to its first policy write; a
        policy that cannot be completed (a new platform key needs a migration)
        is logged and left unchanged rather than stopping the server.
        """
        profiles = self.search([], limit=2)
        if len(profiles) != 1 or not self._nasq_policy_initialized(profiles):
            return False
        if not isinstance(profiles.features, dict):
            return False
        profile = profiles._nasq_lock()
        current = dict(profile.features)
        completed = self.env['nasq.entitlement.service']._nasq_close_unlisted_features(current)
        if completed == current:
            return False
        try:
            with self.env.cr.savepoint():
                profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': completed})
        except ValidationError as error:
            _logger.warning('nasq_platform: the stored policy cannot take its closed keys: %s', error)
            return False
        return True

```

- [ ] **Step 4: Run the three installs (background, one after the other)**

```bash
ruff check odoo-addons
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t2 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t2_hr \
  nasq_core,nasq_platform,nasq_api,nasq_hr /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t2_meet \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
grep -c "cannot take its closed keys" /tmp/nasq-packages/logs/nasq_scratch_packages_t2.log
```

Expected: three `ODOO_RUN_TEST_OK` (counts = Task 1 + 5, Task 0 HR + 5, Task 0 MEET + 5); the last count is `1` (only the deliberate warning test; a second hit means a real install could not register its keys).

- [ ] **Step 5: Commit**

```bash
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
git add odoo-addons/nasq_platform/models/tenant_profile.py odoo-addons/nasq_platform/tests/test_feature_registration.py \
  odoo-addons/nasq_platform/tests/__init__.py
git commit -m "feat(platform): register new app keys closed on existing tenants" -m "<TRAILER>"
```

Expected: `arch_policy exit=0`.

---

### Task 3: Parse schema-3 catalogs into release-complete policies (TypeScript and Python)

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/feature-descriptor.ts` (whole file below)
- Create: `packages/commercial-contracts/src/__tests__/release-features.test.ts`
- Create: `deploy/catalog/fixtures/release_features.json`
- Modify: `deploy/catalog/fixtures/descriptor_parity.json` (case `schema_version_3`; four new cases)
- Modify: `tools/nasq_cli/managed_policy.py:84-140` (`_catalog_compositions`; new `release_modules`)
- Modify: `tools/test_managed_policy.py` (append a test class)
- Modify: `apps/control-plane/src/shared/catalog-features.ts`, `apps/control-plane/src/shared/job-store.ts:8,24-30`, `apps/control-plane/src/packages.ts:11,45-63`, `apps/control-plane/src/worker.ts:10,141-142`
- Modify: `apps/control-plane/src/shared/catalog-features.test.ts:44-47` and append one `describe`

**Interfaces:**
- Produces (TS, exported from `@nasq/commercial-contracts`): `KNOWN_SCHEMA_VERSIONS = [1, 2, 3]`; `releaseModules(solution: unknown): string[]` (base modules then each tier's modules, catalog order, unique); `deriveCatalogPolicy(solution: unknown, tierId: string): { modules: string[]; features: Record<string, FeatureValue>; parsed: ParsedFeature[] }` (schema 3: `modules = releaseModules`, features release-complete; schema 1/2 unchanged: `base + tier.modules`, composed features).
- Produces (Python): `managed_policy._catalog_compositions` accepts schema 3 with the same output; `managed_policy.release_modules(catalog) -> list[str]`.
- Produces (control plane): `derivePolicy(catalog: unknown, tierId: string)` in `shared/catalog-features.ts`; `deriveSharedPolicy`, `derivePackagePolicy` and `policyForCreate` take `modules` from it.

Schema-3 composition of tier T, in this order: the `core` tier's descriptors; T's own (when T is not `core`); then every other non-core tier's descriptors closed (`boolean` → `false`, `limit` → `0`). A key in two tiers, or a module in two tiers, is `catalog_invalid`.

- [ ] **Step 1: Write the shared fixture and the failing tests**

Create `deploy/catalog/fixtures/release_features.json`:

```json
{
  "description": "Release-complete derivation of schema-3 catalogs. Loaded by packages/commercial-contracts/src/__tests__/release-features.test.ts and tools/test_managed_policy.py; both runtimes must derive exactly these modules and features (false and 0 are distinct).",
  "cases": [
    {
      "name": "v3_core_closes_every_application",
      "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb", "limit:branches.extra_limit:0"]}, {"id": "projects", "modules": ["nasq_pmo", "nasq_meetings"], "features": ["boolean:pmo.enabled", "boolean:meetings.enabled", "limit:projects.max_projects"]}, {"id": "people", "modules": ["nasq_hr"], "features": ["boolean:hr.enabled"]}]},
      "tier": "core",
      "modules": ["nasq_core", "nasq_platform", "nasq_api", "nasq_pmo", "nasq_meetings", "nasq_hr"],
      "features": {"users.limit": null, "storage.limit_mb": null, "branches.extra_limit": 0, "pmo.enabled": false, "meetings.enabled": false, "projects.max_projects": 0, "hr.enabled": false}
    },
    {
      "name": "v3_projects_opens_its_own_and_closes_people",
      "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb", "limit:branches.extra_limit:0"]}, {"id": "projects", "modules": ["nasq_pmo", "nasq_meetings"], "features": ["boolean:pmo.enabled", "boolean:meetings.enabled", "limit:projects.max_projects"]}, {"id": "people", "modules": ["nasq_hr"], "features": ["boolean:hr.enabled"]}]},
      "tier": "projects",
      "modules": ["nasq_core", "nasq_platform", "nasq_api", "nasq_pmo", "nasq_meetings", "nasq_hr"],
      "features": {"users.limit": null, "storage.limit_mb": null, "branches.extra_limit": 0, "pmo.enabled": true, "meetings.enabled": true, "projects.max_projects": null, "hr.enabled": false}
    },
    {
      "name": "v3_people_closes_the_projects_limit_to_zero",
      "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb", "limit:branches.extra_limit:0"]}, {"id": "projects", "modules": ["nasq_pmo", "nasq_meetings"], "features": ["boolean:pmo.enabled", "boolean:meetings.enabled", "limit:projects.max_projects"]}, {"id": "people", "modules": ["nasq_hr"], "features": ["boolean:hr.enabled"]}]},
      "tier": "people",
      "modules": ["nasq_core", "nasq_platform", "nasq_api", "nasq_pmo", "nasq_meetings", "nasq_hr"],
      "features": {"users.limit": null, "storage.limit_mb": null, "branches.extra_limit": 0, "pmo.enabled": false, "meetings.enabled": false, "projects.max_projects": 0, "hr.enabled": true}
    },
    {
      "name": "v3_a_selected_ceiling_is_kept",
      "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb", "limit:branches.extra_limit:0"]}, {"id": "projects", "modules": ["nasq_pmo"], "features": ["boolean:pmo.enabled", "limit:projects.max_projects:25"]}]},
      "tier": "projects",
      "modules": ["nasq_core", "nasq_platform", "nasq_api", "nasq_pmo"],
      "features": {"users.limit": null, "storage.limit_mb": null, "branches.extra_limit": 0, "pmo.enabled": true, "projects.max_projects": 25}
    },
    {
      "name": "v2_is_not_release_complete",
      "catalog": {"schema_version": 2, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb", "limit:branches.extra_limit:0"]}, {"id": "projects", "modules": ["nasq_pmo", "nasq_meetings"], "features": ["boolean:pmo.enabled", "boolean:meetings.enabled", "limit:projects.max_projects"]}, {"id": "people", "modules": ["nasq_hr"], "features": ["boolean:hr.enabled"]}]},
      "tier": "people",
      "modules": ["nasq_core", "nasq_platform", "nasq_api", "nasq_hr"],
      "features": {"users.limit": null, "storage.limit_mb": null, "branches.extra_limit": 0, "hr.enabled": true}
    }
  ]
}
```

In `deploy/catalog/fixtures/descriptor_parity.json`, in the case named `schema_version_3`, change `"name": "schema_version_3"` to `"name": "schema_version_4"` and its catalog's `"schema_version": 3` to `"schema_version": 4` (it stays `reject` / `catalog_invalid`). Then append these four objects to `cases` (after the last case):

```json
    {"name": "v3_valid_baseline", "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb", "limit:branches.extra_limit:0"]}, {"id": "projects", "modules": ["nasq_pmo"], "features": ["boolean:pmo.enabled"]}]}, "expect": "accept"},
    {"name": "v3_no_core_tier", "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "projects", "modules": ["nasq_pmo"], "features": ["limit:users.limit", "limit:storage.limit_mb", "boolean:pmo.enabled"]}]}, "expect": "reject", "error": "catalog_invalid"},
    {"name": "v3_key_in_two_tiers", "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb"]}, {"id": "projects", "modules": ["nasq_pmo"], "features": ["boolean:pmo.enabled"]}, {"id": "more", "modules": ["nasq_hr"], "features": ["boolean:pmo.enabled"]}]}, "expect": "reject", "error": "catalog_invalid"},
    {"name": "v3_module_in_two_tiers", "catalog": {"schema_version": 3, "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key", "base_modules": ["nasq_core", "nasq_platform", "nasq_api"], "tiers": [{"id": "core", "modules": [], "features": ["limit:users.limit", "limit:storage.limit_mb"]}, {"id": "projects", "modules": ["nasq_pmo"], "features": ["boolean:pmo.enabled"]}, {"id": "people", "modules": ["nasq_pmo"], "features": ["boolean:hr.enabled"]}]}, "expect": "reject", "error": "catalog_invalid"}
```

Create `packages/commercial-contracts/src/__tests__/release-features.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { deriveCatalogPolicy, releaseModules, parseFeatureDescriptor } from '../commercial/feature-descriptor.js'

type Case = { name: string; catalog: unknown; tier: string; modules: string[]; features: Record<string, boolean | number | null> }
const fixture = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/fixtures/release_features.json', import.meta.url), 'utf8')) as { cases: Case[] }

describe('release-complete derivation (same file as tools/test_managed_policy.py)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const policy = deriveCatalogPolicy(c.catalog, c.tier)
      expect(policy.modules).toEqual(c.modules)
      expect(policy.features).toEqual(c.features)
    })
  }
  it('lists the release modules once, base first', () => {
    expect(releaseModules(fixture.cases[0]!.catalog)).toEqual(['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_meetings', 'nasq_hr'])
  })
  it('accepts a ceiling under schema 3 and refuses schema 4', () => {
    expect(parseFeatureDescriptor('limit:a.b:3', 3).value).toBe(3)
    expect(() => parseFeatureDescriptor('limit:a.b', 4)).toThrow('catalog_invalid')
  })
})
```

Append to `tools/test_managed_policy.py`, after `class DescriptorParityFixtureCase` (before the final `if __name__ == '__main__':` block if one follows it; otherwise at the end):

```python


RELEASE_PATH = Path(__file__).resolve().parents[1] / 'deploy/catalog/fixtures/release_features.json'


class ReleaseFeaturesFixtureCase(unittest.TestCase):
    """The same fixture is loaded by release-features.test.ts."""

    def test_every_case_derives_the_same_modules_and_features(self):
        for case in json.loads(RELEASE_PATH.read_text('utf-8'))['cases']:
            with self.subTest(case=case['name']):
                catalog = copy.deepcopy(case['catalog'])
                ids = [tier['id'] for tier in catalog['tiers']]
                modules, features = managed_policy._catalog_compositions(catalog)[ids.index(case['tier'])]
                self.assertEqual(modules, case['modules'])
                self.assertTrue(managed_policy._same_features(features, case['features']), features)

    def test_release_modules_lists_base_first(self):
        catalog = json.loads(RELEASE_PATH.read_text('utf-8'))['cases'][0]['catalog']
        self.assertEqual(managed_policy.release_modules(catalog),
                         ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_meetings', 'nasq_hr'])
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm -w packages/commercial-contracts run test -- src/__tests__/release-features.test.ts 2>&1 | tail -n 8
python3 -B -m unittest discover -s tools -p 'test_managed_policy.py' 2>&1 | tail -n 5
```

Expected: TS fails (`deriveCatalogPolicy` is not exported); Python fails (`v3_*` cases raise `PolicyError: catalog_invalid`, `release_modules` missing) and the parity case `v3_valid_baseline` fails.

- [ ] **Step 3: Implement schema 3 in TypeScript**

Replace `packages/commercial-contracts/src/commercial/feature-descriptor.ts` with:

```ts
/** The single TypeScript implementation of the catalog feature-descriptor grammar.
 * Mirrors tools/nasq_cli/managed_policy.py; parity is pinned by the shared fixtures
 * deploy/catalog/fixtures/descriptor_parity.json and release_features.json.
 *
 *   boolean:<key>        -> true
 *   limit:<key>          -> null  (ceiling left to the trusted operator)
 *   limit:<key>:<int>    -> numeric ceiling 0..1e9 (schema 2 and 3)
 * Schema 3 composes every tier release-complete: the core tier, the tier's own
 * descriptors, then every other application closed (boolean false, limit 0), over
 * the release module list (every application installed in every tenant).
 * Every refusal is a CatalogInvalidError carrying the stable code `catalog_invalid`. */
export const DESCRIPTOR_GRAMMAR_V2 = 'limit:key | limit:key:<int> | boolean:key'
export const MAX_CEILING = 1_000_000_000
export const KNOWN_SCHEMA_VERSIONS = [1, 2, 3] as const
export type CatalogSchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number]
export type FeatureKind = 'boolean' | 'limit'
export type FeatureValue = boolean | number | null
export type ParsedFeature = { key: string; kind: FeatureKind; value: FeatureValue }

/** Keys the Odoo platform enforces for every composition, with the kind each must have.
 * Legacy (schema 1) catalogs seed them as null limits; schema 2 and 3 must declare them. */
export const REQUIRED_PLATFORM_KEYS: Readonly<Record<string, FeatureKind>> = { 'users.limit': 'limit', 'storage.limit_mb': 'limit' }
export const LEGACY_SEED_LIMITS = Object.keys(REQUIRED_PLATFORM_KEYS)

export class CatalogInvalidError extends Error {
  readonly code = 'catalog_invalid'
  constructor() { super('catalog_invalid'); this.name = 'CatalogInvalidError' }
}
const invalid = (): never => { throw new CatalogInvalidError() }

const IDENTIFIER = /^[a-z][a-z0-9_]*$/
const DESCRIPTOR = /^(boolean|limit):((?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*)(?::(0|[1-9][0-9]{0,8}|1000000000))?$/
const known = (value: number): value is CatalogSchemaVersion => (KNOWN_SCHEMA_VERSIONS as readonly number[]).includes(value)

export function parseFeatureDescriptor(raw: string, schemaVersion: number): ParsedFeature {
  if (!known(schemaVersion)) return invalid()
  const match = typeof raw === 'string' ? DESCRIPTOR.exec(raw) : null
  if (!match) return invalid()
  const kind = match[1] as FeatureKind
  const key = match[2] as string
  const ceiling = match[3]
  if (ceiling !== undefined && (kind !== 'limit' || schemaVersion === 1)) return invalid()
  if (kind === 'boolean') return { kind, key, value: true }
  return { kind, key, value: ceiling === undefined ? null : Number(ceiling) }
}

export type ParsedTier = {
  id: string
  modules?: string[]
  /** This tier's own descriptors. */
  own: ParsedFeature[]
  /** Composed descriptors: schema 2 prepends the `core` tier's set; schema 3 adds every other application closed. */
  composed: ParsedFeature[]
}
export type ParsedCatalog = { schemaVersion: CatalogSchemaVersion; baseModules?: string[]; tiers: ParsedTier[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isModuleList = (v: unknown): v is string[] => Array.isArray(v) && v.every(m => typeof m === 'string' && IDENTIFIER.test(m)) && new Set(v).size === v.length
const closed = (item: ParsedFeature): ParsedFeature => ({ ...item, value: item.kind === 'boolean' ? false : 0 })

export function parseSchemaVersion(value: unknown): CatalogSchemaVersion {
  if (typeof value !== 'number' || !Number.isInteger(value) || !known(value)) return invalid()
  return value
}

/** Validate the whole catalog structure and every tier's composed descriptors.
 * `base_modules` is required by the catalog publisher; it is validated whenever
 * present so that callers that only carry tiers (worker) share the same gate. */
export function parseCatalogTiers(solution: unknown): ParsedCatalog {
  if (!isRecord(solution)) return invalid()
  const schemaVersion = parseSchemaVersion(solution.schema_version)
  if (schemaVersion >= 2 && solution.descriptor_grammar !== DESCRIPTOR_GRAMMAR_V2) invalid()
  let baseModules: string[] | undefined
  if (solution.base_modules !== undefined) {
    if (!isModuleList(solution.base_modules) || solution.base_modules.length === 0) invalid()
    baseModules = solution.base_modules as string[]
  }
  const rawTiers = solution.tiers
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return invalid()
  const ids = new Set<string>()
  const shaped = rawTiers.map(tier => {
    if (!isRecord(tier) || typeof tier.id !== 'string' || !IDENTIFIER.test(tier.id) || ids.has(tier.id)) return invalid()
    ids.add(tier.id)
    if (!Array.isArray(tier.features)) invalid()
    if (tier.modules !== undefined && !isModuleList(tier.modules)) invalid()
    if (tier.modules !== undefined && baseModules?.some(m => (tier.modules as string[]).includes(m))) invalid()
    return { id: tier.id, modules: tier.modules as string[] | undefined, own: (tier.features as unknown[]).map(d => parseFeatureDescriptor(d as string, schemaVersion)) }
  })
  const core = shaped.find(t => t.id === 'core')
  if (schemaVersion >= 2 && !core) invalid()
  if (schemaVersion === 3) {
    // Every application is installed in every tenant: a module belongs to one tier only.
    const modules = [...(baseModules ?? []), ...shaped.flatMap(t => t.modules ?? [])]
    if (new Set(modules).size !== modules.length) invalid()
  }
  const tiers = shaped.map(tier => {
    const composed = schemaVersion === 1 ? tier.own
      : schemaVersion === 2 ? (tier === core ? tier.own : [...core!.own, ...tier.own])
      : [...core!.own, ...(tier === core ? [] : tier.own),
        ...shaped.filter(other => other !== core && other !== tier).flatMap(other => other.own.map(closed))]
    const kinds = new Map<string, FeatureKind>()
    for (const item of composed) {
      if (kinds.has(item.key)) invalid()
      if (Object.hasOwn(REQUIRED_PLATFORM_KEYS, item.key) && item.kind !== REQUIRED_PLATFORM_KEYS[item.key]) invalid()
      kinds.set(item.key, item.kind)
    }
    // Schema 2 and 3 derive the complete set purely from descriptors; kind-aware.
    if (schemaVersion >= 2 && !Object.entries(REQUIRED_PLATFORM_KEYS).every(([key, kind]) => kinds.get(key) === kind)) invalid()
    return { ...tier, composed }
  })
  return { schemaVersion, baseModules, tiers }
}

/** Derive one tier's feature map from the shared parse. Schema 1 seeds both legacy limits as null. */
export function deriveCatalogFeatures(solution: unknown, tierId: string): { features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  const catalog = parseCatalogTiers(solution)
  const tier = catalog.tiers.find(t => t.id === tierId)
  if (!tier) return invalid()
  const features: Record<string, FeatureValue> = {}
  if (catalog.schemaVersion === 1) for (const key of LEGACY_SEED_LIMITS) features[key] = null
  for (const item of tier.composed) features[item.key] = item.value
  return { features, parsed: tier.composed }
}

/** Every module of the release: the base modules, then each tier's modules in catalog order. */
export function releaseModules(solution: unknown): string[] {
  const catalog = parseCatalogTiers(solution)
  if (!catalog.baseModules) return invalid()
  return [...new Set([...catalog.baseModules, ...catalog.tiers.flatMap(t => t.modules ?? [])])]
}

/** The create policy of one tier: schema 3 installs the whole release and closes every
 * other application; schema 1 and 2 keep base plus the tier's own modules. */
export function deriveCatalogPolicy(solution: unknown, tierId: string): { modules: string[]; features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  const catalog = parseCatalogTiers(solution)
  const tier = catalog.tiers.find(t => t.id === tierId)
  if (!tier || !catalog.baseModules) return invalid()
  const { features, parsed } = deriveCatalogFeatures(solution, tierId)
  const modules = catalog.schemaVersion === 3 ? releaseModules(solution) : [...catalog.baseModules, ...(tier.modules ?? [])]
  return { modules, features, parsed }
}
```

- [ ] **Step 4: Implement schema 3 in Python**

In `tools/nasq_cli/managed_policy.py` replace the whole function `_catalog_compositions` (from `def _catalog_compositions(catalog) -> list[tuple[list[str], dict]]:` through its `return compositions`) with:

```python
def _catalog_compositions(catalog) -> list[tuple[list[str], dict]]:
    """Validate consumed catalog fields and derive exactly the worker defaults.

    This is not the catalog publisher's schema/manifest/registry validation gate.
    Descriptive metadata and optional add-ons are not create-policy inputs.
    Schema 3 composes every tier release-complete over the release module list:
    the core tier, the tier's own descriptors, then every other application
    closed (boolean False, limit 0). Mirrors feature-descriptor.ts.
    """
    if (type(catalog) is not dict
            or type(catalog.get('schema_version')) is not int
            or catalog['schema_version'] not in (1, 2, 3)
            or not _module_list(catalog.get('base_modules'))
            or not catalog['base_modules']
            or type(catalog.get('tiers')) is not list or not catalog['tiers']):
        _fail('catalog_invalid')
    schema = catalog['schema_version']
    if schema >= 2 and catalog.get('descriptor_grammar') != DESCRIPTOR_GRAMMAR_V2:
        _fail('catalog_invalid')
    tiers = catalog['tiers']
    tier_ids = set()
    for tier in tiers:
        if (type(tier) is not dict
                or type(tier.get('id')) is not str
                or not _IDENTIFIER.fullmatch(tier['id'])
                or tier['id'] in tier_ids
                or not _module_list(tier.get('modules'))
                or type(tier.get('features')) is not list):
            _fail('catalog_invalid')
        tier_ids.add(tier['id'])
    core = next((t for t in tiers if t['id'] == 'core'), None)
    if schema >= 2 and core is None:
        _fail('catalog_invalid')  # schema 2 and 3 compose every tier from `core`; no fallback
    release = list(catalog['base_modules'])
    for tier in tiers:
        release += tier['modules']
    if schema == 3 and len(release) != len(set(release)):
        _fail('catalog_invalid')
    compositions = []
    for tier in tiers:
        modules = list(release) if schema == 3 else catalog['base_modules'] + tier['modules']
        if len(modules) != len(set(modules)):
            _fail('catalog_invalid')
        # Legacy bytes seed the two default limits; schema 2 and 3 derive the complete
        # set purely from descriptors (every tier inherits the core tier's set).
        features = dict.fromkeys(_DEFAULT_LIMITS) if schema == 1 else {}
        feature_keys = set()
        descriptors = [(entry, False) for entry in tier['features']]
        if schema >= 2 and tier is not core:
            descriptors = [(entry, False) for entry in core['features']] + descriptors
        if schema == 3:
            for other in tiers:
                if other is not core and other is not tier:
                    descriptors += [(entry, True) for entry in other['features']]
        for descriptor, closed in descriptors:
            match = _FEATURE.fullmatch(descriptor) if type(descriptor) is str else None
            if match is None:
                _fail('catalog_invalid')
            kind, key, ceiling = match.groups()
            if (key in feature_keys or (key in _DEFAULT_LIMITS and kind != 'limit')
                    or (ceiling is not None and (kind != 'limit' or schema == 1))):
                _fail('catalog_invalid')
            feature_keys.add(key)
            if closed:
                features[key] = False if kind == 'boolean' else 0
            else:
                features[key] = (True if kind == 'boolean'
                                 else None if ceiling is None else int(ceiling))
        if schema >= 2 and not set(_DEFAULT_LIMITS) <= set(features):
            _fail('catalog_invalid')
        compositions.append((modules, features))
    return compositions


def release_modules(catalog) -> list[str]:
    """Every module of the release: base modules, then each tier's modules in order."""
    _catalog_compositions(catalog)
    modules = list(catalog['base_modules'])
    for tier in catalog['tiers']:
        modules += [name for name in tier['modules'] if name not in modules]
    return modules
```

Also change the comment line `# One grammar: boolean:<key> | limit:<key> | limit:<key>:<int> (schema 2 only).` to `# One grammar: boolean:<key> | limit:<key> | limit:<key>:<int> (schema 2 and 3).`

- [ ] **Step 5: Take policy modules from the shared derivation in the control plane**

Replace `apps/control-plane/src/shared/catalog-features.ts` with:

```ts
/** Thin control-plane adapter: the descriptor grammar lives only in
 * @nasq/commercial-contracts (commercial/feature-descriptor.ts). */
import { deriveCatalogFeatures, deriveCatalogPolicy, type FeatureValue, type ParsedFeature } from '@nasq/commercial-contracts'

export type CatalogTierLike = { id: string; features: string[] }
export type CatalogLike = { schema_version?: number; tiers: CatalogTierLike[] }
export type { FeatureValue, ParsedFeature }

/** Throws CatalogInvalidError (`catalog_invalid`) for any malformed catalog. */
export function deriveFeatures(catalog: CatalogLike, tier: { id: string; features?: string[] }): { features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  return deriveCatalogFeatures(catalog, tier.id)
}

/** Modules and features of one tier's create policy (schema 3: the whole release, others closed). */
export function derivePolicy(catalog: unknown, tierId: string): { modules: string[]; features: Record<string, FeatureValue>; parsed: ParsedFeature[] } {
  return deriveCatalogPolicy(catalog, tierId)
}
```

In `apps/control-plane/src/shared/job-store.ts` replace `import { deriveFeatures, type CatalogLike } from './catalog-features.js'` with `import { derivePolicy } from './catalog-features.js'`, and replace:

```ts
  const { features } = deriveFeatures(value as CatalogLike, tier)
  return sharedPolicySchema.parse({ schema_version: 1, channel: 'control_plane', modules: [...catalog.base_modules, ...tier.modules], features })
```

with:

```ts
  const { modules, features } = derivePolicy(value, tier.id)
  return sharedPolicySchema.parse({ schema_version: 1, channel: 'control_plane', modules, features })
```

In `apps/control-plane/src/packages.ts` replace `import { deriveFeatures, type CatalogLike } from './shared/catalog-features.js'` with `import { derivePolicy } from './shared/catalog-features.js'`, and in `derivePackagePolicy` replace `  try { derived = deriveFeatures(value as CatalogLike, tier) } catch (error) {` with `  try { derived = derivePolicy(value, tier.id) } catch (error) {` and the last line `  return sharedPolicySchema.parse({schema_version:1,channel:'control_plane',modules:[...catalog.base_modules,...tier.modules],features})` with `  return sharedPolicySchema.parse({schema_version:1,channel:'control_plane',modules:derived.modules,features})`.

In `apps/control-plane/src/worker.ts` replace `import { deriveFeatures } from './shared/catalog-features.js'` with `import { derivePolicy } from './shared/catalog-features.js'`, and replace:

```ts
    const { features } = deriveFeatures(catalog as { schema_version?: number; tiers: Array<{ id: string; features: string[] }> }, { id: tier.id, features: tier.features })
  return { schema_version: 1, channel: tenant.commercial_mode === 'saas' ? 'control_plane' : 'local_policy', modules: [...catalog.base_modules, ...tier.modules], features }
```

with:

```ts
    const { modules, features } = derivePolicy(catalog, tier.id)
  return { schema_version: 1, channel: tenant.commercial_mode === 'saas' ? 'control_plane' : 'local_policy', modules, features }
```

In `apps/control-plane/src/shared/catalog-features.test.ts` replace the line `    expect(() => parseFeatureDescriptor('limit:a.b', 3)).toThrow(CatalogInvalidError)` with `    expect(() => parseFeatureDescriptor('limit:a.b', 4)).toThrow(CatalogInvalidError)`, and append at the end of the file:

```ts

describe('schema-3 release-complete policies through every control-plane derivation', () => {
  const v3 = JSON.parse(readFileSync(join(root, 'deploy/catalog/fixtures/release_features.json'), 'utf8')).cases[0].catalog
  it('shared onboarding installs the whole release and closes the other apps', () => {
    const policy = deriveSharedPolicy(v3, 'people')
    expect(policy.modules).toEqual(['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_meetings', 'nasq_hr'])
    expect(policy.features).toEqual({ 'users.limit': null, 'storage.limit_mb': null, 'branches.extra_limit': 0, 'pmo.enabled': false, 'meetings.enabled': false, 'projects.max_projects': 0, 'hr.enabled': true })
  })
  it('a package may only set the open tier limits, never a closed one', () => {
    const policy = derivePackagePolicy(v3, 'projects', { 'users.limit': 5, 'storage.limit_mb': 100, 'projects.max_projects': 3 })
    expect(policy.features).toMatchObject({ 'projects.max_projects': 3, 'hr.enabled': false })
    expect(() => derivePackagePolicy(v3, 'people', { 'users.limit': 5, 'storage.limit_mb': 100, 'projects.max_projects': 3 })).toThrow('package_limits_invalid')
  })
  it('v2 stays base plus tier modules', () => {
    expect(deriveSharedPolicy(read('platform_v2.json'), 'people').modules).toEqual(['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_hr'])
  })
})
```

- [ ] **Step 6: Run the focused tests**

```bash
npm -w packages/commercial-contracts run test 2>&1 | tail -n 5
npm -w packages/commercial-contracts run build 2>&1 | tail -n 3
npm -w apps/control-plane test -- src/shared/catalog-features.test.ts src/__tests__/packages.test.ts src/__tests__/worker-v2-policy.test.ts src/__tests__/worker-managed.test.ts src/shared/job-store.test.ts 2>&1 | tail -n 6
npm -w apps/control-plane run build 2>&1 | tail -n 3
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
```

Expected: all green (`OK` for the tools suite; the four parity `v3_*` cases pass in both runtimes).

- [ ] **Step 7: Commit**

```bash
git add packages/commercial-contracts/src/commercial/feature-descriptor.ts packages/commercial-contracts/src/__tests__/release-features.test.ts \
  deploy/catalog/fixtures/release_features.json deploy/catalog/fixtures/descriptor_parity.json \
  tools/nasq_cli/managed_policy.py tools/test_managed_policy.py \
  apps/control-plane/src/shared/catalog-features.ts apps/control-plane/src/shared/catalog-features.test.ts \
  apps/control-plane/src/shared/job-store.ts apps/control-plane/src/packages.ts apps/control-plane/src/worker.ts
git commit -m "feat(cp): derive release-complete policies from schema 3 catalogs" -m "<TRAILER>"
```

---

### Task 4: Catalog v3, completeness, release module list and its copies

**Files:**
- Create: `deploy/catalog/solutions/platform_v3.json`
- Modify: `deploy/catalog/schema/solution.schema.json:10` and the `featureName` description
- Modify: `tools/catalog_check.py` (imports, new functions before `def check_catalog`, two calls inside it, `main`)
- Modify: `tools/test_catalog_check.py` (append a test class)
- Modify: `apps/control-plane/src/shared/catalog-source.ts:8`, `apps/control-plane/src/shared/catalog-source.test.ts`, `tools/nasq_cli/catalog_source.py:17`, `tools/test_catalog_source.py`
- Modify: `.woodpecker.yml` (odoo, upgrade, restore-drill, image steps)

**Interfaces:**
- Produces: `catalog_check.release_modules(root, data) -> list[str]` (sorted install closure), `catalog_check.current_release(root) -> tuple[str, list[str]] | None`, CLI `python3 -B tools/catalog_check.py --release-modules [--root R]` printing the comma list (`nasq_api,nasq_chat,nasq_core,nasq_directory,nasq_hr,nasq_meetings,nasq_meetings_pmo,nasq_notify,nasq_platform,nasq_pmo` on this repository). `KNOWN_SOURCES` gains `'platform_v3.json'` (last entry) in TS and Python.

- [ ] **Step 1: Write the failing tests**

Append to `tools/test_catalog_check.py` before `if __name__ == '__main__':`:

```python
PLATFORM_REGISTRY = """# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class DemoPlatform(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
%(features)s
        )
"""


class ReleaseCatalogCase(CatalogCase):
    """Schema 3: every release feature in exactly one tier; one release module list."""

    def setUp(self):
        super().setUp()
        models = self.root / 'odoo-addons' / 'demo_core' / 'models'
        models.mkdir()
        (models / 'feature_registry.py').write_text(PLATFORM_REGISTRY % {'features': (
            feature('users.limit', 'limit', 'nasq_platform', 'nasq_platform')
            + feature('storage.limit_mb', 'limit', 'nasq_platform', 'nasq_platform')
            + feature('branches.extra_limit', 'limit', 'nasq_platform', 'nasq_platform')
        )})
        self.data = {
            'schema_version': 3,
            'descriptor_grammar': 'limit:key | limit:key:<int> | boolean:key',
            'id': 'demo', 'name': 'Demo', 'industry': 'none', 'base_modules': ['demo_core'],
            'tiers': [
                {'id': 'core', 'name': 'Core', 'modules': [],
                 'features': ['limit:users.limit', 'limit:storage.limit_mb', 'limit:branches.extra_limit:0']},
                {'id': 'projects', 'name': 'Projects', 'modules': ['demo_pmo'],
                 'features': ['boolean:pmo.enabled', 'limit:projects.max_projects']},
            ],
        }
        self.write('solutions/demo.json', self.data)

    def test_complete_release_is_valid_and_prints_its_modules(self):
        self.assertEqual(self.errors(), [])
        self.assertEqual(catalog_check.current_release(self.root), ('demo.json', ['demo_core', 'demo_pmo']))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(catalog_check.main(['--release-modules', '--root', str(self.root)]), 0)
        self.assertEqual(output.getvalue().strip(), 'demo_core,demo_pmo')

    def test_a_release_feature_in_no_tier_is_rejected(self):
        self.data['tiers'][1]['features'] = ['boolean:pmo.enabled']
        self.assert_rejected("feature 'projects.max_projects' of release module 'demo_pmo' is in no tier", self.data)

    def test_a_feature_in_two_tiers_is_rejected(self):
        self.data['tiers'].append({'id': 'twice', 'name': 'Twice', 'modules': [], 'features': ['boolean:pmo.enabled']})
        self.assert_rejected("feature 'pmo.enabled' is declared by more than one tier", self.data)

    def test_a_stale_copy_of_the_release_list_is_rejected(self):
        (self.root / 'deploy').mkdir(exist_ok=True)
        (self.root / 'deploy' / 'provision.sh').write_text('odoo -i demo_core,web_theme_shadcn --stop-after-init\n')
        self.assert_rejected("deploy/provision.sh: module list ['demo_core'] differs from the release modules")

    def test_no_schema_3_catalog_means_no_release(self):
        self.data['schema_version'] = 2
        self.write('solutions/demo.json', self.data)
        self.assertIsNone(catalog_check.current_release(self.root))
        self.assertEqual(catalog_check.main(['--release-modules', '--root', str(self.root)]), 1)

    def test_the_committed_release_is_the_ten_addon_install(self):
        self.assertEqual(catalog_check.current_release(ROOT), ('platform_v3.json', [
            'nasq_api', 'nasq_chat', 'nasq_core', 'nasq_directory', 'nasq_hr', 'nasq_meetings',
            'nasq_meetings_pmo', 'nasq_notify', 'nasq_platform', 'nasq_pmo',
        ]))
```

and add `import contextlib` and `import io` to the imports at the top of `tools/test_catalog_check.py` (keep them sorted: `import ast`, `import contextlib`, `import io`, `import json`, ...).

In `tools/test_catalog_source.py` append to `CatalogSourceTests`:

```python

    def test_v3_resolves_to_its_own_file_and_is_registered_last(self):
        self.assertEqual(catalog_source.resolve_catalog_path(digest('platform_v3.json')).name, 'platform_v3.json')
        self.assertEqual(catalog_source.KNOWN_SOURCES[-1], 'platform_v3.json')
```

In `apps/control-plane/src/shared/catalog-source.test.ts`, inside `describe('catalog source resolution by sha256', ...)`, add:

```ts
  it('resolves the v3 sha to platform_v3.json', async () => {
    expect((await resolveCatalogSource(repo, sha('platform_v3.json'))).name).toBe('platform_v3.json')
    expect((await readKnownSource(repo, 'platform_v3.json')).name).toBe('platform_v3.json')
  })
```

- [ ] **Step 2: Run them to see them fail**

```bash
python3 -B -m unittest discover -s tools -p 'test_catalog_*.py' 2>&1 | tail -n 4
npm -w apps/control-plane test -- src/shared/catalog-source.test.ts 2>&1 | tail -n 5
```

Expected: errors (`current_release` missing; `platform_v3.json` absent).

- [ ] **Step 3: Add the v3 catalog and the schema version**

Create `deploy/catalog/solutions/platform_v3.json`:

```json
{
  "schema_version": 3,
  "descriptor_grammar": "limit:key | limit:key:<int> | boolean:key",
  "id": "platform_v3",
  "name": "nasq Platform",
  "description": "Release-complete revision (spec 3.6): every application of the release is installed in every shared-SaaS tenant and a plan controls feature keys and limits only. Every tier composes the core limit set, its own keys, and every other application closed (booleans false, limits 0). Names, prices and numeric ceilings remain commercial decisions.",
  "industry": "none",
  "base_modules": [
    "nasq_core",
    "nasq_platform",
    "nasq_api"
  ],
  "tiers": [
    {
      "id": "core",
      "name": "Core",
      "description": "Base modules only: the platform, its capability catalog and the shared API.",
      "modules": [],
      "features": [
        "limit:users.limit",
        "limit:storage.limit_mb",
        "limit:branches.extra_limit:0"
      ]
    },
    {
      "id": "projects",
      "name": "Projects",
      "description": "The project and meeting applications.",
      "modules": [
        "nasq_pmo",
        "nasq_meetings"
      ],
      "features": [
        "boolean:pmo.enabled",
        "boolean:meetings.enabled",
        "limit:projects.max_projects"
      ]
    },
    {
      "id": "people",
      "name": "People",
      "description": "The HR application.",
      "modules": [
        "nasq_hr"
      ],
      "features": [
        "boolean:hr.enabled"
      ]
    },
    {
      "id": "messaging",
      "name": "Messaging",
      "description": "The member-private chat application.",
      "modules": [
        "nasq_chat"
      ],
      "features": [
        "boolean:chat.enabled"
      ]
    }
  ]
}
```

In `deploy/catalog/schema/solution.schema.json` replace `    "schema_version": { "enum": [1, 2] },` with `    "schema_version": { "enum": [1, 2, 3] },` and in the `featureName` description replace `limit:<key>:<int> (schema_version 2) carries an explicit numeric ceiling.` with `limit:<key>:<int> (schema_version 2 and 3) carries an explicit numeric ceiling.`

Register the file: in `apps/control-plane/src/shared/catalog-source.ts` replace `export const KNOWN_SOURCES = ['platform.json', 'platform_v2.json'] as const` with `export const KNOWN_SOURCES = ['platform.json', 'platform_v2.json', 'platform_v3.json'] as const`; in `tools/nasq_cli/catalog_source.py` replace `KNOWN_SOURCES = ('platform.json', 'platform_v2.json')` with `KNOWN_SOURCES = ('platform.json', 'platform_v2.json', 'platform_v3.json')`.

- [ ] **Step 4: Add the completeness rule, the release list and the copy guard**

In `tools/catalog_check.py` add after `from pathlib import Path`:

```python

from nasq_cli.module_closure import ClosureError, install_closure
```

Add after the `TEST_ONLY_MARKER = 'never installed in production'` line:

```python

# A schema-3 solution installs its whole release in every tenant (spec 3.6).
RELEASE_SCHEMA = 3
# Files that still spell the release module list out (they run where the repository
# tools are not available). Each list must equal the newest schema-3 release.
RELEASE_COPIES = (
    '.woodpecker.yml',
    'deploy/provision.sh',
    'deploy/woodpecker/image.yml',
    'tools/shared_acceptance_live/up.sh',
    'deploy/check_isolated.py',
)
_COMMA_LIST = re.compile(r'/?[a-z][a-z0-9_]*(?:,/?[a-z][a-z0-9_]*)+')
_ADDON_TUPLE = re.compile(r'NASQ_ADDONS = \(([^)]*)\)')
```

Add before `def check_catalog(root, catalog_dir=CATALOG_DIR):`:

```python
def release_modules(root, data):
    """Sorted install closure of a solution's base and tier modules."""
    selected = list(data.get('base_modules') or [])
    for tier in data.get('tiers') or []:
        selected += list(tier.get('modules') or [])
    return sorted(install_closure([Path(root) / ADDONS_DIR], selected))


def current_release(root, catalog_dir=CATALOG_DIR):
    """(file name, release modules) of the newest schema-3 solution, or None."""
    solutions = sorted((Path(root) / catalog_dir / 'solutions').glob('*.json'))
    current = [path for path in solutions if load_json(path).get('schema_version') == RELEASE_SCHEMA]
    if not current:
        return None
    return current[-1].name, release_modules(root, load_json(current[-1]))


def _check_release(root, where, data, registry, errors):
    """Every feature of a release module (and of the platform) sits in exactly one tier."""
    try:
        release = set(release_modules(root, data))
    except ClosureError as exc:
        errors.append(f'{where}: release module {exc} has no readable manifest')
        return
    tiers_by_key = {}
    for tier in data.get('tiers') or []:
        for entry in tier.get('features') or []:
            if isinstance(entry, str) and entry.count(':') >= 1:
                tiers_by_key.setdefault(entry.split(':')[1], []).append(str(tier.get('id')))
    for key, tier_ids in sorted(tiers_by_key.items()):
        if len(tier_ids) > 1:
            errors.append(f'{where}: feature {key!r} is declared by more than one tier ({", ".join(tier_ids)})')
    for key, definition in sorted(registry.items()):
        module = definition.get('module')
        if module in TEST_ONLY_MODULES:
            continue
        if (module == 'nasq_platform' or module in release) and key not in tiers_by_key:
            errors.append(f'{where}: feature {key!r} of release module {module!r} is in no tier')


def _check_release_copies(root, base_modules, modules, errors):
    """Literal copies of the release list must equal it (names outside the release that
    are not Nasq addons, such as the theme, are ignored)."""
    expected = set(modules)
    anchor = base_modules[0] if base_modules else None
    for relative in RELEASE_COPIES:
        path = Path(root) / relative
        if not path.is_file() or anchor is None:
            continue
        text = path.read_text(encoding='utf-8')
        found = []
        for match in _COMMA_LIST.finditer(text):
            names = [name.lstrip('/') for name in match.group(0).split(',')]
            if anchor in names:
                found.append(names)
        for match in _ADDON_TUPLE.finditer(text):
            found.append(re.findall(r"'([a-z0-9_]+)'", match.group(1)))
        for names in found:
            listed = {name for name in names if name in expected or name.startswith(ADDON_PREFIX)}
            if listed != expected:
                errors.append(
                    f'{relative}: module list {sorted(listed)} differs from the release modules {sorted(expected)}',
                )
```

Inside `check_catalog`, in the `for path in solutions:` loop, add after the line `            errors.append(f'{where}: id {data.get("id")!r} must match the file name')`:

```python
        if data.get('schema_version') == RELEASE_SCHEMA:
            _check_release(root, where, data, registry, errors)
```

and add just before the `for module in sorted(TEST_ONLY_MODULES):` loop near the end of `check_catalog`:

```python
    try:
        current = current_release(root, catalog_dir)
    except ClosureError as exc:
        current = None
        errors.append(f'release module {exc} has no readable manifest')
    if current is not None:
        newest = load_json(base / 'solutions' / current[0])
        _check_release_copies(root, list(newest.get('base_modules') or []), current[1], errors)
```

Replace `main` with:

```python
def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    root = ROOT_DEFAULT
    release_only = argv[:1] == ['--release-modules']
    if release_only:
        argv = argv[1:]
    if argv:
        if argv[0] != '--root' or len(argv) != 2:
            print('usage: catalog_check.py [--release-modules] [--root REPOSITORY]', file=sys.stderr)
            return 2
        root = Path(argv[1]).resolve()
    if release_only:
        try:
            current = current_release(root)
        except ClosureError as exc:
            print(f'CATALOG_INVALID release module {exc} has no readable manifest', file=sys.stderr)
            return 1
        if current is None:
            print('CATALOG_INVALID no schema 3 solution defines the release', file=sys.stderr)
            return 1
        print(','.join(current[1]))
        return 0
    try:
        errors = check_catalog(root)
    except SchemaError as exc:
        print(f'CATALOG_INVALID {exc}')
        return 1
    for error in errors:
        print(f'CATALOG_INVALID {error}')
    if errors:
        return 1
    solutions = len(list((Path(root) / CATALOG_DIR / 'solutions').glob('*.json')))
    print(f'CATALOG_OK solutions={solutions}')
    return 0
```

- [ ] **Step 5: Use the canonical list in CI**

In `.woodpecker.yml`, `odoo` step: add after `SCRATCH_DB="nasq_ci_scratch_${CI_PIPELINE_NUMBER}"`:

```bash
        MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
        TAGS="/${MODULES//,/,/}"
```

and replace the two lines

```
          -i nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
          --test-tags /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat \
```

with

```
          -i "$MODULES" \
          --test-tags "$TAGS" \
```

`upgrade` step: replace `        MODULES="nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat"` with `        MODULES="$(python3 -B tools/catalog_check.py --release-modules)"`.

`restore-drill` step: add `        MODULES="$(python3 -B tools/catalog_check.py --release-modules)"` after `        RST2_DB="nasq_drill_restored2_scratch"` and replace `          -d "$SRC_DB" -i nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \` with `          -d "$SRC_DB" -i "$MODULES" \`.

`image` step: add `        MODULES="$(python3 -B tools/catalog_check.py --release-modules)"` after `        SCRATCH_DB="nasq_image_scratch"` and replace `          -d "$SCRATCH_DB" -i nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat --without-demo=all --http-port=8169 --stop-after-init` with `          -d "$SCRATCH_DB" -i "$MODULES" --without-demo=all --http-port=8169 --stop-after-init`.

- [ ] **Step 6: Run the focused checks**

```bash
python3 -B tools/catalog_check.py
python3 -B tools/catalog_check.py --release-modules
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"; echo "/${MODULES//,/,/}"
grep -c "nasq_core,nasq_platform" .woodpecker.yml || echo "no literal list left in .woodpecker.yml"
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
npm -w apps/control-plane test -- src/shared/catalog-source.test.ts src/shared/catalog-features.test.ts 2>&1 | tail -n 4
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
```

Expected: `CATALOG_OK solutions=3`; `nasq_api,nasq_chat,nasq_core,nasq_directory,nasq_hr,nasq_meetings,nasq_meetings_pmo,nasq_notify,nasq_platform,nasq_pmo`; the tag list `/nasq_api,/nasq_chat,...,/nasq_pmo`; `no literal list left in .woodpecker.yml`; tools `OK`; TS green; deploy `OK`.

- [ ] **Step 7: Commit**

```bash
git add deploy/catalog/solutions/platform_v3.json deploy/catalog/schema/solution.schema.json tools/catalog_check.py \
  tools/test_catalog_check.py tools/nasq_cli/catalog_source.py tools/test_catalog_source.py \
  apps/control-plane/src/shared/catalog-source.ts apps/control-plane/src/shared/catalog-source.test.ts .woodpecker.yml
git commit -m "feat(tools): add catalog v3 with completeness and one module list" -m "<TRAILER>"
```

---

### Task 5: Compile release-complete entitlements (commercial-compiler/2) and display apps from features

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/entitlements.ts:7,58-62,85-91`
- Modify: `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts:27-34` and append tests
- Modify: `tools/shared_saas_lifecycle/test_subscription_effect.py` (append one test)
- Create: `apps/web/app/utils/entitlementApps.ts`, `apps/web/app/utils/__tests__/entitlementApps.test.ts`
- Modify: `apps/web/app/pages/subscription/index.vue:1-16,46-50`, `apps/web/app/pages/vendor/customers/[id].vue:38`, `apps/web/app/pages/vendor/customers/index.vue:21`
- Modify: `apps/web/i18n/locales/ar/subscription.json`, `apps/web/i18n/locales/en/subscription.json`
- Modify: `apps/web/app/pages/__tests__/subscriptionJourney.test.ts` (one assertion)

**Interfaces:**
- Produces: `COMPILER_VERSION = 'commercial-compiler/2'`; `compileEntitlements(...).modules` = sorted unique `release.base_modules ∪ every application's modules`; `.features` holds every feature of every release application (left-out apps: boolean `false`, limit `0`; included or core apps: an unset limit takes `ceiling ?? null`).
- Produces (web): `entitledFeaturePrefixes(features: Record<string, boolean | number | null> | null | undefined): string[]` (sorted prefixes of `<prefix>.enabled === true`), `entitledSelections(release, features): { app_id: string; feature_keys: string[] }[]`.

- [ ] **Step 1: Write the failing tests**

In `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts` replace the test `unions base and selected modules, keeps 0/null, and overrides only explicit limits` (lines 27-34) with:

```ts
  it('installs the whole release, keeps 0/null, and overrides only explicit limits', () => {
    const input = fixture()
    const result = compileEntitlements({ ...input, terms: { id: id(9), customer_id: id(10), reason: 'Special terms', limits: { 'users.limit': 0 } } })
    expect(result.modules).toEqual(['nasq_api', 'nasq_chat', 'nasq_core', 'nasq_hr', 'nasq_meetings', 'nasq_platform', 'nasq_pmo'])
    expect(result.features).toEqual({ 'branches.extra_limit': 8, 'chat.enabled': false, 'hr.enabled': true, 'meetings.enabled': true, 'pmo.enabled': true, 'projects.max_projects': 0, 'storage.limit_mb': null, 'users.limit': 0 })
    expect(result.compiler_version).toBe('commercial-compiler/2')
    expect(input.plan.platform_limits['users.limit']).toBe(20)
  })
  it('closes every application the plan leaves out (booleans false, limits 0)', () => {
    const input = fixture()
    input.plan.optional_bundle_revision_ids = [input.bundles[1]!.id]
    const result = compileEntitlements({ ...input, bundles: [input.bundles[1]!] })
    expect(result.features).toEqual({ 'branches.extra_limit': 8, 'chat.enabled': false, 'hr.enabled': true, 'meetings.enabled': false, 'pmo.enabled': false, 'projects.max_projects': 0, 'storage.limit_mb': null, 'users.limit': 20 })
    expect(result.modules).toEqual(compileEntitlements(fixture()).modules)
  })
  it('keeps the catalog value for an included application limit no bundle sets', () => {
    const input = fixture()
    input.bundles[0]!.domain_limits = {}
    expect(compileEntitlements(input).features['projects.max_projects']).toBeNull()
  })
  it('closes an included application boolean the bundle did not select', () => {
    const input = fixture()
    input.bundles[0]!.selections[0]!.feature_keys = ['pmo.enabled']
    expect(compileEntitlements(input).features['meetings.enabled']).toBe(false)
  })
```

Append to `class ReconfigureTests(Base)` in `tools/shared_saas_lifecycle/test_subscription_effect.py` (after the test added in Task 1 Step 6):

```python

    def test_release_complete_target_installs_nothing(self):
        modules = ['nasq_api', 'nasq_core', 'nasq_platform', 'nasq_pmo']
        request = make_request(entitlement={**make_request()['entitlement'], 'modules': modules})
        runner = FakeRunner(observation(modules=modules), apply_state=applied_state(request))
        receipt = self.effect(runner).reconfigure(request)
        self.assertEqual(runner.installed, [])
        self.assertEqual(receipt['modules_installed'], [])
```

Create `apps/web/app/utils/__tests__/entitlementApps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { entitledFeaturePrefixes, entitledSelections } from '../entitlementApps'

const release = { applications: [
  { id: 'core', selectable: false, features: [{ key: 'users.limit', kind: 'limit' }] },
  { id: 'projects', selectable: true, features: [{ key: 'pmo.enabled', kind: 'boolean' }, { key: 'meetings.enabled', kind: 'boolean' }, { key: 'projects.max_projects', kind: 'limit' }] },
  { id: 'people', selectable: true, features: [{ key: 'hr.enabled', kind: 'boolean' }] },
] }
const features = { 'users.limit': 5, 'pmo.enabled': true, 'meetings.enabled': false, 'projects.max_projects': 0, 'hr.enabled': false, 'probe.enabled': true }

describe('entitled applications come from features, never from modules', () => {
  it('lists the open <app>.enabled prefixes', () => {
    expect(entitledFeaturePrefixes(features)).toEqual(['pmo', 'probe'])
    expect(entitledFeaturePrefixes(null)).toEqual([])
  })
  it('maps the open booleans onto the release applications', () => {
    expect(entitledSelections(release, features)).toEqual([{ app_id: 'projects', feature_keys: ['pmo.enabled'] }])
    expect(entitledSelections(null, features)).toEqual([])
  })
})
```

In `apps/web/app/pages/__tests__/subscriptionJourney.test.ts`, inside the first `describe`, add:

```ts
  it('shows entitled applications from features, not the release module list', () => {
    expect(page('index.vue')).not.toContain('entitlement.modules')
    expect(page('index.vue')).toContain('entitledFeaturePrefixes')
  })
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm -w packages/commercial-contracts run test -- src/__tests__/commercial-entitlements.test.ts 2>&1 | tail -n 8
npm -w apps/web run test -- app/utils/__tests__/entitlementApps.test.ts app/pages/__tests__/subscriptionJourney.test.ts 2>&1 | tail -n 8
```

Expected: compiler tests fail (modules, `chat.enabled` missing, version `/1`); web tests fail (module missing; page uses `entitlement.modules`). The new Python test already passes (it pins that no install happens when modules match).

- [ ] **Step 3: Implement compiler 2**

In `packages/commercial-contracts/src/commercial/entitlements.ts` replace `export const COMPILER_VERSION = 'commercial-compiler/1'` with:

```ts
/** /2: modules are the whole release (every application is installed in every tenant) and
 * features carry every key of every release application (spec 3.6, rulings E2/E3/E6). */
export const COMPILER_VERSION = 'commercial-compiler/2'
```

Replace the `// Modules` block:

```ts
  // Modules
  const modules = [...new Set([
    ...(release.base_modules ?? []), ...coreApps.flatMap(a => a.modules),
    ...[...selectedApps].flatMap(id => (apps.get(id) as CatalogApplication).modules),
  ])].sort()
```

with:

```ts
  // Modules: the whole release. They decide nothing about access; features do.
  const modules = [...new Set([...(release.base_modules ?? []), ...release.applications.flatMap(a => a.modules)])].sort()
```

Replace:

```ts
  const branches = terms?.extra_branches_limit !== undefined ? terms.extra_branches_limit : plan.extra_branches_limit
  features['branches.extra_limit'] = branches

```

with:

```ts
  const branches = terms?.extra_branches_limit !== undefined ? terms.extra_branches_limit : plan.extra_branches_limit
  features['branches.extra_limit'] = branches

  // Release-complete: every key of every application is present. A left-out application
  // is closed (booleans false, limits 0); a core or included one keeps the catalog value
  // for a limit nobody set. Odoo refuses a policy write that misses a key.
  for (const app of release.applications) for (const f of app.features) {
    if (Object.hasOwn(features, f.key)) continue
    const open = !app.selectable || selectedApps.has(app.id)
    features[f.key] = f.kind === 'boolean' ? false : open ? (f.ceiling ?? null) : 0
  }

```

- [ ] **Step 4: Display entitled applications from features**

Create `apps/web/app/utils/entitlementApps.ts`:

```ts
type FeatureMap = Record<string, boolean | number | null>
type ReleaseLike = { applications: Array<{ id: string; selectable: boolean; features: Array<{ key: string; kind: string }> }> }

const ENABLED = /^([a-z][a-z0-9_]*)\.enabled$/

/** The applications a compiled entitlement opens, read from its `<app>.enabled` keys.
 * `entitlement.modules` is the whole release (every application is installed in every
 * tenant), so it never says which applications a customer has. */
export function entitledFeaturePrefixes(features: FeatureMap | null | undefined): string[] {
  return Object.entries(features ?? {})
    .flatMap(([key, value]) => {
      const match = ENABLED.exec(key)
      return match && value === true ? [match[1]!] : []
    })
    .sort()
}

/** Bundle-style selections of the release applications whose booleans the entitlement opens. */
export function entitledSelections(release: ReleaseLike | null | undefined, features: FeatureMap | null | undefined): { app_id: string; feature_keys: string[] }[] {
  if (!release) return []
  return release.applications.filter(app => app.selectable).flatMap((app) => {
    const keys = app.features.filter(f => f.kind === 'boolean' && features?.[f.key] === true).map(f => f.key)
    return keys.length ? [{ app_id: app.id, feature_keys: keys }] : []
  })
}
```

In `apps/web/app/pages/subscription/index.vue` replace:

```ts
import { formatSubscriptionMoney } from '@/utils/subscription'
```

with:

```ts
import { formatSubscriptionMoney } from '@/utils/subscription'
import { entitledFeaturePrefixes } from '@/utils/entitlementApps'
import { humanizeId } from '@/utils/labelFallback'
```

replace `const { t, locale } = useI18n(); const api = useSubscriptionApi();` with `const { t, te, locale } = useI18n(); const api = useSubscriptionApi();`, add after `const entitlement = computed(() => data.value?.sub.applied?.entitlement ?? null)`:

```ts
const entitledApps = computed(() => entitledFeaturePrefixes(entitlement.value?.features))
const appLabel = (app: string) => (te(`subscription.apps.${app}`) ? t(`subscription.apps.${app}`) : humanizeId(app))
```

and replace:

```vue
          <p v-if="!entitlement" class="text-sm text-muted">{{ t('subscription.summary.noServices') }}</p>
          <ul v-else class="flex flex-wrap gap-2"><li v-for="m in entitlement.modules" :key="m"><UBadge color="neutral" variant="subtle">{{ m }}</UBadge></li></ul>
```

with:

```vue
          <p v-if="!entitledApps.length" class="text-sm text-muted">{{ t('subscription.summary.noServices') }}</p>
          <ul v-else class="flex flex-wrap gap-2"><li v-for="app in entitledApps" :key="app"><UBadge color="neutral" variant="subtle">{{ appLabel(app) }}</UBadge></li></ul>
```

In `apps/web/app/pages/vendor/customers/[id].vue` replace the `selections` line with:

```ts
const selections = computed(() => entitledSelections(release.value, view.value?.applied?.entitlement.features))
```

and add `import { entitledSelections } from '@/utils/entitlementApps'` as the last import line of its `<script setup>` block.

In `apps/web/app/pages/vendor/customers/index.vue` replace the `services` line with:

```ts
const services = (c: VendorCustomer) => (c.subscription?.applied ? entitledFeaturePrefixes(c.subscription.applied.entitlement.features).length : null)
```

and add `import { entitledFeaturePrefixes } from '@/utils/entitlementApps'` as the last import line of its `<script setup>` block.

In `apps/web/i18n/locales/ar/subscription.json`, inside the `"subscription"` object, add after the `"summary"` entry:

```json
    "apps": { "pmo": "المشاريع", "meetings": "الاجتماعات", "hr": "الموارد البشرية", "chat": "المحادثات" },
```

and in `apps/web/i18n/locales/en/subscription.json` at the same place:

```json
    "apps": { "pmo": "Projects", "meetings": "Meetings", "hr": "People", "chat": "Chat" },
```

- [ ] **Step 5: Run the focused checks and the live suites**

```bash
npm -w packages/commercial-contracts run test 2>&1 | tail -n 5
npm -w packages/commercial-contracts run build 2>&1 | tail -n 3
npm -w apps/control-plane run build 2>&1 | tail -n 3
python3 -B -m unittest tools.shared_saas_lifecycle.test_subscription_effect 2>&1 | tail -n 3
npm -w apps/web run test -- app/utils/__tests__/entitlementApps.test.ts app/pages/__tests__/subscriptionJourney.test.ts 2>&1 | tail -n 5
npm -w apps/web run lint 2>&1 | tail -n 5
/tmp/nasq-packages/cp-live.sh 2>&1 | tail -n 15
```

Expected: all green; `CP_LIVE_EXIT 0` with Task 0 Step 7's counts. A live failure that asserts an exact compiled `features` or `modules` map is fixed by updating that assertion to the release-complete map (record each one); any other failure is a blocker.

- [ ] **Step 6: Commit**

```bash
git add packages/commercial-contracts/src/commercial/entitlements.ts packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts \
  tools/shared_saas_lifecycle/test_subscription_effect.py apps/web/app/utils/entitlementApps.ts \
  apps/web/app/utils/__tests__/entitlementApps.test.ts apps/web/app/pages/subscription/index.vue \
  "apps/web/app/pages/vendor/customers/[id].vue" apps/web/app/pages/vendor/customers/index.vue \
  apps/web/i18n/locales/ar/subscription.json apps/web/i18n/locales/en/subscription.json \
  apps/web/app/pages/__tests__/subscriptionJourney.test.ts
git status --short
git commit -m "feat(cp): compile release-complete entitlements (compiler 2)" -m "<TRAILER>"
```

`git status --short` before the commit must list only files of this task (plus any live-test assertion you updated in Step 5; add it with its own path).

---

### Task 6: Compare managed installs with the closure the readback reports (worker.ts:73)

**Files:**
- Modify: `tools/nasq_cli/managed_verify.py` (add `expected_modules` after `_expected_modules`, `:90-95`)
- Modify: `tools/nasq_cli/managed_runtime.py:74-79,776-778,1015-1016`
- Modify: `tools/test_managed_runtime.py:449-450,1123-1125`
- Modify: `apps/control-plane/src/worker.ts:63-75`
- Modify: `apps/control-plane/src/__tests__/worker-managed.test.ts:83-89,158-171` (+ one test), `apps/control-plane/src/__tests__/worker-v2-policy.test.ts:61-66`

**Interfaces:**
- Produces: `managed_verify.expected_modules(policy) -> list[str]` (sorted install closure); managed create and status receipts carry `expected_modules`; `verifiedManagedCreate` requires it, requires every `policy.modules` entry in it, and requires installed `nasq_*` == it.

- [ ] **Step 1: Write the failing tests**

In `tools/test_managed_runtime.py` add after `        self.assertEqual(payload['profile']['features'], CORE_POLICY['features'])` at line 450:

```python
        self.assertEqual(payload['expected_modules'], ['nasq_api', 'nasq_core', 'nasq_platform'])
```

and after the same assertion at line 1125 (in `StatusReceiptCase`):

```python
        self.assertEqual(payload['expected_modules'], ['nasq_api', 'nasq_core', 'nasq_platform'])
```

In `apps/control-plane/src/__tests__/worker-managed.test.ts`, in `verifiedReceipt`, replace:

```ts
      status: 'active', valid_until: null, features: policy.features, modules: [...policy.modules, 'base', 'web'] },
  })
```

with:

```ts
      status: 'active', valid_until: null, features: policy.features, modules: [...policy.modules, 'base', 'web'] },
    expected_modules: [...policy.modules],
  })
```

add to the `it.each([...])('rejects truth flags with %s in the durable receipt', ...)` table, after `['malformed modules', ...]`:

```ts
    ['missing expected modules', (r: Record<string, unknown>) => { delete r.expected_modules }],
    ['expected modules without a policy module', (r: Record<string, unknown>) => { r.expected_modules = (r.expected_modules as string[]).filter(name => name !== 'nasq_api') }],
    ['non-Nasq expected module', (r: Record<string, unknown>) => { r.expected_modules = [...(r.expected_modules as string[]), 'web'] }],
```

and add after that `it.each` block:

```ts
  it('accepts the installation closure the Python readback reports (implied services and bridges)', async () => {
    const claim = fakeClaim('tenant.create')
    const config = await managedConfig(async (invocation) => {
      const receipt = verifiedReceipt(invocation)
      if (invocation.args[0] === 'status') {
        ;(returnedProfile(receipt).modules as string[]).push('nasq_notify')
        receipt.expected_modules = [...(receipt.expected_modules as string[]), 'nasq_notify']
      }
      return { code: 0, receipt }
    })
    const pool = fakePool(claim, await publishedCatalog())
    await executeClaimed(pool, claim, config)
    expect(terminal(pool).slice(0, 2)).toEqual(['succeeded', 'provisioned'])
  })
```

In `apps/control-plane/src/__tests__/worker-v2-policy.test.ts`, in `receipt`, replace `profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features: policy.features, modules: [...policy.modules, 'base', 'web'] } }` with `profile: { commercial_mode: 'saas', entitlement_source: 'control_plane', policy_revision: 1, features: policy.features, modules: [...policy.modules, 'base', 'web'] }, expected_modules: [...policy.modules] }`.

- [ ] **Step 2: Run them to see them fail**

```bash
python3 -B -m unittest discover -s tools -p 'test_managed_runtime.py' 2>&1 | tail -n 4
npm -w apps/control-plane test -- src/__tests__/worker-managed.test.ts 2>&1 | tail -n 6
```

Expected: Python `KeyError: 'expected_modules'`; TS: the three new rejection cases fail (accepted today).

- [ ] **Step 3: Return the closure from the Python readback**

In `tools/nasq_cli/managed_verify.py` add after `_expected_modules`:

```python


def expected_modules(policy):
    """The installation closure readback compares with; managed receipts carry it so
    the control plane checks the same set (worker verifiedManagedCreate)."""
    return _expected_modules(policy)
```

In `tools/nasq_cli/managed_runtime.py` replace the import block:

```python
from .managed_verify import (
    VerificationError,
    build_policy_script,
    build_snapshot_script,
    parse_snapshot,
)
```

with:

```python
from .managed_verify import (
    VerificationError,
    build_policy_script,
    build_snapshot_script,
    expected_modules,
    parse_snapshot,
)
```

replace:

```python
    return _payload(fields, 'ok', 'provisioned', changed=True,
                    lifecycle='provisioned', deployment_ready=True,
                    policy_verified=True, profile=outcome['profile'],
                    policy_revision=outcome['profile']['policy_revision'])
```

with:

```python
    return _payload(fields, 'ok', 'provisioned', changed=True,
                    lifecycle='provisioned', deployment_ready=True,
                    policy_verified=True, profile=outcome['profile'],
                    policy_revision=outcome['profile']['policy_revision'],
                    expected_modules=expected_modules(create_policy))
```

and replace:

```python
            verified = {'policy_verified': True, 'deployment_ready': True,
                        'profile': profile, 'policy_revision': profile['policy_revision']}
```

with:

```python
            verified = {'policy_verified': True, 'deployment_ready': True,
                        'profile': profile, 'policy_revision': profile['policy_revision'],
                        'expected_modules': expected_modules(policy)}
```

- [ ] **Step 4: Compare with it in the worker**

In `apps/control-plane/src/worker.ts` replace:

```ts
  const modules = profile.modules
  if (!Array.isArray(modules) || modules.length > 1024 || modules.some((name) => typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(name)) || new Set(modules).size !== modules.length) return false
  // Stock Odoo dependencies are not additional Nasq pillars.
  if (canonicalJson(modules.filter((name: string) => name.startsWith('nasq_')).sort()) !== canonicalJson([...policy.modules].sort())) return false
  return true
}
```

with:

```ts
  const modules = profile.modules
  if (!moduleList(modules)) return false
  // Odoo installs the closure of policy.modules (implied services, auto-install bridges).
  // The Python readback proves that closure and reports it as expected_modules.
  const expected = receipt.expected_modules
  if (!moduleList(expected) || expected.some(name => !name.startsWith('nasq_'))) return false
  if (!policy.modules.every(name => expected.includes(name))) return false
  // Stock Odoo dependencies are not additional Nasq pillars.
  if (canonicalJson(modules.filter(name => name.startsWith('nasq_')).sort()) !== canonicalJson([...expected].sort())) return false
  return true
}

function moduleList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 1024 && value.every(name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(name)) && new Set(value).size === value.length
}
```

- [ ] **Step 5: Run the focused checks**

```bash
python3 -B -m unittest discover -s tools -p 'test_managed_*.py' 2>&1 | tail -n 3
npm -w apps/control-plane test -- src/__tests__/worker-managed.test.ts src/__tests__/worker-v2-policy.test.ts src/__tests__/worker-real-adapter.test.ts src/__tests__/managed-registration.test.ts 2>&1 | tail -n 5
npm -w apps/control-plane run build 2>&1 | tail -n 3
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tools/nasq_cli/managed_verify.py tools/nasq_cli/managed_runtime.py tools/test_managed_runtime.py \
  apps/control-plane/src/worker.ts apps/control-plane/src/__tests__/worker-managed.test.ts \
  apps/control-plane/src/__tests__/worker-v2-policy.test.ts
git commit -m "fix(cp): compare managed installs with the reported closure" -m "<TRAILER>"
```

---

### Task 7: Grant the package administrator's roles by entitlement; drop ALLOWED_MODULES

**Files:**
- Modify: `odoo-addons/nasq_platform/models/entitlement_service.py` (one method after `_nasq_close_unlisted_features`)
- Modify: `odoo-addons/nasq_pmo/tests/test_package_change.py` (append one test)
- Modify: `tools/shared_saas_lifecycle/odoo_effect.py:20-45,311-341`
- Modify: `tools/shared_saas_lifecycle/subscription_effect.py:19`
- Modify: `tools/shared_saas_lifecycle/test_odoo_effect.py:13-19,104-132`

**Interfaces:**
- Produces: `env['nasq.entitlement.service']._nasq_entitled_admin_roles() -> list[str]` — the keys of `nasq.access.service._nasq_legacy_admin_roles()` whose role holds any platform permission (a permission domain without a registered `<domain>.enabled` boolean), or whose application features `<domain>.enabled` are all `True` in the current policy.
- Produces: `odoo_effect.validate_modules(value)` accepts any non-empty list of distinct `(nasq|customer)_*` names that each have `odoo-addons/<name>/__manifest__.py`; `ALLOWED_MODULES` no longer exists.

- [ ] **Step 1: Write the failing tests**

Append to `TestPackageChange` in `odoo-addons/nasq_pmo/tests/test_package_change.py`:

```python

    def test_administrator_roles_follow_the_entitlement(self):
        service = self.env['nasq.entitlement.service']
        self._write(service._nasq_close_unlisted_features({
            **TARGET_WITHOUT_PMO, 'pmo.enabled': True, 'projects.max_projects': None,
        }))
        opened = service._nasq_entitled_admin_roles()
        self.assertIn('system_admin', opened)
        self.assertIn('pmo_manager', opened)
        self.assertNotIn('hr_manager', opened)
        self._write(service._nasq_close_unlisted_features(TARGET_WITHOUT_PMO))
        closed = service._nasq_entitled_admin_roles()
        self.assertIn('system_admin', closed)  # holds platform permissions next to meetings ones
        self.assertNotIn('pmo_manager', closed)
```

In `tools/shared_saas_lifecycle/test_odoo_effect.py` replace `test_database_and_modules_fail_closed` with:

```python
    def test_database_and_modules_fail_closed(self):
        self.assertEqual(odoo_effect.validate_database('nasq_scratch_' + 'a' * 32), 'nasq_scratch_' + 'a' * 32)
        for value in ['odoo19', 'postgres', 'nasq_scratch_prod', 'nasq_scratch_a;drop']:
            with self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_database(value)
        for value in [['nasq_core', 'sale'], ['nasq_core', 'nasq_not_shipped'], [], ['nasq_core', 'nasq_core'], 'nasq_core']:
            with self.subTest(value=value), self.assertRaises(odoo_effect.EffectError):
                odoo_effect.validate_modules(value)
        release = ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_meetings', 'nasq_hr', 'nasq_chat']
        self.assertEqual(odoo_effect.validate_modules(release), release)
        self.assertFalse(hasattr(odoo_effect, 'ALLOWED_MODULES'))
```

In the `Environment.__getitem__` of `PackageAdministratorScriptTests.run_script`, replace:

```python
                if model == 'nasq.entitlement.service':
                    return SimpleNamespace(
                        _nasq_excluded_user_ids=lambda: (1, 2) if admin.support_member else (1,),
                        _nasq_count_users=lambda: count if count is not None else (0 if admin.support_member else 1),
                    )
                raise AssertionError(model)
```

with:

```python
                if model == 'nasq.entitlement.service':
                    return SimpleNamespace(
                        _nasq_excluded_user_ids=lambda: (1, 2) if admin.support_member else (1,),
                        _nasq_count_users=lambda: count if count is not None else (0 if admin.support_member else 1),
                        _nasq_entitled_admin_roles=lambda: ['system_admin', 'pmo_manager', 'hr_manager'],
                    )
                if model == 'nasq.access.role':
                    return SimpleNamespace(search=lambda domain, limit=None: SimpleNamespace(id=domain[0][2]))
                raise AssertionError(model)
```

and add to the class:

```python

    def test_admin_script_reads_roles_from_the_entitlement_not_modules(self):
        script = object.__new__(odoo_effect.Runner)
        script.database = 'nasq_scratch_' + 'a' * 32
        script.request = {'admin': {'name': 'A', 'login': 'a@example.test'}, 'companyName': 'C',
                          'job': {'policy': {'modules': ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr']}}}
        text = script.admin_script('known-secret', snapshot=False)
        self.assertIn('_nasq_entitled_admin_roles()', text)
        self.assertNotIn("'nasq_pmo' in values['modules']", text)
        self.assertNotIn('"modules"', text.split('\n', 2)[1])
```

- [ ] **Step 2: Run them to see them fail**

```bash
python3 -B -m unittest tools.shared_saas_lifecycle.test_odoo_effect 2>&1 | tail -n 4
```

Expected: `test_database_and_modules_fail_closed` fails on `hasattr(odoo_effect, 'ALLOWED_MODULES')`, `test_admin_script_reads_roles_from_the_entitlement_not_modules` fails on `_nasq_entitled_admin_roles()`; the other administrator tests still pass (the double now answers both the old and the new lookups).

- [ ] **Step 3: Add the Odoo role derivation**

In `odoo-addons/nasq_platform/models/entitlement_service.py` insert after `_nasq_close_unlisted_features`:

```python
    @api.model
    def _nasq_entitled_admin_roles(self):
        """Administrator role keys the current policy opens.

        A role holding any platform permission (a permission domain without a
        registered ``<domain>.enabled`` boolean) is always open. A role made only
        of application permissions opens when every one of those applications'
        ``<domain>.enabled`` is granted. Installed modules never decide it: every
        application of the release is installed in every tenant.
        """
        registry = self._nasq_registry()._nasq_feature_map()
        payload = self._nasq_features_payload()
        roles = self.env['nasq.access.role']
        keys = []
        for key in self.env['nasq.access.service']._nasq_legacy_admin_roles():
            role = roles.search([('key', '=', key)], limit=1)
            if not role:
                continue
            gates = {f'{domain}.enabled' for domain in role.permission_ids.mapped('domain')}
            application = {gate for gate in gates if registry.get(gate, {}).get('type') == 'boolean'}
            if application == gates and not all(payload.get(gate) is True for gate in gates):
                continue
            keys.append(key)
        return keys

```

- [ ] **Step 4: Use it in the admin script; validate modules generically**

In `tools/shared_saas_lifecycle/odoo_effect.py` replace:

```python
from tools.nasq_cli.managed_policy import POLICY_ERROR_CODES, PolicyError, parse_create_policy, parse_package_create_policy

ALLOWED_MODULES = {
    'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory',
    'nasq_pmo', 'nasq_meetings', 'nasq_meetings_pmo', 'nasq_hr', 'nasq_chat',
}
MAX_OUTPUT = 65536
```

with:

```python
from tools.nasq_cli.managed_policy import POLICY_ERROR_CODES, PolicyError, parse_create_policy, parse_package_create_policy
from tools.nasq_cli.module_closure import REPO_ADDONS

MODULE_ID = re.compile(r'(?:nasq|customer)_[a-z0-9_]+')
MAX_OUTPUT = 65536
```

replace:

```python
def validate_modules(value):
    if (not isinstance(value, list) or not value or len(set(value)) != len(value)
            or not set(value) <= ALLOWED_MODULES):
        raise EffectError('modules_invalid')
    return value
```

with:

```python
def validate_modules(value):
    """A non-empty list of distinct Nasq or customer addons shipped in this repository.

    Which modules a policy installs comes from the trusted catalog; this only refuses
    names that cannot be an addon of this release, so a new application needs no edit.
    """
    if (not isinstance(value, list) or not value or len(set(value)) != len(value)
            or not all(isinstance(name, str) and MODULE_ID.fullmatch(name)
                       and (REPO_ADDONS / name / '__manifest__.py').is_file() for name in value)):
        raise EffectError('modules_invalid')
    return value
```

In `admin_script` replace:

```python
        values = {'database': self.database, 'name': self.request['admin']['name'], 'login': self.request['admin']['login'],
                  'companyName': self.request['companyName'], 'modules': self.request['job']['policy']['modules'],
                  'packageAdmin': self.request['job'].get('packageAuthority') is not None}
```

with:

```python
        values = {'database': self.database, 'name': self.request['admin']['name'], 'login': self.request['admin']['login'],
                  'companyName': self.request['companyName'],
                  'packageAdmin': self.request['job'].get('packageAuthority') is not None}
```

replace:

```python
    keys = ['system_admin']
    if 'nasq_pmo' in values['modules']:
        keys.append('pmo_manager')
    if 'nasq_hr' in values['modules']:
        keys.append('hr_manager')
```

with:

```python
    # Every application is installed; the applied policy decides the roles.
    keys = env['nasq.entitlement.service']._nasq_entitled_admin_roles()
```

and replace:

```python
            role = env.ref({'pmo_manager': 'nasq_pmo', 'hr_manager': 'nasq_hr'}.get(key, 'nasq_core') + '.role_' + key)
```

with:

```python
            role = env['nasq.access.role'].search([('key', '=', key)], limit=1)
            assert role
```

In `tools/shared_saas_lifecycle/subscription_effect.py` replace `from tools.shared_saas_lifecycle.odoo_effect import EffectError, ALLOWED_MODULES, MAX_OUTPUT` with `from tools.shared_saas_lifecycle.odoo_effect import EffectError, MAX_OUTPUT`.

- [ ] **Step 5: Run the focused checks and the ten-addon suite (background)**

```bash
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
ruff check odoo-addons
rg -n "ALLOWED_MODULES|'nasq_pmo' in values" tools apps || echo "no app list left in the effects"
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_t7 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
```

Expected: tools `OK`; `All checks passed!`; `no app list left in the effects`; `ODOO_RUN_TEST_OK` with Task 2's TEN count + 1.

- [ ] **Step 6: Commit**

```bash
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
git add odoo-addons/nasq_platform/models/entitlement_service.py odoo-addons/nasq_pmo/tests/test_package_change.py \
  tools/shared_saas_lifecycle/odoo_effect.py tools/shared_saas_lifecycle/subscription_effect.py \
  tools/shared_saas_lifecycle/test_odoo_effect.py
git commit -m "refactor(tools): grant admin roles by entitlement, not modules" -m "<TRAILER>"
```

Expected: `arch_policy exit=0`.

---

### Task 8: Gates for plan 3a

**Files:** none changed (a failing gate is fixed in the task that owns the file, with its own commit).

- [ ] **Step 1: Static and unit gates**

```bash
ruff check odoo-addons
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
python3 -B tools/catalog_check.py
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
git diff --stat main -- tools/arch_baseline.json tools/arch_layers.json deploy/catalog/solutions/platform.json deploy/catalog/solutions/platform_v2.json
npm test 2>&1 | tail -n 12
npm -w apps/web run lint 2>&1 | tail -n 5
npm -w packages/commercial-contracts run test 2>&1 | tail -n 4
npm -w packages/commercial-contracts run build 2>&1 | tail -n 3
npm -w apps/control-plane run build 2>&1 | tail -n 3
/tmp/nasq-packages/cp-live.sh 2>&1 | tail -n 15
```

Expected: `All checks passed!`; deploy `OK`; `CATALOG_OK solutions=3`; three `exit=0`; the `git diff --stat` prints nothing; everything else green; `CP_LIVE_EXIT 0`.

- [ ] **Step 2: The three Odoo installs (background, one after the other)**

```bash
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_3a \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_3a_hr \
  nasq_core,nasq_platform,nasq_api,nasq_hr /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-packages/odoo-run.sh test nasq_scratch_packages_3a_meet \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
```

Expected: three `ODOO_RUN_TEST_OK`; counts Task 0 + 9 (TEN), + 5 (HR), + 5 (MEET).

- [ ] **Step 3: Report**

Report: base commit; the commit hashes and subjects (`git log --format='%h %s' main..HEAD`, eight commits including the plans); the four `REPRO_*` lines before (Task 1 Step 2) and after (Step 9); the arch totals (unchanged); the Odoo counts of Task 0 and Step 2 with their `INSTALLED_PROBE` lines; the live suite counts; every live assertion updated in Task 5 Step 5; that the main checkout holds untracked copies of both plans. Then continue with plan 3b (`docs/superpowers/plans/2026-10-07-phase-3b-packages-commerce.md`) in the same worktree. Do not merge or push.
