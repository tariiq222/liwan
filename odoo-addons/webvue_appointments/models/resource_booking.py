# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

# A change to any of these can move a booking onto a resource, so it takes the resource guards first.
GUARDED_FIELDS = frozenset({'start', 'combination_id', 'combination_auto_assign', 'type_id'})


class ResourceBooking(models.Model):
    _inherit = 'resource.booking'

    webvue_requester_national_id = fields.Char(copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        defaults = self.default_get(['type_id', 'combination_auto_assign'])
        self._webvue_guard_states([{**defaults, **vals} for vals in vals_list])
        return super().create(vals_list)

    def write(self, vals):
        if GUARDED_FIELDS & vals.keys():
            self._webvue_guard_states([{
                'start': booking.start, 'type_id': booking.type_id.id, 'combination_id': booking.combination_id.id,
                'combination_auto_assign': booking.combination_auto_assign, **vals,
            } for booking in self])
        return super().write(vals)

    @api.model
    def _webvue_guard_states(self, states):
        """Guard every resource the bookings described by ``states`` may occupy, in one ordered lock."""
        resources = self.env['resource.resource'].union(*(self._webvue_booking_resources(state) for state in states))
        self.env['webvue.appointment.service']._webvue_guard_resources(resources)

    @api.model
    def _webvue_booking_resources(self, state):
        """The resources of the chosen combination, or of every combination of the type while it auto-assigns."""
        if not state.get('start'):
            return self.env['resource.resource']
        combination = self.env['resource.booking.combination'].browse(state.get('combination_id') or [])
        if combination and not state.get('combination_auto_assign'):
            return combination.resource_ids
        return self.env['resource.booking.type'].browse(state.get('type_id') or []).combination_rel_ids.combination_id.resource_ids
