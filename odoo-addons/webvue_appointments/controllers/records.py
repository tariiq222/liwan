# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError, get_record

READ_CAPABILITY = 'appointments.bookings.read'
MANAGE_CAPABILITY = 'appointments.bookings.manage'


def get_company_record(model, rec_id):
    """``get_record`` limited to the current company: a record of any other company, or none, is not found."""
    record = get_record(model, rec_id)
    if record.company_id != request.env.company:
        raise MissingError(request.env._('Record does not exist'))
    return record


def company_records(model, ids, field):
    """The active records ``ids`` (in that order), all of the current company; 422 on ``field`` otherwise."""
    found = request.env[model].search([('id', 'in', ids), ('company_id', '=', request.env.company.id)])
    if set(found.ids) != set(ids):
        raise ApiError(422, 'invalid', 'unknown record for the current company', field=field)
    return request.env[model].browse(ids)


def company_domain(args):
    """The list domain of the current company, narrowed by ``?active=true|false`` (default true)."""
    flag = args.get('active', 'true')
    if flag not in ('true', 'false'):
        raise ApiError(422, 'invalid', 'must be true or false', field='active')
    return [('company_id', '=', request.env.company.id), ('active', '=', flag == 'true')]
