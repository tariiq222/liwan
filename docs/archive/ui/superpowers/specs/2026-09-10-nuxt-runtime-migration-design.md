> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Nuxt UI runtime migration: foundation and Projects

Approved intent: the user's 2026-09-10 request to start the proposed foundation + complete Projects migration, using Claude and Grok CLI subscriptions. DESIGN.md and the executable design-preview remain visual authority.

## Architecture
Adopt @nuxt/ui in the existing customer Nuxt application. Keep current routes, Vue Query composables, permissions, server response validation and Odoo business operations. Migrate shared presentation owners in place, preserving public props/events/slots so dependent pages do not need a second implementation. No fixture data or preview preference state enters runtime. useAppearance remains the sole appearance owner. Extend existing company branding with a validated secondary color and retain authorization and identity rejection.

## Scope
Foundation: Nuxt configuration, UApp, theme recipes, shared page/filter/state/unsaved controls, shell with mobile menu and existing capability-aware navigation. Projects: all /projects, /project-templates and /settings/projects surfaces and their project/task/shared dependencies. Standalone unrelated module bodies and chat remain later migration phases; shared foundation necessarily affects their frame.

Desktop and mobile follow the approved reference; mobile records use readable cards, mobile navigation uses a menu, sheets fill available mobile width. One route-backed record sheet preserves browser back, full page option, nested replacement, draft guards and URL filters. Preserve calculations, printing and unknown/error states.

## Ownership contracts
Coordinator owns config/manifests/lock, app.vue, theme CSS, brand contracts/backend/settings, shared components, test infrastructure and component catalog. Claude owns project pages and project components excluding workspace/ProjectRouteHost.vue and ProjectRouteModal.vue (coordinator). Grok owns shell components, AppSidebar.vue, default.vue and shell-only CSS in assets/css/nuxt-shell.css. A later bounded package owns task dependencies. No worker changes another package or runs global gates.

Use Nuxt UI U components directly. Preserve component APIs. Use exact existing translations, introducing namespace keys only if required. No generic primitive wrapper library. Standard shared names remain SharedPageHeader, SharedPageContainer, SharedFilterBar, SharedFormSection, SharedUnsavedChanges. SharedDateField will accept modelValue: string|null, disabled?:boolean, id?:string, ariaLabel?:string and emit update:modelValue string|null. Date values remain ISO dates without timezone conversion.

## Acceptance
Coordinator verifies source policy, contracts, web tests, typecheck/build, changed backend tests on a fresh scratch DB, and browser flows against isolated runtime. Test runtime U resolution, Arabic/English, 3 appearance modes, small/medium/large fonts, desktop/mobile, real save and re-read, permission failure, draft cancel/discard, query retention. Review all worker changes including tests. Existing behavioral regressions must remain; obsolete source-shape expectations may be updated only with replacement behavioral evidence. No commit/merge/deploy/cleanup authorization is inferred.

## CLI experiment
Record binary versions, subscription auth, actual model from machine output, effort/permission profile, touched files, unexpected actions, exit and artifacts. No API fallback or permission bypass. A unavailable Grok login may wait while other authorized work progresses. On failure terminate previous writer before handoff and preserve its diff. Report concrete workflow improvements; do not claim one run proves model superiority.
