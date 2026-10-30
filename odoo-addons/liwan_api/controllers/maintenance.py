# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import request

from .common import api_handler, get_record
from odoo.addons.liwan_api.serializers.maintenance import (
    dump_booking,
    dump_preference,
    dump_release,
    parse_booking,
    parse_booking_patch,
    parse_preference,
)
from odoo.addons.liwan_platform.models.maintenance import maintenance_company


class MaintenanceController(http.Controller):
    @http.route('/api/v1/admin/maintenance', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def maintenance(self):
        company = maintenance_company(request.env)
        domain = [('company_id', '=', company.id)]
        preference = request.env['liwan.maintenance.preference'].search(domain, limit=1)
        Release = request.env['liwan.maintenance.release']
        Booking = request.env['liwan.maintenance.booking']
        limit = 200
        bookings = Booking.search(domain, limit=limit)
        releases = Release.search(domain + [
            ('status', '=', 'supported'), ('deadline_at', '>', fields.Datetime.now()),
        ], limit=limit)
        # Keep actionable notices first, then booking context, then recent history.
        for extra in [[('id', 'in', bookings.release_id.ids)], []]:
            if len(releases) < limit:
                releases |= Release.search(
                    domain + extra + [('id', 'not in', releases.ids)],
                    limit=limit - len(releases), order='deadline_at desc, id desc',
                )
        return {
            'preference': dump_preference(preference),
            'releases': {'items': [dump_release(record) for record in releases], 'total': Release.search_count(domain)},
            'bookings': {'items': [dump_booking(record) for record in bookings], 'total': Booking.search_count(domain)},
        }

    @http.route('/api/v1/admin/maintenance/preference', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_preference(self, **payload):
        maintenance_company(request.env)
        values, revision = parse_preference(payload)
        return dump_preference(request.env['liwan.maintenance.preference']._liwan_update(values, revision))

    @http.route('/api/v1/admin/maintenance/bookings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_booking(self, **payload):
        maintenance_company(request.env)
        values, revision = parse_booking(payload)
        return dump_booking(request.env['liwan.maintenance.booking']._liwan_schedule(values, preference_revision=revision))

    @http.route('/api/v1/admin/maintenance/bookings/<int:booking_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_booking(self, booking_id, **payload):
        maintenance_company(request.env)
        values, revision = parse_booking_patch(payload)
        booking = get_record('liwan.maintenance.booking', booking_id)
        return dump_booking(booking._liwan_update(values, revision))
