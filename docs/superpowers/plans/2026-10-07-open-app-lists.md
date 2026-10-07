# Open the Hard-Coded Application Lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fourth application (`nasq_sales`: capabilities `sales.orders.read|write`, feature `sales.enabled`, module id `nasq_sales`, permission domain `sales`) installs and works without any edit to `nasq_core`, `nasq_platform`, `nasq_api`, the shared contracts or the web shell's core code, while today's four applications keep exactly today's behaviour and wire shapes.

**Architecture:** The closed lists become validated open values with today's values kept as typed constants: the Odoo permission `domain` becomes a `Char` with an identifier constraint (`nasq_core` 19.0.1.2.0, README migration); the Zod `CapabilitySchema`, `NasqModuleIdSchema` and permission `domain` become pattern-checked strings next to `KNOWN_*` const arrays and literal-union helper types; the bell list keeps its strict known arms and gains one generic arm for kinds it does not know; the web derives a capability's feature (`<first segment>.enabled`) and read/write class (write unless the last segment is `read`) with explicit exceptions for today's non-application prefixes; unknown domain and module labels fall back to a humanised id; `tools/arch_policy.py` builds its R2 application tokens from the rank 4/5 addons of `tools/arch_layers.json`. A simulated `sales` application (no new addon) proves every layer.

**Tech Stack:** Odoo 19 Community (`/Users/tariq/code/odoo`, read-only), Python 3, PostgreSQL scratch databases, Zod 4.6 (`packages/contracts`), Nuxt 4 + vue-i18n + Vitest (`apps/web`), `tools/arch_policy.py`, `tools/migration_guard.py`, `tools/api_surface.py`.

**Spec:** `docs/reports/2026-10-07-generic-app-layer-spike.md` §4 item 3 ("Hard-coded app lists in the foundation") and §5 ("Prerequisites before the first generated app"); `docs/superpowers/specs/2026-10-05-nasq-reference-architecture-and-git-workflow-design.md` §2 (R1–R10) and §2.1 (the five layers; R3 on the web); roadmap `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, "المرحلة 5" (prerequisite 1). The controller rulings for this task (2026-10-07) are folded into the Global Constraints and the Deviations below. Model for structure, runner and gates: `docs/superpowers/plans/2026-10-07-phase-2b2-meetings.md` (Task 0, Task 9, Task 10).

## Deviations from rulings

Each item is a place where a ruling is impossible, incomplete or ambiguous against the source, with the design used instead. The reviewer can reject any of them.

1. **Ruling 4 names `accessPolicy.ts`, but no code there changes.** `accessPolicy.ts` reaches the feature gate only through `canUse`/`featureForCapability`/`hasFeature` of `apps/web/app/modules/registry.ts`, so the derivation lives in `registry.ts` and `accessPolicy.ts` gets tests only (Task 5). Its remaining lists are navigation (`destinations`, `requiredCapabilityForPath`, `isNavPathActive`) and the bell gate `NOTIFICATION_ACCESS` (`['pmo.tasks.read', 'meetings.read']`, and in `registry.ts` `pmo.enabled || meetings.enabled`): both stay, as navigation belongs to Phase 4 (ruling "out of scope"). Consequence: a tenant that has only a new application never sees the bell; recorded in the roadmap.
2. **Ruling 4, the override map is larger than "today's mappings where they differ".** Unconditional derivation would gate every capability that reaches `canReach` today, not only application keys. The source passes `access.*`, `settings.*`, `vendor.*`, the bare `vendor`, `nasq.internal` and `nasq.notifications` to `canUse` (shell links, `useAccess().can`, the route middleware), and the customer prefixes `subscription.*`, `billing.*`, `branches.*` exist next to them. `access.enabled` or `vendor.enabled` would never be in `readable_features`, so the settings and vendor screens would vanish for every tenant with a platform policy. **Design used:** an explicit map `nasq.internal → chat.enabled`, a `FEATURELESS_PREFIXES` set (`access`, `settings`, `nasq`, `vendor`, `subscription`, `billing`, `branches`) that keeps "no feature", and a `READ_CAPABILITIES` set holding `nasq.internal`: without it `/chat` would need a *writable* `chat.enabled` (its last segment is `internal`, not `read`) and the route middleware would answer 403 on `/chat` for a suspended tenant. Task 5 pins every one of today's 28 capabilities plus `nasq.internal` to today's exact feature and class, except `meetings.manage` (accepted by the ruling).
3. **Ruling 3, generic arm chosen; schemas stay in `contracts/src/pmo/notification.ts`.** Dropping unknown rows was rejected: `useNotificationsPage().getNextPageParam` compares the number of loaded items with `total`, so a dropped row makes "load more" fetch forever, and `unread_count` would count rows the user can never open. The generic arm is `UnknownNotificationSchema` (`id`, `kind` an identifier that is *not* a known kind, optional `title`/`body`, `created_at`, `is_read`, extra keys kept with `.loose()`); a known kind never falls back, so a malformed known row still fails the whole list (Review Focus 2). The move to `common/` that the ruling allows is not done: the known arms are application shapes and the generic arm must exclude exactly those kinds, so a split would need a factory with no consumer benefit. `isMeetingNotification` changes from `kind.startsWith('meeting_')` to "one of the seven known meeting kinds", or a future `meeting_*` kind would navigate to `/meetings/undefined`.
4. **"No API surface change" vs `docs/api/openapi.json`.** `tools/api_surface.py` publishes every exported Zod schema under `components/schemas`, so loosening the contracts necessarily changes those components: 11 changed (`CapabilitySchema`, `RoleDetailSchema`, `RoleCreateInputSchema`, `RolePatchInputSchema`, `PermissionDefinitionSchema`, `PermissionCatalogSchema`, `EffectiveCapabilitySchema`, `AdminUserDetailSchema`, `MeSchema`, `NasqModuleIdSchema`, `NotificationListSchema`) and 3 added (`PermissionDomainSchema`, `UnknownNotificationSchema`, `BellNotificationSchema`). `paths`, parameters, `x-nasq`, `tags`, `info` and every other component stay identical; Task 8 compares generated-before with generated-after and fails on anything else.
5. **"Existing tests keep their literal expectations for today's apps" — four contract tests pinned the closed lists themselves, not today's values.** They are rewritten to pin the pattern: `access/__tests__/schemas.test.ts` (`CapabilitySchema.options` → `KNOWN_CAPABILITIES`, still exactly the 28 keys in order; `'not.a.capability'` is now well-formed, so the rejection uses `'Not.A.Capability'`), `access/__tests__/me-fail-closed.test.ts` (`'access.users.not_real'` → malformed keys), `common/__tests__/schemas.test.ts` (`'nasq_unknown'` → malformed module ids). `apps/web/app/utils/__tests__/vendorPackages.test.ts` keeps `future_module → 'future_module'` (it does not match the module-id pattern, so it is not humanised).
6. **Ruling 1, a server-side key constraint is added.** The open contract trusts the server to send well-formed keys. The same `@api.constrains` that checks `domain` also checks `key` against the contract's capability pattern, so an application's XML with a malformed key fails its own install instead of making `/me` fail to parse for every user. All 28 current keys match. No index is added to `domain` (same column, as ruled).
7. **Ruling 1, the migration is a README.** `fields.Selection` and `fields.Char` (no size) both map to `varchar` (`odoo/orm/fields_selection.py` `_column_type = ('varchar', pg_varchar())`), and the stored values do not change. On update Odoo itself drops the five `ir_model_fields_selection` rows of the old selection: their `ir_model_data` rows are not re-declared, `_process_end` unlinks them, and `ir.model.fields.selection._process_ondelete` skips a field whose type changed ("Field changed its type, skip it."). `nasq_core` goes 19.0.1.1.0 → **19.0.1.2.0** with `migrations/19.0.1.2.0/README.md`; Task 7 proves the column, the values and the cleanup on both CI upgrade paths.
8. **Ruling 5, humanised fallback is English text.** `humanizeId('nasq_sales')` is `Sales` in both locales; a generic Arabic string would hide which application the permission belongs to. Owner decision 1. Vendor tiers, features and limits keep their raw-value fallback (Phase 3, inventory C8); only module ids that match the module-id pattern are humanised.

**Inventory corrections found while reading the source (`main` `1aa7c4b4`):**

- `nasq_core` is 19.0.1.1.0 (Phase 2); this plan bumps it to 19.0.1.2.0. `AGENTS.md` still says core is 19.0.1.0.0; Task 8 corrects the version line.
- `featureForCapability` returns `null` for `access.*` and `settings.*` today; derivation alone would change that (Deviation 2).
- `apps/web/app/composables/useNotifications.ts` is imported by `NotificationCenter.test.ts` without the Nuxt `@/` alias (Vitest has no alias), so its new import uses a relative path.
- The `R2` baseline (`odoo-addons/nasq_platform/models/entitlement_service.py: 4`) is unchanged by the token change: verified by running the new pattern over today's tree (`nasq_meetings.`, `nasq_meetings_pmo.` and `meetings_pmo.` occur in no foundation file).
- `npm -w packages/contracts run build` (`tsc --noEmit`, tests included) is green on `main`; it is not part of `npm test`, so this plan runs it explicitly (it is what checks the `@ts-expect-error` pins).

## Global Constraints

- No API surface change: the same `(method, path)` operations, parameters, `x-nasq` metadata and response *values*; `openapi.json` changes only in the contract components of Deviation 4.
- Capability keys unchanged (the same 28 keys, owners, role grants and dependencies); every stored permission `domain` keeps its value (`access`, `hr`, `pmo`, `meetings`, `settings`, equal to the key's first segment).
- Today's applications keep today's behaviour: every client feature gate and read/write class is identical except `meetings.manage` becoming a write (ruling 4); every known bell kind keeps its exact strict shape; known domain and module labels keep their translations.
- Open values, with exact patterns: capability key `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`; module id `^(nasq|customer)_[a-z0-9_]+$`; permission domain and bell kind `^[a-z][a-z0-9_]*$`. Today's values stay exported as `KNOWN_CAPABILITIES`, `KNOWN_NASQ_MODULE_IDS`, `KNOWN_PERMISSION_DOMAINS` (`as const`) with `KnownCapability`, `KnownNasqModuleId`, `KnownPermissionDomain` and the open `Capability`, `NasqModuleId`, `PermissionDomain` (`Known… | (string & {})`). Parsing never throws on a new well-formed value.
- No new `sudo()` and no new SQL on Odoo tables: `R7 83`, `R9 68` and every other rule total stay exactly as on `main` (`R1 0, R10 0, R2 4, R3 4, R4 0, R5 8, R6 0, R7 83, R8 1, R9 68`). `tools/arch_baseline.json` does not change; every commit leaves `python3 -B tools/arch_policy.py --base main` at exit 0. `tools/arch_layers.json` does not change.
- Versions (`docs/migrations.md`): `nasq_core` 19.0.1.1.0 → 19.0.1.2.0 with `odoo-addons/nasq_core/migrations/19.0.1.2.0/README.md`; no other addon version changes. Do not edit any released migration.
- Out of scope (record in the roadmap, do not fix): navigation, rail icons, context links and global search for new apps (`shellModules.ts`, `activeRoute.ts`, search); the `nuxt.config.ts` locale file list; the bell gate for a tenant with only a new app; `nasq_platform` `TERMINOLOGY_KEYS`; the one-shot legacy policy (operator entitle step for a new app's feature on an existing tenant); every tools/deploy/catalog/control-plane module list (Phase 3); contextual scope and role keys (`project`, `project_owner`, `project_creation_policy`).
- Tests green after every commit: the full ten-addon install, the partial `nasq_core,nasq_platform,nasq_api,nasq_hr`, the meetings-without-project install `nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings`; `npm test`; `npm -w apps/web run lint`; `npm -w packages/contracts run build`; `ruff check odoo-addons`.
- Every new Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.` `ruff check odoo-addons` stays clean (EM101: assign the exception message to a variable first; COM812: trailing commas on multi-line literals and calls; I001: import order as in the neighbouring tests).
- Web: user-facing strings through `t()` in the owning locale file, both `ar` and `en`; logical Tailwind classes only; no Storybook-listed component is touched (`NotificationCenter.vue`, `RolePermissionForm.vue` are not in `STORYBOOK_COMPONENTS`), so no story changes; new util names must not collide in Nuxt's flat `utils/` namespace (`humanizeId`, `permissionDomainLabel`, `isKnownNotificationKind`, `isMeetingNotificationKind` are unused today).
- Scratch databases match `nasq_scratch_openlists_[a-z0-9_]+`; the runner refuses any other name and any name containing `odoo19`. Never run anything against `odoo19`. Never point Odoo at a config whose `data_dir` or `logfile` is inside `/Users/tariq/code/odoo`. Odoo HTTP port 8229.
- Work only in `/Users/tariq/code/nasq-open-lists` on branch `codex/core-open-app-lists`. Do not touch the main checkout's uncommitted owner changes (`.gitignore`, `docs/WORKSPACE.md`, `package.json`, `package-lock.json`, untracked `.agents/`, `.planning/`, `docs/e2e.md`, `e2e.config.ts`, `e2e/`, `plans/`).
- Commit subjects are `type(scope): subject`, at most 72 characters, scope from `core platform api pmo hr chat meetings web cp deploy tools docs ci`. The `Co-Authored-By` trailer goes in the commit **body**: every commit is `git commit -m "<subject>" -m "<TRAILER>"`, where you type the exact trailer line your dispatch gives in place of `<TRAILER>`. Do not merge, push, delete branches or change Git config.
- A full ten-addon Odoo run takes 10–25 minutes. Start it in the background and wait on the log; never shorten a run by dropping modules from `-i`.

## Review Focus

- **A known capability loses its literal type, so a misspelt key in typed code compiles and a gate silently never matches** (for example `'pmo.task.read'` in a capability list). Expected: today's keys stay a checked literal union. Pinned by the `@ts-expect-error` assignment to `KnownCapability` checked by `npm -w packages/contracts run build` and the `ACCESS_CHANGING` list typed `readonly KnownCapability[]` (Task 3), and by the exhaustive `TODAY` gate table in `registry.test.ts`, which must list every `KNOWN_CAPABILITIES` key except `meetings.manage` (Task 5).
- **`/me` parsing becomes lenient in a way that hides a real server bug** (a malformed key or module id, or a malformed known bell row, now accepted). Expected: only well-formed new values pass; a malformed value still fails the parse; the server cannot emit a malformed key. Pinned by the malformed-value tables in `me-fail-closed.test.ts`, `access/__tests__/schemas.test.ts`, `common/__tests__/schemas.test.ts` and `pmo/__tests__/notifications.test.ts` (Tasks 3–4), and by `permission_key_invalid` / `permission_domain_invalid` in `test_permission_key_and_domain_are_open_identifiers` (Task 1).
- **The `meetings.manage` reclassification hides UI it should not.** Expected: on a writable meetings tenant nothing changes; on a read-only (suspended/expired) tenant `meetings.manage` is closed, and the only screen using it (`pages/meetings/series/[id].vue` `canAddOccurrence`) was already closed there because it also requires `meetings.create`. Pinned by `turns meetings.manage into a write that only a writable meetings feature opens` (Task 5).
- **An unknown bell kind shows broken text or a broken link** (a raw i18n key as caption, an empty title, `/tasks/undefined` or `/meetings/undefined`). Expected: caption `notifications.preview.other` (present in `ar` and `en`), title from `title` then `body`, no navigation (the row is only marked read). Pinned by the `NotificationCenter.test.ts` generic-row test and `notificationPresentation.test.ts` (Task 4).
- **The `APP_TOKEN` change explodes or silently weakens the R2 baseline.** Expected: today's tree still counts exactly `entitlement_service.py: 4`; a registered rank 4/5 addon's `<name>.x` and `nasq_<name>.` tokens in a foundation file are counted, a bridge token once, and unregistered or shared-service names are not. Pinned by `TestRepository.test_repository_matches_baseline` (existing), `TestAppToken` and `test_a_registered_application_prefix_counts_as_r2` (Task 2), and `arch_policy --base main` exit 0 after every commit.

