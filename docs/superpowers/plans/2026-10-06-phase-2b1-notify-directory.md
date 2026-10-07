# Phase 2b-1: nasq_notify, nasq_directory and the Shared Attachment Validator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The notification bell moves out of `nasq_pmo` into a new shared-service addon `nasq_notify`, `/api/v1/people` moves into a new shared-service addon `nasq_directory`, and the pure attachment upload validator moves to `nasq_api/serializers/attachment.py`, with no API surface change and with upgrades that keep every notification row visible to the same recipients.

**Architecture:** `nasq_notify` (rank 3) owns the three generic `mail.message` bell columns and their unique key index, an AbstractModel registry `nasq.notify.registry` composed through `super()` (descriptors `{kind, owner, model, feature_key}` plus overridable visibility, row-check, dump and feature-key hooks), a service `nasq.notify.service` whose `_nasq_deliver(...)` replaces the three duplicated delivery helpers, and the generic `/api/v1/notifications` routes behind a registry-driven feature gate. `nasq_directory` (rank 3) owns `/api/v1/people` and the one "active internal user of the current company" population behind the same kind of gate. `nasq_pmo` keeps its producers, its task/digest/meeting kinds, their visibility and payloads and `/api/v1/notification-digests`, registering them through the two registries; meetings stay in `nasq_pmo` until phase 2b-2. A `pre-` migration in `nasq_pmo` 19.0.1.3.0 hands the generic column xml ids and the index row to `nasq_notify` after verifying that `nasq_notify` adopted the same rows.

**Tech Stack:** Odoo 19 Community (`/Users/tariq/code/odoo`, read-only), Python 3, PostgreSQL scratch databases, `tools/arch_policy.py`, `tools/git_policy.py`, `tools/migration_guard.py`, `tools/api_surface.py`, `tools/catalog_check.py`, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-05-nasq-reference-architecture-and-git-workflow-design.md` §2, §2.1, §3.2.1 and §3.6 (R10) are binding. Roadmap entry: `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, "المرحلة 2ب". Rulings for 2b-1 (controller, 2026-10-06) are folded into the Global Constraints below. Read the spec sections and the roadmap entry before starting.

## Deviations from rulings

Each item below is a place where a ruling is impossible or incomplete against the source, with the design used instead. The reviewer can reject any of them explicitly.

1. **H.2, "rename pre-migration with the same clash pre-check" cannot run as a rename.** `nasq_notify` is a new dependency of `nasq_pmo`, so `-u nasq_pmo` installs it (`ir_module.py` `button_upgrade` marks uninstalled dependencies `to install`) and the module graph loads it before `nasq_pmo`. Loading it already creates `nasq_notify.field_mail_message__nasq_notification*` xml ids for the very same `ir_model_fields` rows (upsert on `(model, name)`, `ir_model.py` `_reflect_fields`) and a second `ir_model_constraint` row for the index (`(name, module)` is the key, `_reflect_constraint`). A `pre-` script of `nasq_pmo` therefore always finds both xml ids: renaming would violate `ir_model_data`'s unique `(module, name)`, and Phase 2's clash pre-check ("both exist ⇒ stop") would stop every upgrade. A script in `nasq_notify` cannot run either (Odoo runs no migration for a module being installed), and a script in `nasq_api` would put application module names in the foundation (R2).
   **Design used:** `nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py` checks, before changing anything, that `nasq_notify` holds an xml id for every generic field row `nasq_pmo` holds and that both point at the same `(model, res_id)`, and that `nasq_notify` has its own row for the unique index. Any miss or mismatch stops the upgrade with a message (the "clash pre-check"). Only then does it delete `nasq_pmo`'s duplicate xml ids for the four fields `nasq_pmo` no longer declares (`nasq_notification`, `nasq_notification_key` on `mail_message` and on `mail_mail`) and `nasq_pmo`'s index row. The end state equals a rename: one owner (`nasq_notify`), the same `ir_model_fields` and `ir_model_fields_selection` row ids, untouched columns, index and data. Without the script Odoo's `_process_end` would reach the same end state, except that a field `nasq_notify` failed to declare would have its column dropped; the script turns that into a stopped upgrade. It is idempotent and does nothing on a fresh install.
2. **H.2, kind field ownership.** `nasq_pmo` keeps its own xml id on `nasq_notification_kind` (both models) because it extends that field with `selection_add`; Odoo gives every module that redefines a field an xml id (`field._modules`). The migration verifies `nasq_notify` adopted the kind field too but does not delete `nasq_pmo`'s xml id, and the twelve `selection__mail_message__nasq_notification_kind__*` xml ids stay `nasq_pmo`'s (Odoo names selection xml ids after the module that adds the value).
3. **H.2, descriptor keys.** The descriptor accepts an optional `'live': True`. The generic count needs to know which kinds are re-checked row by row (today the controller hard-codes `!= 'overdue_digest'`); without it the service would either name `overdue_digest` or scan every row in Python.
4. **H.2, `_nasq_deliver(model, res_id, kind, partners, body, key=None, values=None)`.** The signature is kept, but `key` is stored verbatim and is accepted only with one partner. The meetings helper keeps appending `:{partner.id}` itself and calls the service once per partner. Any other choice either changes the stored key format (the deadline cron and the digest would then send a second row on the first run after the upgrade) or makes the second partner hit the unique index and silently get nothing.
5. **H.2, behaviour change in meeting delivery.** `CyanMeetingMinute._nasq_notify_partners` today has no savepoint and no `IntegrityError` guard; after the collapse a concurrent duplicate meeting key is skipped instead of aborting the request. This is the task path's existing behaviour, now shared.
6. **H.3, value of the static `keys=` argument.** The documentation value is `('registry:nasq.notify.registry',)` for the bell and `('registry:nasq.directory',)` for the picker, not the application keys, so the shared services name no application. `tools/api_surface.py` learns to read the new decorator.
7. **H.8, fields outside `x-nasq` that necessarily change.** `tools/api_surface.py` derives each operation's `tags` and `operationId` from the addon and controller, and the top-level `tags` list from the set of addons. For the four moved operations those change too, and the top-level `tags` gain `nasq_directory` and `nasq_notify`. The comparison (Task 8) allows exactly these and asserts that exactly four operations changed.
8. **Module lists: catalog `base_modules` is not changed.** Odoo `-i` installs dependencies, so every composition that installs `nasq_pmo` gets both services; neither service owns a feature, so `tools/catalog_check.py` has nothing to check for them. The catalog's module list feeds the control-plane policy bytes and digests: about twenty files under `apps/control-plane/src/__tests__`, `packages/commercial-contracts` and `tools/test_managed_*.py` read the catalog, and several pin the exact list (for example `shared-onboarding-live.test.ts` expects `['nasq_core','nasq_platform','nasq_api','nasq_pmo']`, `worker-v2-policy.test.ts` expects the three base modules). Changing it belongs with phase 3 (packages, which installs every application anyway). Every other list named in the rulings is updated (Task 6). **Owner decision requested** (see the report).
9. **H.12, `hr` dependency.** Verified: no non-test code in `nasq_pmo` uses `hr` (only the stale manifest comment about `hr.employee.public`); the one test that creates an `hr.employee` (`test_personal_stages.test_people_minimal`) is a `/people` test and moves to `nasq_directory`, creating the employee only when `hr` is installed. `hr` is dropped from `nasq_pmo`'s `depends` (Task 2).
10. **Test technique for the shared services.** `nasq_notify` and `nasq_directory` must be testable without any application. Their tests register two probe kinds and a probe feature for one test at a time with `self.patch` (selection values on the field object, registry methods, feature registry) instead of a test-only addon: a new test addon would grow `arch_layers.json`'s `exempt` list (a weakening that needs the owner's trailer), and `nasq_registry_probe` cannot be installed beside `NasqApiCase` (`_nasq_initialize_legacy_policy` rejects unknown module ids). This departs from the `nasq-odoo-test` skill's "never mock Odoo internals" for these two addons only.
11. **Partial install.** Besides the ruled `nasq_core,nasq_platform,nasq_api,nasq_hr` run, the plan also runs `nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_hr`, which proves both services install and pass their tests without `project` or `cyan_meeting_minutes`.

**Inventory corrections found while reading the source:**

- `mail.mail` gets the delegated `nasq_*` fields as non-stored related fields; `nasq_notify` does create its own `field_mail_mail__*` xml ids during its load (an inherited field's `_modules` includes the target field's modules, `fields.py` `setup_related`), so the migration treats the six field xml ids uniformly.
- `nasq_pmo/controllers/people.py` and the `/notifications` routes have no docstrings, so `openapi.json` `summary` is the handler name. The moved handlers must keep no docstring, or `summary` (outside `x-nasq`) changes.
- `requires_feature(..., match='any')` raises the error of the **last** failing key. Today both the bell and the picker report `meetings.enabled` when both keys are off; the registries keep the order `pmo.enabled`, `meetings.enabled` so the error stays identical.
- Turning a feature off keeps reads open through `retained_read_features` (`_nasq_merge_retained`); a test that expects a 403 on a read route must write `retained_read_features` explicitly.
- The inventory's R7 numbers are right: `controllers/notifications.py` 7, `models/task_notifications.py` 8, `models/meeting_minute.py` 4. After this plan: `nasq_notify/models/notify_service.py` 7, `nasq_pmo/models/notification_types.py` 2, `task_notifications.py` 4, `meeting_minute.py` 2, the pmo controller 0, so the R7 total goes from 89 to 85. R10 goes from 2 to 0 (the two notification write routes now live in a rank-3 addon, which R10 does not scan). Nothing else changes.
- `/api/v1/me` `modules` is unchanged: neither service registers a module id, so `packages/contracts` and `apps/web` are not edited (ruling H.6 does not apply to 2b-1).

## Global Constraints

