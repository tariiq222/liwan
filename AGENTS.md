# Nasq agent entry point

## Current frontend authority — Nuxt UI, 2026-09-10

Nuxt UI Dashboard is the approved customer-UI foundation for all modules.
Read DESIGN.md and docs/design-system/components.md before UI work. Every new
component must belong to the shared Nasq theme and be registered in the catalog
with its exact path, responsibility and reused primitives. No page-local
alternative controls or extra UI library without Tariq's approval.
Existing shadcn-vue/vue-sonner consumers are transitional only; do not extend
them to new pages. Preserve routes, drafts, capabilities, Arabic/RTL, the
module rail, contextual navigation and appearance preferences.
The executable isolated reference is in `apps/web/design-preview`; the customer
application has not been migrated. Follow the current `docs/UPDATE_POLICY.md`:
the update hook was removed by Tariq, local install/build/preview/tests need no
update approval, and GitHub source updates require review and approval in chat.
Do not ship unresolved U components or a second-library lookalike.
Use applicable policy checks, behavior tests and visual review; documentation
alone is not automated enforcement. This supersedes older component/visual
choices; the latest DESIGN.md decisions govern workflow behavior.

## Project workflows — user-approved tabs and popups, 2026-09-09

The user explicitly superseded the previous prohibition on business dialogs and authorized implementing the new interaction model in Projects first. Project workspaces use direct tabs; project record/create/edit/settings workflows may use one route-backed Side Sheet attached to the main module rail (not the contextual sidebar), below the header and filling available height. Use a content-appropriate width, no dimming backdrop, enter from the right and exit to the left, and respect reduced-motion preferences. Keep direct links, refresh/browser-back, permissions, draft protection, filters and scroll context. Nested records replace dialog content rather than stacking business dialogs. Standalone pages remain an explicit option. All other modules keep their current behavior pending a separate rollout. This section overrides older no-modal/no-popup clauses for this scope. See `docs/superpowers/specs/2026-09-09-project-tabs-popups-design.md`.

## Current UI authority — 2026-09-07

For all Nasq customer-UI work, read [DESIGN.md](DESIGN.md) first, then the component catalog and frontend/theme role linked there. The approved module rail and contextual sidebar supersede older visual/navigation instructions. This is project-local policy; existing business, security and delivery rules still apply. The reference is approved; runtime migration remains a separate implementation phase.

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
  `docs/runtime-upgrade-cleanup-2026-09-07.md` for current evidence and `docs/WORKSPACE.md`
  for recovery. Older branch plans/reports and WIP are historical material.
- Never run tests on `odoo19`. Do not commit, merge, push, deploy, remove
  worktrees/branches, or discard work without authorization for that action.
- Local verification does not prove production deployment. Report fresh test
  evidence and the actual branch/runtime state.

## Preserve approved work on every merge — 2026-09-08

The user's instruction «كومت ودمج» means: commit the requested work and
integrate it into the latest local `main`, preserving previously approved
behavior and adding the requested changes. It does not authorize undoing an
earlier decision, merging unrelated worktrees, or deleting recovery material.

Before every integration, including from an older worktree:

1. Read this policy from the canonical `/Users/tariq/code/nasq/AGENTS.md` and
   the latest committed `main`, not only the incoming worktree's older copy.
   Inspect and preserve dirty changes in both checkouts. Record the current
   `main` commit and incoming commit as the integration baseline.
2. Prepare the combined result in an isolated integration worktree based on
   that current `main`. A branch that started earlier has no priority over
   later approved work. Do not replace whole files from the incoming tree,
   use blanket `ours`/`theirs` conflict resolution, reset `main` to that tree,
   or treat an ancestor commit's presence as proof its behavior survives.
3. Review the candidate diff against the recorded current `main`, including
   deletions, shared components, design decisions, navigation, permissions,
   contracts and regression tests affected by the incoming work. Reconcile
   changes so both compatible sets of approved behavior remain. Resolve
   accidental regressions without asking the user to reapprove old decisions.
4. Run applicable checks on the combined result. Retain the regression
   requirements from the recorded `main`; an incoming branch must not make
   its own regression pass by silently removing or weakening those checks.
   A failing check requires diagnosis: distinguish a reproduced baseline
   failure from a new regression and report the actual result. No new
   regression may be accepted as a completed merge.
5. If the new request genuinely conflicts with a prior approved behavior,
   preserve that behavior and ask for the specific decision needed. General
   permission to commit and merge does not authorize that reversal. Explicit
   user approval to replace the old behavior permits the corresponding code
   and regression-test update.
6. Before updating `main`, verify it still points to the recorded baseline.
   If another task advanced it, rebuild and verify the candidate against the
   new tip. Promote only the verified candidate with a fast-forward, then
   verify the resulting commit and working-tree state. Preserve other active
   worktrees; cleanup still needs separate authorization.

These are mandatory agent workflow instructions. They are not a Git hook or
server-enforced branch protection; do not claim automated merge protection
exists unless it has actually been installed and verified.

## Approved header exception (2026-09-06)

The user explicitly changed header search to a centered popup and the
notification bell to a latest-five popover with More opening `/notifications`.
This narrow exception supersedes the older no-popup search wording above.
All other business screens remain internal routes.

## Approved unsaved-changes exception (2026-09-07)

The user approved a centered confirmation popup for leaving a form with unsaved
changes. SharedUnsavedChanges owns this confirmation across forms. Detail, create,
edit and settings workflows themselves remain internal pages.

## Implementation agent routing — 2026-09-07 (scoped 2026-09-09)

This rule applies to Codex only. When the coordinator runs inside Codex, all
implementation agents must use GPT-5.6 Luna with high reasoning effort
(`luna-high`); read-only review agents may use Astra. Do not substitute another
implementation model there without a new user instruction.

In OpenCode (including the Flex-* agents and `flex_delegate`) this rule does
not apply: models are chosen per task from the connected providers by cost and
adequacy, subject to any restriction the user gives in that session. The
coordinator owns planning, integration and review in both tools.
