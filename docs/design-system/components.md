# Shared component catalog

Authority: [DESIGN.md](../../DESIGN.md). This catalog records current reusable code and pending migration; names in the approved HTML reference are not Vue APIs.

## Nuxt UI

السلطة: [DESIGN.md](../../DESIGN.md). اقرأ [المرجع](nuxt-ui-reference.md) للإصدارات والفحص.
Nuxt UI مرحّل في `apps/web`. `design-preview` معاينة معزولة. لا مكتبة ثانية ولا تغليف لكل زر.
سجّل كل مكوّن مركّب هنا بمساره ومسؤوليته. الألوان والخطوط من الثيم المشترك.

`components/ui` definitions are retained for recovery but excluded from runtime
auto-discovery. Only the explicit Unovis chart adapters remain in use.
Customer controls use Nuxt UI; vue-sonner is not an active notification renderer. Reka, TanStack, Unovis and Tiptap are
not blanket-banned dependencies. Run `python3 -B tools/ui_policy.py` and
review actual screenshots. The checker also runs at the start of `npm test`;
it is not an update hook, CI or a visual-compliance guarantee.

## Executable reference owners

The following are isolated page recipes, not additional primitive libraries.
Every component uses the same `apps/web/design-preview/app/assets/theme.css`
tokens and `app.config.ts` variants. All records and saves are synthetic and
reset on reload. These pages never call Odoo. Port recipes only as part of an
explicit customer-page migration; do not import fixture data into production.

| Exact path | Responsibility / reused primitives |
| --- | --- |
| `apps/web/design-preview/app/components/PreviewShell.vue` | Shared module rail, contextual navigation and preview preferences; UButton, UTooltip, USelect, UInput, UFormField |
| `apps/web/design-preview/app/components/PreviewMobileNavigation.vue` | Mobile hamburger and modal navigation via USlideover/UButton; shares module/view icon maps, closes after successful routing or desktop resize, preserves draft guards; desktop navigation stays unchanged |
| `apps/web/design-preview/app/components/PreviewPage.vue` | One page heading, actions and list/detail/form width; semantic layout only |
| `apps/web/design-preview/app/components/PreviewList.vue` | Reused by all four module examples; desktop UTable and mobile record cards share URL-filtered data, UBadge and PreviewProgress; no embedded filter card |
| `apps/web/design-preview/app/components/PreviewFilters.vue` | Header icon trigger and bounded filter popover; UPopover/UInput/USelect, active count/summary, red icon-only clear; query remains in the URL |
| `apps/web/design-preview/app/components/PreviewDateField.vue` | Shared ISO date selection for record forms and gallery; UPopover/UCalendar/UButton, localized label, explicit clear and disabled state |
| `apps/web/design-preview/app/components/PreviewProgress.vue` | Shared determinate completion bar; UProgress with bounded value and visible-fill gradient from exact secondary to primary, mirrored in RTL |
| `apps/web/design-preview/app/components/PreviewRecordDetail.vue` | Detail recipe used standalone and in sheets; UCard, UBadge, PreviewProgress |
| `apps/web/design-preview/app/components/PreviewRecordForm.vue` | One create/edit recipe for sheets and full pages; UForm/UFormField, UInput/UTextarea/USelect/UInputNumber/UCheckbox, PreviewDateField, UAlert/UButton |
| `apps/web/design-preview/app/components/PreviewUnsavedChanges.vue` | Shared cancel-then-navigate guard, browser unload protection and focus restoration; UModal and UButton; preserves existing guard semantics |
| `apps/web/design-preview/app/components/PreviewSettings.vue` | Settings sections and local draft/save; UCard, UForm/UFormField/UInput, USwitch and shared unsaved guard |
| `apps/web/design-preview/app/components/PreviewComponents.vue` | Interactive component/state gallery; approved buttons, badges, fields and alerts only |
| `apps/web/design-preview/app/components/PreviewState.vue` | Common loading/error/empty recipe; USkeleton, UAlert, UButton and live announcements |
| `apps/web/design-preview/app/components/PreviewChart.client.vue` | Dashboard donut via existing Unovis; shared brand chart tokens and readable counts, no new chart library |

`apps/web/design-preview/app/app.vue` owns UApp and the initial hydration gate
using the existing `useHydrated`; its native fieldset prevents lost first clicks.
`usePreview` stores separately named preview cookies and in-memory fixtures.
Brand derivation and appearance normalization reuse existing pure Nasq utilities.
`@iconify-json/lucide@1.2.129` provides locally bundled icons; no remote icon/font
provider is used. Fonts/color-mode modules are disabled, not another source of state.

