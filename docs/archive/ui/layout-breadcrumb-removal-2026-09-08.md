> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Remove layout breadcrumbs completely — 2026-09-08

The user's final instruction is to remove breadcrumbs from the layout entirely. Conditional deduplication was insufficient: filtered destinations could still produce the unwanted global row. This explicit decision supersedes the earlier breadcrumb display rules and their feature-specific tests.

The default layout now renders its page content directly, without ShellBreadcrumb. The component, breadcrumb state/target registry, breadcrumb-only navigation builders and CSS (including row-height adjustments) are removed. PageHeader and TaskDetailPanel no longer hide return links on behalf of the deleted component. Detail/create/edit pages retain their own exact return destinations, filters and hashes. Contextual navigation, permissions, project root header policy, task sibling/edit controls and the recent chat sidebar remain intact.

The worktree starts from canonical main67e8072 and is isolated as codex/remove-layout-breadcrumb. Obsolete tests for the removed feature are replaced by checks for its absence and for restored page-owned return links; root/context/sidebar regressions are preserved. DESIGN.md and frontend/component guidance document the final rule.

Verification is local: built Nuxt at3501, synthetic API4501 and database name nasq_layout_breadcrumb_mock. No tests access Odoo or odoo19. The browser verifies that MAIN is the workspace's only element child, that no breadcrumb row exists even on filtered chat/deep routes, and that page back links survive click, browser back and reload at390/1440. Final outcomes follow below.

Final verification:

- Built-server browser matrix:28/28 passed at390/1440. Every workspace has only MAIN as an element child. No breadcrumb remains on filtered chat, creation, records, utilities or project roots. Exact page back targets were clicked, restored by browser back and checked again after reload.
- Nuxt build and coordinator-run Vue/TypeScript check passed.
- Focused navigation/header/layout/task checks:32 passed. Coordinator reviewed actual deletions and preserved context/permission/sibling behavior.
- Web suite:570 passed; the sole failure remains the previously reproduced meetingNavigation.test.ts harness error `refDebounced is not defined`. There is no new failure. Test-count reduction reflects removal of explicitly superseded breadcrumb-feature tests, not weakened current navigation requirements.

Artifacts: `/Users/tariq/.codex/visualizations/2026/09/08/01a0801f-047b-7b43-9c28-c81f9c6b352a/layout-breadcrumb-removal/`. Verification is local, not a production deployment claim.
