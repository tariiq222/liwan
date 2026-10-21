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

Task 7: new column `webvue_department_id` on `hr_payslip` (the department snapshot written when a payslip is
computed), created by the ORM on update. The Saudi salary structure (`webvue_hr.structure_saudi`) with its
categories, rules and inputs (`data/hr_payroll_structure_data.xml`, updatable) is new data loaded on upgrade.
There is no data to carry; the table holds no payslips yet.

Task 8: new columns on `hr_payslip_run` (`webvue_state` required, default `draft`; `webvue_approved_by_id`;
`webvue_approved_at`) and the unique constraint `(company_id, date_start)`, created by the ORM on update. The
`hr.payslip.run` unlink right is granted to `hr.payroll.manage` (access CSV). The table holds no runs yet, so
there is no data to carry. New abstract model `webvue.hr.payroll.finance.link` (no table).

Task 9: new column `webvue_paid_days` on `hr_payslip` (the paid days snapshot written when a payslip is created
and computed, so an employee reads it on their own payslip without access to the contract), created by the ORM on
update. The table holds no payslips yet, so there is no data to carry.

Task 16: new tables `webvue_hr_payroll_bank_profile` and `webvue_hr_payroll_bank_profile_column` (salary file
layouts: delimiter, encoding and ordered columns), created by the ORM on update. The shared seed profiles
(`data/hr_payroll_file_profile_data.xml`, `noupdate`) load on upgrade because their records are new. New abstract
model `webvue.hr.payroll.export` (no table). There is no data to carry.

Task 16 fix: new column `webvue_gosi_class` on `hr_payslip` (the GOSI nationality class snapshotted when a payslip
is computed, so the GOSI statement of an approved run does not read live data), created by the ORM on update. The
non-payslip structure rule `GOSI_WAGE` (capped, prorated contributory wage) is new data loaded on upgrade. The table
holds no payslips yet, so there is no data to carry.

Task 16 fix 2: the unused statistical rule `GOSI_BASE` (`rule_gosi_base`) is removed from the Saudi structure; the
structure data is updatable (not `noupdate`), so Odoo deletes the orphaned rule record on upgrade. The only thing
that read it is replaced by `GOSI_WAGE`. Development data only; there is nothing to carry.

Task 18: new tables `webvue_hr_payroll_eos_case` (departure reason to end-of-service case, unique per company
and reason) and `webvue_hr_payroll_eos_settlement` (one final settlement per employee), created by the ORM on
update. The shared case seed (`data/hr_eos_case_data.xml`, `noupdate`) loads on upgrade because its records are
new. There is no data to carry.

Known limits: a settlement is unique per employee, so a re-hire after a confirmed settlement is not supported in this
phase (the old settlement stays on the employee).
