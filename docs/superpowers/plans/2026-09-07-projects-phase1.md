# Projects Phase One Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independent isolated packages, plus claude-delegate for Claude packages. Project instructions override skill commit/cleanup and broad worker-validation steps.

**Goal:** Deliver project templates, responsibility management, risk/issue register and project scheduling.
**Architecture:** Three vertical packages with fixed schedule/template contract; coordinator owns shared registration, navigation, translations and validation.
**Tech Stack:** Odoo 19 CE, Python, Nuxt 4/Vue 3, TypeScript, Zod, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-09-07-projects-phase1-design.md

## Global Constraints
- Existing project/company capabilities and ORM guards; no arbitrary sudo, no HR changes.
- Internal routes, SharedUnsavedChanges, i18n and logical RTL CSS, useHydrated, session API.
- No commits/push/merge/deploy/discard; never test odoo19.
- Separate source worktrees; max 3 writers; only coordinator broad gates.

### Task 1: Stakeholders, RACI and risk/issue register
**Files:** new models/project_governance.py, controllers/project_governance.py, serializers/project_governance.py, security/ir.model.access-governance.csv and project_governance_rules.xml, tests/test_project_governance.py; contracts pmo/governance.ts and __tests__/governance.test.ts; useProjectGovernance.ts; project/governance/*; pages/projects/[id]/stakeholders/**, raci.vue, register/**; delivery/governance-{ar,en}.json.
**Interfaces:** project-scoped /stakeholders, /raci, /register, item detail endpoints; strict items/total/can_manage lists. ProjectId never comes from writable payload. RACI task and stakeholder refs remain same project.
- [x] Write contract and Odoo tests covering private project read, cross-company ids, employee write denial, positive manager CRUD and uniqueness/score behavior.
- [x] Run focused contract tests for red when runner is available; implement feature without shared-file edits.
- [x] Implement pages, forms and URL filters; ensure actual CRUD drives server data and error/empty states.
- [x] Review whole package against spec and quality; integrate owned files.

### Task 2: Schedule
**Files:** models/project_task.py; new controllers/project_schedule.py, serializers/project_schedule.py, tests/test_project_schedule.py; pmo/schedule.ts, __tests__/schedule.test.ts; useProjectSchedule.ts; utils/projectSchedule.ts + test; components/project/schedule/*; pages/projects/[id]/schedule.vue and schedule/tasks/[taskId].vue; delivery/schedule-{ar,en}.json.
**Interfaces:** GET /projects/{id}/schedule; PATCH /projects/{id}/schedule/tasks/{taskId} {start,end}; task._nasq_set_schedule(start,end) private ORM method, date objects/False input.
- [x] Write tests for reversed and invalid dates, own-project access, ordinary-user denial, date clearing, hidden dependency filtering and date-only round trips.
- [x] Run focused tests for red; implement guarded scheduling model/API.
- [x] Build Gantt axis and internal schedule-edit page with safe date math and unsaved guard.
- [x] Review package; integrate before template verification.

### Task 3: Project templates
**Files:** new models/project_template.py, controllers/project_templates.py, serializers/project_template.py, security/ir.model.access-templates.csv and project_template_rules.xml, tests/test_project_templates.py; pmo/project-template.ts and test; useProjectTemplates.ts; components/project/templates/*; pages/project-templates/**; delivery/templates-{ar,en}.json.
**Interfaces:** /project-templates CRUD; POST /project-templates/{id}/apply {name,start_date} -> full ProjectDetail; uses Task 2 private schedule setter with calendar dates. Coordinator transferred narrowly scoped project_task.py ownership for template population authorization; ordinary task permissions remain unchanged.
- [x] Write tests rejecting duplicate/cyclic/invalid graph and date input; test policy, company isolation, fresh ids and atomic application.
- [x] Implement company-scoped definition validation and guarded application via existing private project create/stage/milestone/task/dependency helpers.
- [x] Implement template definition forms with stage/task/milestone row controls; list/detail/use pages.
- [x] Review package and apply schedule contract at integration.

### Task 4: Integration, acceptance and delivery
**Files:** nasq_pmo registration/manifest; pmo/index.ts; projects/[id].vue and projects/index.vue; locale projects.json; new e2e/projects-phase1.spec.ts; docs/projects-phase1-delivery.md.
- [x] Register feature models/controllers/tests/ACL/rules; merge locale fragments under projects namespaces and add navigation links.
- [x] Run npm test, npm run lint and npm run build sequentially in integration worktree.
- [x] Run Odoo test tags /nasq_core,/nasq_api,/nasq_pmo,/nasq_hr against isolated DB with explicit addons path; fix observed failures.
- [x] Run authenticated browser feature CRUD/template application and relevant project regressions on isolated ports; inspect screenshots.
- [x] Obtain independent package reviews, review shared integration, resolve actionable issues and rerun affected checks.
- [x] Record source state, evidence and remaining phase-two scope; leave work uncommitted in isolated worktree.

## Completion evidence
Local implementation accepted on 2026-09-07. See docs/projects-phase1-delivery.md for final commands, counts, independent reviews, baseline limitations, and retained worktree/runtime. No Git integration or deployment performed.
