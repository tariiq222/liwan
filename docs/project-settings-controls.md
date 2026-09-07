# Project settings controls

> UI authority update — 2026-09-07: [DESIGN.md](../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

Creators and default stages are company fields with a read-only legacy
fallback: until a company saves, `get()` reads global
`nasq_pmo.project_creators` / `nasq_pmo.default_stages`. The first save
snapshots those values onto the current company and never mutates the global
keys. PSC requirement, approval, and reminder keys are per company
(`<key>.<company_id>`) and are not migrated from those globals.

## Routes

- `/settings/projects` — admin company policy
- `/projects/new` — create (creator-gated defaults)
- `/projects/{id}/settings` — per-project general settings
- `/tasks/{id}` — completion request / decide / withdraw
- `/notifications` — inbox
- `/notification-digests/{id}` — overdue digest detail

## Create requirements

`require_manager_on_create` and `require_end_date_on_create` default to true
and apply only when creating a project. Existing incomplete projects remain
editable. The create form defaults the manager to the current user once, then
respects a manual clear. It does not invent an end date.

Creators read `/api/v1/settings/projects/create-defaults`. Full settings stay
admin-only. A settings PATCH invalidates that create-defaults query key.

### Authority boundary

Stock superuser installation/import `project.create` is a documented
compatibility boundary: it does not receive the new required-on-create rules.
That exemption is not caller-controlled. Ordinary internal users,
`base.group_system` business API, and `_nasq_create_from_policy` (even when
the subsequent create is elevated) enforce manager, end date, default approval
snapshot, and `specific_user` eligibility after resolving actual values.

The verifier refuses `--database` values that do not fully match
`nasq_psc_[a-z0-9_]+`, including comma names such as `nasq_psc_x,odoo19`.

## Completion approval

Company default is `none` or `project_manager` and is snapshotted onto new
projects only. Existing projects retain their current policy. A project may
then use `none`, `project_manager`, or `specific_user`. The named person must
already have `pmo.tasks.approve` and project visibility; the choice does not
grant access. Self-approval is allowed.

Assignees with write request completion. The task stays open. The designated
reviewer accepts done or returns with a required trimmed note. The original
requester may withdraw a pending request while the reviewer is ineligible,
without changing state or granting access, then resubmit after an authorized
manager repairs the reviewer. `can_approve` remains the broad capability;
completion actions are record-specific `allowed_actions`.

Cancel, archive, closed state, policy/manager/requester changes clear the
pending request and invalidate the revision. Decision methods and advertised
actions reject closed/inactive tasks, inactive projects, and stale revisions.
Reopen requires a fresh request.

## Lone end date

Upstream `project.project.write` (addons/project/models/project_project.py
666–679) drops a lone `date` when `date_start` is empty. Nasq authorizes the
write, then continues with `super(StockProjectProject, records).write({'date':
value})` only for that lone-end portion. It does not call `models.Model.write`,
`_write`, or raw SQL. Mixed recordsets, paired dates, and explicit clears keep
stock pairing. Mail tracking and constraints still run on the continuation
MRO.

## Locking

Completion request/decide/withdraw and project policy/manager/archive lock
**project ids ascending, then task ids ascending**, then revalidate. Odoo
serialization retry is used; there is no ad-hoc commit/retry.

## Reminders and digest

Hourly cron `nasq_pmo.ir_cron_nasq_deadline_notifications` is unchanged.
Reminder candidate window is conservative UTC ±25h for DST; remaining days
stay 0..`days_before` (today included when 1). Task company_id must match the
running company. `days_remaining` / `is_overdue` use the recipient-local
deadline date.

The overdue digest is one inbox row per company, manager, and local date after
09:00 in the manager timezone (UTC fallback). Snapshot membership is
historical. Live list/count/detail use the caller environment only (no sudo
fallback). Ordinary notification counts stay SQL; only digest rows are
visibility-scanned.

## Documented sudo / markers

PMO sudo remains settings parameters, policy create for employees, manager
project write, integer counts, notification create, and digest generation then
re-check as the recipient. Completion metadata writes are scoped to explicit
task ids (`COMPLETION_META_IDS`). Task create forces pristine completion
metadata and does not trust `default_nasq_completion_*` context.

## Verifier

`scripts/verify-project-settings-controls.py` modes: `guard`, `race`,
`e2e-fixtures`, `upgrade`. It builds addons path internally, requires a free
loopback port and no foreign `pg_stat_activity` on the target DB before it
starts HTTP, and authenticates the session database so `_wait_http` cannot
attach to a different DB on the same port. Per-invocation files live under a
new temp directory; existing WP3 artifacts are not deleted.

Concurrency is **HTTP JSON sessions** for accept/policy/cancel/archive and
**two odoo-bin shell processes** for digest generation, with ready-file
barriers (not a blind sleep). Each digest run uses a unique
`2099-06-15` key that must not already exist. Duplicate digest keys return
false; an unrelated unique/integrity failure in a savepoint must still raise.

Legacy upgrade evidence is the local snapshot
`/var/folders/17/rgg6yjtn60d3jf_3xszmvtw00000gn/T/opencode/psc-loop2-wp3/base-addons`
plus `legacy-seed.py` / `legacy-verify.py` (not copied from another database).

## Evidence (scratch only, not a rollout)

Earlier failures retained:

- `e2e-run1.log` — 37 pass / 3 fail (cancel timeout, withdraw, projects URL)
- `race-run1.log` — XML-RPC user create Fault
- `race-run2.log` — private method Fault

Later:

- `e2e-run4.log` — 40 pass on previous weaker digest/toggle specs (do not treat
  as proof of the stricter assertions in this revision)
- `race-run3.log` / `race-run4.log` — HTTP accept 1 ok + 1 422; digest key
  reuse risk on the same calendar day
- `legacy-run1.log` — `SEED_OK` then `VERIFY_OK 1 7` twice
- `odoo-unit-run1.log` — 300 tests, 0 failed
- `lint-run1.log`, `npm-test-run1.log`, `nuxt-build.log` — exit 0

Fresh runs after this spec/verifier tightening (same tmp directory):

- `guard-comma-run2.log` — `--database nasq_psc_x,odoo19` rejected, exit 1
- `guard-ok.log` — valid scratch name accepted, exit 0
- `e2e-fixtures-run5.log` — 52 overdue tasks + cron seed
- `e2e-run5.log` / `e2e-run6.log` — incomplete/failed while Nuxt `.output` still
  proxied `/web/**` to `:8069`/`odoo19` (dbfilter rejected those sessions)
- `e2e-run7.log` — 39 passed / 2 failed (timeout + duplicate picker name)
- `e2e-run8.log` — 40 passed / 1 failed (specific_user accept before pending)
- `e2e-run9.log` — 41 passed, exit 0, after rebuild with
  `NUXT_ODOO_URL=http://127.0.0.1:9692` and
  `NUXT_ODOO_DB=nasq_psc_loop2_e2e_20260906`
- `race-run5.log` — accept 1 ok + 1 422; both digest workers OK; unique
  `2099-06-15` key; integrity probe OK; exit 0
- `lint-run2.log` / `npm-test-run2.log` — exit 0 (vue-tsc, ruff, 261 web tests)

Upstream Odoo source was not modified. Nothing here is production deployment.
