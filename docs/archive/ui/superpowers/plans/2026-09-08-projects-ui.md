> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Projects interface and settings ownership plan
Goal: Implement approved Projects UI review with clear individual/system settings ownership.
Architecture: existing Nuxt routes/components, immutable API contracts; isolated file-owned worktrees integrated as reviewed patches in codex/projects-refresh.
Stack: Nuxt 4, Vue 3, existing UI components/tokens, Vitest.
Spec: docs/archive/ui/superpowers/specs/2026-09-08-projects-ui.md
Global Constraints: No backend/schema/business calculation changes, commits/merge/deploy. Preserve main dirty paths. Arabic/English, RTL/LTR, theme/font preferences, route-backed workflows, capability guards. Coordinator owns shared navigation/locales/docs and final verification. All implementers Luna high.

### Task 1: Settings and ownership
- [x] Read and implement /tmp/nasq-projects-refresh-briefs/settings.md in assigned worktree.
- [x] Regression: occupied-stage editor renders real Tooltip; operational saves preserve payload.
- [x] Report focused checks and translation fragment.
### Task 2: Creation, charter and templates
- [x] Read and implement /tmp/nasq-projects-refresh-briefs/forms.md in assigned worktree.
- [x] Verify collapsed values survive submission and charter read/edit both use real persisted data.
- [x] Report focused checks and translation fragment.
### Task 3: Workspace and governance
- [x] Read and implement /tmp/nasq-projects-refresh-briefs/workspace.md in assigned worktree.
- [x] Verify update routes, honest list counts, governance forms and pagination.
- [x] Report focused checks and translation fragment.
### Task 4: Shared integration and remaining surfaces
- [x] Coordinator fixes contextual return destination with regression covering list/task-filter history.
- [x] Review finance/task activity/dashboard surfaces and implement scoped improvements, assigning subsequent Luna package if changes required.
- [x] Integrate scoped diffs and translation leaf patches; review conflicts.
### Task 5: Verification
- [x] Independent final review of implementation against spec, fix findings.
- [x] Run web tests/typecheck/build once after integration, then affected checks for fixes.
- [x] Verify responsive Arabic UI and direct/back navigation in isolated preview with safe data source.
- [x] Record actual coverage, branch, preview and remaining limitations; no release claims.

## Completion evidence
Implementation and independent reviews completed. See docs/archive/ui/projects-ui-implementation-2026-09-08.md for actual checks, mocked browser coverage and known baseline test failure. No commit, integration into main, push or deployment was performed.
