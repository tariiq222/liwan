# Nasq frontend/theme agent

Project-local role for any coding assistant or human implementing/reviewing Nasq UI. This role is a reusable brief; it does not install an agent globally or guarantee tool auto-discovery.

## Read first

Resolve paths from the selected checkout, never from a hardcoded main directory:
1. `AGENTS.md`, `CLAUDE.md`, `docs/WORKSPACE.md`.
2. `DESIGN.md` — the sole UI policy.
3. `docs/design-system/components.md` and the approved reference linked there.
4. `docs/parallel-work.md` and the bounded assignment.

## Responsibility

Implement the approved visual system through existing shared primitives, page recipes and contextual navigation. Review every new or changed frontend page against the constitution. Do not create a personal theme or use historical screenshots as authority.

The coordinator owns default layout, AppSidebar, shared navigation, global CSS/tokens, branding/appearance, shared components, shared locales and final verification. A frontend worker may own those files only when the coordinator explicitly delegates that whole package; other workers then wait. PMO page workers own only their assigned pages/components and locale namespaces.

## Required assignment

Record Target (route/surface), Change (bounded behavior), Acceptance (observable result), exact files, dependencies, selected worktree, and allowed checks.
You are not alone in the repository. Preserve other edits; do not revert or overwrite another worker's files. Do not spawn agents or change shared files outside the assignment.

## Workflow

- Inventory existing implementation, permissions, navigation and data states before editing.
- State the shared page recipe and components to reuse.
- Use the approved sidebar/module structure. Only the primary module rail collapses; context navigation stays visible and reflows above content on phones. Place its icon and section title in one row.
- Enforce DESIGN.md's system-wide context deduplication rule across every module: sidebar owns module/section/project context; exact section roots retain H1 and actions without breadcrumb rows or generic subtitles. Pinned creation links remain deep routes. Deeper pages keep short permission-aware section navigation with filters; suppress only duplicate resolved return destinations. Preserve distinct record/project/history returns and meaningful scope/data (including counts, job titles and descriptions). Global search must not acquire a fabricated Projects parent. Reject regressions through route-matrix and actual rendered-header checks across modules and viewport sizes.
- Match the complete page composition, hierarchy, spacing, cards, tables, filters and actions to the reference; component reuse alone is not visual acceptance.
- Keep the global search/account header visually continuous with the module rail through one shared background token sourced from the saved institution primary colour, with contrasting text/icons. Module overflow must remain navigable.
- Keep routes, queries, filters, hydration, localization and business capabilities.
- Reuse tokens; report a missing shared component to its owner rather than clone it.
- Retire a definition only with a consumer inventory and replacement. Do not delete user work.
- Keep prototype fixtures and styles in reference material, never wire them into the app.
- Return a reviewable diff and route checklist. Workers do not run broad build/lint/full suites mid-flight; the coordinator runs final gates once. Run bounded checks only when assigned.
- Never share dependency/generated directories or run tests on `odoo19`.
- No commit, merge, push, deploy or main-runtime restart without applicable authorization.

## Review output

Findings first with severity, file/line, user-visible failure and proposed fix. Then report reused components, routes covered, actual commands/results, screenshots if UI changed, legacy definitions removed and remaining gaps.
Markdown-only policy work must not claim the runtime theme was migrated or CI enforcement exists.
