# Page order, module rail and contextual sidebar — user decision 2026-09-11

**Source:** the user's interactive prototype `nasq-01-project-workspace.html`
(model 1, «مساحة المشروع»: two stable menus + sections inside the page).
**Scope:** navigation order, sidebar structure and how pages react to the
user. **Out of scope (explicit user instruction):** any visual redesign or new
component. Reuse the existing shell components, `UButton` recipes, tokens and
catalogued patterns. Labels may change to match the prototype; looks may not.

This decision supersedes, for the project workspace only, the 2026-09-09 rule
«القائمة الجانبية هي التنقل الأساسي بين أقسام المشروع؛ لا تتكرر أقسامه في
تبويبات أفقية». Everything else in DESIGN.md (tokens, page composition,
side sheet, draft protection, filters in the URL, one H1 per page, RTL,
reduced motion, capability gates) stays in force.

## 1. Module rail (`ModuleRail.vue`, data in `useNav.ts`)

Order, top to bottom. Settings and the vendor console stay in the utility
slot at the bottom, exactly as today.

| # | id | Arabic label | English label | target | active for |
| --- | --- | --- | --- | --- | --- |
| 1 | `home` (new) | الرئيسية | Home | `/projects/dashboard` | `/projects/dashboard` |
| 2 | `projects` | المشاريع | Projects | `/projects` | `/projects`, `/projects/new`, `/projects/:id/**`, `/project-templates/**`, `/tasks`, `/tasks/**`, `/archived-tasks`, `/reports/**`, `/search/**` |
| 3 | `meetings` | الاجتماعات | Meetings | `/meetings` | unchanged |
| 4 | `chat` | المحادثات | Chat | `/chat` | unchanged |
| 5 | `hr` | المؤسسة | Organization | `/hr` | unchanged |
| utility | `settings` | الإعدادات | Settings | `/settings/appearance` | unchanged (+ `/account`) |
| utility | `vendor` | وحدة التحكم | Console | `/odoo` | unchanged |

- `tasks` and `reports` are no longer rail modules. Keep the `ShellModule`
  type members only if something still needs them; `activeShellModule` must
  return `projects` for task, archived-task, report and search routes, and
  `home` for the dashboard.
- `home` is visible when the dashboard is allowed (`pmo.projects.read`).
  `useNav()` keeps one entry per destination; the dashboard entry belongs to
  module `home`, the `/projects` list entry to `projects`. Keyboard shortcuts
  stay unique.
- Icon for home: lucide `House`/`Home`. No new visual treatment.

## 2. Contextual sidebar (`ContextSidebar.vue`, `MobileNavigation.vue`)

The heading, create actions, breadcrumb and link recipes are unchanged. Only
the link data and grouping change. Both components must derive their groups
from **one** shared function in `useNav.ts` (no duplicated group logic).

### 2.1 Projects sidebar — shown for `home` **and** `projects`, including inside a project

Heading: «المشاريع» for both modules (not «الرئيسية», not the project name).
Motion key must be the same for `home` and `projects` so switching between
them does not replay the sidebar transition.

Flat list, no group headings, in this order:

| id | Arabic | English | target | active for |
| --- | --- | --- | --- | --- |
| `project-dashboard` | نظرة عامة | Overview | `/projects/dashboard` | `/projects/dashboard` |
| `projects` | كل المشاريع | All projects | `/projects` (keeps current list filters when already on the list) | `/projects`, `/projects/new`, `/projects/:id/**` |
| `tasks` | مهامي | My tasks | `/tasks` | `/tasks`, `/tasks/**`, `/archived-tasks` |
| `project-templates` | قوالب المشاريع | Project templates | `/project-templates` | `/project-templates/**` |

- Pinned create action «مشروع جديد» keeps its current behavior (hidden on
  `/projects` and `/projects/new`). `new-task` is no longer a sidebar create
  action; the tasks page header already owns creation and the archived link.
- Removed from this sidebar: «مشاريعي» (the list page has its own all/mine
  toggle), «المهام المؤرشفة» (reachable from the tasks page header),
  «إعدادات نظام المشاريع» (lives in Settings), and the whole per-project
  section list (moves into the page, §3).
- The sidebar breadcrumb (`workspaceBreadcrumbs`) stays as today: «المشاريع /
  اسم المشروع / القسم» with real links that keep filters. Do not add a second
  breadcrumb inside the content.
- `useProjectWorkspaceMemory().remember(...)` keeps running while inside a
  project so list → project entry still restores the last section.
- «اختصارات مثبتة» (pinned projects) is **not** implemented: there is no
  pinning data in the product. Recorded as a follow-up.

### 2.2 Meetings sidebar

Order: «اجتماع جديد» (pinned create, unchanged) → الاجتماعات → التقويم →
السلاسل المتكررة (`nav.meetingSeries` relabelled; English «Recurring series»).
«التوصيات» has no standalone page and is not added.

### 2.3 Chat sidebar

Unchanged (conversation list, per DESIGN.md chat exception). Only the rail
label changes to «المحادثات».

### 2.4 Organization sidebar (`hr`)

Order unchanged (create action → employees → departments → documents).
Labels: `nav.employees` → «دليل الموظفين» / «Employee directory»,
`nav.departments` → «الهيكل التنظيمي» / «Organization structure»,
`nav.documents` unchanged. Page H1s stay as they are.

