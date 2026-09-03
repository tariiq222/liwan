# nasq Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the nasq monorepo with a working vertical slice — a customer-branded Nuxt login → shell (sidebar, ⌘K) backed by two Odoo endpoints (`/api/v1/branding`, `/api/v1/me`) — plus the deployment skeleton, and purge the AGPL OCA modules from the dev database.

**Architecture:** Nuxt 4 app at `apps/web` proxies `/api/v1/**` and `/web/**` to Odoo (dev) — in production Caddy routes those paths to Odoo directly, so the browser always talks to one origin and Odoo's `session_id` cookie is the only auth. Odoo addons `nasq_core` (groups, branding defaults) and `nasq_api` (`type='json2'`, `auth='user'` routes + serializers) live in `odoo-addons/`. `packages/contracts` holds zod schemas that are the frontend's contract and are validated against the serializers in tests.

**Tech Stack:** Odoo 19.0 CE (Python 3.12, PostgreSQL 16), Nuxt 4 / Vue 3 / TypeScript, Tailwind v4, shadcn-vue (reka-ui), @tanstack/vue-query, zod, Vitest, Playwright, Docker Compose + Caddy.

**Spec:** `docs/superpowers/specs/2026-09-03-nasq-platform-design.md`

## Global Constraints

- Odoo checkout `/Users/tariq/code/odoo` is never modified; only `odoo.conf` (untracked) changes. All server code lives in `/Users/tariq/code/nasq/odoo-addons/`.
- Odoo run commands execute from `/Users/tariq/code/odoo` with `.venv/bin/python odoo-bin ... -c odoo.conf`. Test DB is `nasq_test`, never `odoo19`.
- Every Python file starts with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; every addon manifest declares `'license': 'LGPL-3'`, `'version': '19.0.1.0.0'`, `'author': 'Tariq Alwalidi'`.
- API routes: `@http.route('/api/v1/...', type='json2', auth='user'|'public', methods=[...], readonly=<bool>)`. Never `type='http'` for JSON, never `auth='bearer'` for browser traffic.
- Error body shape: `{"code": "<snake_case>", "message": "<human>"}` with a real HTTP status.
- Frontend: Arabic default, `<html lang="ar" dir="rtl">`, Tailwind logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`, never `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`).
- Tokens: zinc palette, `--radius: 0.5rem`, font `IBM Plex Sans Arabic`; the customer's `primary_color` from the DB overrides `--primary` at runtime.
- Commit messages follow Odoo style `[ADD]|[IMP]|[FIX] <scope>: <summary>` and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Node 26 / npm 11 are on PATH; use npm workspaces (no pnpm/yarn).
- Nothing here may depend on any OCA module or on Odoo Enterprise.

## File Structure

```
nasq/
├── package.json                      npm workspaces: apps/*, packages/*
├── .gitignore
├── README.md
├── apps/web/                         Nuxt 4 app
│   ├── nuxt.config.ts                modules, proxy routeRules, htmlAttrs, runtimeConfig
│   ├── components.json               shadcn-vue config (zinc, css variables, rtl)
│   ├── app/app.vue                   ConfigProvider dir=rtl + NuxtLayout
│   ├── app/assets/css/main.css       tailwind import, tokens, @font-face
│   ├── app/lib/utils.ts              cn()
│   ├── app/components/ui/**          shadcn-vue generated (owned)
│   ├── app/components/AppSidebar.vue nav + settings link by role
│   ├── app/components/CommandMenu.vue ⌘K
│   ├── app/composables/useMe.ts      GET /api/v1/me (cookie-forwarded)
│   ├── app/composables/useBranding.ts GET /api/v1/branding → CSS vars + title
│   ├── app/middleware/auth.global.ts redirect to /login when /me is 403
│   ├── app/layouts/default.vue       SidebarProvider + AppSidebar + CommandMenu + slot
│   ├── app/pages/login.vue           branded login form
│   ├── app/pages/index.vue           "اليوم" greeting
│   ├── app/pages/{tasks,projects,people,reports}.vue   heading-only stubs (phase 1–3 fill them)
│   ├── server/api/auth/login.post.ts  → /web/session/authenticate, forwards Set-Cookie
│   ├── server/api/auth/logout.post.ts → /web/session/destroy
│   ├── e2e/login.spec.ts             Playwright
│   └── playwright.config.ts
├── packages/contracts/               zod schemas (@nasq/contracts)
│   ├── package.json · tsconfig.json · vitest.config.ts
│   ├── src/index.ts · src/branding.ts · src/me.ts
│   └── src/__tests__/schemas.test.ts
├── odoo-addons/
│   ├── nasq_core/
│   │   ├── __init__.py · __manifest__.py
│   │   ├── security/nasq_core_security.xml   privilege + 3 groups
│   │   ├── models/__init__.py · models/res_company.py   font selection_add
│   │   ├── data/res_company_data.xml          main company defaults
│   │   └── tests/__init__.py · tests/test_groups.py
│   ├── nasq_api/
│   │   ├── __init__.py · __manifest__.py
│   │   ├── controllers/__init__.py · branding.py · me.py
│   │   ├── serializers/__init__.py · company.py · user.py
│   │   └── tests/__init__.py · tests/test_branding.py · tests/test_me.py
│   └── web_theme_shadcn/                      moved from ~/code/odoo-addons
├── deploy/
│   ├── docker-compose.yml · Caddyfile · .env.example
│   ├── branding.example.json · provision.sh · seed_branding.py
└── docs/superpowers/{specs,plans}/
```

---

### Task 1: Monorepo scaffold, theme move, addons_path

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`
- Move: `/Users/tariq/code/odoo-addons/web_theme_shadcn` → `odoo-addons/web_theme_shadcn`
- Move: `/Users/tariq/code/odoo-addons/docs/superpowers/{specs,plans}/2026-09-02-web-theme-shadcn*.md` → `docs/superpowers/{specs,plans}/`
- Modify: `/Users/tariq/code/odoo/odoo.conf` (`addons_path` line)
- Modify: `docs/superpowers/specs/2026-09-03-nasq-platform-design.md:4` (Status → Approved)

**Interfaces:**
- Produces: repo root `/Users/tariq/code/nasq` with npm workspaces `apps/*`, `packages/*`; Odoo `addons_path` ending in `/Users/tariq/code/nasq/odoo-addons`.

- [ ] **Step 1: Root package.json and .gitignore**

`package.json`:
```json
{
  "name": "nasq",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm -w apps/web run dev",
    "build": "npm -w packages/contracts run build && npm -w apps/web run build",
    "test": "npm -w packages/contracts run test && npm -w apps/web run test",
    "lint": "npm -w apps/web run lint && ruff check odoo-addons"
  }
}
```

`.gitignore`:
```
node_modules/
.nuxt/
.output/
dist/
*.log
__pycache__/
*.pyc
.env
deploy/branding.json
deploy/data/
test-results/
playwright-report/
```

- [ ] **Step 2: Move the theme addon and its docs**

```bash
cd /Users/tariq/code/nasq
mkdir -p odoo-addons docs/superpowers/plans
cp -R /Users/tariq/code/odoo-addons/web_theme_shadcn odoo-addons/web_theme_shadcn
cp /Users/tariq/code/odoo-addons/docs/superpowers/specs/2026-09-02-web-theme-shadcn-design.md docs/superpowers/specs/
cp /Users/tariq/code/odoo-addons/docs/superpowers/plans/2026-09-02-web-theme-shadcn.md docs/superpowers/plans/
ls odoo-addons/web_theme_shadcn/__manifest__.py
```
Expected: manifest path printed. (The old `~/code/odoo-addons` repo is left untouched as history; it is retired, not deleted.)

- [ ] **Step 3: Point Odoo at the new addons dir**

Edit `/Users/tariq/code/odoo/odoo.conf` — replace the `addons_path` line with:
```
addons_path = /Users/tariq/code/odoo/addons,/Users/tariq/code/nasq/odoo-addons
```
(`oca/*` paths are dropped here on purpose; Task 2 uninstalls their modules first — until Task 2 runs, the dev DB has modules whose source is missing, which is harmless for uninstall.)

- [ ] **Step 4: Mark the spec approved and write README**

In `docs/superpowers/specs/2026-09-03-nasq-platform-design.md` change `**Status:** Draft — awaiting review before planning` to `**Status:** Approved — phase 0 planned`.

`README.md`:
```markdown
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
```

- [ ] **Step 5: Verify Odoo still boots with the new path**

```bash
.venv/bin/python odoo-bin -c odoo.conf --stop-after-init 2>&1 | grep -E "ERROR|Registry loaded" | head
```
Expected: a `Registry loaded` line and no `ERROR` lines about `web_theme_shadcn`.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/nasq && git add -A && git commit -m "[ADD] repo: monorepo scaffold, move web_theme_shadcn and its docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Remove the AGPL OCA modules from the dev database

**Files:**
- Modify: database `odoo19` (uninstall), no source files.

**Interfaces:**
- Produces: `odoo19` with zero OCA modules installed; `ir_module_module` no longer lists them as `installed`.

- [ ] **Step 1: Record the before state**

```bash
psql -d odoo19 -tAc "select name from ir_module_module where state='installed' and name in ('web_timeline','project_timeline','project_timeline_hr_timesheet','project_task_code','project_milestone_status','hr_employee_document','hr_employee_relative','hr_course') order by 1;"
```
Expected: 8 names.

- [ ] **Step 2: Uninstall (dependents first; Odoo cascades the rest)**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin module uninstall -c odoo.conf -d odoo19 \
  project_timeline_hr_timesheet project_timeline web_timeline \
  project_task_code project_milestone_status \
  hr_employee_document hr_employee_relative hr_course 2>&1 | grep -E "ERROR|uninstall|Modules loaded" | tail -15
```
Expected: no `ERROR` lines. If a module fails with "not found in addons path", the uninstall CLI still proceeds because uninstall only needs DB state; if it refuses, temporarily re-add the three `oca/*` paths to `addons_path`, rerun, then remove them again.

- [ ] **Step 3: Verify**

```bash
psql -d odoo19 -tAc "select count(*) from ir_module_module where state='installed' and (name like 'web_timeline%' or name like 'project_timeline%' or name in ('project_task_code','project_milestone_status','hr_employee_document','hr_employee_relative','hr_course'));"
psql -d odoo19 -tAc "select count(*) from ir_module_module where state='installed';"
```
Expected: `0`, then `55` (63 − 8).

- [ ] **Step 4: Boot the server once to confirm the registry is clean**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d odoo19 --stop-after-init 2>&1 | grep -cE "ERROR"
```
Expected: `0`.

(No commit — nothing in the repo changed. Note the result in the PR/commit body of Task 3.)

---

### Task 3: `nasq_core` — groups and branding defaults

**Files:**
- Create: `odoo-addons/nasq_core/__init__.py`
- Create: `odoo-addons/nasq_core/__manifest__.py`
- Create: `odoo-addons/nasq_core/security/nasq_core_security.xml`
- Create: `odoo-addons/nasq_core/models/__init__.py`
- Create: `odoo-addons/nasq_core/models/res_company.py`
- Create: `odoo-addons/nasq_core/data/res_company_data.xml`
- Create: `odoo-addons/nasq_core/tests/__init__.py`
- Create: `odoo-addons/nasq_core/tests/test_groups.py`

**Interfaces:**
- Produces XML ids: `nasq_core.group_employee`, `nasq_core.group_customer_admin`, `nasq_core.group_vendor_support`, `nasq_core.res_groups_privilege_nasq`.
- Produces: `res.company.font` gains selection value `'IBM_Plex_Sans_Arabic'` (default); main company `primary_color = '#18181b'`.

- [ ] **Step 1: Write the failing test**

`odoo-addons/nasq_core/tests/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_groups
```

`odoo-addons/nasq_core/tests/test_groups.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('nasq')
class TestNasqGroups(TransactionCase):

    def test_groups_imply_odoo_groups(self):
        employee = self.env.ref('nasq_core.group_employee')
        admin = self.env.ref('nasq_core.group_customer_admin')
        vendor = self.env.ref('nasq_core.group_vendor_support')

        self.assertIn(self.env.ref('base.group_user'), employee.all_implied_ids)
        self.assertIn(self.env.ref('project.group_project_user'), employee.all_implied_ids)
        self.assertIn(self.env.ref('hr_timesheet.group_hr_timesheet_user'), employee.all_implied_ids)

        self.assertIn(employee, admin.all_implied_ids)
        self.assertIn(self.env.ref('project.group_project_manager'), admin.all_implied_ids)
        self.assertIn(self.env.ref('hr.group_hr_manager'), admin.all_implied_ids)
        self.assertIn(self.env.ref('base.group_erp_manager'), admin.all_implied_ids)
        self.assertNotIn(self.env.ref('base.group_system'), admin.all_implied_ids)

        self.assertIn(self.env.ref('base.group_system'), vendor.all_implied_ids)

    def test_company_branding_defaults(self):
        company = self.env.ref('base.main_company')
        self.assertEqual(company.font, 'IBM_Plex_Sans_Arabic')
        self.assertEqual(company.primary_color, '#18181b')
        selection = dict(self.env['res.company']._fields['font'].get_description(self.env)['selection'])
        self.assertEqual(selection['IBM_Plex_Sans_Arabic'], 'IBM Plex Sans Arabic')
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core --test-tags /nasq_core 2>&1 | grep -E "ERROR|FAIL|Ran|nasq_core" | tail -8
```
Expected: an error that module `nasq_core` does not exist / cannot be installed (no manifest yet).

- [ ] **Step 3: Write the addon**

`odoo-addons/nasq_core/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import models
```

`odoo-addons/nasq_core/__manifest__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Core',
    'summary': 'nasq platform: roles and branding defaults',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['base', 'web', 'project', 'hr', 'hr_timesheet', 'mail'],
    'data': [
        'security/nasq_core_security.xml',
        'data/res_company_data.xml',
    ],
    'installable': True,
    'application': False,
}
```

`odoo-addons/nasq_core/security/nasq_core_security.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record model="res.groups.privilege" id="res_groups_privilege_nasq">
        <field name="name">nasq</field>
        <field name="sequence">1</field>
        <field name="category_id" ref="base.module_category_services"/>
    </record>

    <record id="group_employee" model="res.groups">
        <field name="name">Employee</field>
        <field name="comment">Uses the nasq app: projects, tasks, timesheets.</field>
        <field name="sequence">10</field>
        <field name="privilege_id" ref="res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[
            (4, ref('base.group_user')),
            (4, ref('project.group_project_user')),
            (4, ref('hr_timesheet.group_hr_timesheet_user')),
        ]"/>
    </record>

    <record id="group_customer_admin" model="res.groups">
        <field name="name">Customer Administrator</field>
        <field name="comment">Manages users, employees, departments, project settings and branding for their company.</field>
        <field name="sequence">20</field>
        <field name="privilege_id" ref="res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[
            (4, ref('group_employee')),
            (4, ref('project.group_project_manager')),
            (4, ref('hr.group_hr_manager')),
            (4, ref('base.group_erp_manager')),
        ]"/>
    </record>

    <record id="group_vendor_support" model="res.groups">
        <field name="name">Vendor Support</field>
        <field name="comment">nasq vendor account: full Odoo administration.</field>
        <field name="sequence">30</field>
        <field name="privilege_id" ref="res_groups_privilege_nasq"/>
        <field name="implied_ids" eval="[
            (4, ref('group_customer_admin')),
            (4, ref('base.group_system')),
        ]"/>
    </record>
</odoo>
```

`odoo-addons/nasq_core/models/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import res_company
```

`odoo-addons/nasq_core/models/res_company.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    font = fields.Selection(
        selection_add=[('IBM_Plex_Sans_Arabic', 'IBM Plex Sans Arabic')],
        default='IBM_Plex_Sans_Arabic',
        ondelete={'IBM_Plex_Sans_Arabic': 'set default'},
    )
```

`odoo-addons/nasq_core/data/res_company_data.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo noupdate="1">
    <record id="base.main_company" model="res.company">
        <field name="font">IBM_Plex_Sans_Arabic</field>
        <field name="primary_color">#18181b</field>
    </record>
</odoo>
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core --test-tags /nasq_core 2>&1 | grep -E "ERROR|FAIL|Ran|tests" | tail -8
```
Expected: `Ran 2 tests` … `OK`, `0 failed, 0 error(s)`.

- [ ] **Step 5: Lint and commit**

```bash
cd /Users/tariq/code/nasq && ruff check odoo-addons/nasq_core && git add odoo-addons/nasq_core && git commit -m "[ADD] nasq_core: employee / customer admin / vendor support groups, branding defaults

Uninstalled the 8 AGPL OCA modules from the dev DB (odoo19) and dropped
oca/* from addons_path; see spec 'Licensing'.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `nasq_api` — `GET /api/v1/branding` (public)

**Files:**
- Create: `odoo-addons/nasq_api/__init__.py`
- Create: `odoo-addons/nasq_api/__manifest__.py`
- Create: `odoo-addons/nasq_api/controllers/__init__.py`
- Create: `odoo-addons/nasq_api/controllers/branding.py`
- Create: `odoo-addons/nasq_api/serializers/__init__.py`
- Create: `odoo-addons/nasq_api/serializers/company.py`
- Create: `odoo-addons/nasq_api/tests/__init__.py`
- Create: `odoo-addons/nasq_api/tests/test_branding.py`

**Interfaces:**
- Produces: `GET /api/v1/branding` → `200 application/json`
  `{"name": str, "logo_url": str, "primary_color": str, "font": str}` with `Cache-Control: public, max-age=300`.
- Produces: `serializers.company.dump_branding(company) -> dict` (same keys).

- [ ] **Step 1: Write the failing test**

`odoo-addons/nasq_api/tests/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_branding
```

`odoo-addons/nasq_api/tests/test_branding.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestBrandingEndpoint(HttpCase):

    def test_branding_is_public_and_cached(self):
        company = self.env.ref('base.main_company')
        company.write({'name': 'Erada', 'primary_color': '#0055ff'})

        res = self.url_open('/api/v1/branding')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get('Content-Type'), 'application/json; charset=utf-8')
        self.assertEqual(res.headers.get('Cache-Control'), 'public, max-age=300')
        self.assertEqual(res.json(), {
            'name': 'Erada',
            'logo_url': f'/web/binary/company_logo?company={company.id}',
            'primary_color': '#0055ff',
            'font': 'IBM_Plex_Sans_Arabic',
        })

    def test_branding_falls_back_to_default_color(self):
        self.env.ref('base.main_company').primary_color = False
        res = self.url_open('/api/v1/branding')
        self.assertEqual(res.json()['primary_color'], '#18181b')
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_api --test-tags /nasq_api 2>&1 | grep -E "ERROR|FAIL|Ran" | tail -5
```
Expected: module not found error.

- [ ] **Step 3: Write the addon, serializer and controller**

`odoo-addons/nasq_api/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import controllers
```

`odoo-addons/nasq_api/__manifest__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq API',
    'summary': 'nasq platform: /api/v1 contract consumed by the nasq web app',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    'depends': ['nasq_core'],
    'installable': True,
    'application': False,
}
```

`odoo-addons/nasq_api/serializers/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import company
```

`odoo-addons/nasq_api/serializers/company.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
DEFAULT_PRIMARY_COLOR = '#18181b'


def dump_branding(company):
    """Public branding of ``company`` for the login page and app chrome."""
    return {
        'name': company.name,
        'logo_url': f'/web/binary/company_logo?company={company.id}',
        'primary_color': company.primary_color or DEFAULT_PRIMARY_COLOR,
        'font': company.font,
    }
```

`odoo-addons/nasq_api/controllers/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import branding
```

`odoo-addons/nasq_api/controllers/branding.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.serializers.company import dump_branding


class BrandingController(http.Controller):

    @http.route('/api/v1/branding', type='json2', auth='public', methods=['GET'], readonly=True)
    def branding(self):
        company = request.env['res.company'].sudo().search([], order='id', limit=1)
        return request.make_json_response(
            dump_branding(company),
            headers=[('Cache-Control', 'public, max-age=300')],
        )
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_api --test-tags /nasq_api 2>&1 | grep -E "ERROR|FAIL|Ran" | tail -5
```
Expected: `Ran 2 tests … OK`.

- [ ] **Step 5: Lint and commit**

```bash
cd /Users/tariq/code/nasq && ruff check odoo-addons/nasq_api && git add odoo-addons/nasq_api && git commit -m "[ADD] nasq_api: public GET /api/v1/branding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `nasq_api` — `GET /api/v1/me` (session user + role)

**Files:**
- Create: `odoo-addons/nasq_api/serializers/user.py`
- Create: `odoo-addons/nasq_api/controllers/me.py`
- Create: `odoo-addons/nasq_api/tests/test_me.py`
- Modify: `odoo-addons/nasq_api/serializers/__init__.py`, `odoo-addons/nasq_api/controllers/__init__.py`, `odoo-addons/nasq_api/tests/__init__.py`

**Interfaces:**
- Produces: `GET /api/v1/me` → `200 {"id", "name", "login", "email", "lang", "tz", "role": "employee"|"admin"|"vendor", "company": {"id", "name"}}`; anonymous → `403`.
- Produces: `serializers.user.role_of(user) -> str`, `serializers.user.dump_me(user) -> dict`.

- [ ] **Step 1: Write the failing test**

Append to `odoo-addons/nasq_api/tests/__init__.py`:
```python
from . import test_me
```

`odoo-addons/nasq_api/tests/test_me.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestMeEndpoint(HttpCase):

    def test_anonymous_is_403(self):
        res = self.url_open('/api/v1/me')
        self.assertEqual(res.status_code, 403)

    def test_employee(self):
        new_test_user(self.env, login='emp', password='emp_password_123',
                      name='Sara', email='sara@example.com', tz='Asia/Riyadh',
                      groups='nasq_core.group_employee')
        self.authenticate('emp', 'emp_password_123')

        res = self.url_open('/api/v1/me')

        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['login'], 'emp')
        self.assertEqual(body['name'], 'Sara')
        self.assertEqual(body['email'], 'sara@example.com')
        self.assertEqual(body['tz'], 'Asia/Riyadh')
        self.assertEqual(body['role'], 'employee')
        self.assertEqual(body['company']['id'], self.env.ref('base.main_company').id)
        self.assertEqual(set(body), {'id', 'name', 'login', 'email', 'lang', 'tz', 'role', 'company'})

    def test_customer_admin(self):
        new_test_user(self.env, login='cadmin', password='cadmin_password_123',
                      groups='nasq_core.group_customer_admin')
        self.authenticate('cadmin', 'cadmin_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'admin')

    def test_vendor(self):
        new_test_user(self.env, login='vendor', password='vendor_password_123',
                      groups='nasq_core.group_vendor_support')
        self.authenticate('vendor', 'vendor_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'vendor')
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -u nasq_api --test-tags /nasq_api:TestMeEndpoint 2>&1 | grep -E "ERROR|FAIL|Ran" | tail -5
```
Expected: 4 failures (404s, `/api/v1/me` unrouted).

- [ ] **Step 3: Implement serializer and controller**

Append to `odoo-addons/nasq_api/serializers/__init__.py`:
```python
from . import user
```

`odoo-addons/nasq_api/serializers/user.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
ROLE_GROUPS = (
    ('vendor', 'nasq_core.group_vendor_support'),
    ('admin', 'nasq_core.group_customer_admin'),
    ('employee', 'nasq_core.group_employee'),
)


def role_of(user):
    """Highest nasq role of ``user``; ``'employee'`` when in none of the groups."""
    for role, xmlid in ROLE_GROUPS:
        if user.has_group(xmlid):
            return role
    return 'employee'


def dump_me(user):
    return {
        'id': user.id,
        'name': user.name,
        'login': user.login,
        'email': user.email or '',
        'lang': user.lang,
        'tz': user.tz or '',
        'role': role_of(user),
        'company': {'id': user.company_id.id, 'name': user.company_id.name},
    }
```

Append to `odoo-addons/nasq_api/controllers/__init__.py`:
```python
from . import me
```

`odoo-addons/nasq_api/controllers/me.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.serializers.user import dump_me


class MeController(http.Controller):

    @http.route('/api/v1/me', type='json2', auth='user', methods=['GET'], readonly=True)
    def me(self):
        return dump_me(request.env.user)
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -u nasq_api --test-tags /nasq_api 2>&1 | grep -E "ERROR|FAIL|Ran" | tail -5
```
Expected: `Ran 6 tests … OK` (2 branding + 4 me).

- [ ] **Step 5: Lint and commit**

```bash
cd /Users/tariq/code/nasq && ruff check odoo-addons/nasq_api && git add odoo-addons/nasq_api && git commit -m "[ADD] nasq_api: GET /api/v1/me with nasq role

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `@nasq/contracts` — zod schemas for Branding and Me

**Files:**
- Create: `packages/contracts/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/contracts/src/index.ts`, `src/branding.ts`, `src/me.ts`
- Create: `packages/contracts/src/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: `BrandingSchema`, `Branding`, `MeSchema`, `Me`, `Role` exported from `@nasq/contracts`; the schemas mirror Task 4/5 JSON exactly.

- [ ] **Step 1: Package files**

`packages/contracts/package.json`:
```json
{
  "name": "@nasq/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^4.1.0" },
  "devDependencies": { "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "skipLibCheck": true, "noEmit": true, "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globals: true } })
```

- [ ] **Step 2: Write the failing test**

`packages/contracts/src/__tests__/schemas.test.ts`:
```ts
import { BrandingSchema, MeSchema } from '../index'

describe('BrandingSchema', () => {
  it('accepts the shape served by GET /api/v1/branding', () => {
    const parsed = BrandingSchema.parse({
      name: 'Erada', logo_url: '/web/binary/company_logo?company=1',
      primary_color: '#0055ff', font: 'IBM_Plex_Sans_Arabic',
    })
    expect(parsed.primary_color).toBe('#0055ff')
  })
  it('rejects a non-hex primary_color', () => {
    expect(() => BrandingSchema.parse({ name: 'x', logo_url: '/l', primary_color: 'blue', font: 'Lato' })).toThrow()
  })
})

describe('MeSchema', () => {
  it('accepts the shape served by GET /api/v1/me', () => {
    const me = MeSchema.parse({
      id: 2, name: 'Sara', login: 'emp', email: 'sara@example.com', lang: 'ar_001',
      tz: 'Asia/Riyadh', role: 'employee', company: { id: 1, name: 'Erada' },
    })
    expect(me.role).toBe('employee')
  })
  it('rejects unknown roles', () => {
    expect(() => MeSchema.parse({
      id: 2, name: 'x', login: 'x', email: '', lang: 'ar_001', tz: '', role: 'root', company: { id: 1, name: 'c' },
    })).toThrow()
  })
})
```

- [ ] **Step 3: Install and run to verify it fails**

```bash
cd /Users/tariq/code/nasq && npm install && npm -w packages/contracts run test 2>&1 | tail -8
```
Expected: FAIL — `../index` cannot be resolved.

- [ ] **Step 4: Implement the schemas**

`packages/contracts/src/branding.ts`:
```ts
import { z } from 'zod'

export const BrandingSchema = z.object({
  name: z.string().min(1),
  logo_url: z.string().min(1),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.string().min(1),
})
export type Branding = z.infer<typeof BrandingSchema>
```

`packages/contracts/src/me.ts`:
```ts
import { z } from 'zod'

export const RoleSchema = z.enum(['employee', 'admin', 'vendor'])
export type Role = z.infer<typeof RoleSchema>

export const MeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  login: z.string(),
  email: z.string(),
  lang: z.string(),
  tz: z.string(),
  role: RoleSchema,
  company: z.object({ id: z.number().int().positive(), name: z.string() }),
})
export type Me = z.infer<typeof MeSchema>
```

`packages/contracts/src/index.ts`:
```ts
export * from './branding'
export * from './me'
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/tariq/code/nasq && npm -w packages/contracts run test 2>&1 | tail -6 && npm -w packages/contracts run build
```
Expected: `4 passed`, and `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/nasq && git add package.json package-lock.json packages/contracts && git commit -m "[ADD] contracts: zod schemas for branding and me

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Nuxt app — init, Tailwind v4, shadcn-vue, tokens, RTL, dev proxy

**Files:**
- Create: `apps/web/` (nuxi init), then overwrite `nuxt.config.ts`, `app/app.vue`
- Create: `apps/web/components.json`, `app/assets/css/main.css`, `app/lib/utils.ts`
- Create: `apps/web/public/fonts/IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.woff2` (copied from the theme)
- Create: `apps/web/app/pages/index.vue` (temporary smoke page — replaced in Task 9)

**Interfaces:**
- Produces: `npm run dev` serves `http://localhost:3000`; `GET http://localhost:3000/api/v1/branding` returns Odoo's JSON (proxied); `cn()` in `@/lib/utils`; shadcn components under `app/components/ui/`.
- Consumes: Odoo on `http://localhost:8069` with `nasq_api` installed in DB `odoo19` (`-i nasq_core,nasq_api` on `odoo19` — do it in Step 6).

- [ ] **Step 1: Scaffold Nuxt 4**

```bash
cd /Users/tariq/code/nasq && npx nuxi@latest init apps/web --packageManager npm --no-install --no-gitInit
```
If prompted: package manager `npm`, git init `No`. Then remove the generated `apps/web/README.md`, `.gitignore` (root one covers it) and `public/favicon.ico` stays.

- [ ] **Step 2: Dependencies**

```bash
cd /Users/tariq/code/nasq && npm -w apps/web install \
  tailwindcss @tailwindcss/vite tw-animate-css \
  shadcn-nuxt reka-ui class-variance-authority clsx tailwind-merge lucide-vue-next \
  @vueuse/core @vueuse/nuxt @tanstack/vue-query zod @nasq/contracts@0.1.0 \
&& npm -w apps/web install -D typescript vue-tsc @playwright/test vitest
```
(`@nasq/contracts@0.1.0` resolves to the workspace package.)

- [ ] **Step 3: Config files**

`apps/web/nuxt.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite'

const odoo = process.env.NUXT_ODOO_URL ?? 'http://localhost:8069'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['shadcn-nuxt', '@vueuse/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: {
    head: {
      htmlAttrs: { lang: 'ar', dir: 'rtl' },
      title: 'nasq',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  runtimeConfig: {
    odooUrl: odoo,
    odooDb: process.env.NUXT_ODOO_DB ?? 'odoo19',
  },
  // Dev only: in production Caddy sends these paths straight to Odoo (deploy/Caddyfile).
  routeRules: {
    '/api/v1/**': { proxy: `${odoo}/api/v1/**` },
    '/web/**': { proxy: `${odoo}/web/**` },
    '/odoo/**': { proxy: `${odoo}/odoo/**` },
  },
  typescript: { strict: true },
})
```

`apps/web/components.json`:
```json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "style": "new-york",
  "typescript": true,
  "tailwind": {
    "config": "",
    "css": "app/assets/css/main.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "composables": "@/composables",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  }
}
```

`apps/web/app/lib/utils.ts`:
```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 4: Tokens and fonts**

```bash
cd /Users/tariq/code/nasq && mkdir -p apps/web/public/fonts && cp odoo-addons/web_theme_shadcn/static/src/fonts/ibm-plex-sans-arabic/*.woff2 apps/web/public/fonts/ && cp odoo-addons/web_theme_shadcn/static/src/fonts/ibm-plex-sans-arabic/LICENSE.txt apps/web/public/fonts/
```

`apps/web/app/assets/css/main.css`:
```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@font-face { font-family: "IBM Plex Sans Arabic"; font-weight: 400; font-display: swap; src: url("/fonts/IBMPlexSansArabic-Regular.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans Arabic"; font-weight: 500; font-display: swap; src: url("/fonts/IBMPlexSansArabic-Medium.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans Arabic"; font-weight: 600; font-display: swap; src: url("/fonts/IBMPlexSansArabic-SemiBold.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans Arabic"; font-weight: 700; font-display: swap; src: url("/fonts/IBMPlexSansArabic-Bold.woff2") format("woff2"); }

:root {
  --font-sans: "IBM Plex Sans Arabic", ui-sans-serif, system-ui, sans-serif;
  --radius: 0.5rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.141 0.005 285.823);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.141 0.005 285.823);
  --primary: #18181b;                       /* overridden at runtime by branding.primary_color */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --accent-foreground: oklch(0.21 0.006 285.885);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.92 0.004 286.32);
  --input: oklch(0.92 0.004 286.32);
  --ring: oklch(0.705 0.015 286.067);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.141 0.005 285.823);
  --sidebar-primary: var(--primary);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.967 0.001 286.375);
  --sidebar-accent-foreground: oklch(0.21 0.006 285.885);
  --sidebar-border: oklch(0.92 0.004 286.32);
  --sidebar-ring: oklch(0.705 0.015 286.067);
}

