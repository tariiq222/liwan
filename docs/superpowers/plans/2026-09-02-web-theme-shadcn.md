# web_theme_shadcn Implementation Plan

> Scope: Odoo vendor-console theme only. This is not the Nasq Nuxt customer-UI theme. Customer UI follows [DESIGN.md](../../../DESIGN.md); vendor-console implementation and licensing remain separate.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `web_theme_shadcn`, an Odoo 19.0 backend theme that replaces the purple navbar with a shadcn-style icon app rail + collapsible app panel + white top bar, and restyles the web client with shadcn's zinc palette, IBM Plex Sans Arabic font and soft borders.

**Architecture:** One addon in a separate `odoo-addons` git repo. SCSS variable files are injected *before* Odoo's `!default` variable files to retheme everything Bootstrap/Odoo derives from them. The `NavBar` component is `patch()`ed and its template replaced (`t-inherit-mode="primary"`) to render a top bar plus two new OWL components (`AppRail`, `AppPanel`); the `menu` service is patched to track the current menu id. The action area (`.o_action_manager`) is untouched — only laid out via CSS grid and restyled.

**Tech Stack:** Odoo 19.0 (OWL 2, SCSS via Odoo's asset pipeline, Bootstrap 5.3), HOOT unit tests (`@odoo/hoot`), `web_tour` tours + `HttpCase`, ruff, eslint.

**Spec:** `docs/superpowers/specs/2026-09-02-web-theme-shadcn-design.md` (copied into the new repo in Task 1).

## Global Constraints

- Odoo **19.0** stable; addon `version: "19.0.1.0.0"`, `license: "LGPL-3"`, `depends: ["web"]`, `excludes: ["web_enterprise", "web_responsive"]`.
- Addon path: `/Users/tariq/code/odoo-addons/web_theme_shadcn` (separate git repo). The `/Users/tariq/code/odoo` checkout must not be modified except `odoo.conf` (untracked).
- Never edit files under `/Users/tariq/code/odoo/addons/**`; extend via `patch()`, `t-inherit`, and manifest asset directives only.
- All CSS rules in the addon scoped under `.o_web_client` (or a `.o_shadcn_*` class); no `!important` unless a Bootstrap utility must be beaten (comment why).
- Every menu-like element keeps `data-menu-xmlid` and `data-section` attributes; the `.o_navbar_apps_menu` dropdown with `.o_app[data-menu-xmlid]` items must keep existing (Odoo tours depend on it).
- Palette / radii / typography exactly as listed in the spec "Visual tokens" section.
- Python files start with `# Part of Odoo. See LICENSE file for full copyright and licensing details.`; JS/SCSS files have no license header (Odoo convention).
- Tests: HOOT files end in `.test.js` and are declared in `web.assets_unit_tests`; the Python tour test is `@tagged('post_install', '-at_install')`.
- Run everything with the repo venv: `/Users/tariq/code/odoo/.venv/bin/python /Users/tariq/code/odoo/odoo-bin -c /Users/tariq/code/odoo/odoo.conf ...`. Use a throwaway DB `shadcn_test` for tests, never `odoo19`.

Shell shorthand used below (define in each shell):

```bash
ODOO=/Users/tariq/code/odoo
ODOO_BIN="$ODOO/.venv/bin/python $ODOO/odoo-bin -c $ODOO/odoo.conf"
ADDON=/Users/tariq/code/odoo-addons/web_theme_shadcn
```

---

## File map

| File | Responsibility |
|---|---|
| `web_theme_shadcn/__manifest__.py` | metadata + asset injection directives |
| `web_theme_shadcn/__init__.py` | empty (no Python models) |
| `static/src/scss/primary_variables.scss` | zinc palette, radii, fonts → `$o-*` vars |
| `static/src/scss/navbar.variables.scss` | `$o-navbar-*` vars (white bar) |
| `static/src/scss/bootstrap_overridden.scss` | `$btn-*`, `$input-*`, `$dropdown-*`, `$modal-*`… |
| `static/src/scss/fonts.scss` | `@font-face` IBM Plex Sans Arabic (400/500/600/700) |
| `static/src/scss/theme.scss` | component polish (control panel, form sheet, list, kanban, modal, tabs) |
| `static/src/webclient/webclient_layout.scss` | CSS grid for top bar / rail / panel / action |
| `static/src/webclient/menu_service_patch.js` | `getCurrentMenuId()` + `MENUS:CURRENT-CHANGED` |
| `static/src/webclient/navbar/navbar.js` | `patch(NavBar.prototype)`: panel state, hotkey, command palette, `adapt()` no-op |
| `static/src/webclient/navbar/navbar.xml` | replacement `web.NavBar` template |
| `static/src/webclient/navbar/navbar.scss` | top bar styling |
| `static/src/webclient/app_rail/app_rail.{js,xml,scss}` | `AppRail` component |
| `static/src/webclient/app_panel/app_panel.{js,xml,scss}` | `AppPanel` component |
| `static/tests/menu_service_patch.test.js` | HOOT |
| `static/tests/navbar.test.js` | HOOT |
| `static/tests/app_rail.test.js` | HOOT |
| `static/tests/app_panel.test.js` | HOOT |
| `static/tests/tours/web_theme_shadcn_tour.js` | tour |
| `tests/__init__.py`, `tests/test_assets.py`, `tests/test_ui.py` | bundle compile test, tour runner |
| `README.md` | usage, shortcuts, how to run tests |

---

### Task 1: Repository, addon skeleton, install

**Files:**
- Create: `/Users/tariq/code/odoo-addons/.gitignore`
- Create: `/Users/tariq/code/odoo-addons/docs/superpowers/specs/2026-09-02-web-theme-shadcn-design.md` (copy)
- Create: `/Users/tariq/code/odoo-addons/docs/superpowers/plans/2026-09-02-web-theme-shadcn.md` (copy)
- Create: `$ADDON/__manifest__.py`, `$ADDON/__init__.py`, `$ADDON/tests/__init__.py`, `$ADDON/tests/test_assets.py`
- Modify: `/Users/tariq/code/odoo/odoo.conf:2` (`addons_path`)

**Interfaces:**
- Produces: installed module `web_theme_shadcn`; the asset bundle names every later task appends to.

- [ ] **Step 1: Create the repo and copy the design docs**

```bash
mkdir -p /Users/tariq/code/odoo-addons/docs/superpowers/specs /Users/tariq/code/odoo-addons/docs/superpowers/plans
cd /Users/tariq/code/odoo-addons && git init -b main
cp /Users/tariq/code/odoo/docs/superpowers/specs/2026-09-02-web-theme-shadcn-design.md docs/superpowers/specs/
cp /Users/tariq/code/odoo/docs/superpowers/plans/2026-09-02-web-theme-shadcn.md docs/superpowers/plans/
printf '__pycache__/\n*.pyc\n.superpowers/\nnode_modules/\n' > .gitignore
```

- [ ] **Step 2: Write the failing bundle test**

`$ADDON/tests/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_assets
```

`$ADDON/tests/test_assets.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestShadcnAssets(TransactionCase):
    """The backend bundle must compile with the theme's SCSS injected."""

    def _compile(self, bundle_name):
        bundle = self.env["ir.qweb"]._get_asset_bundle(bundle_name, js=False, debug_assets=True)
        bundle.css()
        self.assertFalse(bundle.css_errors, "\n".join(bundle.css_errors))
        return bundle

    def test_backend_bundle_compiles(self):
        bundle = self._compile("web.assets_backend")
        self.assertTrue(bundle.files, "bundle is empty")

    def test_theme_files_are_in_backend_bundle(self):
        bundle = self._compile("web.assets_backend")
        urls = [f["url"] for f in bundle.files]
        self.assertTrue(
            any("web_theme_shadcn/static/src/scss/primary_variables.scss" in u for u in urls),
            "primary_variables.scss not injected",
        )
```

- [ ] **Step 3: Write the manifest and empty init**

`$ADDON/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
```

`$ADDON/__manifest__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    "name": "shadcn Backend Theme",
    "summary": "shadcn/ui-style backend: icon app rail, collapsible app panel, zinc palette",
    "version": "19.0.1.0.0",
    "category": "Hidden",
    "author": "Tariq Alwalidi",
    "license": "LGPL-3",
    "depends": ["web"],
    "excludes": ["web_enterprise", "web_responsive"],
    "installable": True,
    "auto_install": False,
    "assets": {
        "web._assets_primary_variables": [
            (
                "before",
                "web/static/src/scss/primary_variables.scss",
                "web_theme_shadcn/static/src/scss/primary_variables.scss",
            ),
            (
                "before",
                "web/static/src/**/*.variables.scss",
                "web_theme_shadcn/static/src/scss/navbar.variables.scss",
            ),
        ],
        "web._assets_backend_helpers": [
            (
                "before",
                "web/static/src/scss/bootstrap_overridden.scss",
                "web_theme_shadcn/static/src/scss/bootstrap_overridden.scss",
            ),
        ],
        "web.assets_backend": [
            "web_theme_shadcn/static/src/scss/fonts.scss",
            "web_theme_shadcn/static/src/webclient/**/*",
            "web_theme_shadcn/static/src/scss/theme.scss",
        ],
        "web.assets_unit_tests": [
            "web_theme_shadcn/static/tests/**/*.test.js",
        ],
        "web.assets_tests": [
            "web_theme_shadcn/static/tests/tours/**/*",
        ],
    },
}
```

Create the three SCSS files referenced above as **empty files with a comment** so the bundle resolves (they get real content in Task 2):

```bash
mkdir -p $ADDON/static/src/scss $ADDON/static/src/webclient $ADDON/static/tests/tours
for f in primary_variables navbar.variables bootstrap_overridden fonts theme; do
  printf '// web_theme_shadcn: %s (filled in Task 2)\n' "$f" > $ADDON/static/src/scss/$f.scss
done
```

- [ ] **Step 4: Add the repo to `addons_path`**

Edit `/Users/tariq/code/odoo/odoo.conf` line 2 so it ends with `,/Users/tariq/code/odoo-addons`:

```
addons_path = /Users/tariq/code/odoo/addons,/Users/tariq/code/oca/project,/Users/tariq/code/oca/hr,/Users/tariq/code/oca/web,/Users/tariq/code/odoo-addons
```

- [ ] **Step 5: Install in a scratch DB and run the test**

```bash
$ODOO_BIN -d shadcn_test -i web_theme_shadcn --test-tags /web_theme_shadcn --stop-after-init
```
Expected: `web_theme_shadcn` installs, `0 failed, 0 error(s)`, `test_theme_files_are_in_backend_bundle` PASS (it passes already because the empty files are injected; the point is the harness works).

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: addon skeleton and asset bundle test"
```

---

### Task 2: Visual tokens (SCSS variables + IBM Plex Sans Arabic)

**Files:**
- Modify: `$ADDON/static/src/scss/primary_variables.scss`
- Modify: `$ADDON/static/src/scss/navbar.variables.scss`
- Modify: `$ADDON/static/src/scss/bootstrap_overridden.scss`
- Modify: `$ADDON/static/src/scss/fonts.scss`
- Create: `$ADDON/static/src/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.woff2`, `$ADDON/static/src/fonts/ibm-plex-sans-arabic/LICENSE.txt`
- Modify: `$ADDON/tests/test_assets.py`

**Interfaces:**
- Produces: CSS custom properties `--o-shadcn-rail-width: 56px`, `--o-shadcn-panel-width: 224px`, `--o-shadcn-topbar-height: 48px` on `:root` (consumed by Task 4 layout), and SCSS vars `$o-shadcn-zinc-*` available in every later SCSS file.

- [ ] **Step 1: Extend the bundle test to assert the tokens made it into the CSS**

Append to `TestShadcnAssets` in `$ADDON/tests/test_assets.py`:
```python
    def test_tokens_present_in_compiled_css(self):
        bundle = self._compile("web.assets_backend")
        css = bundle.css().raw.decode()
        self.assertIn("--o-shadcn-rail-width:56px", css.replace(" ", ""))
        self.assertIn("font-family:IBMPlexSansArabic", css.replace(" ", "").replace('"', ""))
        # primary button must be zinc-900, not Odoo purple
        self.assertNotIn("#71639e", css.lower())
```

- [ ] **Step 2: Run it to see it fail**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags /web_theme_shadcn:TestShadcnAssets.test_tokens_present_in_compiled_css --stop-after-init
```
Expected: FAIL (`--o-shadcn-rail-width` not found).

- [ ] **Step 3: Download IBM Plex Sans Arabic (SIL OFL 1.1)**

Source: the official npm package `@ibm/plex-sans-arabic` (IBM, ~2 MB tarball); we keep only four woff2 files (~50 KB each) and the license.

```bash
mkdir -p $ADDON/static/src/fonts/ibm-plex-sans-arabic /tmp/plex && cd /tmp/plex
npm pack @ibm/plex-sans-arabic --silent
tar -xzf ibm-plex-sans-arabic-*.tgz
ls package/fonts/complete/woff2/
for w in Regular Medium SemiBold Bold; do
  cp package/fonts/complete/woff2/IBMPlexSansArabic-$w.woff2 $ADDON/static/src/fonts/ibm-plex-sans-arabic/
done
cp package/LICENSE.txt $ADDON/static/src/fonts/ibm-plex-sans-arabic/LICENSE.txt
```

If `package/fonts/complete/woff2/` does not exist in the tarball version you get, run `find package -name "*.woff2"` and copy the four weights from wherever they are; the file names are stable.

- [ ] **Step 4: Write `fonts.scss`**

```scss
@each $weight, $file in (400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold") {
    @font-face {
        font-family: "IBM Plex Sans Arabic";
        font-style: normal;
        font-weight: $weight;
        font-display: swap;
        src: url("/web_theme_shadcn/static/src/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-#{$file}.woff2") format("woff2");
    }
}
```

- [ ] **Step 5: Write `primary_variables.scss`**

```scss
// shadcn/ui "zinc" tokens. Injected BEFORE web/static/src/scss/primary_variables.scss,
// so every `!default` below wins over Odoo's value.

$o-shadcn-zinc-50:  #fafafa;
$o-shadcn-zinc-100: #f4f4f5;
$o-shadcn-zinc-200: #e4e4e7;
$o-shadcn-zinc-300: #d4d4d8;
$o-shadcn-zinc-400: #a1a1aa;
$o-shadcn-zinc-500: #71717a;
$o-shadcn-zinc-600: #52525b;
$o-shadcn-zinc-700: #3f3f46;
$o-shadcn-zinc-800: #27272a;
$o-shadcn-zinc-900: #18181b;
$o-shadcn-zinc-950: #09090b;

$o-shadcn-rail-width: 56px;
$o-shadcn-panel-width: 224px;
$o-shadcn-topbar-height: 48px;

// Grays
$o-white: #ffffff !default;
$o-black: $o-shadcn-zinc-950 !default;
$o-gray-100: $o-shadcn-zinc-50 !default;
$o-gray-200: $o-shadcn-zinc-100 !default;
$o-gray-300: $o-shadcn-zinc-200 !default;
$o-gray-400: $o-shadcn-zinc-300 !default;
$o-gray-500: $o-shadcn-zinc-400 !default;
$o-gray-600: $o-shadcn-zinc-500 !default;
$o-gray-700: $o-shadcn-zinc-600 !default;
$o-gray-800: $o-shadcn-zinc-700 !default;
$o-gray-900: $o-shadcn-zinc-800 !default;

// Brand
$o-community-color: $o-shadcn-zinc-900 !default;
$o-brand-odoo: $o-shadcn-zinc-900 !default;
$o-brand-primary: $o-shadcn-zinc-900 !default;
$o-brand-secondary: $o-shadcn-zinc-500 !default;
$o-brand-lightsecondary: $o-shadcn-zinc-100 !default;
$o-action: $o-shadcn-zinc-900 !default;

$o-success: #16a34a !default;
$o-info: #0ea5e9 !default;
$o-warning: #f59e0b !default;
$o-danger: #dc2626 !default;

// Radii
$o-border-radius: .5rem !default;
$o-border-radius-sm: .375rem !default;
$o-border-radius-lg: .75rem !default;

// Type
$o-system-fonts: ("IBM Plex Sans Arabic", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji") !default;
$o-font-weight-bold: 600 !default;

// Surfaces & text
$o-webclient-background-color: $o-shadcn-zinc-50 !default;
$o-view-background-color: $o-white !default;
$o-main-text-color: $o-shadcn-zinc-900 !default;
$o-main-headings-color: $o-shadcn-zinc-950 !default;
$o-main-color-muted: $o-shadcn-zinc-500 !default;
$o-main-link-color: $o-shadcn-zinc-900 !default;

$o-component-active-color: $o-shadcn-zinc-900 !default;
$o-component-active-bg: $o-shadcn-zinc-100 !default;
$o-component-active-border: $o-shadcn-zinc-900 !default;

$o-input-bg: $o-white !default;
$o-form-lightsecondary: $o-shadcn-zinc-200 !default;
$o-shadow-color: $o-shadcn-zinc-950 !default;

:root {
    --o-shadcn-rail-width: #{$o-shadcn-rail-width};
    --o-shadcn-panel-width: #{$o-shadcn-panel-width};
    --o-shadcn-topbar-height: #{$o-shadcn-topbar-height};
}
```

Note: `$o-headings-font-family` in Odoo is built from `$o-system-fonts`, so
setting `$o-system-fonts` covers body *and* headings.

- [ ] **Step 6: Write `navbar.variables.scss`**

```scss
$o-navbar-height: 48px !default;
$o-navbar-background: #ffffff !default;
$o-navbar-border-bottom: 1px solid #e4e4e7 !default;
$o-navbar-entry-padding-h: .5rem !default;
$o-navbar-entry-margin-h: .125rem !default;
$o-navbar-entry-border-radius: .375rem !default;
$o-navbar-entry-color: #3f3f46 !default;
$o-navbar-entry-color--hover: #18181b !default;
$o-navbar-entry-bg--hover: #f4f4f5 !default;
$o-navbar-entry-color--active: #18181b !default;
$o-navbar-entry-bg--active: #f4f4f5 !default;
$o-navbar-brand-color: #18181b !default;
$o-navbar-badge-bg: #18181b !default;
$o-navbar-badge-color: #ffffff !default;
$o-navbar-badge-text-shadow: none !default;
```

- [ ] **Step 7: Write `bootstrap_overridden.scss`**

```scss
// Injected BEFORE web/static/src/scss/bootstrap_overridden.scss ($o-* already defined).
$btn-border-radius: .5rem !default;
$btn-border-radius-sm: .375rem !default;
$btn-padding-y: .5rem !default;
$btn-padding-x: 1rem !default;
$btn-font-weight: 500 !default;
$btn-focus-width: 2px !default;
$btn-box-shadow: none !default;

$input-border-width: 1px !default;
$input-border-color: #e4e4e7 !default;
$input-focus-border-color: #18181b !default;
$input-focus-box-shadow: 0 0 0 2px #fff, 0 0 0 4px #18181b !default;
$input-border-radius: .5rem !default;

$box-shadow-sm: 0 1px 2px rgba(0, 0, 0, .05) !default;
$box-shadow: 0 4px 12px rgba(0, 0, 0, .08) !default;

$dropdown-border-color: #e4e4e7 !default;
$dropdown-border-radius: .5rem !default;
$dropdown-box-shadow: 0 4px 12px rgba(0, 0, 0, .08) !default;
$dropdown-link-hover-bg: #f4f4f5 !default;
$dropdown-link-active-bg: #f4f4f5 !default;
$dropdown-link-active-color: #18181b !default;
$dropdown-item-padding-y: .375rem !default;

$modal-content-border-radius: .75rem !default;
$modal-content-border-color: #e4e4e7 !default;
$modal-backdrop-opacity: .6 !default;

$table-border-color: #e4e4e7 !default;
$table-hover-bg: #fafafa !default;

$badge-border-radius: 9999px !default;
$badge-font-weight: 500 !default;

$nav-tabs-border-color: #e4e4e7 !default;
$nav-tabs-link-active-border-color: transparent transparent #18181b !default;
$nav-tabs-link-active-color: #18181b !default;

$tooltip-bg: #18181b !default;
$tooltip-border-radius: .375rem !default;
$popover-border-color: #e4e4e7 !default;
$popover-border-radius: .5rem !default;
```

- [ ] **Step 8: Run the test until it passes**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags /web_theme_shadcn:TestShadcnAssets --stop-after-init
```
Expected: 3 tests PASS. If `css_errors` lists an undefined variable, the offending var is used before Odoo defines it — move it to `bootstrap_overridden.scss` (later in the pipeline).

- [ ] **Step 9: Eyeball it**

Start the server (`$ODOO_BIN -d shadcn_test --dev=xml`), log in `admin/admin`, open Project. Expected: white navbar, IBM Plex Sans Arabic font (check an Arabic label too), black primary buttons, zinc grays. The navbar is still Odoo's horizontal one — that is Task 4.

- [ ] **Step 10: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: zinc palette, radii, IBM Plex Sans Arabic tokens"
```

---

### Task 3: Menu service patch — current menu tracking

**Files:**
- Create: `$ADDON/static/src/webclient/menu_service_patch.js`
- Test: `$ADDON/static/tests/menu_service_patch.test.js`

**Interfaces:**
- Produces: `env.services.menu.getCurrentMenuId(): number | undefined`; bus event `MENUS:CURRENT-CHANGED` on `env.bus` every time `setCurrentMenu` is called.
- Consumes: `menuService` from `@web/webclient/menus/menu_service` (object with `async start(env)`).

- [ ] **Step 1: Write the failing test**

`$ADDON/static/tests/menu_service_patch.test.js`:
```js
import { expect, test } from "@odoo/hoot";
import { defineMenus, getService, makeMockEnv } from "@web/../tests/web_test_helpers";

test("menu service exposes the current menu id and notifies changes", async () => {
    defineMenus([
        { id: 1, name: "App1", children: [{ id: 11, name: "Sub", appID: 1, actionID: 5 }] },
    ]);
    const env = await makeMockEnv();
    const menu = getService("menu");
    expect(menu.getCurrentMenuId()).toBe(undefined);

    const events = [];
    env.bus.addEventListener("MENUS:CURRENT-CHANGED", () => events.push("changed"));

    menu.setCurrentMenu(11);
    expect(menu.getCurrentMenuId()).toBe(11);
    expect(menu.getCurrentApp().id).toBe(1);
    expect(events).toEqual(["changed"]);

    menu.setCurrentMenu(menu.getMenu(1));
    expect(menu.getCurrentMenuId()).toBe(1);
    expect(events).toEqual(["changed", "changed"]);
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn]" --stop-after-init
```
Expected: FAIL — `menu.getCurrentMenuId is not a function`. (The `[@web_theme_shadcn]` param filters HOOT to this addon's suites; the runner needs Chrome.)

- [ ] **Step 3: Implement the patch**

`$ADDON/static/src/webclient/menu_service_patch.js`:
```js
import { patch } from "@web/core/utils/patch";
import { menuService } from "@web/webclient/menus/menu_service";

patch(menuService, {
    async start(env) {
        const service = await super.start(env);
        let currentMenuId;
        const setCurrentMenu = service.setCurrentMenu;
        return Object.assign(service, {
            setCurrentMenu(menu) {
                setCurrentMenu.call(service, menu);
                const menuObj = typeof menu === "number" ? service.getMenu(menu) : menu;
                currentMenuId = menuObj?.id;
                env.bus.trigger("MENUS:CURRENT-CHANGED");
            },
            getCurrentMenuId() {
                return currentMenuId;
            },
        });
    },
});
```

- [ ] **Step 4: Run the test to see it pass**

Same command as Step 2. Expected: `[HOOT] Test suite succeeded`.

- [ ] **Step 5: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: track current menu id in menu service"
```

---

### Task 4: Layout grid + NavBar patch + top bar template

**Files:**
- Create: `$ADDON/static/src/webclient/webclient_layout.scss`
- Create: `$ADDON/static/src/webclient/navbar/navbar.js`
- Create: `$ADDON/static/src/webclient/navbar/navbar.xml`
- Create: `$ADDON/static/src/webclient/navbar/navbar.scss`
- Test: `$ADDON/static/tests/navbar.test.js`

**Interfaces:**
- Consumes: `NavBar` from `@web/webclient/navbar/navbar` (getters `currentApp`, `currentAppSections`, `systrayItems`, `isScopedApp`; methods `onNavBarDropdownItemSelection(menu)`, `getMenuItemHref(menu)`, `_openAppMenuSidebar()`, `_closeAppMenuSidebar()`; `state.isAppMenuSidebarOpened`; `this.ui.isSmall`).
- Produces on `NavBar.prototype`: `state.panelCollapsed: boolean`, `togglePanel()`, `openCommandPalette()`, `onRailAppSelected(app)`, `onPanelMenuSelected(menu)`; static components `AppRail`, `AppPanel` (stub classes in this task, real ones in Tasks 5–6). Template `web.NavBar` renders `.o_shadcn_topbar`, and slots `<AppRail/>` / `<AppPanel/>` with these props:
  - `AppRail` props: `{ apps: Array, currentApp: Object|undefined, onSelect: Function, getHref: Function }`
  - `AppPanel` props: `{ app: Object|undefined, sections: Array, currentMenuId: Number|undefined, onSelect: Function, getHref: Function }`
- localStorage key: `"web_theme_shadcn.panel"` with value `"collapsed"` or `"expanded"`.

- [ ] **Step 1: Write the failing tests**

`$ADDON/static/tests/navbar.test.js`:
```js
import { beforeEach, expect, test } from "@odoo/hoot";
import { press } from "@odoo/hoot-dom";
import { animationFrame } from "@odoo/hoot-mock";
import {
    contains,
    defineMenus,
    mountWithCleanup,
    patchWithCleanup,
} from "@web/../tests/web_test_helpers";
import { browser } from "@web/core/browser/browser";
import { NavBar } from "@web/webclient/navbar/navbar";

beforeEach(() => {
    defineMenus([
        { id: 1, name: "Project", xmlid: "project.menu_main_pm", actionID: 10 },
        { id: 2, name: "Employees", xmlid: "hr.menu_hr_root", actionID: 20 },
    ]);
    browser.localStorage.removeItem("web_theme_shadcn.panel");
});

test.tags("desktop");
test("top bar keeps the apps dropdown used by Odoo tours", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_topbar").toHaveCount(1);
    expect(".o_navbar_apps_menu button").toHaveCount(1);
    await contains(".o_navbar_apps_menu button").click();
    expect('.o_app[data-menu-xmlid="project.menu_main_pm"]').toHaveCount(1);
    expect('.o_app[data-menu-xmlid="hr.menu_hr_root"]').toHaveCount(1);
});

test.tags("desktop");
test("rail and panel are rendered on desktop", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_rail").toHaveCount(1);
    expect(".o_shadcn_panel").toHaveCount(1);
});