- No API surface change (ruling H.8): identical set of `(method, path)`, params and request/response schemas; `docs/api/openapi.json` is regenerated and the only allowed differences are in the `x-nasq` block (`addon`, `controller`, `contract_namespace`, `feature_keys`), plus the `tags`/`operationId` derived from them (Deviation 7). `openapi.json` is already stale on main: compare generated-before vs generated-after, not the committed file.
- Capability keys unchanged: the same 28 keys, owners and role grants.
- No new `sudo()` and no new SQL on Odoo tables: the R7 total (89) and R9 total (68) in `tools/arch_baseline.json` must not rise; moved code carries its counts. Expected after the plan: R7 85, R9 68, R10 0, every other rule unchanged.
- `tools/arch_layers.json` gets `nasq_notify: 3` and `nasq_directory: 3` (new addons only; no approval trailer). `tools/arch_baseline.json` is only written by `python3 -B tools/arch_policy.py --write-baseline`. Every commit leaves `python3 -B tools/arch_policy.py` at exit 0.
- Upgrade proof from the current `main` and from `release/19.0.1.0.0` (as CI does) keeps every notification row readable by the same recipients (Task 7).
- Tests pass on the full install and on the partial install `nasq_core,nasq_platform,nasq_api,nasq_hr` (green at main `350e7eb1`).
- `nasq_chat` is edited only for the attachment validator import. No new application names in `nasq_platform`. No edit under `packages/` or `apps/`.
- Scope: spec §3.2.1 item 1 (`nasq_notify`) and the `nasq_directory`/`nasq_files` decision of §2.1. The §3.2.1 acceptance items "`nasq_pmo` installs without `cyan_meeting_minutes`" and "`nasq_meetings` installs without `project`" belong to plan 2b-2; this plan's API acceptance is ruling H.8.
- Meetings stay in `nasq_pmo` during 2b-1 and keep producing through `nasq_notify`. `meeting_changed`/`meeting_cancelled` stay without an idempotency key (the key stays optional). `nasq_notify` declares an empty base `Selection`; applications add values with `selection_add`.
- The two shared services name no application: `rg -n "\b(project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(pmo|hr|chat|meetings)" odoo-addons/nasq_notify odoo-addons/nasq_directory --glob '!tests/**'` prints nothing.
- Versions (docs/migrations.md): `nasq_pmo` 19.0.1.2.0 → 19.0.1.3.0 with `migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py`; `nasq_notify` and `nasq_directory` start at 19.0.1.0.0; `nasq_api` and `nasq_chat` keep their versions (code-only changes).
- Every new Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.` Manifests use `'license': 'LGPL-3'`, `'author': 'Tariq Alwalidi'`, `'category': 'Hidden'`, `'installable': True`, `'application': False`. `ruff check odoo-addons` stays clean (EM101: assign exception messages to a variable first; COM812: trailing commas).
- Route handlers that move keep their names, parameters, `type='json2'`, `auth='user'`, methods and `readonly`, and get no docstring.
- Scratch databases are named `nasq_scratch_notify_*` (deploy/classification.py requires `nasq_*scratch*`); `/tmp/nasq-notify/odoo-run.sh` refuses any other name and any name containing `odoo19`. Never run anything against `odoo19`. Never point Odoo at a config whose `data_dir` or `logfile` is inside `/Users/tariq/code/odoo`. Do not upgrade any persistent database at an intermediate commit.
- Work only in `/Users/tariq/code/nasq-notify` on branch `codex/api-notify-directory`. Do not touch the main checkout's uncommitted owner changes (`.gitignore`, `docs/WORKSPACE.md`, `package.json`, `package-lock.json`, untracked `.agents/`, `.planning/`, `docs/e2e.md`, `e2e.config.ts`, `e2e/`, `plans/`).
- Commit subjects are `type(scope): subject`, at most 72 characters, scope from `core platform api pmo hr chat web cp deploy tools docs ci`. End each commit message with the attribution line your session specifies. Do not merge, push, delete branches or change Git config.
- A full eight-addon Odoo run takes 10–25 minutes. Start it with `run_in_background` and wait on the log; never shorten a run by dropping modules from `-i`.

## Review Focus

- **An upgraded database loses the bell columns, the index or rows because ownership moved without adoption** (`nasq_pmo` stops declaring a field that `nasq_notify` did not adopt, and `_process_end` drops the column). Expected: every `mail_message` bell column, the unique index, every `mail_notification` row, its read state and the twelve selection values survive; the upgrade stops before deleting anything when `nasq_notify` did not adopt a row. Pinned by `TestNotifyOwnershipMigration` (Task 5) and `notify_assert.py` (Task 7, both upgrade paths).
- **A recipient sees, counts or marks a notification for a task or meeting they can no longer read** (the generic service loses an application's visibility branch, or an empty branch turns into a match-all `Domain([])`). Expected: a row outside every owner branch is never listed, counted or marked; an empty branch raises; no branch means no rows. Pinned by `test_hidden_sources_are_not_listed_counted_or_marked`, `test_an_empty_branch_is_refused_and_no_branch_shows_nothing` (Task 4) and the existing `TestTaskNotifications`/`TestMeetingsApi` visibility tests, which run unchanged against the new routes.
- **The bell or the people picker loses its feature gate** (the registry returns nothing and the decorator lets the request through, or the key order changes the error). Expected: open while any owning feature is readable; 403 `feature_not_included` with `details.feature == 'meetings.enabled'` when both `pmo.enabled` and `meetings.enabled` are off; 403 with `details.feature is None` when no application registers. Pinned by `test_bell_and_people_stay_open_while_any_owner_feature_is_on` (Task 2, runs unchanged through Task 4), `test_route_is_closed_without_a_registered_feature` (Task 2) and `test_the_bell_is_closed_when_no_application_registers_a_type` (Task 4).
- **Duplicate delivery after collapsing the three helpers** (key format changes, the meeting per-partner suffix is lost, or a race inserts twice). Expected: keys are stored byte-identical to the pre-split format; a second cron or producer run creates nothing; a race loser is skipped and the transaction stays usable. Pinned by `test_delivery_keys_keep_their_pre_split_format` (Task 3), `test_a_concurrent_duplicate_key_is_skipped` (Task 3) and the re-delivery check in `notify_assert.py` (Task 7).
- **`nasq_pmo` imports from `nasq_chat` or the reverse, or a second copy of the validator survives.** Expected: both import `odoo.addons.nasq_api.serializers.attachment`; no other copy of `parse_*attachment*` exists except HR's deliberately different document parser. Pinned by `TestAttachmentUpload` (Task 1), the grep in Task 1 Step 6 and `arch_policy` R3 (stays 4, all web).

## File Structure

| File | Responsibility |
|---|---|
| `odoo-addons/nasq_api/serializers/attachment.py` (create) | The one attachment upload validator and wire shape |
| `odoo-addons/nasq_api/controllers/common.py` (modify) | `requires_registered_feature` next to `requires_feature`, sharing one check |
| `odoo-addons/nasq_api/tests/common.py`, `tests/__init__.py` (modify); `tests/test_attachment_upload.py` (create) | Probe-feature helpers for shared-service tests; validator tests |
| `odoo-addons/nasq_directory/**` (create) | `nasq.directory` (feature-key registry and people population) and `GET /api/v1/people` |
| `odoo-addons/nasq_notify/__manifest__.py`, `__init__.py`, `models/mail_message.py` (create) | Generic bell columns and the unique key index |
| `odoo-addons/nasq_notify/models/notify_registry.py` (create) | `nasq.notify.registry` descriptors and hooks |
| `odoo-addons/nasq_notify/models/notify_service.py` (create) | `nasq.notify.service`: delivery, recipient-scoped reads, read state |
| `odoo-addons/nasq_notify/controllers/notifications.py` (create) | `GET /api/v1/notifications`, `POST …/<id>/read`, `POST …/read-all` |
| `odoo-addons/nasq_notify/tests/**` (create) | Probe-based service and route tests |
| `odoo-addons/nasq_pmo/models/notification_types.py` (create) | PMO task, digest and meeting kinds: descriptors, visibility, row check, payload |
| `odoo-addons/nasq_pmo/models/directory.py` (create) | PMO's people-picker feature keys |
| `odoo-addons/nasq_pmo/models/mail_notification_nasq.py`, `task_notifications.py`, `meeting_minute.py` (modify) | PMO columns and producers on top of `nasq_notify` |
| `odoo-addons/nasq_pmo/controllers/notifications.py` (modify) | Only `/api/v1/notification-digests/<id>` |
| `odoo-addons/nasq_pmo/controllers/people.py`, `serializers/task_attachment.py` (delete) | Moved to `nasq_directory` and `nasq_api` |
| `odoo-addons/nasq_pmo/controllers/task_attachments.py`, `meeting_attachments.py`, `timeline.py`, `meeting_series.py` (modify) | Use the shared validator and the directory population |
| `odoo-addons/nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py` (create) | Ownership hand-over of the generic columns and index |
| `odoo-addons/nasq_pmo/__manifest__.py`, `models/__init__.py`, `controllers/__init__.py`, `tests/*` (modify/create) | Dependencies, version, tests |
| `odoo-addons/nasq_chat/serializers/chat.py`, `controllers/chat.py` (modify) | Import the shared validator; the copy is removed |
| `tools/api_surface.py` (modify), `tools/test_api_surface.py` (create) | Record the registry gate's documentation keys |
| `tools/arch_layers.json`, `tools/arch_baseline.json` (modify) | Ranks 3; regenerated baseline |
| `.woodpecker.yml`, `deploy/woodpecker/image.yml`, `deploy/provision.sh`, `deploy/check_isolated.py`, `deploy/test_operations.py`, `deploy/verification-checks.json`, `deploy/OPERATIONS.md`, `tools/check_cp1_scratch.py`, `tools/nasq_cli/operator.py`, `tools/shared_saas_lifecycle/odoo_effect.py`, `tools/shared_acceptance_live/up.sh` (modify) | Module lists |
| `docs/api/openapi.json` (regenerated), `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/parallel-work.md`, roadmap (modify) | Ownership text and phase status |

---

### Task 0: Worktree, scratch runner and baselines

**Files:**
- Create (outside the repo): `/tmp/nasq-notify/odoo-run.sh`, `/tmp/nasq-notify/scratch-only.conf`
- Create: `docs/superpowers/plans/2026-10-06-phase-2b1-notify-directory.md` (copy of this plan)

**Interfaces:**
- Produces: `/tmp/nasq-notify/odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | upgrade DB MODULES | shell DB ROOT | drop DB`, used by every later task; `/tmp/nasq-notify/openapi-before.json`; the baseline test logs `/tmp/nasq-notify/logs/nasq_scratch_notify_base.log` and `nasq_scratch_notify_partial_base.log`.

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/tariq/code/nasq
git fetch origin
git rev-parse main origin/main
git worktree add -b codex/api-notify-directory /Users/tariq/code/nasq-notify main
cd /Users/tariq/code/nasq-notify
git status --short
git log -1 --oneline
npm ci --ignore-scripts
```

Expected: empty status; `main` at `350e7eb1` or later (record the commit in your report). If `main` and `origin/main` differ, continue from local `main` and report it. Run every later command from `/Users/tariq/code/nasq-notify` unless a step says otherwise.

- [ ] **Step 2: Create the scratch directory, config and runner**

```bash
mkdir -p /tmp/nasq-notify/logs /tmp/nasq-notify/data /tmp/nasq-notify/classification
printf '[options]\nlist_db = False\n' > /tmp/nasq-notify/scratch-only.conf
cat > /tmp/nasq-notify/odoo-run.sh <<'RUNNER'
#!/usr/bin/env bash
# Phase 2b-1 scratch runner (plan 2026-10-06-phase-2b1-notify-directory.md).
# Every database must match nasq_scratch_notify_[a-z0-9_]+; odoo19 is never touched.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ODOO_ROOT=/Users/tariq/code/odoo
ODOO_PYTHON="$ODOO_ROOT/.venv/bin/python"
WORKTREE=/Users/tariq/code/nasq-notify
SCRATCH=/tmp/nasq-notify
CONF="$SCRATCH/scratch-only.conf"
HTTP_PORT=8199
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-tariq}"

die() { echo "odoo-run: $*" >&2; exit 2; }
guard_db() {
  [[ "$1" != *odoo19* ]] || die "refusing database '$1' (odoo19 is the development database)"
  [[ "$1" =~ ^nasq_scratch_notify_[a-z0-9_]+$ ]] || die "refusing database '$1' (scratch names match nasq_scratch_notify_[a-z0-9_]+)"
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
    dropdb --if-exists "$db"
    echo "ODOO_RUN_TEST_OK $db" ;;
  base)  # base DB ROOT MODULES: install an older checkout without tests; unclassified when it has no nasq_platform (as CI installs the release tag)
    db=$1 root=$2 modules=$3
    guard_db "$db"
    guard_root "$root"
    dropdb --if-exists "$db"
    if [[ -d "$root/odoo-addons/nasq_platform" ]]; then classify "$db"; else unset NASQ_COMMERCIAL_CONFIG; fi
    run_odoo "$db" "$root" "$SCRATCH/logs/$db-base.log" -i "$modules" --without-demo=all --stop-after-init
    echo "ODOO_RUN_BASE_OK $db" ;;
  upgrade)  # upgrade DB MODULES: upgrade with the worktree code exactly like CI
    db=$1 modules=$2
    guard_db "$db"
    classify "$db"
    run_odoo "$db" "$WORKTREE" "$SCRATCH/logs/$db-upgrade.log" -u "$modules" --stop-after-init
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
    die "usage: odoo-run.sh test DB MODULES TAGS | base DB ROOT MODULES | upgrade DB MODULES | shell DB ROOT | drop DB" ;;
esac
RUNNER
chmod +x /tmp/nasq-notify/odoo-run.sh
bash -n /tmp/nasq-notify/odoo-run.sh && echo runner-ok
/tmp/nasq-notify/odoo-run.sh drop odoo19 || echo "guard refused odoo19 as expected"
/tmp/nasq-notify/odoo-run.sh drop nasq_scratch_notify_odoo19_copy || echo "guard refused an odoo19 lookalike as expected"
/tmp/nasq-notify/odoo-run.sh drop nasq_test || echo "guard refused a non-scratch name as expected"
```

Expected: `runner-ok`, then three `odoo-run: refusing database ...` lines, each followed by its `guard refused ... as expected` line. The runner never removes files; it only drops scratch databases it guarded.

- [ ] **Step 3: Check the port and the database names are free**

```bash
lsof -nP -iTCP:8199 -sTCP:LISTEN || echo "port 8199 free"
psql -h 127.0.0.1 -U tariq -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'nasq_scratch_notify_%'"
```

Expected: `port 8199 free` and no database listed. If 8199 is taken, change `HTTP_PORT` in the runner to a free port and say so in your report.

- [ ] **Step 4: Commit this plan on the branch**

```bash
cp /Users/tariq/code/nasq/docs/superpowers/plans/2026-10-06-phase-2b1-notify-directory.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-06-phase-2b1-notify-directory.md
git commit -m "docs(docs): add the phase 2b-1 notify and directory plan"
```

The main checkout keeps an untracked copy of the same file; tell the orchestrator in the final report that it must be removed from the main checkout before the merge, or the merge refuses to overwrite it.

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

Expected: four `exit=0` lines (`CATALOG_OK solutions=2` before the last one) and totals `R1 0, R10 2, R2 8, R3 4, R4 0, R5 8, R6 0, R7 89, R8 1, R9 68`. Record them.

- [ ] **Step 6: Record the API surface baseline**

```bash
python3 -B tools/api_surface.py
cp docs/api/openapi.json /tmp/nasq-notify/openapi-before.json
git checkout -- docs/api/openapi.json
git status --short
```

Expected: `wrote docs/api/openapi.json: ...` and an empty status after the checkout.

- [ ] **Step 7: Run the full suite and the partial install once on the unmodified branch**

Start both in the background (`run_in_background`), one after the other on the same port is fine because each run is `--stop-after-init`; run them sequentially, not in parallel.

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_base \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_partial_base \
  nasq_core,nasq_platform,nasq_api,nasq_hr \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_base` and `ODOO_RUN_TEST_OK nasq_scratch_notify_partial_base`, each after a line `odoo.tests.result: 0 failed, 0 error(s) of N tests`. Record both N. If a run is not green, list the failures with `grep -E '(FAIL|ERROR): ' /tmp/nasq-notify/logs/<db>.log`; those are pre-existing and every later run is compared against that list, not against zero. Drop a kept database with `/tmp/nasq-notify/odoo-run.sh drop <db>`.

---

### Task 1: One attachment upload validator in nasq_api

**Files:**
- Create: `odoo-addons/nasq_api/serializers/attachment.py`
- Create: `odoo-addons/nasq_api/tests/test_attachment_upload.py`
- Modify: `odoo-addons/nasq_api/tests/__init__.py`
- Modify: `odoo-addons/nasq_pmo/controllers/task_attachments.py`, `odoo-addons/nasq_pmo/controllers/meeting_attachments.py`
- Delete: `odoo-addons/nasq_pmo/serializers/task_attachment.py`
- Modify: `odoo-addons/nasq_chat/serializers/chat.py:1-23,163-214`, `odoo-addons/nasq_chat/controllers/chat.py:16-24,175`
- Modify: `odoo-addons/nasq_pmo/tests/test_meetings.py`

**Interfaces:**
- Produces: `odoo.addons.nasq_api.serializers.attachment` with `MAX_ATTACHMENT_BYTES`, `MAX_ENCODED_CHARS`, `ALLOWED_MIMETYPES`, `GENERIC_MIMETYPE`, `UPLOAD_FIELDS`, `dump_attachment(attachment) -> dict` (`{id, name, mimetype, url}`) and `parse_attachment_upload(payload: dict) -> dict` (`{name, raw, mimetype, hinted_mimetype}`, raises `ApiError(422, 'invalid', ..., field=...)`). Byte-for-byte the behaviour of today's `parse_task_attachment_upload`/`dump_task_attachment`.

- [ ] **Step 1: Write the failing validator test**

Create `odoo-addons/nasq_api/tests/test_attachment_upload.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import io
import zipfile

from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_api.serializers.attachment import (
    MAX_ENCODED_CHARS,
    dump_attachment,
    parse_attachment_upload,
)

PDF = b'%PDF-1.7\nattachment fixture\n'
PNG = b'\x89PNG\r\n\x1a\n' + b'png fixture'
GIF = b'GIF89a' + bytes(10)
DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def ooxml_bytes(directory):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr(f'{directory}/document.xml', '<document/>')
    return stream.getvalue()


def upload(content, name='file.bin', mimetype=None):
    values = {'name': name, 'data': base64.b64encode(content).decode()}
    if mimetype is not None:
        values['mimetype'] = mimetype
    return values


@tagged('post_install', '-at_install', 'nasq')
class TestAttachmentUpload(TransactionCase):
    """The one upload validator shared by task, meeting and chat attachments."""

    def assertInvalid(self, values, field, message):
        with self.assertRaises(ApiError) as caught:
            parse_attachment_upload(values)
        error = caught.exception
        self.assertEqual((error.status, error.code, error.field, error.message), (422, 'invalid', field, message))

    def test_the_sniffed_bytes_decide_and_the_hint_is_only_checked(self):
        self.assertEqual(
            parse_attachment_upload(upload(PNG, name=' chart.png ', mimetype='application/octet-stream')),
            {'name': 'chart.png', 'raw': PNG, 'mimetype': 'image/png', 'hinted_mimetype': 'application/octet-stream'},
        )
        self.assertEqual(parse_attachment_upload(upload(PDF, mimetype='image/png'))['mimetype'], 'application/pdf')
        plain = parse_attachment_upload(upload(b'hello attachment'))
        self.assertEqual((plain['mimetype'], plain['hinted_mimetype']), ('text/plain', None))
        self.assertEqual(parse_attachment_upload(upload(ooxml_bytes('word')))['mimetype'], DOCX)
        self.assertEqual(parse_attachment_upload(upload(ooxml_bytes('xl')))['mimetype'], XLSX)

    def test_names_fields_and_hints_are_validated(self):
        self.assertInvalid({**upload(PDF), 'task_id': 1}, 'task_id', "field 'task_id' is not writable")
        self.assertInvalid(upload(PDF, name='  '), 'name', 'name must not be empty')
        self.assertInvalid(upload(PDF, name='a/b.pdf'), 'name', 'name must be a basename')
        self.assertInvalid(upload(PDF, name='..'), 'name', 'name must be a basename')
        self.assertInvalid(upload(PDF, mimetype=5), 'mimetype', 'mimetype must be a string')
        self.assertInvalid(upload(PDF, mimetype='text/html'), 'mimetype', 'mimetype is not allowed')

    def test_data_is_bounded_decoded_and_sniffed(self):
        self.assertInvalid({'name': 'a.pdf'}, 'data', 'data is required')
        self.assertInvalid({'name': 'a.pdf', 'data': '   '}, 'data', 'data is required')
        self.assertInvalid({'name': 'a.pdf', 'data': 'abc$'}, 'data', 'data must be valid base64')
        self.assertInvalid(
            {'name': 'a.pdf', 'data': 'A' * (MAX_ENCODED_CHARS + 4)}, 'data',
            'attachment data exceeds the encoded size limit',
        )
        self.assertInvalid({'name': 'a.pdf', 'data': 'A' * MAX_ENCODED_CHARS}, 'data', 'attachment exceeds 10MB')
        self.assertInvalid(upload(GIF, name='a.gif'), 'data', 'file type is not allowed')

    def test_dump_is_the_small_wire_shape(self):
        attachment = self.env['ir.attachment'].create({'name': 'brief.pdf', 'raw': PDF, 'mimetype': 'application/pdf'})
        self.assertEqual(dump_attachment(attachment), {
            'id': attachment.id,
            'name': 'brief.pdf',
            'mimetype': 'application/pdf',
            'url': f'/web/content/{attachment.id}?download=true',
        })
```

Add it to `odoo-addons/nasq_api/tests/__init__.py` so the file reads:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    common,
    test_access_admin,
    test_access_composition,
    test_attachment_upload,
    test_branding,
    test_commercial_surface,
    test_feature_route_coverage,
    test_me,
    test_pagination,
    test_totp,
)
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t1 nasq_core,nasq_platform,nasq_api /nasq_api:TestAttachmentUpload
```

Expected: the run dies with `tests failed or did not run`; the log shows `ModuleNotFoundError: No module named 'odoo.addons.nasq_api.serializers.attachment'`. Drop the kept database: `/tmp/nasq-notify/odoo-run.sh drop nasq_scratch_notify_t1`.

- [ ] **Step 3: Create the shared validator**

Create `odoo-addons/nasq_api/serializers/attachment.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one attachment upload validator and wire shape, shared by every
application that stores a user-uploaded file as a binary ``ir.attachment``.
HR documents keep their own, looser parser and shape."""
import base64
import binascii

from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.nasq_api.controllers.common import ApiError

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Four base64 characters encode three bytes. This is the largest canonical
# base64 representation that can contain exactly MAX_ATTACHMENT_BYTES.
MAX_ENCODED_CHARS = 4 * ((MAX_ATTACHMENT_BYTES + 2) // 3)
ALLOWED_MIMETYPES = frozenset({
    'text/plain',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})
GENERIC_MIMETYPE = 'application/octet-stream'
UPLOAD_FIELDS = frozenset({'name', 'mimetype', 'data'})


def dump_attachment(attachment):
    """Return the intentionally small wire shape for one attachment."""
    return {
        'id': attachment.id,
        'name': attachment.name,
        'mimetype': attachment.mimetype or '',
        'url': f'/web/content/{attachment.id}?download=true',
    }


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', 'name must not be empty', field='name')
    name = value.strip()
    if '\x00' in name or '/' in name or '\\' in name or name in {'.', '..'}:
        raise ApiError(422, 'invalid', 'name must be a basename', field='name')
    return name


def _parse_mimetype(value):
    if value in (None, False, ''):
        return None
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'mimetype must be a string', field='mimetype')
    mimetype = value.strip().lower()
    if mimetype not in ALLOWED_MIMETYPES and mimetype != GENERIC_MIMETYPE:
        raise ApiError(422, 'invalid', 'mimetype is not allowed', field='mimetype')
    return mimetype


def parse_attachment_upload(payload):
    extra = set(payload) - UPLOAD_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    name = _parse_name(payload.get('name'))
    hinted_mimetype = _parse_mimetype(payload.get('mimetype'))
    data = payload.get('data')
    if not isinstance(data, str) or not data.strip():
        raise ApiError(422, 'invalid', 'data is required', field='data')
    if len(data) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'attachment data exceeds the encoded size limit', field='data')
    cleaned = ''.join(data.split())
    if len(cleaned) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'attachment data exceeds the encoded size limit', field='data')
    try:
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, 'invalid', 'data must be valid base64', field='data') from None
    if not raw:
        raise ApiError(422, 'invalid', 'data must contain a non-empty file', field='data')
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, 'invalid', 'attachment exceeds 10MB', field='data')

    detected = (guess_mimetype(raw) or GENERIC_MIMETYPE).lower().split(';', 1)[0].strip()
    if detected not in ALLOWED_MIMETYPES:
        raise ApiError(422, 'invalid', 'file type is not allowed', field='data')
    # The client MIME is only a checked hint. The sniffed bytes decide the
    # server response so a filename or browser hint cannot make unsafe data
    # acceptable; application/octet-stream is the normal empty browser hint.
    return {
        'name': name,
        'raw': raw,
        'mimetype': detected,
        'hinted_mimetype': hinted_mimetype,
    }
```

- [ ] **Step 4: Point nasq_pmo at it and delete its copy**

Replace `odoo-addons/nasq_pmo/controllers/task_attachments.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    get_record,
    requires_feature,
)
from odoo.addons.nasq_api.serializers.attachment import (
    dump_attachment,
    parse_attachment_upload,
)


class TaskAttachmentController(http.Controller):

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_task_attachments(self, task_id):
        task = get_record('project.task', task_id)
        task._nasq_check_visible_current()
        attachments = task._nasq_task_attachments()
        for attachment in attachments:
            attachment.check_access('read')
        return {
            'items': [dump_attachment(attachment) for attachment in attachments],
            'total': len(attachments),
        }

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def upload_task_attachment(self, task_id, **payload):
        task = get_record('project.task', task_id)
        task._nasq_check_visible_current()
        if not task._nasq_can_write():
            raise AccessError(request.env._("You are not allowed to change this task."))
        task.check_access('write')
        payload.pop('task_id', None)
        values = parse_attachment_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': values['name'],
            'raw': values['raw'],
            'mimetype': values['mimetype'],
            'type': 'binary',
            'url': False,
            'public': False,
            'res_model': 'project.task',
            'res_id': task.id,
        })
        return request.make_json_response(dump_attachment(attachment), status=201)

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments/<int:attachment_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_task_attachment(self, task_id, attachment_id):
        task = get_record('project.task', task_id)
        task._nasq_check_visible_current()
        if not task._nasq_can_write():
            raise AccessError(request.env._("You are not allowed to change this task."))
        task.check_access('write')
        attachment = task._nasq_task_attachment(attachment_id)
        if not attachment:
            raise MissingError(request.env._(
                'Attachment %(attachment_id)s is not linked to task %(task_id)s',
                attachment_id=attachment_id,
                task_id=task_id,
            ))
        attachment.check_access('unlink')
        attachment.unlink()
        return request.make_json_response('', status=204)
```

Replace `odoo-addons/nasq_pmo/controllers/meeting_attachments.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    get_record,
    requires_feature,
)
from odoo.addons.nasq_api.serializers.attachment import (
    dump_attachment,
    parse_attachment_upload,
)


class MeetingAttachmentController(http.Controller):

    def _attachments(self, meeting):
        return request.env['ir.attachment'].search([
            ('res_model', '=', 'cyan.meeting.minute'),
            ('res_id', '=', meeting.id),
            ('type', '=', 'binary'),
        ])

    @http.route('/api/v1/meetings/<int:meeting_id>/attachments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def list_meeting_attachments(self, meeting_id):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        attachments = self._attachments(meeting)
        for attachment in attachments:
            attachment.check_access('read')
        return {'items': [dump_attachment(item) for item in attachments], 'total': len(attachments)}

    @http.route('/api/v1/meetings/<int:meeting_id>/attachments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def upload_meeting_attachment(self, meeting_id, **payload):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if not meeting.can_edit:
            raise AccessError(request.env._("You are not allowed to change this meeting."))
        payload.pop('meeting_id', None)
        values = parse_attachment_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': values['name'],
            'raw': values['raw'],
            'mimetype': values['mimetype'],
            'type': 'binary',
            'url': False,
            'public': False,
            'res_model': 'cyan.meeting.minute',
            'res_id': meeting.id,
        })
        return request.make_json_response(dump_attachment(attachment), status=201)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/attachments/<int:attachment_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def delete_meeting_attachment(self, meeting_id, attachment_id):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if not meeting.can_edit:
            raise AccessError(request.env._("You are not allowed to change this meeting."))
        attachment = self._attachments(meeting).filtered(lambda item: item.id == attachment_id)
        if not attachment:
            raise MissingError(request.env._("Attachment is not linked to this meeting."))
        attachment.check_access('unlink')
        attachment.unlink()
        return request.make_json_response('', status=204)
```

Then delete the old copy:

```bash
git rm odoo-addons/nasq_pmo/serializers/task_attachment.py
```

(`nasq_pmo/serializers/__init__.py` does not import it; no change there.)

- [ ] **Step 5: Point nasq_chat at it and delete its byte-identical copy**

In `odoo-addons/nasq_chat/serializers/chat.py` replace the header (lines 1-23):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo import fields
from odoo.tools import html2plaintext
from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_api.serializers.common import iso

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ENCODED_CHARS = 4 * ((MAX_ATTACHMENT_BYTES + 2) // 3)
ALLOWED_MIMETYPES = frozenset({
    'text/plain',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})
GENERIC_MIMETYPE = 'application/octet-stream'
UPLOAD_FIELDS = frozenset({'name', 'mimetype', 'data'})
```

with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tools import html2plaintext

from odoo.addons.nasq_api.serializers.common import iso
```

Then remove the parser copy at the end of the file (`_parse_name`, `_parse_mimetype`, `parse_chat_attachment`, everything after `dump_message`):

```bash
python3 - <<'PY'
from pathlib import Path

path = Path('odoo-addons/nasq_chat/serializers/chat.py')
text = path.read_text(encoding='utf-8')
head, marker, _copy = text.partition('\n\ndef _parse_name(value):\n')
assert marker, 'the parser copy was not found'
path.write_text(head + '\n', encoding='utf-8')
PY
tail -n 5 odoo-addons/nasq_chat/serializers/chat.py
```

Expected: the file ends with the closing `}` of `dump_message`'s return value.

In `odoo-addons/nasq_chat/controllers/chat.py` replace:

```python
from odoo.addons.nasq_chat.models.chat_service import MAX_LIMIT
from odoo.addons.nasq_chat.serializers.chat import (
    REACTION_CONTENTS,
    dump_attachment,
    dump_conversation,
    dump_member,
    dump_message,
    dump_user_ref,
    parse_chat_attachment,
)
```

with:

```python
from odoo.addons.nasq_api.serializers.attachment import parse_attachment_upload
from odoo.addons.nasq_chat.models.chat_service import MAX_LIMIT
from odoo.addons.nasq_chat.serializers.chat import (
    REACTION_CONTENTS,
    dump_attachment,
    dump_conversation,
    dump_member,
    dump_message,
    dump_user_ref,
)
```

and replace:

```python
        parsed = parse_chat_attachment(attachment_payload) if attachment_payload else None
```

with:

```python
        parsed = parse_attachment_upload(attachment_payload) if attachment_payload else None
```

(Chat keeps its own `dump_attachment`, whose `name or ''` differs from the shared shape.)

- [ ] **Step 6: Prove no copy and no cross-application import is left**

```bash
rg -n "def parse_(task_|chat_)?attachment|parse_task_attachment_upload|dump_task_attachment|parse_chat_attachment" odoo-addons
rg -n "odoo\.addons\.nasq_chat" odoo-addons/nasq_pmo; rg -n "odoo\.addons\.nasq_pmo" odoo-addons/nasq_chat
ruff check odoo-addons
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
```

Expected: the first command prints only `odoo-addons/nasq_api/serializers/attachment.py:…:def parse_attachment_upload(payload):`; the two cross-import searches print nothing; `All checks passed!`; `arch_policy exit=0`.

- [ ] **Step 7: Add a meeting upload test (the meeting route had no upload test)**

In `odoo-addons/nasq_pmo/tests/test_meetings.py` add `import base64` as the first import (above `from unittest.mock import patch`), and add this method to `TestMeetingsApi` after `test_patch_explicitly_clears_start_and_end`:

```python
    def test_meeting_attachment_upload_uses_the_shared_validator(self):
        self._grant_meeting_create()
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Attachment meeting', 'organizer_id': self.employee.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        url = f'/api/v1/meetings/{meeting.id}/attachments'
        created = self.api('POST', url, {
            'name': 'notes.txt', 'mimetype': 'text/plain',
            'data': base64.b64encode(b'meeting notes').decode(),
        })
        self.assertEqual(created.status_code, 201, created.text)
        item = created.json()
        self.assertEqual(set(item), {'id', 'name', 'mimetype', 'url'})
        self.assertEqual((item['name'], item['mimetype']), ('notes.txt', 'text/plain'))
        self.assertEqual(self.api('GET', url).json(), {'items': [item], 'total': 1})
        rejected = self.api('POST', url, {'name': 'x.gif', 'data': base64.b64encode(b'GIF89a' + bytes(10)).decode()})
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(rejected.json()['field'], 'data')
```

- [ ] **Step 8: Run the focused tests**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t1 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_api:TestAttachmentUpload,/nasq_pmo:TestTaskAttachments,/nasq_pmo:TestMeetingsApi,/nasq_chat
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t1`.

- [ ] **Step 9: Commit**

```bash
git add odoo-addons/nasq_api/serializers/attachment.py odoo-addons/nasq_api/tests/test_attachment_upload.py \
  odoo-addons/nasq_api/tests/__init__.py odoo-addons/nasq_pmo/controllers/task_attachments.py \
  odoo-addons/nasq_pmo/controllers/meeting_attachments.py odoo-addons/nasq_pmo/tests/test_meetings.py \
  odoo-addons/nasq_chat/serializers/chat.py odoo-addons/nasq_chat/controllers/chat.py
git commit -m "refactor(api): share one attachment upload validator"
```

(`git rm` already staged the deletion.)

---

### Task 2: Registry-driven feature gate and nasq_directory

**Files:**
- Modify: `odoo-addons/nasq_api/controllers/common.py:42-80`
- Modify: `odoo-addons/nasq_api/tests/common.py`
- Modify: `tools/api_surface.py:86-128`; Create: `tools/test_api_surface.py`
- Create: `odoo-addons/nasq_directory/__init__.py`, `__manifest__.py`, `models/__init__.py`, `models/directory.py`, `controllers/__init__.py`, `controllers/people.py`, `tests/__init__.py`, `tests/test_people.py`
- Create: `odoo-addons/nasq_pmo/models/directory.py`
- Modify: `odoo-addons/nasq_pmo/__manifest__.py`, `models/__init__.py`, `controllers/__init__.py`, `controllers/timeline.py:53-61`, `controllers/meeting_series.py:44-71`
- Delete: `odoo-addons/nasq_pmo/controllers/people.py`
- Modify: `odoo-addons/nasq_pmo/tests/test_personal_stages.py:23-32`, `tests/test_feature_enforcement.py`
- Modify: `tools/arch_layers.json`

**Interfaces:**
- Produces: `odoo.addons.nasq_api.controllers.common.requires_registered_feature(model: str, method: str, *, keys: tuple[str, ...], operation='write', match='any')` — decorator; resolves `request.env[model].<method>()` at request time; 403 `feature_not_included` with `details={'reason': 'feature', 'feature': None}` when it returns nothing; sets `_nasq_feature_keys = keys`, `_nasq_feature_operation`, `_nasq_feature_match`.
- Produces: `odoo.addons.nasq_api.tests.common.PROBE_FEATURE = 'test_probe.enabled'`, `register_probe_feature(case, key=PROBE_FEATURE)`, `set_probe_feature(case, key=PROBE_FEATURE, enabled=True, retained=False)`.
- Produces: model `nasq.directory` (AbstractModel, `_nasq_scope = 'global'`): `_nasq_directory_feature_keys() -> tuple[str, ...]` (composed through `super()`), `_nasq_people_domain() -> list`, `_nasq_search_people(query=None, limit=20) -> res.users`, `_nasq_people(user_ids) -> res.users`.
- Produces: `tools/api_surface.feature_metadata(fn: ast.FunctionDef) -> tuple[list[str], str | None]`.

- [ ] **Step 1: Pin today's gate of the bell and the picker (passes before and after)**

Add this method to `TestPmoFeatureEnforcement` in `odoo-addons/nasq_pmo/tests/test_feature_enforcement.py`:

```python
    def test_bell_and_people_stay_open_while_any_owner_feature_is_on(self):
        profile = self.env.ref('nasq_platform.tenant_profile')
        operator = profile.with_context(**{OPERATOR_CONTEXT: True})
        gated = ('pmo.enabled', 'meetings.enabled')
        # Switching a feature off keeps its reads open through
        # retained_read_features; drop both keys to test the closed gate.
        retained = [key for key in (profile.retained_read_features or []) if key not in gated]
        paths = ('/api/v1/notifications', '/api/v1/people')
        self.authenticate('api_emp', 'api_emp_pass_123')
        for path in paths:
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        operator.write({'features': {**profile.features, 'pmo.enabled': False}, 'retained_read_features': retained})
        for path in paths:
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        operator.write({
            'features': {**profile.features, 'pmo.enabled': False, 'meetings.enabled': False},
            'retained_read_features': retained,
        })
        for path in paths:
            response = self.api('GET', path)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()['code'], 'feature_not_included', path)
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'meetings.enabled'}, path)
```

Run it on the unmodified routes:

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t2 \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat /nasq_pmo:TestPmoFeatureEnforcement
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t2` — this pins the pre-split behaviour the moved routes must keep.

- [ ] **Step 2: Write the failing nasq_directory test**

Create `odoo-addons/nasq_directory/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_people
```

Create `odoo-addons/nasq_directory/tests/test_people.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_api.tests.common import (
    PROBE_FEATURE,
    NasqApiCase,
    register_probe_feature,
    set_probe_feature,
)


@tagged('post_install', '-at_install', 'nasq')
class TestPeopleDirectory(NasqApiCase):
    """/api/v1/people without any application: the gate is a probe feature for one test."""

    def setUp(self):
        super().setUp()
        self.patch(type(self.env['nasq.directory']), '_nasq_directory_feature_keys', lambda model: (PROBE_FEATURE,))
        register_probe_feature(self)
        set_probe_feature(self)

    def _user(self, login, groups='base.group_user', company=None, **values):
        company = company or self.env.company
        return new_test_user(
            self.env, login=login, name=values.pop('name', login), groups=groups,
            company_id=company.id, company_ids=[company.id], **values,
        )

    def test_the_directory_is_a_global_service(self):
        self.assertEqual(self.env['nasq.directory']._nasq_scope, 'global')

    def test_people_are_user_ids_even_when_an_employee_exists(self):
        if 'hr.employee' in self.env:
            self.env['hr.employee'].create({'name': 'Sara E', 'user_id': self.employee.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/people?q=sara').json()
        self.assertEqual(items, [{'id': self.employee.id, 'name': 'Sara', 'user_id': self.employee.id}])

    def test_bad_limit_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people?limit=abc')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'limit')

    def test_population_is_active_internal_users_of_the_current_company(self):
        kept = self._user('dir_kept', name='Dir kept')
        inactive = self._user('dir_inactive', name='Dir inactive')
        inactive.active = False
        portal = self._user('dir_portal', groups='base.group_portal', name='Dir portal')
        foreign = self._user('dir_foreign', company=self.env['res.company'].create({'name': 'Dir company B'}), name='Dir foreign')
        directory = self.env['nasq.directory']
        self.assertEqual(directory._nasq_people([kept.id, inactive.id, portal.id, foreign.id]), kept)
        self.assertEqual(directory._nasq_search_people('Dir ', limit=10), kept)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(
            self.api('GET', '/api/v1/people?q=Dir%20').json(),
            [{'id': kept.id, 'name': 'Dir kept', 'user_id': kept.id}],
        )

    def test_route_is_closed_without_a_registered_feature(self):
        self.patch(type(self.env['nasq.directory']), '_nasq_directory_feature_keys', lambda model: ())
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': None})

    def test_route_follows_the_registered_feature(self):
        set_probe_feature(self, enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': PROBE_FEATURE})
```

- [ ] **Step 3: Write the failing api_surface test**

Create `tools/test_api_surface.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import ast
import unittest

import api_surface

SOURCE = '''
class Probe:
    @route('/a', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('a.enabled', 'b.enabled', operation='read', match='any')
    def static_gate(self):
        return None

    @route('/b', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature('nasq.example', '_keys', keys=('registry:nasq.example',), operation='read')
    def registered_gate(self):
        return None

    @route('/c', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def row_level(self):
        return None
'''


class TestFeatureMetadata(unittest.TestCase):

    def test_both_gates_document_their_keys_and_operation(self):
        functions = {node.name: node for node in ast.walk(ast.parse(SOURCE)) if isinstance(node, ast.FunctionDef)}
        self.assertEqual(api_surface.feature_metadata(functions['static_gate']), (['a.enabled', 'b.enabled'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['registered_gate']), (['registry:nasq.example'], 'read'))
        self.assertEqual(api_surface.feature_metadata(functions['row_level']), ([], None))


if __name__ == '__main__':
    unittest.main()
```

Run it:

```bash
python3 -B -m unittest discover -s tools -p 'test_api_surface.py'
```

Expected: FAIL with `AttributeError: module 'api_surface' has no attribute 'feature_metadata'`.

- [ ] **Step 4: Teach api_surface the registry gate**

In `tools/api_surface.py`, add after `kw_const` (before `def api_version`):

```python
FEATURE_DECORATORS = ("requires_feature", "requires_registered_feature")


def feature_metadata(fn: ast.FunctionDef) -> tuple[list[str], str | None]:
    """Documented feature keys and operation of a route.

    ``requires_feature`` lists its keys as positional arguments.
    ``requires_registered_feature`` resolves its keys at request time and
    documents them in its ``keys=`` argument.
    """
    feature = next((d for d in fn.decorator_list if decorator_name(d) in FEATURE_DECORATORS), None)
    if not isinstance(feature, ast.Call):
        return [], None
    if decorator_name(feature) == "requires_feature":
        keys = [a.value for a in feature.args if isinstance(a, ast.Constant)]
    else:
        keys = next((const_strings(kw.value) for kw in feature.keywords if kw.arg == "keys"), [])
    return keys, kw_const(feature, "operation")
```

and in `extract_routes`, replace:

```python
                feature_keys: list[str] = []
                feature_operation = None
                feature = next((d for d in fn.decorator_list if decorator_name(d) == "requires_feature"), None)
                if isinstance(feature, ast.Call):
                    feature_keys = [a.value for a in feature.args if isinstance(a, ast.Constant)]
                    feature_operation = kw_const(feature, "operation")
```

with:

```python
                feature_keys, feature_operation = feature_metadata(fn)
```

Run:

```bash
python3 -B -m unittest discover -s tools -p 'test_api_surface.py'
python3 -B tools/api_surface.py && python3 -B - <<'PY'
import json
before = json.load(open('/tmp/nasq-notify/openapi-before.json'))
after = json.load(open('docs/api/openapi.json'))
assert before == after, 'refactor changed the generated document'
print('api_surface refactor is neutral')
PY
git checkout -- docs/api/openapi.json
```

Expected: `OK`, `wrote docs/api/openapi.json: ...`, `api_surface refactor is neutral`.

- [ ] **Step 5: Add requires_registered_feature to nasq_api**

In `odoo-addons/nasq_api/controllers/common.py`, replace the whole `requires_feature` function (lines 42-80) with:

```python
def _check_feature_args(operation, match):
    if operation not in ('read', 'write'):
        msg = 'requires_feature operation must be read or write'
        raise ValueError(msg)
    if match not in ('all', 'any'):
        msg = 'requires_feature match must be all or any'
        raise ValueError(msg)


def _feature_error(keys, operation, match):
    """The NasqAccessRule a feature gate raises for ``keys``, or None when the route may run.

    With ``match='any'`` the error of the last failing key is kept.
    """
    service = request.env['nasq.entitlement.service']
    check = service.require if operation == 'write' else service.require_read
    error = None
    for key in keys:
        try:
            check(key)
            if match == 'any':
                error = None
                break
        except NasqAccessRule as exc:
            error = exc
            if match == 'all':
                break
    return error


def _raise_feature_error(func, error):
    routing = getattr(func, 'routing', None) or {}
    if routing.get('type') == 'http':
        raise AccessError(error.message)
    raise error


def requires_feature(*keys, operation='write', match='all'):
    """Declare the entitlement key(s) a route needs. Default operation is write."""
    if not keys:
        msg = 'requires_feature keys are required'
        raise ValueError(msg)
    _check_feature_args(operation, match)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            error = _feature_error(keys, operation, match)
            if error:
                _raise_feature_error(func, error)
            return func(*args, **kwargs)
        wrapper._nasq_feature_keys = keys
        wrapper._nasq_feature_operation = operation
        wrapper._nasq_feature_match = match
        return wrapper
    return decorator


def requires_registered_feature(model, method, *, keys, operation='write', match='any'):
    """Gate a route on the feature keys that installed addons register at request time.

    ``request.env[model].<method>()`` returns those keys, so a shared service
    names no application. When nothing is registered the route answers 403
    ``feature_not_included``. ``keys`` only documents the gate: it is what
    tools/api_surface.py records and what the route-coverage test reads; it
    is never checked.
    """
    if not keys or not all(isinstance(key, str) and key for key in keys):
        msg = 'requires_registered_feature keys must document the gate'
        raise ValueError(msg)
    _check_feature_args(operation, match)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            registered = tuple(getattr(request.env[model], method)())
            if registered:
                error = _feature_error(registered, operation, match)
            else:
                error = NasqAccessRule(
                    'feature_not_included', 'this feature is not included', status=403,
                    details={'reason': 'feature', 'feature': None},
                )
            if error:
                _raise_feature_error(func, error)
            return func(*args, **kwargs)
        wrapper._nasq_feature_keys = tuple(keys)
        wrapper._nasq_feature_operation = operation
        wrapper._nasq_feature_match = match
        return wrapper
    return decorator
```

- [ ] **Step 6: Add the probe-feature helpers to the shared test fixture**

Replace `odoo-addons/nasq_api/tests/common.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, new_test_user

from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

# A test-only boolean feature for shared-service tests that must not depend on
# an application being installed. nasq_platform owns it, so it counts as
# installed wherever the test runs.
PROBE_FEATURE = 'test_probe.enabled'


def register_probe_feature(case, key=PROBE_FEATURE):
    """Add ``key`` to the feature registry for the length of one test."""
    env = case.env
    profile = env.ref('nasq_platform.tenant_profile')
    # Initialise the tenant before the registry grows: the one-shot legacy
    # policy validates the complete feature set and does not know the probe.
    profile._nasq_initialize_legacy_policy(env['nasq.feature.registry']._nasq_installed_module_ids())
    registry = type(env['nasq.feature.registry'])
    definitions = registry._nasq_feature_definitions
    probe = {'key': key, 'type': 'boolean', 'owner': 'nasq_platform', 'module': 'nasq_platform'}
    case.patch(registry, '_nasq_feature_definitions', lambda model: (*definitions(model), probe))


def set_probe_feature(case, key=PROBE_FEATURE, enabled=True, retained=False):
    """Switch a registered probe feature; ``retained`` keeps its reads open while it is off."""
    profile = case.env.ref('nasq_platform.tenant_profile')
    kept = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**(profile.features or {}), key: enabled},
        'retained_read_features': [*kept, key] if retained else kept,
    })


class NasqApiCase(HttpCase):
    """Shared HTTP fixture: the base nasq employee role plus a JSON ``api()`` helper.

    Holds nothing pillar-specific — a pillar addon subclasses this and adds
    its own records (see ``nasq_pmo/tests/common.py``) so the pillars never
    write to this file.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('nasq_platform.tenant_profile', raise_if_not_found=False)
        if profile:
            profile._nasq_initialize_legacy_policy(
                cls.env['nasq.feature.registry']._nasq_installed_module_ids(),
            )
        cls.employee = new_test_user(cls.env, login='api_emp', password='api_emp_pass_123',
                                     name='Sara', groups='nasq_core.group_employee')

    def api(self, method, path, json=None, timeout=None):
        headers = {'Content-Type': 'application/json'}
        kwargs = {} if timeout is None else {'timeout': timeout}
        return self.url_open(path, json=json, headers=headers, method=method, **kwargs)
```

- [ ] **Step 7: Create nasq_directory**

`odoo-addons/nasq_directory/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers, models
```

`odoo-addons/nasq_directory/__manifest__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Directory',
    'summary': 'nasq platform: the shared people picker — /api/v1/people (res.users ids)',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec 2.1, layer 2): it knows no application. nasq_api:
    # api_handler, the registry-driven feature gate and NasqApiCase. The
    # population is base res.users; an application that picks people
    # registers the feature keys that open the route in nasq.directory.
    'depends': ['nasq_api'],
    'installable': True,
    'application': False,
}
```

`odoo-addons/nasq_directory/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import directory
```

`odoo-addons/nasq_directory/models/directory.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqDirectory(models.AbstractModel):
    """The people picker: active internal users of the current company.

    Ids are ``res.users`` ids (the ``PersonRef`` contract), never HR employee
    ids. Every lookup runs in the caller's environment.
    """
    _name = 'nasq.directory'
    _description = 'Nasq people directory'
    _nasq_scope = 'global'

    @api.model
    def _nasq_directory_feature_keys(self):
        """Feature keys that open /api/v1/people, composed through super().

        Each application that picks people adds its own key; the route is
        open while any of them is readable.
        """
        return ()

    @api.model
    def _nasq_people_domain(self):
        return [
            ('active', '=', True),
            ('share', '=', False),
            ('company_ids', 'in', [self.env.company.id]),
        ]

    @api.model
    def _nasq_search_people(self, query=None, limit=20):
        domain = self._nasq_people_domain()
        if query:
            domain.append(('name', 'ilike', query))
        return self.env['res.users'].search(domain, order='name, id', limit=limit)

    @api.model
    def _nasq_people(self, user_ids):
        """The users among ``user_ids`` that belong to the picker population."""
        return self.env['res.users'].search([('id', 'in', list(user_ids)), *self._nasq_people_domain()])
```

`odoo-addons/nasq_directory/controllers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import people
```

`odoo-addons/nasq_directory/controllers/people.py` (the handler keeps no docstring, so the generated `summary` stays `list_people`):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    parse_nonneg_int,
    requires_registered_feature,
)

MAX_LIMIT = 50


class PeopleController(http.Controller):

    @http.route('/api/v1/people', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'nasq.directory', '_nasq_directory_feature_keys',
        keys=('registry:nasq.directory',), operation='read', match='any',
    )
    def list_people(self, **_):
        # json2 routes do not receive query-string params as kwargs; read them
        # from the raw request.
        args = request.httprequest.args
        limit = max(1, min(parse_nonneg_int(args.get('limit', 20), 'limit'), MAX_LIMIT))
        # A res.users lookup in the caller's environment, so a person-picking
        # user never traverses an HR employee access policy.
        users = request.env['nasq.directory']._nasq_search_people(args.get('q'), limit=limit)
        return [{'id': user.id, 'name': user.name, 'user_id': user.id} for user in users]
```

Register the rank in `tools/arch_layers.json`, so `ranks` reads:

```json
  "ranks": {
    "nasq_core": 0,
    "nasq_platform": 1,
    "nasq_api": 2,
    "nasq_directory": 3,
    "nasq_pmo": 4,
    "nasq_hr": 4,
    "nasq_chat": 4
  },
```

- [ ] **Step 8: Move the route out of nasq_pmo and register PMO's keys**

```bash
git rm odoo-addons/nasq_pmo/controllers/people.py
```

In `odoo-addons/nasq_pmo/controllers/__init__.py` delete the line `    people,`.

Create `odoo-addons/nasq_pmo/models/directory.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqPmoDirectory(models.AbstractModel):
    _inherit = 'nasq.directory'

    @api.model
    def _nasq_directory_feature_keys(self):
        # Projects and meetings both pick people. Keep this order: with both
        # keys off the gate reports the last one, as it did before the move.
        # meetings.enabled moves to nasq_meetings in phase 2b-2.
        return (*super()._nasq_directory_feature_keys(), 'pmo.enabled', 'meetings.enabled')
```

In `odoo-addons/nasq_pmo/models/__init__.py` add `    directory,` after `    access_service,`.

In `odoo-addons/nasq_pmo/controllers/timeline.py` replace:

```python
    def _mentioned_users(self, ids):
        # Same population as the /api/v1/people picker, in the caller's environment.
        users = request.env['res.users'].search([
            ('id', 'in', ids), ('active', '=', True), ('share', '=', False),
            ('company_ids', 'in', [request.env.company.id]),
        ])
```

with:

```python
    def _mentioned_users(self, ids):
        # Same population as the /api/v1/people picker, in the caller's environment.
        users = request.env['nasq.directory']._nasq_people(ids)
```

In `odoo-addons/nasq_pmo/controllers/meeting_series.py` replace:

```python
def _validate_internal_user(user_id, field):
    parsed = parse_positive_int(user_id, field)
    user = request.env['res.users'].search([
        ('id', '=', parsed),
        ('active', '=', True),
        ('share', '=', False),
        ('company_ids', 'in', [request.env.company.id]),
    ], limit=1)
    if not user:
        raise ApiError(422, 'invalid', '%s must be an active internal user in the current company' % field, field=field)
    return parsed
```

with:

```python
def _validate_internal_user(user_id, field):
    parsed = parse_positive_int(user_id, field)
    if not request.env['nasq.directory']._nasq_people([parsed]):
        raise ApiError(422, 'invalid', '%s must be an active internal user in the current company' % field, field=field)
    return parsed
```

and replace:

```python
    users = request.env['res.users'].search([
        ('id', 'in', parsed),
        ('active', '=', True),
        ('share', '=', False),
        ('company_ids', 'in', [request.env.company.id]),
    ])
    if set(users.ids) != set(parsed):
```

with:

```python
    users = request.env['nasq.directory']._nasq_people(parsed)
    if set(users.ids) != set(parsed):
```

In `odoo-addons/nasq_pmo/tests/test_personal_stages.py` delete the two moved tests (`test_people_minimal` and `test_people_bad_limit_is_422`, lines 23-32), so the class keeps `test_personal_stages_created_on_first_call` and `test_projects_minimal`.

Replace `odoo-addons/nasq_pmo/__manifest__.py` with (drops `hr`, which no non-test code uses; adds `nasq_directory`):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq PMO',
    'summary': 'nasq platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages)',
    'version': '19.0.1.2.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: shared api_handler/ApiError, the iso() serializer helper, the
    # shared attachment validator and NasqApiCase.
    # nasq_platform: the pre-backfill migration reads nasq.tenant.profile, and a
    # `-u nasq_pmo` must install it directly instead of relying on the caller to
    # upgrade nasq_api as well.
    # nasq_directory: /api/v1/people and its population; nasq_pmo registers the
    # feature keys that open it.
    # project: _inherit'd model and CLOSED_STATES. mail: message_post /
    # _message_post_after_hook in the timeline. bus: bus.bus in the task notifier.
    # nasq_pmo owns the pmo.* and meetings.* capabilities, their groups, the
    # pmo_manager role and the meeting record rules (spec R2); the meeting part
    # moves to nasq_meetings in phase 2b-2.
    'depends': ['nasq_api', 'nasq_platform', 'nasq_directory', 'project', 'mail', 'bus', 'cyan_meeting_minutes'],
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

- [ ] **Step 9: Static checks**

```bash
ruff check odoo-addons
python3 -B tools/arch_policy.py; echo "arch_policy exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy base exit=$?"
rg -n "\b(project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(pmo|hr|chat|meetings)" odoo-addons/nasq_directory --glob '!tests/**' || echo "nasq_directory names no application"
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
```

Expected: `All checks passed!`; both `exit=0` (adding a rank is not a weakening); `nasq_directory names no application`; the tools suite ends with `OK`.

- [ ] **Step 10: Run the focused tests on the full and the shared-only install**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t2 \
  nasq_core,nasq_platform,nasq_api,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_directory,/nasq_api,/nasq_pmo:TestPersonalStagesAndLookups,/nasq_pmo:TestMeetingPeopleApi,/nasq_pmo:TestTimeline,/nasq_pmo:TestMeetingSeries,/nasq_pmo:TestPmoFeatureEnforcement
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t2_shared \
  nasq_core,nasq_platform,nasq_api,nasq_directory,nasq_hr \
  /nasq_api,/nasq_directory
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t2` and `ODOO_RUN_TEST_OK nasq_scratch_notify_t2_shared` (the second proves `nasq_directory` installs and passes without `project`).

- [ ] **Step 11: Commit**

```bash
git add odoo-addons/nasq_api/controllers/common.py odoo-addons/nasq_api/tests/common.py \
  odoo-addons/nasq_directory tools/api_surface.py tools/test_api_surface.py tools/arch_layers.json \
  odoo-addons/nasq_pmo/__manifest__.py odoo-addons/nasq_pmo/models/__init__.py odoo-addons/nasq_pmo/models/directory.py \
  odoo-addons/nasq_pmo/controllers/__init__.py odoo-addons/nasq_pmo/controllers/timeline.py \
  odoo-addons/nasq_pmo/controllers/meeting_series.py odoo-addons/nasq_pmo/tests/test_personal_stages.py \
  odoo-addons/nasq_pmo/tests/test_feature_enforcement.py
git commit -m "feat(api): move the people picker to nasq_directory"
```

---

### Task 3: nasq_notify delivery and type registry; nasq_pmo producers on top of it

**Files:**
- Create: `odoo-addons/nasq_notify/__init__.py`, `__manifest__.py`, `models/__init__.py`, `models/mail_message.py`, `models/notify_registry.py`, `models/notify_service.py`, `tests/__init__.py`, `tests/common.py`, `tests/test_notify_service.py`
- Create: `odoo-addons/nasq_pmo/models/notification_types.py`
- Modify: `odoo-addons/nasq_pmo/models/mail_notification_nasq.py`, `models/task_notifications.py:1-12,101-141,153-190`, `models/meeting_minute.py:7,62-92`, `models/__init__.py`, `__manifest__.py`
- Modify: `odoo-addons/nasq_pmo/tests/test_notifications.py`
- Modify: `tools/arch_layers.json`, `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Consumes: nothing from Tasks 1-2 except the module list.
- Produces: `mail.message` fields `nasq_notification` (Boolean), `nasq_notification_kind` (Selection, empty base), `nasq_notification_key` (Char) and index `mail_message_nasq_notification_key_unique`, declared by `nasq_notify` (still also declared by `nasq_pmo` until Task 5).
- Produces: `nasq.notify.registry` (AbstractModel, `_nasq_scope='global'`): `_nasq_notification_types() -> tuple[dict]` (composed through `super()`; dict keys `kind`, `owner`, `model`, `feature_key`, optional `live`), `_nasq_notification_type_map() -> dict[str, dict]` (raises `ValidationError`), `_nasq_notify_feature_keys() -> tuple[str, ...]` (registration order, unique), `_nasq_notify_live_kinds() -> tuple[str, ...]`.
- Produces: `nasq.notify.service` (AbstractModel, `_nasq_scope='global'`): `_nasq_key_taken(key) -> bool`, `_nasq_deliver(model: str, res_id: int, kind: str, partners: res.partner, body: str, key: str | None = None, values: dict | None = None) -> mail.message` (raises `ValueError` for an unregistered kind, a generic column in `values`, or a key with several partners).
- Produces: `odoo.addons.nasq_notify.tests.common.PROBE_KINDS`, `PROBE_TYPES`, `NotifyProbe._install_probe()`.
- Produces: `odoo.addons.nasq_pmo.models.notification_types.TASK_KINDS`, `DIGEST_KIND`, `MEETING_KINDS`; classes `NasqPmoTaskNotificationTypes`, `NasqPmoMeetingNotificationTypes`. Unchanged public helpers: `project.task._nasq_create_notification(*, kind, partner, body, key=None)`, `project.task._nasq_create_digest_notification(*, company, partner, body, key, overdue_count, local_date, task_ids=())`, `cyan.meeting.minute._nasq_notify_partners(partners, kind, body, key=None)`.

- [ ] **Step 1: Write the failing PMO tests (registration and key format)**

Add to `TestTaskNotifications` in `odoo-addons/nasq_pmo/tests/test_notifications.py`:

```python
    def test_pmo_registers_its_notification_kinds(self):
        registry = self.env['nasq.notify.registry']
        types = registry._nasq_notification_type_map()
        pmo = [kind for kind, item in types.items() if item['owner'] == 'nasq_pmo']
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
        self.assertEqual(registry._nasq_notify_live_kinds(), ('overdue_digest',))
        self.assertEqual(registry._nasq_notify_feature_keys(), ('pmo.enabled', 'meetings.enabled'))
        self.assertEqual(self.env['mail.message']._fields['nasq_notification_kind'].get_values(self.env), pmo)

    def test_delivery_keys_keep_their_pre_split_format(self):
        Message = self.env['mail.message'].sudo()
        Task = self.env['project.task']
        now = fields.Datetime.now()
        task = Task.create({
            'name': 'Key format', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id)], 'date_deadline': now + timedelta(hours=6),
        })
        Task._nasq_run_deadline_notifications(now=now)
        Task._nasq_run_deadline_notifications(now=now)
        deadline = fields.Datetime.to_string(task.date_deadline)
        self.assertEqual(
            Message.search([('nasq_notification_kind', '=', 'deadline'), ('nasq_task_id', '=', task.id)]).mapped('nasq_notification_key'),
            [f'deadline:{task.id}:{self.other.partner_id.id}:{deadline}'],
        )
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Key format meeting', 'organizer_id': self.manager.id,
        })
        partners = self.other.partner_id | self.employee.partner_id
        expected = sorted(f'meeting-invite:{meeting.id}:{partner.id}' for partner in partners)
        meeting._nasq_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        count = Message.search_count([('nasq_meeting_id', '=', meeting.id)])
        meeting._nasq_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        self.assertEqual(Message.search_count([('nasq_meeting_id', '=', meeting.id)]), count)
        self.assertEqual(sorted(Message.search([('nasq_notification_key', 'in', expected)]).mapped('nasq_notification_key')), expected)
        meeting._nasq_notify_partners(self.other.partner_id, 'meeting_changed', 'Moved')
        meeting._nasq_notify_partners(self.other.partner_id, 'meeting_changed', 'Moved')
        changed = Message.search([('nasq_meeting_id', '=', meeting.id), ('nasq_notification_kind', '=', 'meeting_changed')])
        self.assertEqual(len(changed), 2, 'meeting_changed has no idempotency key')
        self.assertEqual(set(changed.mapped('nasq_notification_key')), {False})
        key = f'overdue_digest:{self.env.company.id}:{self.manager.partner_id.id}:2026-01-02'
        for _attempt in range(2):
            Task._nasq_create_digest_notification(
                company=self.env.company, partner=self.manager.partner_id, body='1 overdue tasks',
                key=key, overdue_count=1, local_date='2026-01-02',
            )
        self.assertEqual(Message.search_count([('nasq_notification_key', '=', key)]), 1)
```

`test_delivery_keys_keep_their_pre_split_format` passes on today's code (it pins the format); `test_pmo_registers_its_notification_kinds` fails until the registry exists.

- [ ] **Step 2: Write the failing nasq_notify tests**

`odoo-addons/nasq_notify/tests/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import common, test_notify_service
```

`odoo-addons/nasq_notify/tests/common.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only notification types for nasq_notify's own tests.

nasq_notify knows no application, so its tests register two probe kinds on
``res.partner`` rows for the length of one test: the kinds are added to the
selection field and the registry is replaced with ``self.patch``, which also
hides every installed application's types. The tests behave the same with
or without an application installed.
"""
from odoo.addons.nasq_api.tests.common import PROBE_FEATURE

PROBE_KINDS = (('probe_ping', 'Probe ping'), ('probe_live', 'Probe live'))
PROBE_TYPES = (
    {'kind': 'probe_ping', 'owner': 'nasq_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE},
    {'kind': 'probe_live', 'owner': 'nasq_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE, 'live': True},
)


class NotifyProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``."""

    def _install_probe(self):
        field = self.env['mail.message']._fields['nasq_notification_kind']
        self.patch(field, 'selection', [*field.selection, *PROBE_KINDS])
        self.patch(field, '_selection', {**(field._selection or {}), **dict(PROBE_KINDS)})
        self.patch(type(self.env['nasq.notify.registry']), '_nasq_notification_types', lambda model: PROBE_TYPES)
```

`odoo-addons/nasq_notify/tests/test_notify_service.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.nasq_api.tests.common import PROBE_FEATURE
from odoo.addons.nasq_notify.tests.common import PROBE_TYPES, NotifyProbe


@tagged('post_install', '-at_install', 'nasq')
class TestNotifyService(NotifyProbe, TransactionCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.reader = new_test_user(self.env, login='notify_reader', name='Reader', groups='base.group_user')
        self.other = new_test_user(self.env, login='notify_other', name='Other', groups='base.group_user')
        self.sources = self.env['res.partner'].create([{'name': f'Notify source {index}'} for index in range(3)])
        self.service = self.env['nasq.notify.service']
        self.registry_model = type(self.env['nasq.notify.registry'])

    def _deliver(self, source, partners, kind='probe_ping', key=None, values=None):
        return self.service._nasq_deliver(
            'res.partner', source.id, kind, partners, f'About {source.name}', key=key, values=values,
        )

    def test_services_are_global(self):
        self.assertEqual(self.env['nasq.notify.service']._nasq_scope, 'global')
        self.assertEqual(self.env['nasq.notify.registry']._nasq_scope, 'global')

    def test_registry_keeps_registration_order(self):
        registry = self.env['nasq.notify.registry']
        self.assertEqual(list(registry._nasq_notification_type_map()), ['probe_ping', 'probe_live'])
        self.assertEqual(registry._nasq_notify_feature_keys(), (PROBE_FEATURE,))
        self.assertEqual(registry._nasq_notify_live_kinds(), ('probe_live',))
        self.patch(self.registry_model, '_nasq_notification_types', lambda model: (
            {**PROBE_TYPES[0], 'feature_key': 'b.enabled'},
            {**PROBE_TYPES[1], 'feature_key': 'a.enabled'},
        ))
        self.assertEqual(registry._nasq_notify_feature_keys(), ('b.enabled', 'a.enabled'))

    def test_registry_refuses_bad_descriptors(self):
        registry = self.env['nasq.notify.registry']
        cases = (
            ((PROBE_TYPES[0], PROBE_TYPES[0]), 'duplicate notification kind probe_ping'),
            (({**PROBE_TYPES[0], 'feature_key': ''},), 'probe_ping is missing feature_key'),
            (({**PROBE_TYPES[0], 'kind': 'probe_unknown'},), 'probe_unknown is not a mail.message selection value'),
            (({**PROBE_TYPES[0], 'kind': None},), 'missing a kind'),
        )
        for types, message in cases:
            with self.subTest(message=message):
                self.patch(self.registry_model, '_nasq_notification_types', lambda model, types=types: types)
                with self.assertRaisesRegex(ValidationError, message):
                    registry._nasq_notification_type_map()

    def test_delivery_creates_one_inbox_row_per_partner_and_no_mail(self):
        source = self.sources[0]
        partners = self.reader.partner_id | self.other.partner_id
        messages = self._deliver(source, partners)
        self.assertEqual(len(messages), 2)
        for message in messages:
            self.assertEqual((message.model, message.res_id), ('res.partner', source.id))
            self.assertTrue(message.nasq_notification)
            self.assertEqual(message.nasq_notification_kind, 'probe_ping')
            self.assertFalse(message.nasq_notification_key)
            self.assertEqual((message.message_type, message.is_internal), ('notification', True))
            self.assertEqual(message.subtype_id, self.env.ref('mail.mt_note'))
            self.assertIn(f'About {source.name}', message.body)
        rows = messages.notification_ids
        self.assertEqual(len(rows), 2)
        self.assertEqual(sorted(rows.res_partner_id.ids), sorted(partners.ids))
        self.assertTrue(all(
            row.notification_type == 'inbox' and row.notification_status == 'sent' and not row.mail_mail_id
            for row in rows
        ))

    def test_a_key_delivers_once_and_is_stored_verbatim(self):
        key = f'probe:{self.sources[0].id}:{self.reader.partner_id.id}'
        first = self._deliver(self.sources[0], self.reader.partner_id, key=key)
        second = self._deliver(self.sources[0], self.reader.partner_id, key=key)
        self.assertEqual(first.nasq_notification_key, key)
        self.assertFalse(second)
        self.assertEqual(self.env['mail.message'].sudo().search_count([('nasq_notification_key', '=', key)]), 1)

    @mute_logger('odoo.sql_db')
    def test_a_concurrent_duplicate_key_is_skipped(self):
        key = f'probe-race:{self.reader.partner_id.id}'
        self._deliver(self.sources[0], self.reader.partner_id, key=key)
        # A second worker passed the pre-check before the first one committed.
        self.patch(type(self.service), '_nasq_key_taken', lambda model, key: False)
        self.assertFalse(self._deliver(self.sources[0], self.reader.partner_id, key=key))
        self.assertEqual(self.env['mail.message'].sudo().search_count([('nasq_notification_key', '=', key)]), 1)
        self.assertEqual(len(self._deliver(self.sources[1], self.reader.partner_id)), 1, 'the transaction stays usable')

    def test_delivery_refuses_unknown_kinds_shared_keys_and_generic_values(self):
        with self.assertRaisesRegex(ValueError, "kind 'probe_unknown' is not registered"):
            self._deliver(self.sources[0], self.reader.partner_id, kind='probe_unknown')
        with self.assertRaisesRegex(ValueError, 'a delivery key names one recipient'):
            self._deliver(self.sources[0], self.reader.partner_id | self.other.partner_id, key='probe:shared')
        with self.assertRaisesRegex(ValueError, r"values may not set \['model'\]"):
            self._deliver(self.sources[0], self.reader.partner_id, values={'model': 'res.users'})
        self.assertFalse(self.env['mail.message'].sudo().search_count([
            ('nasq_notification', '=', True), ('model', '=', 'res.partner'), ('res_id', 'in', self.sources.ids),
        ]))

    def test_values_carry_the_owner_columns(self):
        message = self._deliver(self.sources[0], self.reader.partner_id, values={'subject': 'Owner column'})
        self.assertEqual(message.subject, 'Owner column')
```

- [ ] **Step 3: Create the nasq_notify addon (columns, registry, delivery)**

`odoo-addons/nasq_notify/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import models
```

`odoo-addons/nasq_notify/__manifest__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Notify',
    'summary': 'nasq platform: the shared notification bell — delivery, type registry, /api/v1/notifications',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec 2.1, layer 2): it knows no application. Each
    # application registers its notification kinds in nasq.notify.registry.
    # nasq_api: api_handler, the registry-driven feature gate and NasqApiCase.
    # mail: a bell row is a mail.message plus an inbox mail.notification.
    'depends': ['nasq_api', 'mail'],
    'installable': True,
    'application': False,
}
```

`odoo-addons/nasq_notify/models/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import mail_message, notify_registry, notify_service
```

`odoo-addons/nasq_notify/models/mail_message.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqNotifyMailMessage(models.Model):
    """A bell row is a ``mail.message`` with these columns plus one inbox ``mail.notification``.

    The kind selection is empty here: each application adds its kinds with
    ``selection_add`` and registers them in ``nasq.notify.registry``. Names,
    labels and the index keep what nasq_pmo created, so upgraded databases
    keep every row.
    """
    _inherit = 'mail.message'

    nasq_notification = fields.Boolean('nasq Notification', index=True, copy=False)
    nasq_notification_kind = fields.Selection([], string='nasq Notification Kind', copy=False, index=True)
    nasq_notification_key = fields.Char('nasq Notification Key', copy=False, index=True)

    _nasq_notification_key_unique = models.UniqueIndex(
        '(nasq_notification_key) WHERE nasq_notification_key IS NOT NULL',
    )
```

`odoo-addons/nasq_notify/models/notify_registry.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

TYPE_FIELDS = ('owner', 'model', 'feature_key')


class NasqNotifyRegistry(models.AbstractModel):
    """Notification types, composed through ``super()`` like ``nasq.feature.registry``.

    nasq_notify knows no application: each application that sends bell rows
    extends this model with its kinds.
    """
    _name = 'nasq.notify.registry'
    _description = 'Nasq notification type registry'
    _nasq_scope = 'global'

    @api.model
    def _nasq_notification_types(self):
        """Pure descriptors ``{'kind', 'owner', 'model', 'feature_key'}``; never a process-global set.

        ``'live': True`` marks a kind whose rows are re-checked one by one.
        The kind is a value its owner added to
        ``mail.message.nasq_notification_kind`` with ``selection_add``.
        """
        return ()

    @api.model
    def _nasq_notification_type_map(self):
        values = set(self.env['mail.message']._fields['nasq_notification_kind'].get_values(self.env))
        types = {}
        for item in self._nasq_notification_types():
            kind = item.get('kind')
            if not kind or not isinstance(kind, str):
                raise ValidationError(self.env._('nasq_notify: a notification type is missing a kind'))
            if kind in types:
                raise ValidationError(self.env._(
                    'nasq_notify: duplicate notification kind %(kind)s', kind=kind,
                ))
            for name in TYPE_FIELDS:
                if not item.get(name) or not isinstance(item[name], str):
                    raise ValidationError(self.env._(
                        'nasq_notify: notification kind %(kind)s is missing %(name)s', kind=kind, name=name,
                    ))
            if kind not in values:
                raise ValidationError(self.env._(
                    'nasq_notify: notification kind %(kind)s is not a mail.message selection value', kind=kind,
                ))
            types[kind] = item
        return types

    @api.model
    def _nasq_notify_feature_keys(self):
        """Feature keys of the registered types, in registration order, each once."""
        keys = []
        for item in self._nasq_notification_type_map().values():
            if item['feature_key'] not in keys:
                keys.append(item['feature_key'])
        return tuple(keys)

    @api.model
    def _nasq_notify_live_kinds(self):
        return tuple(kind for kind, item in self._nasq_notification_type_map().items() if item.get('live'))
```

`odoo-addons/nasq_notify/models/notify_service.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import api, models
from odoo.tools import plaintext2html

# The columns this service writes itself. ``values`` carries only the
# producing application's own mail.message columns.
GENERIC_VALUES = frozenset({
    'model', 'res_id', 'nasq_notification', 'nasq_notification_kind', 'nasq_notification_key',
    'message_type', 'is_internal', 'author_id', 'subtype_id', 'body', 'partner_ids',
})


class NasqNotifyService(models.AbstractModel):
    """Bell rows: a ``mail.message`` flagged ``nasq_notification`` plus one inbox
    ``mail.notification`` per recipient.

    Documented elevated operations (CLAUDE.md, R7): delivery creates the
    message and its inbox row as superuser, because the recipient, not the
    actor, owns the row.
    """
    _name = 'nasq.notify.service'
    _description = 'Nasq notification service'
    _nasq_scope = 'global'

    @api.model
    def _nasq_key_taken(self, key):
        return bool(self.env['mail.message'].sudo().search_count(
            [('nasq_notification_key', '=', key)], limit=1,
        ))

    @api.model
    def _nasq_deliver(self, model, res_id, kind, partners, body, key=None, values=None):
        """Create one bell row per partner on ``model``/``res_id`` and return the new messages.

        ``key`` makes delivery idempotent. It is stored verbatim, so it names
        its single recipient: a key with several partners is refused. A key
        that exists, or that a concurrent worker inserts first, creates nothing.
        """
        if kind not in self.env['nasq.notify.registry']._nasq_notification_type_map():
            msg = f'nasq_notify: notification kind {kind!r} is not registered'
            raise ValueError(msg)
        extra = dict(values or {})
        clash = sorted(GENERIC_VALUES & set(extra))
        if clash:
            msg = f'nasq_notify: values may not set {clash}'
            raise ValueError(msg)
        if key and len(partners) > 1:
            msg = 'nasq_notify: a delivery key names one recipient'
            raise ValueError(msg)
        Message = self.env['mail.message'].sudo()
        created = Message.browse()
        if key and self._nasq_key_taken(key):
            return created
        for partner in partners:
            try:
                # A flushing savepoint executes and clears every precommit
                # callback and policy marker of the caller. Keep notification
                # uniqueness isolated without flushing unrelated operations.
                with self.env.cr.savepoint(flush=False):
                    message = Message.create({
                        **extra,
                        'model': model,
                        'res_id': res_id,
                        'nasq_notification': True,
                        'nasq_notification_kind': kind,
                        'nasq_notification_key': key or False,
                        'message_type': 'notification',
                        'is_internal': True,
                        'author_id': self.env.user.partner_id.id,
                        'subtype_id': self.env.ref('mail.mt_note').id,
                        'body': plaintext2html(body),
                        'partner_ids': [(4, partner.id)],
                    })
                    self.env['mail.notification'].sudo().create({
                        'author_id': message.author_id.id,
                        'mail_message_id': message.id,
                        'notification_status': 'sent',
                        'notification_type': 'inbox',
                        'res_partner_id': partner.id,
                    })
            except IntegrityError as error:
                # Concurrent workers may race on the deterministic key. The
                # unique index makes the loser a harmless retry; any other
                # integrity failure still reaches the caller.
                constraint = getattr(getattr(error, 'diag', None), 'constraint_name', '') or ''
                if key and 'nasq_notification_key' in constraint:
                    continue
                raise
            created |= message
        return created
```

Register the rank in `tools/arch_layers.json`, so `ranks` reads:

```json
  "ranks": {
    "nasq_core": 0,
    "nasq_platform": 1,
    "nasq_api": 2,
    "nasq_directory": 3,
    "nasq_notify": 3,
    "nasq_pmo": 4,
    "nasq_hr": 4,
    "nasq_chat": 4
  },
```

- [ ] **Step 4: Register PMO's kinds and rewrite its producers on the service**

Create `odoo-addons/nasq_pmo/models/notification_types.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""nasq_pmo's notification kinds in the nasq_notify registry.

Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until nasq_meetings exists (phase 2b-2). Keep the meeting class
second: the bell's feature gate checks keys in registration order, and with
both off it reports the last one (meetings.enabled), as it did before.
"""
from odoo import api, models

TASK_KINDS = ('assignment', 'comment', 'mention', 'deadline')
DIGEST_KIND = 'overdue_digest'
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)


class NasqPmoTaskNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'project.task', 'feature_key': 'pmo.enabled'}
                for kind in TASK_KINDS
            ),
            {'kind': DIGEST_KIND, 'owner': 'nasq_pmo', 'model': 'res.company', 'feature_key': 'pmo.enabled', 'live': True},
        )


class NasqPmoMeetingNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'cyan.meeting.minute', 'feature_key': 'meetings.enabled'}
                for kind in MEETING_KINDS
            ),
        )
```

In `odoo-addons/nasq_pmo/models/__init__.py` add `    notification_types,` after `    nasq_settings,`.

Replace `odoo-addons/nasq_pmo/models/mail_notification_nasq.py` with (transitional: the three generic columns and the index are declared by both addons until Task 5):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqMailMessage(models.Model):
    _inherit = 'mail.message'

    # nasq_notify declares nasq_notification, nasq_notification_key and the
    # unique index too; nasq_pmo hands them over in 19.0.1.3.0.
    nasq_notification = fields.Boolean('nasq Notification', index=True, copy=False)
    nasq_notification_kind = fields.Selection(selection_add=[
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('mention', 'Mention'),
        ('deadline', 'Deadline'),
        ('overdue_digest', 'Overdue digest'),
        ('meeting_invite', 'Meeting invite'),
        ('meeting_resolution', 'Meeting resolution'),
        ('meeting_converted', 'Meeting converted'),
        ('meeting_changed', 'Meeting changed'),
        ('meeting_cancelled', 'Meeting cancelled'),
        ('meeting_reminder', 'Meeting reminder'),
        ('meeting_resolution_overdue', 'Meeting resolution overdue'),
    ])
    nasq_meeting_id = fields.Integer(copy=False, index=True)
    nasq_notification_key = fields.Char('nasq Notification Key', copy=False, index=True)
    nasq_task_id = fields.Many2one('project.task', string='nasq Task', index=True, copy=False, ondelete='cascade')
    nasq_digest_count = fields.Integer('nasq Digest Count', copy=False)
    nasq_digest_date = fields.Date('nasq Digest Date', copy=False)
    nasq_digest_task_ids = fields.Char('nasq Digest Task Ids', copy=False)

    _nasq_notification_key_unique = models.UniqueIndex(
        '(nasq_notification_key) WHERE nasq_notification_key IS NOT NULL',
    )
```

In `odoo-addons/nasq_pmo/models/task_notifications.py` replace the imports:

```python
import json
from datetime import datetime, time, timedelta

from psycopg2 import IntegrityError
from pytz import UTC
from pytz import timezone as pytz_timezone
from pytz.exceptions import UnknownTimeZoneError

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import html2plaintext, plaintext2html
```

with:

```python
import json
from datetime import datetime, time, timedelta

from pytz import UTC
from pytz import timezone as pytz_timezone
from pytz.exceptions import UnknownTimeZoneError

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import html2plaintext
```

then replace the whole `_nasq_create_notification` method (from `    def _nasq_create_notification(self, *, kind, partner, body, key=None):` down to its `        return message`) with:

```python
    def _nasq_create_notification(self, *, kind, partner, body, key=None):
        self.ensure_one()
        messages = self.env['nasq.notify.service']._nasq_deliver(
            self._name, self.id, kind, partner, body, key=key, values={'nasq_task_id': self.id},
        )
        return messages or False
```

and replace the whole `_nasq_create_digest_notification` method (from its `@api.model` decorator down to its `        return message`) with:

```python
    @api.model
    def _nasq_create_digest_notification(self, *, company, partner, body, key, overdue_count, local_date, task_ids=()):
        messages = self.env['nasq.notify.service']._nasq_deliver(
            'res.company', company.id, 'overdue_digest', partner, body, key=key,
            values={
                'nasq_task_id': False,
                'nasq_digest_count': overdue_count,
                'nasq_digest_date': local_date,
                'nasq_digest_task_ids': json.dumps([int(task_id) for task_id in task_ids]),
            },
        )
        return messages or False
```

In `odoo-addons/nasq_pmo/models/meeting_minute.py` delete the import line `from odoo.tools.mail import plaintext2html` and replace the whole `_nasq_notify_partners` method (lines 62-92) with:

```python
    def _nasq_notify_partners(self, partners, kind, body, key=None):
        self.ensure_one()
        service = self.env['nasq.notify.service']
        for partner in partners:
            # The per-recipient suffix keeps the pre-split key format, so a
            # producer that runs again after an upgrade delivers nothing new.
            service._nasq_deliver(
                self._name, self.id, kind, partner, body,
                key=f'{key}:{partner.id}' if key else None,
                values={'nasq_meeting_id': self.id},
            )
```

In `odoo-addons/nasq_pmo/__manifest__.py` replace:

```python
    # nasq_directory: /api/v1/people and its population; nasq_pmo registers the
    # feature keys that open it.
```

with:

```python
    # nasq_directory: /api/v1/people and its population; nasq_pmo registers the
    # feature keys that open it. nasq_notify: bell delivery and the type
    # registry; nasq_pmo registers its kinds and keeps its producers.
```

and replace:

```python
    'depends': ['nasq_api', 'nasq_platform', 'nasq_directory', 'project', 'mail', 'bus', 'cyan_meeting_minutes'],
```

with:

```python
    'depends': [
        'nasq_api', 'nasq_platform', 'nasq_directory', 'nasq_notify',
        'project', 'mail', 'bus', 'cyan_meeting_minutes',
    ],
```

- [ ] **Step 5: Static checks and the baseline**

```bash
ruff check odoo-addons
rg -n "\b(project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(pmo|hr|chat|meetings)" odoo-addons/nasq_notify --glob '!tests/**' || echo "nasq_notify names no application"
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
r7 = baseline['R7']
print('R7 total', sum(r7.values()))
for key in ('odoo-addons/nasq_notify/models/notify_service.py', 'odoo-addons/nasq_pmo/models/task_notifications.py', 'odoo-addons/nasq_pmo/models/meeting_minute.py'):
    print(key, r7.get(key))
PY
```

Expected: `All checks passed!`; `nasq_notify names no application`; `wrote arch_baseline.json`; `exit=0`; `R7 total 86` with `notify_service.py 3`, `task_notifications.py 4`, `meeting_minute.py 2`.

- [ ] **Step 6: Run the focused tests on the full and the shared-only install**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t3 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_notify,/nasq_pmo:TestTaskNotifications,/nasq_pmo:TestDeadlineDigest,/nasq_pmo:TestMeetingsApi,/nasq_pmo:TestMeetingSeries,/nasq_pmo:TestResolutionConvert,/nasq_pmo:TestTimeline
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t3_shared \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_hr \
  /nasq_api,/nasq_notify,/nasq_directory
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t3` and `ODOO_RUN_TEST_OK nasq_scratch_notify_t3_shared`.

- [ ] **Step 7: Commit**

```bash
git add odoo-addons/nasq_notify odoo-addons/nasq_pmo/models/notification_types.py odoo-addons/nasq_pmo/models/__init__.py \
  odoo-addons/nasq_pmo/models/mail_notification_nasq.py odoo-addons/nasq_pmo/models/task_notifications.py \
  odoo-addons/nasq_pmo/models/meeting_minute.py odoo-addons/nasq_pmo/__manifest__.py \
  odoo-addons/nasq_pmo/tests/test_notifications.py tools/arch_layers.json tools/arch_baseline.json
git commit -m "feat(api): deliver notifications through nasq_notify"
```

---

### Task 4: Generic bell routes in nasq_notify behind the registry gate

**Files:**
- Modify (replace): `odoo-addons/nasq_notify/models/notify_registry.py`, `models/notify_service.py`, `tests/common.py`, `__init__.py`, `tests/__init__.py`
- Create: `odoo-addons/nasq_notify/controllers/__init__.py`, `controllers/notifications.py`, `tests/test_notify_routes.py`
- Modify: `odoo-addons/nasq_notify/tests/test_notify_service.py`
- Modify (replace): `odoo-addons/nasq_pmo/models/notification_types.py`, `controllers/notifications.py`
- Modify: `odoo-addons/nasq_pmo/tests/test_notifications.py:8`
- Modify: `tools/arch_baseline.json` (regenerated)

**Interfaces:**
- Consumes: `requires_registered_feature` (Task 2), `PROBE_FEATURE`, `register_probe_feature`, `set_probe_feature` (Task 2), the registry and service of Task 3.
- Produces on `nasq.notify.registry`: `_nasq_notify_visible_domain() -> list[list]` (composed through `super()`; each owner appends non-empty branches over `mail.notification`), `_nasq_notify_row_visible(row) -> tuple[bool, object]`, `_nasq_notify_dump(row, extra) -> dict`, `_nasq_notify_feature_key(row) -> str | None`.
- Produces on `nasq.notify.service`: `_nasq_domain() -> Domain`, `_nasq_visible_rows(domain, limit=None, offset=0) -> list[tuple]`, `_nasq_visible_count(domain) -> int`, `_nasq_list(limit, offset=0, unread=None) -> {'items', 'total', 'unread_count'}`, `_nasq_find(notification_id) -> (mail.notification, extra)` (raises `MissingError`), `_nasq_mark_read(notification_id) -> int`, `_nasq_mark_all_read() -> int`.
- Produces: `odoo.addons.nasq_pmo.models.notification_types.recipient_candidate_task_ids(env)`, `readable_active_task_ids(env, candidate_ids=None)`, `readable_active_meeting_ids(env)`, `digest_live_tasks(env, row)` (moved verbatim from the pmo controller).

- [ ] **Step 1: Write the failing service and route tests**

Replace `odoo-addons/nasq_notify/tests/common.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only notification types for nasq_notify's own tests.

nasq_notify knows no application, so its tests register two probe kinds on
``res.partner`` rows for the length of one test: the kinds are added to the
selection field and the registry is replaced with ``self.patch``, which also
hides every installed application's types. ``hidden_sources`` play the
records the caller can no longer read; ``dead_sources`` play live rows whose
row check fails. The tests behave the same with or without an application.
"""
from odoo.addons.nasq_api.tests.common import PROBE_FEATURE, register_probe_feature, set_probe_feature

PROBE_KINDS = (('probe_ping', 'Probe ping'), ('probe_live', 'Probe live'))
PROBE_TYPES = (
    {'kind': 'probe_ping', 'owner': 'nasq_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE},
    {'kind': 'probe_live', 'owner': 'nasq_notify', 'model': 'res.partner', 'feature_key': PROBE_FEATURE, 'live': True},
)


class NotifyProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``."""

    def _install_probe(self):
        self.hidden_sources = set()
        self.dead_sources = set()
        field = self.env['mail.message']._fields['nasq_notification_kind']
        self.patch(field, 'selection', [*field.selection, *PROBE_KINDS])
        self.patch(field, '_selection', {**(field._selection or {}), **dict(PROBE_KINDS)})
        registry = type(self.env['nasq.notify.registry'])
        self.patch(registry, '_nasq_notification_types', lambda model: PROBE_TYPES)
        self.patch(registry, '_nasq_notify_visible_domain', lambda model: [[
            ('mail_message_id.model', '=', 'res.partner'),
            ('mail_message_id.res_id', 'not in', sorted(self.hidden_sources)),
        ]])
        self.patch(registry, '_nasq_notify_row_visible', lambda model, row: self._probe_row_visible(row))
        self.patch(registry, '_nasq_notify_dump', lambda model, row, extra: self._probe_dump(row, extra))
        register_probe_feature(self)
        set_probe_feature(self)

    def _probe_row_visible(self, row):
        message = row.mail_message_id
        if message.nasq_notification_kind != 'probe_live':
            return True, None
        if message.res_id in self.dead_sources:
            return False, None
        return True, 'alive'

    def _probe_dump(self, row, extra):
        message = row.mail_message_id
        return {
            'id': row.id,
            'kind': message.nasq_notification_kind,
            'source_id': message.res_id,
            'is_read': bool(row.is_read),
            'extra': extra,
        }
```

In `odoo-addons/nasq_notify/tests/test_notify_service.py` replace the imports with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import MissingError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.nasq_api.tests.common import PROBE_FEATURE, set_probe_feature
from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_notify.tests.common import PROBE_TYPES, NotifyProbe
```

and append these methods to `TestNotifyService`:

```python
    def _list(self, user, limit=50, **kwargs):
        return self.service.with_user(user)._nasq_list(limit, **kwargs)

    def test_list_is_recipient_scoped_newest_first_and_paged(self):
        for source in self.sources:
            self._deliver(source, self.reader.partner_id)
        self._deliver(self.sources[0], self.other.partner_id)
        body = self._list(self.reader)
        self.assertEqual([item['source_id'] for item in body['items']], list(reversed(self.sources.ids)))
        self.assertEqual((body['total'], body['unread_count']), (3, 3))
        page = self._list(self.reader, limit=1, offset=1)
        self.assertEqual([item['source_id'] for item in page['items']], [self.sources[1].id])
        self.assertEqual((page['total'], page['unread_count']), (3, 3))
        self.assertEqual(self._list(self.reader, unread=False)['total'], 0)
        self.assertEqual(self._list(self.other)['total'], 1)

    def test_hidden_sources_are_not_listed_counted_or_marked(self):
        hidden, shown = self.sources[0], self.sources[1]
        hidden_row = self._deliver(hidden, self.reader.partner_id).notification_ids
        self._deliver(shown, self.reader.partner_id)
        self.hidden_sources.add(hidden.id)
        service = self.service.with_user(self.reader)
        body = service._nasq_list(50)
        self.assertEqual([item['source_id'] for item in body['items']], [shown.id])
        self.assertEqual((body['total'], body['unread_count']), (1, 1))
        with self.assertRaises(MissingError):
            service._nasq_mark_read(hidden_row.id)
        self.assertEqual(service._nasq_mark_all_read(), 1)
        hidden_row.invalidate_recordset(['is_read'])
        self.assertFalse(hidden_row.is_read)

    def test_live_rows_are_rechecked_one_by_one(self):
        dead, alive = self.sources[0], self.sources[1]
        dead_row = self._deliver(dead, self.reader.partner_id, kind='probe_live').notification_ids
        self._deliver(alive, self.reader.partner_id, kind='probe_live')
        self._deliver(self.sources[2], self.reader.partner_id)
        self.dead_sources.add(dead.id)
        service = self.service.with_user(self.reader)
        body = service._nasq_list(50)
        self.assertEqual(
            [(item['kind'], item['source_id'], item['extra']) for item in body['items']],
            [('probe_ping', self.sources[2].id, None), ('probe_live', alive.id, 'alive')],
        )
        self.assertEqual((body['total'], body['unread_count']), (2, 2))
        with self.assertRaises(MissingError):
            service._nasq_mark_read(dead_row.id)

    def test_marking_read_is_idempotent_scoped_and_needs_the_owner_feature(self):
        row = self._deliver(self.sources[0], self.reader.partner_id).notification_ids
        service = self.service.with_user(self.reader)
        self.assertEqual(service._nasq_mark_read(row.id), 1)
        self.assertEqual(service._nasq_mark_read(row.id), 0)
        with self.assertRaises(MissingError):
            self.service.with_user(self.other)._nasq_mark_read(row.id)
        unread = self._deliver(self.sources[1], self.reader.partner_id).notification_ids
        set_probe_feature(self, enabled=False, retained=True)
        self.assertEqual(service._nasq_list(50)['unread_count'], 1)
        with self.assertRaises(NasqAccessRule) as caught:
            service._nasq_mark_read(unread.id)
        self.assertEqual(caught.exception.code, 'feature_not_included')
        self.assertEqual(service._nasq_mark_all_read(), 0)
        unread.invalidate_recordset(['is_read'])
        self.assertFalse(unread.is_read)

    def test_an_empty_branch_is_refused_and_no_branch_shows_nothing(self):
        self._deliver(self.sources[0], self.reader.partner_id)
        self.patch(self.registry_model, '_nasq_notify_visible_domain', lambda model: [[]])
        with self.assertRaisesRegex(ValueError, 'must not be empty'):
            self._list(self.reader)
        self.patch(self.registry_model, '_nasq_notify_visible_domain', lambda model: [])
        self.assertEqual(self._list(self.reader), {'items': [], 'total': 0, 'unread_count': 0})

    def test_the_row_feature_comes_from_the_descriptor(self):
        row = self._deliver(self.sources[0], self.reader.partner_id).notification_ids
        self.assertEqual(self.env['nasq.notify.registry']._nasq_notify_feature_key(row), PROBE_FEATURE)
```

Create `odoo-addons/nasq_notify/tests/test_notify_routes.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_api.tests.common import PROBE_FEATURE, NasqApiCase, set_probe_feature
from odoo.addons.nasq_notify.tests.common import NotifyProbe


@tagged('post_install', '-at_install', 'nasq')
class TestNotifyRoutes(NotifyProbe, NasqApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.nora = new_test_user(
            self.env, login='notify_nora', password='notify_nora_pass_123', name='Nora',
            groups='nasq_core.group_employee',
        )
        self.source = self.env['res.partner'].create({'name': 'Route source'})

    def _deliver(self, partner):
        return self.env['nasq.notify.service']._nasq_deliver(
            'res.partner', self.source.id, 'probe_ping', partner, 'Route ping',
        ).notification_ids

    def test_bell_lists_and_marks_through_the_service(self):
        first = self._deliver(self.employee.partner_id)
        self._deliver(self.employee.partner_id)
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/notifications').json()
        self.assertEqual((body['total'], body['unread_count']), (2, 2))
        self.assertEqual({item['kind'] for item in body['items']}, {'probe_ping'})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{first.id}/read', {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{first.id}/read', {}).json(), {'updated': 0})
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 1})
        self.assertEqual(
            self.api('GET', '/api/v1/notifications?unread=true').json(),
            {'items': [], 'total': 0, 'unread_count': 0},
        )

    def test_another_recipients_row_is_404(self):
        row = self._deliver(self.nora.partner_id)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', f'/api/v1/notifications/{row.id}/read', {})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'not_found')

    def test_malformed_query_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for query, field in (('limit=wat', 'limit'), ('unread=maybe', 'unread'), ('unexpected=1', 'unexpected')):
            response = self.api('GET', f'/api/v1/notifications?{query}')
            self.assertEqual(response.status_code, 422, query)
            self.assertEqual(response.json()['code'], 'invalid', query)
            self.assertEqual(response.json()['field'], field, query)

    def test_the_bell_is_closed_when_no_application_registers_a_type(self):
        self.patch(type(self.env['nasq.notify.registry']), '_nasq_notification_types', lambda model: ())
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': None})

    def test_reads_follow_the_owner_feature(self):
        set_probe_feature(self, enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': PROBE_FEATURE})
```

Replace `odoo-addons/nasq_notify/tests/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import common, test_notify_routes, test_notify_service
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t4 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_hr /nasq_notify
```

Expected: the run dies with `tests failed or did not run`; the log shows `AttributeError` for `_nasq_notify_visible_domain` (patching a method that does not exist yet) and the route tests failing with 404 (`/api/v1/notifications` does not exist without `nasq_pmo`). Drop the kept database: `/tmp/nasq-notify/odoo-run.sh drop nasq_scratch_notify_t4`.

- [ ] **Step 3: Complete the registry, the service and the routes**

Replace `odoo-addons/nasq_notify/models/notify_registry.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

TYPE_FIELDS = ('owner', 'model', 'feature_key')


class NasqNotifyRegistry(models.AbstractModel):
    """Notification types, composed through ``super()`` like ``nasq.feature.registry``.

    nasq_notify knows no application. Each application that sends bell rows
    extends this model: it registers its kinds, says which of its rows the
    caller may still see, and serializes them.
    """
    _name = 'nasq.notify.registry'
    _description = 'Nasq notification type registry'
    _nasq_scope = 'global'

    @api.model
    def _nasq_notification_types(self):
        """Pure descriptors ``{'kind', 'owner', 'model', 'feature_key'}``; never a process-global set.

        ``'live': True`` marks a kind whose rows ``_nasq_notify_row_visible``
        re-checks one by one. The kind is a value its owner added to
        ``mail.message.nasq_notification_kind`` with ``selection_add``.
        """
        return ()

    @api.model
    def _nasq_notification_type_map(self):
        values = set(self.env['mail.message']._fields['nasq_notification_kind'].get_values(self.env))
        types = {}
        for item in self._nasq_notification_types():
            kind = item.get('kind')
            if not kind or not isinstance(kind, str):
                raise ValidationError(self.env._('nasq_notify: a notification type is missing a kind'))
            if kind in types:
                raise ValidationError(self.env._(
                    'nasq_notify: duplicate notification kind %(kind)s', kind=kind,
                ))
            for name in TYPE_FIELDS:
                if not item.get(name) or not isinstance(item[name], str):
                    raise ValidationError(self.env._(
                        'nasq_notify: notification kind %(kind)s is missing %(name)s', kind=kind, name=name,
                    ))
            if kind not in values:
                raise ValidationError(self.env._(
                    'nasq_notify: notification kind %(kind)s is not a mail.message selection value', kind=kind,
                ))
            types[kind] = item
        return types

    @api.model
    def _nasq_notify_feature_keys(self):
        """Feature keys of the registered types, in registration order, each once."""
        keys = []
        for item in self._nasq_notification_type_map().values():
            if item['feature_key'] not in keys:
                keys.append(item['feature_key'])
        return tuple(keys)

    @api.model
    def _nasq_notify_live_kinds(self):
        return tuple(kind for kind, item in self._nasq_notification_type_map().items() if item.get('live'))

    @api.model
    def _nasq_notify_visible_domain(self):
        """One ``mail.notification`` domain per readable source; the service ORs them.

        An owner appends a non-empty branch for its own rows, built from ids
        the caller can still read in the caller's environment. A row outside
        every branch is never listed, counted or marked read.
        """
        return []

    @api.model
    def _nasq_notify_row_visible(self, row):
        """``(visible, extra)`` for one row of a ``live`` kind; ``extra`` reaches the dump."""
        return True, None

    @api.model
    def _nasq_notify_dump(self, row, extra):
        """The wire shape of one row; its owner overrides this for its kinds."""
        kind = row.mail_message_id.nasq_notification_kind
        msg = f'nasq_notify: no owner serializes notification kind {kind!r}'
        raise ValueError(msg)

    @api.model
    def _nasq_notify_feature_key(self, row):
        """The feature that must allow writes before ``row`` is marked read."""
        types = self._nasq_notification_type_map()
        message = row.mail_message_id
        item = types.get(message.nasq_notification_kind) or next(
            (item for item in types.values() if item['model'] == message.model), None,
        )
        return item['feature_key'] if item else None
```

Replace `odoo-addons/nasq_notify/models/notify_service.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import api, models
from odoo.exceptions import MissingError
from odoo.fields import Domain
from odoo.tools import plaintext2html

from odoo.addons.nasq_core.models.access_service import NasqAccessRule

SCAN_BATCH = 200
# The columns this service writes itself. ``values`` carries only the
# producing application's own mail.message columns.
GENERIC_VALUES = frozenset({
    'model', 'res_id', 'nasq_notification', 'nasq_notification_kind', 'nasq_notification_key',
    'message_type', 'is_internal', 'author_id', 'subtype_id', 'body', 'partner_ids',
})


class NasqNotifyService(models.AbstractModel):
    """Bell rows: a ``mail.message`` flagged ``nasq_notification`` plus one inbox
    ``mail.notification`` per recipient.

    Documented elevated operations (CLAUDE.md, R7): delivery creates the
    message and its inbox row as superuser, because the recipient, not the
    actor, owns the row; reads are elevated because a user cannot read other
    partners' ``mail.notification`` rows, so every elevated search carries
    ``res_partner_id = current partner`` in its domain, and the owning
    application's branch decides, in the caller's environment, which sources
    the caller may still read.
    """
    _name = 'nasq.notify.service'
    _description = 'Nasq notification service'
    _nasq_scope = 'global'

    @api.model
    def _nasq_key_taken(self, key):
        return bool(self.env['mail.message'].sudo().search_count(
            [('nasq_notification_key', '=', key)], limit=1,
        ))

    @api.model
    def _nasq_deliver(self, model, res_id, kind, partners, body, key=None, values=None):
        """Create one bell row per partner on ``model``/``res_id`` and return the new messages.

        ``key`` makes delivery idempotent. It is stored verbatim, so it names
        its single recipient: a key with several partners is refused. A key
        that exists, or that a concurrent worker inserts first, creates nothing.
        """
        if kind not in self.env['nasq.notify.registry']._nasq_notification_type_map():
            msg = f'nasq_notify: notification kind {kind!r} is not registered'
            raise ValueError(msg)
        extra = dict(values or {})
        clash = sorted(GENERIC_VALUES & set(extra))
        if clash:
            msg = f'nasq_notify: values may not set {clash}'
            raise ValueError(msg)
        if key and len(partners) > 1:
            msg = 'nasq_notify: a delivery key names one recipient'
            raise ValueError(msg)
        Message = self.env['mail.message'].sudo()
        created = Message.browse()
        if key and self._nasq_key_taken(key):
            return created
        for partner in partners:
            try:
                # A flushing savepoint executes and clears every precommit
                # callback and policy marker of the caller. Keep notification
                # uniqueness isolated without flushing unrelated operations.
                with self.env.cr.savepoint(flush=False):
                    message = Message.create({
                        **extra,
                        'model': model,
                        'res_id': res_id,
                        'nasq_notification': True,
                        'nasq_notification_kind': kind,
                        'nasq_notification_key': key or False,
                        'message_type': 'notification',
                        'is_internal': True,
                        'author_id': self.env.user.partner_id.id,
                        'subtype_id': self.env.ref('mail.mt_note').id,
                        'body': plaintext2html(body),
                        'partner_ids': [(4, partner.id)],
                    })
                    self.env['mail.notification'].sudo().create({
                        'author_id': message.author_id.id,
                        'mail_message_id': message.id,
                        'notification_status': 'sent',
                        'notification_type': 'inbox',
                        'res_partner_id': partner.id,
                    })
            except IntegrityError as error:
                # Concurrent workers may race on the deterministic key. The
                # unique index makes the loser a harmless retry; any other
                # integrity failure still reaches the caller.
                constraint = getattr(getattr(error, 'diag', None), 'constraint_name', '') or ''
                if key and 'nasq_notification_key' in constraint:
                    continue
                raise
            created |= message
        return created

    @api.model
    def _nasq_domain(self):
        """The caller's inbox bell rows whose source an owning application still lets them read."""
        branches = list(self.env['nasq.notify.registry']._nasq_notify_visible_domain())
        if any(not branch for branch in branches):
            # Domain([]) matches everything; an empty branch would leak rows.
            msg = 'nasq_notify: a visibility branch must not be empty'
            raise ValueError(msg)
        visible = Domain.OR(Domain(branch) for branch in branches) if branches else Domain.FALSE
        return Domain([
            ('res_partner_id', '=', self.env.user.partner_id.id),
            ('mail_message_id.nasq_notification', '=', True),
            ('notification_type', '=', 'inbox'),
        ]) & visible

    @api.model
    def _nasq_visible_rows(self, domain, limit=None, offset=0):
        """``(row, extra)`` pairs, newest first, after the owners' row checks."""
        registry = self.env['nasq.notify.registry']
        Notification = self.env['mail.notification'].sudo()
        last_id = None
        collected = []
        needed = (offset or 0) + (limit if limit is not None else 10 ** 9)
        while len(collected) < needed:
            batch_domain = domain if last_id is None else domain & Domain('id', '<', last_id)
            batch = Notification.search(batch_domain, order='id desc', limit=SCAN_BATCH)
            if not batch:
                break
            last_id = batch.ids[-1]
            for row in batch:
                visible, extra = registry._nasq_notify_row_visible(row)
                if not visible:
                    continue
                collected.append((row, extra))
                if len(collected) >= needed:
                    break
        start = offset or 0
        if limit is None:
            return collected[start:]
        return collected[start:start + limit]

    @api.model
    def _nasq_visible_count(self, domain):
        """Counted in SQL, except the rows of ``live`` kinds, which are re-checked one by one."""
        registry = self.env['nasq.notify.registry']
        Notification = self.env['mail.notification'].sudo()
        live_kinds = list(registry._nasq_notify_live_kinds())
        if not live_kinds:
            return Notification.search_count(domain)
        total = Notification.search_count(
            domain & Domain('mail_message_id.nasq_notification_kind', 'not in', live_kinds),
        )
        live_domain = domain & Domain('mail_message_id.nasq_notification_kind', 'in', live_kinds)
        last_id = None
        while True:
            batch_domain = live_domain if last_id is None else live_domain & Domain('id', '<', last_id)
            batch = Notification.search(batch_domain, order='id desc', limit=SCAN_BATCH)
            if not batch:
                break
            last_id = batch.ids[-1]
            total += sum(1 for row in batch if registry._nasq_notify_row_visible(row)[0])
        return total

    @api.model
    def _nasq_list(self, limit, offset=0, unread=None):
        """One page of the caller's bell with its total and unread count."""
        base = self._nasq_domain()
        domain = base if unread is None else base & Domain('is_read', '=', not unread)
        registry = self.env['nasq.notify.registry']
        rows = self._nasq_visible_rows(domain, limit=limit, offset=offset)
        return {
            'items': [registry._nasq_notify_dump(row, extra) for row, extra in rows],
            'total': self._nasq_visible_count(domain),
            'unread_count': self._nasq_visible_count(base & Domain('is_read', '=', False)),
        }

    @api.model
    def _nasq_find(self, notification_id):
        """The caller's visible row and its row-check extra; MissingError otherwise."""
        rows = self.env['mail.notification'].sudo().search(
            self._nasq_domain() & Domain('id', '=', notification_id), limit=1,
        )
        if not rows:
            raise MissingError(self.env._('Notification does not exist'))
        visible, extra = self.env['nasq.notify.registry']._nasq_notify_row_visible(rows)
        if not visible:
            raise MissingError(self.env._('Notification does not exist'))
        return rows, extra

    @api.model
    def _nasq_mark_read(self, notification_id):
        """Mark one visible row read once its owner's feature allows writes; return 0 or 1."""
        row, _extra = self._nasq_find(notification_id)
        if row.is_read:
            return 0
        self.env['nasq.entitlement.service'].require(
            self.env['nasq.notify.registry']._nasq_notify_feature_key(row),
        )
        row.write({'is_read': True})
        return 1

    @api.model
    def _nasq_mark_all_read(self):
        """Mark every visible unread row read whose owner's feature allows writes; return the count."""
        registry = self.env['nasq.notify.registry']
        entitlement = self.env['nasq.entitlement.service']
        writable = []
        for row, _extra in self._nasq_visible_rows(self._nasq_domain() & Domain('is_read', '=', False)):
            try:
                entitlement.require(registry._nasq_notify_feature_key(row))
            except NasqAccessRule:
                continue
            writable.append(row.id)
        if writable:
            self.env['mail.notification'].sudo().browse(writable).write({'is_read': True})
        return len(writable)
```

Replace `odoo-addons/nasq_notify/__init__.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers, models
```

Create `odoo-addons/nasq_notify/controllers/__init__.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import notifications
```

Create `odoo-addons/nasq_notify/controllers/notifications.py` (handlers keep no docstring, so the generated `summary` stays the handler name):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    requires_registered_feature,
)

MAX_LIMIT = 200


class NotificationController(http.Controller):

    @http.route('/api/v1/notifications', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(
        'nasq.notify.registry', '_nasq_notify_feature_keys',
        keys=('registry:nasq.notify.registry',), operation='read', match='any',
    )
    def list_notifications(self, **_):
        args = request.httprequest.args
        supported = {'limit', 'offset', 'unread'}
        unknown = next((key for key in args if key not in supported), None)
        if unknown:
            raise ApiError(422, 'invalid', f"unsupported query parameter {unknown!r}", field=unknown)
        # Odoo search(limit=0) is unlimited; treat explicit 0 as the default page.
        limit = parse_nonneg_int(args.get('limit', 50), 'limit') or 50
        limit = min(limit, MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        unread_arg = args.get('unread')
        unread = None
        if unread_arg is not None:
            if unread_arg in ('1', 'true'):
                unread = True
            elif unread_arg in ('0', 'false'):
                unread = False
            else:
                raise ApiError(422, 'invalid', "unread must be a boolean", field='unread')
        return request.env['nasq.notify.service']._nasq_list(limit, offset=offset, unread=unread)

    # The two writes have no route-level feature: each row's owner feature is
    # checked by the service (NOTIFICATION_WRITE_ENDPOINTS in nasq_api tests).
    @http.route('/api/v1/notifications/<int:notification_id>/read', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_read(self, notification_id, **_):
        return {'updated': request.env['nasq.notify.service']._nasq_mark_read(notification_id)}

    @http.route('/api/v1/notifications/read-all', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def mark_all_read(self, **_):
        return {'updated': request.env['nasq.notify.service']._nasq_mark_all_read()}
```

- [ ] **Step 4: Move PMO's visibility, row check and payload into its registration**

Replace `odoo-addons/nasq_pmo/models/notification_types.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""nasq_pmo's notification kinds in the nasq_notify registry.

Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until nasq_meetings exists (phase 2b-2). Keep the meeting class
second: the bell's feature gate checks keys in registration order, and with
both off it reports the last one (meetings.enabled), as it did before.

Documented notification sudo: the candidate lookups below read only the
current partner's own inbox rows; whether the task or meeting is still
readable is decided by an ordinary search in the caller's environment.
"""
from odoo import api, models

from odoo.addons.nasq_pmo.serializers.notification import dump_notification

TASK_KINDS = ('assignment', 'comment', 'mention', 'deadline')
DIGEST_KIND = 'overdue_digest'
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)


def recipient_candidate_task_ids(env):
    """Task ids on inbox nasq rows owned by the current partner.

    The recipient restriction is in the domain before the elevated
    ``mail.notification`` read. This does not search ``project.task``.
    """
    rows = env['mail.notification'].sudo().search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.nasq_notification', '=', True),
        ('mail_message_id.model', '=', 'project.task'),
        ('notification_type', '=', 'inbox'),
    ])
    return rows.mapped('mail_message_id.nasq_task_id').ids


def readable_active_task_ids(env, candidate_ids=None):
    """Caller-visible active current-company tasks among recipient candidates.

    Task search is never sudo'd. Company-less tasks stay excluded: the
    domain requires ``company_id`` of the current company on both the
    task and its project.
    """
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'pmo.tasks.read') or not env['project.task'].has_access('read'):
        return []
    if candidate_ids is None:
        candidate_ids = recipient_candidate_task_ids(env)
    if not candidate_ids:
        return []
    company_id = env.company.id
    projects = env['project.project'].search([
        ('active', '=', True),
        ('company_id', '=', company_id),
    ])
    if not projects:
        return []
    return env['project.task'].search([
        ('id', 'in', candidate_ids),
        ('active', '=', True),
        ('company_id', '=', company_id),
        ('project_id', 'in', projects.ids),
        ('project_id.company_id', '=', company_id),
        ('project_id.active', '=', True),
    ]).ids


def readable_active_meeting_ids(env):
    """Recipient-owned candidate ids, checked under the caller's meeting ACLs.

    Elevated notification reads do not grant access to the linked meeting.
    Explicit company scope also protects superusers with several companies.
    """
    Meeting = env['cyan.meeting.minute']
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'meetings.read') or not Meeting.has_access('read'):
        return []
    rows = env['mail.notification'].sudo().search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.nasq_notification', '=', True),
        ('mail_message_id.model', '=', 'cyan.meeting.minute'),
        ('notification_type', '=', 'inbox'),
    ])
    candidate_ids = rows.mapped('mail_message_id.nasq_meeting_id')
    if not candidate_ids:
        return []
    return Meeting.search([
        ('id', 'in', candidate_ids),
        ('company_id', '=', env.company.id),
        ('active', '=', True),
    ]).ids


def digest_live_tasks(env, row):
    """The digest's snapshot tasks the caller can still read, in the caller's environment."""
    Task = env['project.task']
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'pmo.tasks.read') or not Task.has_access('read'):
        return Task.browse()
    snapshot = Task._nasq_digest_snapshot_ids(row.mail_message_id)
    return Task._nasq_live_digest_tasks(snapshot)


class NasqPmoTaskNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'project.task', 'feature_key': 'pmo.enabled'}
                for kind in TASK_KINDS
            ),
            {'kind': DIGEST_KIND, 'owner': 'nasq_pmo', 'model': 'res.company', 'feature_key': 'pmo.enabled', 'live': True},
        )

    @api.model
    def _nasq_notify_visible_domain(self):
        return [
            *super()._nasq_notify_visible_domain(),
            [
                ('mail_message_id.nasq_notification_kind', '=', DIGEST_KIND),
                ('mail_message_id.model', '=', 'res.company'),
                ('mail_message_id.res_id', '=', self.env.company.id),
            ],
            [
                ('mail_message_id.model', '=', 'project.task'),
                ('mail_message_id.nasq_task_id', 'in', readable_active_task_ids(self.env)),
            ],
        ]

    @api.model
    def _nasq_notify_row_visible(self, row):
        if row.mail_message_id.nasq_notification_kind != DIGEST_KIND:
            return super()._nasq_notify_row_visible(row)
        live = digest_live_tasks(self.env, row)
        return bool(live), live

    @api.model
    def _nasq_notify_dump(self, row, extra):
        if row.mail_message_id.nasq_notification_kind in (*TASK_KINDS, DIGEST_KIND):
            return dump_notification(row, extra)
        return super()._nasq_notify_dump(row, extra)


class NasqPmoMeetingNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'cyan.meeting.minute', 'feature_key': 'meetings.enabled'}
                for kind in MEETING_KINDS
            ),
        )

    @api.model
    def _nasq_notify_visible_domain(self):
        meeting_ids = readable_active_meeting_ids(self.env)
        return [
            *super()._nasq_notify_visible_domain(),
            [
                ('mail_message_id.model', '=', 'cyan.meeting.minute'),
                ('mail_message_id.res_id', 'in', meeting_ids),
                ('mail_message_id.nasq_meeting_id', 'in', meeting_ids),
            ],
        ]

    @api.model
    def _nasq_notify_dump(self, row, extra):
        if row.mail_message_id.nasq_notification_kind in MEETING_KINDS:
            return dump_notification(row, extra)
        return super()._nasq_notify_dump(row, extra)
```

Replace `odoo-addons/nasq_pmo/controllers/notifications.py` with (only the digest route stays; class and handler names are unchanged so `openapi.json` does not change for it):

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    api_handler,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.nasq_pmo.models.notification_types import DIGEST_KIND
from odoo.addons.nasq_pmo.serializers.task import dump_task

MAX_LIMIT = 200


class NotificationController(http.Controller):

    @http.route('/api/v1/notification-digests/<int:notification_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_digest(self, notification_id, **_):
        args = request.httprequest.args
        limit = parse_nonneg_int(args.get('limit', 50), 'limit') or 50
        limit = min(limit, MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        # nasq_notify applies recipient ownership, the visibility branches and
        # the digest's live snapshot check before handing back the row.
        row, live = request.env['nasq.notify.service']._nasq_find(notification_id)
        if row.mail_message_id.nasq_notification_kind != DIGEST_KIND:
            raise MissingError(request.env._('Notification does not exist'))
        tasks = live.sorted(lambda task: (task.date_deadline or datetime.min, task.id))
        page = tasks[offset:offset + limit]
        local_date = row.mail_message_id.nasq_digest_date
        return {
            'id': row.id,
            'kind': 'overdue_digest',
            'local_date': local_date.isoformat() if local_date else None,
            'overdue_count': len(tasks),
            'items': [dump_task(task) for task in page],
            'total': len(tasks),
        }
```

In `odoo-addons/nasq_pmo/tests/test_notifications.py` replace:

```python
from odoo.addons.nasq_pmo.controllers.notifications import readable_active_task_ids
```

with:

```python
from odoo.addons.nasq_pmo.models.notification_types import readable_active_task_ids
```

- [ ] **Step 5: Static checks and the baseline**

```bash
ruff check odoo-addons
rg -n "\b(project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(pmo|hr|chat|meetings)" odoo-addons/nasq_notify --glob '!tests/**' || echo "nasq_notify names no application"
rg -n "_feature_key_for_row|_can_write_notification|_digest_row|def _visible_rows" odoo-addons || echo "no controller-side bell logic left"
python3 -B tools/arch_policy.py --write-baseline
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B - <<'PY'
import json
baseline = json.load(open('tools/arch_baseline.json'))
print({rule: sum(keys.values()) for rule, keys in sorted(baseline.items())})
print('notify_service', baseline['R7'].get('odoo-addons/nasq_notify/models/notify_service.py'))
print('notification_types', baseline['R7'].get('odoo-addons/nasq_pmo/models/notification_types.py'))
print('pmo controller', baseline['R7'].get('odoo-addons/nasq_pmo/controllers/notifications.py'))
PY
```

Expected: `All checks passed!`; `nasq_notify names no application`; `no controller-side bell logic left`; `wrote arch_baseline.json`; `exit=0`; totals `R1 0, R10 0, R2 8, R3 4, R4 0, R5 8, R6 0, R7 85, R8 1, R9 68`; `notify_service 7`, `notification_types 2`, `pmo controller None`.

- [ ] **Step 6: Run the focused tests and the shared-only install**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t4 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_notify,/nasq_api,/nasq_pmo:TestTaskNotifications,/nasq_pmo:TestDeadlineDigest,/nasq_pmo:TestMeetingsApi,/nasq_pmo:TestMeetingSeries,/nasq_pmo:TestResolutionConvert,/nasq_pmo:TestPmoFeatureEnforcement
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t4_shared \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_hr \
  /nasq_api,/nasq_notify,/nasq_directory
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t4` and `ODOO_RUN_TEST_OK nasq_scratch_notify_t4_shared`. `TestPmoFeatureEnforcement.test_bell_and_people_stay_open_while_any_owner_feature_is_on` passes unchanged against the moved route.

- [ ] **Step 7: Run the full suite (background)**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t4_full \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_hr,/nasq_chat
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t4_full`, or exactly the pre-existing failures recorded in Task 0 Step 7.

- [ ] **Step 8: Commit**

```bash
git add odoo-addons/nasq_notify odoo-addons/nasq_pmo/models/notification_types.py \
  odoo-addons/nasq_pmo/controllers/notifications.py odoo-addons/nasq_pmo/tests/test_notifications.py \
  tools/arch_baseline.json
git commit -m "refactor(api): serve the notification bell from nasq_notify"
```

---

### Task 5: Hand the bell columns and index to nasq_notify (nasq_pmo 19.0.1.3.0)

**Files:**
- Create: `odoo-addons/nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py`
- Create: `odoo-addons/nasq_pmo/tests/test_notify_ownership_migration.py`
- Modify: `odoo-addons/nasq_pmo/tests/__init__.py`, `models/mail_notification_nasq.py`, `__manifest__.py:5`

**Interfaces:**
- Produces: module constants `SOURCE = 'nasq_pmo'`, `TARGET = 'nasq_notify'`, `MOVED_FIELDS` (four xml id names), `ADOPTED_FIELDS` (six), `CONSTRAINT = 'mail_message_nasq_notification_key_unique'`, `CONSTRAINT_XMLID`, and `migrate(cr, version)`; consumed by Task 7's `notify_assert.py`.

- [ ] **Step 1: Write the failing migration test**

Create `odoo-addons/nasq_pmo/tests/test_notify_ownership_migration.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util

from odoo.tests import TransactionCase, tagged
from odoo.tools.misc import file_path

MIGRATION = 'nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py'
COLUMNS = ('nasq_notification', 'nasq_notification_kind', 'nasq_notification_key')


def _load_migration():
    spec = importlib.util.spec_from_file_location('nasq_pmo_pre_hand_bell_columns', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'nasq')
class TestNotifyOwnershipMigration(TransactionCase):
    """The 19.0.1.3.0 pre-migration leaves the generic bell columns to nasq_notify (Deviation 1)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.migration = _load_migration()
        cls.names = [*cls.migration.ADOPTED_FIELDS, cls.migration.CONSTRAINT_XMLID]

    def _xmlids(self, module):
        self.env.cr.execute(
            'SELECT name, model, res_id FROM ir_model_data WHERE module = %s AND name = ANY(%s)',
            [module, self.names],
        )
        return {name: (model, res_id) for name, model, res_id in self.env.cr.fetchall()}

    def _constraints(self):
        self.env.cr.execute(
            '''
                SELECT m.name, c.id
                  FROM ir_model_constraint c
                  JOIN ir_module_module m ON m.id = c.module
                 WHERE c.name = %s
            ''',
            [self.migration.CONSTRAINT],
        )
        return dict(self.env.cr.fetchall())

    def _restore_upgrade_state(self):
        """What the pre-migration meets: nasq_notify adopted every row, nasq_pmo still owns its copies."""
        cr = self.env.cr
        for name in self.migration.MOVED_FIELDS:
            cr.execute(
                '''
                    INSERT INTO ir_model_data (module, name, model, res_id, noupdate)
                    SELECT 'nasq_pmo', name, model, res_id, false FROM ir_model_data
                     WHERE module = 'nasq_notify' AND name = %s
                ''',
                [name],
            )
        cr.execute(
            '''
                INSERT INTO ir_model_constraint
                       (name, module, model, type, definition, message, create_date, write_date, create_uid, write_uid)
                SELECT c.name, (SELECT id FROM ir_module_module WHERE name = 'nasq_pmo'), c.model, c.type,
                       c.definition, c.message, c.create_date, c.write_date, c.create_uid, c.write_uid
                  FROM ir_model_constraint c
                  JOIN ir_module_module m ON m.id = c.module
                 WHERE c.name = %s AND m.name = 'nasq_notify'
             RETURNING id
            ''',
            [self.migration.CONSTRAINT],
        )
        [[constraint_id]] = cr.fetchall()
        cr.execute(
            "INSERT INTO ir_model_data (module, name, model, res_id, noupdate) VALUES ('nasq_pmo', %s, 'ir.model.constraint', %s, false)",
            [self.migration.CONSTRAINT_XMLID, constraint_id],
        )

    def test_a_fresh_install_is_owned_by_nasq_notify(self):
        self.assertEqual(set(self._xmlids('nasq_notify')), set(self.names))
        pmo = self._xmlids('nasq_pmo')
        self.assertFalse(set(pmo) & {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID})
        self.assertEqual(set(self._constraints()), {'nasq_notify'})
        for column in ('nasq_task_id', 'nasq_meeting_id', 'nasq_digest_count', 'nasq_digest_date', 'nasq_digest_task_ids'):
            self.assertTrue(self.env.ref(f'nasq_pmo.field_mail_message__{column}', raise_if_not_found=False), column)
        self.assertTrue(self.env.ref('nasq_pmo.selection__mail_message__nasq_notification_kind__assignment'))

    def test_the_columns_and_the_index_exist(self):
        self.env.cr.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'mail_message' AND column_name = ANY(%s)",
            [list(COLUMNS)],
        )
        self.assertEqual({row[0] for row in self.env.cr.fetchall()}, set(COLUMNS))
        self.env.cr.execute('SELECT indexdef FROM pg_indexes WHERE indexname = %s', [self.migration.CONSTRAINT])
        [[definition]] = self.env.cr.fetchall()
        self.assertIn('UNIQUE', definition)
        self.assertIn('nasq_notification_key IS NOT NULL', definition)

    def test_duplicates_are_dropped_and_a_rerun_is_a_no_op(self):
        notify = self._xmlids('nasq_notify')
        constraints = self._constraints()
        self._restore_upgrade_state()
        self.assertEqual(
            set(self._xmlids('nasq_pmo')) & {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID},
            {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID},
        )
        for _run in range(2):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
            self.assertFalse(set(self._xmlids('nasq_pmo')) & {*self.migration.MOVED_FIELDS, self.migration.CONSTRAINT_XMLID})
            self.assertEqual(self._xmlids('nasq_notify'), notify)
            self.assertEqual(self._constraints(), constraints)

    def test_a_fresh_install_skips_the_migration(self):
        self._restore_upgrade_state()
        before = (self._xmlids('nasq_pmo'), self._constraints())
        self.migration.migrate(self.env.cr, None)
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)

    def test_a_row_nasq_notify_did_not_adopt_stops_before_any_delete(self):
        self._restore_upgrade_state()
        self.env.cr.execute(
            "DELETE FROM ir_model_data WHERE module = 'nasq_notify' AND name = 'field_mail_message__nasq_notification_key'",
        )
        before = (self._xmlids('nasq_pmo'), self._constraints())
        with self.assertRaisesRegex(ValueError, 'field_mail_message__nasq_notification_key'):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)

    def test_a_clash_stops_before_any_delete(self):
        self._restore_upgrade_state()
        other = self.env['ir.model.fields']._get('mail.message', 'subject')
        self.env.cr.execute(
            "UPDATE ir_model_data SET res_id = %s WHERE module = 'nasq_pmo' AND name = 'field_mail_message__nasq_notification'",
            [other.id],
        )
        before = (self._xmlids('nasq_pmo'), self._constraints())
        with self.assertRaisesRegex(ValueError, 'nasq_notify points at'):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)

    def test_a_missing_index_row_stops_before_any_delete(self):
        self._restore_upgrade_state()
        notify_constraint = self._constraints()['nasq_notify']
        self.env.cr.execute("DELETE FROM ir_model_data WHERE module = 'nasq_notify' AND name = %s", [self.migration.CONSTRAINT_XMLID])
        self.env.cr.execute('DELETE FROM ir_model_constraint WHERE id = %s', [notify_constraint])
        before = (self._xmlids('nasq_pmo'), self._constraints())
        with self.assertRaisesRegex(ValueError, 'unique index'):
            self.migration.migrate(self.env.cr, '19.0.1.2.0')
        self.assertEqual((self._xmlids('nasq_pmo'), self._constraints()), before)
```

Add `    test_notify_ownership_migration,` to `odoo-addons/nasq_pmo/tests/__init__.py` after `    test_notifications,`.

- [ ] **Step 2: Run it to make sure it fails**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t5 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_pmo:TestNotifyOwnershipMigration
```

Expected: the run dies with `tests failed or did not run`; the log shows `FileNotFoundError` for the migration path in `setUpClass`. Drop the kept database: `/tmp/nasq-notify/odoo-run.sh drop nasq_scratch_notify_t5`.

- [ ] **Step 3: Write the migration, stop declaring the columns, bump the version**

Create `odoo-addons/nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Leave the generic bell columns and their unique index to nasq_notify.

nasq_notify is a new dependency of nasq_pmo, so the upgrade installs and
loads it before this script runs. Loading it already pointed nasq_notify
xml ids at the same ir_model_fields rows and reflected the unique index
under nasq_notify. What is left is nasq_pmo's duplicate ownership of the
fields it no longer declares and of the index. This script first checks
that nasq_notify adopted every row nasq_pmo still owns (same model and
res_id) and has its own index row; any miss or mismatch stops the upgrade
before anything changes, because Odoo would otherwise drop the column with
its data. Then it deletes nasq_pmo's duplicates.

nasq_pmo keeps its xml id on nasq_notification_kind: it extends that field
with selection_add, and its selection values stay its own. Columns, the
index, mail_message rows and selection values are not touched. Re-running
the script changes nothing; a fresh install skips it.
"""

SOURCE = 'nasq_pmo'
TARGET = 'nasq_notify'
MOVED_FIELDS = tuple(
    f'field_{model}__{field}'
    for model in ('mail_message', 'mail_mail')
    for field in ('nasq_notification', 'nasq_notification_key')
)
ADOPTED_FIELDS = (
    *MOVED_FIELDS,
    'field_mail_message__nasq_notification_kind',
    'field_mail_mail__nasq_notification_kind',
)
CONSTRAINT = 'mail_message_nasq_notification_key_unique'
CONSTRAINT_XMLID = f'constraint_{CONSTRAINT}'


def _target(cr, module, name):
    cr.execute('SELECT model, res_id FROM ir_model_data WHERE module = %s AND name = %s', [module, name])
    return cr.fetchone()


def _constraint_ids(cr):
    cr.execute(
        '''
            SELECT m.name, c.id
              FROM ir_model_constraint c
              JOIN ir_module_module m ON m.id = c.module
             WHERE c.name = %s AND m.name IN %s
        ''',
        [CONSTRAINT, (SOURCE, TARGET)],
    )
    return dict(cr.fetchall())


def _stop(name, problem):
    msg = (
        f'nasq_pmo migration: {problem} ({name}). The upgrade stopped before nasq_pmo '
        f'gave up its copy, so no column or index was dropped. Check that nasq_notify '
        f'is installed and declares it, then run the upgrade again.'
    )
    raise ValueError(msg)


def migrate(cr, version):
    if not version:
        return
    duplicates = []
    for name in ADOPTED_FIELDS:
        source = _target(cr, SOURCE, name)
        if source is None:
            continue
        target = _target(cr, TARGET, name)
        if target is None:
            _stop(name, 'nasq_notify has not adopted this field')
        if tuple(target) != tuple(source):
            _stop(name, f'nasq_notify points at {tuple(target)} and nasq_pmo at {tuple(source)}')
        if name in MOVED_FIELDS:
            duplicates.append(name)
    constraints = _constraint_ids(cr)
    if SOURCE in constraints and TARGET not in constraints:
        _stop(CONSTRAINT, 'nasq_notify has not reflected the unique index')
    if duplicates:
        cr.execute('DELETE FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [SOURCE, duplicates])
    if SOURCE in constraints:
        cr.execute('DELETE FROM ir_model_data WHERE module = %s AND name = %s', [SOURCE, CONSTRAINT_XMLID])
        cr.execute('DELETE FROM ir_model_constraint WHERE id = %s', [constraints[SOURCE]])
```

Replace `odoo-addons/nasq_pmo/models/mail_notification_nasq.py` with:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqMailMessage(models.Model):
    _inherit = 'mail.message'

    # nasq_notify owns nasq_notification, nasq_notification_kind,
    # nasq_notification_key and its unique index. nasq_pmo adds its kinds
    # (registered in models/notification_types.py) and its own source columns.
    nasq_notification_kind = fields.Selection(selection_add=[
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('mention', 'Mention'),
        ('deadline', 'Deadline'),
        ('overdue_digest', 'Overdue digest'),
        ('meeting_invite', 'Meeting invite'),
        ('meeting_resolution', 'Meeting resolution'),
        ('meeting_converted', 'Meeting converted'),
        ('meeting_changed', 'Meeting changed'),
        ('meeting_cancelled', 'Meeting cancelled'),
        ('meeting_reminder', 'Meeting reminder'),
        ('meeting_resolution_overdue', 'Meeting resolution overdue'),
    ])
    nasq_meeting_id = fields.Integer(copy=False, index=True)
    nasq_task_id = fields.Many2one('project.task', string='nasq Task', index=True, copy=False, ondelete='cascade')
    nasq_digest_count = fields.Integer('nasq Digest Count', copy=False)
    nasq_digest_date = fields.Date('nasq Digest Date', copy=False)
    nasq_digest_task_ids = fields.Char('nasq Digest Task Ids', copy=False)
```

In `odoo-addons/nasq_pmo/__manifest__.py` replace `    'version': '19.0.1.2.0',` with `    'version': '19.0.1.3.0',`.

- [ ] **Step 4: Static checks**

```bash
ruff check odoo-addons
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
```

Expected: `All checks passed!` and both `exit=0` (the migration is not scanned by R9; it has no `sudo()`).

- [ ] **Step 5: Run the focused tests and the full suite (background)**

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t5 \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_pmo:TestNotifyOwnershipMigration,/nasq_notify,/nasq_pmo:TestTaskNotifications,/nasq_pmo:TestDeadlineDigest,/nasq_pmo:TestMeetingsApi
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_t5_full \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_hr,/nasq_chat
```

Expected: `ODOO_RUN_TEST_OK nasq_scratch_notify_t5` and `ODOO_RUN_TEST_OK nasq_scratch_notify_t5_full` (or exactly the pre-existing failures of Task 0). If `test_a_fresh_install_is_owned_by_nasq_notify` fails because `nasq_notify` holds no `field_mail_mail__*` xml id, stop and report it: Deviation 1 assumes Odoo gives the extending module those xml ids, and the migration would stop real upgrades.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/nasq_pmo/migrations/19.0.1.3.0 odoo-addons/nasq_pmo/tests/test_notify_ownership_migration.py \
  odoo-addons/nasq_pmo/tests/__init__.py odoo-addons/nasq_pmo/models/mail_notification_nasq.py \
  odoo-addons/nasq_pmo/__manifest__.py
git commit -m "refactor(pmo): hand the bell columns to nasq_notify"
```

---

### Task 6: Install and test the shared services everywhere the addons are listed

**Files:**
- Modify: `.woodpecker.yml:75-76,89,152,202`, `deploy/woodpecker/image.yml:56`, `deploy/provision.sh:106`, `deploy/verification-checks.json:52-54`, `deploy/OPERATIONS.md:83-84,200`, `tools/check_cp1_scratch.py:20`, `tools/shared_acceptance_live/up.sh:233`
- Modify: `deploy/check_isolated.py:23`, `deploy/test_operations.py:151-153`, `tools/nasq_cli/operator.py:44-45`, `tools/shared_saas_lifecycle/odoo_effect.py:25`

**Interfaces:**
- Produces: the canonical module list `nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat` and test-tag list `/nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_hr,/nasq_chat`, used by Tasks 7-8.

`deploy/catalog/solutions/*.json` `base_modules` is deliberately not changed (Deviation 8). `tools/shared_saas_lifecycle/lifecycle.py:168` and `tools/saas_commercial_acceptance/commercial_lifecycle.py:180` install `nasq_pmo,nasq_hr` without `nasq_chat` by design and get both services as dependencies; they are left alone.

- [ ] **Step 1: Replace the comma-separated lists**

```bash
python3 - <<'PY'
from pathlib import Path

OLD_I = 'nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat'
NEW_I = 'nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat'
OLD_T = '/nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat'
NEW_T = '/nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_hr,/nasq_chat'
EXPECTED = {  # path: (module lists, test-tag lists)
    '.woodpecker.yml': (4, 1),
    'deploy/woodpecker/image.yml': (1, 0),
    'deploy/provision.sh': (1, 0),
    'deploy/verification-checks.json': (1, 1),
    'deploy/OPERATIONS.md': (2, 1),
    'tools/check_cp1_scratch.py': (1, 0),
    'tools/shared_acceptance_live/up.sh': (1, 0),
}
for name, (modules, tags) in EXPECTED.items():
    path = Path(name)
    text = path.read_text(encoding='utf-8')
    found = (text.count(OLD_T), text.count(OLD_I))
    assert found == (tags, modules), f'{name}: found {found}, expected {(tags, modules)}'
    path.write_text(text.replace(OLD_T, NEW_T).replace(OLD_I, NEW_I), encoding='utf-8')
    print(f'{name}: {modules} module list(s), {tags} test-tag list(s)')
PY
```

Expected: seven lines, one per file, and no assertion error.

- [ ] **Step 2: Update the Python tuples and their pin**

In `deploy/check_isolated.py` replace:

```python
NASQ_ADDONS = ('nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat')
```

with:

```python
NASQ_ADDONS = (
    'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory',
    'nasq_pmo', 'nasq_hr', 'nasq_chat',
)
```

In `deploy/test_operations.py` replace:

```python
        self.assertEqual(
            check_isolated.NASQ_ADDONS,
            ('nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat'),
        )
```

with:

```python
        self.assertEqual(
            check_isolated.NASQ_ADDONS,
            (
                'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory',
                'nasq_pmo', 'nasq_hr', 'nasq_chat',
            ),
        )
```

In `tools/nasq_cli/operator.py` replace:

```python
CREATE_MODULES = ('nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo',
                  'nasq_hr', 'nasq_chat')
```

with:

```python
CREATE_MODULES = ('nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify',
                  'nasq_directory', 'nasq_pmo', 'nasq_hr', 'nasq_chat')
```

In `tools/shared_saas_lifecycle/odoo_effect.py` replace:

```python
ALLOWED_MODULES = {'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo', 'nasq_hr', 'nasq_chat'}
```

with:

```python
ALLOWED_MODULES = {
    'nasq_core', 'nasq_platform', 'nasq_api', 'nasq_notify', 'nasq_directory',
    'nasq_pmo', 'nasq_hr', 'nasq_chat',
}
```

- [ ] **Step 3: Run the repository checks these files feed**

```bash
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
python3 -B tools/catalog_check.py
python3 -c "import yaml; yaml.safe_load(open('.woodpecker.yml')); yaml.safe_load(open('deploy/woodpecker/image.yml')); print('yaml ok')"
bash -n deploy/provision.sh && bash -n tools/shared_acceptance_live/up.sh && echo "shell ok"
python3 -c "import json; json.load(open('deploy/verification-checks.json')); print('json ok')"
rg -n "nasq_api,nasq_pmo|/nasq_api,/nasq_pmo" .woodpecker.yml deploy tools --glob '!**/node_modules/**'
```

Expected: both unittest runs end with `OK`; `CATALOG_OK solutions=2`; `yaml ok` (if `yaml` is not importable, skip that line and say so); `shell ok`; `json ok`; the last search prints only `tools/shared_saas_lifecycle/lifecycle.py:168`, `tools/saas_commercial_acceptance/commercial_lifecycle.py:180` and the four `deploy/test_operations.py` argument fixtures (`modules='nasq_core,nasq_api,nasq_pmo,nasq_hr'`), all left alone on purpose.

- [ ] **Step 4: Commit**

```bash
git add .woodpecker.yml deploy/woodpecker/image.yml deploy/provision.sh deploy/verification-checks.json \
  deploy/OPERATIONS.md deploy/check_isolated.py deploy/test_operations.py tools/check_cp1_scratch.py \
  tools/shared_acceptance_live/up.sh tools/nasq_cli/operator.py tools/shared_saas_lifecycle/odoo_effect.py
git commit -m "ci(ci): install and test nasq_notify and nasq_directory"
```

---

### Task 7: Prove the upgrade keeps every notification row for the same recipients

This mirrors the CI `upgrade` step (`.woodpecker.yml` lines 88-125) twice: from the commit this branch started from (current `main`) and from `release/19.0.1.0.0`. Nothing is committed in this task.

**Files:**
- Create (outside the repo): `/tmp/nasq-notify/notify_fixture.py`, `/tmp/nasq-notify/notify_assert.py`, `/tmp/nasq-notify/base-main`, `/tmp/nasq-notify/base-release` (temporary detached worktrees)

**Interfaces:**
- Consumes: the migration constants of Task 5 (`MOVED_FIELDS`, `ADOPTED_FIELDS`, `CONSTRAINT`, `CONSTRAINT_XMLID`), `nasq.notify.service._nasq_domain/_nasq_visible_rows/_nasq_visible_count` and `nasq.notify.registry._nasq_notify_dump` (Task 4).

- [ ] **Step 1: Write the fixture and assertion scripts**

```bash
cat > /tmp/nasq-notify/notify_fixture.py <<'FIXTURE'
# Piped into `odoo-bin shell` on a base database running the base code
# (current main or release/19.0.1.0.0). Creates bell rows through every
# producer path, then snapshots the rows and what each recipient sees.
import json
import sys
from datetime import timedelta
from types import SimpleNamespace

from odoo import Command, fields

from odoo.addons.nasq_pmo.controllers import notifications as bell
from odoo.addons.nasq_pmo.serializers.notification import dump_notification

assert env.cr.dbname.startswith('nasq_scratch_notify_'), env.cr.dbname  # noqa: F821
SNAPSHOT = f'/tmp/nasq-notify/upgrade-before-{env.cr.dbname}.json'  # noqa: F821
ROWS_SQL = """
    SELECT n.id, n.res_partner_id, n.is_read, n.notification_type, m.id, m.nasq_notification_kind,
           m.nasq_notification_key, m.model, m.res_id, m.nasq_task_id, m.nasq_meeting_id,
           m.nasq_digest_count, m.nasq_digest_date::text, m.nasq_digest_task_ids
      FROM mail_notification n JOIN mail_message m ON m.id = n.mail_message_id
     WHERE m.nasq_notification ORDER BY n.id
"""
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


employee = ref('nasq_core.group_employee')
meetings_read = ref('nasq_pmo.group_cap_meetings_read', 'nasq_core.group_cap_meetings_read')
project_manager = ref('project.group_project_manager')
alice = make_user('notify_alice', [employee, meetings_read])
bob = make_user('notify_bob', [employee, meetings_read])
mona = make_user('notify_mona', [employee, project_manager, meetings_read])
users = alice | bob | mona

Task = env['project.task']  # noqa: F821
project = env['project.project'].create({'name': 'Notify upgrade project', 'company_id': company.id, 'user_id': mona.id})  # noqa: F821
task = Task.with_user(mona).create({
    'name': 'Notify upgrade task', 'project_id': project.id, 'user_ids': [Command.set([alice.id, bob.id])],
})
task.with_user(mona).with_context(nasq_mention_user_ids=[alice.id]).message_post(
    body='Upgrade comment', message_type='comment', subtype_xmlid='mail.mt_comment',
)
deadline_key = f'deadline:{task.id}:{alice.partner_id.id}:upgrade-proof'
task._nasq_create_notification(kind='deadline', partner=alice.partner_id, body='Upgrade deadline', key=deadline_key)
overdue = Task.create({
    'name': 'Notify upgrade overdue', 'project_id': project.id, 'company_id': company.id,
    'user_ids': [Command.set([mona.id])], 'date_deadline': fields.Datetime.now() - timedelta(days=3),
})
digest_key = f'overdue_digest:{company.id}:{mona.partner_id.id}:upgrade-proof'
Task._nasq_create_digest_notification(
    company=company, partner=mona.partner_id, body='1 overdue tasks', key=digest_key,
    overdue_count=1, local_date=fields.Date.today(), task_ids=[overdue.id],
)
private = env['project.project'].create({  # noqa: F821
    'name': 'Notify hidden project', 'privacy_visibility': 'followers', 'company_id': company.id, 'user_id': mona.id,
})
hidden_task = Task.create({
    'name': 'Notify hidden task', 'project_id': private.id, 'company_id': company.id,
    'user_ids': [Command.set([mona.id])],
})
hidden_task._nasq_create_notification(kind='assignment', partner=bob.partner_id, body='Hidden from Bob')
Meeting = env['cyan.meeting.minute']  # noqa: F821
meeting = Meeting.create({
    'state': 'draft', 'name': 'Notify upgrade meeting', 'organizer_id': mona.id,
    'attendee_ids': [Command.set([alice.id, bob.id])],
})
meeting._nasq_notify_partners(alice.partner_id, 'meeting_changed', 'Moved')
hidden_meeting = Meeting.create({'state': 'draft', 'name': 'Notify hidden meeting', 'organizer_id': mona.id})
hidden_meeting._nasq_notify_partners(bob.partner_id, 'meeting_invite', 'Hidden meeting', key=f'meeting-invite:{hidden_meeting.id}')
first = env['mail.notification'].sudo().search([  # noqa: F821
    ('res_partner_id', '=', alice.partner_id.id), ('mail_message_id.nasq_notification', '=', True),
], order='id', limit=1)
first.is_read = True
env.flush_all()  # noqa: F821


def visible(user):
    bell.request = SimpleNamespace(env=env(user=user.id))  # noqa: F821
    controller = bell.NotificationController()
    domain = controller._domain()
    return {
        'items': [dump_notification(row, live) for row, live in controller._visible_rows(domain)],
        'total': controller._visible_count(domain),
        'unread_count': controller._visible_count(domain + [('is_read', '=', False)]),
    }


seen = {user.login: visible(user) for user in users}
expect = {
    'notify_alice': {'assignment', 'mention', 'deadline', 'meeting_invite', 'meeting_changed'},
    'notify_bob': {'assignment', 'comment', 'meeting_invite'},
    'notify_mona': {'assignment', 'overdue_digest'},
}
problems = [
    f'{login} sees {sorted({item["kind"] for item in seen[login]["items"]})}, expected at least {sorted(kinds)}'
    for login, kinds in expect.items() if not kinds <= {item['kind'] for item in seen[login]['items']}
]
bob_items = seen['notify_bob']['items']
if any(item.get('task_id') == hidden_task.id or item.get('meeting_id') == hidden_meeting.id for item in bob_items):
    problems.append('bob sees a hidden row before the upgrade')
if not seen['notify_alice']['total'] > seen['notify_alice']['unread_count']:
    problems.append('alice has no read row')
env.cr.execute(ROWS_SQL)  # noqa: F821
rows = [list(row) for row in env.cr.fetchall()]  # noqa: F821
for problem in problems:
    print(f'UPGRADE_FIXTURE_FAIL {problem}')
if problems:
    sys.exit(1)
with open(SNAPSHOT, 'w', encoding='utf-8') as handle:
    json.dump({
        'rows': rows, 'visible': seen, 'task_id': task.id, 'deadline_key': deadline_key,
        'digest_key': digest_key, 'hidden_meeting_id': hidden_meeting.id,
    }, handle, ensure_ascii=False, indent=1, sort_keys=True)
env.cr.commit()  # noqa: F821
print(f"UPGRADE_FIXTURE_OK rows={len(rows)} users={len(seen)}")
sys.exit(0)
FIXTURE
cat > /tmp/nasq-notify/notify_assert.py <<'ASSERT'
# Piped into `odoo-bin shell` on the upgraded database, running the branch code.
# Every bell row survives unchanged, each recipient sees exactly what they saw
# before, ownership moved to nasq_notify, and no producer delivers twice.
import importlib.util
import json
import sys

from odoo.fields import Domain
from odoo.tools.misc import file_path

SNAPSHOT = f'/tmp/nasq-notify/upgrade-before-{env.cr.dbname}.json'  # noqa: F821
ROWS_SQL = """
    SELECT n.id, n.res_partner_id, n.is_read, n.notification_type, m.id, m.nasq_notification_kind,
           m.nasq_notification_key, m.model, m.res_id, m.nasq_task_id, m.nasq_meeting_id,
           m.nasq_digest_count, m.nasq_digest_date::text, m.nasq_digest_task_ids
      FROM mail_notification n JOIN mail_message m ON m.id = n.mail_message_id
     WHERE m.nasq_notification ORDER BY n.id
"""
KINDS = (
    'assignment', 'comment', 'mention', 'deadline', 'overdue_digest', 'meeting_invite', 'meeting_resolution',
    'meeting_converted', 'meeting_changed', 'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)
spec = importlib.util.spec_from_file_location(
    'nasq_pmo_pre_hand_bell_columns', file_path('nasq_pmo/migrations/19.0.1.3.0/pre-hand_bell_columns_to_nasq_notify.py'),
)
move = importlib.util.module_from_spec(spec)
spec.loader.exec_module(move)
with open(SNAPSHOT, encoding='utf-8') as handle:
    before = json.load(handle)
cr = env.cr  # noqa: F821
problems = []

cr.execute(ROWS_SQL)
rows = [list(row) for row in cr.fetchall()]
if rows != before['rows']:
    problems.append(f'bell rows changed: before={len(before["rows"])} after={len(rows)}')

for login, expected in sorted(before['visible'].items()):
    user = env['res.users'].search([('login', '=', login)])  # noqa: F821
    user_env = env(user=user.id)  # noqa: F821
    service = user_env['nasq.notify.service']
    registry = user_env['nasq.notify.registry']
    domain = service._nasq_domain()
    actual = json.loads(json.dumps({
        'items': [registry._nasq_notify_dump(row, extra) for row, extra in service._nasq_visible_rows(domain)],
        'total': service._nasq_visible_count(domain),
        'unread_count': service._nasq_visible_count(domain & Domain('is_read', '=', False)),
    }))
    if actual != expected:
        problems.append(f'{login}: before={expected} after={actual}')

names = [*move.ADOPTED_FIELDS, move.CONSTRAINT_XMLID]
cr.execute('SELECT module, name FROM ir_model_data WHERE name = ANY(%s) AND module IN %s', [names, ('nasq_pmo', 'nasq_notify')])
owned = set(cr.fetchall())
problems += [f'nasq_notify.{name} missing' for name in names if ('nasq_notify', name) not in owned]
problems += [f'nasq_pmo.{name} still exists' for name in (*move.MOVED_FIELDS, move.CONSTRAINT_XMLID) if ('nasq_pmo', name) in owned]
for column in ('nasq_task_id', 'nasq_meeting_id', 'nasq_digest_count', 'nasq_digest_date', 'nasq_digest_task_ids'):
    if not env.ref(f'nasq_pmo.field_mail_message__{column}', raise_if_not_found=False):  # noqa: F821
        problems.append(f'nasq_pmo lost {column}')
for kind in KINDS:
    if not env.ref(f'nasq_pmo.selection__mail_message__nasq_notification_kind__{kind}', raise_if_not_found=False):  # noqa: F821
        problems.append(f'selection value {kind} lost')
cr.execute(
    'SELECT m.name FROM ir_model_constraint c JOIN ir_module_module m ON m.id = c.module WHERE c.name = %s',
    [move.CONSTRAINT],
)
if sorted(row[0] for row in cr.fetchall()) != ['nasq_notify']:
    problems.append('the unique index is not owned by nasq_notify alone')
cr.execute('SELECT indexdef FROM pg_indexes WHERE indexname = %s', [move.CONSTRAINT])
index = cr.fetchone()
if not index or 'UNIQUE' not in index[0]:
    problems.append(f'unique index missing: {index}')

alice = env['res.users'].search([('login', '=', 'notify_alice')])  # noqa: F821
bob = env['res.users'].search([('login', '=', 'notify_bob')])  # noqa: F821
mona = env['res.users'].search([('login', '=', 'notify_mona')])  # noqa: F821
Message = env['mail.message'].sudo()  # noqa: F821
if env['project.task'].browse(before['task_id'])._nasq_create_notification(  # noqa: F821
    kind='deadline', partner=alice.partner_id, body='again', key=before['deadline_key'],
):
    problems.append('the deadline key delivered twice')
if env['project.task']._nasq_create_digest_notification(  # noqa: F821
    company=env.company, partner=mona.partner_id, body='again', key=before['digest_key'],  # noqa: F821
    overdue_count=1, local_date='2026-01-02',
):
    problems.append('the digest key delivered twice')
meeting_key = f"meeting-invite:{before['hidden_meeting_id']}"
env['cyan.meeting.minute'].browse(before['hidden_meeting_id'])._nasq_notify_partners(  # noqa: F821
    bob.partner_id, 'meeting_invite', 'again', key=meeting_key,
)
if Message.search_count([('nasq_notification_key', '=', f'{meeting_key}:{bob.partner_id.id}')]) != 1:
    problems.append('the meeting invite key delivered twice')
cr.rollback()

for problem in problems:
    print(f'UPGRADE_PROOF_FAIL {problem}')
print('UPGRADE_PROOF_FAILED' if problems else f"UPGRADE_PROOF_OK rows={len(rows)} users={len(before['visible'])}")
sys.exit(1 if problems else 0)
ASSERT
python3 -m py_compile /tmp/nasq-notify/notify_fixture.py /tmp/nasq-notify/notify_assert.py && echo "scripts compile"
```

Expected: `scripts compile`.

- [ ] **Step 2: Upgrade from the current main**

```bash
git worktree add --detach /tmp/nasq-notify/base-main "$(git merge-base HEAD main)"
git -C /tmp/nasq-notify/base-main log -1 --oneline
/tmp/nasq-notify/odoo-run.sh base nasq_scratch_notify_up_main /tmp/nasq-notify/base-main \
  nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat
/tmp/nasq-notify/odoo-run.sh shell nasq_scratch_notify_up_main /tmp/nasq-notify/base-main \
  < /tmp/nasq-notify/notify_fixture.py | tee /tmp/nasq-notify/logs/up-main-fixture.log
grep -q UPGRADE_FIXTURE_OK /tmp/nasq-notify/logs/up-main-fixture.log && echo "fixture ok"
/tmp/nasq-notify/odoo-run.sh upgrade nasq_scratch_notify_up_main \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat
grep -n "pre-hand_bell_columns_to_nasq_notify" /tmp/nasq-notify/logs/nasq_scratch_notify_up_main-upgrade.log
/tmp/nasq-notify/odoo-run.sh shell nasq_scratch_notify_up_main /Users/tariq/code/nasq-notify \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/nasq-notify/logs/up-main-smoke.log
/tmp/nasq-notify/odoo-run.sh shell nasq_scratch_notify_up_main /Users/tariq/code/nasq-notify \
  < /tmp/nasq-notify/notify_assert.py | tee /tmp/nasq-notify/logs/up-main-assert.log
grep -q UPGRADE_PROOF_OK /tmp/nasq-notify/logs/up-main-assert.log && echo "upgrade from main ok"
```

Expected: the merge-base commit (`350e7eb1` unless `main` moved), `ODOO_RUN_BASE_OK`, `UPGRADE_FIXTURE_OK rows=N users=3`, `fixture ok`, `ODOO_RUN_UPGRADE_OK` (the log guard found no `ERROR`/`CRITICAL` line), at least one log line naming `pre-hand_bell_columns_to_nasq_notify`, `UPGRADE_SMOKE_OK installed=8`, `UPGRADE_PROOF_OK rows=N users=3`, `upgrade from main ok`. Any `UPGRADE_FIXTURE_FAIL` or `UPGRADE_PROOF_FAIL` line is a blocker: stop and report it with the log.

- [ ] **Step 3: Upgrade from release/19.0.1.0.0, as CI does**

```bash
git worktree add --detach /tmp/nasq-notify/base-release release/19.0.1.0.0
git -C /tmp/nasq-notify/base-release log -1 --oneline
/tmp/nasq-notify/odoo-run.sh base nasq_scratch_notify_up_release /tmp/nasq-notify/base-release \
  nasq_core,nasq_api,nasq_pmo,nasq_hr,nasq_chat
/tmp/nasq-notify/odoo-run.sh shell nasq_scratch_notify_up_release /tmp/nasq-notify/base-release \
  < /tmp/nasq-notify/notify_fixture.py | tee /tmp/nasq-notify/logs/up-release-fixture.log
grep -q UPGRADE_FIXTURE_OK /tmp/nasq-notify/logs/up-release-fixture.log && echo "fixture ok"
/tmp/nasq-notify/odoo-run.sh upgrade nasq_scratch_notify_up_release \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat
grep -n "pre-hand_bell_columns_to_nasq_notify\|pre-move_app_xmlids" /tmp/nasq-notify/logs/nasq_scratch_notify_up_release-upgrade.log
/tmp/nasq-notify/odoo-run.sh shell nasq_scratch_notify_up_release /Users/tariq/code/nasq-notify \
  < deploy/odoo/upgrade_smoke.py | tee /tmp/nasq-notify/logs/up-release-smoke.log
/tmp/nasq-notify/odoo-run.sh shell nasq_scratch_notify_up_release /Users/tariq/code/nasq-notify \
  < /tmp/nasq-notify/notify_assert.py | tee /tmp/nasq-notify/logs/up-release-assert.log
grep -q UPGRADE_PROOF_OK /tmp/nasq-notify/logs/up-release-assert.log && echo "upgrade from release ok"
```

Expected: `f9b961b5` for the tag (no `nasq_platform` there, so the base install is unclassified, as in CI), `ODOO_RUN_BASE_OK`, `UPGRADE_FIXTURE_OK`, `fixture ok`, `ODOO_RUN_UPGRADE_OK`, log lines for both `pre-move_app_xmlids` and `pre-hand_bell_columns_to_nasq_notify`, `UPGRADE_SMOKE_OK installed=8`, `UPGRADE_PROOF_OK`, `upgrade from release ok`.

- [ ] **Step 4: Clean up**

```bash
/tmp/nasq-notify/odoo-run.sh drop nasq_scratch_notify_up_main
/tmp/nasq-notify/odoo-run.sh drop nasq_scratch_notify_up_release
git worktree remove /tmp/nasq-notify/base-main
git worktree remove /tmp/nasq-notify/base-release
git worktree list
```

Expected: both base worktrees are gone; the main checkout and `/Users/tariq/code/nasq-notify` remain. Keep the logs for the report.

---

### Task 8: API surface, final gates, documentation and roadmap

**Files:**
- Create (outside the repo): `/tmp/nasq-notify/openapi_compare.py`
- Modify: `docs/api/openapi.json` (regenerated)
- Modify: `CLAUDE.md` (repository layout, sudo policy, R10 note, check commands, attachment rule), `AGENTS.md:36,181-185`, `README.md:102-104`, `docs/parallel-work.md:24-26`, `docs/superpowers/plans/2026-10-05-architecture-roadmap.md:3,16-17,79-89`

- [ ] **Step 1: Compare the API surface under ruling H.8**

```bash
cat > /tmp/nasq-notify/openapi_compare.py <<'COMPARE'
"""Compare two generated openapi.json documents under ruling H.8 (plan 2b-1, Deviation 7)."""
import copy
import json
import sys

MOVED = {
    ('get', '/api/v1/notifications'): 'nasq_notify',
    ('post', '/api/v1/notifications/{notification_id}/read'): 'nasq_notify',
    ('post', '/api/v1/notifications/read-all'): 'nasq_notify',
    ('get', '/api/v1/people'): 'nasq_directory',
}
ALLOWED = ('addon', 'controller', 'contract_namespace', 'feature_keys')


def operations(doc):
    return {(method, path): op for path, item in doc['paths'].items() for method, op in item.items()}


def normalized(op):
    op = copy.deepcopy(op)
    for name in ALLOWED:
        op['x-nasq'].pop(name, None)
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
changed = {}
for key in sorted(set(old) & set(new)):
    if old[key] == new[key]:
        continue
    changed[key] = new[key]['x-nasq']['addon']
    if normalized(old[key]) != normalized(new[key]):
        problems.append(f'{key}: differs outside x-nasq {ALLOWED}, tags and operationId')
    print(
        f'{key[0].upper()} {key[1]}: addon {old[key]["x-nasq"]["addon"]} -> {new[key]["x-nasq"]["addon"]}, '
        f'feature_keys {old[key]["x-nasq"]["feature_keys"]} -> {new[key]["x-nasq"]["feature_keys"]}',
    )
if changed != MOVED:
    problems.append(f'changed operations {changed} != expected {MOVED}')
if {k: v for k, v in before.items() if k not in ('paths', 'tags')} != {k: v for k, v in after.items() if k not in ('paths', 'tags')}:
    problems.append('components, info or servers differ')
if after['tags'] != sorted({*before['tags'], 'nasq_directory', 'nasq_notify'}):
    problems.append(f'tags {after["tags"]}')
for problem in problems:
    print(f'API_SURFACE_FAIL {problem}')
print('API_SURFACE_FAILED' if problems else f'API_SURFACE_OK operations={len(new)} moved={len(changed)}')
sys.exit(1 if problems else 0)
COMPARE
python3 -B tools/api_surface.py
python3 /tmp/nasq-notify/openapi_compare.py /tmp/nasq-notify/openapi-before.json docs/api/openapi.json
```

Expected: four lines, for example `GET /api/v1/notifications: addon nasq_pmo -> nasq_notify, feature_keys ['pmo.enabled', 'meetings.enabled'] -> ['registry:nasq.notify.registry']`, `GET /api/v1/people: addon nasq_pmo -> nasq_directory, feature_keys ['pmo.enabled', 'meetings.enabled'] -> ['registry:nasq.directory']`, and the two notification writes with only the addon changed; then `API_SURFACE_OK operations=… moved=4`. Any `API_SURFACE_FAIL` is a blocker. Keep the regenerated `docs/api/openapi.json` (it also absorbs the staleness that already existed on `main`, see Global Constraints).

- [ ] **Step 2: Commit the regenerated document**

```bash
python3 -B tools/api_surface.py --check
git add docs/api/openapi.json
git commit -m "docs(docs): regenerate openapi.json after the 2b-1 moves"
```

Expected: `openapi.json is up to date`.

- [ ] **Step 3: Update CLAUDE.md**

Replace:

```markdown
- `odoo-addons/nasq_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, recipient notifications,
  and `/api/v1/people` (the task assignee picker, whose ids are `res.users`
  ids).
```

with:

```markdown
- `odoo-addons/nasq_notify` (shared service, rank 3) owns the notification bell:
  the generic `mail.message` columns `nasq_notification`, `nasq_notification_kind`
  and `nasq_notification_key` with its unique index, the `nasq.notify.registry`
  where applications register their notification kinds, delivery
  (`nasq.notify.service._nasq_deliver`) and `/api/v1/notifications`. It names no
  application.
- `odoo-addons/nasq_directory` (shared service, rank 3) owns `/api/v1/people`
  (the user-id picker, whose ids are `res.users` ids) and its population of
  active internal users of the current company; applications that pick people
  register their feature keys in `nasq.directory`.
- `odoo-addons/nasq_pmo` owns projects, tasks, timelines, project settings,
  attachments, dependencies, archive/restore, and its notification kinds,
  producers and `/api/v1/notification-digests`.
```

Replace:

```markdown
- `nasq_hr` has no `sudo()` path. In PMO, only the documented manager-write,
  policy/config, display-lookup, integer-count, completion-status and notification cases use `sudo()` after the
  caller's authorization check; do not add another case without documenting
  it and fixing ACLs/rules where possible.
```

with:

```markdown
- `nasq_hr` has no `sudo()` path. In PMO, only the documented manager-write,
  policy/config, display-lookup, integer-count, completion-status and notification
  cron/candidate cases use `sudo()` after the caller's authorization check;
  `nasq_notify` uses it only for bell delivery and recipient-owned bell reads.
  Do not add another case without documenting it and fixing ACLs/rules where
  possible.
```

Replace:

```markdown
- Documented PMO elevated operations are policy/config access, policy-based
  project creation, checked manager mutations, serializer display lookups,
  integer counts, automatic completion status after an authorized task
  mutation, and notification delivery/recipient-owned reads. Notification
  elevated reads must first restrict recipient and readable current-company
  tasks or meetings; resource lookup stays in the caller's ordinary ACL and
  record-rule environment. Meeting-only access must not reveal task/digest
  notifications. Do not add an undocumented bypass.
```

with:

```markdown
- Documented PMO elevated operations are policy/config access, policy-based
  project creation, checked manager mutations, serializer display lookups,
  integer counts, automatic completion status after an authorized task
  mutation, the notification cron scans, and the recipient-owned candidate
  lookups that build PMO's notification visibility branches. `nasq_notify`'s
  documented elevated operations are bell delivery and recipient-owned bell
  reads: every elevated read first restricts to the current partner's inbox
  rows, and the owning application's branch decides, in the caller's ordinary
  ACL and record-rule environment, which tasks or meetings are still readable.
  Meeting-only access must not reveal task/digest notifications. Do not add an
  undocumented bypass.
```

Replace:

```markdown
- **R10** Each application registers its `<app>.enabled` feature, sub-features, limits and counters in
  `nasq.feature.registry` with `owner` set to its addon name, and every route checks its feature.
```

with:

```markdown
- **R10** Each application registers its `<app>.enabled` feature, sub-features, limits and counters in
  `nasq.feature.registry` with `owner` set to its addon name, and every route checks its feature. A
  shared service (rank 3) gates its routes with `requires_registered_feature`, whose keys the
  applications register in that service's registry.
```

Replace:

```markdown
- Task attachment uploads accept PDF, PNG, JPEG, text, DOCX and XLSX up to
  10 MiB decoded, with exact binary task linkage and ordinary attachment ACLs.
```

with:

```markdown
- Task attachment uploads accept PDF, PNG, JPEG, text, DOCX and XLSX up to
  10 MiB decoded, with exact binary task linkage and ordinary attachment ACLs.
  The validator is `nasq_api/serializers/attachment.py`, shared by task,
  meeting and chat uploads; HR documents keep their own parser.
```

Replace in the check-commands block:

```
  -i nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  --test-tags /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat \
```

with:

```
  -i nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  --test-tags /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_hr,/nasq_chat \
```

- [ ] **Step 4: Update AGENTS.md, README.md and docs/parallel-work.md**

In `AGENTS.md` replace:

```markdown
- The HR page is `/hr`; `/api/v1/people` remains the PMO user-id picker. Preserve
```

with:

```markdown
- The HR page is `/hr`; `/api/v1/people` remains the user-id picker (owned by `nasq_directory`). Preserve
```

and replace:

```markdown
- Declare real dependencies: core uses `base`, `project`, `hr`,
  `cyan_meeting_minutes`; HR uses `nasq_api`, `hr`, `mail`; PMO also uses
  `nasq_platform`, `project`, `bus`, `cyan_meeting_minutes` (see manifests).
  Preserve pillar direction: shared `nasq_api` never imports a pillar.
```

with:

```markdown
- Declare real dependencies: core uses `base` only; HR uses `nasq_api`, `hr`,
  `mail`; the shared services `nasq_notify` (`nasq_api`, `mail`) and
  `nasq_directory` (`nasq_api`) know no application; PMO also uses
  `nasq_platform`, `nasq_notify`, `nasq_directory`, `project`, `bus`,
  `cyan_meeting_minutes` (see manifests). Preserve pillar direction: shared
  `nasq_api` and the shared services never import a pillar.
```

In `README.md` replace:

```markdown
  `nasq_api` owns shared API plumbing; `nasq_pmo` owns projects/tasks and the
  user-id people picker; `nasq_hr` owns HR routes, documents, and employee
  directory behavior.
```

with:

```markdown
  `nasq_api` owns shared API plumbing; the shared services `nasq_notify` (the
  notification bell) and `nasq_directory` (the user-id people picker) know no
  application; `nasq_pmo` owns projects/tasks; `nasq_hr` owns HR routes,
  documents, and employee directory behavior.
```

In `docs/parallel-work.md` replace:

```markdown
| Odoo addon | `nasq_api`, plus `nasq_core` system/access groups and branding; each app owns its capability groups | `nasq_pmo` | `nasq_hr` |
| Controllers and serializers | `nasq_api` common/auth/branding/me | `nasq_pmo/**` | `nasq_hr/**` |
| Tests | shared fixture and `nasq_api` tests | `nasq_pmo/tests/**` | `nasq_hr/tests/**` |
```

with:

```markdown
| Odoo addon | `nasq_api`, `nasq_notify`, `nasq_directory`, plus `nasq_core` system/access groups and branding; each app owns its capability groups | `nasq_pmo` | `nasq_hr` |
| Controllers and serializers | `nasq_api` common/auth/branding/me/attachment, `nasq_notify` bell routes, `nasq_directory` people route | `nasq_pmo/**` | `nasq_hr/**` |
| Tests | shared fixture, `nasq_api`, `nasq_notify` and `nasq_directory` tests | `nasq_pmo/tests/**` | `nasq_hr/tests/**` |
```

- [ ] **Step 5: Update the roadmap**

In `docs/superpowers/plans/2026-10-05-architecture-roadmap.md` replace:

```markdown
**آخر تحديث:** 2026-10-05، عند `e4e008f4` على `main`.
```

with:

```markdown
**آخر تحديث:** 2026-10-06، عند `350e7eb1` على `main`، مع فرع المرحلة 2ب-1.
```

replace:

```markdown
| 2 | فك الأساس | `nasq_core` لا يعرف أي تطبيق | 1 | منفذة على `codex/core-decouple-apps`، بانتظار الدمج |
| 2ب | فصل الخدمات والاجتماعات | `nasq_pmo` = مشاريع ومهام فقط | 2 | لم تبدأ |
```

with:

```markdown
| 2 | فك الأساس | `nasq_core` لا يعرف أي تطبيق | 1 | **مدموجة** (`85c0ae41`) |
| 2ب | فصل الخدمات والاجتماعات | `nasq_pmo` = مشاريع ومهام فقط | 2 | 2ب-1 منفذة على `codex/api-notify-directory`، بانتظار الدمج؛ 2ب-2 لم تبدأ |
```

replace:

```markdown
4. يُحسم بعد قراءة الكود: هل يستحق منتقي الأشخاص (`nasq_directory`) وقواعد المرفقات (`nasq_files`) إضافتين مستقلتين.
```

with:

```markdown
4. حُسم بعد قراءة الكود: `nasq_directory` إضافة مستقلة تملك `/api/v1/people`؛ ولا `nasq_files` الآن، بل يصير مدقق
   رفع المرفقات واحداً في `nasq_api/serializers/attachment.py` تستعمله المهام والاجتماعات والمحادثة.

**التقسيم:** 2ب-1 = `nasq_notify` و`nasq_directory` والمدقق المشترك
([الخطة](2026-10-06-phase-2b1-notify-directory.md))؛ 2ب-2 = `nasq_meetings` والجسر `nasq_meetings_pmo`، تُكتب خطتها
بعد دمج 2ب-1.

**خط الأساس بعد 2ب-1** (المجموع): R7 85، R9 68، R10 0؛ الباقي كما بعد المرحلة 2.
```

- [ ] **Step 6: Run the final gates**

```bash
ruff check odoo-addons
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/catalog_check.py
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
rg -n "\b(project|hr|pmo|meetings|chat|cyan_meeting_minutes)\.[a-z_]|nasq_(pmo|hr|chat|meetings)" odoo-addons/nasq_notify odoo-addons/nasq_directory --glob '!tests/**' || echo "shared services name no application"
rg -n "odoo\.addons\.nasq_chat" odoo-addons/nasq_pmo; rg -n "odoo\.addons\.nasq_pmo" odoo-addons/nasq_chat odoo-addons/nasq_notify odoo-addons/nasq_directory
rg -n "controllers/people|serializers/task_attachment|parse_chat_attachment|_feature_key_for_row" odoo-addons tools docs/api || echo "no stale names"
npm test 2>&1 | tail -n 15
npm -w apps/web run lint 2>&1 | tail -n 5
```

Expected: `All checks passed!`; three `exit=0`; `CATALOG_OK solutions=2`; the deploy suite `OK`; `shared services name no application`; the two cross-import searches print nothing; `no stale names`; `npm test` ends green; the web type check passes (no web file changed, so a failure here is pre-existing — compare with `main` before calling it a regression).

Then run the three Odoo suites in the background, one after the other:

```bash
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_final \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_pmo,/nasq_hr,/nasq_chat
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_partial_final \
  nasq_core,nasq_platform,nasq_api,nasq_hr \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_hr
/tmp/nasq-notify/odoo-run.sh test nasq_scratch_notify_shared_final \
  nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_hr \
  /nasq_core,/nasq_platform,/nasq_api,/nasq_notify,/nasq_directory,/nasq_hr
```

Expected: three `ODOO_RUN_TEST_OK` lines (or exactly the pre-existing failures recorded in Task 0). Record the three test counts: the full count is Task 0's N plus the new tests.

- [ ] **Step 7: Commit the documentation**

```bash
git add CLAUDE.md AGENTS.md README.md docs/parallel-work.md docs/superpowers/plans/2026-10-05-architecture-roadmap.md
git commit -m "docs(docs): record nasq_notify and nasq_directory ownership"
git log --oneline main..HEAD
git status --short
```

Expected: nine commits on the branch (plan, Tasks 1-6, `openapi.json`, docs), each subject `type(scope): subject` of at most 72 characters, and a clean status.

- [ ] **Step 8: Report**

Report to the orchestrator: the base commit; the nine commit hashes and subjects; the arch totals before (Task 0 Step 5) and after (`R7 85`, `R10 0`, the rest unchanged); the `API_SURFACE_OK` line and the four changed operations; the Odoo test counts of Task 0 and of the three final runs (full, `core+platform+api+hr`, and with the two services); the two `UPGRADE_PROOF_OK` lines; the untracked copy of this plan in the main checkout that must be removed before the merge; and that catalog `base_modules` was left unchanged (Deviation 8) pending the owner's decision. Do not merge or push.
