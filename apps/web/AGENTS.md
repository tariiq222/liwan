# Nasq frontend instructions

## Nuxt UI foundation — 2026-09-10

Nuxt UI Dashboard is the selected foundation; `design-preview/` is the isolated
executable reference. `app/` customer pages have not been migrated yet.
Every new component must use the shared Nasq theme and be catalogued by exact
repository path, responsibility and reused primitives. Reuse Nuxt UI directly
where sufficient; do not wrap every primitive or
add per-page alternatives, another UI library or new legacy consumers.
Use the latest DESIGN.md for workflow behavior and preserve routes, drafts,
permissions, Arabic/RTL and appearance. Follow the current UPDATE_POLICY:
the hook was removed; local install/build/preview/tests need no update approval.
GitHub source updates require review and approval in chat. Do not ship unresolved
imports. Run `python3 -B tools/ui_policy.py` from the worktree root and review
behavior and visuals; the UI checker is standalone, not an update hook.

Read the repository [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md) and [DESIGN.md](../../DESIGN.md) before any frontend work.

[DESIGN.md](../../DESIGN.md) is the sole UI policy for this entire subtree, including all future pages. Use the [shared component catalog](../../docs/design-system/components.md) and [frontend/theme role](../../docs/agents/frontend-theme.md).
The approved module rail and contextual sidebar replace old navigation design instructions. Historical specs and generic skill examples do not authorize a second theme, duplicate components or business-screen overlays.

Before creating a page, identify its shared recipe, owning module, route and reused components. Preserve real data, capabilities, i18n, hydration, direct links and filters.
Changes to global tokens, shell, shared navigation/components and shared locales require a single assigned owner. Follow the root worktree and verification rules.
