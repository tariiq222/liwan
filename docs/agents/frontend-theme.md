# Nasq frontend/theme agent

Project-local role for any coding assistant or human implementing/reviewing Nasq UI. This role is a reusable brief; it does not install an agent globally or guarantee tool auto-discovery.

## Read first

Resolve paths from the selected checkout, never from a hardcoded main directory:
1. `AGENTS.md`, `CLAUDE.md`, `docs/WORKSPACE.md`.
2. `DESIGN.md` — the sole UI policy.
3. `docs/design-system/components.md` and the approved reference linked there.
4. `docs/parallel-work.md` and the bounded assignment.

## Responsibility

Nuxt UI Dashboard is the foundation selected on 2026-09-10. Read
`docs/design-system/nuxt-ui-reference.md`. Every new component belongs to this
theme, reuses its tokens and is catalogued by exact path and responsibility.
No page-local alternative controls or extra UI library without approval.
Existing shadcn-vue/vue-sonner are transition-only. Use the executable reference
in apps/web/design-preview; this is not a customer-app migration. The update
hook was removed by Tariq: follow the current UPDATE_POLICY, not historical
approval reports. Local install/build/preview/tests need no update approval;
GitHub source updates require review and approval in chat.

Implement the approved visual system through existing shared primitives, page recipes and contextual navigation. Review every new or changed frontend page against the constitution. Do not create a personal theme or use historical screenshots as authority.

The coordinator owns default layout, AppSidebar, shared navigation, global CSS/tokens, branding/appearance, shared components, shared locales and final verification. A frontend worker may own those files only when the coordinator explicitly delegates that whole package; other workers then wait. PMO page workers own only their assigned pages/components and locale namespaces.

## Required assignment

Record Target (route/surface), Change (bounded behavior), Acceptance (observable result), exact files, dependencies, selected worktree, and allowed checks.
You are not alone in the repository. Preserve other edits; do not revert or overwrite another worker's files. Do not spawn agents or change shared files outside the assignment.

## Workflow

- The 2026-09-10 section of DESIGN.md takes precedence over historical rules below: reuse the Projects composition and single route-backed sheet across non-chat modules, with the approved dimming/blur and contextual ancestor links. Keep breadcrumbs out of the main content; preserve page-owned navigation and draft guards.
- Inventory existing implementation, permissions, navigation and data states before editing.
- State the shared page recipe and components to reuse.
- Use the approved sidebar/module structure. Only the primary module rail collapses; context navigation stays visible and reflows above content on phones. Place its icon and section title in one row.
- Enforce DESIGN.md's final system-wide context rule: remove breadcrumbs entirely from the shared layout, with no reserved row or conditional filter/deep-route exceptions. The sidebar owns section context. Detail/create/edit pages own required back links and preserve filters, hashes and distinct record/history destinations; never hide them using invisible breadcrumb state. Section roots retain H1/actions without generic subtitles. Preserve meaningful scope/data. Cover layout absence and actual page-back navigation in verification across modules and viewport sizes.
- Match the complete page composition, hierarchy, spacing, cards, tables, filters and actions to the reference; component reuse alone is not visual acceptance.
- Keep the global search/account header visually continuous with the module rail through one shared background token sourced from the saved institution primary colour, with contrasting text/icons. Module overflow must remain navigable.
- Keep routes, queries, filters, hydration, localization and business capabilities.
- Reuse tokens; report a missing shared component to its owner rather than clone it.
- Run `python3 -B tools/ui_policy.py` from the worktree root; `npm test` also runs it before the contract/web suites. Do not widen its baseline to hide a regression. Static checks supplement screenshots and behavior tests; the checker is not wired into CI/hooks and is not an approval gate.
- Retire a definition only with a consumer inventory and replacement. Do not delete user work.
- Keep prototype fixtures and styles in reference material, never wire them into the app.
- Return a reviewable diff and route checklist. Workers do not run broad build/lint/full suites mid-flight; the coordinator runs final gates once. Run bounded checks only when assigned.
- Never share dependency/generated directories or run tests on `odoo19`.
- No commit, merge, push, deploy or main-runtime restart without applicable authorization.

## Review output

Findings first with severity, file/line, user-visible failure and proposed fix. Then report reused components, routes covered, actual commands/results, screenshots if UI changed, legacy definitions removed and remaining gaps.
Markdown-only policy work must not claim the runtime theme was migrated or CI enforcement exists.

## Historical workflow notes

The project-only no-backdrop pilot of 2026-09-09 is historical. The latest
DESIGN.md rollout and navigation decisions apply; adopting Nuxt UI does not
change route/draft behavior or authorize stacking business dialogs.