@theme inline {
  --font-sans: var(--font-sans);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground font-sans antialiased; }
}
```

- [ ] **Step 5: Root component with RTL provider and a smoke page**

`apps/web/app/app.vue`:
```vue
<script setup lang="ts">
import { ConfigProvider } from 'reka-ui'
</script>

<template>
  <ConfigProvider dir="rtl">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </ConfigProvider>
</template>
```

`apps/web/app/pages/index.vue` (temporary; Task 9 replaces it):
```vue
<template>
  <main class="p-8">
    <h1 class="text-2xl font-semibold">nasq</h1>
    <Button class="mt-4">زر تجريبي</Button>
  </main>
</template>
```

Add the first shadcn component:
```bash
cd /Users/tariq/code/nasq/apps/web && npx shadcn-vue@latest add button --yes --overwrite
```
Expected: `app/components/ui/button/` created.

- [ ] **Step 6: Install the API addons into the dev DB and run both servers**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d odoo19 -i nasq_core,nasq_api --stop-after-init 2>&1 | grep -cE "ERROR"
```
Expected: `0`. Then in one terminal `cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf --dev=all`, in another `cd /Users/tariq/code/nasq && npm run dev`.

- [ ] **Step 7: Verify proxy, RTL and font**

```bash
curl -s http://localhost:3000/api/v1/branding && echo && curl -s http://localhost:3000/ | grep -oE '<html[^>]*>' && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fonts/IBMPlexSansArabic-Regular.woff2
```
Expected: the branding JSON (`"name":"My Company"…`), `<html lang="ar" dir="rtl">`, `200`. Open `http://localhost:3000` in the Browser pane: the button renders black with `0.5rem` radius, text in IBM Plex Sans Arabic, page right-aligned.

