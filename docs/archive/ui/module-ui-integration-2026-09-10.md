> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Module UI integration and recovery — 2026-09-10

The user authorized local integration and task-scoped cleanup after approving the non-chat module rollout.

- Recorded main baseline: `1cea240e037ef484f8674e2418de8a2f1a35d79f`.
- Incoming product commit: `d0f149e` (`feat(ui): apply project presentation across non-chat modules`).
- Candidate: `codex/integrate-module-ui`, created from the recorded current main, then fast-forwarded to the incoming commit. No conflicts or replacement of later approved work.
- Chat, backend, contracts and dependencies are unchanged. The full-page task option remains tested alongside the approved shared sheet. Existing Projects regression requirements remain.
- Recovery: `/Users/tariq/code/nasq-recovery-module-ui-20260910/`. `RESTORE.md`, verified Git bundles, source manifests, patches, complete retired workspaces and verification logs are kept outside the repository. `final-state.json` records actual promotion, cleanup and remaining worktrees.
- Cleanup scope: `nasq-module-ui-rollout`, `nasq-module-ui-general`, `nasq-module-ui-hr`, `nasq-module-ui-meetings`, and `nasq-integrate-module-ui`, with their five task branches. Unrelated font-scale and Claude worktrees remain.
- The scratch `.module-ui-preview-schema.test.ts` in canonical main belongs to the preview fixture work and is preserved separately in recovery; the maintained fixture contract tests are committed under `app/utils/__tests__/modulePreviewFixtures.test.mjs`.

Fresh verification is recorded in `logs/`: source and candidate unit suites, candidate typecheck/build, browser rollout and Projects regressions, then tests/runtime verification on the promoted main. An initial candidate test attempt started before Nuxt type generation completed; `setup-order-failure.log` preserves that setup error. It was rerun after preparation without changing product code.

Earlier preview and unmerged status in the rollout report is a historical delivery checkpoint. Task previews are stopped during cleanup. Canonical Odoo/database and unrelated runtimes are preserved. No push or deployment is included.