## Existing owners (runtime inventory, not a second design authority)

| Responsibility | Current source | Usage |
| --- | --- | --- |
| App shell | `apps/web/app/layouts/default.vue` | Header + module rail + contextual sidebar. No layout breadcrumb. Desktop rail and sidebar collapse independently. Mobile <768 uses hamburger navigation. Project section tabs live in the project workspace page, not in the sidebar. Nested pages own their H1 without repeating project identity. |
| Global search | `components/GlobalSearch.vue` | Shared centered dialog; compact search header, capability-filtered quick navigation, grouped query results and internal scrolling. Shared dialog layers sit above the app header. |
| Primary navigation | `apps/web/app/components/shell/ModuleRail.vue`, `components/shell/ContextSidebar.vue`, `components/shell/MobileNavigation.vue`, `composables/useNav.ts`, `composables/useShellNavigation.ts` | Rail order (2026-09-11) is الرئيسية (`/projects/dashboard`), المشاريع (`/projects`; also active for tasks, templates, reports and search), الاجتماعات, المحادثات, المؤسسة, with settings and vendor utilities anchored below. `home` and `projects` share one «المشاريع» sidebar: نظرة عامة → كل المشاريع → مهامي → قوالب المشاريع, plus the pinned «مشروع جديد»; it stays the same inside a project. Meetings: list → calendar → recurring series. Settings is one flat list: حسابي → المظهر → المستخدمون → الأدوار والصلاحيات → سجل الوصول → هوية الجهة → إعدادات المشاريع. Both sidebar components derive their groups from `shellContextGroups()`; capability gates, the sidebar breadcrumb and create actions are unchanged. |
| Context create action | `components/shell/SidebarCreateAction.vue` | Shared primary solid `UButton` for capability-filtered contextual creation routes; keeps the action region above context navigation and avoids nested buttons. |
| Project navigation | `components/project/workspace/ProjectWorkspaceTabs.vue`, `pages/projects/[id].vue`, `projectWorkspaceGroups()` in `composables/useNav.ts` | In-page project navigation (2026-09-11): the workspace frame in `[id].vue` renders the project title row (name, status badge, manager, square settings icon button gated by `can_manage`) and two `UButton` `soft`/`ghost` tab rows on section roots only, never inside the side sheet or on full-page detail/create/edit routes. Groups: الملخص · التنفيذ (المهام · الجدول الزمني · المعالم) · الحوكمة (ملف المشروع · أصحاب المصلحة · المسؤوليات RACI · المخاطر والمشكلات) · المالية · التحديثات. A group opens its first visible sub-section; archived projects and `pmo.tasks.read` hide the same sections as before; the section page keeps the single H1. The 2026-09-10 rollout still applies the same page composition and record presentation to other modules except Chat. |
| Shared workflow host | `components/project/workspace/ProjectRouteHost.vue`, `ProjectRouteModal.vue`, `utils/workspacePresentation.ts` | One route-backed workflow over a retained background, full-height Side Sheet below the header and beside the main module rail. The overlay frame still follows the rail; the panel docks to the opposite edge (inline-end) and enters from that edge. The approved background uses 20% dimming and 2px blur. Motion respects reduced motion. Frame geometry follows rendered direction and coalesces locale/direction, resize and scroll measurements. Direct URLs load the real background; close, refresh, nested return filters, standalone display and draft guards remain supported. Chat and meeting print routes are excluded. |
| System-wide header context policy | `layouts/default.vue`, `composables/useShellNavigation.ts`, `components/shared/PageHeader.vue` | No layout breadcrumb. Section roots: title/actions only. Detail/create/edit pages own back links and keep filters/hash. |
| Settings navigation | `components/settings/SettingsLayout.vue` | Preserve actual routes and permissions; avoid duplicated context menus |
| Shell motion | `layouts/default.vue`, `components/shell/ContextSidebar.vue`, `assets/css/approved-shell.css` | Persistent shell frame; pathname changes animate page content, query-only navigation preserves mounted state, context motion is limited to module/project changes, and reduced-motion preferences disable shell animation. |
| Notification preview formatting | `utils/notificationPresentation.ts`, `components/notifications/NotificationCenter.vue` | Shared formatting for the latest-five notification popover; the full notification workflow remains the `/notifications` internal page. |
| Page container | `components/shared/PageContainer.vue` | Nuxt name `SharedPageContainer`; width list/detail/form; use once at owning level |
| Page header | `components/shared/PageHeader.vue` | `SharedPageHeader`; title, description, backTo/backLabel, actions slots; coordinates with usePageHeader |
| Form section | `components/shared/FormSection.vue` | `SharedFormSection`; plain reference heading and content. Optional `panel` uses UCard with its header slot and shared text/spacing tokens. Callers own field grouping and spacing. |
| Filters | `components/shared/FilterCard.vue`, `components/shared/FilterBar.vue` | Visible search in the toolbar, then a neutral-outline filter trigger for extra fields, active count, clear, and view/actions on the far edge. FilterBar supports an inline presentation for project task tools using the same slots. Active summary stays visible when the popover is closed. Fields and query state remain owned by each module. |
| Loading/error/empty | `components/shared/PageState.vue`, `EmptyState.vue` | `SharedPageState` / `SharedEmptyState`; retry and meaningful empty action |
| Unsaved form exit | `components/shared/UnsavedChanges.vue` | Approved shared confirmation; `dirty` guards leaving, optional `guardRouteUpdates` also guards same-route form mode/record changes (charter). |
| Project document | `components/project/ProjectCharterDisplay.vue` | Semantic read view of the existing charter draft; ProjectCharterForm owns create/edit and persisted read data. |
| Project archival | `components/project/ProjectArchiveAction.vue` | Record-managed inline archive/restore inside project settings; project headers own contextual primary actions. |
| Record number | `components/shared/RecordNumber.vue` | First record-table column, common `app.recordNumber` label. `value` accepts the existing business reference or stable record id; isolated LTR display and an em dash for missing values. Never use row position as identity. |
| Buttons/fields/tables/menus | `apps/web/app/app.config.ts` | Real Nuxt UI buttons, fields, cards, tables, menus, calendars and alerts; one shared variant configuration |
| Specialized PMO views | `components/project/**`, `components/task/**` | Reuse task/schedule/RACI data; do not clone shared chrome |
| Shared chart renderer | `components/shared/DashboardChart.client.vue` | Typed `chart`, `accessibleLabel`, optional `height`; Unovis SVG rendering using the four explicit Unovis chart adapters. Chart surfaces, legend and tooltip now inherit the approved Nuxt neutral/text/radius tokens while preserving the existing chart semantics and no decorative effects. Uses six chart tokens derived by brandTheme from the institution primary color configured in Settings, entrance/data transitions and subtle hover with live reduced-motion support. Preserves appearance/font, labeled categories, unknown values and internal scrolling for all project rows; global brand/status colors stay independent. |
| Chart primitives | `components/ui/chart/**` | Adapted official shadcn-vue chart registry: shared container, legend and tooltip presentation for Unovis; use Nasq tokens and escaped Vue content. |
| Project chart dashboard | `components/project/dashboard/**` | Reference UCard metrics, chart panels and latest-five projects; replaces the old number-only dashboard summary and long report table on `/projects/dashboard`. |

