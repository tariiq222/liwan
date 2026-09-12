# Nasq visual replacement implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Coordinator controls execution and all validation. Project/user rules override generic skill commit/test instructions.

**Goal:** Apply /Users/tariq/Downloads/nasq-ui visual language to every customer surface, remove superseded presentation sources, and preserve every current function exactly.
**Architecture:** Existing Nuxt UI primitives and behavior remain. One token layer and component configuration supplies the new design; shell geometry and page composition consume those same tokens. No backend, contract, route, state, validation, permission or data-source changes.
**Tech Stack:** Existing locked Nuxt 4/Vue 3/Nuxt UI 4/Tailwind 4, Vue Query, Unovis, Tiptap.
**Spec:** docs/superpowers/specs/2026-09-12-ui-redesign.md

## Global Constraints

- Design only. Every function, field, filter, action, permission, calculation, handler and workflow remains available and behaves identically. Rearrangement is allowed; removal/hiding/disabling is not.
- Keep route-backed sheets, full-page option, query/hash, draft guards, existing route URLs and auth/SSR hydration behavior.
- No new backend/product functionality from mock reference, no API/contracts/Odoo changes.
- Current primary/secondary company branding, light/cream/dark, font sizes, RTL/LTR, keyboard/reduced motion stay.
- Reference source is the Vue/CSS design in /Users/tariq/Downloads/nasq-ui, not its different static preview. Never import fixtures or prototype composables into runtime.
- Use U primitives directly and existing composite APIs. Preserve public props, emits, slots and data-testid hooks. No wrapper per button.
- CSS ownership: assets/css/main.css imports fonts/Tailwind/Nuxt and tokens.css, components.css, shell.css. tokens owns variables; components owns shared recipes; shell owns layout. app.config.ts owns primitive variants. Delete old four CSS files once their needed semantics are ported.
- Existing semantic nasq-* class/API names may remain when reused as the new implementation; obsolete visual rules and old-source names do not remain active. No redundant compatibility stylesheet.
- No dependency upgrades. Unify icon rendering onto UIcon with existing local iconify Lucide bundle; remove direct @lucide/vue only after zero imports.
- Shared ownership: Task 1 owns styles/config/shell/shared Vue; Task 2 docs/reference only; Tasks 3/4/5 own disjoint module pages/components; Task 6 coordinator-directed integration/checker/icon/chart work after them.
- Worktrees isolated, no commits/merges/pushes/deploys/branch or worktree deletion. Preserve canonical dirty state. Workers do not run build/lint/full tests or start runtime, and do not spawn agents. Root validates once per integrated batch.
- Use /Users/tariq/code/nasq-ui-redesign-artifacts/baseline/source for behavior comparison. Report every modified script/directive/action condition; preserve logic instead of rewriting.

## Task 1: Shared visual foundation

