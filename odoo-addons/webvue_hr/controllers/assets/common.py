# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError


def current_company():
    return request.env.company


def scoped_equipment(equipment_id, *, active_test=True):
    """An asset of the current company → 404 otherwise.

    Another company's asset is never a 403: the caller may not even know it exists.
    ``active_test=False`` also reaches an archived asset (its record page).
    """
    records = request.env['maintenance.equipment']
    if not active_test:
        records = records.with_context(active_test=False)
    equipment = records.search([
        ('id', '=', equipment_id),
        ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not equipment:
        raise MissingError(request.env._('maintenance.equipment %(id)s does not exist', id=equipment_id))
    equipment.check_access('read')
    return equipment


def company_category(category_id, field='category_id'):
    """A category of the current company or a shared one → 422 naming the field."""
    category = request.env['maintenance.equipment.category'].search([
        ('id', '=', category_id),
        '|', ('company_id', 'in', request.env.companies.ids), ('company_id', '=', False),
    ], limit=1)
    if not category:
        raise ApiError(422, 'invalid', f'{field} does not reference a category of the current company', field=field)
    category.check_access('read')
    return category


def active_employee(employee_id, field='employee_id'):
    """An active employee of the current company → 422 naming the field.

    The WebVue ``hr.employee`` guard already scopes the search to the current company and
    refuses it without ``hr.employees.read``; an archived employee stays invisible here.
    """
    employee = request.env['hr.employee'].search([('id', '=', employee_id)], limit=1)
    if not employee:
        raise ApiError(422, 'invalid', f'{field} does not reference an active employee of the current company', field=field)
    return employee


def company_employee(employee_id, field='employee_id'):
    """Any employee of the current company, archived included → 422 naming the field.

    The custody filter uses this: offboarding looks at the assets of an employee who may
    already be archived.
    """
    employee = request.env['hr.employee'].with_context(active_test=False).search([
        ('id', '=', employee_id),
    ], limit=1)
    if not employee:
        raise ApiError(422, 'invalid', f'{field} does not reference an employee of the current company', field=field)
    return employee


def own_employee():
    """The caller's own employee in the current company, if any."""
    return request.env.user.employee_ids.filtered(
        lambda record: record.company_id == current_company(),
    )[:1]


def reject_own_custody(employee):
    """Segregation of duties: nobody assigns custody to, or returns it from, their own employee."""
    own = own_employee()
    if own and employee and employee == own:
        raise ApiError(403, 'forbidden', "equipment custody of the caller's own employee is not a self-decision")