test.tags("desktop");
test("panel collapses with the toggle button and persists", async () => {
    await mountWithCleanup(NavBar);
    await contains(".o_shadcn_panel_toggle").click();
    expect(".o_shadcn_panel").toHaveCount(0);
    expect(browser.localStorage.getItem("web_theme_shadcn.panel")).toBe("collapsed");
    await contains(".o_shadcn_panel_toggle").click();
    expect(".o_shadcn_panel").toHaveCount(1);
    expect(browser.localStorage.getItem("web_theme_shadcn.panel")).toBe("expanded");
});

test.tags("desktop");
test("panel collapses with control+b", async () => {
    await mountWithCleanup(NavBar);
    await press(["control", "b"]);
    await animationFrame();
    expect(".o_shadcn_panel").toHaveCount(0);
});

test.tags("desktop");
test("panel starts collapsed when localStorage says so", async () => {
    browser.localStorage.setItem("web_theme_shadcn.panel", "collapsed");
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_panel").toHaveCount(0);
});

test.tags("desktop");
test("search button opens the command palette", async () => {
    const calls = [];
    patchWithCleanup(NavBar.prototype, {
        setup() {
            super.setup();
            this.command = { openMainPalette: (...args) => calls.push(args) };
        },
    });
    await mountWithCleanup(NavBar);
    await contains(".o_shadcn_search").click();
    expect(calls).toHaveLength(1);
});