## File Structure

| File | Responsibility |
|---|---|
| `odoo-addons/nasq_core/models/access_permission.py` (modify) | `domain` becomes `Char`; `key`/`domain` pattern constraint |
| `odoo-addons/nasq_core/__manifest__.py`, `migrations/19.0.1.2.0/README.md` (modify/create) | Version 19.0.1.2.0 and the no-data-change note |
| `odoo-addons/nasq_core/tests/test_access_models.py`, `nasq_api/tests/test_access_composition.py` (modify) | Open-domain proof; today's domains pinned |
| `odoo-addons/nasq_api/tests/test_new_app_catalog.py` (create), `nasq_api/tests/__init__.py` (modify) | A simulated `sales` app through `/admin/permissions`, `/admin/roles` and `/me` |
| `tools/arch_policy.py`, `tools/test_arch_policy.py` (modify) | R2 tokens from registered app/bridge ranks |
| `packages/contracts/src/access/access.ts`, `common/me.ts` (modify) + tests | Open capability, module id and domain schemas; `KNOWN_*` constants and types |
| `packages/contracts/src/pmo/notification.ts` (modify) + test | Generic bell arm |
| `apps/web/app/utils/notificationPresentation.ts`, `composables/useNotifications.ts`, `components/notifications/NotificationCenter.vue`, `pages/notifications.vue`, `i18n/locales/{ar,en}/notifications.json` (modify) + tests | Generic bell rows |
| `apps/web/app/modules/registry.ts` (modify) + `modules/__tests__/registry.test.ts`, `utils/__tests__/accessPolicy.test.ts` | Derived feature and write class |
| `apps/web/app/utils/labelFallback.ts` (create) + test; `utils/vendorPackages.ts`, `components/access/roles/RolePermissionForm.vue`, `pages/settings/roles/new.vue` (modify) | Label fallbacks |
| `docs/api/openapi.json` (regenerated), `CLAUDE.md`, `AGENTS.md`, roadmap (modify) | Contract components, rules, versions, residual lists |

---

### Task 0: Worktree, scratch runner and baselines

**Files:**
- Create (outside the repo): `/tmp/nasq-open-lists/odoo-run.sh`, `/tmp/nasq-open-lists/scratch-only.conf`, `/tmp/nasq-open-lists/openapi-before.json`
- Create: `docs/superpowers/plans/2026-10-07-open-app-lists.md` (copy of this plan)

**Interfaces:**
- Produces: `/tmp/nasq-open-lists/odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | upgrade DB MODULES [INSTALL] | shell DB ROOT | drop DB`. `test` prints `INSTALLED_PROBE <comma list>` of `nasq_chat,nasq_hr,nasq_meetings,nasq_meetings_pmo,nasq_pmo,project` that are installed, before it drops a green database. The module and tag lists below are used by every later task; shell variables do not persist between commands, so every command spells them out.

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
git worktree add -b codex/core-open-app-lists /Users/tariq/code/nasq-open-lists main
cd /Users/tariq/code/nasq-open-lists
git status --short
git log -1 --oneline
npm ci --ignore-scripts
npm -w apps/web run postinstall
```

Expected: empty status; `main` at `1aa7c4b4` or later (record it). If `main` and `origin/main` differ, continue from local `main` and report it. `postinstall` (`nuxt prepare`) writes `apps/web/.nuxt`, which `npm -w apps/web run lint` needs. Run every later command from `/Users/tariq/code/nasq-open-lists` unless a step says otherwise.

- [ ] **Step 2: Create the scratch directory, config and runner**

```bash
mkdir -p /tmp/nasq-open-lists/logs /tmp/nasq-open-lists/data /tmp/nasq-open-lists/classification
printf '[options]\nlist_db = False\n' > /tmp/nasq-open-lists/scratch-only.conf
cat > /tmp/nasq-open-lists/odoo-run.sh <<'RUNNER'
#!/usr/bin/env bash
# Open-lists scratch runner (plan 2026-10-07-open-app-lists.md).
# Every database must match nasq_scratch_openlists_[a-z0-9_]+; odoo19 is never touched.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
WORKTREE=/Users/tariq/code/nasq-open-lists
SCRATCH=/tmp/nasq-open-lists
CONF="$SCRATCH/scratch-only.conf"
HTTP_PORT=8229
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-tariq}"

die() { echo "odoo-run: $*" >&2; exit 2; }
guard_db() {
  [[ "$1" != *odoo19* ]] || die "refusing database '$1' (odoo19 is the development database)"
  [[ "$1" =~ ^nasq_scratch_openlists_[a-z0-9_]+$ ]] || die "refusing database '$1' (scratch names match nasq_scratch_openlists_[a-z0-9_]+)"
}
guard_root() {
  [[ "$1" == "$WORKTREE" || "$1" == "$SCRATCH"/base-* ]] || die "refusing addons root '$1'"
  [[ -d "$1/odoo-addons" ]] || die "no odoo-addons under '$1'"
}
addons() { echo "$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$1/odoo-addons"; }
classify() {  # classify DB: a new file per run, because classification.py opens its output exclusively
  local out="$SCRATCH/classification/$1-$(date +%Y%m%d%H%M%S)-$$-$RANDOM.json"
  python3 "$WORKTREE/deploy/classification.py" fixture --database "$1" --mode saas --output "$out"
  export NASQ_COMMERCIAL_CONFIG="$out"
}
probe() {  # probe DB: which application modules are installed
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$1" -Atc \
    "SELECT 'INSTALLED_PROBE ' || coalesce(string_agg(name, ',' ORDER BY name), '') FROM ir_module_module WHERE state = 'installed' AND name IN ('nasq_chat', 'nasq_hr', 'nasq_meetings', 'nasq_meetings_pmo', 'nasq_pmo', 'project')"
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
  base)  # base DB ROOT MODULES: install a checkout without tests; unclassified when it has no nasq_platform (as CI installs the release tag)
    db=$1 root=$2 modules=$3
    guard_db "$db"
    guard_root "$root"
    dropdb --if-exists "$db"
    if [[ -d "$root/odoo-addons/nasq_platform" ]]; then classify "$db"; else unset NASQ_COMMERCIAL_CONFIG; fi
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
chmod +x /tmp/nasq-open-lists/odoo-run.sh
bash -n /tmp/nasq-open-lists/odoo-run.sh && echo runner-ok
/tmp/nasq-open-lists/odoo-run.sh drop odoo19 || echo "guard refused odoo19 as expected"
/tmp/nasq-open-lists/odoo-run.sh drop nasq_scratch_openlists_odoo19_copy || echo "guard refused an odoo19 lookalike as expected"
/tmp/nasq-open-lists/odoo-run.sh drop nasq_scratch_meetings_x || echo "guard refused another plan's prefix as expected"
```

Expected: `runner-ok`, then three `odoo-run: refusing database ...` lines, each followed by its `guard refused ... as expected` line. The runner never removes files (no `rm` anywhere); it only drops scratch databases it guarded. Classification files accumulate under `/tmp/nasq-open-lists/classification/`, one per run, never reused.

- [ ] **Step 3: Check the port and the database names are free**

```bash
lsof -nP -iTCP:8229 -sTCP:LISTEN || echo "port 8229 free"
psql -h 127.0.0.1 -U tariq -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'nasq_scratch_openlists_%'"
```

Expected: `port 8229 free` and no database listed. If 8229 is taken, change `HTTP_PORT` in the runner and say so in your report. If a database is listed, stop and report it (this plan's author created none).

- [ ] **Step 4: Commit this plan on the branch**

```bash
cp /Users/tariq/code/nasq/docs/superpowers/plans/2026-10-07-open-app-lists.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-07-open-app-lists.md
git commit -m "docs(docs): add the open app lists plan" -m "<TRAILER>"
git log -1 --format=%B
```

Expected: the body shows the subject, a blank line and the trailer line. The main checkout keeps an untracked copy of the same file; tell the orchestrator it must be removed from the main checkout before the merge.

- [ ] **Step 5: Record the guard and web baselines**

```bash
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
print(baseline['R2'])
PY
npm -w packages/contracts run build > /tmp/nasq-open-lists/logs/contracts-build.log 2>&1; echo "contracts build exit=$?"; tail -n 5 /tmp/nasq-open-lists/logs/contracts-build.log
npm test 2>&1 | tail -n 12
npm -w apps/web run lint 2>&1 | tail -n 5
```

Expected: three `exit=0`; totals `{'R1': 0, 'R10': 0, 'R2': 4, 'R3': 4, 'R4': 0, 'R5': 8, 'R6': 0, 'R7': 83, 'R8': 1, 'R9': 68}` and `{'odoo-addons/nasq_platform/models/entitlement_service.py': 4}`; `contracts build exit=0`; `npm test` and the type check green. If anything is red on the unmodified branch, record the exact failures: they are pre-existing and every later run is compared against that list.

- [ ] **Step 6: Record the API surface baseline**

```bash
python3 -B tools/api_surface.py
cp docs/api/openapi.json /tmp/nasq-open-lists/openapi-before.json
git checkout -- docs/api/openapi.json
git status --short
```

Expected: `wrote docs/api/openapi.json: ...` and an empty status after the checkout.

- [ ] **Step 7: Run the three installs once on the unmodified branch (background, one after the other)**

```bash
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_base \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_base_hr \
  nasq_core,nasq_platform,nasq_api,nasq_hr \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_base_meet \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
