# 19.0.1.7.0

This version adds the payroll section over OCA `payroll` (pinned in `deploy/oca-addons.json`).
Schema additions are listed per task below. `post-payroll.py` carries `hr.enabled` onto `hr.payroll`.

Task 2: capabilities `hr.payroll.read|manage|approve|config`, the `payroll_manager` built-in role and the
`hr.payroll` sub-feature are XML/registry data. `post-payroll.py` copies the stored `hr.enabled` value
onto `hr.payroll` per tenant profile (idempotent; skipped on a fresh install).
