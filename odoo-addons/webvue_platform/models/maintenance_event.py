# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .entitlement_service import OPERATOR_CONTEXT
from .maintenance import BOOKING_STATUSES, maintenance_company, maintenance_snapshot

_AUDIT_SENTINEL = object()


class WebVueMaintenanceEvent(models.Model):
    _name = 'webvue.maintenance.event'
    _description = 'Immutable maintenance event'
    _webvue_scope = 'company'
    _check_company_auto = True
    _order = 'id desc'

    # Standard create_uid/create_date are the event's immutable actor and time.
    company_id = fields.Many2one('res.company', required=True, ondelete='restrict', index=True)
    preference_id = fields.Many2one('webvue.maintenance.preference', ondelete='restrict', check_company=True, index=True)
    booking_id = fields.Many2one('webvue.maintenance.booking', ondelete='restrict', check_company=True, index=True)
    revision = fields.Integer(required=True)
    action = fields.Selection([
        ('preference_saved', 'Preference saved'),
        ('booking_scheduled', 'Booking scheduled'),
        ('booking_rescheduled', 'Booking rescheduled'),
        ('booking_cancelled', 'Booking cancelled'),
        ('booking_running', 'Booking running'),
        ('booking_complete', 'Booking complete'),
        ('booking_failed', 'Booking failed'),
    ], required=True)
    old_status = fields.Selection(BOOKING_STATUSES)
    new_status = fields.Selection(BOOKING_STATUSES)
    old_scheduled_at = fields.Datetime()
    new_scheduled_at = fields.Datetime()
    old_timezone = fields.Char()
    new_timezone = fields.Char()
    old_weekday = fields.Integer()
    new_weekday = fields.Integer()
    old_start_minute = fields.Integer()
    new_start_minute = fields.Integer()
    old_duration_minutes = fields.Integer()
    new_duration_minutes = fields.Integer()
    _one_target = models.Constraint('CHECK ((preference_id IS NOT NULL) <> (booking_id IS NOT NULL))', 'A maintenance event must have exactly one target.')
    _positive_revision = models.Constraint('CHECK (revision > 0)', 'An event revision must be positive.')

    @api.model_create_multi
    def create(self, vals_list):
        if self.env.context.get('_webvue_maintenance_audit') is not _AUDIT_SENTINEL:
            raise AccessError(self.env._('Maintenance events can only be recorded by an authorized maintenance operation.'))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._('Maintenance events are immutable.'))

    def unlink(self):
        raise AccessError(self.env._('Maintenance events are immutable.'))

    @api.model
    def _webvue_record(self, action, record, before=None):
        operator = bool(self.env.su and self.env.context.get(OPERATOR_CONTEXT))
        company = maintenance_company(self.env, operator=operator)
        record.ensure_one()
        if record._name not in {'webvue.maintenance.preference', 'webvue.maintenance.booking'} or record.company_id != company:
            raise AccessError(self.env._('Maintenance event target is outside this tenant.'))
        record.check_access('read')
        values = {
            'company_id': company.id,
            'preference_id' if record._name == 'webvue.maintenance.preference' else 'booking_id': record.id,
            'action': action,
            'revision': record.revision,
            **{'old_' + key: value for key, value in (before or {}).items()},
            **{'new_' + key: value for key, value in maintenance_snapshot(record).items()},
        }
        return self.with_context(_webvue_maintenance_audit=_AUDIT_SENTINEL).create(values)