test.tags("mobile");
test("no rail or panel on small screens; burger sidebar still works", async () => {
    await mountWithCleanup(NavBar);
    expect(".o_shadcn_rail").toHaveCount(0);
    expect(".o_shadcn_panel").toHaveCount(0);
    expect(".o_menu_toggle").toHaveCount(1);
});
```

- [ ] **Step 2: Run to see them fail**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn]" --stop-after-init
```
Expected: FAIL — `.o_shadcn_topbar` count 0.

- [ ] **Step 3: Write the layout SCSS**

`$ADDON/static/src/webclient/webclient_layout.scss`:
```scss
// Turn the web client into a 2-row / 3-column grid:
//   row 1: top bar (full width)
//   row 2: rail | panel | action manager
@include media-only(screen) {
    .o_web_client {
        display: grid;
        grid-template-rows: var(--o-shadcn-topbar-height) minmax(0, 1fr);
        grid-template-columns: var(--o-shadcn-rail-width) var(--o-shadcn-panel-width) minmax(0, 1fr);
        grid-template-areas:
            "topbar topbar topbar"
            "rail panel action";

        &.o_shadcn_panel_collapsed {
            grid-template-columns: var(--o-shadcn-rail-width) 0 minmax(0, 1fr);
        }

        > .o_navbar { grid-area: topbar; min-width: 0; }
        > .o_shadcn_rail { grid-area: rail; }
        > .o_shadcn_panel { grid-area: panel; min-width: 0; }
        > .o_action_manager { grid-area: action; min-width: 0; height: auto; }

        // small screens: single column, the original burger sidebar is used
        @include media-breakpoint-down(md) {
            grid-template-columns: minmax(0, 1fr);
            grid-template-areas: "topbar" "action";
        }
    }
}
```

