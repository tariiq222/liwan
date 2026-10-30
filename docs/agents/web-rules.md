# Web rules

Layer-specific rules for `apps/web`. Presentation follows DESIGN.md; architecture rules R1-R10
and contracts are in `AGENTS.md`.

## Frontend and machine rules

- Arabic is default (`ar`), English is secondary, and i18n uses `no_prefix`.
  Every user-facing string uses `$t()`/`t()` in the owning per-pillar file
  under `apps/web/i18n/locales/{ar,en}`. A pillar's `nav.*` label is the
  deliberate shared `common.json` exception. HR owns `hr.json` and the `/hr`
  page; PMO owns `tasks.json`, `projects.json`, `settings.json`, and the
  unchanged user-id people picker.
- RTL styling uses logical Tailwind properties only (`ms-`, `me-`, `ps-`,
  `pe-`, `start-`, `end-`, `text-start`), never physical `ml-`, `pl-`, or
  `left-` classes. Keep the shared tokens owned by `packages/ui/app/assets/css/`
  and configure Nuxt UI primitives through `packages/ui/app/app.config.ts`.
- Authenticated interactive controls whose first click must not be lost during
  SSR hydration use the shared `useHydrated()` composable and stay disabled
  until hydrated. Do not replace this with per-component `mounted` flags or
  make the whole authenticated app client-only. Hydration tests assert the
  disabled-to-enabled transition before clicking.
- Storybook (`npm -w apps/web run storybook`, `apps/web/stories/**`) is the
  mandatory component catalog for every agent: reuse the story component; a
  shared component ships with its story and is listed in `STORYBOOK_COMPONENTS`
  (`tools/ui_policy.py`) before a second page uses it. No local copy of a
  component that has a story.
- Component folders: `components/pmo/projects` and `components/pmo/tasks` (PMO),
  `components/personal-tasks`. Presentational building blocks live in the `packages/ui`
  layer (`app/components/shared/{layout,data,form,feedback}` and `shell`); `apps/web`
  keeps only `components/shared/{data,form,commerce}` pieces that need app data.
  `nuxt.config.ts` registers them with an explicit `prefix`, so their names stay
  `Project*`, `Task*`, `MyTasks*` and `Shared*`; a new prefixed folder is added there
  and to `COMPONENT_PREFIXES` in `tools/ui_policy.py`.
- Nuxt UI components are the customer control surface. Preserve their RTL
  semantics, keyboard behavior and public props/slots; shared composite
  components are documented in `docs/design-system/components.md`.
- Contracts accept any well-formed capability key (`<app>.<resource>.<action>`),
  module id (`liwan_*`, `customer_*`) and permission domain; `KNOWN_CAPABILITIES`,
  `KNOWN_LIWAN_MODULE_IDS` and `KNOWN_PERMISSION_DOMAINS` keep today's values for
  typed code. On the client a capability's feature is `<first segment>.enabled`
  and it is a write unless its last segment is `read` (`app/modules/registry.ts`;
  exceptions are listed there). A bell kind the build does not know renders as a
  generic row; known kinds stay strict. An application declares its web surface
  (feature, route prefixes, rail entry, navigation, context links, landing paths,
  route capabilities, bell kinds, search providers) in
  `apps/web/app/modules/<app>/manifest.ts`; manifests and the per-pillar locale
  files under `apps/web/i18n/locales` are discovered automatically, so no
  foundation file lists an application.
- The data layer uses `@tanstack/vue-query` composables over `useApi()`, which
  throws `ApiError {status, code, message, field}`. Plain edits may be
  optimistic; transitions and approvals remain pending until the server
  confirms them. Replace cache entries with the server response.
- The topology is same-origin behind a reverse proxy: Nuxt `/`, Odoo
  `/api/v1` (attachments download from `.../attachments/<id>/download`) and `/websocket`. Session cookies are used; no CORS or bearer tokens for browser flows.

- `apps/vendor-admin` is the vendor staff console, a separate Nuxt application served on its own `admin` host. It follows
  DESIGN.md and uses the same layers as `apps/web` (`@liwan/ui`, plus `@liwan/commercial-ui` for the shared billing
  presentation); there is no `/vendor` page prefix. Its server routes are a BFF that signs calls to the control plane
  with `@liwan/commercial-contracts` and overwrites `x-liwan-client-ip`. It imports nothing from `apps/web`, `odoo-addons`,
  `@liwan/contracts` or the control plane and calls no Odoo route, and `apps/web` never imports it (hard rule `VA1` in
  `tools/arch_policy.py`, never baselined). See `apps/vendor-admin/README.md`.