- [ ] **Step 8: Type-check and commit**

```bash
cd /Users/tariq/code/nasq && npx -w apps/web vue-tsc --noEmit && git add -A && git commit -m "[ADD] web: Nuxt 4 app with Tailwind v4, shadcn-vue, zinc tokens, RTL, dev proxy to Odoo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Login — Nitro auth handlers, `useMe`, guard, branded login page

**Files:**
- Create: `apps/web/server/api/auth/login.post.ts`, `apps/web/server/api/auth/logout.post.ts`
- Create: `apps/web/app/composables/useMe.ts`, `apps/web/app/composables/useBranding.ts`
- Create: `apps/web/app/middleware/auth.global.ts`
- Create: `apps/web/app/pages/login.vue`
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/login.spec.ts`
- Modify: `apps/web/package.json` (scripts)

**Interfaces:**
- Produces: `POST /api/auth/login {login, password}` → `200 {ok: true}` + forwards Odoo's `Set-Cookie: session_id`; wrong credentials → `401 {code: 'invalid_credentials'}`.
- Produces: `POST /api/auth/logout` → `204`, session destroyed.
- Produces: `useMe()` → `{ me: Ref<Me|null>, refresh, loggedIn: ComputedRef<boolean> }`; `useBranding()` → `{ branding: Ref<Branding|null> }` and applies `--primary` + `<title>`.
- Consumes: Task 5 `/api/v1/me`, Task 4 `/api/v1/branding`, Task 6 schemas.

