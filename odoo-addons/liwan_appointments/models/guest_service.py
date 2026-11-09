# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import MissingError
from odoo.tools import consteq

from .appointment_settings import DEFAULTS

MAX_TOKEN_LENGTH = 128


class LiwanAppointmentGuest(models.AbstractModel):
    """What an invited requester may reach with one booking's access token and no account.

    The token is the engine's ``access_token`` (cleared when the booking is canceled). Every refusal is
    the same not-found. The record comes back elevated and pinned to the booking's company, so what a
    public route reads and writes through it needs no further elevation; the routes decide what is shown.
    The link also stops being readable a company-configured number of days after the appointment ends
    (``link_valid_days_after_end``, 30 by default), so a link that leaked into a screenshot or an archived
    mail cannot keep showing the requester's phone and email for ever.
    """

    _name = 'liwan.appointment.guest'
    _description = 'LiwanOS appointment guest service'

    @api.model
    def _liwan_booking(self, booking_id, token):
        """The active booking ``booking_id`` when ``token`` is its access token, its link is still readable and it belongs
        to this tenant, else :class:`MissingError`.

        The token is compared in constant time, also when the booking is missing, so the answer time does not tell a
        missing booking from a wrong token. The record and its company are read elevated because the public user holds
        no ACL on either; the tenant's company tree is what bound the read, so a booking row of another company in the
        same database (a second root) is as not-found as a missing one.
        """
        supplied = token if isinstance(token, str) and len(token) <= MAX_TOKEN_LENGTH else ''
        # The public user has no ACL on resource.booking; the token is the only authorization, and it
        # can only be compared after the booking is read.
        booking = self.env['resource.booking'].sudo().search([('id', '=', booking_id)])
        expected = booking.access_token or ''
        matches = consteq(expected.encode(), supplied.encode())
        if not (booking and supplied and matches):
            raise MissingError(self.env._('Record does not exist'))
        if not self._liwan_in_tenant(booking.type_id.company_id):
            raise MissingError(self.env._('Record does not exist'))
        booking = booking.with_company(booking.type_id.company_id)
        if self._liwan_link_expired(booking, fields.Datetime.now()):
            raise MissingError(self.env._('Record does not exist'))
        return booking

    @api.model
    def _liwan_in_tenant(self, company):
        """Whether ``company`` belongs to this tenant: the tenant profile's root company or one of its branches.

        Tenant isolation is database-per-tenant, and every customer company is the tenant's root or a branch below it.
        A company outside that tree is a separate tenant's row that should not share this database, so its bookings are
        never served on this tenant's public links.
        """
        if not company:
            return False
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        return company.root_id == root

    @api.model
    def _liwan_link_expired(self, booking, now):
        """Whether the requester's link stopped being readable: ``now`` is later than ``booking.stop`` plus the company's
        ``link_valid_days_after_end``.

        A booking that has no time yet has no end to count from, so its link stays readable until the company rotates it.
        ``now`` is a naive UTC datetime like ``booking.stop``; ``booking`` may come from any environment, since the settings
        it reads are narrowed to its own company.
        """
        if not booking.stop:
            return False
        settings = booking.env['liwan.appointment.settings'].search(
            [('company_id', '=', booking.type_id.company_id.id)], limit=1,
        )
        days = settings.link_valid_days_after_end if settings else DEFAULTS['link_valid_days_after_end']
        return booking.stop < now - timedelta(days=days)
