# 19.0.1.12.0

19.0.1.11.0 → 19.0.1.12.0: the payment data of an approved payroll run is fixed, and every salary file handed out is
kept (owner decisions D-4 (أ) and D-10 (أ), ticket 07).

* `hr_payslip` gains three Char columns, `webvue_iban`, `webvue_bank_code` and `webvue_identification`, readable only
  by the payroll read capability. Approval stores them; the bank and WPS files read them and nothing live.
* New table `webvue_hr_payroll_file` (one immutable row per distinct salary file content of a run, the content in an
  attachment) with `UNIQUE(run_id, checksum)`, and the audit action `payment_file_generated`.
* Approving a run is refused with `missing_iban` while a payslip with a positive net has no IBAN.

`post-payment_snapshot.py` fills the three columns of the payslips of every run that is no longer draft or computed,
from the employee's current compensation and version: that is what their files showed before this version. It writes
only payslips whose three columns are all empty, so a rerun over unchanged live data changes nothing.

That is the whole of its idempotence, and it is a backfill from current data rather than a guarantee. Only rows whose
three columns are still empty are candidates, so a row holding any snapshot value is never rewritten; but the values
it writes are the ones the employee holds when it runs, which are not proof of what they were at approval (this
version is the first to record that). A rerun after the live compensation or version changed therefore rewrites the
current values onto a payslip whose empty snapshot was correct (a zero net paid where the employee had no IBAN at
approval). Odoo runs the step once per version upgrade; freezing an empty snapshot against a later manual rerun would
need a stored marker and is out of this ticket's scope. No salary file was kept before this version, so the new table
starts empty.
