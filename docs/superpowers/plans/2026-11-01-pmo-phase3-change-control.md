# PMO phase 3: change control

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 3 is in Launch 1.
Branch `codex/pmo-change-control`. Depends on phase 1 (charter approval, merged).

## Goal

An approved project changes scope, schedule or cost only through a recorded change request: the requester states the change and its
impact, the sponsor approves or rejects it, and the register keeps the history. This replaces the phase 1 rule D3 ("changing an approved
charter reopens it") with change requests.

## Decisions for owner review

1. **States:** `draft -> submitted -> approved | rejected`, plus `withdrawn` (requester, before decision) and `implemented` (manager, after approval). Terminal states are read-only.
2. **Who decides:** the project sponsor (`liwan_sponsor_id`), like the charter. A manager who is also the sponsor decides directly. Admins change the sponsor instead of deciding. The decision fields are written on the new model itself, without `sudo()`: the PMO user group gets create/write ACL rows on `liwan.project.change`, and the model's `write()` refuses decision fields unless they come through the decision methods, which check the sponsor (or manager-sponsor) first. The project helper `_liwan_write_sudo` is specific to `project.project` and is not reused.
3. **Company setting `change_control_mode`** (scope: company; default `optional`; changed by `pmo.settings.manage`):
   - `off`: no change requests; today's behaviour (charter reopens on change when charter approval is required).
   - `optional`: requests can be raised and decided; nothing is blocked.
   - `required`: once the project is `executing`, edits to charter scope, budget and baseline are refused with `409 change_required` unless an approved, not yet implemented request covers them.
   Existing data keeps working because the default does not block.
4. **Categories** are a company value list (owner constitution 2026-10-28), not a fixed selection: model `liwan.project.change.category` (company, `name`, `sequence`, `active`) seeded with `scope`, `schedule`, `cost`, `quality`, `other`; the tenant adds, renames and archives its own from the PMO settings section. Routes `GET/POST/PATCH /api/v1/pmo/change-categories` (`pmo.settings.manage`).

## Schema (`liwan_pmo`, version bump + migration directory in the same commit)

`liwan.project.change` (company scope, ordered by `number desc`):
`project_id` (cascade), `company_id` (related stored), `number` (per project, set under a project row lock), `title`, `description`,
`reason`, `category_id` (many2one, set null), `state`, `requester_id`, `impact_schedule_days` (int, may be negative), `impact_cost` (monetary, project currency),
`impact_scope` (text), `decided_by_id`, `decided_at`, `decision_note`, `implemented_at`, `liwan_revision` (as the charter does).
Constraints: `UNIQUE(project_id, number)`; `CHECK(state in ...)`; a decision requires `decided_by_id`.
Nothing else is added to `project.project`. New `liwan.project.change.category` as in decision 4.

## API (`type='json2'`, `api_handler`, list envelope `{items, total}`)

- `GET /api/v1/projects/{id}/changes`, `GET .../changes/{cid}`
- `POST .../changes` (creates a draft), `PATCH .../changes/{cid}` (draft only, revision check)
- `POST .../changes/{cid}/submit|withdraw|approve|reject|implement`
Errors: 403 `forbidden`, 404 `not_found` (other company or hidden project answers 404), 409 `change_state`, 409 `stale_revision`, 422 `invalid`.
Approve/reject require a note on reject. Notifications: sponsor bell on submit, requester bell on decision (existing `notification_types` registry).

## Capabilities and features (R2, R10)

Categories use `pmo.settings.manage`. Reuse `pmo.projects.read` for reading, project membership (contextual) for raising, `pmo.projects.manage` for implement. Register the sub-feature
`pmo.change_control` in `feature_registry.py` with owner `liwan_pmo`; every route checks it. `change_control_mode = off` hides the page.

## Web (`apps/web`, pages are records, no new overlay)

`pages/projects/[id]/changes.vue` (list, filters by state/category, preserves query on back), `pages/projects/[id]/changes/[cid].vue` (detail with
inline approve/reject confirmation, DESIGN.md), `/projects/{id}/changes/new` opens `SharedCreatePanel`. A "Changes" tab in the project tabs. Contracts in
`packages/contracts/src/pmo/change.ts` (zod, exact parity with the serializer). Storybook story for the state badge/row component if a new shared component is added.
Arabic strings in the PMO locale namespace.

## Tests

Odoo: state machine (every legal and illegal move), sponsor-only decision, manager-sponsor shortcut, admin cannot decide, note required on reject,
terminal state read-only, `required` mode blocks a charter edit while executing and allows it with an approved request, other-company 404,
revision conflict, notification recipients. Contracts: zod round trip. Web: list/detail unit tests and a mock e2e path. Migration test: existing project, no change rows.

## Files owned

`odoo-addons/liwan_pmo/{models/project_change.py,controllers/project_changes.py,serializers/project_change.py,security/*,tests/test_project_change.py,migrations/*,__manifest__.py}`,
`packages/contracts/src/pmo/change.ts` (+ index export), `apps/web/app/pages/projects/[id]/changes*`, `apps/web/app/components/projects/changes/**`, PMO locale files.
Shared files edited by the orchestrator only: `models/project_charter.py` (retire the reopen rule when mode is not `off`). No documented `sudo()` case is added.

## Verification

Focused: `tools/odoo_test.py --addons liwan_pmo --no-dependents`, vitest and `vue-tsc` from `apps/web` on Node 22 through `tools/test_slot.py`, then `npm test`,
`python3 -B tools/git_policy.py --base main`, `python3 -B tools/arch_policy.py --base main`, and the `odoo-reviewer` agent.

## Out of scope

Approval chains with several approvers, change-impact auto-calculation from tasks, attachments on requests (use the existing attachment pattern in a follow-up).