```

Expected: three `ODOO_RUN_TEST_OK` lines after `odoo.tests.result: 0 failed, 0 error(s) of N tests`, with probes `nasq_chat,nasq_hr,nasq_meetings,nasq_meetings_pmo,nasq_pmo,project`, `nasq_hr` and `nasq_meetings`. Record the three N. If a run is not green, list its failures with `grep -E '(FAIL|ERROR): ' /tmp/nasq-open-lists/logs/<db>.log`; those are pre-existing and every later run is compared against that list.

---

### Task 1: Open the permission domain in nasq_core (Char + identifier constraint, 19.0.1.2.0)

**Files:**
- Modify: `odoo-addons/nasq_core/models/access_permission.py` (whole file)
- Modify: `odoo-addons/nasq_core/__manifest__.py:5`
- Create: `odoo-addons/nasq_core/migrations/19.0.1.2.0/README.md`
- Modify: `odoo-addons/nasq_core/tests/test_access_models.py` (append to `TestNasqAccessModels`)
- Modify: `odoo-addons/nasq_api/tests/test_access_composition.py` (append to `TestAccessComposition`)
- Create: `odoo-addons/nasq_api/tests/test_new_app_catalog.py`
- Modify: `odoo-addons/nasq_api/tests/__init__.py`

**Interfaces:**
- Produces: `nasq.access.permission.domain` is `fields.Char(required=True)`; `NasqAccessPermission._check_key_and_domain` raises `ValidationError('permission_key_invalid')` unless `key` fully matches `[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+` and `ValidationError('permission_domain_invalid')` unless `domain` fully matches `[a-z][a-z0-9_]*`. Module constants `CAPABILITY_KEY` and `IDENTIFIER` in `odoo.addons.nasq_core.models.access_permission`. Wire value of `permission.domain` (`dump_permission`, `nasq_api/serializers/access.py:80`) unchanged.

- [ ] **Step 1: Write the failing tests**

Append to the class `TestNasqAccessModels` at the end of `odoo-addons/nasq_core/tests/test_access_models.py`:

```python

    def test_permission_key_and_domain_are_open_identifiers(self):
        field = self.env['ir.model.fields']._get('nasq.access.permission', 'domain')
        self.assertEqual(field.ttype, 'char')
        self.assertFalse(self.env['ir.model.fields.selection'].search([('field_id', '=', field.id)]))
        Permission = self.env['nasq.access.permission']
        values = {
            'resource': 'orders', 'action': 'read', 'name_ar': 'قراءة الطلبات',
            'description_ar': 'قراءة الطلبات', 'group_xmlid': 'nasq_core.group_cap_settings_branding_manage',
        }
        sales = Permission.create({**values, 'key': 'sales.orders.read', 'domain': 'sales'})
        self.assertEqual(sales.domain, 'sales')
        for index, domain in enumerate(('Sales', 'sales-orders', '9sales', 'sales.orders', 'sales orders')):
            with (
                self.subTest(domain=domain),
                self.assertRaisesRegex(ValidationError, 'permission_domain_invalid'),
                self.env.cr.savepoint(),
            ):
                Permission.create({**values, 'key': f'probe.orders{index}.read', 'domain': domain})
        for key in ('Sales.orders.read', 'sales', 'sales..read', 'sales.orders.', 'sales.orders read'):
            with (
                self.subTest(key=key),
                self.assertRaisesRegex(ValidationError, 'permission_key_invalid'),
                self.env.cr.savepoint(),
            ):
                Permission.create({**values, 'key': key, 'domain': 'sales'})
        with self.assertRaisesRegex(ValidationError, 'permission_domain_invalid'), self.env.cr.savepoint():
            sales.write({'domain': 'Sales'})
        self.assertEqual(sales.domain, 'sales')
```

Append to the class `TestAccessComposition` at the end of `odoo-addons/nasq_api/tests/test_access_composition.py`:

```python

    def test_permission_domains_are_unchanged_on_the_wire(self):
        self.assertEqual(
            {permission.key: permission.domain for permission in self.Permission.search([])},
            {key: key.split('.')[0] for key in CATALOG},
        )
```

Create `odoo-addons/nasq_api/tests/test_new_app_catalog.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import NasqApiCase

# A fourth application simulated without an addon (plan 2026-10-07-open-app-lists):
# its capabilities are registered through the same super() hook an application
# addon extends, and its permission records use a domain nasq_core does not list.
SALES = (
    {'key': 'sales.orders.read', 'owner': 'nasq_sales'},
    {'key': 'sales.orders.write', 'owner': 'nasq_sales'},
)
GROUP_XMLID = '__nasq_open_lists__.group_sales_orders'


@tagged('post_install', '-at_install', 'nasq', 'nasq_access')
class TestNewApplicationCatalog(NasqApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='new_app_admin', password='new_app_admin_pass_123',
            groups='nasq_core.group_access_admin',
        )

    def setUp(self):
        super().setUp()
        service = type(self.env['nasq.access.service'])
        definitions = service._nasq_capability_definitions
        self.patch(service, '_nasq_capability_definitions', lambda model: (*definitions(model), *SALES))
        group = self.env['res.groups'].create({'name': 'Sales orders (open lists probe)'})
        module, name = GROUP_XMLID.split('.')
        self.env['ir.model.data'].create({
            'module': module, 'name': name, 'model': 'res.groups', 'res_id': group.id,
        })
        values = {
            'domain': 'sales', 'resource': 'orders', 'group_xmlid': GROUP_XMLID,
            'custom_role_allowed': True, 'sensitive': False, 'project_contextual': False,
        }
        Permission = self.env['nasq.access.permission']
        read = Permission.create({
            **values, 'key': 'sales.orders.read', 'action': 'read',
            'name_ar': 'قراءة طلبات البيع', 'name_en': 'Read sales orders',
            'description_ar': 'قراءة طلبات البيع', 'description_en': 'Read sales orders',
        })
        Permission.create({
            **values, 'key': 'sales.orders.write', 'action': 'write',
            'name_ar': 'تعديل طلبات البيع', 'name_en': 'Edit sales orders',
            'description_ar': 'تعديل طلبات البيع', 'description_en': 'Edit sales orders',
            'dependency_ids': [Command.set(read.ids)],
        })

    def test_the_catalog_serves_the_new_domain_unchanged(self):
        self.assertEqual(
            set(self.env['nasq.access.permission'].search([]).mapped('key')),
            set(self.env['nasq.access.service']._nasq_capability_map()),
        )
        self.authenticate('new_app_admin', 'new_app_admin_pass_123')
        response = self.api('GET', '/api/v1/admin/permissions')
        self.assertEqual(response.status_code, 200, response.text)
        items = {item['key']: item for item in response.json()['items']}
        self.assertEqual(items['sales.orders.write'], {
            'key': 'sales.orders.write', 'domain': 'sales', 'resource': 'orders', 'action': 'write',
            'label': {'ar': 'تعديل طلبات البيع', 'en': 'Edit sales orders'},
            'description': {'ar': 'تعديل طلبات البيع', 'en': 'Edit sales orders'},
            'dependencies': ['sales.orders.read'],
            'scopes': [{'kind': 'company', 'assignable': True}],
            'custom_role_allowed': True, 'sensitive': False,
        })
        self.assertEqual(items['sales.orders.read']['domain'], 'sales')

    def test_a_custom_role_carries_the_new_capabilities_to_me(self):
        self.authenticate('new_app_admin', 'new_app_admin_pass_123')
        created = self.api('POST', '/api/v1/admin/roles', {
            'name': {'ar': 'مندوب مبيعات', 'en': 'Sales clerk'},
            'description': 'Sales orders',
            'permissions': ['sales.orders.read', 'sales.orders.write'],
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['permissions'], ['sales.orders.read', 'sales.orders.write'])
        self.env['nasq.access.service']._nasq_replace_assignments(self.employee, [
            {'role_id': self.env.ref('nasq_core.role_employee').id, 'company_id': self.env.company.id},
            {'role_id': created.json()['id'], 'company_id': self.env.company.id},
        ])
        self.authenticate('api_emp', 'api_emp_pass_123')
        me = self.api('GET', '/api/v1/me')
        self.assertEqual(me.status_code, 200, me.text)
        self.assertTrue({'sales.orders.read', 'sales.orders.write'} <= set(me.json()['capabilities']))
```

In `odoo-addons/nasq_api/tests/__init__.py` replace:

```python
    test_me,
    test_pagination,
```

with:

```python
    test_me,
    test_new_app_catalog,
    test_pagination,
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_t1 \
  nasq_core,nasq_platform,nasq_api \
  /nasq_core:TestNasqAccessModels,/nasq_api:TestNewApplicationCatalog
```

Expected: `tests failed or did not run`. The log shows `test_permission_key_and_domain_are_open_identifiers` failing on `ttype` (`'selection' != 'char'`) and both `TestNewApplicationCatalog` tests erroring in `setUp` with `ValueError: Wrong value for nasq.access.permission.domain: 'sales'`. Drop the kept database: `/tmp/nasq-open-lists/odoo-run.sh drop nasq_scratch_openlists_t1`.

- [ ] **Step 3: Make the domain a validated Char**

Replace the whole of `odoo-addons/nasq_core/models/access_permission.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError

# The wire patterns of packages/contracts (access.ts): every application owns its
# keys and its domain, so nasq_core lists none of them and checks only their form.
CAPABILITY_KEY = re.compile(r'[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+')
IDENTIFIER = re.compile(r'[a-z][a-z0-9_]*')


class NasqAccessPermission(models.Model):
    _name = 'nasq.access.permission'
    _description = 'Nasq Access Permission'
    _nasq_scope = 'tenant'
    _order = 'key'

    key = fields.Char(required=True, index=True)
    # The application area the permission is grouped under in role screens
    # (today access, hr, pmo, meetings, settings; a new application adds its own).
    domain = fields.Char(required=True)
    resource = fields.Char(required=True)
    action = fields.Char(required=True)
    name_ar = fields.Char(required=True)
    name_en = fields.Char()
    description_ar = fields.Char(required=True)
    description_en = fields.Char()
    dependency_ids = fields.Many2many(
        'nasq.access.permission',
        'nasq_access_permission_dependency_rel',
        'permission_id', 'dependency_id',
    )
    group_xmlid = fields.Char(required=True)
    custom_role_allowed = fields.Boolean(default=True, required=True)
    sensitive = fields.Boolean(default=False, required=True)
    project_contextual = fields.Boolean(default=False, required=True)

    _key_unique = models.Constraint('UNIQUE(key)', 'permission key must be unique')

    @api.constrains('key', 'domain')
    def _check_key_and_domain(self):
        for permission in self:
            if not CAPABILITY_KEY.fullmatch(permission.key or ''):
                msg = 'permission_key_invalid'
                raise ValidationError(msg)
            if not IDENTIFIER.fullmatch(permission.domain or ''):
                msg = 'permission_domain_invalid'
                raise ValidationError(msg)

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'access.roles.read',
            )
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
        ):
            self.env['nasq.access.service']._nasq_require_capability(
                'access.roles.read',
            )
        return super().check_access(operation)
```

(The `_search`/`check_access` overrides and every other field are byte-identical to `main`; only the imports, the two constants, `domain` and `_check_key_and_domain` change.)

- [ ] **Step 4: Bump the version and add the migration note**

In `odoo-addons/nasq_core/__manifest__.py` replace:

```python
    'version': '19.0.1.1.0',
```

with:

```python
    'version': '19.0.1.2.0',
```

Create `odoo-addons/nasq_core/migrations/19.0.1.2.0/README.md`:

```markdown
# 19.0.1.2.0

الحقل `nasq.access.permission.domain` يتحول من `Selection` مغلق (access, hr, pmo, meetings, settings) إلى `Char`
يقبل أي معرّف بصيغة `^[a-z][a-z0-9_]*$`، ليضيف كل تطبيق مجاله دون تعديل `nasq_core`. النوعان يستعملان عمود
`varchar` نفسه، والقيم المخزنة لا تتغير، فلا ترحيل بيانات. يحذف Odoo بنفسه صفوف `ir_model_fields_selection`
الخمسة للاختيار القديم عند تحديث `nasq_core` (`_process_end`؛ و`_process_ondelete` يتخطى حقلاً تغيّر نوعه).
القيد الجديد يتحقق أيضاً من صيغة `key` (`a.b[.c]`)؛ مفاتيح القدرات الـ28 الحالية كلها مطابقة له.
```

- [ ] **Step 5: Run the focused tests**

```bash
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_t1 \
  nasq_core,nasq_platform,nasq_api \
  /nasq_core:TestNasqAccessModels,/nasq_api:TestNewApplicationCatalog
ruff check odoo-addons
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_openlists_t1`; `All checks passed!`; both `exit=0`.

- [ ] **Step 6: Run the three installs (background, one after the other)**

```bash
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_t1_full \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_t1_hr \
  nasq_core,nasq_platform,nasq_api,nasq_hr \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_t1_meet \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
