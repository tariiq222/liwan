# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .entitlement_service import OPERATOR_CONTEXT
from .maintenance_access import MAINTENANCE_CAPABILITY
from .maintenance_messages import maintenance_time_message
from .maintenance_time import next_window, timezone_info, validate_window
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule

BOOKING_STATUSES = [('scheduled', 'Scheduled'), ('cancelled', 'Cancelled'), ('running', 'Running'), ('complete', 'Complete'), ('failed', 'Failed')]


def maintenance_snapshot(record):
    names = ('timezone', 'weekday', 'start_minute', 'duration_minutes') if record._name == 'webvue.maintenance.preference' else ('status', 'scheduled_at', 'timezone', 'duration_minutes')
    return {name: record[name] for name in names}


def maintenance_company(env, *, operator=False):
    if operator:
        if not (env.su and env.context.get(OPERATOR_CONTEXT)):
            raise AccessError(env._('A trusted local operator is required.'))
    else:
        env['webvue.access.service']._webvue_require_capability(MAINTENANCE_CAPABILITY)
    company = env['webvue.entitlement.service']._webvue_profile().root_company_id
    if not operator and env.company != company:
        raise AccessError(env._('Maintenance is managed from the tenant root company.'))
    return company


def lock_records(records):
    if records and len(records.try_lock_for_update()) != len(records):
        msg = 'conflict'
        raise WebVueAccessRule(msg, records.env._('Maintenance changed concurrently. Reload and retry.'), status=409)
    records.invalidate_recordset()


def check_revision(record, revision):
    if type(revision) is not int or revision < 0:
        raise ValidationError(record.env._('A non-negative revision is required.'))
    if revision != (record.revision if record else 0):
        msg = 'conflict'
        raise WebVueAccessRule(msg, record.env._('Maintenance changed. Reload before saving.'), status=409)


class WebVueMaintenancePreference(models.Model):
    _name = 'webvue.maintenance.preference'
    _description = 'Tenant maintenance preference'
    _webvue_scope = 'company'
    _check_company_auto = True

    company_id = fields.Many2one('res.company', required=True, ondelete='restrict', index=True)
    timezone = fields.Char(required=True)
    weekday = fields.Integer(required=True)
    start_minute = fields.Integer(required=True)
    duration_minutes = fields.Integer(required=True)
    revision = fields.Integer(required=True, default=1)
    _company_unique = models.Constraint('UNIQUE(company_id)', 'One maintenance preference per tenant.')

    @api.constrains('timezone', 'weekday', 'start_minute', 'duration_minutes')
    def _check_window(self):
        for record in self:
            try:
                timezone_info(record.timezone)
            except ValueError as exc:
                raise ValidationError(maintenance_time_message(self.env, exc)) from exc
            if not 0 <= record.weekday <= 6 or not 0 <= record.start_minute <= 1439 or not 1 <= record.duration_minutes <= 1440:
                raise ValidationError(self.env._('Invalid maintenance preference window.'))

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(self.env._('Use the maintenance preference operation.'))

    def write(self, vals):
        raise AccessError(self.env._('Use the maintenance preference operation.'))

    def unlink(self):
        raise AccessError(self.env._('Maintenance preferences cannot be deleted.'))

    @api.model
    def _webvue_update(self, values, revision):
        company = self.env['webvue.maintenance.authority']._webvue_serialize()
        if not values or set(values) - {'timezone', 'weekday', 'start_minute', 'duration_minutes'}:
            raise ValidationError(self.env._('Invalid maintenance preference fields.'))
        preference = self.search([('company_id', '=', company.id)], limit=1)
        check_revision(preference, revision)
        values = {**values, 'revision': revision + 1}
        before = maintenance_snapshot(preference) if preference else None
        if preference:
            super(WebVueMaintenancePreference, preference).write(values)
        else:
            preference = super().create({**values, 'company_id': company.id})
        self.env['webvue.maintenance.event']._webvue_record('preference_saved', preference, before)
        return preference