Paths starting `components/` and `composables/` are relative to `apps/web/app/`.
Inspect actual props before use. This catalog does not rename or regenerate any component.

Project section roots share `PageContainer width="list"`; child forms use `form`, child details use `detail`. Widths: list/detail/form 100rem/68rem/58rem. Section creation belongs in header actions. Filters: visible search plus icon `UPopover` via FilterBar/FilterCard. TaskToolbar accepts `collapsible`. ScheduleGantt and MilestoneTable accept `embedded` to suppress repeated headers.

Functional card sections use UCard header/body slots; plain sections use semantic headings. Legacy panel/header/body and metric-strip recipes are retired. Repeated task/meeting items keep metadata and actions together; tables scroll inside their data region. The meeting calendar switches to its agenda when its own container is narrower than 600px, so every date remains accessible beside the contextual sidebar. Action columns use the localized `app.actions` header; empty string table headers are avoided because their fallback fragments differ during hydration.

## Style ownership

| Source | Responsibility |
| --- | --- |
| `apps/web/app/assets/css/main.css` | Fonts, semantic tokens, modes, shared page/form surfaces; imports shell styles |
| `apps/web/app/assets/css/approved-shell.css` | Existing shell and shared presentation rules; consolidate overlaps during layout migration |
| `apps/web/app/assets/css/project-theme.css` | Compatibility typography tokens and semantic state tokens only. Broad descendant typography and surface overrides are removed; Nuxt UI owns component presentation in every module. |
| `apps/web/app/utils/brandTheme.ts` | Validated primary and secondary colour derivation and readable foregrounds |
| `apps/web/app/composables/useAppearance.ts` | Existing personal appearance preferences |