```

Expected: three `ODOO_RUN_TEST_OK` with the Task 0 probes; each N is the Task 0 N plus 3 (one `nasq_core` test, two `TestNewApplicationCatalog` tests) and, for the full run only, plus 1 more (`test_permission_domains_are_unchanged_on_the_wire`; `TestAccessComposition` skips in the partial installs). Any other difference from the Task 0 counts or failure list is a blocker.

- [ ] **Step 7: Commit**

```bash
git add odoo-addons/nasq_core odoo-addons/nasq_api/tests
git commit -m "feat(core): open the permission domain to any app identifier" -m "<TRAILER>"
```

---

### Task 2: Derive the R2 application tokens from the registered app ranks

**Files:**
- Modify: `tools/arch_policy.py:26` (`APP_TOKEN`), `:349-371` (`collect`)
- Modify: `tools/test_arch_policy.py` (imports, `TestCollect`, new `TestAppToken`)

**Interfaces:**
- Produces: `STATIC_APP_TOKENS: tuple[str, ...]` and `app_token(ranks: dict[str, int]) -> re.Pattern[str]` in `tools/arch_policy.py`; `collect` counts R2 with `app_token(layers['ranks'])`. The module-level `APP_TOKEN` is removed (nothing else imports it).

- [ ] **Step 1: Write the failing tests**

In `tools/test_arch_policy.py` replace:

```python
from arch_policy import (
    collect,
    compare,
    core_depends_violations,
```

with:

```python
from arch_policy import (
    app_token,
    collect,
    compare,
    core_depends_violations,
    count,
```

Insert before `class TestCompare(unittest.TestCase):`:

```python
class TestAppToken(unittest.TestCase):
    RANKS = {
        'nasq_core': 0, 'nasq_platform': 1, 'nasq_api': 2, 'nasq_notify': 3,
        'nasq_pmo': 4, 'nasq_sales': 4, 'nasq_meetings_pmo': 5, 'customer_acme_sales': 6,
    }

    def test_a_registered_application_contributes_its_key_prefix_and_its_xml_ids(self):
        token = app_token(self.RANKS)
        self.assertEqual(count(token, "k = 'sales.orders.read'"), 1)
        self.assertEqual(count(token, "g = env.ref('nasq_sales.group_x')"), 1)
        self.assertEqual(count(token, "from odoo.addons.nasq_sales.models import x"), 1)

    def test_a_bridge_token_counts_once(self):
        token = app_token(self.RANKS)
        self.assertEqual(count(token, "r = 'nasq_meetings_pmo.rule_x'"), 1)
        self.assertEqual(count(token, "k = 'meetings_pmo.thing'"), 1)

    def test_odoo_models_and_the_meeting_engine_stay_tokens(self):
        token = app_token({'nasq_core': 0})
        self.assertEqual(count(token, "m = 'project.task'; e = 'hr.employee'; c = 'cyan_meeting_minutes.x'"), 3)
        self.assertEqual(count(token, "a = 'pmo.tasks.read'; b = 'meetings.read'; d = 'chat.title'"), 3)

    def test_unregistered_names_shared_services_and_overlays_are_not_tokens(self):
        token = app_token(self.RANKS)
        self.assertEqual(count(token, "a = 'crm.leads.read'; b = 'nasq_crm.group_x'"), 0)
        self.assertEqual(count(token, "a = 'notify.kind'; b = 'nasq_notify.x'; c = 'api.v1'"), 0)
        self.assertEqual(count(token, "a = 'customer_acme_sales.x'; b = 'acme_sales.y'"), 0)
        self.assertEqual(count(token, "a = 'presales.x'"), 0)
```

Append to the class `TestCollect`, after `test_application_xml_ids_count_as_r2`:

```python

    def test_a_registered_application_prefix_counts_as_r2(self):
        self.clean_tree()
        self.layers['ranks']['nasq_sales'] = 4
        self.addon('nasq_sales', ['nasq_core'])
        self.write(
            'odoo-addons/nasq_sales/models/feature_registry.py',
            HEADER + "X = {'key': 'sales.enabled', 'owner': 'nasq_sales'}\n",
        )
        self.write(
            'odoo-addons/nasq_core/models/x.py',
            HEADER + "KEY = 'sales.orders.read'\ng = 'nasq_sales.group_x'\n",
        )
        violations, hard = collect(self.root, self.layers)
        self.assertEqual(hard, [])
        self.assertEqual(violations['R2'], {'odoo-addons/nasq_core/models/x.py': 2})
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
python3 -B -m unittest discover -s tools -p 'test_arch_policy.py' 2>&1 | tail -n 5
```

Expected: `ImportError: cannot import name 'app_token' from 'arch_policy'`.

- [ ] **Step 3: Build the token from the ranks**

In `tools/arch_policy.py` replace:

```python
APP_TOKEN = re.compile(r'\b(?:(?:project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(?:pmo|hr|chat)\.)')
```

with:

```python
# R2 tokens that are not an addon of this repository: Odoo models and the meeting engine.
# app_token() adds every registered application and bridge (ranks 4 and 5 in arch_layers.json).
STATIC_APP_TOKENS = ('project', 'hr', 'pmo', 'meetings', 'chat', 'cyan_meeting_minutes')
```

Insert after the function `count`:

```python
def app_token(ranks: dict[str, int]) -> re.Pattern[str]:
    """R2: `<prefix>.x` and `<addon>.` tokens a foundation file must not contain.

    Each registered application or bridge `nasq_<name>` contributes `<name>.` (its capability
    and feature keys) and `nasq_<name>.` (its xml ids and imports). Shared services (rank 3),
    the foundation and customer overlays contribute nothing. Longer alternatives come first,
    and `\\b` keeps `meetings_pmo.` inside `nasq_meetings_pmo.` from counting twice.
    """
    addons = sorted((a for a, rank in ranks.items() if rank in (APP_RANK, BRIDGE_RANK)), key=lambda a: (-len(a), a))
    prefixes = sorted({*STATIC_APP_TOKENS, *(a.removeprefix('nasq_') for a in addons)}, key=lambda p: (-len(p), p))
    names = '|'.join(map(re.escape, addons)) or '(?!)'
    return re.compile(rf'\b(?:(?:{"|".join(map(re.escape, prefixes))})\.[a-z_]|(?:{names})\.)')
```

In `collect` replace:

```python
    ranks, exempt, web_apps = layers['ranks'], layers['exempt'], layers['web_apps']
    commercial = layers['commercial']
```

with:

```python
    ranks, exempt, web_apps = layers['ranks'], layers['exempt'], layers['web_apps']
    commercial = layers['commercial']
    token = app_token(ranks)
```

and replace:

```python
                _put(v['R2'], rel, count(APP_TOKEN, text))
```

with:

```python
                _put(v['R2'], rel, count(token, text))
```

- [ ] **Step 4: Run the tests and the guard against the real tree**

```bash
python3 -B -m unittest discover -s tools -p 'test_arch_policy.py' 2>&1 | tail -n 3
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy --base exit=$?"
git diff --stat tools/arch_baseline.json tools/arch_layers.json
```

Expected: `OK` (this includes the existing `TestRepository.test_repository_matches_baseline` and `test_each_rule_fires_on_its_violation`, which still counts 2 in `nasq_core/models/access.py`); both `exit=0`; the `git diff --stat` prints nothing (baseline and layers untouched). If `arch_policy` reports a new R2 hit on today's tree, do **not** run `--write-baseline`: stop and report the file and line (the plan author found none).

- [ ] **Step 5: Commit**

```bash
git add tools/arch_policy.py tools/test_arch_policy.py
git commit -m "feat(tools): derive R2 app tokens from registered app ranks" -m "<TRAILER>"
```

---

### Task 3: Accept any well-formed capability key, module id and permission domain in the contracts

**Files:**
- Modify: `packages/contracts/src/access/access.ts:5-35`, `:99-105`, `:130`
- Modify: `packages/contracts/src/common/me.ts:22`
- Modify: `packages/contracts/src/access/__tests__/schemas.test.ts`, `packages/contracts/src/access/__tests__/me-fail-closed.test.ts`, `packages/contracts/src/common/__tests__/schemas.test.ts`

**Interfaces:**
- Produces (all exported from `@nasq/contracts`): `CAPABILITY_KEY_PATTERN: RegExp`, `KNOWN_CAPABILITIES` (the 28 keys, `as const`, today's order), `type KnownCapability`, `type Capability = KnownCapability | (string & {})`, `CapabilitySchema = z.string().regex(CAPABILITY_KEY_PATTERN)`; `IDENTIFIER_PATTERN`, `KNOWN_PERMISSION_DOMAINS = ['access', 'hr', 'pmo', 'meetings', 'settings'] as const`, `type KnownPermissionDomain`, `type PermissionDomain`, `PermissionDomainSchema`; `NASQ_MODULE_ID_PATTERN`, `KNOWN_NASQ_MODULE_IDS = ['nasq_chat', 'nasq_hr', 'nasq_meetings', 'nasq_pmo'] as const`, `type KnownNasqModuleId`, `type NasqModuleId`, `NasqModuleIdSchema = z.string().regex(NASQ_MODULE_ID_PATTERN)`. Every schema that embeds them keeps its name and structure.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/src/access/__tests__/schemas.test.ts` replace:

```ts
  GrantAccountInputSchema,
  MeRoleSchema,
```

with:

```ts
  GrantAccountInputSchema,
  KNOWN_CAPABILITIES,
  KNOWN_PERMISSION_DOMAINS,
  type KnownCapability,
  MeRoleSchema,
```

and replace:

```ts
  RoleAssignmentSchema,
  RoleDetailSchema,
```

with:

```ts
  RoleAssignmentSchema,
  RoleCreateInputSchema,
  RoleDetailSchema,
```

Replace:

```ts
  it('exposes exactly the frozen capability catalog', () => {
    expect(CapabilitySchema.options).toEqual(CAPABILITIES)
    expect(CapabilitySchema.options).toHaveLength(28)
  })
```

with:

```ts
  it("lists today's capability catalog and accepts any well-formed key", () => {
    expect(KNOWN_CAPABILITIES).toEqual(CAPABILITIES)
    expect(KNOWN_CAPABILITIES).toHaveLength(28)
    for (const key of [...CAPABILITIES, 'sales.orders.read', 'sales.orders.write', 'customer_acme.reports.export']) {
      expect(CapabilitySchema.parse(key)).toBe(key)
    }
    for (const key of ['sales', 'Sales.orders.read', 'sales..read', 'sales.orders.', '.sales.read', 'sales.orders read', 'sales-orders.read', '']) {
      expect(() => CapabilitySchema.parse(key)).toThrow()
    }
    // @ts-expect-error a misspelt key of today's catalog is not a KnownCapability (checked by `npm -w packages/contracts run build`)
    const typo: KnownCapability = 'pmo.task.read'
    expect(KNOWN_CAPABILITIES).not.toContain(typo)
  })
```

Replace:

```ts
    expect(() => EffectiveCapabilitySchema.parse({ ...parsed, key: 'not.a.capability' })).toThrow()
```

with:

```ts
    expect(() => EffectiveCapabilitySchema.parse({ ...parsed, key: 'Not.A.Capability' })).toThrow()
    expect(EffectiveCapabilitySchema.parse({ ...parsed, key: 'sales.orders.write' }).key).toBe('sales.orders.write')
```

Inside `describe('role and permission schemas', ...)`, after the test `accepts the 25 item catalog and validates contextual scope metadata`, add:

```ts

  it("accepts a newer application's permission with its own domain", () => {
    const sales = {
      key: 'sales.orders.write',
      domain: 'sales',
      resource: 'orders',
      action: 'write',
      label: { ar: 'تعديل طلبات البيع', en: 'Edit sales orders' },
      description: { ar: 'تعديل طلبات البيع', en: 'Edit sales orders' },
      dependencies: ['sales.orders.read'],
      scopes: [{ kind: 'company' as const, assignable: true }],
      custom_role_allowed: true,
      sensitive: false,
    }
    expect(PermissionCatalogSchema.parse({ items: [sales], total: 1, version: 'access-catalog-v1' }).items[0]).toEqual(sales)
    expect(KNOWN_PERMISSION_DOMAINS).toEqual(['access', 'hr', 'pmo', 'meetings', 'settings'])
    for (const domain of ['Sales', 'sales-orders', 'sales.orders', '9sales', '']) {
      expect(() => PermissionDefinitionSchema.parse({ ...sales, domain })).toThrow()
    }
    expect(() => PermissionDefinitionSchema.parse({ ...sales, scopes: [...sales.scopes, { kind: 'project', assignable: false }] })).toThrow()
    expect(RoleDetailSchema.parse({ ...roleSummary, permissions: ['sales.orders.read', 'sales.orders.write'], allowed_actions: ['read'] }).permissions)
      .toEqual(['sales.orders.read', 'sales.orders.write'])
    expect(RoleCreateInputSchema.parse({ name: { ar: 'مبيعات', en: null }, description: '', permissions: ['sales.orders.read'] }).permissions)
      .toEqual(['sales.orders.read'])
    expect(() => RoleCreateInputSchema.parse({ name: { ar: 'مبيعات', en: null }, description: '', permissions: ['access.users.grant'] })).toThrow()
  })
```

In `packages/contracts/src/access/__tests__/me-fail-closed.test.ts` replace:

```ts
  it('rejects malformed capability keys instead of treating them as authority', () => {
    expect(() => MeSchema.parse({ ...BASE_ME, capabilities: ['access.users.read', 'access.users.not_real'] })).toThrow()
  })
```

with:

```ts
  it('rejects malformed capability keys instead of treating them as authority', () => {
    for (const key of ['access.users read', 'ACCESS.users.read', 'access', 'access..read']) {
      expect(() => MeSchema.parse({ ...BASE_ME, capabilities: ['access.users.read', key] })).toThrow()
    }
  })

  it("carries a newer application's capabilities and module verbatim", () => {
    const parsed = MeSchema.parse({
      ...BASE_ME,
      capabilities: ['pmo.tasks.read', 'sales.orders.write'],
      modules: ['nasq_pmo', 'nasq_sales'],
    })
    expect(parsed.capabilities).toEqual(['pmo.tasks.read', 'sales.orders.write'])
    expect(parsed.modules).toEqual(['nasq_pmo', 'nasq_sales'])
  })
```

In `packages/contracts/src/common/__tests__/schemas.test.ts` replace:

```ts
import { BrandingSchema, MeAppearancePatchSchema, MeSchema } from '../index'
```

with:

```ts
import { BrandingSchema, KNOWN_NASQ_MODULE_IDS, MeAppearancePatchSchema, MeSchema } from '../index'
```

and replace:

```ts
  it('rejects an unknown module id', () => {
    expect(() => MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
      modules: ['nasq_unknown'],
    })).toThrow()
  })
```

with:

```ts
  it("accepts a newer application's module id and rejects malformed ones", () => {
    const base = {
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
    }
    expect(MeSchema.parse({ ...base, modules: ['nasq_sales', 'customer_acme_reports'] }).modules)
      .toEqual(['nasq_sales', 'customer_acme_reports'])
    expect(KNOWN_NASQ_MODULE_IDS).toEqual(['nasq_chat', 'nasq_hr', 'nasq_meetings', 'nasq_pmo'])
    for (const id of ['sales', 'nasq_', 'NASQ_SALES', 'nasq-sales', 'odoo_sales']) {
      expect(() => MeSchema.parse({ ...base, modules: [id] })).toThrow()
    }
  })
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
npm -w packages/contracts run test 2>&1 | tail -n 25
```

Expected: failures for the missing exports (`KNOWN_CAPABILITIES`, `KNOWN_PERMISSION_DOMAINS`, `KNOWN_NASQ_MODULE_IDS` are `undefined`) and `Invalid option` errors for `sales.orders.read`, `sales`, `nasq_sales`.

- [ ] **Step 3: Open the three schemas**

In `packages/contracts/src/access/access.ts` replace lines 5–35 (from `export const CapabilitySchema = z.enum([` through `export type Capability = z.infer<typeof CapabilitySchema>`) with:

```ts
/** A capability key: two or more lowercase identifier segments joined by dots (`<app>.<resource>.<action>`). */
export const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
/** A lowercase identifier: a permission domain or a notification kind. */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * The capability keys of today's applications, for typed code. A newer application registers
 * its own keys on the server; the contract accepts any well-formed key and the server
 * (nasq_core `nasq.access.permission`) validates the same pattern.
 */
export const KNOWN_CAPABILITIES = [
  'access.users.read',
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.read',
  'access.roles.manage',
  'access.audit.read',
  'hr.employees.read',
  'hr.employees.manage',
  'hr.employees.archive',
  'hr.employees.access_status.read',
  'hr.departments.read',
  'hr.departments.manage',
  'hr.documents.read',
  'hr.documents.manage',
  'pmo.projects.read',
  'pmo.projects.create',
  'pmo.projects.manage',
  'pmo.settings.manage',
  'pmo.tasks.read',
  'pmo.tasks.create',
  'pmo.tasks.write',
  'pmo.tasks.approve',
  'settings.branding.manage',
  'meetings.read',
  'meetings.create',
  'meetings.manage',
] as const
export type KnownCapability = typeof KNOWN_CAPABILITIES[number]
/** Any capability: today's keys keep their literal type for autocomplete. */
export type Capability = KnownCapability | (string & {})
export const CapabilitySchema = z.string().regex(CAPABILITY_KEY_PATTERN)

/** The permission domains (role-screen groups) of today's applications; a newer application adds its own. */
export const KNOWN_PERMISSION_DOMAINS = ['access', 'hr', 'pmo', 'meetings', 'settings'] as const
export type KnownPermissionDomain = typeof KNOWN_PERMISSION_DOMAINS[number]
export type PermissionDomain = KnownPermissionDomain | (string & {})
export const PermissionDomainSchema = z.string().regex(IDENTIFIER_PATTERN)
```

Replace:

```ts
const ACCESS_CHANGING_CAPABILITIES = new Set<Capability>([
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.manage',
])
```

with:

```ts
// Typed as known keys so a misspelt entry fails the type check.
const ACCESS_CHANGING: readonly KnownCapability[] = [
  'access.users.grant',
  'access.users.assign_roles',
  'access.users.disable',
  'access.users.reset_password',
  'access.roles.manage',
]
const ACCESS_CHANGING_CAPABILITIES = new Set<Capability>(ACCESS_CHANGING)
```

Replace:

```ts
  domain: z.enum(['access', 'hr', 'pmo', 'meetings', 'settings']),
```

with:

```ts
  domain: PermissionDomainSchema,
```

In `packages/contracts/src/common/me.ts` replace:

```ts
export const NasqModuleIdSchema = z.enum(['nasq_chat', 'nasq_hr', 'nasq_meetings', 'nasq_pmo'])
```

with:

```ts
/** An installed application module: a product addon `nasq_*` or a customer overlay `customer_*`. */
export const NASQ_MODULE_ID_PATTERN = /^(nasq|customer)_[a-z0-9_]+$/
/** The application modules of today's product, for typed code; a newer application's id is accepted too. */
export const KNOWN_NASQ_MODULE_IDS = ['nasq_chat', 'nasq_hr', 'nasq_meetings', 'nasq_pmo'] as const
export type KnownNasqModuleId = typeof KNOWN_NASQ_MODULE_IDS[number]
export type NasqModuleId = KnownNasqModuleId | (string & {})
export const NasqModuleIdSchema = z.string().regex(NASQ_MODULE_ID_PATTERN)
```

- [ ] **Step 4: Run the contracts tests, their type check and the web**

```bash
npm -w packages/contracts run test 2>&1 | tail -n 6
npm -w packages/contracts run build > /tmp/nasq-open-lists/logs/contracts-build.log 2>&1; echo "contracts build exit=$?"; tail -n 5 /tmp/nasq-open-lists/logs/contracts-build.log
npm -w apps/web run test 2>&1 | tail -n 6
npm -w apps/web run lint 2>&1 | tail -n 5
```

Expected: contracts suite green; `contracts build exit=0` (the `@ts-expect-error` line is accepted only because the typo is a type error; if `tsc` reports `Unused '@ts-expect-error' directive`, `KnownCapability` has lost its literal type: fix that, never delete the line); web suite and type check green (`pages/settings/roles/new.vue` keeps `ref<Capability[]>` and its `permission is Capability` predicate; `Capability` still accepts every string).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(web): accept any well-formed capability, module and domain" -m "<TRAILER>"
```

---

### Task 4: Parse unknown bell kinds as generic rows

**Files:**
- Modify: `packages/contracts/src/pmo/notification.ts:73-77`, `:92-96` + `packages/contracts/src/pmo/__tests__/notifications.test.ts`
- Modify: `apps/web/app/utils/notificationPresentation.ts:1-3`, `:70-74` + `apps/web/app/utils/__tests__/notificationPresentation.test.ts`
- Modify: `apps/web/app/composables/useNotifications.ts:1-7`, `:87-95`
- Modify: `apps/web/app/components/notifications/NotificationCenter.vue:3`, `:22-41`, `:99` + `apps/web/app/components/notifications/__tests__/NotificationCenter.test.ts`
- Modify: `apps/web/app/pages/notifications.vue:3-10`, `:43-73`
- Modify: `apps/web/i18n/locales/ar/notifications.json`, `apps/web/i18n/locales/en/notifications.json`

**Interfaces:**
- Consumes: `IDENTIFIER_PATTERN` (Task 3).
- Produces: `UnknownNotificationSchema` (`{ id: positive int, kind: identifier not in NotificationKindSchema.options, title?: string, body?: string, created_at: string, is_read: boolean }`, `.loose()`), `BellNotificationSchema = z.union([NotificationSchema, UnknownNotificationSchema])`, types `UnknownNotification`, `BellNotification`; `NotificationListSchema.items` is `BellNotification[]`. `NotificationSchema` and every known arm are unchanged. Web: `isKnownNotificationKind(kind: string): boolean`, `isMeetingNotificationKind(kind: string): boolean` (utils); `isKnownNotification(item: BellNotification): item is Notification`, `isDigestNotification`, `isMeetingNotification` now take `BellNotification` (composable); i18n key `notifications.preview.other`.

- [ ] **Step 1: Write the failing contract test**

In `packages/contracts/src/pmo/__tests__/notifications.test.ts` replace:

```ts
import {
  NotificationListSchema,
  NotificationReadResultSchema,
  NotificationSchema,
} from '../notification'
```

with:

```ts
import {
  NotificationListSchema,
  NotificationReadResultSchema,
  NotificationSchema,
  UnknownNotificationSchema,
} from '../notification'
```

and append inside the `describe` block, after `it('rejects unknown kinds and extra keys', ...)`:

```ts

  it("lists a newer application's kind as a generic row and keeps known kinds strict", () => {
    const known = {
      id: 7, kind: 'comment', task_id: 12, task_name: 'Review brief',
      body: 'A comment was added', created_at: '2026-09-05T10:00:00Z', is_read: false,
    }
    const unknown = {
      id: 9, kind: 'sales_order_assigned', order_id: 5, title: 'SO-0005',
      body: 'Order assigned to you', created_at: '2026-10-07T09:00:00Z', is_read: false,
    }
    const list = NotificationListSchema.parse({ items: [unknown, known], total: 2, unread_count: 2 })
    expect(list.items).toEqual([unknown, known])
    expect(UnknownNotificationSchema.parse({ id: 10, kind: 'sales_quote_expired', created_at: '2026-10-07T09:00:00Z', is_read: true }))
      .toEqual({ id: 10, kind: 'sales_quote_expired', created_at: '2026-10-07T09:00:00Z', is_read: true })
    expect(NotificationSchema.safeParse(unknown).success).toBe(false)
    // A known kind never falls back to the generic row: a malformed known row still fails the list.
    const { task_id: _taskId, ...withoutTask } = known
    for (const bad of [{ ...known, extra: true }, withoutTask, { ...known, kind: 'meeting_invite' }]) {
      expect(() => NotificationListSchema.parse({ items: [bad], total: 1, unread_count: 1 })).toThrow()
    }
    for (const bad of [
      { ...unknown, kind: 'Sales-Order' },
      { ...unknown, id: 0 },
      { ...unknown, is_read: undefined },
      { ...unknown, created_at: undefined },
    ]) {
      expect(() => NotificationListSchema.parse({ items: [bad], total: 1, unread_count: 1 })).toThrow()
    }
  })
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm -w packages/contracts run test -- src/pmo/__tests__/notifications.test.ts 2>&1 | tail -n 12
```

Expected: `UnknownNotificationSchema` is `undefined` (TypeError) and the list rejects `sales_order_assigned` with `Invalid input` on `kind`.

- [ ] **Step 3: Add the generic arm**

In `packages/contracts/src/pmo/notification.ts` replace:

```ts
import { z } from 'zod'
import { TaskSchema } from './task'
```

with:

```ts
import { z } from 'zod'
import { IDENTIFIER_PATTERN } from '../access'
import { TaskSchema } from './task'
```

Replace:

```ts
export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  total: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
}).strict()
```

with:

```ts
const KNOWN_NOTIFICATION_KINDS: ReadonlySet<string> = new Set(NotificationKindSchema.options)