`.o_shadcn_panel_collapsed` is toggled on `.o_web_client` by the NavBar (see JS) — it is the only place the layout and the component meet.

- [ ] **Step 4: Write the NavBar patch**

`$ADDON/static/src/webclient/navbar/navbar.js`:
```js
import { Component, useEffect, useState, xml } from "@odoo/owl";
import { browser } from "@web/core/browser/browser";
import { useHotkey } from "@web/core/hotkeys/hotkey_hook";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { NavBar } from "@web/webclient/navbar/navbar";

export const PANEL_STORAGE_KEY = "web_theme_shadcn.panel";

// Stubs replaced by the real components in Tasks 5 and 6.
export class AppRail extends Component {
    static template = xml`<nav class="o_shadcn_rail"/>`;
    static props = ["apps", "currentApp", "onSelect", "getHref"];
}
export class AppPanel extends Component {
    static template = xml`<aside class="o_shadcn_panel"/>`;
    static props = ["app", "sections", "currentMenuId", "onSelect", "getHref"];
}

patch(NavBar, {
    components: { ...NavBar.components, AppRail, AppPanel },
});

patch(NavBar.prototype, {
    setup() {
        super.setup();
        this.command = useService("command");
        this.shadcn = useState({
            panelCollapsed: browser.localStorage.getItem(PANEL_STORAGE_KEY) === "collapsed",
        });
        useHotkey("control+b", () => this.togglePanel(), { global: true });

        const onCurrentChanged = () => this.render();
        this.env.bus.addEventListener("MENUS:CURRENT-CHANGED", onCurrentChanged);
        useEffect(
            () => {
                const client = this.root.el?.closest(".o_web_client");
                client?.classList.toggle("o_shadcn_panel_collapsed", this.shadcn.panelCollapsed);
            },
            () => [this.shadcn.panelCollapsed, this.root.el]
        );
        useEffect(
            () => () => this.env.bus.removeEventListener("MENUS:CURRENT-CHANGED", onCurrentChanged),
            () => []
        );
    },

    // No horizontal section menu to fit anymore.
    async adapt() {},

    get currentMenuId() {
        return this.menuService.getCurrentMenuId?.();
    },

    togglePanel() {
        this.shadcn.panelCollapsed = !this.shadcn.panelCollapsed;
        browser.localStorage.setItem(
            PANEL_STORAGE_KEY,
            this.shadcn.panelCollapsed ? "collapsed" : "expanded"
        );
    },

    openCommandPalette() {
        this.command.openMainPalette({});
    },

    onRailAppSelected(app) {
        this.onNavBarDropdownItemSelection(app);
    },

    onPanelMenuSelected(menu) {
        this.onNavBarDropdownItemSelection(menu);
    },
});
```

