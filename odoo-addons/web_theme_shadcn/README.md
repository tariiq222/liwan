# shadcn Backend Theme (web_theme_shadcn)

> Scope: Odoo vendor-console theme only. This is not the Nasq Nuxt customer-UI theme. Customer UI follows [DESIGN.md](../../DESIGN.md); vendor-console implementation and licensing remain separate.

Odoo 19.0 community backend restyled after shadcn/ui: icon app rail,
collapsible app panel, white top bar, zinc palette, IBM Plex Sans Arabic.

## Install
Add `<path to this repo>` to `addons_path`, then
`odoo-bin -d <db> -i web_theme_shadcn`.

## Shortcuts
- `Ctrl/⌘ + B` — collapse / expand the app panel (state is remembered per browser)
- `Ctrl/⌘ + K` — command palette (search apps, menus, records)
- `Alt + 1…0` — focus/trigger the first-level entries of the current app (a group entry toggles open)

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

## Known limitations
- Odoo's clickbot (`web/static/src/webclient/clickbot`) walks `.o_menu_sections` to click through every menu; this theme removes that horizontal section menu on desktop, so clickbot only exercises app switching while the theme is installed, not the full first/second-level menu tree.
- The horizontal section menu and its "More" dropdown no longer exist on desktop — all app menus live in the collapsible app panel instead (`Ctrl/⌘ + B` toggles it).
- Portal / website pages share `web._assets_primary_variables` with the backend, so they inherit this theme's zinc grays, radii and zinc-900 primary colour. Only the typography is reset there (`static/src/scss/frontend_reset.scss`): the frontend keeps Odoo's default font stack.
- Dark mode (Odoo's light/dark toggle) is not supported; the theme forces the light zinc palette.
