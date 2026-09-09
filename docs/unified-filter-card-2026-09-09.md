# Unified filter cards — 2026-09-09

The user approved one collapsible filter-card design across the system, with module-owned fields. Implemented in `codex/meeting-filter-card`, based on main `5665902`; main remains unchanged. No commit, merge, push or deployment was performed for this change.

## Shared contract

`FilterCard.vue` owns the card, accessible toggle, active-filter count, clear action, persistent mounted fields, and active summary visible while collapsed. It is expanded by default and hydration-gated. `FilterBar.vue` adapts existing search/default/view/actions/active slots to the same card; view/actions remain available in its header. Modules own their state, query synchronization and actual clear handlers. Existing archive/closed view contexts are preserved by their original clear behavior.

Meetings now group all controls in one grid: search, state, personal scope, project, organizer and dates. The two date boundaries stay adjacent. Recommendations, series occurrences, project/task/HR/settings lists and the chat conversation list use the same shared design.

## Coverage

- `components/chat/ConversationList.vue`
- `components/hr/DirectoryTable.vue`
- `components/hr/DocumentList.vue`
- `components/task/TaskToolbar.vue`
- `pages/archived-tasks.vue`
- `pages/hr/departments/index.vue`
- `pages/hr/documents/index.vue`
- `pages/meetings/[id].vue`
- `pages/meetings/index.vue`
- `pages/meetings/series/[id].vue`
- `pages/meetings/series/index.vue`
- `pages/project-templates/index.vue`
- `pages/projects/[id]/finance.vue`
- `pages/projects/[id]/raci.vue`
- `pages/projects/[id]/register/index.vue`
- `pages/projects/[id]/stakeholders/index.vue`
- `pages/projects/dashboard.vue`
- `pages/projects/index.vue`
- `pages/settings/access-log/index.vue`
- `pages/settings/projects/catalogs/[resource]/index.vue`
- `pages/settings/roles/index.vue`
- `pages/settings/users/index.vue`

There are 22 filter-owning Vue surfaces. Shared TaskToolbar also covers personal and project task views; DocumentList covers department documents; catalog and detail routes are parameterized. Form selectors/picker searches, navigation search and calendar navigation remain their specialized controls because they are not list-filter regions. No business screens or permission checks were removed.

## Verification

Final combined source: 153 contract tests and 690 web tests (118 web files) passed. Vue type checking, production build and git diff checks passed. New rendered component tests cover accessible linkage, hydration disabling, visible clear actions, no nested buttons, mounted hidden field values, persistent active summaries and compatibility slots.

Nine earlier visual assertions expected the replaced toolbar class or explicitly prohibited FilterBar on archive/RACI. Those expectations were updated to require the approved shared card/count/clear contract. The other data, permission, pagination, matrix mutation, and navigation assertions were retained.

Browser checks: one card with functioning collapse on 12 main list routes, plus finance, register, stakeholders, RACI, catalogs, series detail, recommendation tab and chat. Meetings state remains in the URL/summary when collapsed; clear works while collapsed. Chat unread-filter URL/summary survives collapse and clears back to all. Chat list data displayed its unavailable state in the isolated fixture; this check establishes filter UI behavior, not successful chat data loading.

Mobile checks at 390px: meetings screenshot plus series, projects, tasks, HR, users, access-log and chat; document width was375px with one card and working collapse. Browser viewport override was reset. English labels are covered by rendered component tests and locale source; no English browser session was exercised.

Preview logs contain transient HMR/render warnings from editing during preview and hydration warnings on query-backed surfaces; the checks above do not claim a warning-free browser console. Production build and final unit/type checks passed.

## Preview and evidence

Preview: http://127.0.0.1:3969/meetings, frontend from this worktree; isolated backend8969 and scratch database `nasq_filter_card_20260909`, independent data directory `/tmp/nasq-filter-card/odoo-data`. Canonical main services3000/8069 and odoo19 were not changed or tested.

Evidence: `/tmp/nasq-filter-card` contains final `tests-complete.log`, `types-complete.log`, `build-complete.log`, `browser-checks.json`, worker patches and runtime logs/PIDs. Supporting worker snapshots remain in `nasq-filter-card-pmo` and `nasq-filter-card-admin`; their reviewed patches are included in this candidate. Preview/test files and credentials are outside the repository.