**Target/Files:** apps/web/app/assets/css/*.css, app/app.config.ts, app/layouts/default.vue, app/components/shared/*.vue, app/components/shell/*.vue, app/components/AppSidebar.vue, AppAccountMenu.vue, AppLogo.vue if present. Do not own DashboardChart.client.vue (Task 6). Own visual-only expectations in shared/shell unit tests; leave module tests to their owners.
**Change:** Recompose the 1099 lines of old CSS into one coherent reference implementation, removing overridden rules. Port layout/motion/accessibility/print behavior. Header light, rail dark, context white/cream/dark surface. Preserve rail/sidebar collapse and mobile navigation. Retain existing action hierarchy, filters and feature slots.
**Interfaces:** Existing components' props/emits/slots unchanged; semantic variables and nasq-ui recipes continue resolving but render new reference style.

- [ ] Inspect source reference main.css and all owned current files. Compare scripts to baseline, and list owned function hooks in report.
- [ ] Use exact reference neutral starting values, adapted to current appearance selectors and branding:
```css
:root { --nasq-surface-page: #f6f7fb; --nasq-surface: #fff; --nasq-surface-soft: #f8f9fc; --nasq-text: #171923; --nasq-muted: #717789; --nasq-border: #e5e8ef; --nasq-rail: #1d2030; --nasq-radius: 14px; }
```
- [ ] Implement tokens.css/components.css/shell.css; main imports only these plus required libraries/fonts. Keep brandTheme output interface and chart tokens; map presentation colors without editing brand calculations.
- [ ] Configure UCard rounded reference surfaces and subtle shadow, UButton compact 36px desktop/44px touch, unified fields/status/table/header; preserve readable scalable typography.
- [ ] Restyle shell and shared components without removing template hooks or changing script logic. Existing nav content and order may stay; do not introduce prototype-only links.
- [ ] Remove the four superseded CSS files; update imports and owned visual tests. Report external test/checker path references for Task 6.
- [ ] Self-review actual diff for removed functions, ensure every owned interface intact, report paths and concerns. No commit or validation commands.

## Task 2: Design policy and obsolete reference cleanup

**Target/Files:** DESIGN.md, CLAUDE.md frontend-specific old guidance only, AGENTS.md introduction only, apps/web/AGENTS.md, docs/design-system/**, docs/agents/frontend-theme.md, .claude/agents/odoo-reviewer.md UI guidance only, .claude/skills/nasq-dev-servers/* and shadcn-vue skill, .claude/skills/VENDORED.md, apps/web/design-preview/**. No other docs/superpowers, recovery docs or backend instructions.
**Change:** Replace visual policy with the approved reference and preservation contract. Remove superseded executable HTML, preview, obsolete design generators and old shadcn instructions. Keep product/security/test constraints and license notices needed for retained code. No blanket deletion of mixed product/history documents.
**Interfaces:** Document Task 1 CSS owners and existing component APIs; catalog runtime composites, not a second application. Keep the current plan/spec paths.

- [ ] Inventory exact old visual artifacts and incoming links before deletion.
- [ ] Write DESIGN.md with single visual authority and immutable feature behavior, reference dimensions/neutral tokens and module-complete component rules.
- [ ] Rewrite component catalog to actual runtime owners, new shared styles and charts path planned in Task 6.
- [ ] Delete old preview/HTML-only sources and obsolete shadcn-add script/skill where scoped; prune inbound visual-reference links in owned docs.
- [ ] Produce deletion/retention report and list remaining test/tool references for Task 6. No tests or commits.

## Task 3: Projects, tasks and templates

**Target/Files:** app/pages/projects/**, app/pages/project-templates/**, app/pages/tasks/**, app/pages/tasks.vue; app/components/project/**, app/components/task/**, except shared work on charts and frozen ProjectRouteHost/ProjectRouteModal scripts. Own respective module unit tests only.
**Change:** All module surfaces consume new recipes; reference card/table/Kanban/detail hierarchy. Keep every field/action/metric, including finance empty states and exact calculations. Keep project tabs and all section entries unless only reordering within existing render owner. No useNav/shared CSS edits.
**Interfaces:** Task 1 shared props/classes unchanged. Existing handlers, table columns, conditionals, forms and route hosts preserved.

- [ ] List every owned page and component, its fields/actions/conditions; classify unchanged files that inherit shared styling versus files needing template composition.
- [ ] Apply coherent reference card/table/detail/toolbar spacing with existing U primitives and shared components. Example semantic grouping:
```vue
<SharedPageContainer width="list">
  <SharedPageHeader :title="title"><template #actions><!-- retain original action nodes --></template></SharedPageHeader>
  <section class="nasq-ui-record-surface"><!-- retain original data view and bindings --></section>
</SharedPageContainer>
```
- [ ] Preserve full original scripts except presentation-only icon imports and necessary template-related types; never replace a whole workflow with reference mock markup.
- [ ] Update owned visual-only assertions, retain behavioral assertions, write report with every page coverage and any directive/script deltas.

## Task 4: Meetings, chat and notifications

**Target/Files:** app/pages/meetings/**, app/pages/chat/**, app/pages/notifications.vue, app/pages/notification-digests/**; app/components/meeting/**, meetings/** if present, chat/**, notifications/**; owning unit tests. Do not edit shared ContextSidebar.
**Change:** Apply same table/card/detail/control design to these units while retaining all recurrence, attendance, decisions, print, realtime, attachments, message actions, preview and notification behaviors.
**Interfaces:** Same frozen shared contracts as Task 3; no API/composable/query changes.

- [ ] Inventory owned pages and all actions/fields, including print and mobile-specific render branches.
- [ ] Apply reference visual hierarchy through U components and shared recipes; chat CSS may define conversation geometry, not its own control theme.
- [ ] Keep message content, pending states, scrolling, polling/realtime, menus, keyboard and file behavior exactly.
- [ ] Update only owned visual assertions and record coverage/script/directive deltas. No tests or commits.

## Task 5: HR, settings, account, login and general pages

**Target/Files:** app/pages/hr/**, settings/**, account.vue, login.vue, index.vue, search.vue, reports.vue, odoo.vue when present; app/components/hr/**, access/**, settings/**, account/**, GlobalSearch.vue; owning unit tests. Do not edit shared ShellHeader or AppAccountMenu.
**Change:** Same reference design for every page while keeping employee/account separation, permissions, field validation, display preferences, branding, search, redirects, login and error flows intact.
**Interfaces:** Same frozen shared props/classes; no new auth/API behaviors.

- [ ] Inventory every owned source and conditional field/action.
- [ ] Restyle list/detail/forms/login with same reference primitives and spacing. Keep identity and all account options, appearance modes and font controls.
- [ ] Keep all scripts and query handling, API handlers, form model and navigation logic.
- [ ] Update visual assertions only; report page coverage and function preservation evidence.

## Task 6: Integration, specialization cleanup and acceptance

**Target/Files:** root-owned tools/ui_policy.py, tools/ui_inventory.py, tools/test_ui_policy.py, package manifests/lockfile, apps/web/nuxt.config.ts, components/ui/chart/** -> components/charts/**, DashboardChart.client.vue, lib/utils.ts when dependencies permit, remaining icon consumers, useNav.ts icon representation only if necessary, e2e UI reference assertions. No backend/contracts edits.
**Change:** Consolidate isolated patches with explicit path ownership. Re-anchor checks to new owners, eliminate legacy exclusions and direct duplicate icon package only after migrating every consumer. Preserve meaningful behavioral tests and strict scope guards.

- [ ] Compare canonical hashes against initial snapshot; root remains unchanged. Compare integration scripts/directives/backend/contracts/routes against baseline and review all deltas.
- [ ] Move/adapt actual Unovis chart behavior into dedicated chart components, update consumers/tests, delete old UI folder.
- [ ] Migrate remaining Lucide components to local UIcon consistently, then remove unused direct dependencies using lockfile-only maintenance without upgrading versions.
- [ ] Update source policy to fail on superseded CSS/preview/UI tree runtime usage and mock imports. Keep exceptions for native hidden file inputs and specialist libraries.
- [ ] Run baseline/final meaningful checks; first diagnostics identify expected old visual-policy failures. Root runs `npm test`, `npm -w apps/web run lint`, `npm run build` once per integrated batch; diagnose any failure against saved baseline.
- [ ] Launch isolated Odoo database/runtime and web runtime, never test odoo19. Verify existing functional E2E and all-page routes, modes/directions and 390/768/1440 views with actual screenshot inspection. Record scope of real versus mocked tests distinctly.
- [ ] Independent Astra review gets final diff and baseline preservation evidence. Fix regressions through Luna and rerun only necessary checks.
- [ ] Deliver source worktree, new runtime preview, deletion inventory, page coverage and exact verification. Leave commits/integration into main and deployment for their separate authorization.