class WebVueMaintenanceRelease(models.Model):
    _name = 'webvue.maintenance.release'
    _description = 'Operator maintenance release notice'
    _webvue_scope = 'company'
    _check_company_auto = True
    _order = 'deadline_at, id'

    company_id = fields.Many2one('res.company', required=True, ondelete='restrict', index=True)
    release_id = fields.Char(required=True, index=True)
    deadline_at = fields.Datetime(required=True)
    estimated_seconds = fields.Integer(required=True)
    scope = fields.Selection([('tenant', 'Tenant'), ('ai_service', 'AI service'), ('infrastructure', 'Infrastructure')], required=True, default='tenant')
    status = fields.Selection([('supported', 'Supported'), ('withdrawn', 'Withdrawn')], required=True, default='supported')
    urgency = fields.Selection([('normal', 'Normal'), ('security', 'Security')], required=True, default='normal')
    policy = fields.Text(required=True)
    _release_unique = models.Constraint('UNIQUE(company_id, release_id)', 'A release notice already exists for this tenant.')

    @api.constrains('estimated_seconds', 'policy', 'release_id')
    def _check_notice(self):
        for record in self:
            if record.estimated_seconds <= 0 or not record.policy.strip() or not record.release_id.strip():
                raise ValidationError(self.env._('A release id, measured estimate and operator policy are required.'))

    @api.model_create_multi
    def create(self, vals_list):
        company = self.env['webvue.maintenance.authority']._webvue_serialize(operator=True)
        for values in vals_list:
            if values.get('company_id') != company.id:
                raise AccessError(self.env._('Release notices belong to this database tenant.'))
        return super().create(vals_list)

    def write(self, vals):
        company = self.env['webvue.maintenance.authority']._webvue_serialize(operator=True)
        if 'company_id' in vals or any(record.company_id != company for record in self):
            raise AccessError(self.env._('Release notice tenant cannot change.'))
        lock_records(self)
        active = self.env['webvue.maintenance.booking'].search([('release_id', 'in', self.ids), ('status', 'in', ['scheduled', 'running'])])
        if active and set(vals) & {'deadline_at', 'estimated_seconds', 'scope', 'release_id'}:
            raise ValidationError(self.env._('Release timing and scope cannot change while bookings are active.'))
        if active.filtered(lambda booking: booking.status == 'running') and vals.get('status') == 'withdrawn':
            raise ValidationError(self.env._('A running release cannot be withdrawn.'))
        return super().write(vals)

    def unlink(self):
        raise AccessError(self.env._('Withdraw release notices instead of deleting them.'))


