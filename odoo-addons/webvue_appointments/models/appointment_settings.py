# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

SETTINGS_CAPABILITIES = ('appointments.bookings.read', 'appointments.bookings.write', 'appointments.bookings.manage')
FIELD_REQUIREMENTS = (('required', 'Required'), ('optional', 'Optional'), ('hidden', 'Hidden'))
SELF_BOOKING_POLICIES = (('invite_only', 'Invite only'), ('open', 'Open'))
SECTOR_PRESETS = (('general', 'General'), ('clinic', 'Clinic'), ('services', 'Services'))
# Inclusive (min, max) of every numeric setting; the database CHECKs and the API parser read this one table.
INTEGER_RANGES = {
    'default_slot_minutes': (5, 480),
    'min_notice_hours': (0, 720),
    'horizon_days': (1, 365),
    'modification_deadline_hours': (0, 720),
    'no_show_grace_minutes': (0, 1440),
}
BOOLEAN_SETTINGS = ('requester_confirmation', 'attendance_tracking', 'auto_no_show', 'walk_in_allowed', 'cancel_reason_required')
REFERENCE_PREFIX_PATTERN = r'[A-Z0-9-]{1,10}'
REQUESTER_FIELDS = ('phone_field', 'email_field', 'national_id_field', 'notes_field')
# Applying a preset writes all of these at once; the general preset is the field defaults.
PRESETS = {
    'general': {
        'default_slot_minutes': 30, 'min_notice_hours': 2, 'horizon_days': 60, 'modification_deadline_hours': 24,
        'requester_confirmation': False, 'self_booking_policy': 'invite_only',
        'phone_field': 'required', 'email_field': 'optional', 'national_id_field': 'hidden', 'notes_field': 'optional',
        'attendance_tracking': True, 'auto_no_show': True, 'no_show_grace_minutes': 30, 'walk_in_allowed': False,
        'visit_reason_field': 'optional', 'cancel_reason_required': False,
    },
    'clinic': {
        'default_slot_minutes': 15, 'min_notice_hours': 12, 'horizon_days': 30, 'modification_deadline_hours': 24,
        'requester_confirmation': True, 'self_booking_policy': 'invite_only',
        'phone_field': 'required', 'email_field': 'optional', 'national_id_field': 'required', 'notes_field': 'optional',
        'attendance_tracking': True, 'auto_no_show': True, 'no_show_grace_minutes': 30, 'walk_in_allowed': True,
        'visit_reason_field': 'optional', 'cancel_reason_required': False,
    },
    'services': {
        'default_slot_minutes': 60, 'min_notice_hours': 24, 'horizon_days': 90, 'modification_deadline_hours': 48,
        'requester_confirmation': False, 'self_booking_policy': 'invite_only',
        'phone_field': 'required', 'email_field': 'required', 'national_id_field': 'hidden', 'notes_field': 'optional',
        'attendance_tracking': True, 'auto_no_show': True, 'no_show_grace_minutes': 30, 'walk_in_allowed': False,
        'visit_reason_field': 'optional', 'cancel_reason_required': False,
    },
}
# The booking reference prefix is the tenant's own identity, not a sector choice: presets leave it alone.
DEFAULTS = {**PRESETS['general'], 'reference_prefix': 'APT'}


def _range_check(name):
    low, high = INTEGER_RANGES[name]
    return models.Constraint('CHECK(%s BETWEEN %d AND %d)' % (name, low, high), '%s must be between %d and %d' % (name, low, high))


