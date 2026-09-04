# nasq

Project & task management product on Odoo 19 CE. See
`docs/superpowers/specs/2026-09-03-nasq-platform-design.md`.

## Dev

    # Odoo (engine + vendor console)
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf --dev=all
    # Product UI
    cd ~/code/nasq && npm install && npm run dev      # http://localhost:3000

Real-time task updates connect over `/websocket`. The Nitro dev proxy does
not upgrade websockets, so in dev `useBus()` connects straight to Odoo's
`ws://localhost:8069/websocket` (`runtimeConfig.public.wsUrl`, overridable
with `NUXT_PUBLIC_WS_URL`); in prod it's same-origin, routed through Caddy.

## Phase 1

Phase 1 ("my tasks") shipped on the `phase-1` branch:

- **My tasks table** (`/tasks`) — open/closed tabs, project/state filters, title
  search, sort, pagination ("load more"), inline stage/priority edits, a
  closed-specific empty state.
- **Board view** (`/tasks?tab=board`) — drag-and-drop between personal stages,
  folded stages past a card-count threshold, and a keyboard fallback (a
  per-card "…" menu with "move to…") for moving cards without a mouse drag.
- **Task detail** at a real route, `/tasks/{id}` — a large two-column modal
  (full-screen below `md`) with header, details column (assignees, deadline,
  priority, tags, allocated hours, personal stage, description editor,
  sub-tasks, dependencies, attachments, duration metrics) and an activity
  column; `J`/`K` (and prev/next buttons) step through the list without
  closing the modal. Nested layers (e.g. the deadline date picker) open
  inside the modal and dismiss on their own without closing it.
- **Activity timeline** — comments (sanitised HTML) interleaved with Odoo
  tracking entries (state/field changes), a composer that posts inline.
- **Real-time** — task and comment changes from another session arrive over
  the Odoo bus (`useBus()`, partner channels) and update the table/board/modal
  live, no reload, no `ir.websocket` override.
- **Auth** — session login plus a TOTP step when MFA is enabled
  (`/api/auth/totp`), CSRF-protected auth endpoints.
- **i18n** — Arabic default, RTL layout; nav labels are `nav.*` keys resolved
  by `useNav()` per role.

See `docs/superpowers/specs/2026-09-04-nasq-phase-1-my-tasks-design.md` for
the full design and `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`
for where phase 1 sits in the four-pillar platform.

## Layout

Ownership rule: shared plumbing lives in `nasq_api`, each pillar lives in its
own addon, and each pillar owns its own locale namespace and contract
namespace — so two pillar teams never write the same file.

- `apps/web` — Nuxt 4 product UI. Messages are per-pillar namespace files,
  `i18n/locales/<locale>/{common,tasks}.json`, merged by `@nuxtjs/i18n`'s
  per-locale `files: [...]` (key paths are flat: `$t('tasks.state.done')`).
- `packages/contracts` — zod schemas shared with the UI: `src/common/`
  (branding, error envelope, me) and `src/pmo/` (state, task, timeline,
  personal stage), each with its own `index.ts`; `src/index.ts` re-exports
  them, so consumers keep importing from `@nasq/contracts`.
- `odoo-addons`
  - `nasq_core` — groups and branding defaults.
  - `nasq_api` — shared `/api/v1` plumbing only: `controllers/common.py`
    (`ApiError`, `api_handler`, `get_record`, `parse_nonneg_int`),
    `auth`/`branding`/`me`, the company/user serializers and `iso()`, and the
    `NasqApiCase` test fixture the pillars subclass. It never imports a pillar.
  - `nasq_pmo` — the project pillar: the task/timeline/personal-stage/project/
    people endpoints, their serializers, the `project.task` transition hooks
    and bus notifier, and their tests.
  - `web_theme_shadcn` — vendor console theme.
- `deploy` — per-customer docker-compose + provisioning

