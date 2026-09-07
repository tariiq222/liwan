# Approved Nasq design rollout

> UI authority update — 2026-09-07: [DESIGN.md](../../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

The user approved the OpenDesign shell, project list/detail, and task detail, then explicitly requested applying the complete design to the real Nasq application with institution colour editing preserved, light/dark mode, and small/medium/large typography (small active by default). They explicitly require isolated worktree delivery.

## Scope and authority

- Deliver in `/Users/tariq/code/nasq-design-rollout`, branch `codex/design-rollout`, based on current main `4b15cb1`.
- Visual authority: `docs/design-system/approved-shell.html`, copied from the approved prototype. Its fixtures and imperative routing are reference material only; use real existing Vue components, queries, records, permissions and routes.
- Apply the shell and shared component language everywhere: PMO, HR, account, search, notifications, settings and forms. Reproduce the designed projects and task information hierarchy while retaining every working feature, permission gate and internal route.
- Do not change backend contracts or Odoo. Preserve all unrelated worktrees and dirty main files. No commits, merges, pushes, deploys, deletion or worktree cleanup are authorized.

## Shared visual contract

- Arabic RTL and existing English locale; IBM Plex Sans Arabic, zinc neutral surfaces and one configurable institution primary colour.
- Sidebar on reading start: 232px expanded / 72px collapsed. Header: toggle/title at start, centered search, notification/account at end. Mobile reflows search to a second row and keeps existing accessible navigation.
- One visible H1, in the shared header. SharedPageHeader registers its reactive title and retains back/actions/description without duplicating H1. Task record title uses the same registration. Avoid DOM scraping and do not remove working title editing.
- All Lucide icons 18px with stroke width 2, from one package (`@lucide/vue` existing system usage); icon action containers exactly 32px square, visible 1px outline, 8px radius. Primary action may be filled; secondary/archival containers must remain visibly equal. Do not shrink inputs and text buttons to icon dimensions.
- Compact filters, consistent page gutters and cards, contained table overflow, accessible labelled icon actions. Normal internal pages for business flows and inline destructive confirmations.
- Project summary cards show short metrics only; one eye/eye-off icon toggles the entire summary group, remembering preference. Counts derive from current filtered real projects.

## Appearance

- `mode: 'light' | 'dark'`, default `light`. `fontSize: 'small' | 'medium' | 'large'`, default `small`.
- A local browser preference cookie, SSR-readable and validated, remembers appearance across reloads; no new server schema or administrator permissions.
- Font root sizes 14px / 16px / 18px; spacing may use existing rem scale but icon/button square dimensions stay fixed pixels. No transform/zoom scaling.
- `/settings/appearance` is available to authenticated users, with clear current selections. Existing institution branding remains restricted by `settings.branding.manage`; personal appearance cannot edit company identity or bypass that gate.
- Preserve exact saved primary colour and choose accessible foreground/derived link and focus colours for BOTH modes. Dark semantic surfaces must cover cards, dialogs/select menus, sidebar, tables, inputs, editors, chips, toasts and previews. No hardcoded white surfaces on dark pages.
- Existing colour endpoint and validation remain unchanged. Theme selection must not reset the configured colour, and editing colour must not reset mode or font size.

## Contracts between workers

- Root owns appearance, brand theme generation, main CSS, app root mounting, settings appearance page/form/tabs and shared common/settings locale integration, test/runtime orchestration.
- Shell lead owns default layout, AppSidebar and account header, shared page context/header/container, shared UI primitives, navigation and shell styling in NEW `approved-shell.css` (root imports it). No main.css edits. API: `usePageHeader(title: MaybeRefOrGetter<string>, description?: MaybeRefOrGetter<string>)` registers route-bound reactive title; `useShellPageHeader()` returns readonly current title/description. SharedPageHeader existing props/slots remain compatible.
- PMO worker owns pages/projects, pages/tasks*, archived-tasks, components/project and components/task, PMO locales/tests. Use shared PageHeader and real state. No backend/auth changes.
- Other-pages worker owns HR pages/components, existing settings/admin pages/components except SettingsTabs and AppearanceForm/new appearance route, account/search/notifications/reports pages, owning locales/tests. Keep all real admin/HR functionality.
- Workers are not alone; never overwrite another owner's files. Shared locale additions are provided as JSON fragments for root to integrate. No worker build/lint/full-suite commands; root runs validation once after integration.

## Acceptance

1. Baseline contracts/web tests pass before changes; new appearance normalization/contrast tests fail first and pass with implementation.
2. Final unit tests, web types and production build pass. Focused browser coverage validates mode/font persistence, brand colour across modes, permitted appearance access, shell layout, task links/return filters and key HR/admin routes without loosening auth.
3. Verify real or explicitly mocked isolated runtime at desktop and mobile, Arabic/English, both modes and all fonts. No tests on `odoo19`.
4. Report exact changed worktree/branch, fresh evidence, residual limits, and leave the isolated worktree intact for review.