class WebVueMaintenanceBooking(models.Model):
    _name = 'webvue.maintenance.booking'
    _description = 'Tenant maintenance booking'
    _webvue_scope = 'company'
    _check_company_auto = True
    _order = 'scheduled_at desc, id desc'

    company_id = fields.Many2one('res.company', required=True, ondelete='restrict', index=True)
    release_id = fields.Many2one('webvue.maintenance.release', required=True, ondelete='restrict', check_company=True, index=True)
    scheduled_at = fields.Datetime(required=True, index=True)
    timezone = fields.Char(required=True)
    duration_minutes = fields.Integer(required=True)
    status = fields.Selection(BOOKING_STATUSES, default='scheduled', required=True, index=True)
    revision = fields.Integer(required=True, default=1)

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(self.env._('Use the maintenance booking operation.'))

    def write(self, vals):
        raise AccessError(self.env._('Use the maintenance booking operation.'))

    def unlink(self):
        raise AccessError(self.env._('Cancel maintenance bookings instead of deleting them.'))

    def _webvue_validate_window(self, values, release, company):
        if release.company_id != company:
            raise AccessError(self.env._('Release is outside this tenant.'))
        if release.status != 'supported' or release.scope != 'tenant':
            raise ValidationError(self.env._('This release is not available for an individual tenant booking.'))
        try:
            timezone_info(values['timezone'])
            validate_window(values['scheduled_at'], values['duration_minutes'], release.estimated_seconds, release.deadline_at, fields.Datetime.now())
        except ValueError as exc:
            raise ValidationError(maintenance_time_message(self.env, exc)) from exc
        end = values['scheduled_at'] + timedelta(minutes=values['duration_minutes'])
        others = self.search([('company_id', '=', company.id), ('status', 'in', ['scheduled', 'running', 'complete', 'failed']), ('id', 'not in', self.ids)])
        for other in others:
            if other.release_id == release or (other.status in {'scheduled', 'running'} and other.scheduled_at < end and other.scheduled_at + timedelta(minutes=other.duration_minutes) > values['scheduled_at']):
                msg = 'conflict'
                raise WebVueAccessRule(msg, self.env._('An active maintenance booking conflicts with this window or release.'), status=409)

    @api.model
    def _webvue_schedule(self, values, *, preference_revision=None):
        company = self.env['webvue.maintenance.authority']._webvue_serialize()
        if set(values) - {'release_id', 'scheduled_at', 'timezone', 'duration_minutes'} or not values.get('release_id'):
            raise ValidationError(self.env._('Invalid maintenance booking fields.'))
        release = self.env['webvue.maintenance.release'].browse(values['release_id']).exists()
        if not release:
            msg = 'not_found'
            raise WebVueAccessRule(msg, self.env._('Release notice not found.'), status=404)
        release.check_access('read')
        lock_records(release)
        if preference_revision is not None:
            preference = self.env['webvue.maintenance.preference'].search([('company_id', '=', company.id)], limit=1)
            check_revision(preference, preference_revision)
            if not preference:
                raise ValidationError(self.env._('Save a preferred maintenance window first.'))
            try:
                scheduled = next_window(fields.Datetime.now(), preference.timezone, preference.weekday, preference.start_minute, preference.duration_minutes, release.deadline_at)
            except ValueError as exc:
                raise ValidationError(maintenance_time_message(self.env, exc)) from exc
            values = {**values, 'scheduled_at': scheduled, 'timezone': preference.timezone, 'duration_minutes': preference.duration_minutes}
        if not {'scheduled_at', 'timezone', 'duration_minutes'} <= values.keys():
            raise ValidationError(self.env._('A complete maintenance window is required.'))
        self._webvue_validate_window(values, release, company)
        booking = super().create({**values, 'company_id': company.id, 'status': 'scheduled', 'revision': 1})
        self.env['webvue.maintenance.event']._webvue_record('booking_scheduled', booking)
        return booking

    def _webvue_update(self, values, revision):
        self.ensure_one()
        company = self.env['webvue.maintenance.authority']._webvue_serialize()
        self.check_access('write')
        lock_records(self.release_id)
        lock_records(self)
        check_revision(self, revision)
        if self.company_id != company:
            raise AccessError(self.env._('Booking is outside this tenant.'))
        if self.status != 'scheduled':
            msg = 'conflict'
            raise WebVueAccessRule(msg, self.env._('Only scheduled maintenance can be changed or cancelled.'), status=409)
        if values == {'status': 'cancelled'}:
            pass
        elif set(values) == {'scheduled_at', 'timezone', 'duration_minutes'}:
            self._webvue_validate_window(values, self.release_id, company)
        else:
            raise ValidationError(self.env._('Invalid maintenance booking fields.'))
        before = maintenance_snapshot(self)
        super().write({**values, 'revision': revision + 1})
        action = 'booking_cancelled' if values.get('status') == 'cancelled' else 'booking_rescheduled'
        self.env['webvue.maintenance.event']._webvue_record(action, self, before)
        return self

    def _webvue_transition(self, status, revision):
        """Trusted scheduler CAS boundary; locks are shared with cancellation."""
        self.ensure_one()
        company = self.env['webvue.maintenance.authority']._webvue_serialize(operator=True)
        lock_records(self.release_id)
        lock_records(self)
        check_revision(self, revision)
        if self.company_id != company:
            raise AccessError(self.env._('Booking is outside this tenant.'))
        transitions = {'scheduled': {'running'}, 'running': {'complete', 'failed'}}
        if status not in transitions.get(self.status, set()):
            msg = 'conflict'
            raise WebVueAccessRule(msg, self.env._('Invalid maintenance status transition.'), status=409)
        if status == 'running':
            if self.release_id.status != 'supported' or self.release_id.scope != 'tenant':
                raise ValidationError(self.env._('The release is no longer supported for this booking.'))
            now = fields.Datetime.now()
            end = min(self.scheduled_at + timedelta(minutes=self.duration_minutes), self.release_id.deadline_at)
            if not self.scheduled_at <= now or now + timedelta(seconds=self.release_id.estimated_seconds) > end:
                raise ValidationError(self.env._('This booking is outside its approved execution window.'))
        before = maintenance_snapshot(self)
        super().write({'status': status, 'revision': revision + 1})
        self.env['webvue.maintenance.event']._webvue_record('booking_' + status, self, before)
        return self
