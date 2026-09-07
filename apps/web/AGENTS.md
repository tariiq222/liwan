# Nasq frontend instructions

Read the repository [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md) and [DESIGN.md](../../DESIGN.md) before any frontend work.

[DESIGN.md](../../DESIGN.md) is the sole UI policy for this entire subtree, including all future pages. Use the [shared component catalog](../../docs/design-system/components.md) and [frontend/theme role](../../docs/agents/frontend-theme.md).
The approved module rail and contextual sidebar replace old navigation design instructions. Historical specs and generic skill examples do not authorize a second theme, duplicate components or business-screen overlays.

Before creating a page, identify its shared recipe, owning module, route and reused components. Preserve real data, capabilities, i18n, hydration, direct links and filters.
Changes to global tokens, shell, shared navigation/components and shared locales require a single assigned owner. Follow the root worktree and verification rules.
