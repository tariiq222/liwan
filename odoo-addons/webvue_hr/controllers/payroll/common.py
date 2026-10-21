# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_hr.controllers.assets.common import current_company


def payroll_employee(employee_id):
    """An employee of the current company, archived included → 404 otherwise.

    Another company's employee is never a 403: the caller may not even know it exists.
    """
    employee = request.env['hr.employee'].with_context(active_test=False).search([
        ('id', '=', employee_id),
        ('company_id', '=', current_company().id),
    ], limit=1)
    if not employee:
        raise MissingError(request.env._('hr.employee %(id)s does not exist', id=employee_id))
    return employee


def scoped_profile(profile_id):
    """A salary file profile the caller's company can see (shared seed rows included) → 404 otherwise."""
    profile = request.env['webvue.hr.payroll.bank.profile'].search([('id', '=', profile_id)], limit=1)
    if not profile:
        raise MissingError(request.env._('webvue.hr.payroll.bank.profile %(id)s does not exist', id=profile_id))
    return profile
