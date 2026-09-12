> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Nasq Internal Pages Design

> تاريخي. السياسة: [DESIGN.md](../../../../../DESIGN.md). ليس تعليمات واجهة.

## Purpose

Nasq renders every business screen as an addressable page inside the normal application layout. Business detail, create, edit, settings, search, and destructive confirmation flows must support browser back, reload, and direct links without opening a modal layer.

Simple value pickers may continue to use select, dropdown, date, and combobox popovers. Toasts may continue to report mutation results. Generated UI primitives may remain in the repository, but product code may not mount `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, or `CommandDialog` for a business workflow.

## Route contract

| Area | Route | Screen and authorization |
| --- | --- | --- |
| Shared | `/search` | Authenticated navigation and project search page; `Meta+K` and `Ctrl+K` navigate here and focus search. |
| HR | `/hr` | Employee directory with URL-preserved directory filters. |
| HR | `/hr/employees/new` | Admin-only employee creation form. |
| HR | `/hr/employees/:employeeId` | Employee card/detail page for users allowed by the existing employee endpoint. |
| HR | `/hr/employees/:employeeId/edit` | Admin-only general employee editor with explicit save and archive/restore confirmation inline. |
| HR | `/hr/employees/:employeeId/access` | Admin-only access role, grant/reset-password, and revoke controls, with password and revoke confirmations inline. Vendor-linked account guards remain enforced. |
| HR | `/hr/departments` | Department list for every role already permitted to read it; mutation links and safe inline deletion confirmation remain admin-only. |
| HR | `/hr/departments/new` | Admin-only department create form. |
| HR | `/hr/departments/:departmentId` | Department detail and document list for current permitted readers. |
| HR | `/hr/departments/:departmentId/edit` | Admin-only department editor. |
| HR | `/hr/departments/:departmentId/documents/new` | Admin/vendor document creation page, subject to the existing API policy. |
| HR | `/hr/departments/:departmentId/documents/:documentId` | Read-only document reader page with attachments. |
| HR | `/hr/departments/:departmentId/documents/:documentId/edit` | Admin/vendor document editor with explicit title/body saves and attachment upload. |
| PMO | `/projects/new` | Project creation page shown only when `can_create` is true. |
| PMO | `/projects/:id/settings` | Manager settings page containing general, stages, and followers sections. Existing `can_manage` and server checks remain authoritative. |
| PMO | `/projects/:id/milestones/new` | Project milestone creation page for managers. |
| PMO | `/projects/:id/milestones/:milestoneId/edit` | Project milestone editor with inline delete confirmation and task-count guard feedback. |
| PMO | `/projects/:id/updates/new` | Project update creation page for managers. |
| Tasks | `/tasks/new` | Task creation page with the existing project selector behavior. |
| Tasks | `/projects/:id/tasks/new` | Project-scoped task creation page. |
| Tasks | `/tasks/:id` | Existing task detail page, with archive confirmation rendered inline. |
| Tasks | `/projects/:id/tasks/:taskId` | Existing project-scoped task detail page, with archive confirmation rendered inline. |

Nuxt parent files `hr.vue`, `tasks.vue`, and `projects/[id].vue` render their existing screen only at their exact base route. On any child route they render only `<NuxtPage />`; no list or project screen may remain mounted behind a child page.

## Safe return behavior

Every page entered from a filtered list carries `returnTo=<encoded fullPath>`. The shared `safeReturnTo(value, fallback, allowedPrefixes)` helper accepts only a single absolute application path beginning with `/`, rejects `//`, URL schemes, backslashes, control characters, and any path outside an allowed owner prefix, and preserves an accepted query string. Direct links without a valid `returnTo` use a deterministic fallback:

- employee and department screens return to `/hr` or `/hr/departments`;
- document screens return to their owning department;
- project administration screens return to `/projects/:id` with the relevant `tab` query;
- task creation returns to `/tasks` or its owning project;
- task detail keeps the existing list/project query behavior.

Successful create flows navigate to the created resource. Cancel and page back controls navigate to the safe return target. Browser back remains native and deep-link reloads render loading, missing-id, forbidden, and API-error states in the page body.

## Conversion inventory

The implementation removes business overlay use from:

- `pages/hr.vue`: employee card sheet, employee management dialog, employee creation dialog, department sheet;
- `components/hr/DeptPanel.vue`: department create/edit dialog and delete dialog;
- `components/hr/DocumentList.vue`: document reader/editor sheet and create dialog;
- `components/hr/EmployeeAccessPanel.vue`: password and revoke dialogs;
- `components/project/CreateProjectDialog.vue`, `ProjectSettingsDialog.vue`, `MilestoneDialog.vue`, `ProjectUpdateDialog.vue`;
- `components/project/ProjectMenu.vue`: project archive dialog;
- `components/project/MilestoneTable.vue`: milestone delete dialog;
- `components/task/CreateTaskDialog.vue`, the active `TaskDetailPanel.vue` archive dialog, and the `DescriptionEditor.vue` native link prompt;
- `components/hr/DocumentEditor.vue`: native link prompt;
- `components/CommandMenu.vue`: command dialog;
- `components/ui/sidebar/Sidebar.vue`: mobile navigation sheet.

No native `window.confirm`, custom business `Teleport`, or other mounted business drawer was found in the baseline. Native `window.prompt` link editors were found in the HR document and task description editors and must become inline URL controls. `TaskDetailPanel.vue` is active page content through `TaskDetailPage.vue`; its body remains and only its confirmation layer changes.

## Interaction and layout rules

- Every page has a translated heading, a visible return control, and the standard authenticated layout.
- Destructive actions first reveal an inline region naming the consequence and exposing explicit confirm and cancel actions. Pending state disables both mutation re-entry and hydration-racy controls.
- Mobile navigation is an inline collapsible region in document flow. It has no backdrop, focus trap, portal, or dismissable layer.
- `/search` uses the existing navigation/project sources and keyboard shortcuts. A keyboard shortcut changes the URL to `/search`; it does not toggle global overlay state.
- Existing Arabic/English messages, RTL logical classes, SSR hydration guards, cache replacement, toasts, and authorization checks remain intact.
- Existing account, branding, select, dropdown, calendar, tag, assignee, milestone-selector, and follower-search popovers remain controls rather than standalone business screens.

## Architecture enforcement

A Vitest architecture test recursively scans application pages, layouts, and non-`ui` components. It fails when those files import or mount `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, or `CommandDialog`, or call native `alert`/`confirm`/`prompt`. Generated primitives are deliberately excluded except the actively mounted composite `app/components/ui/sidebar/Sidebar.vue`, which is scanned to prevent mobile navigation from returning to a sheet. Test fixtures and sanitizer strings are excluded because they do not mount product UI.

## Acceptance evidence

- Unit tests cover safe return validation and the architecture scan.
- E2E preserves the existing HR document/access/admin assertions and PMO/task assertions through routed pages.
- E2E adds direct-link, reload, browser-back/filter preservation, keyboard search navigation, mobile inline navigation, and zero business-dialog/sheet proof.
- Fresh web typecheck/lint, unit, Playwright, and production build gates pass. Odoo/API tests are not rerun unless a backend file changes.
- The successful production build replaces the local review preview on `localhost:3200`, still backed by the isolated Odoo runtime on `9169`; this is local review evidence only.
