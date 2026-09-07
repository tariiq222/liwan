# Task 2 — HR snapshot reconciliation

Status: DONE_WITH_CONCERNS

## Changed paths

- `apps/web/app/components/hr/DepartmentTable.vue`
  - Ported the responsive row/card presentation and optional `canDelete` guard from `codex/impeccable-fixes`.
  - Preserved current HR capability checks, internal edit route, inline delete event, hydration guard, and empty state.
- `apps/web/app/components/hr/DepartmentTree.vue`
  - Ported the responsive hierarchy rows from `codex/hr-department-tree-design`.
  - Retained current `DepartmentTreeNode` inputs and routed employee/document links; added wrapped names, depth guides, action grouping, search expansion, and RTL chevron handling.
- `apps/web/app/components/hr/DirectoryTable.vue`
  - Retained the current route-driven query, department scoping, committed-search pagination, and hydration behavior.
  - Ported the source snapshot’s compact responsive control sizing.
- `apps/web/app/components/hr/DocumentList.vue`
  - Retained the current FilterBar and routed document links.
  - Ported committed/debounced search parameters, stale-pagination blocking while a search is pending, and horizontal overflow handling.
- `apps/web/app/pages/hr/departments/index.vue`
  - Added the existing org-chart component as a third `view=canvas` route state.
  - Kept the current FilterBar/chrome, list/tree routes, capability checks, delete confirmation, and return navigation.
- `apps/web/app/pages/hr/documents/index.vue`
  - Added committed/debounced search parameters and stale-pagination blocking.
  - Preserved the current FilterBar, Select, page state, direct links, and filter query shape.

## Source dispositions

### `codex/impeccable-fixes`

- `DepartmentTable.vue`: ported responsive table replacement and `canDelete`; current route and capability behavior retained.
- `DocumentList.vue`: ported request scoping/invalidation-facing search behavior; current component chrome retained.
- `EmployeeGeneralForm.vue`: retained the already-present newer implementation with remote manager search, selected-manager preservation, retry handling, and responsive form fields.
- `pages/hr/documents/index.vue`: ported debounced committed-search behavior onto the current routed page; current FilterBar/Select structure retained.
- `pages/hr/documents/new.vue`: retained current routed page and shadcn Select implementation; older native-select/page layout superseded.
- `pages/hr/index.vue`: retained current directory page and route architecture; older source tab layout superseded.
- Shared CSS and non-HR conflict files were outside this package and untouched.

### `codex/impeccable-hr`

- `DirectoryTable.vue`: retained current route-query department scoping and committed offset behavior; compact source control sizing ported.
- `DocumentList.vue`: request-scoping changes ported; current FilterBar and page chrome retained.
- `EmployeeGeneralForm.vue`: retained; current file already equals the repaired source behavior.
- `DocumentEditor.vue`: retained; current file already equals the repaired debounced body/editor behavior.
- `useHrDocuments.ts`, `useHrEmployees.ts`, `useHrSearch.ts`: retained; current files already contain the source query keys, list invalidation, manager-option preservation, and committed-search helpers.
- HR pages and forms not requiring a source repair remain on the current routed architecture. The source’s older page wrappers/native controls were superseded.

### `codex/hr-department-tree-design`

- `DepartmentTree.vue`: ported responsive tree surface and action grouping.
- `DepartmentOrgChart.vue`, `departmentOrgChart.ts`, and their focused tests: retained unchanged; they were already present and matched the source snapshot.
- `pages/hr/departments/index.vue`: ported the missing chart route/view entry onto the current FilterBar.
- HR locale chart strings were already present in the candidate and retained. The source-only directory title change to “People/الأشخاص” was superseded by the current HR directory wording.

All other owned HR files were inspected and retained from the candidate because their current routed/chrome implementation was newer or already included the source repair.

## Regression cause and fix

The initial candidate kept `DepartmentOrgChart.vue`, its layout utility, and tests, but `pages/hr/departments/index.vue` did not expose the `view=canvas` state. It also kept the older tree row presentation even though the source tree tests required the responsive hierarchy surface. The page now mounts `DepartmentOrgChart` for `view=canvas`, and the tree now uses the source responsive implementation.

The department document list and the top-level document list were issuing requests from draft search text. Both now query committed route parameters, debounce route updates, and disable pagination while search is pending.

## Focused evidence

