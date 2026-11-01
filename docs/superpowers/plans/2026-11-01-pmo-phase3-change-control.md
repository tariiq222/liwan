# PMO phase 3: change control

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 3 is in Launch 1.
Branch `codex/pmo-change-control`. Depends on phase 1 (charter approval, merged).

## Goal

An approved project changes scope, schedule or cost only through a recorded change request: the requester states the change and its
impact, the sponsor approves or rejects it, and the register keeps the history. This replaces the phase 1 rule D3 ("changing an approved
charter reopens it") with change requests.

## Decisions for owner review

1. **States:** `draft -> submitted -> approved | rejected`, plus `withdrawn` (requester, from draft or submitted) and `implemented` (project manager, after approval). Terminal states are read-only. Only a member of the project (manager, sponsor, follower or task assignee) raises a request.
2. **Who decides:** the project sponsor (`liwan_sponsor_id`), like the charter. A manager who is also the sponsor decides directly: submitting their own request approves it in one step. Admins change the sponsor instead of deciding (no capability replaces the sponsor check). The decision fields are written on the new model itself, without `sudo()`: the employee, reader and manager groups get read/write/create ACL rows (no unlink) on `liwan.project.change`, and the model's `write()` refuses the state, decision and revision fields unless a transition method set a precommit marker after its own checks. The project helper `_liwan_write_sudo` is specific to `project.project` and is not reused. Visibility is the governance rule: a request is readable when its active current-company project is; an archived project's requests answer 404.
3. **Company setting `change_control_mode`** (scope: company; default `optional`; changed by `pmo.settings.manage`):
   - `off`: no change requests (every write answers 409 `change_control_off`, the history stays readable, the tab is hidden); today's behaviour (charter reopens on change when charter approval is required). A plan without the `pmo.change_control` sub-feature reads as `off`.
   - `optional`: requests can be raised and decided; nothing is blocked.
   - `required`: once the project is `executing`, edits to the charter scope fields (`liwan_scope`, `liwan_exclusions`, `liwan_high_level_requirements`, `liwan_deliverables`) and budget fields are refused with `409 change_required` unless an approved, not yet implemented request exists on the project. The baseline joins the list with phase 4 (add its fields to `CHANGE_CONTROLLED_FIELDS`). Both `optional` and `required` retire the phase 1 reopening of an approved charter.
   Existing data keeps working because the default does not block.
4. **Categories** are a company value list (owner constitution 2026-10-28), not a fixed selection: model `liwan.project.change.category` (the charter catalog mixin: company, `name`, `sequence`, `active`, plus `seed_key`) seeded with `scope`, `schedule`, `cost`, `quality`, `other` for every company by the model's `init` and by `res.company.create`, through the existing documented provisioning `sudo()` of `res_company.py` (its one site now serves both seeds; no new `sudo()`). The tenant adds, renames and archives its own from the PMO settings section. Routes `GET /api/v1/pmo/change-categories` (readers of projects; `?active=all` for settings managers) and `POST`/`PATCH` (`pmo.settings.manage`); there is no delete, a used category is archived.

## Schema (`liwan_pmo`, version bump + migration directory in the same commit)

`liwan.project.change` (company scope, ordered by `number desc`):
`project_id` (cascade), `company_id` (related stored), `number` (per project, set under a project row lock), `title`, `description`,
`reason`, `category_id` (many2one, set null), `state`, `requester_id`, `impact_schedule_days` (int, may be negative), `impact_cost` (monetary, project currency),
`impact_scope` (text), `decided_by_id`, `decided_at`, `decision_note`, `implemented_at`, `liwan_revision` (as the charter does: the write token `v<revision>` travels as `expected_updated_at`).
Constraints: `UNIQUE(project_id, number)`; `CHECK(state in ...)`; a decision requires `decided_by_id` (so the user columns are `restrict`, users are archived, never deleted).
Nothing else is added to `project.project`. New `liwan.project.change.category` as in decision 4.

## API (`type='json2'`, `api_handler`, list envelope `{items, total}`)

- `GET /api/v1/projects/{id}/changes`, `GET .../changes/{cid}`
- `POST .../changes` (creates a draft), `PATCH .../changes/{cid}` (draft only, revision check)
- `POST .../changes/{cid}/submit|withdraw|approve|reject|implement`
Errors: 403 `forbidden`, 404 `not_found` (other company, hidden or archived project answers 404), 409 `change_state`, 409 `stale_write` (the repository's name for a stale token; PATCH requires `expected_updated_at`, the actions accept it), 409 `change_control_off`, 422 `invalid`.
A reject needs a note (1 to 2000 characters); an approve note is optional. Notifications (existing `liwan_notify` registry, delivered on the project with a new `liwan_change_id` column on `mail.message`): kinds `change_review` to the sponsor on submit, `change_approved` / `change_rejected` to the requester on decision; nobody is notified of their own action. The review row lives while the request still waits for that sponsor.

## Capabilities and features (R2, R10)

Categories use `pmo.settings.manage` to write. Reuse `pmo.projects.read` for reading, project membership (contextual) for raising, `pmo.projects.manage` (per project) for implement. Register the sub-feature
`pmo.change_control` in `feature_registry.py` with owner `liwan_pmo`, add it to the `projects` entry of the release catalogs (`deploy/catalog/solutions/platform_v3.json`, `platform_v4.json`: `tools/catalog_check.py` requires every registered feature in a tier) and to the platform entitlement test; every route checks `pmo.enabled` and `pmo.change_control`. The project detail carries the effective `change_control_mode`, so the web hides the page without reading the admin-only settings.

## Web (`apps/web`, pages are records, no new overlay)

`pages/projects/[id]/changes.vue` (list, filters by state/category, preserves query on back), `changes/[changeId].vue` (detail with
inline approve/reject confirmation, DESIGN.md), `changes/[changeId]/edit.vue` (a draft), `/projects/{id}/changes/new` opens `SharedCreatePanel`. A "Changes" tab beside the other governance sub-tabs (hidden while the mode is `off`). Contracts in
`packages/contracts/src/pmo/change.ts` (zod, exact parity with the serializer, recorded fixtures `pmo/project-change-list`, `pmo/project-change-detail`, `pmo/change-category-list`). The components are page-specific (`components/pmo/projects/changes/`), so no Storybook story is added. The mode and the categories are controlled in the project settings page; bell kinds are registered in the PMO manifest.
Arabic and English strings in the projects, settings, common and notifications namespaces.

## Tests

Odoo: state machine (every legal and illegal move), sponsor-only decision, manager-sponsor shortcut, admin cannot decide, note required on reject,
terminal state read-only, `required` mode blocks a charter edit while executing and allows it with an approved request, `optional` and `off` behaviour, a plan without the sub-feature, other-company 404 in the isolation matrix, category list isolation,
revision conflict, notification recipients. Contracts: zod round trip and the recorded fixtures. Web: composable, state map, decision panel and navigation unit tests, plus a browser pass on the isolated mock stack. Migration: a `migrations/19.0.1.9.0/README.md` (new tables only), and a test that an existing project starts with no requests.

## Files owned

`odoo-addons/liwan_pmo/{models/project_change.py,models/project_change_notifications.py,controllers/project_changes.py,serializers/project_change.py,security/*,tests/test_project_change.py,migrations/*,__manifest__.py}`,
`packages/contracts/src/pmo/change.ts` (+ index export), `apps/web/app/pages/projects/[id]/changes*`, `apps/web/app/components/pmo/projects/changes/**`, `apps/web/app/components/pmo/projects/settings/ChangeCategoriesPanel.vue`, PMO locale files.
Shared files edited by the orchestrator only: `models/project_charter.py` (retire the reopen rule when mode is not `off`, add the `required` guard), `models/liwan_settings.py`, `models/res_company.py`, the notification files, `controllers/projects.py`, `serializers/project.py`. No documented `sudo()` case is added; the reason of the `res_company.py` case in `tools/arch_documented_sudo.json` names the shared seed helper.

## Verification

Focused: `tools/odoo_test.py --addons liwan_pmo --no-dependents --base origin/main` (with `LIWAN_CONTRACT_FIXTURES=<dir>` to record the fixtures), vitest and `vue-tsc` from `apps/web` on Node 22 through `tools/test_slot.py`, then `npm test`,
`python3 -B tools/git_policy.py --base origin/main`, `python3 -B tools/arch_policy.py --base origin/main`, `tools/catalog_check.py`, and the `odoo-reviewer` agent. `docs/api/openapi.json` and `route-capabilities.json` are regenerated by the integration candidate, never by this branch.

## Out of scope

Approval chains with several approvers, change-impact auto-calculation from tasks, attachments on requests (use the existing attachment pattern in a follow-up).
