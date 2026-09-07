# web_theme_shadcn — Design Spec

**Date:** 2026-09-02
**Target:** Odoo 19.0 (stable), community backend only
**Status:** Approved for planning

## Goal

A backend theme addon that restyles the Odoo web client to the look and
structure of [shadcn/ui](https://ui.shadcn.com/) (default neutral/zinc theme):
a fixed icon **app rail**, a collapsible **app panel** listing the current
app's menus, a thin white **top bar**, IBM Plex Sans Arabic typography (Arabic + Latin), zinc palette, soft
borders, `0.5rem` radii, subtle shadows. The action area (control panel,
views) keeps its existing structure and is only restyled.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope | Backend web client only. No portal/website, no dark mode. |
| Palette / font | shadcn default: zinc grays, primary = zinc-900 (`#18181b`). Font: IBM Plex Sans Arabic (user's brand font, covers Arabic and Latin, SIL OFL). |
| Approach | Full theme with template changes (navbar → rail + panel). |
| Sidebar structure | Icon rail (all apps) + secondary panel (current app's menus). |
| Top bar | Control panel stays inside the action area; top bar holds ☰, ⌘K, systray, user. |
| Panel behavior | Collapsible, `Ctrl/⌘+B`, state persisted in `localStorage`; offcanvas on mobile. |

## Addon layout

Location: `/Users/tariq/code/odoo-addons/web_theme_shadcn/` — a separate git
repository for custom addons (the `odoo` checkout tracks upstream and must stay
clean). `/Users/tariq/code/odoo-addons` is appended to `addons_path` in
`odoo.conf`.

```
web_theme_shadcn/
├── __manifest__.py                 # depends: ['web'], excludes: ['web_enterprise','web_responsive']
├── static/src/
│   ├── scss/
│   │   ├── primary_variables.scss  # before web/static/src/scss/primary_variables.scss
│   │   ├── bootstrap_overridden.scss # before web/static/src/scss/bootstrap_overridden.scss
│   │   ├── navbar.variables.scss   # before web/static/src/**/*.variables.scss
│   │   ├── fonts.scss              # @font-face IBM Plex Sans Arabic (woff2, local)
│   │   └── theme.scss              # appended last to web.assets_backend
│   ├── fonts/ibm-plex-sans-arabic/*.woff2, LICENSE.txt (OFL)
│   └── webclient/
│       ├── webclient_layout.scss   # .o_web_client → CSS grid (top bar / rail / panel / action)
│       ├── navbar/navbar.xml       # t-inherit="web.NavBar" t-inherit-mode="primary" → full replacement
│       ├── navbar/navbar.js        # patch(NavBar.prototype): panel state, hotkey, adapt() no-op
│       ├── navbar/navbar.scss
│       ├── app_rail/app_rail.{js,xml,scss}
│       └── app_panel/app_panel.{js,xml,scss}
├── static/tests/
│   ├── navbar.test.js              # HOOT, web.assets_unit_tests
│   └── tours/shadcn_tour.js        # web.assets_tests
└── tests/test_ui.py                # HttpCase, post_install
```

Manifest assets:

```python
"assets": {
    "web._assets_primary_variables": [
        ("before", "web/static/src/scss/primary_variables.scss",
         "web_theme_shadcn/static/src/scss/primary_variables.scss"),
        ("before", "web/static/src/**/*.variables.scss",
         "web_theme_shadcn/static/src/scss/navbar.variables.scss"),
    ],
    "web._assets_backend_helpers": [
        ("before", "web/static/src/scss/bootstrap_overridden.scss",
         "web_theme_shadcn/static/src/scss/bootstrap_overridden.scss"),
    ],
    "web.assets_backend": [
        "web_theme_shadcn/static/src/scss/fonts.scss",
        "web_theme_shadcn/static/src/webclient/**/*",
        "web_theme_shadcn/static/src/scss/theme.scss",
    ],
    "web.assets_unit_tests": ["web_theme_shadcn/static/tests/**/*.test.js"],
    "web.assets_tests": ["web_theme_shadcn/static/tests/tours/**/*"],
}
```

All Odoo/Bootstrap variables are declared with `!default`, so a file injected
*before* them wins (same mechanism as OCA `web_dark_mode`).

## Components

### Layout

`web.WebClient` template is untouched (`<NavBar/>` then `<ActionContainer/>`).
`webclient_layout.scss` turns `.o_web_client` into a grid:

```
grid-template-rows: 48px 1fr;
grid-template-columns: 56px var(--o-shadcn-panel-width, 224px) 1fr;
```

- `header.o_navbar` spans row 1, all columns.
- `.o_shadcn_rail` (rendered inside `NavBar`, positioned into row 2 / col 1
  via `grid-area`), `.o_shadcn_panel` (row 2 / col 2), `.o_action_manager`
  (row 2 / col 3). When the panel is collapsed the middle column is `0`.
- On `ui.isSmall`: one column, no rail/panel; ☰ opens the existing
  `web.NavBar.AppsMenu.Sidebar` offcanvas (restyled).
- Print: rail and panel get `d-print-none` like the existing navbar.

### NavBar (patched)

`patch(NavBar.prototype, {...})` keeps every existing getter/method
(`currentApp`, `currentAppSections`, `systrayItems`, `onNavBarDropdownItemSelection`,
`getMenuItemHref`, sidebar open/close/swipe handlers) and adds:

- `state.panelCollapsed` (initialised from `localStorage["web_theme_shadcn.panel"]`,
  written on change).
- `togglePanel()`; `useHotkey("control+b", togglePanel)`.
- `openCommandPalette()` → `this.command.openMainPalette()` (`command` service).
- `adapt()` overridden to return immediately (no horizontal sections to fit).
- `static components` extended with `AppRail`, `AppPanel`.

The replacement template `web.NavBar` renders:

```
<header class="o_navbar">
  <nav class="o_main_navbar d-print-none">
    apps dropdown  — `.o_navbar_apps_menu` Dropdown with `.o_app[data-menu-xmlid]`
                     items, kept verbatim from web.NavBar.AppsMenu so the 41
                     Odoo tours using stepUtils.showAppsMenuItem() keep working
                     (on mobile this is the existing ☰ offcanvas)
    ☰ toggle       — desktop only: togglePanel()
    ⌘K button      — openCommandPalette()
    systray        — unchanged loop over systrayItems (user menu lives here)
  </nav>
</header>
<AppRail t-if="!ui.isSmall" .../>
<AppPanel t-if="!ui.isSmall and !state.panelCollapsed" .../>
```

### Current-menu tracking (`menu_service_patch.js`)

The `menu` service only tracks the current *app*. The addon patches
`menuService.start` to wrap the returned `setCurrentMenu` so it records the
menu id, exposes `getCurrentMenuId()`, and triggers `MENUS:CURRENT-CHANGED`
on `env.bus`. `AppPanel` uses this to highlight the active entry.

### AppRail

Props: `apps`, `currentApp`, `onSelect(app)`.
Renders `<nav role="navigation" aria-label="Apps">` with one `<a>` per app:
`href = getMenuItemHref(app)`, `data-menu-xmlid`, `data-section`, `title`,
36×36 icon from `app.webIconData` (fallback: first letter), active state
`bg zinc-900 / white icon`. Rail links use class `o_shadcn_rail_app` (not
`o_app`) so tour selectors keep matching the apps dropdown only. No footer:
the user menu stays in the systray.

### AppPanel

Props: `app`, `sections` (`currentAppSections`), `currentMenuId`, `onSelect(menu)`.
Header: app name (`fw-semibold`). Body: accordion tree.

- Level 1 items: `<a>` with `data-hotkey="1..9"` (same numbering Odoo uses),
  `data-menu-xmlid`, `data-section`.
- Items with `childrenTree`: header row with chevron, `aria-expanded`,
  children indented; expanded by default when they contain the active item.
- Active item = `menuService.getCurrentMenuId()`; ancestors of the active
  item are expanded.
- Re-renders on `MENUS:APP-CHANGED` (existing) and `MENUS:CURRENT-CHANGED`
  (added by the menu service patch).

## Visual tokens

`primary_variables.scss`:

| Variable | Value |
|---|---|
| `$o-gray-100..900` | `#fafafa #f4f4f5 #e4e4e7 #d4d4d8 #a1a1aa #71717a #52525b #3f3f46 #27272a` |
| `$o-black` | `#09090b` (zinc-950) |
| `$o-brand-primary`, `$o-brand-odoo`, `$o-action` | `#18181b` |
| `$o-success / info / warning / danger` | `#16a34a / #0ea5e9 / #f59e0b / #dc2626` |
| `$o-border-radius / -sm / -lg` | `.5rem / .375rem / .75rem` |
| `$o-font-family-sans-serif` | `"IBM Plex Sans Arabic", <system stack>` |
| `$o-headings-font-family` | same as sans-serif |
| `$o-webclient-background-color` | `#fafafa` |
| `$o-view-background-color` | `#fff` |
| `$o-component-active-bg` | `#f4f4f5`; `$o-component-active-border: #18181b` |
| `$o-input-bg` | `#fff`; `$o-form-lightsecondary: #e4e4e7` |
| `$o-main-link-color` | `#18181b` |
| `$o-main-color-muted` | `#71717a` |

`navbar.variables.scss`: `$o-navbar-height: 48px`, `$o-navbar-background: #fff`,
`$o-navbar-border-bottom: 1px solid #e4e4e7`, entry colors zinc-700/zinc-900,
hover bg `#f4f4f5`, `$o-navbar-entry-border-radius: .375rem`.

`bootstrap_overridden.scss`: `$btn-border-radius: .5rem`, `$btn-padding-y: .5rem`,
`$btn-padding-x: 1rem`, `$btn-font-weight: 500`, `$input-border-width: 1px`,
`$input-focus-box-shadow: 0 0 0 2px #fff, 0 0 0 4px #18181b`,
`$box-shadow-sm: 0 1px 2px rgba(0,0,0,.05)`, `$dropdown-border-color: #e4e4e7`,
`$dropdown-border-radius: .5rem`, `$dropdown-box-shadow: 0 4px 12px rgba(0,0,0,.08)`,
`$modal-content-border-radius: .75rem`, `$modal-backdrop-opacity: .6`,
`$table-border-color: #e4e4e7`, `$badge-border-radius: 9999px`,
`$nav-tabs-link-active-border-color: transparent transparent #18181b`.

`theme.scss` (all rules scoped under `.o_web_client`):

- `.o_control_panel`: white, `border-bottom: 1px solid zinc-200`, no shadow.
- `.o_form_sheet`: `border 1px zinc-200`, `radius .75rem`, `shadow-sm`, white.
- `.o_list_view thead th`: zinc-500, `font-size .75rem`, uppercase, `letter-spacing .04em`.
- `.o_kanban_record`: `border 1px zinc-200`, `radius .5rem`, no shadow, hover `shadow-sm`.
- `.modal-content`: `border 1px zinc-200`; `.modal-header` no border, title `font-weight 600`.
- `.o_notebook .nav-tabs`: bottom-line style, active underline zinc-900.
- `.btn-secondary`: white bg, zinc-200 border, zinc-900 text (shadcn "outline").
- `.o_searchview`: white, zinc-200 border, radius `.5rem`.
- Focus-visible ring on buttons/links: `0 0 0 2px #fff, 0 0 0 4px #18181b`.

## Behaviour

- Collapse: `Ctrl+B` / `⌘B` and the ☰ button toggle the panel on desktop;
  persisted per browser in `localStorage`.
- Mobile (`ui.isSmall`): no rail/panel; ☰ opens the original app-menu
  offcanvas; swipe handlers stay.
- App change: `MENUS:APP-CHANGED` triggers re-render (existing listener).
- RTL: no special handling; Odoo runs SCSS through rtlcss. Verified manually
  with `lang=ar_001`.
- Accessibility: real `<a href>` links, `title` on rail icons, `aria-expanded`
  on accordions, visible focus ring, `role="navigation"` landmarks.
- Tours: every menu element keeps `data-menu-xmlid` and `data-section`, so
  Odoo's own tour selectors (`.o_app[data-menu-xmlid=...]`,
  `[data-menu-xmlid=...]`) keep matching. Rail links carry class `o_app`.

## Testing

- **HOOT** `static/tests/navbar.test.js` (`web.assets_unit_tests`):
  rail renders one link per app; clicking selects the app; panel shows the
  app's section tree with active item; `Ctrl+B` collapses and writes
  `localStorage`; `isSmall` renders neither rail nor panel.
- **Tour** `shadcn_tour.js` + `tests/test_ui.py` (`@tagged('post_install','-at_install')`):
  login → click Project in rail → Tasks in panel → open a task → assert
  control panel and Save button work.
- **Regression**: run `--test-tags /web:TestUi` and `/project` tours with
  the theme installed to catch broken selectors.
- **Lint**: `ruff check`, `npx eslint` after `addons/web/tooling/enable.sh`.

## Out of scope

Dark mode, portal/website, breadcrumbs in the top bar, command palette
changes, per-user server-side preferences.

## Known limitations (discovered during implementation)

- `web._assets_primary_variables` is shared with `web.assets_frontend` by
  construction, so the zinc grays, radii and zinc-900 primary also reach
  portal/website pages. Typography is reset for the frontend by
  `static/src/scss/frontend_reset.scss` (injected into
  `web._assets_frontend_helpers`), so the portal keeps Odoo's default font.
- Odoo's clickbot walks `.o_menu_sections`, which no longer exists on desktop;
  with the theme installed it only exercises app switching.
- Dark mode is unsupported: the theme forces the light zinc palette.
- The horizontal section menu / "More" dropdown is gone on desktop; the app
  panel (`Ctrl/⌘+B`) replaces it. The desktop `.o_menu_brand` item and the
  `.o_navbar_apps_menu` dropdown are kept for tour compatibility.