- [ ] **Step 5: Write the replacement template**

`$ADDON/static/src/webclient/navbar/navbar.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">

  <t t-name="web_theme_shadcn.NavBar" t-inherit="web.NavBar" t-inherit-mode="primary">
    <xpath expr="//header[@class='o_navbar']" position="replace">
      <header class="o_navbar" t-ref="root">
        <nav class="o_main_navbar o_shadcn_topbar d-print-none" data-command-category="disabled">

          <!-- Apps dropdown (kept for tours) / burger on mobile -->
          <t t-call="web.NavBar.AppsMenu">
            <t t-set="apps" t-value="menuService.getApps()"/>
          </t>

          <!-- Panel toggle (desktop) -->
          <button t-if="!this.ui.isSmall"
                  class="o_shadcn_panel_toggle btn btn-link"
                  title="Toggle menu (Ctrl+B)"
                  t-on-click="togglePanel">
            <i class="fa fa-columns" aria-hidden="true"/>
          </button>

          <!-- Current app name on mobile only (desktop shows it in the panel) -->
          <span t-if="this.ui.isSmall and currentApp" class="o_menu_brand" t-esc="currentApp.name"/>

          <div class="o_navbar_breadcrumbs d-contents"/>

          <!-- Command palette -->
          <button class="o_shadcn_search btn" t-on-click="openCommandPalette">
            <i class="fa fa-search me-2" aria-hidden="true"/>
            <span class="d-none d-md-inline">Search…</span>
            <kbd class="d-none d-md-inline ms-3">⌘K</kbd>
          </button>

          <!-- Systray -->
          <div class="o_menu_systray d-flex flex-shrink-0 ms-auto bg-inherit" role="menu">
            <t t-foreach="systrayItems" t-as="item" t-key="item.key">
              <div t-att-data-index="item.index"/>
              <ErrorHandler onError="error => this.handleItemError(error, item)">
                <t t-component="item.Component" t-props="item.props"/>
              </ErrorHandler>
            </t>
          </div>
        </nav>
      </header>

      <AppRail t-if="!this.ui.isSmall"
               apps="menuService.getApps()"
               currentApp="currentApp"
               onSelect.bind="onRailAppSelected"
               getHref.bind="getMenuItemHref"/>

      <AppPanel t-if="!this.ui.isSmall and !shadcn.panelCollapsed"
                app="currentApp"
                sections="currentAppSections"
                currentMenuId="currentMenuId"
                onSelect.bind="onPanelMenuSelected"
                getHref.bind="getMenuItemHref"/>
    </xpath>
  </t>

</templates>
```

Because the `NavBar` class still declares `static template = "web.NavBar"`, the inherited template must **be** `web.NavBar`. Set it in `navbar.js` after the patch: add `NavBar.template = "web_theme_shadcn.NavBar";` right after the `patch(NavBar, {...})` call.

- [ ] **Step 6: Write the top bar SCSS**

`$ADDON/static/src/webclient/navbar/navbar.scss`:
```scss
.o_web_client .o_shadcn_topbar {
    align-items: center;
    gap: .25rem;
    padding: 0 .75rem;

    .o_navbar_apps_menu > .o-dropdown > button,
    .o_shadcn_panel_toggle {
        @extend %-main-navbar-entry-base;
        height: 2rem;
        padding: 0 .5rem;
        border: 0;
        color: #3f3f46;
        &:hover { background: #f4f4f5; color: #18181b; }
    }

    .o_shadcn_search {
        display: inline-flex;
        align-items: center;
        height: 2rem;
        margin-inline-start: .5rem;
        padding: 0 .625rem;
        border: 1px solid #e4e4e7;
        border-radius: .5rem;
        background: #fafafa;
        color: #71717a;
        font-size: .8125rem;
        font-weight: 400;
        &:hover { background: #f4f4f5; color: #18181b; }
        kbd {
            padding: 0 .3rem;
            border: 1px solid #e4e4e7;
            border-radius: .25rem;
            background: #fff;
            color: #71717a;
            font-size: .6875rem;
        }
    }
}
```

- [ ] **Step 7: Run the tests to see them pass**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn],/web:MobileWebSuite.test_unit_mobile[@web_theme_shadcn]" --stop-after-init
```
Expected: `[HOOT] Test suite succeeded` for both.

- [ ] **Step 8: Run Odoo's own navbar tests to catch regressions**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web/webclient/navbar]" --stop-after-init
```
Expected: tests that click `.o_menu_sections` (horizontal sections) will FAIL — that is by design (the sections moved to the panel). Record the failing test names in the commit message; all others PASS. If a test unrelated to sections fails, fix the patch.

- [ ] **Step 9: Eyeball**

Start server, reload. Expected: white top bar, empty rail strip (56px) and empty panel column (224px) left of the views, `Ctrl+B` collapses the column, apps dropdown still opens.

- [ ] **Step 10: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: grid layout, top bar and NavBar patch"
```

---

### Task 5: AppRail component

**Files:**
- Create: `$ADDON/static/src/webclient/app_rail/app_rail.js`, `app_rail.xml`, `app_rail.scss`
- Modify: `$ADDON/static/src/webclient/navbar/navbar.js` (remove the `AppRail` stub, import the real one)
- Test: `$ADDON/static/tests/app_rail.test.js`

**Interfaces:**
- Produces: `AppRail` component, `static props = { apps, currentApp, onSelect, getHref }`, template `web_theme_shadcn.AppRail`, root `<nav class="o_shadcn_rail" role="navigation" aria-label="Apps">`, one `<a class="o_shadcn_rail_app" data-menu-xmlid data-section title>` per app, `.active` on current.

- [ ] **Step 1: Write the failing test**

`$ADDON/static/tests/app_rail.test.js`:
```js
import { expect, test } from "@odoo/hoot";
import { contains, mountWithCleanup } from "@web/../tests/web_test_helpers";
import { AppRail } from "@web_theme_shadcn/webclient/app_rail/app_rail";

const apps = [
    { id: 1, name: "Project", xmlid: "project.menu_main_pm", actionID: 10, webIconData: "data:image/png;base64,AAA" },
    { id: 2, name: "Employees", xmlid: "hr.menu_hr_root", actionID: 20 },
];

test("renders one link per app with tour-compatible attributes", async () => {
    await mountWithCleanup(AppRail, {
        props: { apps, currentApp: apps[0], onSelect: () => {}, getHref: (m) => `/odoo/action-${m.actionID}` },
    });
    expect(".o_shadcn_rail_app").toHaveCount(2);
    expect('.o_shadcn_rail_app[data-menu-xmlid="project.menu_main_pm"]').toHaveClass("active");
    expect('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"]').toHaveAttribute("href", "/odoo/action-20");
    expect('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"]').toHaveAttribute("title", "Employees");
    expect('.o_shadcn_rail_app[data-menu-xmlid="project.menu_main_pm"] img').toHaveCount(1);
    // app without icon shows its initial
    expect('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"] .o_shadcn_rail_initial').toHaveText("E");
});

test("clicking an app calls onSelect and prevents navigation", async () => {
    const selected = [];
    await mountWithCleanup(AppRail, {
        props: { apps, currentApp: undefined, onSelect: (app) => selected.push(app.id), getHref: () => "#" },
    });
    await contains('.o_shadcn_rail_app[data-menu-xmlid="hr.menu_hr_root"]').click();
    expect(selected).toEqual([2]);
});
```

- [ ] **Step 2: Run to see it fail**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn/app_rail]" --stop-after-init
```
Expected: FAIL — module `@web_theme_shadcn/webclient/app_rail/app_rail` not found.

- [ ] **Step 3: Implement the component**

