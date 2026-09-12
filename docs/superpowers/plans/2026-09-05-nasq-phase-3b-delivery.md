> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Nasq Phase 3b local delivery record

> تاريخي. السياسة: [DESIGN.md](../../../DESIGN.md). ليس تعليمات واجهة.

**Date:** 2026-09-05
**Branch:** `codex/phase-3b`
**Baseline:** `b17058a03a25c03b161b57c1558e0709dd6fd409`
**State:** Complete and reviewable locally; canonical `main` remains at the
pre-Phase-3b baseline. No merge, push, tag, deployment, or DNS change is
claimed.

## Delivered behavior

- `/hr` retains the directory and department-document workflows and adds
  employee create/edit/archive, archived views, department administration,
  and grant/reset/revoke access with effective employee/admin roles.
- Vendor-linked account role/access and archive controls are protected from
  HR admin mutations. Direct authorization tests cover employee, customer
  admin, foreign-company, and vendor boundaries.
- `/settings/branding` saves company name, primary colour, and logo with an
  immediate preview and persisted reload.
- `/account` changes the signed-in user's password while preserving the
  caller session and clearing credential fields on success and rejection.
- Session-token caches are cleared after successful password/access mutations.
  The caller token is derived from freshly flushed token fields, closing the
  concurrent cache-refill race without changing stock Odoo.
- `/api/v1/people` remains the PMO user-id picker. HR resources retain employee
  ids, `{items,total}` list envelopes, and all existing `HrDocument*` exports.

The integrated browser gate also exposed two legacy hydration races. Project
rows now use project ids as Vue keys and hold the SSR skeleton until their
component mounts. Query-driven task table/board surfaces mount after the page
hydrates, while the static toolbar remains present and disabled until its
listeners are ready.

## Final local evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Fresh Odoo install and four-addon test tags | `182` tests, `0 failed`, `0 errors` | `/Users/tariq/code/nasq-phase3b-run-20260905/final4-odoo.log` |
| Contracts unit | `52` passed | `/Users/tariq/code/nasq-phase3b-run-20260905/final-npm-test.log` |
| Web unit | `152` passed | `/Users/tariq/code/nasq-phase3b-run-20260905/final-npm-test.log` |
| Python style | passed | `/Users/tariq/code/nasq-phase3b-run-20260905/final4-ruff.log` |
| Vue/TypeScript | passed | `/Users/tariq/code/nasq-phase3b-run-20260905/final4-web-lint.log` |
| Fresh real-Odoo Playwright | `47` passed in 1.7 minutes | `/Users/tariq/code/nasq-phase3b-run-20260905/final4-playwright.log` |
| Production build | passed | `/Users/tariq/code/nasq-phase3b-run-20260905/final4-build.log` |
| Compatibility/security preservation | no failures or observations | `/Users/tariq/code/nasq-phase3b-run-20260905/final4-preservation.log` |

The Playwright database was created fresh as
`nasq_phase3b_e2e_final4_20260905_1653`. It used Odoo `9169`, Nuxt `3600`, a
`localhost` websocket URL matching the browser cookie host, and a
company-scoped customer-admin fixture. The account, branding, HR lifecycle,
contract, document, PMO, hydration, and realtime scenarios all ran in the same
47-case serial gate.

Before that final run, the three hydration-sensitive cases passed nine
consecutive focused executions. Deterministic regressions also cover the Odoo
session-cache refill race for access revoke/reset and self-password change.

## Review preview

The production build is available at `http://localhost:3200`, backed by the
isolated Odoo service at `http://127.0.0.1:9169` and database
`nasq_phase3b_e2e_final4_20260905_1653`. Its websocket URL is
`ws://localhost:9169/websocket`. Login, `/api/v1/me`, and authenticated `/hr`
returned HTTP 200 after startup. The preview log is
`/Users/tariq/code/nasq-phase3b-run-20260905/final4-preview.log`.

Use the company-scoped test customer admin for Phase 3b HR administration;
the stock Odoo administrator is the vendor role and intentionally does not
receive customer-admin mutation controls. The local test credential is stored
outside Git at
`/Users/tariq/code/nasq-phase3b-run-20260905/final4-preview-credentials.txt`
with owner-only permissions.

This preview and its scratch database are review artifacts. They do not alter
the canonical Odoo `8069`, Nuxt `3000`, or `odoo19` runtime.
