# PMO phase 6: formal closure

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 6 is in Launch 1. Branch `codex/pmo-closure`. Depends on phase 2 (gates, merged).

## Goal

Moving a project from `closing` to `closed` needs deliverable acceptance, lessons learned and a final report, recorded in the project and frozen after closing.

## Decisions for owner review

1. **One closure record per project**, created when the project enters `closing`. After `closed` it is read-only.
2. **Company settings** (company scope, changed by `pmo.settings.manage`): `closure_require_acceptance` (default true: every listed deliverable must be accepted), `closure_min_lessons` (default 1, 0 disables), `closure_sponsor_signoff` (default false: when true the sponsor must sign the final report; a sponsor-manager signs directly).
3. **Gate:** `_liwan_gate_checks('closed')` keeps `no_open_tasks` and adds `closure_complete` built from the three settings. The `allow_with_warning` policy for open tasks stays as is; the closure checks are blocking.
4. **Outcome** (selection): `successful`, `partially_successful`, `unsuccessful`, `cancelled`.

## Schema (version bump + migration)

`liwan.project.closure`: `project_id` (unique), `outcome`, `summary` (text), `final_end_date`, `final_cost` and `final_budget` (snapshot written at close from the finance source), `signed_by_id`, `signed_at`, `closed_at`, `liwan_revision`.
`liwan.project.closure.deliverable`: `closure_id`, `title`, `accepted` (bool), `accepted_by_id`, `accepted_at`, `note`.
`liwan.project.lesson`: `project_id`, `category` (`planning`, `execution`, `people`, `tools`, `other`), `what_happened`, `recommendation`, `author_id`. Lessons also stay readable after close.
A project already `closed` before the migration gets no closure record and shows "closed before closure records".

## API

- `GET /api/v1/projects/{id}/closure` (record + deliverables + lessons + the gate checks)
- `PATCH .../closure` (outcome, summary; revision check; refused when closed)
- `POST/PATCH/DELETE .../closure/deliverables[/{did}]`, `POST .../closure/deliverables/{did}/accept`
- `POST/PATCH/DELETE .../lessons[/{lid}]`
- `POST .../closure/sign` (sponsor sign-off when required)
Closing the project itself stays the existing phase move; the snapshot fields are written in the same transaction as `liwan_phase = closed`.
Errors: 403, 404, 409 `closure_locked`, 409 `stale_revision`, 422 `invalid`.

## Capabilities and features

Read `pmo.projects.read`; edit and accept `pmo.projects.manage`; sign by the sponsor through the existing `_liwan_write_sudo` whitelist for the two signature fields (same pattern as charter approval), no new `sudo()`. Sub-feature `pmo.closure`.

## Web

`pages/projects/[id]/closure.vue`: checklist card (deliverables with inline accept), lessons list with inline add, final report form, gate status. The phase card links to it when the project is `closing`. Contracts: `packages/contracts/src/pmo/closure.ts`.

## Tests

Gate matrix over the three settings, accept/unaccept before close, lesson CRUD, sponsor sign-off paths, frozen after close (writes refused), snapshot cost equals finance totals, other-company 404, migration of closed projects.

## Files owned

`odoo-addons/liwan_pmo/{models/project_closure.py,controllers/project_closure.py,serializers/project_closure.py,security/*,tests/test_project_closure.py,migrations/*}`, gate override in `models/project_phase.py` (orchestrator), contracts, `apps/web/app/pages/projects/[id]/closure.vue`, `apps/web/app/components/projects/closure/**`.

## Verification

As phase 3.

## Out of scope

Cross-project lessons library and search, archiving documents, closure of benefits.