`$ADDON/static/src/webclient/app_rail/app_rail.js`:
```js
import { Component } from "@odoo/owl";

export class AppRail extends Component {
    static template = "web_theme_shadcn.AppRail";
    static props = {
        apps: Array,
        currentApp: { type: Object, optional: true },
        onSelect: Function,
        getHref: Function,
    };

    onClick(ev, app) {
        ev.preventDefault();
        this.props.onSelect(app);
    }
}
```

`$ADDON/static/src/webclient/app_rail/app_rail.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">
  <t t-name="web_theme_shadcn.AppRail">
    <nav class="o_shadcn_rail d-print-none" role="navigation" aria-label="Apps">
      <t t-foreach="props.apps" t-as="app" t-key="app.id">
        <a class="o_shadcn_rail_app"
           t-att-class="{ active: props.currentApp and props.currentApp.id === app.id }"
           t-att-href="props.getHref(app)"
           t-att-title="app.name"
           t-att-data-menu-xmlid="app.xmlid"
           t-att-data-section="app.id"
           t-on-click="(ev) => this.onClick(ev, app)">
          <img t-if="app.webIconData" t-att-src="app.webIconData" t-att-alt="app.name"/>
          <span t-else="" class="o_shadcn_rail_initial" t-esc="app.name[0]"/>
        </a>
      </t>
    </nav>
  </t>
</templates>
```

`$ADDON/static/src/webclient/app_rail/app_rail.scss`:
```scss
.o_web_client .o_shadcn_rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .25rem;
    padding: .5rem 0;
    background: #fff;
    border-inline-end: 1px solid #e4e4e7;
    overflow-y: auto;

    .o_shadcn_rail_app {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: .5rem;
        color: #52525b;
        text-decoration: none;
        font-weight: 600;
        &:hover { background: #f4f4f5; color: #18181b; }
        &.active { background: #18181b; color: #fff; }
        &:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #18181b; }
        img { width: 1.5rem; height: 1.5rem; border-radius: .25rem; }
        &.active img { filter: brightness(0) invert(1); }
    }
}
```

Then in `navbar.js`: delete the `AppRail` stub class and add
`import { AppRail } from "@web_theme_shadcn/webclient/app_rail/app_rail";`.

- [ ] **Step 4: Run the rail + navbar tests**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn]" --stop-after-init
```
Expected: PASS.

- [ ] **Step 5: Eyeball** — rail shows app icons; the active app is black; clicking switches apps and the URL changes.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: AppRail component"
```

---

### Task 6: AppPanel component (accordion menu tree)

**Files:**
- Create: `$ADDON/static/src/webclient/app_panel/app_panel.js`, `app_panel.xml`, `app_panel.scss`
- Modify: `$ADDON/static/src/webclient/navbar/navbar.js` (remove the `AppPanel` stub, import the real one)
- Test: `$ADDON/static/tests/app_panel.test.js`

**Interfaces:**
- Produces: `AppPanel` component, `static props = { app, sections, currentMenuId, onSelect, getHref }`, root `<aside class="o_shadcn_panel">`, entries `<a class="o_shadcn_panel_item" data-menu-xmlid data-section>`, groups `<button class="o_shadcn_panel_group" aria-expanded>`; level-1 entries carry `data-hotkey="1".."9"`.
- Consumes: `sections` = `menuService.getMenuAsTree(app.id).childrenTree` (each node: `{ id, name, xmlid, actionID, actionPath, childrenTree: [] }`).

- [ ] **Step 1: Write the failing test**

`$ADDON/static/tests/app_panel.test.js`:
```js
import { expect, test } from "@odoo/hoot";
import { contains, mountWithCleanup } from "@web/../tests/web_test_helpers";
import { AppPanel } from "@web_theme_shadcn/webclient/app_panel/app_panel";

const app = { id: 1, name: "Project", xmlid: "project.menu_main_pm" };
const sections = [
    { id: 11, name: "Tasks", xmlid: "project.menu_tasks", actionID: 101, childrenTree: [] },
    {
        id: 12, name: "Configuration", xmlid: "project.menu_config", childrenTree: [
            { id: 121, name: "Stages", xmlid: "project.menu_stages", actionID: 102, childrenTree: [] },
            { id: 122, name: "Tags", xmlid: "project.menu_tags", actionID: 103, childrenTree: [] },
        ],
    },
];
const getHref = (m) => `/odoo/action-${m.actionID}`;

test("renders the app name and the section tree", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: undefined, onSelect: () => {}, getHref },
    });
    expect(".o_shadcn_panel_title").toHaveText("Project");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tasks"]').toHaveAttribute("href", "/odoo/action-101");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tasks"]').toHaveAttribute("data-hotkey", "1");
    expect('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').toHaveAttribute("aria-expanded", "false");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').toHaveCount(0);
});

test("group toggles open and closed", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: undefined, onSelect: () => {}, getHref },
    });
    await contains('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').click();
    expect('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').toHaveAttribute("aria-expanded", "true");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').toHaveCount(1);
    await contains('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').click();
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').toHaveCount(0);
});

test("active item is highlighted and its group is expanded by default", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: 122, onSelect: () => {}, getHref },
    });
    expect('.o_shadcn_panel_group[data-menu-xmlid="project.menu_config"]').toHaveAttribute("aria-expanded", "true");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tags"]').toHaveClass("active");
    expect('.o_shadcn_panel_item[data-menu-xmlid="project.menu_stages"]').not.toHaveClass("active");
});

test("clicking an item calls onSelect", async () => {
    const selected = [];
    await mountWithCleanup(AppPanel, {
        props: { app, sections, currentMenuId: undefined, onSelect: (m) => selected.push(m.id), getHref },
    });
    await contains('.o_shadcn_panel_item[data-menu-xmlid="project.menu_tasks"]').click();
    expect(selected).toEqual([11]);
});

test("renders nothing useful without an app", async () => {
    await mountWithCleanup(AppPanel, {
        props: { app: undefined, sections: [], currentMenuId: undefined, onSelect: () => {}, getHref },
    });
    expect(".o_shadcn_panel").toHaveCount(1);
    expect(".o_shadcn_panel_item").toHaveCount(0);
});
```

- [ ] **Step 2: Run to see it fail**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn/app_panel]" --stop-after-init
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`$ADDON/static/src/webclient/app_panel/app_panel.js`:
```js
import { Component, onWillUpdateProps, useState } from "@odoo/owl";

export class AppPanel extends Component {
    static template = "web_theme_shadcn.AppPanel";
    static props = {
        app: { type: Object, optional: true },
        sections: Array,
        currentMenuId: { type: Number, optional: true },
        onSelect: Function,
        getHref: Function,
    };

    setup() {
        this.state = useState({ open: new Set(this.ancestorsOf(this.props.currentMenuId, this.props.sections)) });
        onWillUpdateProps((next) => {
            for (const id of this.ancestorsOf(next.currentMenuId, next.sections)) {
                this.state.open.add(id);
            }
        });
    }

    /** ids of every group that contains `menuId`, from the root down */
    ancestorsOf(menuId, nodes, path = []) {
        if (!menuId) {
            return [];
        }
        for (const node of nodes) {
            if (node.id === menuId) {
                return path;
            }
            if (node.childrenTree.length) {
                const found = this.ancestorsOf(menuId, node.childrenTree, [...path, node.id]);
                if (found.length || node.childrenTree.some((c) => c.id === menuId)) {
                    return found.length ? found : [...path, node.id];
                }
            }
        }
        return [];
    }

    isOpen(node) {
        return this.state.open.has(node.id);
    }

    toggle(node) {
        if (this.state.open.has(node.id)) {
            this.state.open.delete(node.id);
        } else {
            this.state.open.add(node.id);
        }
    }

    hotkeyFor(index, depth) {
        return depth === 0 && index < 9 ? String(index + 1) : undefined;
    }

    onClick(ev, node) {
        ev.preventDefault();
        this.props.onSelect(node);
    }
}
```

