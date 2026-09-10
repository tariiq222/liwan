# UI migration and legacy retirement

Authority: [DESIGN.md](../../DESIGN.md). Current target: Nuxt UI Dashboard.
Use [the pinned reference and current migration sequence](nuxt-ui-reference.md).
The executable reference is isolated in apps/web/design-preview; customer-app
migration is still separate. The current UPDATE_POLICY supersedes historical
hook/approval instructions. Every new component belongs to the Nasq theme and catalog.
The phases below describe the older 2026-09-07 rollout only, not an alternative
implementation plan for new pages.

## Phase A — constitution

- Pin the user-approved 2026-09-07 prototype inside the repository.
- Route project instructions and frontend role to one constitution.
- Mark old UI instructions superseded while retaining historical verification and business contracts.
- Check changed Markdown links, references and diff whitespace.
- No claim that Markdown alone enforces every coding tool or that frontend CI has been installed.

## Phase B — layout and shared components

Coordinator owns `layouts/default.vue`, `AppSidebar.vue`, shared navigation/header/container, `main.css`, `approved-shell.css`, appearance/branding and shared locale keys.
Inventory existing selectors/token definitions and all consumers first. Produce a replacement table: old source → new owner → migrated consumers → removal evidence.
Implement module rail with its own collapse control and hover/focus labels, always-visible route-derived contextual navigation, inline context icon/title, one page title and responsive content area. Context navigation has no collapse state and reflows above content on phones.
Implement the user-requested global search/account header and unified header/rail background using the exact saved company primary colour and contrasting text/icons, with scrolling module navigation. Compare page composition as well as component details against the updated reference.
Keep all current module routes and capabilities. Preserve saved primary colour, dark mode, font preferences and hydration.
Consolidate the current CSS into clearly owned token and component rules; remove replaced definitions once references are gone, without creating another theme layer.
Add actual checks for new duplicate root token definitions/forbidden page theme literals and navigation regressions. If a temporary legacy allowlist is necessary, it must be explicit, path-bound and shrink-only.
Acceptance includes direct links, reload/back, query persistence, module switching, keyboard/tooltips, primary-rail collapse states, visible context navigation, light/dark and mobile/desktop. Claim automated enforcement only after those checks are wired into the project's normal validation command.

## Phase C — every Projects route

Inventory `apps/web/app/pages/projects/**` and nested task routes before slicing implementation.
Cover project list/create/templates, project summary, updates/history, tasks list/board, task detail/create/edit, schedule, milestones, stakeholders/RACI, register, finance/budgets/expenses, charter and settings. The inventory, not this abbreviated list, determines completeness.
Keep old direct links working and preserve list/view/filter state. Preserve finance operations, status calculations, manual milestones, charter fields and capability checks unless a separate behavior change is explicitly approved.
Group navigation into the six sections in DESIGN.md; update section actions and eliminate duplicated forms/chrome.
One package may implement a page family after shared layout contracts land; no competing global CSS writers.
The final report maps every route to its new section, components, states and verification evidence.

## Superseded references

| Historical source | What is replaced |
| --- | --- |
| `docs/design-system/Components.html` | Sole approved component vocabulary; retains legacy colour-demo evidence only |
| `docs/design-system/approved-shell.html` | Former visual authority |
| 2026-09-05 design-system spec/plan | Old visual/component choices; data/branding constraints remain |
| 2026-09-06 approved-design-rollout spec/plan and fidelity report | Old sidebar geometry, universal icon actions and tab layout |
| `docs/plans/2026-09-07-project-workspace-tabs.md` | Ten-section tab navigation and blanket no-returnTo instruction |
| `docs/design-system/settings.md` | Independent internal-navigation placement and fixed-width visual authority |

Odoo vendor-console theme, upstream libraries, licensing records and generated recovery snapshots are outside this replacement. Do not rewrite third-party skill text or erase evidence. Repository entrypoints give Nasq-specific instructions precedence over examples.