Use semantic utilities such as `bg-background`, `text-foreground`, `border-border` and existing `nasq-*` surface recipes where appropriate. An existing class is not permission to preserve obsolete layout behavior.
Do not copy hex values, anonymous CSS bundles, raw reference HTML or a second shadcn component tree into pages.
Supported appearance settings are user features, not redundant theme definitions.

## Adding or retiring a component

Search imports, templates/Nuxt auto-import names, configuration and tests.
Prefer extending an existing shared API. If new shared behavior is needed, give it one owner, document props/slots and reuse it in the target pages.
A removed component needs a replacement and zero remaining consumers (including generated config and tests). Record the evidence in the migration report.
The HTML guides are visual references, never import sources for the runtime.

## Layout, colour and card refinement — 2026-09-11

Shared recipes only; no page-local styles. Owner: `apps/web/app/assets/css/nuxt-theme.css` and `apps/web/app/app.config.ts`.

| Recipe | Responsibility / consumers |
| --- | --- |
| `nasq-ui-tab-strip`, `nasq-ui-tab` | Horizontal group tabs with a brand underline for `aria-current="page"` or `data-active` (groups with children keep aria-current on the deepest subtab); `components/project/workspace/ProjectWorkspaceTabs.vue`. Subtabs use `--brand-link` on `--brand-soft` when current. |
| `nasq-ui-segment` | Segmented view switch (list/board, table/cards); `pages/projects/[id].vue`, `components/task/TaskToolbar.vue`. |
| `nasq-ui-table-head`, table `th`/`td` slots | Muted head band, small quiet header text, default-colour cells; every `UTable`. |
| `nasq-ui-card-header` | Muted header band on every `UCard` header slot. |
| `nasq-ui-record-surface` | One rounded bordered surface around tables, boards and record lists. |
| `nasq-ui-metric-icon` | Neutral icon square for metric tiles; `components/project/dashboard/ProjectDashboardMetrics.vue`, `components/project/finance/FinanceSummaryCards.vue`. |
| `nasq-ui-primary-solid` / `nasq-ui-field` / `nasq-ui-tab` / `nasq-ui-selected` | Shared states: rest, hover, focus-visible, pressed/active, selected, disabled; fields also expose invalid. Live gallery: `apps/web/design-preview/app/components/PreviewComponents.vue`. |
| `nasq-ui-record-surface` | One record surface for lists, tables, boards and form panels. Replace page-local `rounded-xl border border-default` copies. |

`components/shared/FilterCard.vue` renders filter trigger, count and clear first, then the actions/view slot; `FilterBar.vue` pushes the view slot to the end edge (`ms-auto`). `components/task/TaskTable.vue` shows assignees as an initials avatar plus names and uses the soft `USelect` variant for priority. `components/project/ProjectCards.vue` shows record number, name, status, progress with a visible percent, then manager and end date with icons.

## Shared field and shell notes

- `apps/web/app/components/shared/DateField.vue`: shared ISO date selector; UPopover, UCalendar, UButton; keeps calendar dates timezone-independent, with optional ISO minValue/maxValue bounds.
- `apps/web/app/app.config.ts` and `apps/web/app/assets/css/nuxt-theme.css`: runtime U component recipes and tokens, using existing useAppearance and company brand state.

- `apps/web/app/components/shell/MobileNavigation.vue`: mobile hamburger and capability-filtered module/context navigation; USlideover, UButton, USeparator, SidebarCreateAction; closes after successful routing.

### Reference detail composition (2026-09-10 correction)