class WebVueAppointmentSettings(models.Model):
    """One company's appointment policy, shaped by the tenant from the Appointments settings.

    Enforced now: ``default_slot_minutes`` and ``modification_deadline_hours`` are the defaults of a
    new booking type's ``slot_duration`` and ``modifications_deadline``. Not enforced here:
    ``min_notice_hours``, ``horizon_days``, the requester field policies, ``requester_confirmation``
    and ``self_booking_policy`` are enforced by the booking routes (tickets 05-07), and the attendance
    settings (``attendance_tracking``, ``auto_no_show``, ``no_show_grace_minutes``, ``walk_in_allowed``,
    ``visit_reason_field``, ``cancel_reason_required``) by the booking routes and the no-show cron
    (ticket 14); ``cancel_reason_required`` binds the staff cancel route only, because the invited
    requester's page offers no reason list yet (ticket 11 follow-up). ``reference_prefix`` is read when a
    booking is created. Existing bookings
    and types are never changed. Applying a sector preset writes ``sector_preset`` (the last applied
    preset) and every preset value in one save; a field sent with the preset overrides its value.
    """

    _name = 'webvue.appointment.settings'
    _description = 'WebVue appointment settings'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    default_slot_minutes = fields.Integer(required=True, default=DEFAULTS['default_slot_minutes'])
    min_notice_hours = fields.Integer(required=True, default=DEFAULTS['min_notice_hours'])
    horizon_days = fields.Integer(required=True, default=DEFAULTS['horizon_days'])
    modification_deadline_hours = fields.Integer(required=True, default=DEFAULTS['modification_deadline_hours'])
    requester_confirmation = fields.Boolean(default=DEFAULTS['requester_confirmation'])
    phone_field = fields.Selection(FIELD_REQUIREMENTS, required=True, default=DEFAULTS['phone_field'])
    email_field = fields.Selection(FIELD_REQUIREMENTS, required=True, default=DEFAULTS['email_field'])
    national_id_field = fields.Selection(FIELD_REQUIREMENTS, required=True, default=DEFAULTS['national_id_field'])
    notes_field = fields.Selection(FIELD_REQUIREMENTS, required=True, default=DEFAULTS['notes_field'])
    self_booking_policy = fields.Selection(SELF_BOOKING_POLICIES, required=True, default=DEFAULTS['self_booking_policy'])
    attendance_tracking = fields.Boolean(default=DEFAULTS['attendance_tracking'])
    auto_no_show = fields.Boolean(default=DEFAULTS['auto_no_show'])
    no_show_grace_minutes = fields.Integer(required=True, default=DEFAULTS['no_show_grace_minutes'])
    walk_in_allowed = fields.Boolean(default=DEFAULTS['walk_in_allowed'])
    visit_reason_field = fields.Selection(FIELD_REQUIREMENTS, required=True, default=DEFAULTS['visit_reason_field'])
    cancel_reason_required = fields.Boolean(default=DEFAULTS['cancel_reason_required'])
    reference_prefix = fields.Char(required=True, default=DEFAULTS['reference_prefix'])
    sector_preset = fields.Selection(SECTOR_PRESETS, required=True, default='general')
    revision = fields.Integer(required=True, default=1)

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one appointment settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')
    _slot_range = _range_check('default_slot_minutes')
    _notice_range = _range_check('min_notice_hours')
    _horizon_range = _range_check('horizon_days')
    _deadline_range = _range_check('modification_deadline_hours')
    _grace_range = _range_check('no_show_grace_minutes')
    _prefix_format = models.Constraint(
        "CHECK(reference_prefix ~ '^%s$')" % REFERENCE_PREFIX_PATTERN, 'the reference prefix is 1 to 10 of A-Z, 0-9 and -',
    )

    @api.model
    def _webvue_require_current_company(self, *capabilities):
        if not any(self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, capability, company=self.env.company,
        ) for capability in capabilities):
            raise AccessError(self.env._('forbidden'))

    @api.model
    def _webvue_current(self):
        self._webvue_require_current_company(*SETTINGS_CAPABILITIES)
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _webvue_type_defaults(self):
        """The ``resource.booking.type`` defaults of the current company, from its settings or the declared defaults."""
        row = self.search([('company_id', '=', self.env.company.id)], limit=1)
        values = row or DEFAULTS
        return {
            'slot_duration': values['default_slot_minutes'] / 60,
            'modifications_deadline': values['modification_deadline_hours'],
        }

    def check_access(self, operation):
        # Odoo search checks this public hook before applying record rules.
        if operation == 'read' and not self.env.is_superuser():
            self._webvue_require_current_company(*SETTINGS_CAPABILITIES)
        return super().check_access(operation)

    def read(self, fields=None, load='_classic_read'):
        if not self.env.is_superuser():
            self._webvue_require_current_company(*SETTINGS_CAPABILITIES)
        return super().read(fields=fields, load=load)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._webvue_require_current_company('appointments.bookings.manage')
            if any(vals.get('company_id') != self.env.company.id for vals in vals_list):
                raise AccessError(self.env._('appointment settings belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._webvue_require_current_company('appointments.bookings.manage')
            if any(row.company_id != self.env.company for row in self) or (
                'company_id' in vals and vals['company_id'] != self.env.company.id
            ):
                raise AccessError(self.env._('appointment settings belong to the current company'))
        return super().write(vals)
