# Nasq agent entry point

Read `CLAUDE.md` for the product architecture and engineering rules, then
`docs/WORKSPACE.md` for the workspace and recovery map. Read
`docs/parallel-work.md` before parallel work or changing shared files.
These are repository instructions for every coding agent, regardless of tool.

- Verify the current branch, worktree, and dirty paths before editing. The
  canonical local development checkout is `/Users/tariq/code/nasq` on `main`.
- Develop bounded tasks in temporary `codex/<task>` worktrees based on current
  `main`. Give each task explicit file ownership and independent dependencies,
  generated files, databases, and ports. One orchestrator owns Git integration,
  shared-file edits, runtime changes, and final checks.
- Preserve stock Odoo source. Extend `project` through `nasq_pmo` and `hr`
  through `nasq_hr`. Do not recreate either pillar.
- The HR page is `/hr`; `/api/v1/people` remains the PMO user-id picker. Preserve
  HR documents and the `{items, total}` list envelopes.
- All business screens use internal page routes in the normal app layout.
  Do not introduce drawers, sheets, or modal popups for detail, create, edit,
  settings, or search workflows. Give pages direct links and working refresh
  and back navigation that preserves list filters. Confirm destructive actions
  inline in the relevant page. This is the user's standing design rule for
  the entire system; simple value-selection menus are controls, not screens.
- Phase 3b and the later access, design, HR hierarchy, and collaboration
  work are consolidated by the 2026-09-05 unification. Read
  `docs/unification-2026-09-05.md` for current evidence and `docs/WORKSPACE.md`
  for recovery. Older branch plans/reports and WIP are historical material.
- Never run tests on `odoo19`. Do not commit, merge, push, deploy, remove
  worktrees/branches, or discard work without authorization for that action.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.
