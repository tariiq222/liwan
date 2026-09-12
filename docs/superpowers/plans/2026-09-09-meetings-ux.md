> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Meetings UX repair implementation plan

Goal: implement the user-approved meetings audit corrections while preserving the current approved UI and business policies.
Architecture: extend Nasq PMO and its strict contracts, keep one task per recommendation, use routed Nuxt workflows and existing shared presentation. Freeze historical content at existing complete transition; legacy history remains explicitly unavailable.
Spec: preceding user-approved audit and external context.md. User requested Luna High agents; three parallel implementers maximum. No commits or main integration authorized.

## Global constraints
Arabic RTL; no new dependencies; no stock Odoo edits; capability gates preserved; no tests on odoo19. Baseline current main 4dc72be plus preserved dirty patch. Every worker has a separate checkout and dependencies. All tests/build/lint run by coordinator. Tests first for regression corrections; avoid tests mirroring presentational markup. Translations merged by coordinator from package fragments.

## Tasks
- [x] 1. Backend: date consistency and clearing; exact recommendation actions and current task projection. Ownership and acceptance: external backend.md. Output additive resolution fields execution_state/task_linked/allowed_actions and nullable patch clocks.
- [x] 2. Forms: day+time, field errors, recurrence preview, scoped save explanation, bounded independent participant/writer choice. Ownership and acceptance: external forms.md. Consumes nullable patch clocks.
- [x] 3. Workspace: mobile list/agenda, date/time and series settings, navigation context, recommendation filtering and action controls. Ownership and acceptance: external workspace.md. Consumes additive resolution fields.
- [x] 4. Historical minutes: dependent on backend serializer; save snapshot at complete, no legacy backfill, PDF uses snapshot, UI identifies historical vs current.
- [x] 5. Routed minutes editor and common editor accessible labels; dependent on forms/detail delivery.
- [x] 6. Review each package diff versus preserved baseline; combine only owned changes; merge translation fragments. Independent Astra read-only review of combined result.
- [x] 7. Final gates: contracts and web tests/typecheck/build, Odoo isolated install plus affected regression/security/scoping suite, browser local isolated sample workflows at desktop/mobile, PDF render if available. Diagnose baseline failures separately. Preserve artifacts/worktrees and report exact limits.

Rulings: User approved audit via start repairs; no repeated design approval. Parallel independent packages follow direct user request over sequential skill recipe. Existing uncommitted design edits are copied as baseline, not newly authored by this task. Snapshot time is existing completion (no new approval workflow); re-completion creates current replacement snapshot, legacy done records no fabricated history. Coordinator controls runtime and security-sensitive decisions.
