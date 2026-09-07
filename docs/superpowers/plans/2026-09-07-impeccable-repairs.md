# Nasq Impeccable Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Follow the independent-package constraints below.

**Goal:** Repair the 27 findings from the approved audit and verify responsive behavior against current main.
**Architecture:** Preserve Nuxt/Odoo architecture, existing tokens and route UX. Independent pillar fixes share no mutable files; coordinator owns shared layout, project list ordering, aggregation and validation.
**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vue Query, Tailwind, Odoo 19.
**Spec:** /Users/tariq/code/nasq-audit-20260907/REPORT.md (A01–A27).

## Global Constraints
- No commit, merge, push, deploy, cleanup or canonical checkout edits authorized. Produce reviewed uncommitted changes in codex/impeccable-fixes.
- Preserve main's nuxt.config.ts, Caddyfile, .agent and integrated chat. Baseline a036fa0.
- Existing route, capability, RTL/i18n, shared unsaved guard and hydration contracts remain binding.
- Never run tests on odoo19. Runtime evidence requires a separate scratch database and explicit selected addons path.
- Workers run focused unit regressions only; coordinator owns broad gates and browsers.

## Task 1: Shared responsive containment and global project ordering
Own app/assets/css/main.css and approved-shell.css, components/project/ProjectTable.vue and ProjectCards.vue, pages/projects/index.vue, composables/useProjects.ts, related tests, and nasq_pmo project-list controller/tests if server ordering needs it. A01,A03,A13.
- [x] Trace grid intrinsic sizing against audit geometry and preserve locally scrolling tables. Apply `grid-template-columns:minmax(0,1fr)` to page stacks and `min-width:0` where the grid child remains unconstrained.
- [x] On `(pointer:coarse)`, give compact action buttons a minimum 44px hit area without truncating labels or suppressing features; test the narrow shell after all patches.
- [x] Add a failing behavior test for `projectListQuery(false,{sort:'name'})` retaining sort, and sort-change resetting page offset. Server uses a fixed allowlist for ordering before limit/offset; progress ordering must match serialized progress semantics and avoid sorting only each page. Add an isolated API test with multiple pages. Do not bypass access/company domains.
- [x] Implement request ordering, remove page-only local ordering, retain query navigation. Run the focused tests, then integrated gates.

## Task 2: PMO forms, errors and keyboard behavior
- [x] Execute local:///tmp/nasq-impeccable-repair-20260907/pmo-brief.md. Ownership and exact issue locations are in the brief plus PMO audit appendix.
- [x] Root-cause check current code, add narrow failing behavior tests for editor flush/draft navigation and capped board states, implement minimal corrections, run focused tests.
- [x] Review actual diff against A04–A12 and A14, preserving A13/shared ownership.

## Task 3: HR responsive forms and list behavior
- [x] Execute local:///tmp/nasq-impeccable-repair-20260907/hr-brief.md.
- [x] Root-cause check; regression tests for first-page URL and query errors; implement A02, HR shares of A07/A09/A18, A15–A21; run narrow tests.
- [x] Review actual diff and confirm source-only deep-tree/large-picker cases in targeted browser fixture where possible.

## Task 4: Account/search/settings behavior
- [x] Execute local:///tmp/nasq-impeccable-repair-20260907/settings-brief.md.
- [x] Root-cause check; failing behavior regressions for editable shortcut target, pagination request/query, return path; implement A22–A27 plus assigned A09/A18; run focused tests.
- [x] Review actual diff against report and verify no permission-policy changes.

## Task 5: Aggregation and acceptance
- [x] Copy only reviewed owned working diffs into coordinator worktree without committing or merging branches. Preserve per-package patches and reports.
- [x] Run npm test, web typecheck, production build sequentially where generated state is shared. Run narrowly necessary backend sort tests on scratch DB if changed.
- [x] Run browser checks against current matching frontend/backend: five viewport sizes, primary loaded routes including current chat layout, error/long-data states, Arabic/English and light/dark spot checks; capture projects at390 and desktop in one batched visual round and at most one confirmation round after repairs.
- [x] Independent Astra review of aggregate diff and issue closure mapping; resolve actionable findings and rerun covering checks only.
- [x] Write delivery report with fresh evidence, remaining real-device limits and exact uncommitted branch/runtime state. Do not claim production delivery.

## Final evidence and bounded deviations
All source packages and review findings are resolved; details and evidence: /Users/tariq/code/nasq-audit-20260907/REPAIRS.md. Browser geometry covers five widths and Arabic light/dark. English verification was static/source-test only; desktop screenshot capture was unreliable, DOM geometry retained. Generic SSR hydration warnings and physical-device/cross-engine validation remain explicitly outside completion claims. Final functional HR query correction had no visual changes; covering type/build checks and three actual network confirmations passed. No commit, merge, push or deployment.
