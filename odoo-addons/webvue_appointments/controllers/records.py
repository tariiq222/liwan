# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError, get_record

READ_CAPABILITY = 'appointments.bookings.read'
WRITE_CAPABILITY = 'appointments.bookings.write'
MANAGE_CAPABILITY = 'appointments.bookings.manage'


def get_company_record(model, rec_id):
    """``get_record`` limited to the current company: a record of any other company, or none, is not found."""
    record = get_record(model, rec_id)
    if record.company_id != request.env.company:
        raise MissingError(request.env._('Record does not exist'))
    return record


def get_company_booking(booking_id):
    """The booking (archived ones included) of the current company that the caller's record rules show.

    A booking has no company field of its own: its type's company decides. Another company's booking,
    one the caller may not see, and a missing id all answer not found, so the answer leaks no existence.
    """
    Booking = request.env['resource.booking']
    found = Booking.with_context(active_test=False).search([
        ('id', '=', booking_id), ('type_id.company_id', '=', request.env.company.id),
    ])
    if not found:
        raise MissingError(request.env._('Record does not exist'))
    # Browse in the plain environment: the engine's combination search must not see archived records.
    return Booking.browse(found.ids)


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