`$ADDON/static/src/webclient/app_panel/app_panel.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">

  <t t-name="web_theme_shadcn.AppPanel">
    <aside class="o_shadcn_panel d-print-none" role="navigation" t-att-aria-label="props.app ? props.app.name : 'Menu'">
      <div t-if="props.app" class="o_shadcn_panel_title" t-esc="props.app.name"/>
      <ul class="o_shadcn_panel_list">
        <t t-call="web_theme_shadcn.AppPanel.Nodes">
          <t t-set="nodes" t-value="props.sections"/>
          <t t-set="depth" t-value="0"/>
        </t>
      </ul>
    </aside>
  </t>

  <t t-name="web_theme_shadcn.AppPanel.Nodes">
    <t t-foreach="nodes" t-as="node" t-key="node.id">
      <li t-if="node.childrenTree.length" class="o_shadcn_panel_li">
        <button class="o_shadcn_panel_group"
                t-att-aria-expanded="isOpen(node) ? 'true' : 'false'"
                t-att-data-menu-xmlid="node.xmlid"
                t-att-data-section="node.id"
                t-att-data-hotkey="hotkeyFor(node_index, depth)"
                t-attf-style="padding-inline-start: {{ .75 + depth * .75 }}rem"
                t-on-click="() => this.toggle(node)">
          <span t-esc="node.name"/>
          <i class="fa fa-chevron-right o_shadcn_panel_chevron" aria-hidden="true"/>
        </button>
        <ul t-if="isOpen(node)" class="o_shadcn_panel_list">
          <t t-call="web_theme_shadcn.AppPanel.Nodes">
            <t t-set="nodes" t-value="node.childrenTree"/>
            <t t-set="depth" t-value="depth + 1"/>
          </t>
        </ul>
      </li>
      <li t-else="" class="o_shadcn_panel_li">
        <a class="o_shadcn_panel_item"
           t-att-class="{ active: node.id === props.currentMenuId }"
           t-att-href="props.getHref(node)"
           t-att-data-menu-xmlid="node.xmlid"
           t-att-data-section="node.id"
           t-att-data-hotkey="hotkeyFor(node_index, depth)"
           t-attf-style="padding-inline-start: {{ .75 + depth * .75 }}rem"
           t-on-click="(ev) => this.onClick(ev, node)">
          <span t-esc="node.name"/>
        </a>
      </li>
    </t>
  </t>

</templates>
```

`$ADDON/static/src/webclient/app_panel/app_panel.scss`:
```scss
.o_web_client .o_shadcn_panel {
    display: flex;
    flex-direction: column;
    background: #fafafa;
    border-inline-end: 1px solid #e4e4e7;
    overflow-y: auto;

    .o_shadcn_panel_title {
        padding: .875rem .75rem .5rem;
        font-size: .875rem;
        font-weight: 600;
        color: #18181b;
    }

    .o_shadcn_panel_list { list-style: none; margin: 0; padding: 0 .5rem; }
    .o_shadcn_panel_list .o_shadcn_panel_list { padding: 0; }

    .o_shadcn_panel_item,
    .o_shadcn_panel_group {
        display: flex;
        align-items: center;
        width: 100%;
        min-height: 2rem;
        padding-inline-end: .5rem;
        border: 0;
        border-radius: .375rem;
        background: transparent;
        color: #3f3f46;
        font-size: .8125rem;
        font-weight: 500;
        text-align: start;
        text-decoration: none;
        &:hover { background: #f4f4f5; color: #18181b; }
        &:focus-visible { outline: none; box-shadow: 0 0 0 2px #fafafa, 0 0 0 4px #18181b; }
    }
    .o_shadcn_panel_item.active { background: #e4e4e7; color: #18181b; }

    .o_shadcn_panel_chevron {
        margin-inline-start: auto;
        font-size: .625rem;
        color: #a1a1aa;
        transition: transform .15s ease;
    }
    .o_shadcn_panel_group[aria-expanded="true"] .o_shadcn_panel_chevron { transform: rotate(90deg); }
}
```

Then in `navbar.js`: delete the `AppPanel` stub class and add
`import { AppPanel } from "@web_theme_shadcn/webclient/app_panel/app_panel";`.

- [ ] **Step 4: Run all addon HOOT tests**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn]" --stop-after-init
```
Expected: PASS. If `ancestorsOf` mis-detects nesting, the "active item… expanded by default" test tells you.

- [ ] **Step 5: Eyeball** — open Project: panel shows "Project" and Tasks / Reporting / Configuration; Configuration expands; the active entry is highlighted after navigating; `1`… hotkeys (with Alt) still jump to level-1 entries.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: AppPanel accordion menu"
```

---

### Task 7: Component polish (`theme.scss`)

**Files:**
- Modify: `$ADDON/static/src/scss/theme.scss`
- Modify: `$ADDON/tests/test_assets.py`

**Interfaces:** none (pure CSS).

- [ ] **Step 1: Extend the compile test**

Append to `TestShadcnAssets`:
```python
    def test_theme_rules_present(self):
        css = self._compile("web.assets_backend").css().raw.decode().replace(" ", "")
        for selector in (".o_web_client.o_form_sheet", ".o_web_client.o_kanban_record", ".o_web_client.o_control_panel"):
            self.assertIn(selector, css, f"{selector} missing from theme.scss output")
```

