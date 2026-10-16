> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Project Collaboration Implementation Plan

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). ليس تعليمات واجهة.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkboxes. User authorized Luna team execution.

**Goal:** Deliver task attachments, in-app notifications, dependency editing and archive restoration.
**Architecture:** Stock Odoo models extended by webvue_pmo, explicit API contracts and localized Nuxt components. Three independent worker worktrees transfer owned files into an isolated integration checkout.
**Tech Stack:** Odoo19 CE, Python, Nuxt4/Vue3, TypeScript/Zod, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-09-05-project-collaboration-design.md

## Global Constraints
- Preserve stock Odoo and HR; never test on odoo19. No Git commits/merges/push/deploy/deletion.
- Only root runs commands that test/build/lint or mutate runtime/databases. Workers author tests first.
- Explicit file ownership, independent worktrees, no shared generated/dependency symlinks.
- Arabic RTL and English; api_handler, session-cookie JSON2, whitelist and record access checks.
- Source of exact interfaces and ownership: /private/tmp/webvue-collab-batch/context.json.

## Task 1: Task attachments (Luna)
Files: models/task_attachments.py,controllers/task_attachments.py,serializers/task_attachment.py under webvue_pmo; packages/contracts/src/pmo/attachment.ts; useTaskAttachments.ts; task/TaskAttachments.vue; attachments locales; tests/test_task_attachments.py; e2e/task-attachments.spec.ts.
Interfaces: POST {name,mimetype,data}; list {items,total}; DELETE204; Attachment {id,name,mimetype,url}; component accepts taskId:number and emits changed.
- [x] Author regression tests: permitted upload/download/delete, malformed base64/oversize/type, unreadable task, cross-task delete. Example: `response = self.api('DELETE', f'/api/v1/tasks/{task_b.id}/attachments/{attachment_a.id}'); self.assertIn(response.status_code, (403,404)); self.assertTrue(attachment_a.exists())`.
- [x] Implement allowlist/size decoding and exact-link checks using stock ir.attachment. `task.check_access('write')` precedes mutations; `res_model`/`res_id` come from checked task, never client data.
- [x] Implement JSON2 controller and Zod schema, component file picker, pending state, localized errors and delete confirmation.
- [x] Author browser upload/download/delete flow with byte assertions and reload; self-review, write report and changed-files manifest. Do not run tests.

## Task 2: In-app notifications (Luna)
Files: models/task_notifications.py,models/mail_notification_webvue.py,controllers/notifications.py,serializers/notification.py,data/webvue_notification_cron.xml; notification.ts; useNotifications.ts; notifications/NotificationCenter.vue; pages/notifications.vue; notifications locales; test_notifications.py; notification schema tests; e2e/notifications.spec.ts.
Interfaces: GET /notifications envelope; read endpoints {updated}; NotificationCenter no props. Spec defines exact item shape.
- [x] Author recipient isolation, assignment/comment, access revocation, read idempotence, deadline replay and no-email tests. Example: `Task._webvue_send_deadline_reminders(); before = inbox.search_count(domain); Task._webvue_send_deadline_reminders(); self.assertEqual(inbox.search_count(domain), before)`.
- [x] Inspect native mail fields and implement narrowly scoped delivery on stock models with dedup identity constraint. Every API response checks current task access before exposing any content/count.
- [x] Implement read actions, polling bell linking to /notifications, unread badge and a localized paginated inbox page. Ignore self actors. Schedule hourly cron but tests call method directly.
- [x] Author two-user browser scenario; report changed files and any integration hooks. No validation commands.

## Task 3: Dependency and archive lifecycle (Luna)
Files: existing webvue_pmo project/task models, controllers/tasks.py,serializers/task.py and project.py; new controllers/task_dependencies.py,task_archive.py; task/project contracts; TaskDetails.vue, ProjectGeneralForm.vue, existing task composables; DependencyPicker.vue, pages/archived-tasks.vue; lifecycle locales; dedicated tests and e2e/task-lifecycle.spec.ts. See context ownership list.
- [x] Author enabled/disabled, self/cycle/cross-project, unauthorized, archived-project and restore visibility tests before implementation.
- [x] Add manager-gated dependency endpoints using stock relation and current readable same-project records. Convert cycle errors to structured422. Serialize feature flag and management capability.
- [x] Add archive-list/restore with active_test=False, readable manager-or-creator policy, correct total and archived-parent rejection. Keep existing Task shape unchanged.
- [x] Implement dependency picker, project setting, archive route and links. Invalidate dependent query caches. Author browser reload tests, report; no validation commands.

## Task 4: Integration and review (root + Sol)
- [x] Collect explicit owned-file manifests; copy only owned files to integration tree. Root owns all shared init/barrel/manifest/mount/locale registrations and updates existing strict contract tests affected by additions.
- [x] Preflight ownership table: T1/T2 share init/barrels only (root); T1/T3 TaskDetails mount occurs after T3 transfer (root); T2/layout mount (root); T3 existing contracts consumed by T1/T2 optional capability defaults preserve compatibility. Each task agrees with its spec.
- [x] Review against spec and security boundaries. Sol reads all changed code with manifests; any important findings return to same Luna owner.
- [x] Root runs `npm test`, `ruff check odoo-addons`, `npm -w apps/web run lint`, `npm run build` (typecheck/build sequential), isolated Odoo gate via /private/tmp/webvue-collab-verify-backend.sh. Commands/logs in root verification ledger.
- [x] Root seeds named scratch database, starts Odoo8279 and Nuxt3379 with explicit DB/data/addons, runs Playwright against E2E_BASE_URL=http://127.0.0.1:3379. Fix failures and repeat only affected checks, then final review.
- [x] Write delivery evidence and remaining limitations; preserve uncommitted isolated worktree. No merge or canonical runtime change.

## Final browser follow-up
- [x] Confirm inline attachment deletion and cancellation in browser.
- [x] Prove notification assignment/comment/read persistence between two real users through the dedicated inbox page.
- [x] Repeat final frontend gates after these UI corrections.

## Delivery
See `2026-09-05-project-collaboration-delivery.md` for exact command evidence, the full/browser-focused result distinction, and local-only Git/runtime state. All checkboxes represent completed work; no commit, merge, push, deployment or cleanup occurred.