- [ ] **Step 1: Write the failing e2e test**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', locale: 'ar-SA' },
  reporter: 'list',
})
```

`apps/web/e2e/login.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('wrong password stays on /login with an error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('definitely-wrong')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('admin logs in and lands on the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('اسم المستخدم').fill('admin')
  await page.getByLabel('كلمة المرور').fill('admin')
  await page.getByRole('button', { name: 'دخول' }).click()
  await expect(page).toHaveURL('http://localhost:3000/')
  await expect(page.getByRole('navigation')).toContainText('مهامي')
})
```

Add scripts to `apps/web/package.json`:
```json
"test": "vitest run",
"test:e2e": "playwright test",
"lint": "vue-tsc --noEmit"
```

```bash
cd /Users/tariq/code/nasq/apps/web && npx playwright install chromium && npm run test:e2e 2>&1 | tail -6
```
Expected: 2 failed (no `/login` page yet). Both servers from Task 7 Step 6 must be running.

- [ ] **Step 2: Nitro handlers**

`apps/web/server/api/auth/login.post.ts`:
```ts
export default defineEventHandler(async (event) => {
  const { login, password } = await readBody<{ login?: string; password?: string }>(event)
  if (!login || !password) {
    throw createError({ statusCode: 400, data: { code: 'missing_credentials', message: 'login and password are required' } })
  }
  const { odooUrl, odooDb } = useRuntimeConfig(event)

  const upstream = await fetch(`${odooUrl}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: odooDb, login, password } }),
  })
  const body = await upstream.json() as { result?: { uid?: number }; error?: unknown }

  if (body.error || !body.result?.uid) {
    throw createError({ statusCode: 401, data: { code: 'invalid_credentials', message: 'بيانات الدخول غير صحيحة' } })
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', cookie)
  }
  return { ok: true }
})
```

`apps/web/server/api/auth/logout.post.ts`:
```ts
export default defineEventHandler(async (event) => {
  const { odooUrl } = useRuntimeConfig(event)
  const cookie = getHeader(event, 'cookie') ?? ''
  await fetch(`${odooUrl}/web/session/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
  }).catch(() => undefined)
  deleteCookie(event, 'session_id', { path: '/' })
  setResponseStatus(event, 204)
  return null
})
```

- [ ] **Step 3: Composables and guard**

`apps/web/app/composables/useMe.ts`:
```ts
import { MeSchema, type Me } from '@nasq/contracts'