### 2.5 Settings sidebar

Flat list, **no** personal/administration group headings, in this order:
حسابي → المظهر → المستخدمون → الأدوار والصلاحيات → سجل الوصول
(`nav.accessLog` relabelled «سجل الوصول» / «Access log») → هوية الجهة →
إعدادات المشاريع. Capability gates unchanged.
`contextGroupsForModule('settings', …)` returns one `default` group.

## 3. Project workspace — sections inside the page

Route: `/projects/:id/**`. The sidebar no longer changes; the page owns the
project identity and its sections, matching the prototype: project title row
→ group tabs → sub-tabs → section header (H1) → tools → content.

### 3.1 Workspace frame in `pages/projects/[id].vue`

Rendered above `<NuxtPage />` **only** on section roots (the routes
`projectSectionRoot()` recognises plus `/updates`, `/raci`, `/milestones`
tab) and never inside the route-backed side sheet (`isProjectOverlay`) or on
full-page detail/create/edit routes.

1. **Project title row** — project name (not an `<h1>`; the section keeps the
   single H1), status pill/owner line using the existing project status
   recipe already used on the list, and on the end side a square icon
   `UButton` («إعدادات المشروع», `i-lucide-settings`, gated by `can_manage`)
   that navigates to `/projects/:id/settings` with `returnTo`. Markup is
   page-local using existing tokens/classes; no new component.
2. **Group tabs** — reuse `components/project/workspace/ProjectWorkspaceTabs.vue`
   (currently unused). It renders two rows with the same `UButton`
   `soft`/`ghost` recipe it has now:
   - Row 1 (`data-testid="project-workspace-tabs"`): الملخص · التنفيذ ·
     الحوكمة · المالية · التحديثات.
   - Row 2 (`data-testid="project-workspace-subtabs"`), only when the active
     group has sub-sections.
3. Then the section page renders as today (its `SharedPageHeader` remains the
   H1 with the create action).

### 3.2 Tab model (`useNav.ts`, new `projectWorkspaceGroups(...)`)

| group | Arabic | sub-sections (order) | targets |
| --- | --- | --- | --- |
| `overview` | الملخص | — | `/projects/:id?tab=summary` |
| `execution` | التنفيذ | المهام · الجدول الزمني · المعالم | `?tab=tasks` (with remembered task filters) · `/schedule` · `?tab=milestones` |
| `governance` | الحوكمة | ملف المشروع · أصحاب المصلحة · المسؤوليات RACI · المخاطر والمشكلات | `/charter` · `/stakeholders` · `/raci` · `/register` |
| `finance` | المالية | — | `/finance` |
| `updates` | التحديثات | — | `/updates` |

- Clicking a group with sub-sections opens its first visible sub-section.
- Active group/sub-section derive from `projectContextId()` + query; extend
  `projectContextId` so `raci` and `updates` are distinguishable where the
  tabs need it (keep existing return values for existing callers/tests).
- Gates: archived projects hide tasks, schedule, milestones, stakeholders,
  RACI, register and charter exactly as `projectWorkspaceLinks` does today;
  `pmo.tasks.read` gates tasks/schedule/milestones. A group with no visible
  sub-section is hidden. On `/projects/:id/settings` no tab is active.
- `projectWorkspaceLinks`, `projectContextLinks`, `projectSidebarLinks` may
  be reduced or kept as helpers, but the sidebar must not consume the
  per-project list any more. Update tests accordingly.

### 3.3 Task views

- Tasks toolbar view slot keeps «قائمة» and «لوحة» only; «الجدول الزمني» is
  now a sub-tab. Remove the timeline button from the toolbar in
  `[id].vue` and the list/board/gantt nav in `schedule.vue` (the scale group
  stays).
- «المهام» sub-tab keeps the remembered `q/state/closed/view` task context.

## 4. i18n

All new strings go through `$t()` in the owning namespace: `nav.*` in
`common.json` for rail/sidebar labels, `projects.*` for tab group labels.
Add both `ar` and `en`. Replace, do not duplicate, keys whose labels change.

## 5. Tests and docs

- Update unit tests: `useNav.test.ts`, `projectContextNavigation.test.ts`,
  `shellStructure.test.ts` if it inspects sources, page tests that assert
  sidebar groups. Add coverage for rail order, `activeShellModule` mapping,
  projects sidebar order, settings flat order, and the tab model gates.
- Update Playwright specs that assert the old rail/sidebar/tab structure
  (`approved-shell.spec.ts` and any spec using `context-link-*`,
  `project-tab-*`, `module-rail`).
- Catalog rows for «Primary navigation» and «Project navigation» in
  `docs/design-system/components.md` describe the new order.
- DESIGN.md gets a short dated section pointing here.

## 6. Deliberate deviations from the prototype (need the user's eye)

1. Breadcrumb stays in the sidebar (shared mechanism for every module), not
   in the content.
2. Sidebar create actions («مشروع جديد», «اجتماع جديد», HR create) are kept.
3. «اختصارات مثبتة», «التوصيات» and chat filter links are not added (no
   backing feature/page).
4. Extra pages the prototype lacks stay reachable: هوية الجهة, إعدادات
   المشاريع (Settings), المهام المؤرشفة (tasks page), التقارير (`/reports`).
