# Shared component catalog

Authority: [DESIGN.md](../../DESIGN.md). This catalog records current reusable code and pending migration; names in the approved HTML reference are not Vue APIs.

## Existing owners

| Responsibility | Current source | Usage |
| --- | --- | --- |
| App shell | `apps/web/app/layouts/default.vue` | One outer layout |
| Global search | `components/GlobalSearch.vue` | Shared centered dialog; compact search header, capability-filtered quick navigation, grouped query results and internal scrolling. Shared dialog layers sit above the app header. |
| Primary navigation | `apps/web/app/components/shell/ModuleRail.vue`, `components/shell/ContextSidebar.vue`, `composables/useNav.ts`, `composables/useShellNavigation.ts` | Rail order is chat, meetings, projects, tasks, HR, with settings and vendor utilities anchored below. Context navigation preserves capability gates and project order; settings links group into personal and administration sections, hiding empty groups. |
| Context create action | `components/shell/SidebarCreateAction.vue` | Shared transparent or subtle-outline `NuxtLink` for capability-filtered contextual creation routes; keeps the action region above context navigation and avoids nested buttons. |
| Project navigation | Shell contextual navigation | Six project sections; old ProjectWorkspaceNav removed, local view controls remain |
| System-wide header context policy | `layouts/default.vue`, `composables/useShellNavigation.ts`, `components/shared/PageHeader.vue` | The shared layout has no breadcrumb component, row, reserved spacing or conditional exception. Section roots retain title/actions without generic subtitles. Detail/create/edit pages own their required back navigation, including filters/hash and distinct workflow returns. No invisible breadcrumb state may hide those links. Preserve meaningful scope/data. This supersedes earlier breadcrumb rules under the final 2026-09-08 decision in DESIGN.md. |
| Settings navigation | `components/settings/SettingsLayout.vue` | Preserve actual routes and permissions; avoid duplicated context menus |
| Shell motion | `layouts/default.vue`, `components/shell/ContextSidebar.vue`, `assets/css/approved-shell.css` | Persistent shell frame; pathname changes animate page content, query-only navigation preserves mounted state, context motion is limited to module/project changes, and reduced-motion preferences disable shell animation. |
| Notification preview formatting | `utils/notificationPresentation.ts`, `components/notifications/NotificationCenter.vue` | Shared formatting for the latest-five notification popover; the full notification workflow remains the `/notifications` internal page. |
| Page container | `components/shared/PageContainer.vue` | Nuxt name `SharedPageContainer`; width list/detail/form; use once at owning level |
| Page header | `components/shared/PageHeader.vue` | `SharedPageHeader`; title, description, backTo/backLabel, actions slots; coordinates with usePageHeader |
| Form section | `components/shared/FormSection.vue` | `SharedFormSection`; semantic muted heading strip (`nasq-form-section-heading`) for title/description + content. Callers own field grouping and spacing. |
| Filters | `components/shared/FilterCard.vue`, `components/shared/FilterBar.vue` | One collapsible card throughout list pages. FilterCard owns header, active count, clear action and visible active summary; FilterBar adapts search/default/view/actions/active slots. Fields and actual filter state remain owned by each module. Collapse preserves mounted fields and query state; view/actions remain visible. |
| Loading/error/empty | `components/shared/PageState.vue`, `EmptyState.vue` | `SharedPageState` / `SharedEmptyState`; retry and meaningful empty action |
| Unsaved form exit | `components/shared/UnsavedChanges.vue` | Approved shared confirmation; `dirty` guards leaving, optional `guardRouteUpdates` also guards same-route form mode/record changes (charter). |
| Project document | `components/project/ProjectCharterDisplay.vue` | Semantic read view of the existing charter draft; ProjectCharterForm owns create/edit and persisted read data. |
| Project archival | `components/project/ProjectArchiveAction.vue` | Record-managed inline archive/restore inside project settings; project headers own contextual primary actions. |
| Record number | `components/shared/RecordNumber.vue` | First record-table column, common `app.recordNumber` label. `value` accepts the existing business reference or stable record id; isolated LTR display and an em dash for missing values. Never use row position as identity. |
| Buttons/fields/tables/menus | `components/ui/**` | Existing shadcn-vue/Reka primitives with local RTL/hydration patches |
| Specialized PMO views | `components/project/**`, `components/task/**` | Reuse task/schedule/RACI data; do not clone shared chrome |
| Shared chart renderer | `components/shared/DashboardChart.client.vue` | Typed `chart`, `accessibleLabel`, optional `height`; Unovis SVG rendering using the shared shadcn-vue chart primitives. Latest approved 2026-09-08 design follows default shadcn/ui pie, legend and donut-with-text examples, adapted to Vue/Unovis with plain chart surfaces and no decorative effects. Uses six chart tokens derived by brandTheme from the institution primary color configured in Settings, entrance/data transitions and subtle hover with live reduced-motion support. Preserves appearance/font, labeled categories, unknown values and internal scrolling for all project rows; global brand/status colors stay independent. |
| Chart primitives | `components/ui/chart/**` | Adapted official shadcn-vue chart registry: shared container, legend and tooltip presentation for Unovis; use Nasq tokens and escaped Vue content. |
| Project chart dashboard | `components/project/dashboard/**` | Quiet metric strip, chart panels and latest-five projects; replaces the old number-only dashboard summary and long report table on `/projects/dashboard`. |

Paths starting `components/` and `composables/` are relative to `apps/web/app/`.
Inspect actual props before use. This catalog does not rename or regenerate any component.

Panel sections use `nasq-panel-header` for a wrapping muted header, then `nasq-panel-body` for content. `CardHeader` shares the same quiet header treatment. Repeated task/meeting items keep metadata and actions together; calendars and tables scroll inside their data region.

## Style ownership

| Source | Responsibility |
| --- | --- |
| `apps/web/app/assets/css/main.css` | Fonts, semantic tokens, modes, shared page/form surfaces; imports shell styles |
| `apps/web/app/assets/css/approved-shell.css` | Existing shell and shared presentation rules; consolidate overlaps during layout migration |
| `apps/web/app/utils/brandTheme.ts` | Validated primary-colour derivation and readable foregrounds |
| `apps/web/app/composables/useAppearance.ts` | Existing personal appearance preferences |

Use semantic utilities such as `bg-background`, `text-foreground`, `border-border` and existing `nasq-*` surface recipes where appropriate. An existing class is not permission to preserve obsolete layout behavior.
Do not copy hex values, anonymous CSS bundles, raw reference HTML or a second shadcn component tree into pages.
Supported appearance settings are user features, not redundant theme definitions.

## Adding or retiring a component

Search imports, templates/Nuxt auto-import names, configuration and tests.
Prefer extending an existing shared API. If new shared behavior is needed, give it one owner, document props/slots and reuse it in the target pages.
A removed component needs a replacement and zero remaining consumers (including generated config and tests). Record the evidence in the migration report.
The HTML guides are visual references, never import sources for the runtime.