export function useMe() {
  const headers = useRequestHeaders(['cookie'])
  const { data, refresh, error } = useFetch<Me | null>('/api/v1/me', {
    key: 'me',
    headers,
    transform: (raw) => MeSchema.parse(raw),
    // 403 = not logged in; surface as null instead of an error
    onResponseError({ response }) { if (response.status === 403) response._data = null },
  })
  const me = computed(() => (error.value ? null : data.value ?? null))
  const loggedIn = computed(() => me.value !== null)
  return { me, refresh, loggedIn }
}
```

`apps/web/app/composables/useBranding.ts`:
```ts
import { BrandingSchema, type Branding } from '@nasq/contracts'

export function useBranding() {
  const { data } = useFetch<Branding>('/api/v1/branding', {
    key: 'branding',
    transform: (raw) => BrandingSchema.parse(raw),
  })
  const branding = computed(() => data.value ?? null)
  useHead(() => ({
    title: branding.value?.name ?? 'nasq',
    style: branding.value ? [{ innerHTML: `:root{--primary:${branding.value.primary_color}}` }] : [],
  }))
  return { branding }
}
```

`apps/web/app/middleware/auth.global.ts`:
```ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { me } = useMe()
  if (to.path === '/login') {
    if (me.value) return navigateTo('/')
    return
  }
  if (!me.value) return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
})
```

- [ ] **Step 4: Login page**

```bash
cd /Users/tariq/code/nasq/apps/web && npx shadcn-vue@latest add input label card --yes --overwrite
```

`apps/web/app/pages/login.vue`:
```vue
<script setup lang="ts">
definePageMeta({ layout: false })

