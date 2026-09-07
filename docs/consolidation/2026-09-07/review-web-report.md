# Independent web reconciliation review

**Current status after focused re-review at `3443e12`: ADDRESSED.** The original Important finding below is closed by the follow-up described at the end of this report; the earlier changes-requested verdict is historical.

Reviewed source: `/Users/tariq/code/nasq/.worktrees/reconcile-web-20260907`, clean worktree at `fbd288071a8c96c16d2bdc0b02985f7e5598b539`. Reviewed the supplied consolidated `task-1-review.diff`, task brief/report and relevant current consumers. Source, Git and runtime remained read-only; only this designated report was written.

**Spec verdict: largely compliant, with one draft-preservation gap to fix before acceptance.** Routed screens, newer project workspace navigation, shared page/control components, access checks, list-context helpers, explicit personal archive scope, server-side project sorting and the editor flush/draft contract survive. Shared CSS and project locales remain the coordinator's final-review responsibility. The replacement layout is outside this package.

**Quality verdict: changes requested.** The new error UI can destroy unsent comments during background refetch failures. No Critical findings. One Important finding below; no additional confirmed Minor defect.

## Important — retain unsent comments when background reads fail

- **Locations:** `apps/web/app/components/task/TaskActivity.vue:25-30`; the same enclosing failure exists in `apps/web/app/components/task/TaskDetailPanel.vue:226-234`.
- **Trigger:** Open a task, type an unsent comment, then let the timeline or task-detail background refetch fail. This is an ordinary path: `apps/web/app/plugins/vue-query.ts:46` enables focus refetch; `apps/web/app/composables/useBus.ts:157-158` invalidates task detail and timeline after bus updates.
- **Cause/evidence:** The added `v-if="error"` / `v-else` branch in TaskActivity unmounts `CommentComposer`; its unsent text lives only in `const body = ref('')` at `apps/web/app/components/task/CommentComposer.vue:12`. Retrying remounts an empty composer. The new error branch in TaskDetailPanel likewise unmounts the entire detail subtree, including TaskActivity, even when cached `task` data still exists. Before this patch these error transitions did not remove the composer.
- **User impact:** A temporary read/network error silently loses a comment draft. This contradicts the package's retention intent and turns a recoverable retry into data loss.
- **Fix:** Keep draft-bearing children mounted while cached task data exists. Display a retry error alongside the cached detail; in TaskActivity isolate timeline loading/error rendering from CommentComposer. Alternatively retain the draft in a stable owner keyed by task ID, but do not allow it to leak to another task.
- **Acceptance:** In a mounted behavioral regression, enter a comment, transition timeline error from null to Error and back, and verify the draft remains. Repeat at the enclosing task-detail error boundary with cached task data. Verify an explicit task change does not reuse another task's draft. Coordinator owns execution of these checks.

## Remaining verification and coordinator interactions

- No tests, builds, browser sessions, runtime changes or databases were run by this reviewer. The worker's reported 56 focused tests were read, not independently rerun; they are not fresh reviewer evidence.
- Browser coverage remains necessary for Arabic/English accessible names, narrow milestone layout, keyboard interactions, return/filter state and immediate submit after editing a rich-text body. Static checks cannot establish these rendered behaviors.
- Confirm the coordinator's final shared CSS and locale integration. Project list sorting has a corresponding `sort` API contract in the reviewed checkout (`odoo-addons/nasq_pmo/controllers/projects.py`), so it is not a frontend-only unsupported query.
- Existing limitation, not introduced by this package: SharedUnsavedChanges uses `onBeforeRouteLeave` only; it does not implement browser refresh/tab-close protection. Do not describe this package as covering those exits.
- No production, deployment or full integration acceptance is implied.

## Focused re-review — 3443e12

**Verdict: ADDRESSED.** Verified the clean web worktree at `3443e12d1f65dd91d7efafc50206e11c8d98b134`, the supplied fix diff, current source and regression test. No tests or runtimes were executed by this reviewer.

- TaskActivity now renders CommentComposer independently of timeline error/loading branches. A same-task read failure/recovery leaves its local body ref mounted.
- TaskDetailPanel now renders cached task content independently of the error notice. A detail refetch failure with cached task data retains TaskActivity and its composer.
- CommentComposer has `:key="task.id"`. Changing tasks remounts the composer and starts a fresh body instead of carrying the previous task's unsent text into a different task.
- The new regression uses the actual compiled TaskActivity/TaskDetailPanel templates with instrumented child stubs. It verifies composer retention through timeline error/recovery, a fresh composer on task ID change, and retained activity through detail error. It does **not** mount the actual CommentComposer implementation or exercise its submit behavior. That distinction does not block this lifecycle fix; the unchanged real composer stores its body locally as assumed by the regression.
- Worker-reported results are 2/2 new tests and 26/26 adjacent tests; these were read, not independently rerun. Broader coordinator gates and the prior report's browser/shared-file limitations remain in effect.