/**
 * A bell row of a kind this contract does not know: another application registered it in
 * nasq_notify after this build. Only the envelope is read; extra keys are kept. A known kind
 * never parses here, so a malformed known row still fails the list.
 */
export const UnknownNotificationSchema = z.object({
  id: z.number().int().positive(),
  kind: z.string().regex(IDENTIFIER_PATTERN).refine(
    (kind) => !KNOWN_NOTIFICATION_KINDS.has(kind),
    { message: 'a known notification kind must match its own shape' },
  ),
  title: z.string().optional(),
  body: z.string().optional(),
  created_at: z.string(),
  is_read: z.boolean(),
}).loose()

export const BellNotificationSchema = z.union([NotificationSchema, UnknownNotificationSchema])

export const NotificationListSchema = z.object({
  items: z.array(BellNotificationSchema),
  total: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
}).strict()
```

Replace:

```ts
export type Notification = z.infer<typeof NotificationSchema>
```

with:

```ts
export type Notification = z.infer<typeof NotificationSchema>
export type UnknownNotification = z.infer<typeof UnknownNotificationSchema>
export type BellNotification = z.infer<typeof BellNotificationSchema>
```

- [ ] **Step 4: Run the contracts tests**

```bash
npm -w packages/contracts run test 2>&1 | tail -n 6
npm -w packages/contracts run build > /tmp/nasq-open-lists/logs/contracts-build.log 2>&1; echo "contracts build exit=$?"; tail -n 5 /tmp/nasq-open-lists/logs/contracts-build.log
```

Expected: green; `contracts build exit=0`.

- [ ] **Step 5: Write the failing web tests**

In `apps/web/app/utils/__tests__/notificationPresentation.test.ts` replace the line:

```ts
import { describe, expect, it } from 'vitest'
```

with:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
```

and append inside `describe('notification presentation', ...)`:

```ts

  it("captions a newer application's kind with a generic label present in both locales", () => {
    for (const kind of ['sales_order_assigned', 'meeting_future_change', 'reaction']) {
      expect(notificationPreviewCaptionKey(kind)).toBe('notifications.preview.other')
    }
    expect(notificationPreviewCaptionKey('mention')).toBe('notifications.preview.mention')
    for (const locale of ['ar', 'en']) {
      const messages = JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/locales/${locale}/notifications.json`), 'utf8'))
      expect(typeof messages.notifications.preview.other, locale).toBe('string')
      expect(messages.notifications.preview.other.length, locale).toBeGreaterThan(0)
    }
  })
```

In `apps/web/app/components/notifications/__tests__/NotificationCenter.test.ts` replace the head:

```ts
import { describe, expect, it } from 'vitest'
import { NotificationSchema } from '@nasq/contracts'
import { isDigestNotification, isMeetingNotification } from '../../../composables/useNotifications'

function href(item: ReturnType<typeof NotificationSchema.parse>) {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  return `/tasks/${item.task_id}`
}
```

with:

```ts
import { describe, expect, it } from 'vitest'
import { NotificationListSchema, NotificationSchema, type BellNotification } from '@nasq/contracts'
import { isDigestNotification, isKnownNotification, isMeetingNotification } from '../../../composables/useNotifications'

// Mirrors notificationHref() in NotificationCenter.vue.
function href(item: BellNotification) {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  if (isKnownNotification(item)) return `/tasks/${item.task_id}`
  return null
}
```

and append inside the `describe` block:

```ts

  it("keeps a newer application's row as a generic row without a link", () => {
    const list = NotificationListSchema.parse({
      items: [
        { id: 93, kind: 'sales_order_assigned', order_id: 5, title: 'SO-0005', body: 'Order assigned to you', created_at: '2026-10-07T09:00:00Z', is_read: false },
        { id: 92, kind: 'meeting_future_change', body: 'Changed', created_at: '2026-10-07T09:00:00Z', is_read: true },
        { id: 91, kind: 'meeting_invite', meeting_id: 7, meeting_name: 'Review', body: '', created_at: '2026-09-07T12:00:00Z', is_read: false },
      ],
      total: 3,
      unread_count: 2,
    })
    const [sales, future, invite] = list.items as [BellNotification, BellNotification, BellNotification]
    expect(isKnownNotification(sales)).toBe(false)
    expect(href(sales)).toBeNull()
    // Not a meeting row: the old startsWith('meeting_') test would have linked /meetings/undefined.
    expect(isMeetingNotification(future)).toBe(false)
    expect(href(future)).toBeNull()
    expect(isKnownNotification(invite)).toBe(true)
    expect(href(invite)).toBe('/meetings/7')
  })
```

- [ ] **Step 6: Run them to make sure they fail**

```bash
npm -w apps/web run test -- app/utils/__tests__/notificationPresentation.test.ts app/components/notifications/__tests__/NotificationCenter.test.ts 2>&1 | tail -n 15
```

Expected: `notifications.preview.sales_order_assigned` received instead of `notifications.preview.other`; `isKnownNotification is not a function`.

- [ ] **Step 7: Implement the web side**

Replace lines 1–3 of `apps/web/app/utils/notificationPresentation.ts`:

```ts
import type { NotificationKind } from '@nasq/contracts'

export type NotificationPreviewKind = NotificationKind
```

with:

```ts
import { MeetingNotificationSchema, NotificationKindSchema, TaskNotificationKindSchema, type NotificationKind } from '@nasq/contracts'

/** Today's kinds keep their literal type; a newer application's kind is any other string. */
export type NotificationPreviewKind = NotificationKind | (string & {})

const KNOWN_KINDS: ReadonlySet<string> = new Set(NotificationKindSchema.options)
const MEETING_KINDS: ReadonlySet<string> = new Set(MeetingNotificationSchema.shape.kind.options)
const TASK_KINDS: ReadonlySet<string> = new Set(TaskNotificationKindSchema.options)

export function isKnownNotificationKind(kind: string): boolean {
  return KNOWN_KINDS.has(kind)
}

export function isMeetingNotificationKind(kind: string): boolean {
  return MEETING_KINDS.has(kind)
}
```

Replace the function at the end of the same file:

```ts
export function notificationPreviewCaptionKey(kind: NotificationPreviewKind): string {
  if (kind === 'overdue_digest') return 'tasks.digest.kind'
  if (kind.startsWith('meeting_')) return `meetingsUi.notify.${kind}`
  return `notifications.preview.${kind}`
}
```

with:

```ts
export function notificationPreviewCaptionKey(kind: NotificationPreviewKind): string {
  if (kind === 'overdue_digest') return 'tasks.digest.kind'
  if (MEETING_KINDS.has(kind)) return `meetingsUi.notify.${kind}`
  if (TASK_KINDS.has(kind)) return `notifications.preview.${kind}`
  return 'notifications.preview.other'
}
```

In `apps/web/app/composables/useNotifications.ts` replace:

```ts
import {
  NotificationDigestDetailSchema,
  NotificationListSchema,
  NotificationReadResultSchema,
  type Notification,
} from '@nasq/contracts'
```

with:

```ts
import {
  NotificationDigestDetailSchema,
  NotificationListSchema,
  NotificationReadResultSchema,
  type BellNotification,
  type Notification,
} from '@nasq/contracts'
// Relative, not '@/': the component unit tests import this file without the Nuxt alias.
import { isKnownNotificationKind, isMeetingNotificationKind } from '../utils/notificationPresentation'
```

and replace:

```ts
export function isDigestNotification(item: Notification): item is Extract<Notification, { kind: 'overdue_digest' }> {
  return item.kind === 'overdue_digest'
}

export function isMeetingNotification(item: Notification): item is Extract<Notification, { meeting_id: number }> {
  return item.kind.startsWith('meeting_')
}

export type { Notification }
```

with:

```ts
/** A row of a kind this build knows; a newer application's row is a generic row (title/body only, no link). */
export function isKnownNotification(item: BellNotification): item is Notification {
  return isKnownNotificationKind(item.kind)
}

export function isDigestNotification(item: BellNotification): item is Extract<Notification, { kind: 'overdue_digest' }> {
  return item.kind === 'overdue_digest'
}

export function isMeetingNotification(item: BellNotification): item is Extract<Notification, { meeting_id: number }> {
  return isMeetingNotificationKind(item.kind)
}