- `npm -w apps/web exec -- nuxt prepare`: passed; Nuxt generated types. It emitted existing duplicate auto-import warnings for unrelated project utilities.
- `npm -w apps/web test -- --run app/components/hr/__tests__ app/composables/__tests__/hrAdmin.test.ts app/composables/__tests__/hrAccess.test.ts app/composables/__tests__/hrKeys.test.ts app/lib/__tests__/departmentTree.test.ts app/lib/__tests__/departmentOrgChart.test.ts app/lib/__tests__/documentListCache.test.ts`: passed, 11 test files / 44 tests.
- `git diff --check`: passed.
- No build, lint, full suite, Odoo test, runtime, database, or Git mutation was performed.

## Shared-file requests

None. The coordinator-owned shared files were not modified.

## Residual risk

This package has focused unit/source checks only. The coordinator must run the broader web gates and inspect integration with the final shell/CSS. The chart implementation’s runtime sizing, pointer interactions, and fullscreen behavior remain covered by source-level contracts and require the coordinator’s broader UI verification.
## Remaining owned HR surface disposition

The following owned files were compared against the candidate/source snapshots and retained unchanged because they already use the current internal-page architecture and contracts:

- Components: `AccessBadge.vue`, `DepartmentForm.vue`, `DocumentCreateForm.vue`, `DocumentReader.vue`, `EmployeeAccessPanel.vue`, `EmployeeCard.vue`, `EmployeeCreateForm.vue`.
- Department routes: `pages/hr/departments/[departmentId].vue`, `[departmentId]/edit.vue`, `new.vue`.
- Document routes: `pages/hr/departments/[departmentId]/documents/[documentId].vue`, `[documentId]/edit.vue`, `new.vue`.
- Employee routes: `pages/hr/employees/[employeeId].vue`, `access.vue`, `edit.vue`, and `new.vue`.
- HR data and access support: `composables/hrAccess.ts`, `useHrDepartments.ts`, `useHrDocuments.ts`, `useHrEmployees.ts`, `useHrSearch.ts`, and their HR key/access/admin tests.
- HR tree/chart support: `lib/departmentTree.ts`, `lib/departmentOrgChart.ts`, `lib/__tests__/departmentTree.test.ts`, `lib/__tests__/departmentOrgChart.test.ts`, `components/hr/__tests__/department-tree.test.ts`, and `components/hr/__tests__/department-org-chart.test.ts`.
- HR locale files: retained candidate strings, including the existing chart controls and the current directory title.

## Follow-up reconciliation evidence

The follow-up review found that the working `EmployeeGeneralForm.vue` still rendered only the first-page `employees` prop, despite the manager query helpers already being present in `useHrEmployees.ts`. The form now uses the remote manager search query, selected-manager detail query, `hrManagerOptions`, and retry handling. Its consumer regression test verifies that an edit whose selected manager is outside the first page still exposes that manager in the Select options.

The documents page had two route-commit regressions: returning to page one spread the previous `offset`, and changing department briefly queried with the local draft department while the route still held the old committed department. The page now derives request params entirely from `route.query` like `DirectoryTable`, and explicitly writes `offset: undefined` on page one.

Before the fixes, the new consumer checks failed as expected: the employee form exposed no `managerOptions`; the documents checks received `offset: "25"` instead of `undefined` and department `3` instead of committed department `2`. After the fixes, the focused consumer suite passed 2 files / 3 tests. The broader HR-focused suite passed 13 files / 47 tests.

Exact follow-up changed files in the reconcile worktree:

- `apps/web/app/components/hr/EmployeeGeneralForm.vue`
- `apps/web/app/pages/hr/documents/index.vue`
- `apps/web/app/components/hr/__tests__/employee-general-form.test.ts`
- `apps/web/app/pages/hr/__tests__/documents-index-behavior.test.ts`

Follow-up verification: `npm -w apps/web test -- --run app/components/hr/__tests__ app/pages/hr/__tests__ app/composables/__tests__/hrAdmin.test.ts app/composables/__tests__/hrAccess.test.ts app/composables/__tests__/hrKeys.test.ts app/lib/__tests__/departmentTree.test.ts app/lib/__tests__/departmentOrgChart.test.ts app/lib/__tests__/documentListCache.test.ts` passed 13 test files / 47 tests. No Git mutation or broad web gate was run.
