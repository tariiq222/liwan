# Approved layout and Projects implementation plan

**Goal:** Apply the user-approved reference to the actual Nuxt application.
**Architecture:** One shared app shell owns module rail, contextual navigation and theme tokens. Existing route-backed project screens retain data contracts and compose shared page recipes.
**Tech stack:** Nuxt 4, Vue 3, Tailwind, existing shared components and Vue Query.
**Spec:** DESIGN.md, approved 2026-09-07 header reference.

## Constraints
- Existing approved design needs no second design approval.
- No API, DB or stock Odoo source changes. Never test on odoo19.
- Preserve capabilities, route/query state, hydration, RTL/LTR and three appearance modes.
- One writer per file. Workers do not run runtime/build/test commands; coordinator owns integration and final checks.
- No commits, merges or cleanup by workers.

## Parallel batch
- [ ] Shell: default layout, AppSidebar, module routing, shared page title, CSS/token ownership, common locale labels. Owns the sole six-section contextual menu.
- [ ] Projects: list/new/parent page and root project components except charter/settings forms; projects locales. Removes duplicated section tabs, keeps local task views and legacy query URLs.
- [ ] Details: every nested project route and finance/governance/schedule/templates components plus charter/settings forms. Preserves direct links, forms, states and actions.

Shared contract: Existing URLs and component props remain stable. Parent renders child NuxtPage; no second global shell. Project context classifies overview/updates, tasks/milestones/schedule, stakeholders/raci, register, finance, charter, with settings separate. Missing labels/components are coordinated through the owning writer.

## Coordinator verification
- [ ] Review diffs against ownership and inventory every project route.
- [ ] Integrate uncommitted source diffs into the isolated integration worktree.
- [ ] Run npm test, web typecheck and production build sequentially after generated preparation.
- [ ] Repair failures and independently review changes.
- [ ] Use isolated runtime/database for browser verification: 390/768/1440, Arabic/English, light/cream/dark, primary color matching, rail hover/focus/expand, module context, routes/back/filters.
- [ ] Record screenshots and exact limits; update catalog and replacement ledger only for implemented changes.
- [ ] Present actual runtime result and Git state without claiming unverified deployment.
