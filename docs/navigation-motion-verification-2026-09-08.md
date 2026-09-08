# Navigation, motion and notification preview verification

Implemented uncommitted on `codex/navigation-motion` at `/Users/tariq/code/nasq-navigation-motion`, based on local main `51e4362`. No commit, merge, push or deployment. Canonical main is clean after preserving an accidentally misplaced initial test draft outside the repository at `/tmp/nasq-navigation-motion/notificationPresentation.initial-misplaced.test.ts`.

## Changes

Chat and meetings lead the module rail; settings/vendor utility links stay below the scrollable modules. Settings context has capability-filtered personal/administration groups and horizontal mobile navigation. Existing project order and routes remain. Context and conversation selection share presentation tokens. Shell entrance (220ms), page content entrance (160ms) and context changes (140ms) respect reduced motion. Page content is not keyed/remounted; query-only changes and conversation selection keep their context.

Notification preview keeps latest five, More, permission/read/navigation behavior. Captions no longer repeat the task title; mixed-direction titles use bidi isolation. Dates use Gregorian locale formatting and user timezone, interpret naive Odoo timestamps as UTC, and omit malformed values.

## Fresh checks

- `npm test`: 128 contract tests and 614 web tests passed.
- `npm -w apps/web run lint`: exit 0 (Vue/TypeScript check).
- `npm run build`: exit 0, rerun after the final mobile heading spacing adjustment.
- `git diff --check`: exit 0.
- Independent read-only source review: no actionable regressions found.
- Mocked browser verification (`node /tmp/nasq-navigation-motion/verify.mjs`): rail order/expansion; grouped settings; staying on an unsaved form retains its draft; chat filter keeps the same list DOM; readable notification times; widths 390/768/1440 without document overflow; settings reachable at 768x300; notification popover fits 390px; reduced motion has no running animation; no page errors. Screenshots inspected after animations finish.

## Boundary and preview

Preview: `http://127.0.0.1:3498`, mock upstream `4498`, fake database name `nasq_ui_mock_only`. Mock login admin/admin. No Odoo database used by these checks. This is UI verification with fixture data, not real backend acceptance or production evidence. English rendering and all module business workflows were not comprehensively exercised. Existing duplicated Nuxt auto-import warnings remain unrelated to this change.

Logs, smoke script and screenshots: `/tmp/nasq-navigation-motion/`. Notification source worktree is retained at `/Users/tariq/code/nasq-notification-preview`; its reviewed patch is included in this combined worktree.
