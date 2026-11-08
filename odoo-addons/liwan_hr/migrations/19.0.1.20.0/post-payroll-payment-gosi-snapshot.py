# Part of Odoo. See LICENSE file for full copyright and licensing details.


def migrate(cr, version):
    """Fill the new ``gosi_number`` snapshot of the payments approved before this version.

    The GOSI statement read the live compensation number until now, so that is the number it showed for
    every existing row: carrying it into the snapshot keeps an already approved month's statement as it
    was, and later corrections no longer reach it. A payslip of an employee without a compensation record
    keeps an empty number, which is what the statement showed for it too. The update touches only rows
    still empty, so re-running it changes nothing.
    """
    if not version:
        return
    cr.execute(
        """
        UPDATE liwan_hr_payslip_payment payment
           SET gosi_number = compensation.gosi_number
          FROM liwan_hr_compensation compensation, hr_payslip payslip
         WHERE payment.payslip_id = payslip.id
           AND compensation.employee_id = payslip.employee_id
           AND payment.gosi_number IS NULL
           AND compensation.gosi_number IS NOT NULL
        """,
    )
