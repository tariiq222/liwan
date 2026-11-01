# PMO phase 8: risk matrix

Part of the [PMO PMI gaps master plan](2026-10-15-pmo-pmi-gaps-master.md). Owner decision 2026-10-29 (issue #24): phase 8 is in Launch 1. Branch `codex/pmo-risk-matrix`. No dependency, but it edits `models/project_governance.py`, so it runs after phase 3 merges and never in parallel with a change to that file.

## Goal

The risk register (`liwan.project.register`, kind `risk`, today probability 1..5 x impact 1..5 = score) gains a category, a response strategy, residual risk and a heat map.

## Decisions for owner review

1. **Settings** (company scope, `pmo.settings.manage`): `risk_scale` (`3` or `5`, default `5`, keeps today's data valid) and the score bands (`low_max`, `medium_max`, defaults 4 and 12 for the 5x5 scale; validated to be increasing). A scale change is refused while open risks hold values outside it.
2. **Categories** are a company value list, not free text: model `liwan.risk.category` seeded with `technical`, `schedule`, `cost`, `resources`, `external`, `legal`; the tenant adds, renames and archives its own from the PMO settings section, so any sector can shape it.
3. **Response strategy** (selection, threats): `avoid`, `mitigate`, `transfer`, `accept`, `escalate`. Opportunities are out of scope. `mitigate` and `avoid` ask for a response text; `accept` asks for a reason.
4. **Residual risk:** `residual_probability` and `residual_impact`, optional, same scale, computed `residual_score`.
5. **No gate** in Launch 1. A later optional gate "no open high risk without a response" is noted but not built.

## Schema (version bump + migration)

On `liwan.project.register`: `category_id` (many2one, set null), `strategy`, `trigger` (text), `contingency` (text), `residual_probability`, `residual_impact`, `residual_score` (stored compute). Existing `response` text stays the response description. Issues ignore the new fields (validators reject them, like probability/impact today).
New `liwan.risk.category` (company, `name`, `sequence`, `active`). Settings fields on `liwan.pmo.settings`. Existing risks are untouched; existing 1..5 values are valid under the default scale.
The hard-coded 1..5 range check in the register validator becomes the configured scale.

## API

- Register routes keep their paths; create/patch accept the new fields.
- `GET /api/v1/projects/{id}/register/matrix?kind=risk&residual=0|1` returns `{scale, bands, cells: [{probability, impact, count, ids}]}` over open risks the caller can see (visibility rules of `liwan.governance.visibility` apply).
- `GET/POST/PATCH /api/v1/pmo/risk-categories` for the settings screen (`pmo.settings.manage`).
Errors: 422 `invalid` for out-of-scale values, 403, 404, 409 `stale_revision`.

## Capabilities and features

Reuse the register capabilities; categories use `pmo.settings.manage`. Sub-feature `pmo.risk_matrix` (the plain register keeps working without it). No `sudo()`.

## Web

On `pages/projects/[id]/register.vue`: a heat-map toggle (grid coloured by band, click a cell filters the list through the URL query), category and strategy columns/filters, strategy fields in the edit page. PMO settings section gets "risk categories" and the scale/band controls. Contracts in `packages/contracts/src/pmo/register.ts` extended in place (no `v2`). Colour tokens come from the theme, not hard-coded.

## Tests

Scale 3 and 5 validation, scale change refused with out-of-scale open risks, band edges, matrix counts including closed risks excluded and hidden risks excluded, residual computation, strategy rules, category archive keeps old risks, issues reject risk fields, other-company 404, migration keeps existing rows.

## Files owned

`odoo-addons/liwan_pmo/{models/project_governance.py,models/risk_category.py,controllers/project_governance.py,serializers/project_governance.py,tests/test_project_governance.py,tests/test_risk_matrix.py,migrations/*}`, settings model/controller (orchestrator, shared), contracts, `apps/web/app/pages/projects/[id]/register*`, `apps/web/app/components/projects/register/**`, PMO settings page section.

## Verification

As phase 3.

## Out of scope

Opportunities, quantitative risk (monetary exposure, Monte Carlo), cross-project risk portfolio.
