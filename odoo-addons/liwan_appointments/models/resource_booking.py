# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .appointment_settings import DEFAULTS
from .res_company import REFERENCE_SEQUENCE_CODE

BOOK_PATH = '/book/%s'
ATTENDANCE_OUTCOMES = (('arrived', 'Arrived'), ('in_service', 'In service'), ('done', 'Done'), ('no_show', 'No show'))
# The outcome a booking has now (False: none recorded yet) -> the outcomes staff may record next.
# A no-show may be corrected to arrived (the person came late); a finished visit is final.
ATTENDANCE_TRANSITIONS = {
    False: ('arrived', 'no_show'),
    'arrived': ('in_service', 'done'),
    'in_service': ('done',),
    'no_show': ('arrived',),
}
# A booking whose visit has begun or ended keeps its time; any other outcome no longer holds once it moves.
STARTED_ATTENDANCE = frozenset({'in_service', 'done'})
# One cron run marks at most this many bookings per company; the next run continues.
NO_SHOW_BATCH = 500

# A change to any of these can move a booking onto a resource, so it takes the resource guards first.
GUARDED_FIELDS = frozenset({'start', 'combination_id', 'combination_auto_assign', 'type_id'})


class ResourceBooking(models.Model):
    _inherit = 'resource.booking'

    liwan_requester_national_id = fields.Char(copy=False)
    liwan_attendance = fields.Selection(ATTENDANCE_OUTCOMES, copy=False)
    liwan_walk_in = fields.Boolean(copy=False)
    liwan_visit_reason_id = fields.Many2one(
        'liwan.appointment.reason', domain=[('kind', '=', 'visit')], copy=False, ondelete='restrict',
    )
    liwan_cancel_reason_id = fields.Many2one(
        'liwan.appointment.reason', domain=[('kind', '=', 'cancel')], copy=False, ondelete='restrict',
    )
    liwan_reference = fields.Char(readonly=True, copy=False)

    @api.constrains('liwan_visit_reason_id', 'liwan_cancel_reason_id')
    def _check_reasons(self):
        for booking in self:
            company = booking.type_id.company_id
            for reason, kind in ((booking.liwan_visit_reason_id, 'visit'), (booking.liwan_cancel_reason_id, 'cancel')):
                if reason and (reason.kind != kind or reason.company_id != company):
                    raise ValidationError(self.env._('The %(kind)s reason must be a %(kind)s reason of the booking company.', kind=kind))

    def _compute_access_url(self):
        # Customers never open Odoo: the engine's /my/bookings page is closed by the LiwanOS guard, so every
        # portal link of a booking (invitation emails, share links) opens the requester's LiwanOS page.
        super()._compute_access_url()
        for booking in self:
            booking.access_url = BOOK_PATH % booking.id

    def _liwan_confirms_on_schedule(self):
        """Whether staff scheduling confirms this booking at once: true unless the type's company asks the
        requester to confirm. An extension point a bridge may override: the payments bridge returns True for
        paying types, and the engine then keeps the booking scheduled until its order is paid."""
        self.ensure_one()
        settings = self.env['liwan.appointment.settings'].search([('company_id', '=', self.type_id.company_id.id)], limit=1)
        return not (settings.requester_confirmation if settings else DEFAULTS['requester_confirmation'])

    @api.model_create_multi
    def create(self, vals_list):
        defaults = self.default_get(['type_id', 'combination_auto_assign'])
        states = [{**defaults, **vals} for vals in vals_list]
        self._liwan_guard_states(states)
        vals_list = [{**vals, 'liwan_reference': self._liwan_next_reference(state.get('type_id'))} for vals, state in zip(vals_list, states, strict=True)]
        return super().create(vals_list)

    @api.model
    def _liwan_next_reference(self, type_id):
        """The next reference of the type's company, e.g. ``APT/2026/000123``: the settings' prefix, the year and the company's counter."""
        company = self.env['resource.booking.type'].browse(type_id).company_id
        settings = self.env['liwan.appointment.settings'].search([('company_id', '=', company.id)], limit=1)
        counter = self.env['ir.sequence'].search([('code', '=', REFERENCE_SEQUENCE_CODE), ('company_id', '=', company.id)])
        return '%s/%s/%s' % (settings.reference_prefix or DEFAULTS['reference_prefix'], fields.Date.context_today(self).year, counter.next_by_id())

    @api.model
    def _liwan_mark_no_shows(self):
        """Cron: record ``no_show`` on every booking nobody arrived for, once the company's grace period has passed.

        A company is skipped while its settings turn attendance tracking or automatic no-shows off; one without a
        settings row follows the defaults. Bookings with any attendance outcome are never touched, so a run is idempotent.
        """
        now = fields.Datetime.now()
        rows = {row.company_id: row for row in self.env['liwan.appointment.settings'].search([])}
        for company in self.env['res.company'].search([]):
            settings = rows.get(company) or DEFAULTS
            if not (settings['attendance_tracking'] and settings['auto_no_show']):
                continue
            late = self.search([
                ('type_id.company_id', '=', company.id), ('state', 'in', ('scheduled', 'confirmed')),
                ('liwan_attendance', '=', False), ('start', '<', now - timedelta(minutes=settings['no_show_grace_minutes'])),
            ], order='start, id', limit=NO_SHOW_BATCH)
            late.write({'liwan_attendance': 'no_show'})

    def write(self, vals):
        if 'start' in vals and 'liwan_attendance' not in vals:
            self._liwan_clear_attendance_on_move(fields.Datetime.to_datetime(vals['start']))
        if GUARDED_FIELDS & vals.keys():
            self._liwan_guard_states([{
                'start': booking.start, 'type_id': booking.type_id.id, 'combination_id': booking.combination_id.id,
                'combination_auto_assign': booking.combination_auto_assign, **vals,
            } for booking in self])
        return super().write(vals)

    def _liwan_clear_attendance_on_move(self, start):
        """A booking moved to another time starts its attendance again: an arrival or a no-show belonged to the old
        time. A booking whose visit has begun or ended cannot move (422 through the API)."""
        moved = self.filtered(lambda booking: booking.liwan_attendance and booking.start != start)
        if moved.filtered(lambda booking: booking.liwan_attendance in STARTED_ATTENDANCE):
            raise UserError(self.env._('A booking whose visit has begun or ended cannot move to another time.'))
        moved.write({'liwan_attendance': False})

    @api.model
    def _liwan_guard_states(self, states):
        """Guard every resource the bookings described by ``states`` may occupy, in one ordered lock."""
        resources = self.env['resource.resource'].union(*(self._liwan_booking_resources(state) for state in states))
        self.env['liwan.appointment.service']._liwan_guard_resources(resources)

    @api.model
    def _liwan_booking_resources(self, state):
        """The resources of the chosen combination, or of every combination of the type while it auto-assigns."""
        if not state.get('start'):
            return self.env['resource.resource']
        combination = self.env['resource.booking.combination'].browse(state.get('combination_id') or [])
        if combination and not state.get('combination_auto_assign'):
            return combination.resource_ids
        return self.env['resource.booking.type'].browse(state.get('type_id') or []).combination_rel_ids.combination_id.resource_ids
