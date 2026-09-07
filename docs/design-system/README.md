# Nasq design system

The sole current UI policy is [DESIGN.md](../../DESIGN.md), approved for the new contextual navigation on 2026-09-07.

- [Approved interactive reference](reference/2026-09-07-header/index.html) and [provenance](reference/2026-09-07-header/README.md).
- [Shared component catalog](components.md).
- [Frontend/theme agent brief](../agents/frontend-theme.md).
- [Migration and retirement plan](migration.md).
- [Documentation inventory](documentation-inventory.md).

The reference contains demonstration data and hash navigation. It is not the production application and must not be imported as runtime code.
Existing Vue components, APIs, permissions and routes remain the implementation foundation.

## Historical references

`Components.html` and `approved-shell.html` are historical references, not alternative approved themes. Their old visual choices are superseded by DESIGN.md. Preserve licensing and existing evidence.
`build.mjs` rebuilds only the legacy colour/component demonstration; running it does not regenerate the current approved reference.
The earlier standalone guide exercised preview/save/cancel/default colour behavior. Production branding still uses the company API and explicit save; institution identity remains managed in Odoo.
