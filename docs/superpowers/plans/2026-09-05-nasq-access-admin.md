# Nasq Access Administration Implementation Plan

> UI authority update — 2026-09-07: [DESIGN.md](../../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

Execution record (2026-09-05): implementation and local acceptance are recorded in [the delivery handoff](2026-09-05-nasq-access-admin-handoff.md). The original step checklist below is retained as the execution specification; the handoff records actual checks and delivery boundaries.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver real Odoo-backed user, role, capability, access-audit, HR separation, PMO resource authorization, navigation, branding, and account behavior for the approved access administration UX.

**Architecture:** `nasq_core` owns a fixed capability catalog, protected and custom roles, company-scoped assignments, audit events, security groups, and guarded user mutations. `nasq_api` exposes typed administrative routes without importing a pillar; `nasq_hr` implements frozen employee-link hooks; `nasq_pmo` applies contextual project ownership. Nuxt treats `Me.capabilities` as fail-closed presentation data and trusts resource `allowed_actions` only after the server authorizes the record.

**Tech Stack:** Odoo 19 CE, Python 3, PostgreSQL transaction advisory locks, `type='json2'` controllers, Nuxt 4, Vue 3, TypeScript, Zod, TanStack Vue Query, Vitest, Vue Test Utils, and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-nasq-access-admin-ui-design.md`

## Global Constraints

- Treat `.access-work/contracts.md` as frozen. Update it through the lead and root integrator before changing a cross-package name or wire shape.
- Preserve the 75 selected phase-3b baseline files listed in `.access-work/baseline-files.txt`; adapt them instead of restoring old files or importing uncommitted work.
- Keep Odoo source at `/Users/tariq/code/odoo` read-only. Never run a test against `odoo19`.
- Add no `sudo()` or `with_user(SUPERUSER_ID)` authorization bypass. Do not give customer roles `base.group_erp_manager` to make user writes pass.
- Arabic is the default, RTL uses logical Tailwind classes, and every user-facing string lives in its owning locale file.
- Passwords and session material never enter a response, URL, cache, audit value, or test diagnostic.
- `/api/v1/people` keeps `res.users` ids; HR routes keep `hr.employee` ids; all lists use `{items,total}`.
- Do not commit, merge, push, deploy, remove worktrees, change source worktrees, or mutate a non-isolated database under this plan without separate authorization.
- Owners write tests first and stop. Root runs the focused red checkpoint once. Production code begins only after root announces that checkpoint.
- Workers do not run broad tests, builds, lint, Odoo runtime, or database setup. Root owns all test execution and final verification.

## File ownership and execution order

| Owner | Exclusive files | May consume | Must not edit |
| --- | --- | --- | --- |
| Root integrator | `packages/contracts/src/common/me.ts`, common/index and root barrel, `apps/web/app/utils/accessPolicy.ts`, `useAccess.ts`, `useMe.ts`, `useNav.ts`, route middleware, `AppSidebar.vue`, shared page components, `nuxt.config.ts`, common locales, branding/account adaptation, E2E, runtime | frozen contracts and every package output | pillar-owned files |
| Admin web/contracts worker | `packages/contracts/src/access/**`, `apps/web/app/components/access/**`, `useAdmin*.ts` and tests, settings users/roles/access-log pages, `access.json` locales | root helpers and shared components | common files, backend, HR, PMO |
| HR worker | `odoo-addons/nasq_hr/**`, `packages/contracts/src/hr/**`, HR web components/composables/pages/tests, `hr.json` locales | frozen core hooks and root helpers | core, API, PMO, shared files |
| Technical lead | `odoo-addons/nasq_core/**`, access-related `odoo-addons/nasq_api/**`, `odoo-addons/nasq_pmo/**`, `packages/contracts/src/pmo/**` | HR hook implementation and frozen web contracts | HR and admin web files |

The two workers are independent after `.access-work/contracts.md` is frozen.
The backend lead can implement core/API while the HR worker implements the
hook override. Root performs shared exports and route registration after both
packages exist.

---

### Task 1: Lock the shared identity and routing policy

**Owner:** Root integrator

**Files:**
- Modify: `packages/contracts/src/common/me.ts`
- Modify: `packages/contracts/src/common/error.ts`
- Modify: `packages/contracts/src/common/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/app/composables/useAccess.ts`
- Create: `apps/web/app/utils/accessPolicy.ts`
- Test: `packages/contracts/src/common/__tests__/me-access.test.ts`
- Test: `apps/web/app/utils/__tests__/accessPolicy.test.ts`

**Interfaces:**
- Consumes: `Capability`, `MeRole`, and Me defaults from `.access-work/contracts.md`.
- Produces: `useAccess() -> {can(capability), capabilities}`, `hasCapability`, `firstAllowedPath`, `isNavPathActive`, and `requiredCapabilityForPath`.

- [ ] **Step 1: Write identity and pure-policy tests.** Assert a legacy Me body parses with empty roles/capabilities and version zero; unknown capabilities fail schema validation; absent capabilities deny every protected path; ordered fallback is tasks, then projects, HR, system administration, and finally `/account`.

```ts
expect(MeSchema.parse(legacyMe).capabilities).toEqual([])
expect(hasCapability(undefined, 'access.users.read')).toBe(false)
expect(firstAllowedPath({capabilities: []})).toBe('/account')
expect(requiredCapabilityForPath('/settings/users/18')).toBe('access.users.read')
```

- [ ] **Step 2: Run the red checks from root only.**

```sh
npx -w packages/contracts vitest run src/common/__tests__/me-access.test.ts
npx -w apps/web vitest run app/utils/__tests__/accessPolicy.test.ts
```

Expected: missing capability/role schemas and policy exports fail.

- [ ] **Step 3: Implement the exact fail-closed parser and pure policy.** Keep `role` for compatibility display only. Widen shared error `details` to `z.record(z.string(), z.unknown()).optional()`; endpoint serializers still whitelist emitted values.

```ts
roles: z.array(MeRoleSchema).optional().default([]),
capabilities: z.array(CapabilitySchema).optional().default([]),
access_policy_version: z.number().int().nonnegative().optional().default(0),
```

- [ ] **Step 4: Run the same two commands.** Expected: pass.

- [ ] **Step 5: Report files and evidence to the lead.** Do not commit.

### Task 2: Write the core authorization and migration tests

**Owner:** Technical lead

**Files:**
- Create: `odoo-addons/nasq_core/tests/test_access_models.py`
- Create: `odoo-addons/nasq_core/tests/test_access_security.py`
- Create: `odoo-addons/nasq_core/tests/test_access_migration.py`
- Modify: `odoo-addons/nasq_core/tests/__init__.py`

**Interfaces:**
- Consumes: capability keys, dependency map, protected-role rules, company scope, audit whitelist, and last-admin lock from `.access-work/contracts.md`.
- Produces: failing executable requirements for Task 7.

- [ ] **Step 1: Test catalog and built-in roles.** Assert 25 unique permission keys, exact dependencies, forbidden custom access-changing permissions, protected role keys, distinct HR/PMO/system permission sets, and vendor coverage of all capabilities.

```python
self.assertEqual(len(self.env['nasq.access.permission'].search([])), 25)
with self.assertRaisesRegex(NasqAccessRule, 'custom_role_permission_forbidden'):
    self._custom_role(['access.users.assign_roles'])
```

- [ ] **Step 2: Test additive assignments and supported scopes.** Assert company-scoped role union, unique `(user,role,company)`, disabled roles reject new assignments while existing assignments stay effective, unsupported project/department assignment rejection, capability-source explanations, and removal that preserves capabilities supplied by another role.

```python
self.assign(user, 'hr_manager')
self.assign(user, 'pmo_manager')
self.unassign(user, 'hr_manager')
self.assertTrue(service._nasq_has_capability(user, 'pmo.projects.manage'))
self.assertFalse(service._nasq_has_capability(user, 'hr.employees.manage'))
```

- [ ] **Step 3: Test model-level enforcement.** Prove a user with a UI capability string but no effective Odoo permission cannot read/write; an HR manager cannot change `res.users.group_ids`, password, or active state generically; a system admin cannot edit HR/project records unless separately assigned; cross-company records are concealed.

- [ ] **Step 4: Test concurrency and self/vendor guards.** Use two cursors/transactions aimed at different access admins. Both paths acquire the same company lock; exactly one removal may commit and the other returns `last_access_admin`. Also reject self-demotion, self-disable, vendor mutation, and a role edit that would remove the last administrator through all its assignees.

```python
result = self._race(
    lambda env: env['nasq.access.service']._nasq_disable_user(admin_a),
    lambda env: env['nasq.access.service']._nasq_disable_user(admin_b),
)
self.assertEqual(sorted(result), ['committed', 'last_access_admin'])
```

- [ ] **Step 5: Test atomic audit.** Inject audit-create failure and prove role/password/state writes roll back. Assert audit values reject sensitive key names and password-reset events contain only `{sessions_revoked:true}`.

- [ ] **Step 6: Test migration before implementation.** Cover direct and inherited legacy `group_customer_admin`, vendor exclusion, active/inactive users, idempotent rerun, explicit preservation as `system_admin + hr_manager + pmo_manager`, and an injected failure rolling back the module transaction.

- [ ] **Step 7: Stop for root red checkpoint.** Do not run the tests and do not create production models.

### Task 3: Write the admin API and Me tests

**Owner:** Technical lead

**Files:**
- Create: `odoo-addons/nasq_api/tests/test_admin_users.py`
- Create: `odoo-addons/nasq_api/tests/test_admin_roles.py`
- Create: `odoo-addons/nasq_api/tests/test_admin_access_log.py`
- Modify: `odoo-addons/nasq_api/tests/test_me.py`
- Modify: `odoo-addons/nasq_api/tests/__init__.py`

**Interfaces:**
- Consumes: frozen HTTP routes and role/user/catalog/audit/Me wire shapes.
- Produces: failing controller/serializer requirements for Task 8.

- [ ] **Step 1: Test Me compatibility and live policy.** Assert sorted unique capabilities, separate roles, contextual project owner source, policy-derived project creation, monotonic company policy version, legacy role retention, and the next request reflecting a removed assignment.

```python
body = self.api('GET', '/api/v1/me').json()
self.assertEqual(body['capabilities'], sorted(set(body['capabilities'])))
self.assertIn('roles', body)
self.assertIn('access_policy_version', body)
```

- [ ] **Step 2: Test user list/detail filters and concealment.** Cover query, role, status, department, limit/offset, exact `{items,total}`, linked employee refs, protected vendor minimum shape, unknown query rejection, cross-company 404, and capability-specific 403. Also cover the minimal `/api/v1/admin/users/candidates` employee picker guarded by `access.users.grant`; it must work for a pure system administrator without granting HR directory capability.

- [ ] **Step 3: Test account lifecycle.** Cover grant from active employee, reactivation preserving user id, normalized work-email login, non-empty assignments, password length, archived employee, duplicate login, role assignment update with capability sources, reset, disable, reactivate, old-session failure, untouched-session continuity, full response replacement shapes, and no secret leakage.

- [ ] **Step 4: Test role and permission routes.** Cover create/clone/read/update/disable/enable/delete, built-in protection, custom access-changing permission rejection, dependency errors, inactive-role assignment rejection, user-count conflict, version conflict, and the exact 25-item catalog.

- [ ] **Step 5: Test audit routes.** Cover list filters, detail, read capability, immutable/no write route, actor/target summaries, whitelisted before/after, migration actor null, and absence of password/session keys.

- [ ] **Step 6: Stop for root red checkpoint.** Do not run tests or create controllers/serializers.

### Task 4: Write HR separation and routed-page tests

**Owner:** HR worker

**Files:**
- Modify: `odoo-addons/nasq_hr/tests/test_employee_model.py`
- Modify: `odoo-addons/nasq_hr/tests/test_hr_access.py`
- Modify: `odoo-addons/nasq_hr/tests/test_hr_employees.py`
- Modify: `odoo-addons/nasq_hr/tests/test_hr_departments.py`
- Modify: `odoo-addons/nasq_hr/tests/test_hr_documents.py`
- Create: `odoo-addons/nasq_hr/tests/test_access_bridge.py`
- Modify: `odoo-addons/nasq_hr/tests/__init__.py`
- Modify: `packages/contracts/src/hr/__tests__/schemas.test.ts`
- Create: `apps/web/app/components/hr/__tests__/HrRoutes.test.ts`
- Create: `apps/web/app/composables/__tests__/useHrCapabilities.test.ts`

**Interfaces:**
- Consumes: the four HR service hooks, HR capability names, root `useAccess`, and preserved HR list/document contracts.
- Produces: failing requirements for Tasks 9 and 11.

- [ ] **Step 1: Test HR/access separation.** Create an `hr_manager` without `system_admin`; prove employee/department/document writes succeed while role assignment, reset-password, and user-state APIs return 403. Create a system admin without HR role and prove HR writes return 403.

- [ ] **Step 2: Test the account bridge.** Assert `_nasq_hr_prepare_account` returns only the frozen scalar dictionary, normalizes work email, rejects cross-company/archived/invalid employees, and preserves an inactive linked user id. Assert `_nasq_hr_link_account` rejects a mismatched company.

```python
link = service._nasq_hr_prepare_account(employee.id, 'grant')
self.assertEqual(set(link), {
    'employee_id', 'company_id', 'name', 'login', 'partner_id',
    'existing_user_id', 'employee_active',
})
```

- [ ] **Step 3: Test archive atomicity.** Assert archive invokes `_nasq_disable_linked_user_from_hr` in the same savepoint, failed disable/audit leaves both records active, successful archive disables login, unarchive leaves login stopped, and self/vendor/last-admin errors propagate without HR acquiring user-management authority.

- [ ] **Step 4: Test removal of HR access writes.** The old POST/PATCH/DELETE `/api/v1/hr/employees/{id}/access` mutations must return `404 not_found` or a non-mutating redirect metadata response selected by root; they must never update roles/password/state. Employee shapes expose `access_status` only with `hr.employees.access_status.read` and expose an admin-user link only with `access.users.read`.

- [ ] **Step 5: Preserve department/document behavior.** Reassert employee totals include archived rows, delete blockers include employee/child/document counts, cycle prevention remains, document content/attachments/download access remain server-authorized, and all lists are `{items,total}`.

- [ ] **Step 6: Test routed HR pages.** Cover `/hr`, employee new/detail/edit, department list/new/detail/edit, `/hr/documents`, and nested department document new/detail/edit routes. Assert `useAccess` gates controls, access status is hidden from ordinary employees, URLs retain list filters, and no second access editor exists.

- [ ] **Step 7: Stop for root red checkpoint.** Do not run tests or edit production files.

### Task 5: Write admin contracts and routed-screen tests

**Owner:** Admin web/contracts worker

**Files:**
- Create: `packages/contracts/src/access/__tests__/schemas.test.ts`
- Create: `apps/web/app/composables/__tests__/useAdminUsers.test.ts`
- Create: `apps/web/app/composables/__tests__/useAdminRoles.test.ts`
- Create: `apps/web/app/composables/__tests__/useAdminAccessLog.test.ts`
- Create: `apps/web/app/components/access/__tests__/AccessRoutes.test.ts`

**Interfaces:**
- Consumes: all TypeScript and HTTP contracts in `.access-work/contracts.md`, root `useAccess`, `SharedPageHeader`, and `SharedPageState`.
- Produces: failing requirements for Task 12.

- [ ] **Step 1: Test strict access schemas.** Parse each complete example and reject top-level arrays, unknown capabilities, a 24-item catalog, malformed localized labels, project assignment input, duplicate assignments, password fields in response/audit values, and non-`{items,total}` lists.

```ts
expect(PermissionCatalogSchema.parse(catalog).total).toBe(25)
expect(() => AdminUserListSchema.parse([user])).toThrow()
expect(() => RoleAssignmentInputSchema.parse({
  role_id: 4,
  scope: {kind: 'project', id: 9},
})).toThrow()
```

- [ ] **Step 2: Test composable transport.** Assert exact method/path/body/query serialization, parsed response replacement, expected-version forwarding, 409 conflict exposure, sensitive mutation pending state, and invalidations for `['me']`, access lists/detail/audit, HR employees, and PMO `['people']` where specified.

- [ ] **Step 3: Test all routed screens.** Mount list/new/detail/access/security users pages; list/new/detail/edit roles pages; and list/detail audit pages. Cover loading/error/empty/read-only/protected/allowed-action states, URL-backed filters, explicit save/cancel, stale version reload, role impact comparison, and permission dependency selection.

- [ ] **Step 4: Test secret and accessibility behavior.** Password values clear after submit/error, never enter URL or displayed error serialization, sensitive confirms are in-page, forms label fields, dialogs/pages trap no keyboard focus, emails render LTR, and 360px layouts avoid page-wide horizontal scrolling.

- [ ] **Step 5: Stop for root red checkpoint.** Do not run tests or add production schemas/components/pages.

### Task 6: Run the single red checkpoint

**Owner:** Root integrator

**Files:** None

**Interfaces:**
- Consumes: tests from Tasks 2-5.
- Produces: captured expected failures and explicit authorization to begin production changes.

- [ ] **Step 1: Verify ownership before execution.** Run `git status --short` and reject any production file modified by a worker before this checkpoint.

- [ ] **Step 2: Run contract/web red tests sequentially.** Use the exact new test files from Tasks 4-5. Expected: missing exports/components/composables/routes, not syntax or fixture failures.

```sh
npx -w packages/contracts vitest run src/access/__tests__/schemas.test.ts src/hr/__tests__/schemas.test.ts
npx -w apps/web vitest run app/composables/__tests__/useAdminUsers.test.ts app/composables/__tests__/useAdminRoles.test.ts app/composables/__tests__/useAdminAccessLog.test.ts app/composables/__tests__/useHrCapabilities.test.ts app/components/access/__tests__/AccessRoutes.test.ts app/components/hr/__tests__/HrRoutes.test.ts
```

- [ ] **Step 3: Run Odoo red tests on `nasq_access_20260905`, never `odoo19`.** Run from `/Users/tariq/code/odoo`, point `--addons-path` at `/Users/tariq/code/nasq-access-admin/odoo-addons`, use port `9369`, and select only the named new test classes/tags. Expected: missing models/routes/hooks or assertion failures caused by absent production behavior.

- [ ] **Step 4: Record the red evidence.** Include command, database, port, branch, HEAD, and expected failure symbols. Resolve syntax/collection failures before declaring the checkpoint.

- [ ] **Step 5: Announce production authorization to all owners.** Workers remain inside their frozen file ownership.

### Task 7: Implement the Odoo access foundation and conservative migration

**Owner:** Technical lead

**Files:**
- Modify: `odoo-addons/nasq_core/__init__.py`
- Modify: `odoo-addons/nasq_core/__manifest__.py`
- Modify: `odoo-addons/nasq_core/models/__init__.py`
- Modify: `odoo-addons/nasq_core/models/res_company.py`
- Create: `odoo-addons/nasq_core/models/access_permission.py`
- Create: `odoo-addons/nasq_core/models/access_role.py`
- Create: `odoo-addons/nasq_core/models/access_assignment.py`
- Create: `odoo-addons/nasq_core/models/access_audit.py`
- Create: `odoo-addons/nasq_core/models/access_service.py`
- Create: `odoo-addons/nasq_core/models/res_users.py`
- Create: `odoo-addons/nasq_core/security/nasq_access_groups.xml`
- Create: `odoo-addons/nasq_core/security/nasq_access_rules.xml`
- Create: `odoo-addons/nasq_core/security/ir.model.access.csv`
- Modify: `odoo-addons/nasq_core/security/nasq_core_security.xml`
- Create: `odoo-addons/nasq_core/data/access_permissions.xml`
- Create: `odoo-addons/nasq_core/data/access_roles.xml`
- Create: `odoo-addons/nasq_core/data/access_migration_pre.xml`
- Create: `odoo-addons/nasq_core/data/access_migration_post.xml`

**Interfaces:**
- Consumes: Task 2 tests and frozen contracts.
- Produces: `nasq.access.permission`, `nasq.access.role`, `nasq.access.assignment`, `nasq.access.audit`, and `nasq.access.service` used by API, HR, and PMO.

- [ ] **Step 1: Define the fixed capability ceiling.** Create one static group per capability. Give each only the model operation needed to reach a guarded model method; retain company record rules. Do not create arbitrary groups for custom roles.

```python
def _nasq_has_capability(self, user, key, record=None):
    permission = self.env['nasq.access.permission']._for_key(key)
    company_grant = permission.group_id in user.all_group_ids
    contextual = self._nasq_contextual_grant(user, key, record)
    return bool(company_grant or contextual)
```

- [ ] **Step 2: Implement role and assignment invariants.** Enforce stable built-in keys, unique role keys, unique assignment triples, current-company scope, catalog dependencies, custom access-changing key prohibition, protected role behavior, inactive-role assignment rejection, and recomputation of capability groups after assignment/role changes.

- [ ] **Step 3: Guard generic user mutations.** Extend `res.users` so Nasq access/HR actors cannot generically write sensitive fields or unlink users. Private `_nasq_access_*` methods validate capability, company, self/vendor/employee state, expected version, and audit before calling the parent ORM implementation. Do not use a context flag that a browser RPC caller could spoof.

```python
SENSITIVE_USER_FIELDS = {
    'active', 'group_ids', 'password', 'login', 'company_id',
    'company_ids', 'partner_id',
}

def write(self, vals):
    if self.env.user._nasq_is_customer_actor() and SENSITIVE_USER_FIELDS & vals.keys():
        raise AccessError(self.env._('Use the protected Nasq access operation.'))
    return super().write(vals)
```

- [ ] **Step 4: Implement the company lock and final-state check.** Use one stable two-int PostgreSQL transaction advisory key based on company id. Under the lock, flush and re-read assignments/users; check the proposed final state for at least one active holder of `access.users.assign_roles`. Route user disable, HR archive, assignment removal, and role permission removal through it. Disabling a custom role is not a revocation: existing assignments remain effective.

```python
self.env.cr.execute(
    "SELECT pg_advisory_xact_lock(hashtext('nasq.access.last_admin'), %s)",
    [company.id],
)
```

- [ ] **Step 5: Implement atomic audit.** Give access-changing groups create permission only as an ORM ceiling; override public create/write/unlink to reject caller-driven mutation. `_nasq_log` validates event-specific values and calls the parent create inside the same transaction as its change. Add no failure-attempt log that could outlive a rolled-back transaction.

- [ ] **Step 6: Split the legacy groups.** Make `group_customer_admin` a compatibility system-access group that no longer implies `project.group_project_manager`, `hr.group_hr_manager`, or `base.group_erp_manager`. Define explicit protected HR, PMO, system, and vendor role mappings. Vendor retains `base.group_system` and all capability groups.

- [ ] **Step 7: Implement ordered idempotent migration.** Before replacing the old implication, capture all non-vendor direct and inherited effective customer admins and create their three explicit built-in assignments. Then replace the implication and recompute groups. Emit one migration event per user. A fresh install sees no legacy candidates; a rerun creates no duplicates.

- [ ] **Step 8: Run only core focused tests through root.** Expected: Task 2 tests pass on the isolated database. Do not broaden yet.

### Task 8: Implement Me and the administrative API

**Owner:** Technical lead

**Files:**
- Modify: `odoo-addons/nasq_api/__manifest__.py`
- Modify: `odoo-addons/nasq_api/controllers/__init__.py`
- Modify: `odoo-addons/nasq_api/controllers/me.py`
- Create: `odoo-addons/nasq_api/controllers/admin_users.py`
- Create: `odoo-addons/nasq_api/controllers/admin_roles.py`
- Create: `odoo-addons/nasq_api/controllers/admin_permissions.py`
- Create: `odoo-addons/nasq_api/controllers/admin_access_log.py`
- Modify: `odoo-addons/nasq_api/serializers/__init__.py`
- Modify: `odoo-addons/nasq_api/serializers/user.py`
- Create: `odoo-addons/nasq_api/serializers/access.py`
- Modify: `odoo-addons/nasq_api/security/ir.model.access.csv`
- Modify: `odoo-addons/nasq_api/security/branding_rules.xml`

**Interfaces:**
- Consumes: core services from Task 7, HR hooks from Task 9, and Task 3 tests.
- Produces: frozen `/api/v1/admin/*` and extended `/api/v1/me` responses.

- [ ] **Step 1: Implement strict serializers/parsers.** Whitelist every response key and request field. Parse assignment uniqueness, expected versions, filters, role permission keys, localized labels, and password minimum. Serialize vendor accounts with only the frozen protected-user shape.

- [ ] **Step 2: Extend Me.** Call the core service for role summaries, sorted unique effective capabilities, and company policy version. Keep legacy `role` but remove it from every authorization decision.

```python
access = user.env['nasq.access.service']._nasq_identity(user)
return {
    **legacy_identity,
    'roles': access['roles'],
    'capabilities': sorted(set(access['capabilities'])),
    'access_policy_version': access['version'],
}
```

- [ ] **Step 3: Implement user reads.** Apply capability before filter resolution, combine same-company user domain with the HR hook domain, paginate before serialization, and obtain employee refs through the bulk hook. Add the narrow candidate list route through the HR candidate hook. Return 404 for cross-company ids.

- [ ] **Step 4: Implement account lifecycle writes.** Grant/reactivate calls `_nasq_hr_prepare_account`, performs core user/assignment/password/audit writes, then `_nasq_hr_link_account`, all in one transaction. Reset/disable/reactivate/assignment changes use expected versions and return the complete detail. Clear security caches only after commit.

- [ ] **Step 5: Implement role/catalog reads and writes.** Return 25 catalog entries. Reject protected edits, forbidden custom access capabilities, missing dependencies, stale versions, assigned-role delete, and unsafe last-admin role changes. Role disable prevents new assignment but retains existing effective assignments exactly as the approved design states.

- [ ] **Step 6: Implement immutable audit reads.** Filter the current company only, support exact query parameters, and return summaries/detail. Do not expose model create/write/delete routes.

- [ ] **Step 7: Move branding authorization.** Replace `group_customer_admin` checks and ACL/rule references with `settings.branding.manage`; preserve the existing public branding response/cache and authenticated write serializer.

- [ ] **Step 8: Run only API focused tests through root.** Include Me, branding, admin users/roles/catalog/audit, session invalidation, and no-secret assertions. Expected: pass.

### Task 9: Implement the HR authorization split and account bridge

**Owner:** HR worker

**Files:**
- Modify: `odoo-addons/nasq_hr/__manifest__.py`
- Modify: `odoo-addons/nasq_hr/models/__init__.py`
- Create: `odoo-addons/nasq_hr/models/access_service.py`
- Modify: `odoo-addons/nasq_hr/models/hr_employee.py`
- Modify: `odoo-addons/nasq_hr/models/hr_department.py`
- Modify: `odoo-addons/nasq_hr/models/hr_document.py`
- Modify: `odoo-addons/nasq_hr/controllers/hr_employees.py`
- Modify: `odoo-addons/nasq_hr/controllers/hr_departments.py`
- Modify: `odoo-addons/nasq_hr/controllers/hr_documents.py`
- Modify: `odoo-addons/nasq_hr/serializers/hr_employee.py`
- Modify: `odoo-addons/nasq_hr/security/hr_people_rules.xml`
- Modify: `odoo-addons/nasq_hr/security/hr_document_rules.xml`
- Modify: `odoo-addons/nasq_hr/security/ir.model.access.csv`

**Interfaces:**
- Consumes: core service hooks and Task 4 tests.
- Produces: HR CRUD/document routes and internal employee-account integration without public access writes.

- [ ] **Step 1: Replace legacy admin checks.** Map employee, department, document, archive, and access-status operations to their exact HR capabilities. Keep public employee directory reads on `hr.employee.public`; use full employees only after the capability and company checks.

- [ ] **Step 2: Implement the five frozen hooks.** Validate operation, active/company state, normalized email, linked user, and partner linkage. Include the company-scoped, field-limited account-candidate hook used by pure system administrators. Return only the scalar dictionary/employee refs/candidate envelope in `.access-work/contracts.md`; do not accept or return passwords.

- [ ] **Step 3: Move user lifecycle out of HR.** Remove `_nasq_grant_access`, `_nasq_update_access`, `_nasq_revoke_access`, role constants, and the three public HR access mutations. Keep employee create/edit independent from account creation.

- [ ] **Step 4: Make archive atomic.** In one savepoint, validate HR archive, call core `_nasq_disable_linked_user_from_hr`, then archive the employee. Propagate self/vendor/last-admin/audit errors. Unarchive only the employee.

- [ ] **Step 5: Preserve departments and documents.** Keep cycle checks, server counts including archived employees, delete blockers, document content/attachment ownership, and download ACL behavior. Do not add department privacy claims or a second document model.

- [ ] **Step 6: Run only HR focused tests through root.** Expected: Task 4 Odoo tests and existing HR document/pagination suites pass.

### Task 10: Apply contextual capability checks to PMO

**Owner:** Technical lead

**Files:**
- Modify: `odoo-addons/nasq_pmo/models/project_project.py`
- Modify: `odoo-addons/nasq_pmo/models/project_task.py`
- Modify: `odoo-addons/nasq_pmo/controllers/projects.py`
- Modify: `odoo-addons/nasq_pmo/controllers/tasks.py`
- Modify: `odoo-addons/nasq_pmo/controllers/settings.py`
- Modify only where actions exist: `odoo-addons/nasq_pmo/controllers/project_followers.py`
- Modify only where actions exist: `odoo-addons/nasq_pmo/controllers/project_stages.py`
- Modify only where actions exist: `odoo-addons/nasq_pmo/controllers/milestones.py`
- Modify: `odoo-addons/nasq_pmo/serializers/project.py`
- Modify: `odoo-addons/nasq_pmo/serializers/task.py`
- Modify: `packages/contracts/src/pmo/project.ts`
- Modify: `packages/contracts/src/pmo/task.ts`
- Modify: `odoo-addons/nasq_pmo/tests/test_project_admin_model.py`
- Modify: `odoo-addons/nasq_pmo/tests/test_projects.py`
- Modify: `odoo-addons/nasq_pmo/tests/test_tasks.py`
- Modify: `odoo-addons/nasq_pmo/tests/test_transition.py`

**Interfaces:**
- Consumes: core capability service and approved project-owner scope.
- Produces: server-authoritative project/task `allowed_actions` and PMO operation enforcement.

- [ ] **Step 1: Write focused tests before PMO production edits.** Prove company PMO manager access, assigned project owner access only on their project, id-swapping rejection, old owner access loss after reassignment, new owner access gain, and ordinary employee limits. Project owners may approve/request changes only for their own project tasks.

- [ ] **Step 2: Replace broad role checks.** `_nasq_can_manage` and `_nasq_can_approve` call the core service with the project/task record. Keep existing documented manager-write and count `sudo()` cases exactly; add no sixth case.

```python
def _nasq_can_approve(self):
    self.ensure_one()
    return self.env['nasq.access.service']._nasq_has_capability(
        self.env.user,
        'pmo.tasks.approve',
        record=self,
    )
```

- [ ] **Step 3: Gate every PMO operation.** List/read uses current Odoo record rules; create uses policy plus `pmo.projects.create` or task capability; project writes/settings/stages/milestones/followers/status/archive use resource manage; task fields/transitions use task write/approve. Do not infer an all-project scope from one owned project.

- [ ] **Step 4: Add `allowed_actions` additively.** Preserve existing `can_manage`, state mapping, people picker, and detail shapes while adding resource-specific action strings. Make project list return `total` without removing existing `can_create` and `can_list_archived` metadata.

- [ ] **Step 5: Run PMO focused tests through root.** Include unchanged `/api/v1/people`, project/task routes, state transitions, policy, and id-swap cases. Expected: pass.

### Task 11: Build the routed HR UI without an access editor

**Owner:** HR worker

**Files:**
- Modify: `packages/contracts/src/hr/index.ts`
- Modify: `apps/web/app/pages/hr.vue`
- Create: `apps/web/app/pages/hr/employees/new.vue`
- Create: `apps/web/app/pages/hr/employees/[employeeId]/index.vue`
- Create: `apps/web/app/pages/hr/employees/[employeeId]/edit.vue`
- Create: `apps/web/app/pages/hr/departments/index.vue`
- Create: `apps/web/app/pages/hr/departments/new.vue`
- Create: `apps/web/app/pages/hr/departments/[departmentId]/index.vue`
- Create: `apps/web/app/pages/hr/departments/[departmentId]/edit.vue`
- Create: `apps/web/app/pages/hr/documents/index.vue`
- Create: `apps/web/app/pages/hr/departments/[departmentId]/documents/new.vue`
- Create: `apps/web/app/pages/hr/departments/[departmentId]/documents/[documentId]/index.vue`
- Create: `apps/web/app/pages/hr/departments/[departmentId]/documents/[documentId]/edit.vue`
- Modify/create only under: `apps/web/app/components/hr/**`
- Modify/create only HR composables/helpers under: `apps/web/app/composables/**`
- Modify: `apps/web/i18n/locales/ar/hr.json`
- Modify: `apps/web/i18n/locales/en/hr.json`

**Interfaces:**
- Consumes: Task 9 API, root `useAccess`/shared page components, and Task 4 UI tests.
- Produces: complete employee/department/document routes with capability-gated actions.

- [ ] **Step 1: Update HR contracts additively.** Preserve current names and `{items,total}`. Replace writable employee access role/password inputs with optional `access_status` and `admin_user` refs that the server omits/nulls when unauthorized.

- [ ] **Step 2: Implement query composables.** Serialize search, department, employment status, archived, page, and sort into URL/API parameters; reset page for filter changes; replace/invalidate cache from full server mutation responses.

- [ ] **Step 3: Build employee routes.** `/hr` is the employee list. New/detail/edit pages separate forms, preserve `returnTo`, warn on unsaved changes, hide access status without capability, and show only a link to the system user page when allowed.

- [ ] **Step 4: Build department routes.** Render server employee counts, hierarchy, manager relationship, employees/documents links, cycle errors, and exact delete-blocker counts. Department manager selection must not imply a role.

- [ ] **Step 5: Preserve and route documents.** Add one `/hr/documents` list with search/department filter; keep resource identity at nested department document routes; reuse the existing editor/reader/attachment flow and direct-download authorization.

- [ ] **Step 6: Remove misleading legacy UI.** Delete or stop rendering `EmployeeAccessPanel` and `SetPasswordDialog`; no HR button changes roles/password/access state. Archiving explains that login will stop and waits for the server result.

- [ ] **Step 7: Run the HR contract/component tests through root.** Expected: Task 4 tests pass; ordinary users see no access metadata; document behavior remains green.

### Task 12: Build typed admin users, roles, and audit screens

**Owner:** Admin web/contracts worker

**Files:**
- Create: `packages/contracts/src/access/index.ts`
- Create: `packages/contracts/src/access/user.ts`
- Create: `packages/contracts/src/access/role.ts`
- Create: `packages/contracts/src/access/permission.ts`
- Create: `packages/contracts/src/access/audit.ts`
- Create: `apps/web/app/composables/useAdminUsers.ts`
- Create: `apps/web/app/composables/useAdminRoles.ts`
- Create: `apps/web/app/composables/useAdminAccessLog.ts`
- Create only under: `apps/web/app/components/access/**`
- Create: `apps/web/app/pages/settings/users/index.vue`
- Create: `apps/web/app/pages/settings/users/new.vue`
- Create: `apps/web/app/pages/settings/users/[userId]/index.vue`
- Create: `apps/web/app/pages/settings/users/[userId]/access.vue`
- Create: `apps/web/app/pages/settings/users/[userId]/security.vue`
- Create: `apps/web/app/pages/settings/roles/index.vue`
- Create: `apps/web/app/pages/settings/roles/new.vue`
- Create: `apps/web/app/pages/settings/roles/[roleId]/index.vue`
- Create: `apps/web/app/pages/settings/roles/[roleId]/edit.vue`
- Create: `apps/web/app/pages/settings/access-log/index.vue`
- Create: `apps/web/app/pages/settings/access-log/[eventId].vue`
- Create: `apps/web/i18n/locales/ar/access.json`
- Create: `apps/web/i18n/locales/en/access.json`

**Interfaces:**
- Consumes: Task 8 API, root helpers/components, and Task 5 tests.
- Produces: `@nasq/contracts/access` barrel and complete routed administration UI.

- [ ] **Step 1: Implement exact Zod schemas.** Use strict request objects, discriminated enums, `.superRefine` for unique company assignments and audit sensitive-key rejection, and `{items,total}` list schemas. Export only through `src/access/index.ts`; root adds the package root export.

- [ ] **Step 2: Implement admin composables.** Parse every response, forward expected versions, keep sensitive mutations non-optimistic, and invalidate exact cache namespaces from the frozen contract. Expose 409 details to page-level reload UI.

- [ ] **Step 3: Build user list/new/detail.** Support real server filters and totals, linked employee, multiple-role chips, stopped state, protected vendor minimum display, grant/reactivate wording, and detail account/roles/audit tabs. Do not show last-login.

- [ ] **Step 4: Build access/security pages.** Access page shows before/after added/removed/retained capabilities with sources and a warning for system administration. Security page separates reset password from disable/reactivate, describes session effects, clears password values, and respects `allowed_actions`.

- [ ] **Step 5: Build role list/new/detail/edit.** Group catalog permissions by domain, show supported scope, auto-select dependencies, revalidate server errors, prevent custom access-changing capabilities, show affected-user count/sample before saved-role change, and support clone/disable/enable/delete constraints.

- [ ] **Step 6: Build audit list/detail.** Support approved filters and server total, render successful events, actor/target, sanitized before/after, and reason. Provide no write/delete/export action.

- [ ] **Step 7: Apply page behavior.** Use `SharedPageHeader`, `SharedPageState`, root `useAccess`, URL filters, safe internal `returnTo`, logical RTL classes, LTR email/login, visible focus, and a usable 360px layout. No component checks `Me.role`.

- [ ] **Step 8: Run access contract/component tests through root.** Expected: Task 5 tests pass.

### Task 13: Integrate shared navigation, branding, account, and route guards

**Owner:** Root integrator

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/nuxt.config.ts`
- Modify: `apps/web/app/composables/useNav.ts`
- Modify: `apps/web/app/components/AppSidebar.vue`
- Modify/create: `apps/web/app/middleware/**`
- Modify: `apps/web/app/pages/index.vue`
- Modify: `apps/web/app/pages/settings/branding.vue`
- Modify: `apps/web/app/pages/account.vue`
- Modify: `apps/web/i18n/locales/ar/common.json`
- Modify: `apps/web/i18n/locales/en/common.json`
- Modify shared branding/account composables and tests already imported from phase 3b.

**Interfaces:**
- Consumes: Tasks 8-12 outputs.
- Produces: one integrated shell and cache policy.

- [ ] **Step 1: Add shared exports/locales once.** Export access contracts from the package root and register `access.json` in both locales. Resolve no pillar file through a shared barrel change by a worker.

- [ ] **Step 2: Build the final navigation.** Render project, HR, and system groups only when they contain an allowed destination; keep account/logout at the user footer; vendor support points to `/odoo`; do not show reports or an empty dashboard.

- [ ] **Step 3: Guard direct routes.** Use `requiredCapabilityForPath`; deny before protected data requests. The root redirects to `/tasks` when readable, otherwise the first fixed allowed destination, otherwise `/account`.

- [ ] **Step 4: Reconcile branding/account.** Gate branding with `settings.branding.manage`, retain public branding source/cache and preview/save/cancel, and keep `/account` available to every authenticated user with current-password verification and current-session continuity.

- [ ] **Step 5: Handle policy changes.** When Me policy version changes, clear protected access/HR/PMO caches before refetching visible data. Logout/account change clears saved navigation-collapse state. Do not make the authenticated app client-only.

- [ ] **Step 6: Run shared policy, navigation, hydration, branding, and account tests sequentially.** Expected: pass without `.next`/`.nuxt` races.

### Task 14: Exercise the twelve acceptance journeys

**Owner:** Root integrator

**Files:**
- Create: `apps/web/e2e/access-admin.spec.ts`
- Create: `apps/web/e2e/hr-routes.spec.ts`
- Modify: existing PMO E2E only where resource actions are now capability-driven.

**Interfaces:**
- Consumes: the integrated API/web runtime and approved design journeys.
- Produces: browser evidence for role combinations, direct-route protection, RTL/mobile behavior, and server/UI agreement.

- [ ] **Step 1: Add deterministic isolated fixtures.** Create unique employees/users/roles through Odoo/API in `nasq_access_20260905`; record ids separately so employee/user id equality cannot hide a contract mix-up. Never write fixtures through production or `odoo19`.

- [ ] **Step 2: Cover account journeys.** Exercise employee without account, grant, reactivation with same user id, reset, disable with old-session rejection, archived employee atomic disable, unarchive without login restoration, self guard, vendor guard, and last-admin rejection.

- [ ] **Step 3: Cover role journeys.** Exercise HR-only, PMO-only, system-only, multi-role union/removal, custom role create/clone/edit/disable/delete, forbidden custom access capabilities, dependency addition, and stale-version reload.

- [ ] **Step 4: Cover project scope.** Assign and change a project manager; prove approve/manage actions only on owned project, id swapping fails, and old manager loses action on the next request while another role remains effective.

- [ ] **Step 5: Cover navigation/direct URLs.** Assert each sidebar group/item follows capabilities, no duplicates exist, settings appear under their owner, direct unauthorized pages issue no protected data request, root fallback is fixed, query filters survive return/reload, and policy-version changes clear stale data.

- [ ] **Step 6: Cover HR documents and UX.** Create/edit/archive employee, manage department, open document editor/reader, download attachment directly under allowed/denied users, use keyboard focus, and check Arabic RTL at desktop and 360px.

- [ ] **Step 7: Restore only test fixture state.** Do not describe local browser success as deployment proof.

### Task 15: Run the final integration and migration gate once

**Owner:** Root integrator

**Files:**
- Update after evidence: `docs/superpowers/plans/2026-09-05-nasq-access-admin.md` checkbox state only if authorized.
- Create if requested by root: `.access-work/final-verification.md`

**Interfaces:**
- Consumes: all implementation packages and focused green evidence.
- Produces: one fresh, attributable local delivery result.

- [ ] **Step 1: Audit the final tree.** Record branch, HEAD, dirty paths, ownership exceptions, and diff stat. Reject source-Odoo edits, duplicated writers, unexpected `sudo()`, legacy role gates, and public HR access mutation routes.

```sh
git status --short --branch
rg -n "group_customer_admin|role === ['\"]admin|has_group\('nasq_core.group_customer_admin'" odoo-addons apps/web packages/contracts
rg -n "sudo\(|with_user\(" odoo-addons/nasq_core odoo-addons/nasq_api odoo-addons/nasq_hr odoo-addons/nasq_pmo
```

Expected: only documented compatibility/migration references remain; no new privilege bypass exists.

- [ ] **Step 2: Run formatting/static checks.** Run `ruff check odoo-addons`, contract tests, web unit tests, then `npx -w apps/web vue-tsc --noEmit`. Fix only ownership-approved failures.

- [ ] **Step 3: Run a fresh-install Odoo gate.** Create a fresh disposable database distinct from `nasq_access_20260905`, install `nasq_core,nasq_api,nasq_pmo,nasq_hr`, use explicit addons path and a unique port, and run the four addon test tags. Record database and port.

- [ ] **Step 4: Run an upgrade migration gate.** Restore an isolated pre-change fixture containing direct/inherited legacy admins and vendor support. Upgrade modules, verify explicit role preservation and no new-admin overgrant, rerun idempotently, and inject a migration failure in a disposable copy to prove transaction rollback. Primary rollback is restoration of the captured pre-upgrade database backup.

- [ ] **Step 5: Run web build sequentially after typecheck.** Do not overlap Nuxt generation/build commands.

```sh
npm test
npx -w apps/web vue-tsc --noEmit
npm -w apps/web run build
```

- [ ] **Step 6: Run Playwright once against the isolated integrated runtime.** Use the unique Odoo/Nuxt ports chosen by root and run the acceptance specs from Task 14.

- [ ] **Step 7: Report exact evidence and residual risk.** State branch/HEAD, changed files, database/ports, command counts, failures/skips, migration fixture coverage, and that local checks do not prove merge, push, deployment, DNS, or production behavior.

## Plan self-review

- **Spec coverage:** Tasks 7-8 cover separated groups, roles, assignments, custom-role limits, users, security, audit, Me, branding, sessions, concurrency, and migration. Tasks 9/11 cover employee/department/document routes and HR/access separation. Task 10 covers PMO resource ownership and approval. Tasks 12-14 cover every approved route, navigation, account, RTL/mobile, direct-link, and twelve acceptance journeys.
- **No unsupported scope:** company is the only assignable scope; project is contextual; department/self scopes and document privacy remain excluded.
- **Type consistency:** all capability, role, scope, user, catalog, audit, Me, version, error, and hook names come from `.access-work/contracts.md`.
- **Authorization consistency:** no UI role-name gate, no custom access-changing capability, no broad ERP-manager substitute, no new `sudo()`, and no HR account writer remains.
- **Execution boundary:** tests are authored first, root owns the red checkpoint and every run, production changes wait for that checkpoint, and Git/deployment actions remain unauthorized.

Plan complete and saved at `docs/superpowers/plans/2026-09-05-nasq-access-admin.md`. Execution follows the already-approved subagent-driven ownership above; no separate execution-choice prompt is needed.
