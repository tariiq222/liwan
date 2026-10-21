# 19.0.1.7.0

This version adds the payroll section over OCA `payroll` (pinned in `deploy/oca-addons.json`).
Schema additions are listed per task below. `post-payroll.py` carries `hr.enabled` onto `hr.payroll`.

Task 2: capabilities `hr.payroll.read|manage|approve|config`, the `payroll_manager` built-in role and the
`hr.payroll` sub-feature are XML/registry data. `post-payroll.py` copies the stored `hr.enabled` value
onto `hr.payroll` per tenant profile (idempotent; skipped on a fresh install).

Task 4: new table `webvue_hr_compensation` (one row per employee: wages, IBAN, GOSI number and
registration date), created by the ORM on update. There is no data to carry.

Task 6: new tables `webvue_hr_gosi_rate` (dated GOSI rates per branch and nationality class) and
`webvue_hr_payroll_settings` (one row per company, plus its unpaid-leave-type relation), created by the
ORM on update. The shared GOSI seed (`data/hr_gosi_rate_data.xml`, `noupdate`) loads on upgrade because
its records are new. There is no data to carry.