A second team working a second pillar: see `docs/parallel-work.md`.

## Patched generated files

shadcn-vue copies components into the repo, so these hand-edits are lost on a
regenerate — re-apply after `npx shadcn-vue add … --overwrite`:

- `apps/web/app/components/ui/sidebar/SidebarProvider.vue` — `useMediaQuery(…, { ssrWidth: 1024 })` so the mobile branch does not mismatch during hydration.
- `apps/web/app/components/ui/sidebar/index.ts` — `text-left` → `text-start` in `sidebarMenuButtonVariants` (RTL).
- `apps/web/app/components/ui/command/CommandShortcut.vue` — `ml-auto` → `ms-auto` (RTL).
- `apps/web/app/components/ui/calendar/Calendar.vue` — `pl-2`/`pr-6` → `ps-2`/`pe-6`, and the native-select icon override `right-1` → `end-1` (RTL).
- `apps/web/app/components/ui/native-select/NativeSelect.vue` — `pr-9` → `pe-9` and the chevron's `right-3.5` → `end-3.5` (RTL; the Calendar override above only works if the base is logical too).
- `apps/web/app/components/ui/dropdown-menu/DropdownMenuCheckboxItem.vue` — `pr-2 pl-8` → `pe-2 ps-8` and the indicator's `absolute left-2` → `absolute start-2` (RTL).
- `apps/web/app/components/ui/dialog/DialogHeader.vue` — `sm:text-left` → `sm:text-start` (RTL).
- `apps/web/app/components/ui/dialog/DialogContent.vue` — the close button's `right-4` → `end-4` (RTL).

## SSR hydration and interactive controls

Nuxt SSR renders interactive controls (reka-ui Tabs, buttons with attached
listeners, …) as visible, clickable markup before the client has hydrated
and attached their event listeners — a click made in that window lands on
the DOM node but is silently dropped since nothing is listening yet. Measured
in dev on `/login` and `/tasks`, this window is on the order of 100–200ms
(a production build is faster, but not zero).

Ruling: gate any control whose first interaction must not be lost on
`useHydrated()` (`apps/web/app/composables/useHydrated.ts`) — `:disabled="!hydrated"`
until the component has hydrated. This replaced login.vue's phase-0
per-component `mounted` workaround and now also gates every interactive
control in `TaskToolbar.vue`, the `/tasks` table/board tabs, the ⌘K button,
the account menu trigger, and the table row/StateMenu/PrioritySelect/"load
more" controls in `TaskTable.vue`. Do not re-introduce a per-component
`mounted`/`onMounted` flag for this purpose; use the shared composable.
`ssr: false` for the whole authenticated app was considered and rejected —
it would trade the fast SSR first paint (the product's whole premise) for a
client-only blank/spinner load on every navigation, for a problem the
composable already solves without that cost.

`hydration.spec.ts`'s tests assert the disabled → enabled transition and
only click afterward, rather than racing a click immediately on page load.
That's deliberate, not a gap: a disabled element cannot receive a real
click, so under this gate an unguarded pre-hydration click is structurally
impossible to provoke — the disabled → enabled → click sequence is the
actual contract being protected, and is what these tests prove.

## Tests

    # Odoo addons (fresh scratch DB) — 0 failed, 0 error(s) of 57 tests
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core,nasq_api,nasq_pmo --test-tags /nasq_core,/nasq_api,/nasq_pmo
    # tip: if a dev server already holds :8069, add --http-port=8169 to the command above
    # lint
    ruff check odoo-addons deploy/seed_branding.py     # clean
    npm -w apps/web run lint                           # vue-tsc --build --noEmit, 0 errors
    # contracts + web unit — 15 + 118 = 133 tests passing
    npm test
    # e2e (needs Odoo on :8069 with nasq_core, nasq_api and nasq_pmo installed and `npm run dev` on :3000) — 25 passed
    cd apps/web && npm run test:e2e
