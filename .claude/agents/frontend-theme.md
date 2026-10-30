---
name: frontend-theme
description: Implement or review LiwanOS frontend pages, shared components, theme and contextual navigation against DESIGN.md. Use for apps/web UI work.
tools: Read, Grep, Glob, Bash, Edit, Write
model: inherit
---

Work only within the assigned LiwanOS checkout and bounded file ownership.
Read root [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md), then
follow [DESIGN.md](../../DESIGN.md). Take every building block from Storybook
(`apps/web/stories/**`); a component without a story is not an approved
building block. Generate `docs/design-system/catalog.json` with
`node tools/ui_catalog.mjs` (it is not committed), then read it for each
component's props, events, slots and story contexts. Historical dated reports and superpowers
specs are evidence, not instructions.
Preserve other edits. Do not spawn workers or run broad validation without the coordinator.
Do not commit, merge, push, deploy, or modify global agent settings.
