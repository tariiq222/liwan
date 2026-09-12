> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Projects tabs and popups implementation plan

Goal: shorten project workflows with direct workspace tabs and one route-backed dialog.
Architecture: central project-only route presentation host reuses existing Nuxt pages; tabs and compact forms preserve existing APIs.
Tech stack: Nuxt 4, Vue 3, vue-router, Reka/shadcn, TanStack Query.
Spec: docs/archive/ui/superpowers/specs/2026-09-09-project-tabs-popups-design.md

Global constraints: approved project popup override; other modules unchanged; no commits/merges/deploy/cleanup; preserve company and record capabilities; no tests on odoo19; workers own disjoint files and no broad validation.

- [ ] Host: app.vue, components/project/workspace/ProjectRouteHost.vue, utils/projectOverlayRoute.ts and tests, shared UnsavedChanges only as necessary. Route matcher distinguishes workspace from workflows, sanitizes background return, supports standalone option. Tests reject foreign return destinations and preserve project query context. Browser tests exercise mounted background, close/back/reload, nested replacement, and dirty guards.
- [ ] Tabs: pages/projects/[id].vue, pages/projects/index.vue, components/project/workspace/ProjectWorkspaceTabs.vue, useNav/useShellNavigation, ContextSidebar if needed and existing project section headers/view controls. Direct tabs use current URLs; suppress workspace frame via Symbol.for('nasq.project.overlay') in modal branch. New tests cover active tab and query preservation. All/My stays URL-backed. Remove redundant project contextual navigation only, preserve other modules.
- [ ] Quick create: TaskCreateForm and taskCreatePolicy/tests, ProjectCharterFields/Form, projects/new and projects/[id]/tasks/new, project creation locales only via patch request to coordinator. Preserve APIs, dates, dirty checks. Use project-only compact prop; expose existing valid assignment/priority fields; optional fields collapsed. Project template entry from create.
- [ ] Integration: coordinator applies owned-file diffs, updates policy/docs and translations, reviews diff. Run npm test, web lint, build; mocked browser flow tests and visual at 390/768/1440. Review independently then repair any regressions. Deliver isolated preview and exact verification boundary.

Preflight: Host and Tabs share only overlay injection contract (fixed above); Host and Forms share existing routes, no imports; Tabs and Forms own distinct files. No two writers. Coordinator owns docs/translations and final checks. Approval already given in conversation; do not repeat skill approval/commit steps conflicting with user authorization boundaries.