const { branding } = useBranding()
const route = useRoute()
const login = ref('')
const password = ref('')
const pending = ref(false)
const errorMessage = ref<string | null>(null)

async function submit() {
  pending.value = true
  errorMessage.value = null
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { login: login.value, password: password.value } })
    await refreshNuxtData('me')
    await navigateTo((route.query.next as string) || '/')
  } catch (e: any) {
    errorMessage.value = e?.data?.data?.message ?? 'تعذّر تسجيل الدخول'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="min-h-svh grid place-items-center bg-muted/40 p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <img v-if="branding" :src="branding.logo_url" :alt="branding.name" class="h-12 w-auto mb-2" />
        <CardTitle class="text-xl">{{ branding?.name ?? 'nasq' }}</CardTitle>
        <CardDescription>سجّل الدخول للمتابعة</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4" @submit.prevent="submit">
          <div class="grid gap-2">
            <Label for="login">اسم المستخدم</Label>
            <Input id="login" v-model="login" autocomplete="username" required dir="ltr" class="text-start" />
          </div>
          <div class="grid gap-2">
            <Label for="password">كلمة المرور</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" required dir="ltr" />
          </div>
          <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
          <Button type="submit" class="w-full" :disabled="pending">دخول</Button>
        </form>
      </CardContent>
    </Card>
  </main>
</template>
```

- [ ] **Step 5: Run the e2e tests**

```bash
cd /Users/tariq/code/nasq/apps/web && npm run test:e2e 2>&1 | tail -6
```
Expected: test 1 passes; test 2 fails only on the final `navigation … مهامي` assertion (the shell comes in Task 9). Manually confirm the cookie round-trip:
```bash
curl -s -c /tmp/nasq.jar -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}' http://localhost:3000/api/auth/login && echo && curl -s -b /tmp/nasq.jar http://localhost:3000/api/v1/me
```
Expected: `{"ok":true}` then the `/me` JSON with `"role":"vendor"` (admin is `group_system`; add the vendor group to admin if it prints `employee`: `psql -d odoo19 -c "..."` is not the way — use the Odoo UI or shell: `env.ref('base.user_admin').group_ids |= env.ref('nasq_core.group_vendor_support')`).

- [ ] **Step 6: Type-check and commit**

```bash
cd /Users/tariq/code/nasq && npx -w apps/web vue-tsc --noEmit && git add -A && git commit -m "[ADD] web: branded login, session cookie passthrough, auth guard, useMe/useBranding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Shell — sidebar, ⌘K command menu, role-aware settings link, page stubs

**Files:**
- Create: `apps/web/app/layouts/default.vue`, `app/components/AppSidebar.vue`, `app/components/CommandMenu.vue`, `app/composables/useNav.ts`
- Replace: `apps/web/app/pages/index.vue`
- Create: `apps/web/app/pages/tasks.vue`, `projects.vue`, `people.vue`, `reports.vue`
- Create: `apps/web/app/composables/__tests__/useNav.test.ts`, `apps/web/vitest.config.ts`

**Interfaces:**
- Produces: `useNav(role) -> NavItem[]` where `NavItem = { to: string; label: string; icon: Component; shortcut?: string }`; settings item present only for `admin`/`vendor` and points to `/odoo` until phase 3 builds the Settings section.
- Consumes: `useMe()` (Task 8), shadcn `sidebar`, `command`, `dropdown-menu`, `avatar`.

- [ ] **Step 1: Write the failing unit test**

`apps/web/vitest.config.ts`:
```ts
import { defineVitestConfig } from '@nuxt/test-utils/config'
export default defineVitestConfig({ test: { environment: 'nuxt', include: ['app/**/*.test.ts'] } })
```
```bash
cd /Users/tariq/code/nasq && npm -w apps/web install -D @nuxt/test-utils happy-dom
```

`apps/web/app/composables/__tests__/useNav.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { useNav } from '../useNav'

describe('useNav', () => {
  it('employee sees the five product sections and no settings', () => {
    const labels = useNav('employee').map(i => i.label)
    expect(labels).toEqual(['اليوم', 'مهامي', 'المشاريع', 'الأشخاص', 'التقارير'])
  })
  it('admin and vendor get a settings item last', () => {
    expect(useNav('admin').at(-1)?.label).toBe('الإعدادات')
    expect(useNav('vendor').at(-1)?.to).toBe('/odoo')
  })
  it('every item has a single-key shortcut for ⌘K', () => {
    for (const item of useNav('admin')) expect(item.shortcut).toMatch(/^[a-z0-9]$/)
  })
})
```

```bash
cd /Users/tariq/code/nasq && npm -w apps/web run test 2>&1 | tail -6
```
Expected: FAIL — `../useNav` not found.

- [ ] **Step 2: Implement `useNav`**

