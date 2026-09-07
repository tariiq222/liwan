# Governance delivery report

## Source completion

Implemented the phase-one stakeholders, RACI, and risk/issue register package in the isolated governance worktree.

- Odoo models: `odoo-addons/nasq_pmo/models/project_governance.py`
  - `nasq.project.stakeholder` with optional `res.users` reference and free-text external contact fields.
  - `nasq.project.raci` with same-project task/stakeholder guards, `UNIQUE(task_id, stakeholder_id)`, and stored `UNIQUE(accountable_task_id)` for at-most-one `A` assignment.
  - `nasq.project.register` with immutable kind/project, risk-only 1..5 probability/impact, and stored score.
- API: `controllers/project_governance.py` and `serializers/project_governance.py`
  - Project-scoped `/stakeholders`, `/raci`, and `/register` collections with item GET/PATCH/DELETE routes.
  - Strict field whitelists, `{items,total,can_manage}` list envelopes, current-company/active project guards, same-project task and owner validation, URL filters, and explicit 409 stakeholder-assignment deletion response.
  - Register task references are serialized only after a task visibility check.
- Security: `security/ir.model.access-governance.csv` and `security/project_governance_rules.xml`
  - ACLs permit the existing capability and contextual-owner ORM path to reach the model guards.
  - Global relational rules require active current-company parent projects and readable linked tasks for RACI rows.
- Tests: `tests/test_project_governance.py` covers manager CRUD, employee denial, duplicate RACI uniqueness, score behavior, linked deletion conflict, parent immutability, and foreign-company scope.
- Contracts: `packages/contracts/src/pmo/governance.ts` and `packages/contracts/src/pmo/__tests__/governance.test.ts`.
- Web: `apps/web/app/composables/useProjectGovernance.ts`, `components/project/governance/{StakeholderForm,RegisterForm}.vue`, stakeholder CRUD pages, register CRUD/filter pages, and `projects/[id]/raci.vue` with inline assignment controls. People and task references use searchable existing name selectors filtered to the current project; destructive list actions use inline confirmation.
- Translation fragments: `delivery/governance-ar.json` and `delivery/governance-en.json`.

## Coordinator registration

The coordinator must register the following owned files in shared addon barrels/manifest and merge the locale fragments under the existing `projects` namespace:

1. Import `models.project_governance` from `odoo-addons/nasq_pmo/models/__init__.py`.
2. Import `controllers.project_governance` from `odoo-addons/nasq_pmo/controllers/__init__.py`.
3. Import `serializers.project_governance` from `odoo-addons/nasq_pmo/serializers/__init__.py` if the addon serializer barrel is used.
4. Import `tests.test_project_governance` from `odoo-addons/nasq_pmo/tests/__init__.py`.
5. Add `security/ir.model.access-governance.csv` and `security/project_governance_rules.xml` to the addon manifest data list.
6. Export `pmo/governance.ts` through `packages/contracts/src/pmo/index.ts` and the package barrel.
7. Add the governance locale entries to existing `apps/web/i18n/locales/{ar,en}/projects.json`, and add project navigation links from the coordinator-owned project pages/navigation.

## Focused verification

- `npm_config_userconfig=/dev/null npm ci --ignore-scripts --no-audit --no-fund` completed in this isolated worktree.
- `npm test --workspace @nasq/contracts -- --run src/pmo/__tests__/governance.test.ts`: 3 tests passed.
- `npx tsc --noEmit -p packages/contracts/tsconfig.json`: passed.
- `python3 -m py_compile` on all new Python model/controller/serializer/test files: passed.
- XML and locale JSON parsing: passed.
- `ruff check` on all new Python files: passed.
- `git diff --check`: passed.

No Odoo server, database, browser runtime, full test suite, build, lint, or deployment gate was run in this worker, per the worktree brief. The coordinator must run the registered addon tests and integration gates after copying these owned files.

## Residual risk

The shared addon imports, manifest data entries, contract barrel export, project navigation, and existing `projects.json` merge remain coordinator-owned and are intentionally absent here. Stakeholder and register forms now use the existing people query and project-filtered task query for name-based selectors; only the resulting ids are sent in API payloads. The RACI page uses the same project-filtered task query and stakeholder list, with loading/error/empty states.
