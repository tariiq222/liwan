# Task 1: web repair snapshot reconciliation

## Scope and source comparison

Target worktree: /Users/tariq/code/nasq/.worktrees/reconcile-web-20260907 at 667c184.

Compared the checkpoint deltas ed613a1^..ed613a1 (codex/impeccable-fixes), fb45079^..fb45079 (codex/impeccable-pmo), and cd048cf^..cd048cf (codex/impeccable-settings) against the consolidation candidate. The PMO and settings checkpoints overlap the fixes checkpoint; the fixes checkpoint was used as the combined source so duplicate hunks were not applied twice. The source repair patch covered 70 owned web paths after excluding HR files and coordinator-reserved shell/project locale files.

## Disposition inventory

The following source paths were retained as already present in the candidate. The three-way patch applied cleanly and produced no local delta, so no duplicate copy was made:

~~~text
apps/web/app/components/access/__tests__/locale-contract.test.ts
apps/web/app/components/project/MilestoneForm.vue
apps/web/app/components/project/ProjectCharterFields.vue
apps/web/app/components/project/ProjectCharterForm.vue
apps/web/app/components/project/ProjectGeneralForm.vue
apps/web/app/components/project/ProjectMetadataRail.vue
apps/web/app/components/project/ProjectTable.vue
apps/web/app/components/project/ProjectUpdateForm.vue
apps/web/app/components/project/ProjectUpdateList.vue
apps/web/app/components/project/StageListEditor.vue
apps/web/app/components/settings/ProjectSettingsForm.vue
apps/web/app/components/settings/__tests__/ProjectSettingsForm.test.ts
apps/web/app/components/task/AssigneePicker.vue
apps/web/app/components/task/DescriptionEditor.vue
apps/web/app/components/task/MilestoneSelect.vue
apps/web/app/components/task/PrioritySelect.vue
apps/web/app/components/task/TagPicker.vue
apps/web/app/components/task/TaskActivity.vue
apps/web/app/components/task/TaskAttachments.vue
apps/web/app/components/task/TaskBoard.vue
apps/web/app/components/task/TaskCreateForm.vue
apps/web/app/components/task/TaskDetailPanel.vue
apps/web/app/components/task/TaskDetails.vue
apps/web/app/components/task/TaskTable.vue
apps/web/app/composables/__tests__/adminSettingsPaths.test.ts
apps/web/app/composables/__tests__/passwordForm.test.ts
apps/web/app/composables/__tests__/searchKeyboard.test.ts
apps/web/app/composables/__tests__/useAdminPaths.test.ts
apps/web/app/composables/__tests__/useArchivedTasks.test.ts
apps/web/app/composables/__tests__/useProjects.test.ts
apps/web/app/composables/adminSettingsPaths.ts
apps/web/app/composables/searchKeyboard.ts
apps/web/app/composables/useAdminAudit.ts
apps/web/app/composables/useArchivedTasks.ts
apps/web/app/composables/useProjects.ts
apps/web/app/lib/__tests__/boardCap.test.ts
apps/web/app/lib/__tests__/pmoRepairContracts.test.ts
apps/web/app/lib/boardCap.ts
apps/web/app/lib/formDirty.ts
apps/web/app/pages/projects/[id].vue
apps/web/app/pages/projects/[id]/charter.vue
apps/web/app/pages/projects/[id]/milestones/[milestoneId]/edit.vue
apps/web/app/pages/projects/[id]/milestones/new.vue
apps/web/app/pages/projects/[id]/settings.vue
apps/web/app/pages/projects/[id]/tasks/new.vue
apps/web/app/pages/projects/[id]/updates/new.vue
apps/web/app/pages/projects/index.vue
apps/web/app/pages/search.vue
apps/web/app/pages/settings/access-log/[eventId].vue
apps/web/app/pages/settings/roles/[roleId]/edit.vue
apps/web/app/pages/settings/roles/__tests__/routes.test.ts
apps/web/app/pages/settings/roles/new.vue
apps/web/app/pages/settings/users/[userId]/access.vue
apps/web/app/pages/settings/users/[userId]/index.vue
apps/web/app/pages/settings/users/[userId]/security.vue
apps/web/app/pages/settings/users/new.vue
apps/web/i18n/locales/ar/access.json
apps/web/i18n/locales/ar/tasks.json
apps/web/i18n/locales/en/access.json
apps/web/i18n/locales/en/tasks.json
~~~

The following paths were reconciled because the candidate had a newer competing hunk or the source repair and candidate both changed the same behavior:

| Path | Disposition and reason |
| --- | --- |
| apps/web/app/components/access/roles/RoleTable.vue | Retained the candidate shadcn table and responsive overflow; ported source locale-aware role labels. |
| apps/web/app/components/access/users/UserAccessForm.vue | Retained candidate capability preview and shared warning token; ported locale-aware source role labels for current and retained capability sources. |
| apps/web/app/components/access/users/UserTable.vue | Retained candidate shadcn table; ported locale-aware role labels. |
| apps/web/app/components/account/PasswordForm.vue | Retained candidate success token; ported source aria-describedby, error ids, and alert roles for all password errors. |
| apps/web/app/components/project/MilestoneTable.vue | Ported source stacked card layout for narrow screens, retained candidate status tokens and retry state, and preserved the hydration guard. Inline deletion and route actions remain intact. |
| apps/web/app/pages/archived-tasks.vue | Retained candidate loading/error/empty state and pagination behavior; resolved only the checkpoint destructuring conflict. The composable’s explicit mine query scope was already present in the candidate. |
| apps/web/app/pages/settings/access-log/index.vue | Retained candidate settings sections; ported shared admin pagination helpers, safe offset parsing, localized role target labels, and query-preserving pagination. |
| apps/web/app/pages/settings/roles/[roleId]/index.vue | Retained candidate tabs, sections, wrapper and capability guards; ported locale-aware heading, bounded assigned-user pagination, role query on user links, and the source count/view-all path. |
| apps/web/app/pages/settings/roles/index.vue | Retained candidate sections; ported shared list query/pagination helpers and query-preserving create/detail/clone links. Removed the duplicate route watcher introduced while resolving the conflict. |
| apps/web/app/pages/settings/users/index.vue | Retained candidate sections and filters; ported shared list query/pagination helpers, locale-aware role selector labels, and query-preserving create/detail links. |

The source apps/web/app/assets/css/approved-shell.css and apps/web/i18n/locales/{ar,en}/projects.json deltas were not applied because they are coordinator-owned shared files. HR paths in the fixes checkpoint were outside this package and were left untouched. The PMO and settings snapshots were not copied wholesale; overlapping source behavior was evaluated once.

## Behavioral cause and repair

The candidate was assembled from later UI work after the repair snapshots were created. Directly taking the checkpoint files would have discarded current project workspace/table chrome and settings section navigation. Three-way inspection showed that the useful lost behavior was localized to accessibility, localization, retry/pagination state, responsive milestone rendering, and preserving list context through settings routes. Those hunks were ported into the newer structures. The focused route regression test then caught that the first reconciliation omitted the source assigned-user count and “view all” link when keeping the newer role-detail wrapper; both are now present.

## Verification evidence

From the assigned worktree:

~~~text
npm ci --ignore-scripts                         PASS (850 packages installed)
npm -w apps/web exec -- nuxt prepare           PASS (generated .nuxt types)
npm -w apps/web test -- --run <11 focused files> PASS (11 files, 56 tests)
git diff HEAD --check                            PASS
~~~

The focused test set covered access locale contracts, role routes, project settings, password behavior, admin path/query helpers, search keyboard behavior, archived tasks, projects, board capacity, and PMO repair contracts. Nuxt prepare reported pre-existing duplicate auto-import warnings for project finance/charter helpers; it completed successfully. No build, lint, full suite, browser suite, Odoo test, runtime, database, commit, push, or deployment was run.

## Coordinator requests and residual risk

- Apply the shared shell CSS repair intentionally in the coordinator-owned approved-shell.css; preserve the current tab/chrome rules while adding only the requested min-width/coarse-pointer behavior.
- Reconcile the coordinator-owned project locale additions from the snapshot against the current project workspace vocabulary.
- Stage/commit the marker-free reconciled files during integration; this worker left Git history and index ownership to the coordinator as required.
- `git apply --3way` left three-way index stages on the 11 conflict paths while the worktree contents were reconciled. There are no conflict markers and the files are syntactically testable; the coordinator must stage the resolved versions, including the unchanged ProjectCharterForm conflict entry.
- Run the coordinator’s broad web gates, type check, build, and browser checks.

The worker evidence proves only the focused web behaviors listed above and does not prove full integration or production readiness.

## Follow-up review repair: unsent comment retention

Independent review identified an Important regression in the reconciled task
chrome: `TaskActivity.vue` used an error `v-if`/`v-else` boundary that unmounted
`CommentComposer`, and `TaskDetailPanel.vue` used the same boundary around the
cached task detail subtree. Because `CommentComposer` owns the unsent body in a
local ref, a background timeline/detail failure discarded the draft.

Changed paths in the reviewed web worktree at fbd2880:

- `apps/web/app/components/task/TaskActivity.vue`: render retry state beside
  timeline content, keep `CommentComposer` mounted through read errors, and key
  it by task id so an explicit task change starts a fresh draft.
- `apps/web/app/components/task/TaskDetailPanel.vue`: render the retry state
  beside cached task content instead of using it as the enclosing `v-else`
  branch, while retaining the loading skeleton when no cached task exists.
- `apps/web/app/components/task/__tests__/draftPersistence.test.ts`: mounted
  Vue renderer regression covering timeline error/recovery, enclosing detail
  error with cached task data, and task-id draft isolation.

Regression evidence:

~~~text
Before fix: draftPersistence.test.ts failed in both cases because the child
was unmounted on error (expected unmounts 0, received 1).
After fix: npm -w apps/web test -- --run app/components/task/__tests__/draftPersistence.test.ts PASS (2 tests)
Adjacent: taskChromeDesign.test.ts + useTasks.optimistic.test.ts PASS (26 tests)
~~~

No broad suite, build, lint, browser, runtime, database, or Git/index mutation
was performed for this follow-up. The focused test mounts the compiled Vue
templates and observes child mount/unmount state across reactive error and task
changes; it is stronger than a source-string assertion. The remaining
coordinator responsibility is to stage these marker-free files and rerun the
broader web gates before acceptance.
