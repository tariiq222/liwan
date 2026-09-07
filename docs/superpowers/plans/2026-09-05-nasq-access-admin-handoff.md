# Nasq access administration implementation handoff

> UI authority update — 2026-09-07: [DESIGN.md](../../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

Status: implemented and locally verified on 2026-09-05. This document is not release approval.

## Workspace and delivery boundary

- Task checkout: `/Users/tariq/code/nasq-access-admin`, branch `codex/access-admin`, based on `b17058a`.
- Canonical `/Users/tariq/code/nasq` remains on `main`; the last check was clean.
- No commit, merge, push, deployment, or source-worktree cleanup is authorized or performed.
- Stock `/Users/tariq/code/odoo` source and configuration are preserved.
- All addon test runs and fixture/database commands use explicitly isolated test databases. Never run these checks on `odoo19`.
- Selected Phase 3b and routed PMO inputs were adapted without Git integration. Source selection and hashes are recorded in `.access-work/baseline-files.txt` and `.access-work/internal-page-snapshot.sha256`.

## Implemented product structure

The Arabic/English sidebar has capability-filtered Projects, Human Resources, and System Administration groups. Desktop collapse and mobile inline expansion share the same navigation. Search has its own URL; account settings are separate.

| Area | Routes |
| --- | --- |
| Users | `/settings/users`, `/settings/users/new`, `/settings/users/:id`, `/settings/users/:id/access`, `/settings/users/:id/security` |
| Roles | `/settings/roles`, `/settings/roles/new`, `/settings/roles/:id`, `/settings/roles/:id/edit` |
| Audit and identity | `/settings/access-log`, `/settings/access-log/:id`, `/settings/branding`, `/account` |
| Employees | `/hr`, `/hr/employees/new`, `/hr/employees/:id`, `/hr/employees/:id/edit` |
| Departments | `/hr/departments`, `/hr/departments/new`, `/hr/departments/:id`, `/hr/departments/:id/edit` |
| Documents | `/hr/documents`, department-scoped document create/read/edit routes |
| Projects and tasks | Existing lists, project/task details, routed project/task creation, project settings, milestone creation/editing, and project updates |

HR employee ids remain `hr.employee`; access accounts and `/api/v1/people` use `res.users`. HR creates employee records; system administration grants and manages login accounts. Account disable preserves the employee record. Employee archive invokes the account guard atomically; restoration does not automatically restore login.

## Access model

- Built-in Employee, HR Manager, PMO Manager, System Administrator, and protected Vendor Support roles; custom roles select registered capabilities only.
- System administration does not implicitly grant HR or PMO management.
- Contextual project ownership and project creation policy are resolved by the server.
- Custom roles cannot carry the five protected access-changing capabilities.
- Disabled roles retain existing assignments and cannot receive new assignments.
- The server resolves current-company capabilities. UI permissions are not an authorization boundary.
- Managed identities retain that state even after all roles are removed, so legacy groups cannot silently restore removed capabilities.
- Versioned mutations use company/row locks and reject stale versions. Last-administrator protection is checked under a company lock.
- Account, role, and audit mutations use private checked model operations; no new `sudo()` path was added.
- Audit data excludes secret values. API errors roll back mutations before returning a handled error.

## Acceptance record

| Gate | Fresh result | Evidence |
| --- | --- | --- |
| Contracts and web unit tests | 68 contracts + 219 web passed | `/tmp/nasq-access-unit5.log` |
| Vue/TypeScript | Passed | `/tmp/nasq-access-types9.log` |
| Python static checks | Passed | `/tmp/nasq-access-ruff-final3.log` |
| Production web build | Passed with isolated proxy configuration | `/tmp/nasq-access-build-final.log` |
| Fresh Odoo installation | 221 tests, 0 failures, 0 errors | `/tmp/nasq-access-fresh2.log`; DB `nasq_access_fresh_final_20260905`, port 9370 |
| Upgrade from canonical pre-change addons | 221 tests, 0 failures, 0 errors | `/tmp/nasq-access-legacy-upgrade1.log`; DB `nasq_access_upgrade_20260905`, port 9371 |
| Repeated legacy migration | Same roles and exactly one audit per migrated identity after two upgrades | `/tmp/nasq-access-legacy-verify1.log`, `/tmp/nasq-access-legacy-verify2.log` |
| Migration failure rollback | Injected mid-migration failure leaves no assignments/audit/marker change; retry succeeds | `nasq_core/tests/test_access_migration.py`, included in 221-test gates |
| Backup restoration | Five fixture identities and pre-upgrade schema restored | `/tmp/nasq-access-rollback-proof.log`; DB `nasq_access_rollback_20260905` |
| Real concurrent last-admin changes | One commit, one rejection, one surviving administrator | `/tmp/nasq-access-concurrency6.log` |
| Real concurrent user/role versions | Each pair: one commit, one stale-version conflict, zero errors | `/tmp/nasq-access-versions3.log` |
| Complete Playwright suite | 53 passed, no failures or skips | `/tmp/nasq-access-e2e-final.log` |
| Arabic visual inspection | Desktop roles/navigation inspected; mobile RTL screenshot inspected | `apps/web/test-results/access-admin-navigation-su-82930-ansion-and-role-page-reload/mobile-roles.png` |

The 53 browser tests include separate system-admin/HR logins, role creation and audit, routed account granting, password reset/session invalidation, account disable/reactivation with the same id, read-only task API/ORM/UI enforcement, role removal, mobile navigation, employee and department CRUD/archive, document body and attachment persistence, project administration, search, hydration, and realtime updates. They are combined with backend tests for guards, current-company scope, protected roles, and migration behavior; they are not production evidence.

After the complete browser run, the only product change was adding the Arabic/English loading accessibility label. The final build includes that text-only correction. No business behavior changed after the 53-test run.

The pre-upgrade backup is `/tmp/nasq-access-pre-upgrade-20260905.dump`. It contains only disposable fixture data. Intermediate failed checkpoints are retained in `.access-work/progress-root.md` and `/tmp/nasq-access-*` logs; earlier failures were fixed or isolated as test-fixture assumptions before the green gates above.

Current preview configuration: web `127.0.0.1:3307`, Odoo `127.0.0.1:9369`, database `nasq_access_20260905`. The preview must be started with those explicit values; defaults point to other development work.

Both **build time and runtime** require `NUXT_ODOO_URL=http://127.0.0.1:9369`, `NUXT_ODOO_DB=nasq_access_20260905`, and `NUXT_PUBLIC_WS_URL=ws://127.0.0.1:9369/websocket`: the Nuxt `/web/**` and `/odoo/**` proxy rules are compiled into the build. Runtime-only overrides are insufficient. Odoo also uses `--db-filter='^nasq_access_20260905$'`, `--http-interface=127.0.0.1`, `--http-port=9369`, and `--max-cron-threads=0`.

An intermediate preview build retained the default `/web/**` proxy to port 8069 while the API used 9369. It caused cross-database session invalidation. That preview was stopped and rebuilt with the explicit configuration before the reported green browser suite. No fixture write to the default database was performed; the early browser preview is not counted as isolation evidence.

## Integration notes

- The implementation remains uncommitted in the task worktree. Canonical main and source worktrees are preserved.
- Custom role capabilities are deliberately bounded; supported user assignment forms require at least one role. Disable login to remove account access entirely.
- Admin password reset/reactivation invalidates sessions and records a safe audit. The protected operation suppresses Odoo's stock sender-fallback notification, which otherwise reads a foreign-company system user; self-service password-change notifications retain stock behavior.
- Dormant legacy UI components from the selected source snapshots remain unmounted. Active employee, department, document, account, role, project, and task business workflows use routed pages.
- A second independent security-review agent did not complete. Its first reported issues were addressed and covered by backend regressions and root verification; this handoff does not claim a completed independent re-review.
- Deployment requires separate authorization and an environment-specific backup, upgrade, and authenticated acceptance check.
