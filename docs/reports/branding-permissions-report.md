# Institution identity permissions

> تاريخي. السياسة: [DESIGN.md](../../DESIGN.md). ليس تعليمات واجهة.

User-approved correction, 2026-09-05. Worktree `/Users/tariq/code/nasq-design-system`, branch `codex/design-system`, uncommitted.

- Odoo system administrators (`base.group_system`, including Nasq vendor support) manage institution name and logo through Odoo. Company name/logo continue to be the source for the public branding response and the Nasq preview.
- Nasq settings edit only the primary colour, with presets, draft preview, save/cancel/default, and an Arabic/English notice explaining where identity is managed. Name and upload controls are removed.
- The strict TypeScript PATCH schema and builder only emit `primary_color`. The server rejects name/logo fields with 403 for all API callers, including vendor support. Mixed identity/colour requests perform no write. Other unsupported fields and invalid HEX return 422; employee admin access remains forbidden.
- Company creation requires an Odoo system administrator. Obsolete partner identity ACL/rule grants are deactivated, including previously loaded noupdate rules.
- ORM guards block non-system writes to company identity, related partner identity, and backing field attachments (create including context defaults, old/new write targets, deletion). Ordinary contacts retain their existing permissions. A narrowly documented private read-only company classification uses sudo only to detect hidden/archived company partners and deny writes; no elevated write was added.

## Verification

Expected RED failures were observed for accepting identity fields in the contract, forwarding stale name/logo draft fields, direct API/ORM identity changes, and the editable name input. Independent review identified a direct field-attachment logo bypass; the new regression failed before the guard and passed after it.

- Full JavaScript suite: 202 passed (44 contracts, 158 web).
- Web typecheck and production build: passed.
- Addon Ruff and `git diff --check`: passed.
- Isolated Odoo core/API gate: 26 tests, 0 failures, 0 errors (23 post-install tests plus 3 at-install tests). DB `nasq_design_system_20260905`, explicit worktree addon paths, port 8177. Log `/tmp/nasq-branding-permissions-green-odoo.log`.
- Branding Playwright suite: 4 passed, covering colour-only requests, removed identity controls, persistence, invalid colour, presets, failed-save draft retention, and load retry. Log `/tmp/nasq-branding-permissions-e2e.log`.

Local preview: `http://127.0.0.1:3177/settings/branding`. Canonical `main` is clean. No commit, merge, push, deployment, or production database change was made.

Final scoped independent review: PASS, no remaining Critical/Important findings. The upgrade was exercised on the same previously installed isolated database; a read-only Odoo shell check confirmed `identity_rule_active=False` and `identity_acl_active=False`. The strengthened attachment regression also passed with customer-admin plus Contacts Creation privileges, including context-default creation and retargeting away from the protected field.
