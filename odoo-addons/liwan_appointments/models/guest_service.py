# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import MissingError
from odoo.tools import consteq

MAX_TOKEN_LENGTH = 128


class LiwanAppointmentGuest(models.AbstractModel):
    """What an invited requester may reach with one booking's access token and no account.

    The token is the engine's ``access_token`` (cleared when the booking is canceled). Every refusal is
    the same not-found. The record comes back elevated and pinned to the booking's company, so what a
    public route reads and writes through it needs no further elevation; the routes decide what is shown.
    """

    _name = 'liwan.appointment.guest'
    _description = 'LiwanOS appointment guest service'

    @api.model
    def _liwan_booking(self, booking_id, token):
        """The active booking ``booking_id`` when ``token`` is its access token, else :class:`MissingError`.

        The token is compared in constant time, also when the booking is missing, so the answer time does
        not tell a missing booking from a wrong token.
        """
        supplied = token if isinstance(token, str) and len(token) <= MAX_TOKEN_LENGTH else ''
        # The public user has no ACL on resource.booking; the token is the only authorization, and it
        # can only be compared after the booking is read.
        booking = self.env['resource.booking'].sudo().search([('id', '=', booking_id)])
        expected = booking.access_token or ''
        matches = consteq(expected.encode(), supplied.encode())
        if not (booking and supplied and matches):
            raise MissingError(self.env._('Record does not exist'))
        return booking.with_company(booking.type_id.company_id)
