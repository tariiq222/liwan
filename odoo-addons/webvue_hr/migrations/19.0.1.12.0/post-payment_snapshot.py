# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Store the payment snapshot of the payslips of runs approved before 19.0.1.12.0.

The salary files now read the IBAN, bank code and identification number of the ``webvue.hr.payslip.payment`` row
stored at approval and never the live compensation or employee. A run approved before this version has no row, so
each of its payslips gets one from the values the employee holds now, which is what its files showed until this
version. A payslip that already has a row is never written again: the row itself marks the payment data as fixed,
so a rerun, even after the live data changed, changes nothing. A fresh install has no approved run.
"""
from odoo import SUPERUSER_ID, api

from odoo.addons.webvue_hr.models.hr_payslip_run import EDITABLE_STATES


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    fill_payment_snapshots(env)


def fill_payment_snapshots(env):
    """Snapshot the payslips of fixed runs that have no payment snapshot row yet."""
    Payment = env['webvue.hr.payslip.payment']
    payslips = env['hr.payslip'].search([
        ('payslip_run_id', '!=', False), ('payslip_run_id.webvue_state', 'not in', EDITABLE_STATES),
    ])
    Payment._webvue_snapshot(payslips - Payment.search([('payslip_id', 'in', payslips.ids)]).payslip_id)
