# Historical phase snapshot reconciliation

These source snapshots are preserved as merge parents. Their features had already reached main through the earlier projects-phase integration. Current code retains later fixes. Each listed path was compared against the preserved snapshot; equal files are retained directly.

| Source | Path | Final decision |
| --- | --- | --- |
| `codex/phase1-governance` | `apps/web/app/components/project/governance/RegisterForm.vue` | Identical source content retained. |
| `codex/phase1-governance` | `apps/web/app/components/project/governance/StakeholderForm.vue` | Identical source content retained. |
| `codex/phase1-governance` | `apps/web/app/components/project/governance/__tests__/mutations.test.ts` | Identical source content retained. |
| `codex/phase1-governance` | `apps/web/app/components/project/governance/__tests__/state.test.ts` | Identical source content retained. |
| `codex/phase1-governance` | `apps/web/app/components/project/governance/state.ts` | Identical source content retained. |
| `codex/phase1-governance` | `apps/web/app/composables/useProjectGovernance.ts` | Identical source content retained. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/raci.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/register/[registerId].vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/register/[registerId]/edit.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/register/index.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/register/new.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/stakeholders/[stakeholderId].vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/stakeholders/[stakeholderId]/edit.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/stakeholders/index.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `apps/web/app/pages/projects/[id]/stakeholders/new.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-governance` | `delivery/governance-ar.json` | Identical source content retained. |
| `codex/phase1-governance` | `delivery/governance-en.json` | Identical source content retained. |
| `codex/phase1-governance` | `delivery/governance-fix-report.md` | Identical source content retained. |
| `codex/phase1-governance` | `delivery/governance-report.md` | Identical source content retained. |
| `codex/phase1-governance` | `delivery/governance-vitest.config.ts` | Identical source content retained. |
| `codex/phase1-governance` | `odoo-addons/webvue_pmo/controllers/project_governance.py` | Identical source content retained. |
| `codex/phase1-governance` | `odoo-addons/webvue_pmo/models/project_governance.py` | Identical source content retained. |
| `codex/phase1-governance` | `odoo-addons/webvue_pmo/security/ir.model.access-governance.csv` | Identical source content retained. |
| `codex/phase1-governance` | `odoo-addons/webvue_pmo/security/project_governance_rules.xml` | Identical source content retained. |
| `codex/phase1-governance` | `odoo-addons/webvue_pmo/serializers/project_governance.py` | Identical source content retained. |
| `codex/phase1-governance` | `odoo-addons/webvue_pmo/tests/test_project_governance.py` | Retain newer tests and formatting; source test-name inventory has no missing cases. |
| `codex/phase1-governance` | `packages/contracts/src/pmo/__tests__/governance.test.ts` | Identical source content retained. |
| `codex/phase1-governance` | `packages/contracts/src/pmo/governance.ts` | Identical source content retained. |
| `codex/phase1-schedule` | `odoo-addons/webvue_pmo/models/project_task.py` | Retain current server-owned template population scope and meeting conversion fields; preserve schedule write guard. |
| `codex/phase1-schedule` | `apps/web/app/components/project/schedule/ScheduleGantt.vue` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `apps/web/app/components/project/schedule/ScheduleTaskForm.vue` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `apps/web/app/composables/useProjectSchedule.ts` | Retain current task plus schedule cache invalidation after rescheduling. |
| `codex/phase1-schedule` | `apps/web/app/pages/projects/[id]/schedule.vue` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `apps/web/app/pages/projects/[id]/schedule/tasks/[taskId].vue` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `apps/web/app/utils/__tests__/projectSchedule.test.ts` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `apps/web/app/utils/projectSchedule.ts` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `delivery/schedule-ar.json` | Identical source content retained. |
| `codex/phase1-schedule` | `delivery/schedule-en.json` | Identical source content retained. |
| `codex/phase1-schedule` | `delivery/schedule-report.md` | Identical source content retained. |
| `codex/phase1-schedule` | `odoo-addons/webvue_pmo/controllers/project_schedule.py` | Identical source content retained. |
| `codex/phase1-schedule` | `odoo-addons/webvue_pmo/serializers/project_schedule.py` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `odoo-addons/webvue_pmo/tests/test_project_schedule.py` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-schedule` | `packages/contracts/src/pmo/__tests__/schedule.test.ts` | Identical source content retained. |
| `codex/phase1-schedule` | `packages/contracts/src/pmo/schedule.ts` | Retain newer project-date-aware capped Gantt, route query scale, current serializer/date-type fixes; coordinator restores accessible dates and markers. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/models/project_task.py` | Retain current server-owned template population scope and meeting conversion fields; preserve schedule write guard. |
| `codex/phase1-templates` | `apps/web/app/components/project/templates/ProjectTemplateEditor.vue` | Identical source content retained. |
| `codex/phase1-templates` | `apps/web/app/components/project/templates/__tests__/ProjectTemplateEditor.test.ts` | Retain newer tests and formatting; source test-name inventory has no missing cases. |
| `codex/phase1-templates` | `apps/web/app/composables/useProjectTemplates.ts` | Retain current project cache seeding/invalidation after template application. |
| `codex/phase1-templates` | `apps/web/app/pages/project-templates/[id].vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-templates` | `apps/web/app/pages/project-templates/[id]/apply.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-templates` | `apps/web/app/pages/project-templates/[id]/edit.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-templates` | `apps/web/app/pages/project-templates/index.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-templates` | `apps/web/app/pages/project-templates/new.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase1-templates` | `delivery/templates-ar.json` | Identical source content retained. |
| `codex/phase1-templates` | `delivery/templates-en.json` | Identical source content retained. |
| `codex/phase1-templates` | `delivery/templates-fix-report.md` | Identical source content retained. |
| `codex/phase1-templates` | `delivery/templates-read-scope-report.md` | Identical source content retained. |
| `codex/phase1-templates` | `delivery/templates-report.md` | Identical source content retained. |
| `codex/phase1-templates` | `delivery/templates-unit.config.mjs` | Identical source content retained. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/controllers/project_templates.py` | Identical source content retained. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/models/project_template.py` | Retain equivalent template variable refactor with restricted context and scoped task population. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/security/ir.model.access-templates.csv` | Identical source content retained. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/security/project_template_rules.xml` | Identical source content retained. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/serializers/project_template.py` | Identical source content retained. |
| `codex/phase1-templates` | `odoo-addons/webvue_pmo/tests/test_project_templates.py` | Retain newer tests and formatting; source test-name inventory has no missing cases. |
| `codex/phase1-templates` | `packages/contracts/src/pmo/__tests__/project-template.test.ts` | Identical source content retained. |
| `codex/phase1-templates` | `packages/contracts/src/pmo/project-template.ts` | Identical source content retained. |
| `codex/phase2-backend` | `packages/contracts/src/pmo/index.ts` | Retain combined governance/schedule/templates/finance/report contract exports. |
| `codex/phase2-backend` | `docs/superpowers/plans/2026-09-07-projects-phase2.md` | Later integrated report retained; original historical report remains in source commit. |
| `codex/phase2-backend` | `docs/superpowers/specs/2026-09-07-projects-phase2-design.md` | Later integrated report retained; original historical report remains in source commit. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/controllers/project_finance.py` | Retain current explicit PMO read guards, exact-cent storage and validated current-company fixtures. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/controllers/project_reports.py` | Retain current company-scoped fixtures and formatting; report behavior remains integrated. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/models/project_finance.py` | Retain current explicit PMO read guards, exact-cent storage and validated current-company fixtures. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/security/ir.model.access-finance.csv` | Identical source content retained. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/security/project_finance_rules.xml` | Identical source content retained. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/serializers/project_finance.py` | Identical source content retained. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/serializers/project_reports.py` | Identical source content retained. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/tests/test_project_finance.py` | Retain current explicit PMO read guards, exact-cent storage and validated current-company fixtures. |
| `codex/phase2-backend` | `odoo-addons/webvue_pmo/tests/test_project_reports.py` | Retain current company-scoped fixtures and formatting; report behavior remains integrated. |
| `codex/phase2-backend` | `packages/contracts/src/pmo/project-finance.ts` | Identical source content retained. |
| `codex/phase2-backend` | `packages/contracts/src/pmo/project-reports.ts` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/pages/reports.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase2-web` | `packages/contracts/src/pmo/index.ts` | Retain combined governance/schedule/templates/finance/report contract exports. |
| `codex/phase2-web` | `apps/web/app/components/project/finance/FinanceBudgetPicker.vue` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/components/project/finance/FinanceEntryForm.vue` | Retain current shared page chrome, guarded writes and retryLatest optimistic-concurrency recovery. |
| `codex/phase2-web` | `apps/web/app/components/project/finance/FinanceEntryTable.vue` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/components/project/finance/FinanceSummaryCards.vue` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/components/project/finance/ReportTable.vue` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/components/project/finance/ReportTotals.vue` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/composables/useProjectFinance.ts` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/composables/useProjectReports.ts` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/pages/projects/[id]/finance.vue` | Retain newer shared page/table/control chrome and complete project workspace navigation; source workflow remains present. |
| `codex/phase2-web` | `apps/web/app/pages/projects/[id]/finance/[entryId].vue` | Retain current shared page chrome, guarded writes and retryLatest optimistic-concurrency recovery. |
| `codex/phase2-web` | `apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue` | Retain current shared page chrome, guarded writes and retryLatest optimistic-concurrency recovery. |
| `codex/phase2-web` | `apps/web/app/pages/projects/[id]/finance/new.vue` | Retain current shared page chrome, guarded writes and retryLatest optimistic-concurrency recovery. |
| `codex/phase2-web` | `apps/web/app/utils/__tests__/projectFinance.test.ts` | Identical source content retained. |
| `codex/phase2-web` | `apps/web/app/utils/projectFinance.ts` | Identical source content retained. |
| `codex/phase2-web` | `delivery/phase2-ar.json` | Identical source content retained. |
| `codex/phase2-web` | `delivery/phase2-en.json` | Identical source content retained. |
| `codex/phase2-web` | `docs/superpowers/plans/2026-09-07-projects-phase2.md` | Later integrated report retained; original historical report remains in source commit. |
| `codex/phase2-web` | `docs/superpowers/specs/2026-09-07-projects-phase2-design.md` | Later integrated report retained; original historical report remains in source commit. |
| `codex/phase2-web` | `packages/contracts/src/pmo/project-finance.ts` | Identical source content retained. |
| `codex/phase2-web` | `packages/contracts/src/pmo/project-reports.ts` | Identical source content retained. |
