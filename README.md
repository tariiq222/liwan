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

## Tests

    # Odoo addons (fresh scratch DB)
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core,nasq_api --test-tags /nasq_core,/nasq_api
    # tip: if a dev server already holds :8069, add --http-port=8169 to the command above
    # contracts + web unit
    npm test
    # e2e (needs Odoo on :8069 with nasq_api installed and `npm run dev` on :3000)
    cd apps/web && npm run test:e2e
