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

## Layout

- `apps/web` — Nuxt 4 product UI
- `packages/contracts` — zod schemas shared with the UI
- `odoo-addons` — `nasq_core`, `nasq_api`, `web_theme_shadcn`
- `deploy` — per-customer docker-compose + provisioning

## Patched generated files

shadcn-vue copies components into the repo, so these hand-edits are lost on a
regenerate — re-apply after `npx shadcn-vue add … --overwrite`:

- `apps/web/app/components/ui/sidebar/SidebarProvider.vue` — `useMediaQuery(…, { ssrWidth: 1024 })` so the mobile branch does not mismatch during hydration.
- `apps/web/app/components/ui/sidebar/index.ts` — `text-left` → `text-start` in `sidebarMenuButtonVariants` (RTL).
- `apps/web/app/components/ui/command/CommandShortcut.vue` — `ml-auto` → `ms-auto` (RTL).

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

    # Odoo addons (fresh scratch DB)
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core,nasq_api --test-tags /nasq_core,/nasq_api
    # tip: if a dev server already holds :8069, add --http-port=8169 to the command above
    # contracts + web unit
    npm test
    # e2e (needs Odoo on :8069 with nasq_api installed and `npm run dev` on :3000)
    cd apps/web && npm run test:e2e
