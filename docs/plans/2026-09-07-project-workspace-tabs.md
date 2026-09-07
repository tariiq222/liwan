# Project workspace: one chrome, view tabs, icon edit

> UI authority update — 2026-09-07: [DESIGN.md](../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

## Contract
- One header + one `nasq-tabs` row on every workspace view.
- Tab click shows content (not a form).
- Create/edit is an icon (Plus / Pencil), same as tasks/overview.
- No `returnTo` on tab links.
- Keep testids: `project-charter-link`, `project-{schedule,stakeholders,raci,register}-link`, `project-finance-link`.

## Workspace paths
`/projects/:id` and `/:id/{charter,schedule,stakeholders,raci,register,finance}` (index only).
Settings, `*/new`, `*/edit`, task/milestone drawers stay focused form pages.

## Lanes
1. Shell (serial): `ProjectWorkspaceNav.vue` + `[id].vue` chrome always on workspace paths.
2. Charter: readonly view; Pencil → `?edit=1` form. Update e2e.
3. Schedule: fix 404 (`notFound` from project, not schedule API); strip duplicate header.
4. Stakeholders + RACI: strip header; Plus → `/stakeholders/new`.
5. Register: strip header; Plus → `/register/new`.
6. Finance: strip list header; Plus icons instead of text create buttons.

## Invariants
Existing list/query behavior unchanged. Forms stay on `/new` and `/edit`.
