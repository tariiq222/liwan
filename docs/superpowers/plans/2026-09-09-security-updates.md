# Internal security updates implementation plan

**Goal:** Identify current security updates and apply tested compatible updates to the internal Nasq runtime.
**Architecture:** Preserve canonical Odoo source/config/Git and existing Python environment; use an independent official Odoo 19 clone and Python environment. Preserve Nasq meeting hardening. Keep source changes isolated on codex/security-updates; no commit/merge/push/cleanup authorized.
**Spec:** User request on 2026-09-09 to inspect security updates and apply internally; canonical AGENTS.md and CLAUDE.md.
**Tech stack:** Odoo 19 CE, Python 3.12, Nuxt 4, npm workspaces.

## Ownership and sequence
- [x] Root records main baseline c63d42f and installed runtime; audits in independent read-only Astra packages for official Odoo/Cyan and npm. Root audits Python.
- [x] Baseline npm contracts/web tests run before updates. Canonical databases never receive tests.
- [x] Root updates shared package manifests/lock: Vitest 4.1.11 in both workspaces; targeted Unovis MapLibre override 6.4.1. Preserve tests; run audit, complete npm tests, typecheck/build and chart smoke. Override is outside vendor-supported semver and requires explicit evidence.
- [x] Root creates independent Python environment from installed distributions, replaces vulnerable pins using PyPI versions, replaces unmaintained PyPDF2 with modern pypdf, checks resolver/audit/imports. Freeze complete resolved inventory to deploy/security/requirements-python312-macos.txt, documenting platform scope.
- [x] Luna owns deploy/security/odoo_secure.py and test_odoo_secure.py only: restore upstream pypdf bounded decompressor after Odoo import, reject old PDF adapter; write meaningful regression first, root runs RED then GREEN. Explicit --odoo-root and forwarded arguments; stock source stays unchanged.
- [x] Root updates separate Odoo clone to verified official 19.0 tip; inspect delta/advisories and preserve exact commit.
- [x] Root runs complete Nasq/Cyan Odoo tests on a fresh isolated DB/filestore/port with updated source/libraries. Review new failures against baseline and fix only caused compatibility regressions.
- [x] Root reviews combined changes and has independent review of launcher/security effects; rehearse upgrade on database backup with cron/mail neutralized and verify record/permission preservation.
- [x] Only after gates, back up stable internal DB/filestore, update internal runtime and verify authenticated API/chart/PDF paths; keep rollback environment. No production or Git integration claim.
- [x] Record exact advisories/fixed versions, tests, runtime status and any residual limitation in docs/security-updates-2026-09-09.md.

## Acceptance
Fresh npm/Python audit result with duplicates distinguished from unique advisories. No weakened checks or lost approved behavior. Successful tests demonstrate applicable layers only. Runtime and Git states reported separately; unresolved compatibility blocks promotion, not diagnosis. Original Odoo checkout/source and existing parallel work preserved.
