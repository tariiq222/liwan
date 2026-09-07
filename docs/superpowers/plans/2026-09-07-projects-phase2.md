# Projects phase two implementation plan

> **For agentic workers:** Use executing-plans together with the requested Claude/Grok relays; the coordinator owns execution checks.

**Goal:** Deliver project budget entries, actual cost ledger and consolidated project reports.
**Architecture:** Add isolated nasq_pmo finance records and strict contracts; two parallel implementers consume frozen contracts. Coordinator copies reviewed owned files into integration worktree without Git merge or commits.
**Tech Stack:** Odoo19 CE, Nuxt4, Vue3, Zod, TanStack Query.
**Spec:** docs/superpowers/specs/2026-09-07-projects-phase2-design.md

## Global constraints
All rules in spec and CLAUDE.md apply. No new dependencies, no shared file writes by workers, no commits or deployment, no tests on odoo19. Project phase one remains separate. Write behavioral tests first; only coordinator executes gates.

## Tasks
- [ ] Freeze contracts in packages/contracts/src/pmo/project-finance.ts and project-reports.ts; test malformed money, zero vs unknown, discriminated entries, dates, strict writes and read shapes in __tests__/project-finance.test.ts. Export via pmo/index.ts.
- [ ] Claude: write tests/test_project_finance.py then models/project_finance.py, controllers/project_finance.py, serializers/project_finance.py, security/ir.model.access-finance.csv and project_finance_rules.xml. Implement live ORM visibility and atomic revision checks, finance CRUD and totals.
- [ ] Claude: write tests/test_project_reports.py then controllers/project_reports.py and serializers/project_reports.py. Use caller-visible project query, group rows without cap, task visibility, totals across all filtered rows and currency groups. Consumes summary helper from own finance package.
- [ ] Grok: write utils/__tests__/projectFinance.test.ts, then finance utilities, composables/useProjectFinance.ts and components/project/finance/*, pages/projects/[id]/finance.vue and finance/new.vue, finance/[entryId].vue, finance/[entryId]/edit.vue. Preserve URL filters, unsaved values and errors.
- [ ] Grok: implement composables/useProjectReports.ts and pages/reports.vue with real server totals, no full-list fetching, empty/error/loading and localization fragments delivery/phase2-ar.json and phase2-en.json.
- [ ] Coordinator: review complete owned diffs, integrate into phase2 checkout, add imports/manifest and merge projects.finance/projects.reports locale subtrees, project finance link; do not import other worktrees.
- [ ] Coordinator: npm test, npm run lint, npm run build sequentially; Odoo scratch command below; add and run authenticated browser CRUD/summary/report/permissions tests. Correct evidence-backed failures and repeat relevant gates only.
- [ ] Independent Astra review then coordinator final diff/validation and docs/projects-phase2-delivery.md. Leave uncommitted in isolated checkout.

## Verification commands
```sh
npm test
npm run lint
npm run build
cd /Users/tariq/code/odoo
.venv/bin/python odoo-bin -c /Users/tariq/code/odoo/odoo.conf --addons-path=/Users/tariq/code/odoo/addons,/Users/tariq/code/nasq-projects-phase2/odoo-addons -d nasq_phase2_20260907 -i nasq_core,nasq_api,nasq_pmo,nasq_hr --test-tags /nasq_core,/nasq_api,/nasq_pmo,/nasq_hr --http-port=9969 --stop-after-init
```
Browser fixture and runtime commands follow existing apps/web/e2e and playwright.config.ts with isolated env/database/ports. Target assertions: budget 1000 plus expense 250 yields planned1000/actual250/remaining750, filtering entries does not alter summary; unknown budget stays null, explicit zero with expense is over budget; edit stale returns409, deleting referenced budget409, reader cannot mutate, hidden/foreign project excluded, 201+ visible project reports cover all matching totals across pages. No source changes to pre-existing tests to dilute assertions.
