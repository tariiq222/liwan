# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Fill the payment snapshot of the payslips of runs approved before 19.0.1.12.0.

The salary files now read the IBAN, bank code and identification number stored on the payslip at approval and
never the live compensation or employee. A run approved before this version has none stored, so its payslips
take the values the employee holds now, which is what its files showed until this version. Only payslips whose
three snapshot fields are all empty are written.

That is a backfill from current data, not a proof of idempotence: re-running the step while the live compensation
and version are unchanged writes the same values and changes nothing. Only payslips whose three snapshot fields are
all empty are candidates, so a stored snapshot is never rewritten; the values written are the current ones, not what
the employee held at approval, which this version is the first to record. A rerun after those live values changed
therefore writes the new ones, including onto a payslip whose empty snapshot was correct (a zero net paid where the
employee had no IBAN at approval). Odoo runs this step once per version upgrade; freezing an empty snapshot against
a later manual rerun would need a stored marker and is out of this ticket's scope. A fresh install has no approved
run.
"""
from odoo import SUPERUSER_ID, api

from odoo.addons.webvue_hr.models.hr_payslip_run import EDITABLE_STATES


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    fill_payment_snapshots(env)


def fill_payment_snapshots(env):
    """Snapshot the payslips of fixed runs whose payment data was never stored."""
    payslips = env['hr.payslip'].search([
        ('payslip_run_id', '!=', False), ('payslip_run_id.webvue_state', 'not in', EDITABLE_STATES),
        ('webvue_iban', '=', False), ('webvue_bank_code', '=', False), ('webvue_identification', '=', False),
    ])
    payslips._webvue_snapshot_payment()
