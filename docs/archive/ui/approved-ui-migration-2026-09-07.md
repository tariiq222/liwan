> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Approved UI migration verification ledger

Status: committed UI migration and search polish merged into local `main` at `054766d` on 2026-09-07. Remaining acceptance cases are listed below; Git integration does not close those cases.

## Route inventory

| Page source | Section | Verification |
| --- | --- | --- |
| `apps/web/app/pages/projects/[id]/charter.vue` | Project files | See coverage below |
| `apps/web/app/pages/projects/[id]/finance/[entryId]/edit.vue` | Finance | See coverage below |
| `apps/web/app/pages/projects/[id]/finance/[entryId].vue` | Finance | See coverage below |
| `apps/web/app/pages/projects/[id]/finance/new.vue` | Finance | See coverage below |
| `apps/web/app/pages/projects/[id]/finance.vue` | Finance | See coverage below |
| `apps/web/app/pages/projects/[id]/milestones/[milestoneId]/edit.vue` | Tasks and plan | See coverage below |
| `apps/web/app/pages/projects/[id]/milestones/new.vue` | Tasks and plan | See coverage below |
| `apps/web/app/pages/projects/[id]/raci.vue` | Stakeholders and responsibilities | See coverage below |
| `apps/web/app/pages/projects/[id]/register/[registerId]/edit.vue` | Risks and issues | See coverage below |
| `apps/web/app/pages/projects/[id]/register/[registerId].vue` | Risks and issues | See coverage below |
| `apps/web/app/pages/projects/[id]/register/index.vue` | Risks and issues | See coverage below |
| `apps/web/app/pages/projects/[id]/register/new.vue` | Risks and issues | See coverage below |
| `apps/web/app/pages/projects/[id]/schedule/tasks/[taskId].vue` | Tasks and plan | See coverage below |
| `apps/web/app/pages/projects/[id]/schedule.vue` | Tasks and plan | See coverage below |
| `apps/web/app/pages/projects/[id]/settings.vue` | Project settings | See coverage below |
| `apps/web/app/pages/projects/[id]/stakeholders/[stakeholderId]/edit.vue` | Stakeholders and responsibilities | See coverage below |
| `apps/web/app/pages/projects/[id]/stakeholders/[stakeholderId].vue` | Stakeholders and responsibilities | See coverage below |
| `apps/web/app/pages/projects/[id]/stakeholders/index.vue` | Stakeholders and responsibilities | See coverage below |
| `apps/web/app/pages/projects/[id]/stakeholders/new.vue` | Stakeholders and responsibilities | See coverage below |
| `apps/web/app/pages/projects/[id]/tasks/[taskId].vue` | Tasks and plan | See coverage below |
| `apps/web/app/pages/projects/[id]/tasks/new.vue` | Tasks and plan | See coverage below |
| `apps/web/app/pages/projects/[id]/updates/new.vue` | Summary and updates | See coverage below |
| `apps/web/app/pages/projects/[id].vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/projects/index.vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/projects/new.vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/project-templates/[id]/apply.vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/project-templates/[id]/edit.vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/project-templates/[id].vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/project-templates/index.vue` | Projects and templates | See coverage below |
| `apps/web/app/pages/project-templates/new.vue` | Projects and templates | See coverage below |

Legacy query views `tab=overview/tasks/list/board/milestones/updates` remain valid. Each must preserve task filters and list returnTo.

## Replacement ledger

- ProjectWorkspaceNav removed: project sections move to shell contextual navigation; local task/plan controls remain in content.
- TaskDetailPage now uses SharedPageHeader because route title moves from global header into content.
- Template index drops redundant page-header registration; template actions move beside page heading.

## Fresh baseline

- Before integration: npm test passed 120 contracts and 510 web tests.
- Isolated database: nasq_ui_20260907 cloned from the already-upgraded rehearsal database. No tests use odoo19.
- Final tests and browser evidence are pending; baseline is not acceptance of the new UI.

## Local verification — 2026-09-07

- Final typecheck passed. Contracts: 120 tests passed. Web: 518 tests passed.
- Browser route audit recorded 42 visits on the isolated 3980 runtime and `nasq_ui_20260907`: each had one main H1, no main alert and no document horizontal overflow. Evidence: `/tmp/nasq-ui-briefs/browser-route-audit.json`.
- Checked project summary, tasks, schedule, milestones, stakeholders/RACI, register, finance, charter, settings and their fixture-backed child routes. Template index/new were visited; template detail/edit/apply are still pending.
- Checked 390/768/1440 widths across representative pages, dark/cream/light and large font. This is not a full cross-product matrix.
- Expanded module rail measured 172px; contextual sidebar 244px. Header and rail both measured rgb(33, 64, 125), matching the saved primary color.
- Task search survived navigation through Finance and back to Tasks. Header search opened its approved dialog.
- Fixed initial sidebar hydration mismatch that could associate a section label with another section's link on direct navigation.
- Project creation through the scratch API was blocked by an inherited analytic-account access rule; project fixture was seeded through the ORM. UI project creation is not accepted by these checks. No tests or fixtures used `odoo19`.
- Remaining: English/LTR matrix, template detail/edit/apply, complete form-save flows, fresh screenshot capture (browser capture returned an error), and canonical runtime verification.

## Global search polish — 2026-09-07

- Compact global dialog with a single search bar, two-column quick navigation on desktop, one column on phones, and grouped results only after typing. Empty result groups are hidden. Existing permission guards, pagination, returnTo and keyboard opening remain.
- Dialog overlay/content now use layers 100/101 above shell header 60; shared overlay is lighter. Header search uses the shared brand foreground/background.
- Browser checks: 1440, 768 and 390 widths; light and dark with large font; 640px desktop dialog, 362px at 390 viewport, 620px capped mobile height with internal scrolling and no document overflow. Confirmed initial input focus, Escape/close focus return, real project result navigation and no-results state.
- Fresh `npm -w apps/web run lint` passed; focused business-overlays and shell-structure tests passed (4 tests). Local integration preview remains port3980; these changes are now merged into local main.

## Merge verification

- UI commit: `cc89d69`. Preserved branding/login commit: `e7aaf7a`. Combined commit: `054766d`.
- On the combined code: Nuxt prepare, web typecheck, 120 contract tests, 522 web tests and production build passed. Logs: `/tmp/nasq-merge-{prepare,types,tests,build}.log`. Main was fast-forwarded to that tested commit.
- No database tests used `odoo19`; no remote push or production deployment was performed.