- [ ] **Step 2: Run to see it fail**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags /web_theme_shadcn:TestShadcnAssets.test_theme_rules_present --stop-after-init
```
Expected: FAIL.

- [ ] **Step 3: Write `theme.scss`**

```scss
// Component polish that variables alone cannot express. Everything scoped to .o_web_client.
.o_web_client {
    // ---- Control panel
    .o_control_panel {
        background: #fff;
        border-bottom: 1px solid #e4e4e7;
        box-shadow: none;
        .o_breadcrumb .o_last_breadcrumb_item { font-weight: 600; color: #18181b; }
        .o_breadcrumb .breadcrumb-item a { color: #71717a; &:hover { color: #18181b; } }
    }
    .o_searchview {
        background: #fff;
        border: 1px solid #e4e4e7;
        border-radius: .5rem;
        &:focus-within { border-color: #18181b; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #18181b; }
    }

    // ---- Buttons
    .btn-secondary, .btn-outline-secondary {
        background: #fff;
        border-color: #e4e4e7;
        color: #18181b;
        &:hover { background: #f4f4f5; border-color: #e4e4e7; color: #18181b; }
    }
    .btn:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #18181b; }

    // ---- Form view
    .o_form_view .o_form_sheet_bg { background: #fafafa; }
    .o_form_sheet {
        background: #fff;
        border: 1px solid #e4e4e7;
        border-radius: .75rem;
        box-shadow: 0 1px 2px rgba(0, 0, 0, .05);
    }
    .o_form_view .o_form_statusbar { background: #fff; border-bottom: 1px solid #e4e4e7; }
    .o_notebook .nav-tabs {
        border-bottom: 1px solid #e4e4e7;
        .nav-link {
            border: 0;
            border-bottom: 2px solid transparent;
            color: #71717a;
            font-weight: 500;
            &.active { color: #18181b; border-bottom-color: #18181b; background: transparent; }
        }
    }

    // ---- List view
    .o_list_view {
        .o_list_table thead {
            background: #fafafa;
            th {
                color: #71717a;
                font-size: .75rem;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: .04em;
                border-bottom: 1px solid #e4e4e7;
            }
        }
        .o_list_table tbody td { border-color: #f4f4f5; }
        .o_data_row:hover { background: #fafafa; }
        .o_data_row.o_data_row_selected { background: #f4f4f5; }
    }

    // ---- Kanban
    .o_kanban_view .o_kanban_group { background: transparent; }
    .o_kanban_view .o_kanban_header .o_column_title { color: #18181b; font-weight: 600; }
    .o_kanban_record {
        background: #fff;
        border: 1px solid #e4e4e7;
        border-radius: .5rem;
        box-shadow: none;
        &:hover { box-shadow: 0 1px 2px rgba(0, 0, 0, .05); border-color: #d4d4d8; }
    }

    // ---- Dialogs
    .modal-content { border: 1px solid #e4e4e7; }
    .modal-header { border-bottom: 0; .modal-title { font-weight: 600; color: #18181b; } }
    .modal-footer { border-top: 1px solid #f4f4f5; }

    // ---- Misc surfaces
    .o_notification { border-radius: .5rem; border: 1px solid #e4e4e7; }
    .o-dropdown--menu { padding: .25rem; }
    .o-dropdown--menu .dropdown-item { border-radius: .375rem; }
}
```

- [ ] **Step 4: Run the test to see it pass**

Same command as Step 2. Expected: PASS.

- [ ] **Step 5: Eyeball each view** — Project kanban, Tasks list, one task form (tabs, statusbar), a dialog (e.g. "Add a stage"), a dropdown. Fix spacing that looks off; keep every rule scoped.

- [ ] **Step 6: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: component polish for control panel, form, list, kanban, dialogs"
```

---

### Task 8: Tour + regression run against Odoo's own tours

**Files:**
- Create: `$ADDON/static/tests/tours/web_theme_shadcn_tour.js`
- Create: `$ADDON/tests/test_ui.py`
- Modify: `$ADDON/tests/__init__.py`

**Interfaces:**
- Consumes: DOM from Tasks 4–6 (`.o_shadcn_rail_app[data-menu-xmlid]`, `.o_shadcn_panel_item[data-menu-xmlid]`, `.o_shadcn_panel_toggle`).

- [ ] **Step 1: Write the tour**

`$ADDON/static/tests/tours/web_theme_shadcn_tour.js`:
```js
import { registry } from "@web/core/registry";

registry.category("web_tour.tours").add("web_theme_shadcn_tour", {
    url: "/odoo",
    steps: () => [
        {
            content: "Rail is visible on desktop",
            trigger: ".o_web_client .o_shadcn_rail",
        },
        {
            content: "Open Settings from the rail",
            trigger: '.o_shadcn_rail_app[data-menu-xmlid="base.menu_administration"]',
            run: "click",
        },
        {
            content: "Panel shows the Settings menus",
            trigger: '.o_shadcn_panel_item[data-menu-xmlid="base.menu_users"], .o_shadcn_panel_group[data-menu-xmlid="base.menu_users"]',
            run: "click",
        },
        {
            content: "Users list is displayed",
            trigger: '.o_shadcn_panel_item[data-menu-xmlid="base.menu_action_res_users"]',
            run: "click",
        },
        {
            content: "List view rendered",
            trigger: ".o_list_view .o_data_row",
        },
        {
            content: "Collapse the panel",
            trigger: ".o_shadcn_panel_toggle",
            run: "click",
        },
        {
            content: "Panel is gone, content still there",
            trigger: ".o_web_client.o_shadcn_panel_collapsed .o_list_view",
        },
        {
            content: "Apps dropdown still works (tour compat)",
            trigger: ".o_navbar_apps_menu button:enabled",
            run: "click",
        },
        {
            content: "Apps listed",
            trigger: '.o_app[data-menu-xmlid="base.menu_administration"]',
        },
    ],
});
```

`base` is always installed, so Settings → Users & Companies → Users is a safe path (`base.menu_users` is the "Users & Companies" group, `base.menu_action_res_users` the Users action).

- [ ] **Step 2: Write the Python runner**

`$ADDON/tests/__init__.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import test_assets
from . import test_ui
```

`$ADDON/tests/test_ui.py`:
```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestShadcnUi(HttpCase):
    def test_shadcn_tour(self):
        self.start_tour("/odoo", "web_theme_shadcn_tour", login="admin")
```

- [ ] **Step 3: Run the tour**

```bash
$ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags /web_theme_shadcn:TestShadcnUi --stop-after-init
```
Expected: PASS. On failure the screenshot lands in the `--screenshots` dir printed in the log; the failing step's `content` tells you which selector broke.

- [ ] **Step 4: Regression — run Odoo's web + project tours with the theme installed**

```bash
$ODOO_BIN -d shadcn_test -i project --test-tags /web:TestUi,/project --stop-after-init 2>&1 | tee /tmp/shadcn_regression.log
grep -E "ERROR|FAIL|Tour .* failed" /tmp/shadcn_regression.log
```
Expected: no tour failures. Known acceptable failures: none — any failing tour means a selector we broke; fix the template (usually a missing `data-menu-xmlid` or a hidden `.o_app`). Record the result in the commit message.

- [ ] **Step 5: Commit**

```bash
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: tour and regression run

Odoo web/project tours pass with the theme installed."
```

---

### Task 9: Lint, README, final check

**Files:**
- Create: `$ADDON/README.md`
- Modify: any file flagged by ruff/eslint

- [ ] **Step 1: Ruff**

```bash
cd /Users/tariq/code/odoo && ruff check /Users/tariq/code/odoo-addons/web_theme_shadcn
```
Expected: `All checks passed!` (uses the repo's `ruff.toml`). Fix anything reported.

- [ ] **Step 2: ESLint (one-time tooling setup, answer `n` to the enterprise prompt)**

```bash
cd /Users/tariq/code/odoo && ls .eslintrc.json >/dev/null 2>&1 || bash addons/web/tooling/enable.sh
npx eslint --no-eslintrc -c .eslintrc.json /Users/tariq/code/odoo-addons/web_theme_shadcn/static
```
Expected: no errors. Fix anything reported.

- [ ] **Step 3: Write the README**

`$ADDON/README.md`:
```markdown
# shadcn Backend Theme (web_theme_shadcn)

Odoo 19.0 community backend restyled after shadcn/ui: icon app rail,
collapsible app panel, white top bar, zinc palette, IBM Plex Sans Arabic.

## Install
Add `/Users/tariq/code/odoo-addons` to `addons_path`, then
`odoo-bin -d <db> -i web_theme_shadcn`.

## Shortcuts
- `Ctrl/⌘ + B` — collapse / expand the app panel (state is remembered per browser)
- `Ctrl/⌘ + K` — command palette (search apps, menus, records)
- `Alt + 1…9` — jump to the first-level menus of the current app (Odoo default)

## Tests
    ODOO_BIN="python odoo-bin -c odoo.conf"
    $ODOO_BIN -d shadcn_test -i web_theme_shadcn --test-tags /web_theme_shadcn --stop-after-init
    $ODOO_BIN -d shadcn_test -u web_theme_shadcn --test-tags "/web:WebSuite.test_unit_desktop[@web_theme_shadcn]" --stop-after-init

## Compatibility
Excludes `web_enterprise` and `web_responsive` (they replace the same navbar).
Odoo tours keep working: the `.o_navbar_apps_menu` dropdown and every
`data-menu-xmlid` attribute are preserved.

IBM Plex Sans Arabic is © IBM Corp., SIL Open Font License 1.1
(`static/src/fonts/ibm-plex-sans-arabic/LICENSE.txt`).
```

- [ ] **Step 4: Full test run from a fresh DB**

```bash
$ODOO/.venv/bin/python $ODOO/odoo-bin -c $ODOO/odoo.conf db drop shadcn_test 2>/dev/null || true
$ODOO_BIN -d shadcn_test -i web_theme_shadcn,project --test-tags "/web_theme_shadcn,/web:WebSuite.test_unit_desktop[@web_theme_shadcn]" --stop-after-init
```
Expected: `0 failed, 0 error(s)`.

- [ ] **Step 5: Install on the real dev DB and commit**

```bash
$ODOO_BIN -d odoo19 -i web_theme_shadcn --stop-after-init
cd /Users/tariq/code/odoo-addons && git add -A && git commit -m "[ADD] web_theme_shadcn: README and lint fixes"
```

Restart the dev server (`$ODOO_BIN` without `--stop-after-init`) and open http://localhost:8069.

---

## Self-review

- **Spec coverage:** tokens → Task 2; grid layout, top bar, apps dropdown kept, `Ctrl+B`, localStorage, mobile fallback → Task 4; rail → Task 5; panel accordion, hotkeys, active item → Task 6 (+ Task 3 for current-menu tracking); component polish → Task 7; tour + regression → Task 8; lint/README → Task 9. RTL: no code needed (rtlcss); verify manually in Task 9 Step 5 by switching the user language to Arabic. Print: rail/panel carry `d-print-none` (Tasks 5–6).
- **Placeholders:** none; each SCSS/JS/XML file is given in full.
- **Type consistency:** `AppRail`/`AppPanel` prop names match between the Task 4 stubs, the Task 4 template, and Tasks 5–6; `getCurrentMenuId()` (Task 3) is what `NavBar.currentMenuId` (Task 4) and `AppPanel.currentMenuId` (Task 6) use; localStorage key `web_theme_shadcn.panel` with values `collapsed`/`expanded` is identical in Task 4 JS, tests and README.