export type { BellNotification, Notification }
```

In `apps/web/app/components/notifications/NotificationCenter.vue` replace:

```ts
import { useNotifications, useMarkNotificationRead, isDigestNotification, isMeetingNotification, type Notification } from '@/composables/useNotifications'
```

with:

```ts
import { useNotifications, useMarkNotificationRead, isDigestNotification, isKnownNotification, isMeetingNotification, type BellNotification } from '@/composables/useNotifications'
```

Replace:

```ts
function notificationTimestamp(item: Notification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

function notificationHref(item: Notification) {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  return `/tasks/${item.task_id}`
}

async function openNotification(item: Notification) {
  if (isPending.value) return
  try {
    if (!item.is_read) await markRead(item.id)
    open.value = false
    await navigateTo(notificationHref(item))
  } catch (error) {
```

with:

```ts
function notificationTimestamp(item: BellNotification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

function notificationHref(item: BellNotification): string | null {
  if (isDigestNotification(item)) return `/notification-digests/${item.digest_id}`
  if (isMeetingNotification(item)) return `/meetings/${item.meeting_id}`
  if (isKnownNotification(item)) return `/tasks/${item.task_id}`
  // A newer application's row has no client route in this build: opening it only marks it read.
  return null
}

function previewTitle(item: BellNotification): string {
  if (isDigestNotification(item)) return t('tasks.digest.count', item.overdue_count)
  if (isMeetingNotification(item)) return item.meeting_name
  if (isKnownNotification(item)) return item.task_name
  return item.title || item.body || ''
}

async function openNotification(item: BellNotification) {
  if (isPending.value) return
  try {
    if (!item.is_read) await markRead(item.id)
    open.value = false
    const href = notificationHref(item)
    if (href) await navigateTo(href)
  } catch (error) {
```

and replace:

```html
                <span class="min-w-0 break-words line-clamp-2 text-start text-sm font-medium"><bdi dir="auto">{{ isDigestNotification(item) ? t('tasks.digest.count', item.overdue_count) : isMeetingNotification(item) ? item.meeting_name : item.task_name }}</bdi></span>
```

with:

```html
                <span class="min-w-0 break-words line-clamp-2 text-start text-sm font-medium"><bdi dir="auto">{{ previewTitle(item) }}</bdi></span>
```

In `apps/web/app/pages/notifications.vue` replace:

```ts
import {
  isDigestNotification,
  isMeetingNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsPage,
  type Notification,
} from '@/composables/useNotifications'
```

with:

```ts
import {
  isDigestNotification,
  isKnownNotification,
  isMeetingNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsPage,
  type BellNotification,
} from '@/composables/useNotifications'
```

Replace:

```ts
function kindLabel(item: Notification) {
  if (isDigestNotification(item)) return t('tasks.digest.kind')
```

with:

```ts
function kindLabel(item: BellNotification) {
  if (!isKnownNotification(item)) return t('notifications.preview.other')
  if (isDigestNotification(item)) return t('tasks.digest.kind')
```

Replace:

```ts
function itemTitle(item: Notification) {
  if (isDigestNotification(item)) return t('tasks.digest.count', { n: item.overdue_count })
  if (isMeetingNotification(item)) return item.meeting_name
  return item.task_name
}

function notificationTimestamp(item: Notification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

async function openNotification(item: Notification) {
  if (actionPending.value) return
  pendingReadId.value = item.id
  try {
    await markRead(item.id)
    if (isDigestNotification(item)) await navigateTo(`/notification-digests/${item.id}`)
    else if (isMeetingNotification(item)) await navigateTo(`/meetings/${item.meeting_id}`)
    else await navigateTo(`/tasks/${item.task_id}`)
```

with:

```ts
function itemTitle(item: BellNotification) {
  if (isDigestNotification(item)) return t('tasks.digest.count', { n: item.overdue_count })
  if (isMeetingNotification(item)) return item.meeting_name
  if (isKnownNotification(item)) return item.task_name
  return item.title || item.body || ''
}

function notificationTimestamp(item: BellNotification) {
  return notificationTimestamps.value.get(item.id) ?? null
}

async function openNotification(item: BellNotification) {
  if (actionPending.value) return
  pendingReadId.value = item.id
  try {
    await markRead(item.id)
    if (isDigestNotification(item)) await navigateTo(`/notification-digests/${item.id}`)
    else if (isMeetingNotification(item)) await navigateTo(`/meetings/${item.meeting_id}`)
    else if (isKnownNotification(item)) await navigateTo(`/tasks/${item.task_id}`)
```

(The digest link keeps `item.id` here and `item.digest_id` in the popover, exactly as today.)

In `apps/web/i18n/locales/en/notifications.json` replace:

```json
      "deadline": "A task deadline is near"
    },
```

with:

```json
      "deadline": "A task deadline is near",
      "other": "Notification"
    },
```

In `apps/web/i18n/locales/ar/notifications.json` replace:

```json
      "deadline": "اقترب موعد تسليم مهمة"
    },
```

with:

```json
      "deadline": "اقترب موعد تسليم مهمة",
      "other": "إشعار"
    },
```

- [ ] **Step 8: Run the web tests, the type check and the policies**

```bash
npm -w apps/web run test -- app/utils/__tests__/notificationPresentation.test.ts app/components/notifications/__tests__/NotificationCenter.test.ts app/utils/__tests__/modulePreviewFixtures.test.mjs 2>&1 | tail -n 8
npm -w apps/web run lint 2>&1 | tail -n 5
npm test 2>&1 | tail -n 12
```

Expected: green (the existing caption tests still map every task and meeting kind as before; the module preview fixtures still parse `/api/v1/notifications`); type check green; `npm test` green (`ui_policy` locale parity sees `other` in both catalogues).

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/pmo apps/web/app/utils/notificationPresentation.ts apps/web/app/utils/__tests__/notificationPresentation.test.ts \
  apps/web/app/composables/useNotifications.ts apps/web/app/components/notifications apps/web/app/pages/notifications.vue \
  apps/web/i18n/locales/ar/notifications.json apps/web/i18n/locales/en/notifications.json
git commit -m "feat(web): show unknown bell kinds as generic rows" -m "<TRAILER>"
```

---

### Task 5: Derive a capability's feature and write class on the client

**Files:**
- Modify: `apps/web/app/modules/registry.ts` (whole file)
- Modify: `apps/web/app/modules/__tests__/registry.test.ts`, `apps/web/app/utils/__tests__/accessPolicy.test.ts`

**Interfaces:**
- Produces: `KNOWN_FEATURE_KEYS` (`['pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled'] as const`), `type KnownFeatureKey`, `type FeatureKey = KnownFeatureKey | (string & {})`; `featureForCapability(capability: string): FeatureKey | null` (`nasq.internal` → `chat.enabled`; prefixes `access`, `settings`, `nasq`, `vendor`, `subscription`, `billing`, `branches` and dot-less strings → `null`; otherwise `<first segment>.enabled`); `isWriteCapability(capability: string): boolean` (`false` for `nasq.internal`; otherwise `last segment !== 'read'`). `canUse`, `hasFeature`, `featureForPath`, `pathIsWrite`, `featureGateActive`, `MODULE_FEATURES`, `TenantIdentity` keep their signatures.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/modules/__tests__/registry.test.ts` replace:

```ts
import { describe, expect, it } from 'vitest'
import { MeSchema } from '@nasq/contracts'
import { canUse, featureForPath, hasFeature } from '../registry'
```

with:

```ts
import { describe, expect, it } from 'vitest'
import { KNOWN_CAPABILITIES, MeSchema } from '@nasq/contracts'
import { canUse, featureForCapability, featureForPath, hasFeature, isWriteCapability } from '../registry'
```

and append at the end of the file:

```ts

// The client gate of every capability before the derivation (registry.ts at 1aa7c4b4):
// [capability, feature, write]. meetings.manage is the one intended change (ruling 4).
const TODAY: ReadonlyArray<readonly [string, string | null, boolean]> = [
  ['access.users.read', null, false], ['access.users.grant', null, true],
  ['access.users.assign_roles', null, true], ['access.users.disable', null, true],
  ['access.users.reset_password', null, true], ['access.roles.read', null, false],
  ['access.roles.manage', null, true], ['access.audit.read', null, false],
  ['hr.employees.read', 'hr.enabled', false], ['hr.employees.manage', 'hr.enabled', true],
  ['hr.employees.archive', 'hr.enabled', true], ['hr.employees.access_status.read', 'hr.enabled', false],
  ['hr.departments.read', 'hr.enabled', false], ['hr.departments.manage', 'hr.enabled', true],
  ['hr.documents.read', 'hr.enabled', false], ['hr.documents.manage', 'hr.enabled', true],
  ['pmo.projects.read', 'pmo.enabled', false], ['pmo.projects.create', 'pmo.enabled', true],
  ['pmo.projects.manage', 'pmo.enabled', true], ['pmo.settings.manage', 'pmo.enabled', true],
  ['pmo.tasks.read', 'pmo.enabled', false], ['pmo.tasks.create', 'pmo.enabled', true],
  ['pmo.tasks.write', 'pmo.enabled', true], ['pmo.tasks.approve', 'pmo.enabled', true],
  ['settings.branding.manage', null, true],
  ['meetings.read', 'meetings.enabled', false], ['meetings.create', 'meetings.enabled', true],
  ['nasq.internal', 'chat.enabled', false],
]

describe('capability gate derivation', () => {
  it("keeps the gate of every one of today's capabilities except meetings.manage", () => {
    for (const [capability, feature, write] of TODAY) {
      expect([capability, featureForCapability(capability), isWriteCapability(capability)]).toEqual([capability, feature, write])
    }
    const listed = new Set(TODAY.map(([capability]) => capability))
    expect(KNOWN_CAPABILITIES.filter(key => !listed.has(key))).toEqual(['meetings.manage'])
  })

  it('leaves the foundation, vendor and subscription prefixes ungated by any application feature', () => {
    const locked = { platform: { readable_features: [], writable_features: [] } }
    for (const capability of ['vendor', 'vendor.read', 'vendor.audit.read', 'vendor.tenants.manage', 'subscription.read', 'billing.read', 'branches.manage', 'nasq.notifications', 'access.users.grant', 'settings.branding.manage']) {
      expect(featureForCapability(capability), capability).toBeNull()
      expect(canUse(locked, capability, true), capability).toBe(true)
    }
  })

  it('turns meetings.manage into a write that only a writable meetings feature opens', () => {
    expect(featureForCapability('meetings.manage')).toBe('meetings.enabled')
    expect(isWriteCapability('meetings.manage')).toBe(true)
    const readOnly = {
      capabilities: ['meetings.read', 'meetings.create', 'meetings.manage'],
      platform: { readable_features: ['meetings.enabled'], writable_features: [] },
    }
    expect(canUse(readOnly, 'meetings.read')).toBe(true)
    // series/[id].vue canAddOccurrence = can('meetings.create') && (can('meetings.manage') || organizer):
    // meetings.create was already closed on a read-only tenant, so no visible control changes.
    expect(canUse(readOnly, 'meetings.create')).toBe(false)
    expect(canUse(readOnly, 'meetings.manage')).toBe(false)
    const writable = { ...readOnly, platform: { readable_features: ['meetings.enabled'], writable_features: ['meetings.enabled'] } }
    expect(canUse(writable, 'meetings.create')).toBe(true)
    expect(canUse(writable, 'meetings.manage')).toBe(true)
  })

  it('gates a newer application by its own <app>.enabled feature and action', () => {
    expect(featureForCapability('sales.orders.read')).toBe('sales.enabled')
    expect(featureForCapability('sales.orders.write')).toBe('sales.enabled')
    expect(isWriteCapability('sales.orders.read')).toBe(false)
    expect(isWriteCapability('sales.orders.write')).toBe(true)
    expect(isWriteCapability('sales.reports.export')).toBe(true)
    const tenant = (readable: string[], writable: string[]) => ({
      capabilities: ['sales.orders.read', 'sales.orders.write'],
      modules: ['nasq_sales'],
      entitlements: { 'sales.enabled': readable.includes('sales.enabled') },
      platform: { readable_features: readable, writable_features: writable },
    })
    expect(canUse(tenant(['sales.enabled'], ['sales.enabled']), 'sales.orders.write')).toBe(true)
    expect(canUse(tenant(['sales.enabled'], []), 'sales.orders.read')).toBe(true)
    expect(canUse(tenant(['sales.enabled'], []), 'sales.orders.write')).toBe(false)
    expect(canUse(tenant([], []), 'sales.orders.read')).toBe(false)
    expect(canUse({ capabilities: ['sales.orders.write'] }, 'sales.orders.write')).toBe(true)
    expect(hasFeature(tenant(['sales.enabled'], []), 'sales.enabled')).toBe(true)
  })
})
```

In `apps/web/app/utils/__tests__/accessPolicy.test.ts` replace:

```ts
import { hasCapability, firstAllowedPath, isNavPathActive, requiredCapabilityForPath, postLoginPath } from '../accessPolicy'
```

with:

```ts
import { canReach, hasCapability, firstAllowedPath, isNavPathActive, requiredCapabilityForPath, postLoginPath } from '../accessPolicy'
```

and append inside `describe('access policy navigation', ...)`:

```ts

  it("reaches a newer application's capability through its own feature, without navigation", () => {
    const sales = (readable: string[], writable: string[]) => ({
      capabilities: ['sales.orders.read', 'sales.orders.write'],
      modules: ['nasq_sales'],
      entitlements: { 'sales.enabled': readable.includes('sales.enabled') },
      platform: { readable_features: readable, writable_features: writable },
    })
    expect(canReach(sales(['sales.enabled'], ['sales.enabled']), 'sales.orders.write')).toBe(true)
    expect(canReach(sales(['sales.enabled'], []), 'sales.orders.read')).toBe(true)
    expect(canReach(sales(['sales.enabled'], []), 'sales.orders.write')).toBe(false)
    expect(canReach(sales([], []), 'sales.orders.read')).toBe(false)
    expect(canReach({ capabilities: ['sales.orders.read'] }, 'sales.orders.write')).toBe(false)
    // Nav entries and landing pages for new apps are Phase 4 (app manifest): a sales-only user lands on /account.
    expect(firstAllowedPath(sales(['sales.enabled'], ['sales.enabled']))).toBe('/account')
    expect(requiredCapabilityForPath('/sales/orders')).toBeNull()
  })
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
npm -w apps/web run test -- app/modules/__tests__/registry.test.ts app/utils/__tests__/accessPolicy.test.ts 2>&1 | tail -n 15
```

Expected: `isWriteCapability is not a function`; `featureForCapability('sales.orders.read')` is `null` instead of `sales.enabled`; `canUse(..., 'sales.orders.read')` is `true` on the withdrawn tenant.

- [ ] **Step 3: Replace the registry**

Replace the whole of `apps/web/app/modules/registry.ts` with:

```ts
const INTERNAL_NASQ_ACCESS = 'nasq.internal'
const NOTIFICATION_ACCESS = 'nasq.notifications'

export type TenantIdentity = {
  role?: string
  capabilities?: readonly string[]
  modules?: readonly string[]
  entitlements?: Record<string, boolean | number | null>
  platform?: {
    readable_features: readonly string[]
    writable_features: readonly string[]
    state?: string
    read_only?: boolean
  }
} | null | undefined

/** Today's application features; a newer application's `<app>.enabled` is any other string. */
export const KNOWN_FEATURE_KEYS = ['pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled'] as const
export type KnownFeatureKey = typeof KNOWN_FEATURE_KEYS[number]
export type FeatureKey = KnownFeatureKey | (string & {})

export const MODULE_FEATURES: Record<'home' | 'projects' | 'meetings' | 'chat' | 'hr' | 'settings' | 'vendor' | 'management', KnownFeatureKey | null> = {
  home: 'pmo.enabled',
  projects: 'pmo.enabled',
  meetings: 'meetings.enabled',
  chat: 'chat.enabled',
  hr: 'hr.enabled',
  settings: null,
  vendor: null,
  management: null,
}

/**
 * A capability's application feature is `<first segment>.enabled` (pmo, meetings, hr and any
 * newer application). Exceptions keep today's gates: chat's capability is `nasq.internal`,
 * and the foundation (`access`, `settings`, `nasq`), the vendor console and the customer
 * subscription prefixes belong to no application feature.
 */
const CAPABILITY_FEATURES: ReadonlyMap<string, FeatureKey> = new Map([[INTERNAL_NASQ_ACCESS, 'chat.enabled']])
const FEATURELESS_PREFIXES: ReadonlySet<string> = new Set(['access', 'settings', 'nasq', 'vendor', 'subscription', 'billing', 'branches'])
/** A capability is a write unless its action (last segment) is `read`; `nasq.internal` only opens chat for reading. */
const READ_CAPABILITIES: ReadonlySet<string> = new Set([INTERNAL_NASQ_ACCESS])

export function featureGateActive(identity: TenantIdentity): boolean {
  return Boolean(identity && (identity.modules || identity.entitlements || identity.platform))
}

export function featureForCapability(capability: string): FeatureKey | null {
  const explicit = CAPABILITY_FEATURES.get(capability)
  if (explicit) return explicit
  const dot = capability.indexOf('.')
  if (dot < 1) return null
  const prefix = capability.slice(0, dot)
  return FEATURELESS_PREFIXES.has(prefix) ? null : `${prefix}.enabled`
}

export function isWriteCapability(capability: string): boolean {
  if (READ_CAPABILITIES.has(capability)) return false
  return capability.slice(capability.lastIndexOf('.') + 1) !== 'read'
}

export function featureForPath(path: string): FeatureKey | null {
  if (path === '/chat' || path.startsWith('/chat/')) return 'chat.enabled'
  if (path === '/hr' || path.startsWith('/hr/')) return 'hr.enabled'
  if (path === '/meetings' || path.startsWith('/meetings/')) return 'meetings.enabled'
  if (
    path.startsWith('/projects')
    || path.startsWith('/tasks')
    || path.startsWith('/project-templates')
    || path.startsWith('/reports')
    || path === '/archived-tasks'
  ) return 'pmo.enabled'
  return null
}

export function pathIsWrite(path: string): boolean {
  return /\/(new|edit|access)(?:\/|$)/.test(path)
}

export function hasFeature(identity: TenantIdentity, key: FeatureKey | null, write = false): boolean {
  if (!key) return true
  if (!featureGateActive(identity)) return true
  const platform = identity?.platform
  if (platform) {
    const list = write ? platform.writable_features : platform.readable_features
    return list.includes(key)
  }
  return identity?.entitlements?.[key] === true
}

export function canUse(identity: TenantIdentity, capability: string, write = false): boolean {
  if (capability === NOTIFICATION_ACCESS) {
    return hasFeature(identity, 'pmo.enabled') || hasFeature(identity, 'meetings.enabled')
  }
  return hasFeature(identity, featureForCapability(capability), write || isWriteCapability(capability))
}
```

(`featureForPath`, `pathIsWrite`, `hasFeature`, `featureGateActive` and the bell branch of `canUse` are unchanged; `WRITE_CAPABILITIES` is replaced by `isWriteCapability`.)

- [ ] **Step 4: Run the tests, the type check and the full web suite**

```bash
npm -w apps/web run test -- app/modules/__tests__/registry.test.ts app/utils/__tests__/accessPolicy.test.ts 2>&1 | tail -n 6
npm -w apps/web run test 2>&1 | tail -n 8
npm -w apps/web run lint 2>&1 | tail -n 5
```

Expected: green, including the existing nav tests under `app/composables/nav/__tests__/` (their identities use only today's capabilities, whose gates did not change).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/modules apps/web/app/utils/__tests__/accessPolicy.test.ts
git commit -m "feat(web): derive app features and write class from capabilities" -m "<TRAILER>"
```

---

### Task 6: Fall back to readable labels for applications that ship none

**Files:**
- Create: `apps/web/app/utils/labelFallback.ts`, `apps/web/app/utils/__tests__/labelFallback.test.ts`
- Modify: `apps/web/app/utils/vendorPackages.ts:1-2`, `:22-25` + `apps/web/app/utils/__tests__/vendorPackages.test.ts`
- Modify: `apps/web/app/components/access/roles/RolePermissionForm.vue:1-8`, `:22`
- Modify: `apps/web/app/pages/settings/roles/new.vue:2-7`, `:109`

**Interfaces:**
- Produces: `humanizeId(id: string): string` (strips a leading `nasq_`/`customer_`, splits on `_` and `.`, capitalises the first letter: `nasq_sales` → `Sales`, `customer_acme_reports` → `Acme reports`); `permissionDomainLabel(domain: string, t: (key: string) => string, te: (key: string) => boolean): string` (`access.roles.domains.<domain>` when it exists, else `humanizeId(domain)`). `packageLabel('module', id, t)` humanises an unlabelled id that matches `^(nasq|customer)_[a-z0-9_]+$`; every other unknown value stays raw.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/utils/__tests__/labelFallback.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { humanizeId, permissionDomainLabel } from '../labelFallback'

const app = resolve(import.meta.dirname, '../..')

function catalogue(locale: 'ar' | 'en') {
  const messages = JSON.parse(readFileSync(resolve(app, `../i18n/locales/${locale}/access.json`), 'utf8'))
  const lookup = (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], messages)
  return {
    domains: messages.access.roles.domains as Record<string, string>,
    t: (key: string) => (typeof lookup(key) === 'string' ? lookup(key) as string : key),
    te: (key: string) => typeof lookup(key) === 'string',
  }
}

describe('label fallbacks for applications that ship no label', () => {
  it('humanises module ids and identifiers', () => {
    expect(humanizeId('nasq_sales')).toBe('Sales')
    expect(humanizeId('customer_acme_reports')).toBe('Acme reports')
    expect(humanizeId('sales')).toBe('Sales')
    expect(humanizeId('field_service')).toBe('Field service')
    expect(humanizeId('')).toBe('')
  })

  it("keeps today's domain labels and never shows an i18n key for a new domain", () => {
    for (const locale of ['ar', 'en'] as const) {
      const { domains, t, te } = catalogue(locale)
      for (const domain of ['access', 'hr', 'pmo', 'meetings', 'settings']) {
        expect(permissionDomainLabel(domain, t, te)).toBe(domains[domain])
      }
      expect(permissionDomainLabel('sales', t, te)).toBe('Sales')
    }
  })

  it('routes both role screens through the fallback', () => {
    for (const file of ['components/access/roles/RolePermissionForm.vue', 'pages/settings/roles/new.vue']) {
      const source = readFileSync(resolve(app, file), 'utf8')
      expect(source, file).toContain('permissionDomainLabel(')
      expect(source, file).not.toContain('access.roles.domains.${')
    }
  })
})
```

In `apps/web/app/utils/__tests__/vendorPackages.test.ts` replace:

```ts
    expect(packageLabel('module', 'nasq_meetings', key => key)).toBe('vendor.packages.apps.meetings')
```

with:

```ts
    expect(packageLabel('module', 'nasq_meetings', key => key)).toBe('vendor.packages.apps.meetings')
    expect(packageLabel('module', 'nasq_sales', key => key)).toBe('Sales')
    expect(packageLabel('module', 'customer_acme_reports', key => key)).toBe('Acme reports')
    expect(packageLabel('feature', 'boolean:sales.enabled', key => key)).toBe('boolean:sales.enabled')
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
npm -w apps/web run test -- app/utils/__tests__/labelFallback.test.ts app/utils/__tests__/vendorPackages.test.ts 2>&1 | tail -n 12
```

Expected: `Failed to resolve import "../labelFallback"`; `packageLabel('module', 'nasq_sales', …)` returns `nasq_sales`.

- [ ] **Step 3: Implement the fallbacks**

Create `apps/web/app/utils/labelFallback.ts`:

```ts
/**
 * Readable text for an id that has no translation yet: a newer application ships its own
 * labels in its locale file (Phase 4); until then the UI shows `Sales`, never `nasq_sales`
 * or an i18n key.
 */
export function humanizeId(id: string): string {
  const text = id.replace(/^(?:nasq|customer)_/, '').split(/[_.]+/).filter(Boolean).join(' ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id
}

/** The role-screen heading of a permission domain; known domains keep their translation. */
export function permissionDomainLabel(domain: string, t: (key: string) => string, te: (key: string) => boolean): string {
  const key = `access.roles.domains.${domain}`
  return te(key) ? t(key) : humanizeId(domain)
}
```

In `apps/web/app/utils/vendorPackages.ts` replace:

```ts
import { safeReturnTo } from './safeReturnTo'
```

with:

```ts
import { humanizeId } from './labelFallback'
import { safeReturnTo } from './safeReturnTo'
```

and replace:

```ts
export function packageLabel(kind: 'tier' | 'module' | 'feature' | 'limit', value: string, t: (key: string) => string): string {
  const key = labelKeys[kind]?.[value]
  return key ? t(`vendor.packages.${kind === 'tier' ? 'tiers' : kind === 'module' ? 'apps' : kind === 'limit' ? 'limits' : 'features'}.${key}`) : value
}
```

with:

```ts
export function packageLabel(kind: 'tier' | 'module' | 'feature' | 'limit', value: string, t: (key: string) => string): string {
  const key = labelKeys[kind]?.[value]
  if (key) return t(`vendor.packages.${kind === 'tier' ? 'tiers' : kind === 'module' ? 'apps' : kind === 'limit' ? 'limits' : 'features'}.${key}`)
  // A newer application's module id reads as its name; other unknown values stay as sent (Phase 3 catalog names).
  return kind === 'module' && /^(?:nasq|customer)_[a-z0-9_]+$/.test(value) ? humanizeId(value) : value
}
```

In `apps/web/app/components/access/roles/RolePermissionForm.vue` replace:

```ts
import { useUpdateAdminRole } from '@/composables/useAdminRoles'
```

with:

```ts
import { useUpdateAdminRole } from '@/composables/useAdminRoles'
import { permissionDomainLabel } from '@/utils/labelFallback'
```

replace:

```ts
const { t, locale } = useI18n()
```

with:

```ts
const { t, te, locale } = useI18n()
```

and replace:

```ts
const domainLabel = (domain: string) => t(`access.roles.domains.${domain}`)
```

with:

```ts
const domainLabel = (domain: string) => permissionDomainLabel(domain, t, te)
```

In `apps/web/app/pages/settings/roles/new.vue` replace:

```ts
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'

const { t, locale } = useI18n()
```

with:

```ts
import { adminListQuery, adminPathWithQuery } from '@/composables/adminSettingsPaths'
import { permissionDomainLabel } from '@/utils/labelFallback'

const { t, te, locale } = useI18n()
const domainLabel = (domain: string) => permissionDomainLabel(domain, t, te)
```

and replace:

```html
            <h3 class="text-sm font-medium">{{ t(`access.roles.domains.${domain}`) }}</h3>
```

with:

```html
            <h3 class="text-sm font-medium">{{ domainLabel(domain) }}</h3>
```

- [ ] **Step 4: Run the tests, the type check and the policies**

```bash
npm -w apps/web run test -- app/utils/__tests__/labelFallback.test.ts app/utils/__tests__/vendorPackages.test.ts 2>&1 | tail -n 6
npm -w apps/web run lint 2>&1 | tail -n 5
npm test 2>&1 | tail -n 12
```

Expected: green. If `npm test` stops at `ui_policy`/`ui_inventory`/`ui_catalog`, read the message: none of the touched components is a catalogue component and no new template tag is added, so a failure there is a real regression to fix, not a baseline to rewrite.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/utils/labelFallback.ts apps/web/app/utils/__tests__/labelFallback.test.ts apps/web/app/utils/vendorPackages.ts \
  apps/web/app/utils/__tests__/vendorPackages.test.ts apps/web/app/components/access/roles/RolePermissionForm.vue apps/web/app/pages/settings/roles/new.vue
git commit -m "feat(web): fall back to readable labels for unknown apps" -m "<TRAILER>"
```

---

### Task 7: Prove the domain column on both CI upgrade paths

This mirrors the CI `upgrade` step twice: from the commit this branch started from (current `main`, `-u` only) and from `release/19.0.1.0.0` (`-u` and `-i` with the ten-module list, exactly as `.woodpecker.yml` does). Nothing is committed in this task.

**Files:**
- Create (outside the repo): `/tmp/nasq-open-lists/domain_snapshot.py`, `/tmp/nasq-open-lists/domain_assert.py`, `/tmp/nasq-open-lists/base-main`, `/tmp/nasq-open-lists/base-release` (temporary detached worktrees)

**Interfaces:**
- Consumes: `nasq_core` 19.0.1.2.0 and `_check_key_and_domain` (Task 1).

- [ ] **Step 1: Write the two scripts**

```bash
cat > /tmp/nasq-open-lists/domain_snapshot.py <<'SNAPSHOT'
# Piped into `odoo-bin shell` on a base database running the base code (plan 2026-10-07-open-app-lists, Task 7).
import json
import sys

DB = env.cr.dbname  # noqa: F821
assert DB.startswith('nasq_scratch_openlists_'), DB
cr = env.cr  # noqa: F821
KNOWN = ['access', 'hr', 'meetings', 'pmo', 'settings']

cr.execute(
    "SELECT data_type, is_nullable FROM information_schema.columns "
    "WHERE table_name = 'nasq_access_permission' AND column_name = 'domain'",
)
column = list(cr.fetchone())
cr.execute('SELECT key, domain FROM nasq_access_permission ORDER BY key')
rows = dict(cr.fetchall())
cr.execute("SELECT id, ttype FROM ir_model_fields WHERE model = 'nasq.access.permission' AND name = 'domain'")
field_id, ttype = cr.fetchone()
cr.execute('SELECT value FROM ir_model_fields_selection WHERE field_id = %s ORDER BY value', [field_id])
selection = [value for (value,) in cr.fetchall()]
problems = []
if ttype != 'selection' or selection != KNOWN:
    problems.append(f'base is not the closed selection: {ttype} {selection}')
if column != ['character varying', 'NO']:
    problems.append(f'column {column}')
if len(rows) != 28 or sorted(set(rows.values())) != KNOWN or any(key.split('.')[0] != domain for key, domain in rows.items()):
    problems.append(f'rows {rows}')
with open(f'/tmp/nasq-open-lists/domain-before-{DB}.json', 'w', encoding='utf-8') as handle:
    json.dump({'rows': rows, 'column': column, 'field_id': field_id}, handle, indent=1, sort_keys=True)
for problem in problems:
    print(f'DOMAIN_SNAPSHOT_FAIL {problem}')
print('DOMAIN_SNAPSHOT_FAILED' if problems else f'DOMAIN_SNAPSHOT_OK rows={len(rows)} selection={len(selection)}')
sys.exit(1 if problems else 0)
SNAPSHOT
cat > /tmp/nasq-open-lists/domain_assert.py <<'ASSERT'
# Piped into `odoo-bin shell` on the upgraded database running the branch code (plan 2026-10-07-open-app-lists, Task 7).
import json
import sys

from odoo.exceptions import ValidationError

DB = env.cr.dbname  # noqa: F821
assert DB.startswith('nasq_scratch_openlists_'), DB
cr = env.cr  # noqa: F821
with open(f'/tmp/nasq-open-lists/domain-before-{DB}.json', encoding='utf-8') as handle:
    before = json.load(handle)
problems = []

cr.execute('SELECT key, domain FROM nasq_access_permission ORDER BY key')
rows = dict(cr.fetchall())
if rows != before['rows']:
    problems.append(f"stored domains changed: {sorted(set(rows.items()) ^ set(before['rows'].items()))}")
cr.execute(
    "SELECT data_type, is_nullable FROM information_schema.columns "
    "WHERE table_name = 'nasq_access_permission' AND column_name = 'domain'",
)
column = list(cr.fetchone())
if column != before['column']:
    problems.append(f"column {before['column']} -> {column}")
cr.execute("SELECT id, ttype FROM ir_model_fields WHERE model = 'nasq.access.permission' AND name = 'domain'")
field_id, ttype = cr.fetchone()
if ttype != 'char':
    problems.append(f'field type {ttype}')
if field_id != before['field_id']:
    problems.append(f"ir_model_fields row recreated: {before['field_id']} -> {field_id}")
cr.execute('SELECT count(*) FROM ir_model_fields_selection WHERE field_id = %s', [field_id])
if cr.fetchone()[0]:
    problems.append('old selection rows left in ir_model_fields_selection')
cr.execute(
    "SELECT count(*) FROM ir_model_data WHERE model = 'ir.model.fields.selection' "
    "AND starts_with(name, 'selection__nasq_access_permission__domain__')",
)
if cr.fetchone()[0]:
    problems.append('old selection xml ids left in ir_model_data')
cr.execute("SELECT latest_version FROM ir_module_module WHERE name = 'nasq_core'")
version = cr.fetchone()[0]
if version != '19.0.1.2.0':
    problems.append(f'nasq_core latest_version {version}')
Permission = env['nasq.access.permission']  # noqa: F821
values = {
    'resource': 'orders', 'action': 'read', 'name_ar': 'قراءة الطلبات', 'description_ar': 'قراءة الطلبات',
    'group_xmlid': 'nasq_core.group_cap_settings_branding_manage',
}
try:
    with cr.savepoint():
        Permission.create({**values, 'key': 'sales.orders.read', 'domain': 'sales'})
except Exception as error:  # noqa: BLE001 - report any refusal of a well-formed new domain
    problems.append(f'a new application domain was refused: {error}')
try:
    with cr.savepoint():
        Permission.create({**values, 'key': 'sales.orders.write', 'domain': 'Sales'})
    problems.append('a malformed domain was accepted')
except ValidationError:
    pass
cr.rollback()
for problem in problems:
    print(f'DOMAIN_UPGRADE_FAIL {problem}')
print('DOMAIN_UPGRADE_FAILED' if problems else f'DOMAIN_UPGRADE_OK rows={len(rows)}')
sys.exit(1 if problems else 0)
ASSERT
python3 -m py_compile /tmp/nasq-open-lists/domain_snapshot.py /tmp/nasq-open-lists/domain_assert.py && echo "scripts compile"
```

Expected: `scripts compile`.

- [ ] **Step 2: Upgrade from the current main (`-u` only)**

```bash
git worktree add --detach /tmp/nasq-open-lists/base-main "$(git merge-base HEAD main)"
git -C /tmp/nasq-open-lists/base-main log -1 --oneline
/tmp/nasq-open-lists/odoo-run.sh base nasq_scratch_openlists_up_main /tmp/nasq-open-lists/base-main \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat
/tmp/nasq-open-lists/odoo-run.sh shell nasq_scratch_openlists_up_main /tmp/nasq-open-lists/base-main \
  < /tmp/nasq-open-lists/domain_snapshot.py | tee /tmp/nasq-open-lists/logs/up-main-snapshot.log
grep -q DOMAIN_SNAPSHOT_OK /tmp/nasq-open-lists/logs/up-main-snapshot.log && echo "snapshot ok"
/tmp/nasq-open-lists/odoo-run.sh upgrade nasq_scratch_openlists_up_main \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat
/tmp/nasq-open-lists/odoo-run.sh shell nasq_scratch_openlists_up_main /Users/tariq/code/nasq-open-lists \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/nasq-open-lists/logs/up-main-smoke.log
/tmp/nasq-open-lists/odoo-run.sh shell nasq_scratch_openlists_up_main /Users/tariq/code/nasq-open-lists \
  < /tmp/nasq-open-lists/domain_assert.py | tee /tmp/nasq-open-lists/logs/up-main-assert.log
grep -q DOMAIN_UPGRADE_OK /tmp/nasq-open-lists/logs/up-main-assert.log && echo "upgrade from main ok"
```

Expected: the merge-base commit (`1aa7c4b4` unless `main` moved); `ODOO_RUN_BASE_OK`; `DOMAIN_SNAPSHOT_OK rows=28 selection=5`; `snapshot ok`; `ODOO_RUN_UPGRADE_OK` (no `ERROR`/`CRITICAL` and no not-null warning in the log); `UPGRADE_SMOKE_OK installed=10`; `DOMAIN_UPGRADE_OK rows=28`; `upgrade from main ok`. Any `*_FAIL` line is a blocker: stop and report it with the log.

- [ ] **Step 3: Upgrade from release/19.0.1.0.0 with `-i`, as CI does**

```bash
git worktree add --detach /tmp/nasq-open-lists/base-release release/19.0.1.0.0
git -C /tmp/nasq-open-lists/base-release log -1 --oneline
/tmp/nasq-open-lists/odoo-run.sh base nasq_scratch_openlists_up_release /tmp/nasq-open-lists/base-release \
  nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat
/tmp/nasq-open-lists/odoo-run.sh shell nasq_scratch_openlists_up_release /tmp/nasq-open-lists/base-release \
  < /tmp/nasq-open-lists/domain_snapshot.py | tee /tmp/nasq-open-lists/logs/up-release-snapshot.log
grep -q DOMAIN_SNAPSHOT_OK /tmp/nasq-open-lists/logs/up-release-snapshot.log && echo "snapshot ok"
/tmp/nasq-open-lists/odoo-run.sh upgrade nasq_scratch_openlists_up_release \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat
grep -n "nasq_core: Running migration\|pre-move_app_xmlids\|Loading module nasq_core " \
  /tmp/nasq-open-lists/logs/nasq_scratch_openlists_up_release-upgrade.log | head -n 10
/tmp/nasq-open-lists/odoo-run.sh shell nasq_scratch_openlists_up_release /Users/tariq/code/nasq-open-lists \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/nasq-open-lists/logs/up-release-smoke.log
/tmp/nasq-open-lists/odoo-run.sh shell nasq_scratch_openlists_up_release /Users/tariq/code/nasq-open-lists \
  < /tmp/nasq-open-lists/domain_assert.py | tee /tmp/nasq-open-lists/logs/up-release-assert.log
grep -q DOMAIN_UPGRADE_OK /tmp/nasq-open-lists/logs/up-release-assert.log && echo "upgrade from release ok"
```

Expected: `f9b961b5` for the tag (no `nasq_platform` there, so the base install is unclassified, as in CI); `ODOO_RUN_BASE_OK`; `DOMAIN_SNAPSHOT_OK rows=28 selection=5` (in the release the 28 permissions all live in `nasq_core`); `ODOO_RUN_UPGRADE_OK`; the `grep -n` shows the released `pre-move_app_xmlids` migration of 19.0.1.1.0 running (19.0.1.2.0 has only a README, so nothing of it is executed); `UPGRADE_SMOKE_OK installed=10`; `DOMAIN_UPGRADE_OK rows=28`; `upgrade from release ok`. If only the release path fails `stored domains changed` or `ir_model_fields row recreated`, check whether the same happens with the merge-base as the target (copy the runner to `/tmp/nasq-open-lists/odoo-run-base.sh` with `WORKTREE` set to `/tmp/nasq-open-lists/base-main` and repeat Step 3 against it, minus the 19.0.1.2.0 checks): a difference that also appears there is pre-existing and is reported with both outputs; a difference only with this branch is a blocker.

- [ ] **Step 4: Clean up**

```bash
/tmp/nasq-open-lists/odoo-run.sh drop nasq_scratch_openlists_up_main
/tmp/nasq-open-lists/odoo-run.sh drop nasq_scratch_openlists_up_release
git worktree remove /tmp/nasq-open-lists/base-main
git worktree remove /tmp/nasq-open-lists/base-release
git worktree list
```

Expected: both base worktrees are gone; the main checkout and `/Users/tariq/code/nasq-open-lists` remain. Keep the logs for the report.

---

### Task 8: API surface, documentation and final gates

**Files:**
- Create (outside the repo): `/tmp/nasq-open-lists/openapi_compare.py`
- Modify: `docs/api/openapi.json` (regenerated), `CLAUDE.md` ("Frontend and machine rules"), `AGENTS.md:182`, `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`

The `## Architecture rules (R1–R10)` block of `CLAUDE.md` and `AGENTS.md` is not touched, so the two copies stay identical.

- [ ] **Step 1: Compare the API surface (Deviation 4)**

```bash
cat > /tmp/nasq-open-lists/openapi_compare.py <<'COMPARE'
"""Compare two generated openapi.json documents (plan 2026-10-07-open-app-lists, Deviation 4)."""
import json
import sys

CHANGED = {
    'CapabilitySchema', 'RoleDetailSchema', 'RoleCreateInputSchema', 'RolePatchInputSchema',
    'PermissionDefinitionSchema', 'PermissionCatalogSchema', 'EffectiveCapabilitySchema',
    'AdminUserDetailSchema', 'MeSchema', 'NasqModuleIdSchema', 'NotificationListSchema',
}
ADDED = {'PermissionDomainSchema', 'UnknownNotificationSchema', 'BellNotificationSchema'}


def owner(name):
    return name.split('__', 1)[0]


with open(sys.argv[1], encoding='utf-8') as handle:
    before = json.load(handle)
with open(sys.argv[2], encoding='utf-8') as handle:
    after = json.load(handle)
problems = [f'{key} differs' for key in sorted(set(before) | set(after)) if key != 'components' and before.get(key) != after.get(key)]
old, new = before['components'], after['components']
problems += [f'components.{key} differs' for key in sorted(set(old) | set(new)) if key != 'schemas' and old.get(key) != new.get(key)]
old_schemas, new_schemas = old['schemas'], new['schemas']
removed = sorted(set(old_schemas) - set(new_schemas))
added = sorted(set(new_schemas) - set(old_schemas))
changed = sorted(name for name in set(old_schemas) & set(new_schemas) if old_schemas[name] != new_schemas[name])
if removed:
    problems.append(f'schemas removed: {removed}')
if {owner(name) for name in added} != ADDED:
    problems.append(f'schemas added {added}, expected owners {sorted(ADDED)}')
if unexpected := [name for name in changed if owner(name) not in CHANGED]:
    problems.append(f'unexpected schema changes: {unexpected}')
if unchanged := sorted(CHANGED - {owner(name) for name in changed}):
    problems.append(f'schemas expected to loosen did not change: {unchanged}')
operations = sum(len(item) for item in after['paths'].values())
for problem in problems:
    print(f'API_SURFACE_FAIL {problem}')
print('API_SURFACE_FAILED' if problems else f'API_SURFACE_OK operations={operations} changed={len(changed)} added={len(added)}')
sys.exit(1 if problems else 0)
COMPARE
python3 -B tools/api_surface.py
python3 /tmp/nasq-open-lists/openapi_compare.py /tmp/nasq-open-lists/openapi-before.json docs/api/openapi.json
python3 -B - <<'PY'
import json
schema = json.load(open('docs/api/openapi.json'))['components']['schemas']
print(json.dumps(schema['CapabilitySchema']), json.dumps(schema['PermissionDomainSchema']))
PY
```

Expected: `API_SURFACE_OK operations=… changed=… added=3` (`paths`, `info`, `servers`, `tags` and every other component identical) and the two schemas printed as `{"type": "string", "pattern": "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$", …}` and `{"type": "string", "pattern": "^[a-z][a-z0-9_]*$", …}`. Any `API_SURFACE_FAIL` is a blocker. Keep the regenerated `docs/api/openapi.json` (it also absorbs any staleness already on `main`).

- [ ] **Step 2: Commit the regenerated document**

```bash
python3 -B tools/api_surface.py --check
git add docs/api/openapi.json
git commit -m "docs(docs): regenerate openapi.json for the open contract lists" -m "<TRAILER>"
```

Expected: `openapi.json is up to date`.

- [ ] **Step 3: Update CLAUDE.md and AGENTS.md**

In `CLAUDE.md`, in `## Frontend and machine rules`, replace:

```markdown
- The data layer uses `@tanstack/vue-query` composables over `useApi()`, which
```

with:

```markdown
- Contracts accept any well-formed capability key (`<app>.<resource>.<action>`),
  module id (`nasq_*`, `customer_*`) and permission domain; `KNOWN_CAPABILITIES`,
  `KNOWN_NASQ_MODULE_IDS` and `KNOWN_PERMISSION_DOMAINS` keep today's values for
  typed code. On the client a capability's feature is `<first segment>.enabled`
  and it is a write unless its last segment is `read` (`app/modules/registry.ts`;
  exceptions are listed there). A bell kind the build does not know renders as a
  generic row; known kinds stay strict. A new application still adds its own
  navigation, locale file and labels (Phase 4).
- The data layer uses `@tanstack/vue-query` composables over `useApi()`, which
```

In `AGENTS.md` replace:

```markdown
  `19.0.X.Y.Z` (core/HR/meetings `19.0.1.0.0`, PMO `19.0.1.4.0`). Follow
```

with:

```markdown
  `19.0.X.Y.Z` (core `19.0.1.2.0`, HR `19.0.1.1.0`, meetings `19.0.1.0.0`, PMO `19.0.1.4.0`). Follow
```

- [ ] **Step 4: Update the roadmap**

In `docs/superpowers/plans/2026-10-05-architecture-roadmap.md` replace:

```markdown
**آخر تحديث:** 2026-10-07، عند `b959e5cc` على `main`، مع فرع المرحلة 2ب-2.
```

with:

```markdown
**آخر تحديث:** 2026-10-07، عند `1aa7c4b4` على `main`، مع فرع فتح قوائم التطبيقات `codex/core-open-app-lists`.
```

and replace:

```markdown
**النتيجة (2026-10-07):** نعم بحدود. التقرير الكامل: [docs/reports/2026-10-07-generic-app-layer-spike.md](../../reports/2026-10-07-generic-app-layer-spike.md). قبل أي مواصفة للطبقة العامة يلزم: (1) فتح قوائم التطبيقات المكتوبة يدوياً في الأساس والعقود والواجهة، وهي شرط لأي تطبيق رابع؛ (2) تعليم `arch_policy` و`api_surface` قراءة الواصف، أو توليد متحكمات Python عادية.
```

with:

```markdown
**النتيجة (2026-10-07):** نعم بحدود. التقرير الكامل: [docs/reports/2026-10-07-generic-app-layer-spike.md](../../reports/2026-10-07-generic-app-layer-spike.md). قبل أي مواصفة للطبقة العامة يلزم: (1) فتح قوائم التطبيقات المكتوبة يدوياً في الأساس والعقود والواجهة، وهي شرط لأي تطبيق رابع؛ (2) تعليم `arch_policy` و`api_surface` قراءة الواصف، أو توليد متحكمات Python عادية.

**الشرط (1) منفذ على `codex/core-open-app-lists`، بانتظار الدمج ([الخطة](2026-10-07-open-app-lists.md)):** حقل `domain` في
`nasq.access.permission` صار نصاً بقيد معرّف (`nasq_core` 19.0.1.2.0)، والعقود تقبل أي مفتاح قدرة ومعرّف وحدة ومجال
بصيغة صحيحة وتُبقي القيم الحالية في `KNOWN_*`، والجرس يعرض النوع غير المعروف صفاً عاماً، والواجهة تشتق ميزة القدرة
(`<البادئة>.enabled`) وصنفها (كتابة ما لم ينته المفتاح بـ`read`؛ فصارت `meetings.manage` كتابة)، والتسميات المفقودة
تُعرض معرّفاً مقروءاً، و`APP_TOKEN` في R2 يُشتق من رتب `arch_layers.json`. خط الأساس بلا تغيير.

**باقٍ عمداً خارج هذا الشرط:** عناصر التنقل والشريط والبحث وملف الترجمة لكل تطبيق في `nuxt.config.ts`، وظهور الجرس
لمستأجر ليس لديه إلا تطبيق جديد (`nasq.notifications` = مشاريع أو اجتماعات) — المرحلة 4؛ قائمة `TERMINOLOGY_KEYS`
المغلقة في `nasq_platform` (لا مستهلك لها في الواجهة)؛ خطوة منح ميزة التطبيق الجديد لمستأجر قائم وقوائم الوحدات في
الأدوات والنشر والكتالوج وخدمة التحكم — المرحلة 3؛ مفاتيح النطاق والأدوار السياقية (`project`،
`project_owner`، `project_creation_policy`) حتى يحتاج تطبيق ثانٍ صلاحيات على مستوى السجل.
```

- [ ] **Step 5: Run the final gates**

```bash
ruff check odoo-addons
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/catalog_check.py
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
git diff --stat main -- tools/arch_baseline.json tools/arch_layers.json
rg -n "'pmo'|'hr'|'meetings'|nasq_pmo|nasq_hr|nasq_meetings|nasq_chat" odoo-addons/nasq_core/models/access_permission.py || echo "permission model names no application"
diff <(sed -n '/^## Architecture rules (R1–R10)/,/^## /p' CLAUDE.md) <(sed -n '/^## Architecture rules (R1–R10)/,/^## /p' AGENTS.md) && echo "R1-R10 blocks identical"
npm test 2>&1 | tail -n 15
npm -w apps/web run lint 2>&1 | tail -n 5
npm -w packages/contracts run build > /tmp/nasq-open-lists/logs/contracts-build.log 2>&1; echo "contracts build exit=$?"; tail -n 5 /tmp/nasq-open-lists/logs/contracts-build.log
npm -w packages/commercial-contracts run test 2>&1 | tail -n 5
```

Expected: `All checks passed!`; three `exit=0`; `CATALOG_OK solutions=2`; deploy suite `OK`; the `git diff --stat` prints nothing; `permission model names no application`; `R1-R10 blocks identical` (if the two files format that block differently on `main` already, compare with `main`'s result and report; this plan does not edit it); `npm test`, the type check, `contracts build exit=0` and the commercial suite green.

Then run the three installs once more in the background, one after the other:

```bash
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_final \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_meetings,nasq_meetings_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_meetings,/nasq_meetings_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_final_hr \
  nasq_core,nasq_platform,nasq_api,nasq_hr \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-open-lists/odoo-run.sh test nasq_scratch_openlists_final_meet \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_meetings \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_meetings
```

Expected: three `ODOO_RUN_TEST_OK` lines with the Task 0 probes and the Task 1 Step 6 counts.

- [ ] **Step 6: Commit the documentation**

```bash
git add CLAUDE.md AGENTS.md docs/superpowers/plans/2026-10-05-architecture-roadmap.md
git commit -m "docs(docs): record the open app lists and the remaining lists" -m "<TRAILER>"
git log --format='%h %s' main..HEAD
git log --format=%B -n 1
git status --short
```

Expected: nine commits on the branch (plan, Tasks 1–6, `openapi.json`, docs), each subject `type(scope): subject` of at most 72 characters with the trailer in its body (the second command shows a body ending with the trailer line), and a clean status.

- [ ] **Step 7: Report**

Report to the orchestrator: the base commit; the nine commit hashes and subjects; the arch totals before and after (identical: `R1 0, R10 0, R2 4, R3 4, R4 0, R5 8, R6 0, R7 83, R8 1, R9 68`); the `API_SURFACE_OK` line; the Odoo test counts of Task 0, Task 1 and the three final runs with their `INSTALLED_PROBE` lines; the two `DOMAIN_UPGRADE_OK` lines and the release-path migration `grep -n`; whether the mock Playwright suite was run (it is not part of this plan's gates; the memory note says the mock project specs already fail about 73 cases on `main`, so any run must diff failing-title sets against a pre-merge worktree); the untracked copy of this plan in the main checkout that must be removed before the merge; owner decisions still open (the humanised English fallback text in the Arabic UI; generic bell rows that only mark read; the bell gate for a new-app-only tenant). Do not merge or push.