`apps/web/app/composables/useNav.ts`:
```ts
import type { Component } from 'vue'
import { Sun, CheckSquare, FolderKanban, Users, BarChart3, Settings } from 'lucide-vue-next'
import type { Role } from '@nasq/contracts'

export interface NavItem { to: string; label: string; icon: Component; shortcut: string }

const base: NavItem[] = [
  { to: '/', label: 'اليوم', icon: Sun, shortcut: '1' },
  { to: '/tasks', label: 'مهامي', icon: CheckSquare, shortcut: '2' },
  { to: '/projects', label: 'المشاريع', icon: FolderKanban, shortcut: '3' },
  { to: '/people', label: 'الأشخاص', icon: Users, shortcut: '4' },
  { to: '/reports', label: 'التقارير', icon: BarChart3, shortcut: '5' },
]
// Until phase 3 ships the in-app Settings section, admins open the vendor console.
const settings: NavItem = { to: '/odoo', label: 'الإعدادات', icon: Settings, shortcut: 's' }

export function useNav(role: Role | null | undefined): NavItem[] {
  return role === 'admin' || role === 'vendor' ? [...base, settings] : base
}
```

```bash
cd /Users/tariq/code/nasq && npm -w apps/web run test 2>&1 | tail -6
```
Expected: `3 passed`.

- [ ] **Step 3: shadcn components**

```bash
cd /Users/tariq/code/nasq/apps/web && npx shadcn-vue@latest add sidebar command dropdown-menu avatar --yes --overwrite
```

- [ ] **Step 4: Sidebar, command menu, layout**

`apps/web/app/components/AppSidebar.vue`:
```vue
<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'

const { me } = useMe()
const { branding } = useBranding()
const route = useRoute()
const nav = computed(() => useNav(me.value?.role))
const initials = computed(() => (me.value?.name ?? '?').trim().slice(0, 1))

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await refreshNuxtData('me')
  await navigateTo('/login')
}
</script>

<template>
  <Sidebar side="right" collapsible="icon">
    <SidebarHeader>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <img v-if="branding" :src="branding.logo_url" :alt="branding.name" class="size-8 rounded-md object-contain" />
        <span class="truncate font-semibold group-data-[collapsible=icon]:hidden">{{ branding?.name ?? 'nasq' }}</span>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in nav" :key="item.to">
            <SidebarMenuButton as-child :is-active="route.path === item.to" :tooltip="item.label">
              <NuxtLink v-if="item.to !== '/odoo'" :to="item.to">
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </NuxtLink>
              <a v-else :href="item.to" target="_blank" rel="noopener">
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton size="lg">
            <Avatar class="size-8 rounded-md"><AvatarFallback class="rounded-md">{{ initials }}</AvatarFallback></Avatar>
            <div class="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span class="truncate font-medium">{{ me?.name }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ me?.email }}</span>
            </div>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" class="w-56">
          <DropdownMenuItem @select="logout"><LogOut class="me-2 size-4" />تسجيل الخروج</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
</template>
```

`apps/web/app/components/CommandMenu.vue`:
```vue
<script setup lang="ts">
import { useMagicKeys, whenever } from '@vueuse/core'

const open = ref(false)
const { me } = useMe()
const nav = computed(() => useNav(me.value?.role))
const keys = useMagicKeys()
whenever(() => keys['Meta+K']?.value || keys['Ctrl+K']?.value, () => { open.value = !open.value })

async function go(to: string) {
  open.value = false
  if (to === '/odoo') window.open(to, '_blank', 'noopener')
  else await navigateTo(to)
}
</script>

<template>
  <CommandDialog v-model:open="open">
    <CommandInput placeholder="اكتب للانتقال…" />
    <CommandList>
      <CommandEmpty>لا نتائج.</CommandEmpty>
      <CommandGroup heading="الانتقال إلى">
        <CommandItem v-for="item in nav" :key="item.to" :value="item.label" @select="go(item.to)">
          <component :is="item.icon" class="me-2 size-4" />
          <span>{{ item.label }}</span>
          <CommandShortcut>{{ item.shortcut }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
```

`apps/web/app/layouts/default.vue`:
```vue
<script setup lang="ts">
import { Search } from 'lucide-vue-next'
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <header class="flex h-14 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <div class="flex-1" />
        <Button variant="outline" size="sm" class="gap-2 text-muted-foreground" @click="$emit('open-command')">
          <Search class="size-4" />
          <span class="hidden sm:inline">بحث</span>
          <kbd class="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
      </header>
      <main class="p-6">
        <slot />
      </main>
    </SidebarInset>
    <CommandMenu />
  </SidebarProvider>
</template>
```
(The header button is decorative until phase 1 wires it; `⌘K` itself works via `useMagicKeys`.)

- [ ] **Step 5: Pages**

`apps/web/app/pages/index.vue`:
```vue
<script setup lang="ts">
const { me } = useMe()
</script>

<template>
  <div class="space-y-1">
    <h1 class="text-2xl font-semibold">اليوم</h1>
    <p class="text-muted-foreground">مرحبًا {{ me?.name }} — لا شيء مستحق اليوم.</p>
  </div>
</template>
```

`apps/web/app/pages/tasks.vue`, `projects.vue`, `people.vue`, `reports.vue` — each exactly this with its own title (`مهامي`, `المشاريع`, `الأشخاص`, `التقارير`):
```vue
<template>
  <h1 class="text-2xl font-semibold">مهامي</h1>
</template>
```

- [ ] **Step 6: Run e2e + unit, check the shell visually**

```bash
cd /Users/tariq/code/nasq/apps/web && npm run test && npm run test:e2e 2>&1 | tail -6
```
Expected: unit `3 passed`; e2e `2 passed`. In the Browser pane at `http://localhost:3000`: sidebar on the **right** (RTL), five items, settings item for admin, `⌘K` opens the palette, avatar menu logs out and lands on `/login`.

- [ ] **Step 7: Type-check and commit**

```bash
cd /Users/tariq/code/nasq && npx -w apps/web vue-tsc --noEmit && git add -A && git commit -m "[ADD] web: app shell — RTL sidebar, ⌘K command menu, role-aware nav, page stubs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Deployment skeleton — compose, Caddy, provisioning, branding seed

**Files:**
- Create: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`, `deploy/odoo.conf`
- Create: `deploy/branding.example.json`, `deploy/seed_branding.py`, `deploy/provision.sh`
- Create: `apps/web/Dockerfile`

**Interfaces:**
- Produces: `docker compose --env-file deploy/.env -f deploy/docker-compose.yml config` validates; `deploy/provision.sh <domain> <db>` brings a customer up and seeds branding from `deploy/branding.json`.
- Consumes: `nasq_core`, `nasq_api` (Tasks 3–5), Nuxt build (Task 7).

- [ ] **Step 1: Compose, Caddy, env, Odoo config**

`deploy/.env.example`:
```
DOMAIN=app.example.sa
DB_NAME=nasq
DB_PASSWORD=change-me
ODOO_ADMIN_PASSWORD=change-me
```

`deploy/docker-compose.yml`:
```yaml
services:
  proxy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    environment: { DOMAIN: "${DOMAIN}" }
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on: [web, odoo]

  web:
    build: { context: .., dockerfile: apps/web/Dockerfile }
    environment:
      NUXT_ODOO_URL: http://odoo:8069
      NUXT_ODOO_DB: "${DB_NAME}"
    expose: ["3000"]
    depends_on: [odoo]

  odoo:
    image: odoo:19.0
    command: ["odoo", "-c", "/etc/odoo/odoo.conf", "--workers", "2", "--proxy-mode"]
    environment:
      HOST: db
      USER: odoo
      PASSWORD: "${DB_PASSWORD}"
    volumes:
      - ./odoo.conf:/etc/odoo/odoo.conf:ro
      - ../odoo-addons:/mnt/extra-addons:ro
      - odoo_data:/var/lib/odoo
    expose: ["8069", "8072"]
    depends_on: [db]

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: odoo
      POSTGRES_PASSWORD: "${DB_PASSWORD}"
    volumes: [db_data:/var/lib/postgresql/data]

volumes: { caddy_data: {}, odoo_data: {}, db_data: {} }
```

