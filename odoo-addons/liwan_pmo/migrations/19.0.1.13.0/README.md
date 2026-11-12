# Project finance capability

Version 19.0.1.13.0 adds the capability `pmo.finance.read` (project budget, expenses, cost figures and the cost
impact of change requests) and the company setting `finance_readers` (`managers` or `members`, default `managers`;
a company-suffixed config parameter, so there is no schema change and no stored value to backfill).

The permission record and the group `group_cap_pmo_finance_read` come from module data. The existing
`_liwan_configure_permission_dependencies` and `_liwan_repair_builtin_role_grants` hooks that run on every upgrade
link the new key to `pmo_manager` and `vendor_support`, and add it to every custom role that already holds
`pmo.projects.manage`.

No existing assignment is rewritten. A user who only reads projects no longer reads their finance after the
upgrade; the project's own manager and company-wide project managers keep it. Nothing needs a script.