- `apps/web/app/components/project/ProjectOverview.vue`: actual `summary` tab; UCard metric and update/milestone sections, UProgress, ProjectStatusSelect and ProjectOverviewTasks. Named container queries adapt metric columns to available content width. Preserves server counts, capabilities, dates and return links.
- `apps/web/app/components/project/ProjectOverviewTasks.vue`: bounded attention preview; UCard, UAlert, UBadge, USkeleton and existing task routes.
- `apps/web/app/components/task/TaskDetailPanel.vue`: route-independent task actions and detail composition; UButton, StateMenu and TaskDetails.
- `apps/web/app/components/task/TaskDetails.vue`: UTabs for details, description, activity, resources and additional fields; shared selectors/date fields. No stacked cards or nested legacy panel frame.
- `apps/web/app/components/task/TaskDescription.vue`: plain description section with the existing rich-text editor and draft protection.
- `apps/web/app/components/task/TaskActivity.vue`: activity tab content with existing timeline and comment composer.
- `apps/web/app/components/task/TaskDeliverables.vue`, `DependencyPicker.vue`, `TaskAttachments.vue`: optional resource sections use the same plain section headings; preserve existing checkbox, dependency and file actions.
- `data-nasq-reference-detail`: shared migration boundary for these detail compositions; reference 68rem width and 1.75rem page gap. Broad workspace typography overrides are removed. Nuxt neutral colors inherit the reference Zinc defaults with explicit reference cream tokens; compatibility aliases resolve to these same values.


## Complete module unification (2026-09-10, current worktree)

`tools/ui_inventory.py --check` enumerates every customer Vue source and rejects
legacy controls/imports/panel/navigation recipes; `npm test` includes this gate.
`apps/web/nuxt.config.ts` excludes `components/ui/**` from auto-discovery. The four
Unovis adapters are explicit specialist imports. This is source enforcement, not a
claim of visual or behavior verification. See `docs/verification/2026-09-10-all-ui-unification.md`.

| Exact path | Responsibility / primitives |
| --- | --- |
| `apps/web/app/components/shared/FormSection.vue` | Reference section composition, plain heading or UCard header/body; no legacy grey strip |
| `apps/web/app/components/shared/PageHeader.vue` | Shared title/actions/back link with Nuxt text scale and UButton |
| `apps/web/app/components/shared/PageState.vue` | Loading USkeleton, retryable UAlert/UButton, meaningful empty state |
| `apps/web/app/components/settings/AppearanceForm.vue` | URadioGroup card recipes backed by the existing appearance cookie and setters |
| `apps/web/app/components/settings/SettingsLayout.vue` | Settings geometry only; primitive surface, field and table styling belongs to Nuxt |
| `apps/web/app/components/GlobalSearch.vue` | UModal, UInput, UButton and UBadge with capability-filtered real navigation/results |
| `apps/web/app/components/ui/chart/ChartContainer.vue` | Explicit Unovis context/container using shared neutral/brand tokens |
| `apps/web/app/components/ui/chart/ChartStyle.vue` | Escaped per-chart color variables; no independent palette |
| `apps/web/app/components/ui/chart/ChartLegendContent.vue` | Unovis series legend using shared typography/tokens |
| `apps/web/app/components/ui/chart/ChartTooltipContent.vue` | Escaped tooltip values with shared surface/radius/ring tokens |
| `apps/web/app/app.vue` | UApp owns locale and the sole toast renderer |
| `apps/web/app/assets/css/nuxt-theme.css` | Shared Nuxt recipes and appearance tokens |
| `apps/web/app/assets/css/main.css` | Fonts and compatibility aliases into Nuxt neutral/status tokens; no competing control sizing/focus/radius recipes |
| `apps/web/app/assets/css/project-theme.css` | Compatibility aliases for specialist chart/layout typography only |

Every business component's exact path, owner and review classification is recorded
in the full source manifest produced by the inventory; module-specific behavior
remains owned by its existing component and composable.

The chat list search, icon actions, filters, composer and reactions use UInput, UButton, UTextarea and UBadge. Chat-specific CSS owns conversation/thread/bubble geometry only; it must not override shared control appearance. Visible upload fields use SharedFileField; the chat composer retains its hidden native file input behind a UButton.

| Exact shared component | Responsibility and reused primitives |
| --- | --- |
| `apps/web/app/components/shared/FileField.vue` | Localized file picker, UButton plus hidden native file input, useFormField associations; preserves original upload change Event |

Nuxt primary text/focus colors use the contrast-adjusted `--brand-link`, as in the reference. Solid actions retain the configured institution colors and readable foregrounds. Shared secondary outline/ghost/link recipes use `--brand-link` on the current surface.

Meeting detail tabs keep Nuxt UI keyboard/tabpanel behavior and use readable nonshrinking labels in a horizontal scroll list at narrow widths. Milestone rows stack metadata above actions until their own container has sufficient width.

Semantic primary utilities resolve to `--ui-primary` / contrast-safe `--brand-link`; branded solid button recipes use `--primary-fill` and its contrasting foreground. Non-solid primary and secondary action recipes use readable text and ring tones across appearance modes. Active meeting tabs scroll only their local tab list, including direct links and locale changes.