`deploy/Caddyfile`:
```
{$DOMAIN} {
	encode zstd gzip

	@odoo path /api/v1/* /web/* /odoo/* /json/* /doc/*
	handle @odoo {
		reverse_proxy odoo:8069
	}
	handle /websocket* {
		reverse_proxy odoo:8072
	}
	handle {
		reverse_proxy web:3000
	}
}
```

`deploy/odoo.conf`:
```
[options]
addons_path = /mnt/extra-addons
data_dir = /var/lib/odoo
admin_passwd = ${ODOO_ADMIN_PASSWORD}
db_host = db
db_user = odoo
db_password = ${DB_PASSWORD}
dbfilter = ^${DB_NAME}$
list_db = False
proxy_mode = True
```
(Odoo's `odoo.conf` does not expand `${}`; `provision.sh` renders this file with `envsubst` into `deploy/data/odoo.conf` and compose mounts that — see Step 3.)

`apps/web/Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
COPY . .
RUN npm -w apps/web run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /repo/apps/web/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 2: Branding seed**

`deploy/branding.example.json`:
```json
{
  "name": "إرادة",
  "primary_color": "#18181b",
  "font": "IBM_Plex_Sans_Arabic",
  "logo_path": "logo.png"
}
```

`deploy/seed_branding.py` (run inside the odoo container via `odoo shell`):
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed res.company branding from /seed/branding.json. Usage:
    odoo shell -c /etc/odoo/odoo.conf -d <db> --no-http < /seed/seed_branding.py
"""
import base64
import json
import os

with open('/seed/branding.json', encoding='utf-8') as f:
    branding = json.load(f)

company = env['res.company'].search([], order='id', limit=1)
vals = {
    'name': branding['name'],
    'primary_color': branding.get('primary_color', '#18181b'),
    'font': branding.get('font', 'IBM_Plex_Sans_Arabic'),
}
logo_path = os.path.join('/seed', branding.get('logo_path', ''))
if branding.get('logo_path') and os.path.exists(logo_path):
    with open(logo_path, 'rb') as f:
        vals['logo'] = base64.b64encode(f.read())
company.write(vals)
env.cr.commit()
print('branding seeded:', company.name, company.primary_color, company.font)
```

- [ ] **Step 3: Provisioning script**

`deploy/provision.sh`:
```bash
#!/usr/bin/env bash
# One command = one customer environment.
#   deploy/provision.sh app.customer.sa customerdb
# Requires deploy/.env (copy .env.example) and deploy/branding.json (+ logo).
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:?domain}"; DB_NAME="${2:?db name}"
[ -f .env ] || { echo "deploy/.env missing (copy .env.example)"; exit 1; }
[ -f branding.json ] || { echo "deploy/branding.json missing (copy branding.example.json)"; exit 1; }
set -a; source .env; set +a
export DOMAIN DB_NAME

mkdir -p data
envsubst < odoo.conf > data/odoo.conf

docker compose up -d db
docker compose run --rm -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" odoo \
  odoo -c /etc/odoo/odoo.conf -d "$DB_NAME" -i nasq_core,nasq_api,web_theme_shadcn --without-demo=all --stop-after-init
docker compose run --rm -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" -v "$PWD:/seed:ro" odoo \
  sh -c "odoo shell -c /etc/odoo/odoo.conf -d $DB_NAME --no-http < /seed/seed_branding.py"
docker compose up -d
echo "https://$DOMAIN is provisioning; vendor login: admin / $ODOO_ADMIN_PASSWORD (change it)."
```
```bash
chmod +x /Users/tariq/code/nasq/deploy/provision.sh
```
Then change the `odoo` service volume in `docker-compose.yml` from `./odoo.conf:/etc/odoo/odoo.conf:ro` to `./data/odoo.conf:/etc/odoo/odoo.conf:ro` (the rendered file).

- [ ] **Step 4: Validate the compose file and the Nuxt image build**

```bash
cd /Users/tariq/code/nasq/deploy && cp .env.example .env && cp branding.example.json branding.json && mkdir -p data && DOMAIN=x DB_NAME=x DB_PASSWORD=x ODOO_ADMIN_PASSWORD=x envsubst < odoo.conf > data/odoo.conf && docker compose --env-file .env config >/dev/null && echo COMPOSE_OK
cd /Users/tariq/code/nasq && docker build -f apps/web/Dockerfile -t nasq-web:dev . 2>&1 | tail -3
```
Expected: `COMPOSE_OK`; image builds (`naming to docker.io/library/nasq-web:dev`). A full `provision.sh` run against a real domain is a phase-3 acceptance step, not required here.

- [ ] **Step 5: Commit**

```bash
cd /Users/tariq/code/nasq && git add deploy apps/web/Dockerfile && git commit -m "[ADD] deploy: docker-compose, Caddy single-origin routing, provisioning and branding seed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Phase-0 acceptance and docs

**Files:**
- Modify: `README.md` (test commands), `docs/superpowers/specs/2026-09-03-nasq-platform-design.md` (Phases table row 0 → done)

- [ ] **Step 1: Full test sweep**

```bash
cd /Users/tariq/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -u nasq_core,nasq_api --test-tags /nasq_core,/nasq_api 2>&1 | grep -E "ERROR|FAIL|Ran|failed" | tail -5
cd /Users/tariq/code/nasq && ruff check odoo-addons && npm test 2>&1 | tail -4 && npx -w apps/web vue-tsc --noEmit && (cd apps/web && npm run test:e2e 2>&1 | tail -3)
```
Expected: Odoo `Ran 8 tests … 0 failed, 0 error(s)`; ruff clean; contracts 4 passed; web unit 3 passed; e2e 2 passed.

- [ ] **Step 2: Docs**

Append to `README.md`:
```markdown
## Tests

    # Odoo addons (fresh scratch DB)
    cd ~/code/odoo && .venv/bin/python odoo-bin -c odoo.conf -d nasq_test -i nasq_core,nasq_api --test-tags /nasq_core,/nasq_api
    # contracts + web unit
    npm test
    # e2e (needs Odoo on :8069 with nasq_api installed and `npm run dev` on :3000)
    cd apps/web && npm run test:e2e
```
In the spec's Phases table change the phase-0 row's `Duration` cell to `1 week — done 2026-09-xx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/tariq/code/nasq && git add README.md docs && git commit -m "[IMP] docs: phase 0 acceptance and test commands

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (phase 0 row):** monorepo → T1; `nasq_core` groups + branding fields → T3; `nasq_api` skeleton `/branding`, `/me` → T4, T5; Nuxt shell (login, sidebar, ⌘K, tokens, RTL, proxy) → T7–T9; `deploy/` compose → T10; remove OCA modules → T2. Contracts package → T6. Not in phase 0 by design: 2FA in the custom login (Odoo's `auth_totp` challenge is not handled by `/web/session/authenticate` for RPC; phase 1 adds the TOTP step), `@nuxtjs/i18n` (strings are Arabic literals until phase 1), PWA (phase 3), websocket proxy (phase 1), menu hiding for customer admins (phase 3).

**Placeholder scan:** page stubs in T9 are real files with real content; no "TBD" steps. `provision.sh` end-to-end run is explicitly deferred with its acceptance owner named.

**Type consistency:** `dump_branding` keys == `BrandingSchema` keys == `useBranding` usage (`name`, `logo_url`, `primary_color`, `font`). `dump_me` keys == `MeSchema` == `useMe`/`AppSidebar` usage; `role` values `employee|admin|vendor` in T5, T6, T9. Route `/api/v1/me` returns 403 anonymously (`SessionExpiredException.http_status = FORBIDDEN`) and `useMe` treats 403 as null.
