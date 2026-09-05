# Nasq component guide

`Components.html` is a standalone Arabic RTL preview of the approved component vocabulary. It includes working colour presets/custom HEX, scoped preview, save/cancel/default, filters, empty results, named icon controls and dialog examples. The demo saves only a preview colour in this browser; production colour settings use the company API and explicit admin save. Institution name and logo are read-only in Nasq and managed by the Odoo system administrator.

The original supplied guide is preserved beside the scratch preview as `Components.dc.before-unified-20260905.html`. The updated supplied URL remains `http://127.0.0.1:8877/Components.dc.html`.

Rebuild after changing `apps/web/app/utils/brandTheme.ts`:

```sh
node docs/design-system/build.mjs
```

The builder embeds the production colour utility and copies the existing licensed local fonts. It has no remote network/font dependency. Serve this folder with any static server to view the portable guide.

Browser verification on 2026-09-05: default and gold preview (black text, 13.71:1); save/reload; cancellation restores saved colour; malformed HEX blocks save; reset requires explicit save; search/empty/clear and open/closed filtering; 390px mobile has no document overflow. Production API verification is recorded separately in the implementation report.
