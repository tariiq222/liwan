# nasq

Project & task management product on Odoo 19 CE. See
`docs/superpowers/specs/2026-09-03-nasq-platform-design.md`.

## Dev

    # Odoo (engine + vendor console)
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf --dev=all
    # Product UI
    cd ~/code/nasq && npm install && npm run dev      # http://localhost:3000

## Layout

- `apps/web` — Nuxt 4 product UI
- `packages/contracts` — zod schemas shared with the UI
- `odoo-addons` — `nasq_core`, `nasq_api`, `web_theme_shadcn`
- `deploy` — per-customer docker-compose + provisioning
