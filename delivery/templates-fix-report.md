# Template correction delivery — 2026-09-07

Worktree: `/Users/tariq/code/nasq-phase1-templates`, branch `codex/phase1-templates`.
Source correction package ready for independent review and coordinator integration. No commit, merge, push, runtime change, Odoo test, broad lint/typecheck/build, or deployment was performed here. Writes frozen after this report.

## Corrected behavior

- Editor clones JSON-compatible definitions from deeply readonly Vue Query data safely. Draft is detached from query cache.
- Every editor field/select/checkbox/action is disabled before hydration and while a save is pending. Failed submissions retain draft and dirty baseline. Successful create/edit waits for `nextTick` after the reset acknowledgement before route navigation; application uses the same ordering.
- Stage deletion is refused inline while tasks use that stage. Removing a milestone clears optional task milestone references; removing a task removes its predecessor references from other tasks.
- User-facing graph errors are translated without internal row keys. Form controls have stable names. Arabic/English delivery fragments contain new validation/pagination strings and an author-oriented stage hint.
- Catalog has bounded 50-item pagination using server `total`. Search/offset are URL state. Validated `returnTo` is preserved through detail/new/edit/apply and cancel/back routes; detail route normalizes trailing slash.
- Direct new/edit pages render management-denied state instead of a writable editor for readers. Merely opening the prefilled apply page is clean.
- Create/patch definition validation now rejects duplicate dependency entries and whitespace-only names; names are trimmed like the backend. Empty PATCH/year-zero inputs are rejected. Description null is rejected consistently by API/model and contract.
- Stock task state is preserved: Brief is in progress, Build waits on Brief, neither is closed. One-day inclusive duration assertions remain.

## Private task application contract

`TEMPLATE_APPLY_MARKER = 'nasq_pmo.template_apply_scope'` is stored only in `cr.precommit.data`, never read from client context. `_nasq_apply` first validates visible current-company template, normal project-create policy, definition/name/start, then creates a fresh caller-owned project via `_nasq_create_from_policy` inside a savepoint. Only then it sets `(uid, company_id, freshly_created_project_id)` for population. A `finally` removes the marker (or restores an enclosing scope) on success and exceptions.

`project.task._nasq_create_for_template(project, values)` requires exactly that scope, project visibility, caller ownership, native create policy and matching values.project_id. It calls ordinary task create with no new sudo path. The existing task create guard skips **only** `pmo.tasks.create` for that same server-owned tuple; whitelist, read/current-company/parent/approval/completion/schedule checks and stock ORM ACL/rules still run. Outside application, generic create, copy, batch and spoofed context remain denied to a minimal creator lacking task-create permission.

Application drops every `default_*` client context entry, explicitly supplies empty assignees and false parent, and disables mail tracking/subscription defaults. Stock Odoo task create nevertheless explicitly subscribes the caller; the private helper removes only that caller's automatic subscription using ordinary `message_unsubscribe`. No follower/assignee/activity cloning and no arbitrary sudo were introduced.

Transferred `project_task.py` was compared with the coordinator integration copy after mechanically subtracting only this marker/helper/one dedicated-capability branch. It matches byte-for-byte, preserving the corrected schedule guards.

## Fresh checks actually executed

- `npm -w packages/contracts test -- src/pmo/__tests__/project-template.test.ts`: 6 passed. Red step before contract fixes: new 3 parity tests failed as expected.
- `./node_modules/.bin/vitest run --config delivery/templates-unit.config.mjs`: 3 passed. Loads the production editor script via Vue SFC compiler, supplies actual readonly/reactive Vue objects, and tests detached draft/acknowledgement, hydration/pending submit guards, reference cleanup and localized cycle errors.
- Initial normal web unit invocation could not load missing worktree `.nuxt/tsconfig.app.json`; no Nuxt runtime state was generated. The focused delivery config passes an explicit in-memory TypeScript config and runs the editor script tests without that generated state.
- Python `ast.parse`: project_template.py, project_task.py, template serializer and tests parsed successfully. This is syntax checking, not Odoo runtime proof.
- Vue SFC `parse`, `compileScript`, `compileTemplate`: all 6 template editor/page files compiled. This is component syntax checking, not full TypeScript or browser proof.

## Added server acceptance tests — coordinator must run

`test_project_templates.py` now contains 7 TransactionCase tests and 2 authenticated NasqPmoCase HTTP tests. They cover settings CRUD; strict definition create/update parity; unauthorized write/unlink/copy/batch/company paths; a minimal native project creator without generic task create or system/project-manager groups; ordinary create/copy/batch/context-marker denial; context default sanitation; repeated independent projects/stages/tasks/milestones with no assignees/followers/activities; one-day dates and stock dependency state; controlled failure after both tasks and milestone exist with all four record-model counts unchanged and marker cleared; HTTP CRUD/apply/pagination/403/404 and foreign-company negatives; HTTP date underflow after population has begun with full rollback.

Odoo tests, final lint/types/build, authenticated UI delayed-save/hydration/pagination/refresh/back/error acceptance, and independent security review remain coordinator gates. This report does not claim those passed.

## Files to integrate

- `apps/web/app/components/project/templates/ProjectTemplateEditor.vue`
- **New:** `apps/web/app/components/project/templates/__tests__/ProjectTemplateEditor.test.ts`
- `apps/web/app/composables/useProjectTemplates.ts`
- `apps/web/app/pages/project-templates/index.vue`
- `apps/web/app/pages/project-templates/new.vue`
- `apps/web/app/pages/project-templates/[id].vue`
- `apps/web/app/pages/project-templates/[id]/edit.vue`
- `apps/web/app/pages/project-templates/[id]/apply.vue`
- `packages/contracts/src/pmo/project-template.ts`
- `packages/contracts/src/pmo/__tests__/project-template.test.ts`
- `odoo-addons/nasq_pmo/models/project_template.py`
- `odoo-addons/nasq_pmo/models/project_task.py` (transferred ownership; preserve whole corrected schedule source)
- `odoo-addons/nasq_pmo/serializers/project_template.py`
- `odoo-addons/nasq_pmo/tests/test_project_templates.py`
- `delivery/templates-ar.json` and `delivery/templates-en.json` (coordinator merges into shared projects locales)
- `delivery/templates-unit.config.mjs` (focused test-only runner)
- `delivery/templates-fix-report.md`

Existing template controller/ACL/rule files from the original package remain required and unchanged by this correction.
