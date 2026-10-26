# 19.0.1.12.0

19.0.1.11.0 → 19.0.1.12.0: the payment data of an approved payroll run is fixed, and every salary file handed out is
kept (owner decisions D-4 (أ) and D-10 (أ), ticket 07).

* New table `webvue_hr_payslip_payment`: one row per payslip of an approved run (`UNIQUE(payslip_id)`, company stored
  from the payslip) with `iban`, `bank_code` and `identification`. Approval creates it; the bank and WPS files read it
  and nothing live. It is a model of its own, not fields on `hr_payslip`, because Odoo field `groups` are global: a
  payroll reader of one company would read the snapshot of their own payslip in a company where they only read
  employees. The payroll ACL and the company fence decide it per company instead.
* New table `webvue_hr_payroll_file` (one immutable row per distinct salary file content of a run, the content in an
  attachment) with `UNIQUE(run_id, checksum)`, and the audit action `payment_file_generated`.
* Approving a run is refused with `missing_iban` while a payslip with a positive net has no IBAN.

`post-payment_snapshot.py` creates the row of every payslip of a run that is no longer draft or computed and has no
row yet, from the employee's current compensation and version: that is what their files showed before this version.
A payslip that has a row, even an empty one, is never written again, so a rerun changes nothing, also after the live
data changed. The values are the current ones, not proof of what they were at approval (this version is the first to
record that). No salary file was kept before this version, so the file table starts empty.

## Limitation: an approved run left with an empty snapshot

An approved (or posted, or paid) run whose employee had no IBAN on file when this step ran keeps an empty snapshot for
that payslip. Only this migration can produce such a payslip with a positive net: from this version, approval refuses
a positive net without an IBAN. Its bank and WPS files are then refused with `missing_iban`, and recording the IBAN in
the compensation afterwards does not repair them, because the files read the snapshot only. The run page says so for a
fixed run (`hrPayroll.errors.missing_iban_snapshot`, `hrPayroll.warnings.missing_iban_snapshot`) and points to the
payroll administrator or support; an editable run keeps asking for the IBAN in the compensation before approval.
No product route rewrites an approved snapshot; a correction is a documented, out-of-band repair.
