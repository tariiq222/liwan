# CLAUDE.md — nasq

nasq (نَسَق) is a resellable project & task management product built on Odoo 19 CE:
Odoo is the engine, `apps/web` (Nuxt 4) is the only UI customers ever see. Each customer
gets an independent deployment (own server, own DB, own Odoo, own frontend). There is
deliberately **no tenant layer**. Erada is customer #1, not the scope; customer-specific
logic lives in a `customer_<name>_*` overlay addon, never in core. Full design:
`docs/superpowers/specs/2026-09-03-nasq-platform-design.md`.

## Layout

- `odoo-addons/` — `nasq_core` (groups, company branding fields, seed data), `nasq_api`
  (shared `/api/v1` plumbing only: `controllers/{common,auth,branding,me}.py`,
  `serializers/{common,company,user}.py`, and the `NasqApiCase` test fixture the pillars
  subclass — it never imports a pillar), `nasq_pmo` (the project pillar:
  `controllers/{tasks,timeline,personal_stages,projects,people}.py`,
  `serializers/{task,timeline}.py`, `models/project_task.py` holding the transition hooks
  and bus notifier, the `NasqPmoCase` task/timeline/stage API tests plus `TransactionCase`
  transition/bus tests), `web_theme_shadcn`
  (vendor console theme). Ownership rule between pillars: `docs/parallel-work.md`.
- `packages/contracts` — zod schemas mirroring every wire shape (`@nasq/contracts`), split
  per pillar: `src/common/` (branding, error envelope, me), `src/pmo/` (state, task,
  timeline, personal stage), each with its own `index.ts` re-exported from `src/index.ts`.
- `apps/web` — Nuxt 4 / Vue 3.5 / Tailwind v4 / shadcn-vue (reka-ui) / `@tanstack/vue-query`
  / `@nuxtjs/i18n` / Vitest / Playwright.
- `deploy/` — per-customer docker-compose, Caddyfile, `provision.sh`, `seed_branding.py`.
- `docs/superpowers/{specs,plans}` — one spec + one plan per phase.

The Odoo checkout is `/Users/tariq/code/odoo` (branch 19.0, tracks upstream, its own
CLAUDE.md covers the framework). **Never modify it and never run `git` there.** Its
`odoo.conf` already has `~/code/nasq/odoo-addons` on `addons_path`.

## Workflow

One branch per phase (`phase-N`) from `main`; spec → `superpowers:writing-plans` →
`superpowers:subagent-driven-development` → `superpowers:finishing-a-development-branch`;
fast-forward merge + tag `v0.<N+1>.0-phaseN` (e.g. `v0.2.0-phase1`). Commit messages: `[ADD]|[IMP]|[FIX] <scope>: <summary>`
with trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. One commit per task.

Project skills in `.claude/skills/` (`/nasq-api-endpoint`, `/nasq-odoo-test`,
`/nasq-dev-servers`) hold the step-by-step recipes; the rules below are the constraints
they obey.

## Odoo addons — rules

- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`
  Manifests: `'license': 'LGPL-3'`, `'version': '19.0.1.0.0'`, `'author': 'Tariq Alwalidi'`.
- No OCA, no Enterprise dependencies. `ruff check odoo-addons` must be clean (`ruff.toml` = Odoo's).
- API routes: `@http.route('/api/v1/...', type='json2', auth='user', methods=[...], readonly=<bool>)`
  wrapped in `@api_handler` (`nasq_api/controllers/common.py`). Errors are
  `{"code": "<snake_case>", "message": "<human>", "field"?: "<name>"}` with a real HTTP status
  (403 `forbidden`/`transition_forbidden`, 404 `not_found`, 422 `invalid`).
  Never `type='http'` for JSON, never `auth='bearer'` for browser traffic, never `sudo()` to
  dodge an access error — fix the group/rule instead.
- Serializers whitelist fields explicitly (`nasq_api/serializers/*.py` for shared shapes,
  `nasq_pmo/serializers/*.py` for task/timeline); never `read()` a record straight onto the
  wire. Every write returns the full detail shape.
- Task state names on the wire: `in_progress | changes_requested | approved | waiting | done | cancelled`
  ↔ Odoo `01_in_progress | 02_changes_requested | 03_approved | 04_waiting_normal | 1_done | 1_canceled`.
  Transition rule lives in `nasq_pmo`: employees may set `in_progress`, `waiting`, `done`,
  `cancelled` on tasks they can write; `approved` and `changes_requested` need
  `project.group_project_manager` or `nasq_core.group_customer_admin` → HTTP 403 `transition_forbidden`.
- Roles: `nasq_core.group_employee` (Nuxt only), `nasq_core.group_customer_admin` (Nuxt +
  Settings), vendor support = `nasq_core.group_vendor_support` (implies `base.group_system`, full Odoo). Nobody at the customer opens Odoo.
- Bus: task create/write notifies assignees' partner channels; the web app invalidates
  vue-query caches on those events.
- Branding source of truth is the DB (`res.company` + nasq fields); `deploy/branding.json`
  only seeds it. `GET /api/v1/branding` is public + cached.

## Tests

- Odoo (run from `/Users/tariq/code/odoo`, throwaway DB `nasq_test`, never `odoo19`), always
  `-i` on a fresh DB, never `-u` on an old one (`docs/parallel-work.md`): `-i` proves each
  addon's manifest `depends` are real instead of the install riding on whatever the other
  pillar already pulled in:
  `.venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core,nasq_pmo,nasq_api --test-tags /nasq_core,/nasq_pmo,/nasq_api --http-port=8169`
  (timeout 300000 ms). API tests extend `NasqApiCase` (shared — `nasq_api/tests/common.py`,
  an `HttpCase` with `self.api(method, path, json)`) or `NasqPmoCase` (PMO — it subclasses
  `NasqApiCase` and adds the project/task fixtures). Every `test_*.py` must be imported from
  `tests/__init__.py`.
- Load Python/data changes into the dev DB: `-d odoo19 -u <addon> --no-http --stop-after-init`.
- Contracts + web unit: `npm test` (repo root). E2E: `cd apps/web && npm run test:e2e`
  (needs Odoo :8069 with nasq addons installed and Nuxt :3000). Login `admin`/`admin`.
  Tests needing an employee user create one through Odoo, never through the UI.
- Zod schemas in `packages/contracts` get a schema test **and** a live contract e2e test
  against the real endpoint.

## Frontend — rules

- Arabic default (`ar`), English secondary, `@nuxtjs/i18n` strategy `no_prefix`; every
  user-facing string via `$t()`/`t()` in per-pillar namespace files under
  `apps/web/i18n/locales/{ar,en}/{common,tasks}.json` (key paths are flat after the merge).
- RTL-first: Tailwind logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`,
  `text-start`), never `ml-`/`pl-`/`left-`. Design tokens are fixed; do not add colours.
- shadcn-vue components are generated into `apps/web/app/components/ui/` and some are
  hand-patched (list in `README.md`); re-apply patches after `--overwrite`.
- Data layer is `@tanstack/vue-query` composables in `app/composables/` over a single
  `useApi()` fetch wrapper that throws `ApiError {status, code, message, field}`.
  Plain field edits are optimistic; state transitions/approvals are pending → server →
  confirmed. The client replaces its cache with whatever the server returns.
- Task detail is a large two-column modal (`Dialog`, `TaskDetailModal.vue`) at `/tasks/{id}`, not a full page. Status badge
  vocabulary: قيد التنفيذ · تعديلات مطلوبة · معتمد · بانتظار · منجز · ملغى.
- Same-origin topology behind a reverse proxy: Nuxt at `/`, Odoo at `/api/v1`, `/web/content`,
  `/websocket`, vendor console at `/odoo`. Session cookie only, no CORS, no bearer tokens.

## Machine quirks

- Dev servers: Odoo `:8069` (`--dev=all` from the Odoo checkout), Nuxt `:3000` (`npm run dev`
  from repo root). Restart Nuxt after `nuxt.config.ts`/`server/` changes or after adding a
  shadcn component dir — use `/nasq-dev-servers`.
- The global `~/.npmrc` is malformed: always `npm install --ignore-scripts`, and run
  `npx shadcn-vue@latest …` with `npm_config_userconfig=/tmp/empty.npmrc` (create the empty
  file). Never edit `~/.npmrc`.
- Semantic code search over Odoo core + installed addons + nasq addons: the `semtree` MCP
  server (`search_code` / `get_context`); resync with `~/code/odoo/semtree-sync.sh` after
  installing addons.
