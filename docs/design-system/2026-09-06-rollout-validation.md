# Approved Nasq design rollout

> UI authority update — 2026-09-07: [DESIGN.md](../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

## Review environment

- Isolated worktree: `/Users/tariq/code/nasq-design-rollout`
- Branch: `codex/design-rollout`, based on `main` at `4b15cb1`.
- Preview: `http://127.0.0.1:3567/projects`
- Appearance: `http://127.0.0.1:3567/settings/appearance`
- Odoo: `127.0.0.1:9567`, database `nasq_design_20260906`.
- Runtime data directory: this worktree's ignored `.runtime/odoo`.
- The scratch database was created specifically for this task and seeded with sample Arabic projects, tasks, and employees. These are review fixtures, not current production records.
- No commit, merge, push, deployment, branch removal, or worktree removal.

## Appearance contract

The institution's saved primary color stays exact. Link and focus colors are derived for contrast against light/dark surfaces. Light/dark and small/medium/large are browser preferences stored in an SSR-readable cookie. Defaults are light and small; root font sizes are 14/16/18px. Icon action boxes remain 32px independently of font size. Existing institution branding permissions are preserved; personal appearance is available to authenticated users.

## Verification record

- Baseline: 80 contract tests and 235 web unit tests passed.
- Appearance/brand utility tests: red observed before implementation, then 29 passed.
- Appearance login-return regression: red observed, then 6 access-policy tests passed.
- Shell title lifecycle: 1 test passed using a real Vue component tree.
- Appearance browser checks: preference persistence, SSR before hydration, and color-save independence passed on the isolated backend.
- Final integrated `npm test`: 80 contract tests and 251 web unit tests passed (37 web test files).
- `npm -w apps/web run lint`: TypeScript check passed.
- Production build passed with the isolated Odoo URL/database compiled into the server proxy configuration.
- Final browser acceptance: 49 tests passed across appearance, branding, shell, internal routes, task details/activity/lifecycle, projects/admin, HR directory/documents, and access administration.
- Desktop 1440px and mobile 390px in both modes with large text: one page title, no document overflow, fixed 32px actions. The strengthened loaded-content layout suite was rerun separately: all 4 tests passed. Screenshots were inspected after real task fields loaded, avoiding skeleton-only evidence.
- Focused independent review: resolved shared card radius/shadow, HR editor action labels, and global Lucide geometry; no remaining material issue in reviewed paths.
- Browser regression found and fixed: overlapping project search/status updates now preserve both query filters; direct task links and return navigation passed.
- `git diff --check` passed. Canonical main retains only its existing unrelated changes. Backend and contract source are unchanged.

Logs are local review artifacts: `/tmp/nasq-design-rollout-final-unit.log`, `/tmp/nasq-design-rollout-types.log`, `/tmp/nasq-design-rollout-build.log`, `/tmp/nasq-design-rollout-final-e2e.log`, and `/tmp/nasq-design-rollout-loaded-layout.log`.

## Scope

The shell and existing project/task, HR, account, search, notification and administration surfaces use the shared design and appearance tokens. Reports retains its existing placeholder behavior; this task adds no invented report data. All icons use `@lucide/vue`. The approved HTML is a reference artifact only; Vue pages keep the real APIs and capability checks.

## Runtime commands

Run Odoo with the explicit worktree addons path, scratch database, data directory, and port from the plan. Run the frontend from this worktree with:

```sh
NUXT_ODOO_URL=http://127.0.0.1:9567 \
NUXT_ODOO_DB=nasq_design_20260906 \
NUXT_PUBLIC_WS_URL=ws://127.0.0.1:9567/websocket \
npm -w apps/web run build

HOST=127.0.0.1 PORT=3567 \
NUXT_ODOO_URL=http://127.0.0.1:9567 \
NUXT_ODOO_DB=nasq_design_20260906 \
NUXT_PUBLIC_WS_URL=ws://127.0.0.1:9567/websocket \
node apps/web/.output/server/index.mjs
```

Local checks prove only the isolated checkout and runtime. Production has not been changed or verified by this task.

## Header follow-up — search and notifications

The user's explicit follow-up replaces the header search-page action with a centered search dialog and the notification-page action with a latest-five preview. This is an authorized exception to the older internal-pages-only search rule. Existing direct `/search` links still work; business record details remain routed pages.

- `GlobalSearch.vue`: centered, focus-trapped dialog; header button and Cmd/Ctrl+K; Escape restores trigger focus. Permission-filtered navigation and projects, plus debounced, paginated `filter=mine` task search labelled “My tasks” to match the current API contract. Results open their real routes.
- `NotificationCenter.vue`: API newest-first records, preview capped at five, readable states and timestamp; clicking an unread item marks it read before routing, with a recoverable error state. “More” opens the existing paginated `/notifications` page.
- Both use the shared colors, dark mode, typography and 32px icon buttons. Backend APIs and permissions are unchanged.
- New behavior tests were observed failing against the prior preview before implementation. Final follow-up verification is recorded below.

Follow-up final verification: 16/16 browser tests passed (`header-overlays`, `internal-pages`, `notifications`, `approved-shell`, `appearance`), including real task search/return filters and real recipient notification/read persistence. Types and isolated production build passed. Logs: `/tmp/nasq-overlays-final-e2e.log`, `/tmp/nasq-overlays-types.log`, `/tmp/nasq-overlays-build.log`.

Focused review corrections: result links retain internal `returnTo`; the project API's existing 200-record cap is disclosed with the same message as the project list; notification test history now follows newest-first IDs; unread count/state have accessible labels. Project search remains within the existing API cap, and task search uses the current user's active tasks. No API expansion was made.

The user's subsequent focus-style correction is applied globally in `main.css`: neutral 1px keyboard outline, input border and a subtle 1px/15% shadow; stacked Tailwind rings are suppressed. Shared account and appearance choices follow the same thin treatment. Invalid-field color and forced-colors keyboard outlines remain. Live rendered search input was inspected: border 1px, subtle shadow spread 1px, no visible outline. Desktop light and mobile dark screenshots were inspected; final popup screenshots wait for opacity 1 to avoid transition frames.

## Local integration authorization

The user explicitly requested merging this design into main on 2026-09-06.
This supersedes the original uncommitted/isolation-only delivery status above.
The integration includes the latest centered-search, notification-preview,
quiet focus and readable notification-count refinements. The architecture
guard now permits only the approved GlobalSearch dialog; the general
internal-page rule and native popup prohibition remain. Existing unrelated
main changes are preserved, and preview/runtime worktrees remain available.
