# HR independent review and focused fix review

Original review: clean `4c9b20a` in `/Users/tariq/code/nasq/.worktrees/reconcile-hr-20260907`.
Fix review: clean `1adcad0` in the same worktree.

Original spec verdict: FAIL. Original quality verdict: CHANGES REQUIRED.
Focused fix verdict: PASS for the three Important findings below. No unexpected regression identified in the fix diff. Final runtime and integration acceptance remain with the coordinator.

## Original findings and fix verdicts

1. **Important — employee-manager repairs lost — ADDRESSED.**
   Original `apps/web/app/components/hr/EmployeeGeneralForm.vue:58` rendered only the supplied initial employee list. The edit route fetches the default first 200 employees, so managers outside that page could not be selected, and an existing manager outside it lacked a displayed option. Source checkpoints `3a1a9dc` and `ed613a1` contained remote search, selected-manager preservation and retry UI absent from the reviewed candidate. At `1adcad0`, the form uses debounced server search, `useHrEmployee(managerId)`, `hrManagerOptions` with current/selected manager fallbacks and self-exclusion, and guarded retry UI. The existing SharedFormSection structure, unsaved-change state and write/hydration guards remain intact. The appended task report acknowledges and supersedes the earlier incorrect retained-behavior claim.

2. **Important — global documents could not return from page two to page one — ADDRESSED.**
   Original `apps/web/app/pages/hr/documents/index.vue:66` spread the old query and added nothing when offset became zero, retaining `offset=25`. With requests/page number using committed route state, Previous left page two active. The fix explicitly overwrites offset with `undefined` for page one while preserving the remaining query fields.

3. **Important — department filtering sent stale pagination — ADDRESSED.**
   Original `apps/web/app/pages/hr/documents/index.vue:22` combined committed route q/offset with draft departmentId. Changing department on page two could issue a request for the new department at the previous offset before router replacement completed. The fix derives q, offset and validated department_id together from route.query; local draft changes no longer change request parameters ahead of the route commit.

## Review evidence and boundaries

- Read the original package brief, original consolidated HR diff, appended task report, fix diff and relevant current/source code. Read-only Git inspection confirmed clean `1adcad0`.
- The new regression tests execute the production SFC setup with mocked dependencies. Their assertions cover selected-manager options, explicit page-one offset removal and committed department request parameters. They are consumer-setup tests, not mounted DOM or browser tests.
- The worker reports three expected pre-fix failures, then 3 passing new consumer tests and 47 passing HR-focused tests. The reviewer did not rerun tests, start runtimes or mutate source/Git, as assigned.
- The initial review found chart routing, return links, existing capability checks, document write serialization and list invalidation preserved. No Critical findings were identified.
- Chart sizing, fullscreen, pointer interaction, visual/mobile behavior and final integrated runtime remain outside this focused fix review. No deployment or full-package runtime success is claimed.
