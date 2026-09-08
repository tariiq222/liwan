# Shared component catalog

Authority: [DESIGN.md](../../DESIGN.md). This catalog records current reusable code and pending migration; names in the approved HTML reference are not Vue APIs.

## Existing owners

| Responsibility | Current source | Usage |
| --- | --- | --- |
| App shell | `apps/web/app/layouts/default.vue` | One outer layout |
| Global search | `components/GlobalSearch.vue` | Shared centered dialog; compact search header, capability-filtered quick navigation, grouped query results and internal scrolling. Shared dialog layers sit above the app header. |
| Primary navigation | `apps/web/app/components/AppSidebar.vue`, `composables/useNav.ts` | Module/context ownership migrates through `components/shell/**` and `useShellNavigation.ts`; validation recorded in the migration ledger |
| Project navigation | Shell contextual navigation | Six project sections; old ProjectWorkspaceNav removed, local view controls remain |
| Settings navigation | `components/settings/SettingsLayout.vue` | Preserve actual routes and permissions; avoid duplicated context menus |
| Page container | `components/shared/PageContainer.vue` | Nuxt name `SharedPageContainer`; width list/detail/form; use once at owning level |
| Page header | `components/shared/PageHeader.vue` | `SharedPageHeader`; title, description, backTo/backLabel, actions slots; coordinates with usePageHeader |
| Form section | `components/shared/FormSection.vue` | `SharedFormSection`; title/description + content |
| Filters | `components/shared/FilterBar.vue` | `SharedFilterBar`; search/default (controls)/view/active slots; preserve query state |
| Loading/error/empty | `components/shared/PageState.vue`, `EmptyState.vue` | `SharedPageState` / `SharedEmptyState`; retry and meaningful empty action |
| Unsaved form exit | `components/shared/UnsavedChanges.vue` | Approved shared confirmation; `dirty` guards leaving, optional `guardRouteUpdates` also guards same-route form mode/record changes (charter). |
| Project document | `components/project/ProjectCharterDisplay.vue` | Semantic read view of the existing charter draft; ProjectCharterForm owns create/edit and persisted read data. |
| Project archival | `components/project/ProjectArchiveAction.vue` | Record-managed inline archive/restore inside project settings; project headers own contextual primary actions. |
| Buttons/fields/tables/menus | `components/ui/**` | Existing shadcn-vue/Reka primitives with local RTL/hydration patches |
| Specialized PMO views | `components/project/**`, `components/task/**` | Reuse task/schedule/RACI data; do not clone shared chrome |
| Shared chart renderer | `components/shared/ChartCanvas.client.vue` | `option`, `accessibleLabel`, optional `height`; SVG ECharts with resize, current appearance/font and semantic colors. Load only the required chart types. |
| Project chart dashboard | `components/project/dashboard/**` | Quiet metric strip, chart panels and latest-five projects; replaces the old number-only dashboard summary and long report table on `/projects/dashboard`. |

Paths starting `components/` and `composables/` are relative to `apps/web/app/`.
Inspect actual props before use. This catalog does not rename or regenerate any component.

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
