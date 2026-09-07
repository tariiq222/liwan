# Template project-only policy correction — 2026-09-07

Worktree `/Users/tariq/code/nasq-phase1-templates`, branch `codex/phase1-templates`.
Source is ready for coordinator integration and independent review; frozen after this report. No frontend/shared-capability changes, agents, commits, runtime changes or Odoo/broad gate execution.

## Confirmed root cause and corrected boundary

The coordinator's `odoo-project-only-probe.log` proves a user with exactly `pmo.projects.read` and `pmo.projects.create` can create a native project and sees `can_apply=true`, but template scheduling failed at `project.task._search` requiring `pmo.tasks.read`. The previous correction covered missing task-create only.

`project.task._nasq_template_population_domain` now derives a temporary read boundary from the existing server-owned `cr.precommit.data[TEMPLATE_APPLY_MARKER]` tuple. It checks caller UID/current company, current visible project, caller ownership and native creation policy. It returns only `project_id = newly_created_id AND company_id = current_company_id`. It never reads client context or adds a capability.

For callers lacking task-read:
- `_search` intersects **every** supplied search/fetch/count domain with that boundary, including unrestricted/OR domains; delegates to ordinary stock search with ACLs/rules intact.
- `check_access('read')` allows the empty-recordset model ACL check needed internally by stock search. Every nonempty recordset must have **all** its IDs in a constrained stock-ACL/rule query; a mixed inside/outside set is rejected as a whole. Membership is checked without reading fields from an unverified/cached recordset.
- A missing/mismatched UID/company scope preserves the previous capability denial. Generic capability endpoints and roles remain unchanged.

Callers who already possess task-read retain their preexisting visibility and permissions. This path does not widen their record/company visibility. Existing create/field/approval/completion/schedule/dependency/ORM guards are unchanged.

## HTTP result lifetime

`_nasq_apply` accepts a private keyword-only Python `serialize` callback; HTTP does not accept this in its payload. The template controller supplies the whitelisting `dump_applied_project` function. The resulting plain project dictionary is built within the **same original fresh-project population scope and savepoint**, then stored computations flush before cleanup. No scope is reopened later; no elevated recordset is returned. Direct private ORM application still returns the caller-environment project recordset with scope removed.

`finally` removes/restores the scope on success, population failure, serialization failure and flush failure. The surrounding savepoint rolls back the new project/stages/milestones/tasks for failures. No sudo or general task read/create/write capability grant was introduced.

## Files changed in this correction only

- `odoo-addons/nasq_pmo/models/project_task.py`
- `odoo-addons/nasq_pmo/models/project_template.py`
- `odoo-addons/nasq_pmo/controllers/project_templates.py`
- `odoo-addons/nasq_pmo/tests/test_project_templates.py`
- This delivery report.

The template serializer and all frontend files are unchanged by round 2. Root owns the project-cache correction.

## Test additions and evidence boundary

Backend test source now has 10 ORM tests and 3 authenticated HTTP tests. Previous tests are preserved, including the coordinator's confirmed failing project-only test. Added checks cover:

- Project-only caller search/read positive only for populated task IDs.
- Unrestricted/search-count/hostile-OR searches cannot return existing/foreign tasks.
- Direct and mixed-recordset reads, other UID, another company, client context spoof, outside creates/writes denied while scope is active.
- Generic search/read/write/copy/batch and forged scope remain denied after application.
- Serializer-result failure after both tasks exist checks exact all-four-model rollback, non-elevated callback environment and scope cleanup.
- Authenticated project-only apply returns full project detail, correct task/stage/milestone counts and caller manager; subsequent task API and ORM reads remain forbidden, with capabilities unchanged.

Fresh local checks: four changed Python files parse with `ast.parse`. AST comparison against coordinator integration proved only `_nasq_template_population_domain`, `_search`, and `check_access` changed in ProjectTask; all existing create/write/schedule/dependency methods were preserved. No claim of Odoo runtime passing: coordinator must run these tests and independent review against the integrated source.
