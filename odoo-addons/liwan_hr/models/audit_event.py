# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

IMMUTABLE = 'audit_is_immutable'

# Per audited model: (fields whose old and new values are recorded, fields recorded by name only).
# The first list holds non-secret payroll policy only; wages, IBANs, settlement figures and a salary
# file's constant values never leave the second list (owner decisions D-8 and D-9).
TRACKED_FIELDS = {
    'liwan.hr.payroll.settings': (
        ('day_divisor', 'structure_id', 'unpaid_leave_type_ids', 'annual_leave_type_id'), (),
    ),
    'liwan.hr.gosi.rate': (
        ('branch', 'nationality_class', 'date_from', 'employee_rate', 'employer_rate', 'wage_min', 'wage_max'), (),
    ),
    'liwan.hr.payroll.bank.profile': (
        ('name', 'kind', 'delimiter', 'encoding', 'include_header', 'footer', 'column_ids'), (),
    ),
    # A line renders inside its profile's ``column_ids`` as sequence/source/label only; ``constant_value`` may hold
    # a bank account and is never read (detailed decision under D-8 in .scratch/hr-fixes/issues/04-hr-audit-trail.md).
    'liwan.hr.payroll.bank.profile.column': (('sequence', 'source', 'label'), ()),
    'liwan.hr.payroll.eos.case': (('departure_reason_id', 'case'), ()),
    'liwan.hr.payroll.eos.settlement': ((), (
        'departure_date', 'case', 'service_years', 'eos_wage', 'award', 'leave_days', 'leave_amount',
        'open_deductions', 'total', 'state',
    )),
    # The relationship type is the customer's own classification, not pay data: who set it and to what is the
    # record B12 needs, so its values are kept.
    'liwan.hr.compensation': (('relationship_type',), (
        'basic_wage', 'housing_allowance', 'transport_allowance', 'other_allowance', 'iban', 'bank_id',
        'gosi_number', 'gosi_registration_date',
    )),
    # The lifecycle of a pay month; the entered input amounts are named in the event, never valued.
    'hr.payslip.run': (('liwan_state', 'liwan_approved_by_id', 'liwan_approved_at'), ()),
    # A handed-out salary file: what kind, under which name, for which value date. Its content (IBANs, amounts)
    # and checksum are never recorded.
    'liwan.hr.payroll.file': (('kind', 'filename', 'value_date'), ()),
    # Warnings: the lifecycle and who it concerns are recorded; the reason, corrective action, contest note and
    # withdrawal reason are disciplinary text and are named, never copied into the trail.
    'liwan.hr.warning': (('employee_id', 'type_id', 'date_issued', 'state'), (
        'reason', 'corrective_action', 'contest_note', 'withdraw_reason',
    )),
    'liwan.hr.warning.type': (('name', 'severity', 'active'), ()),
    'liwan.hr.warning.settings': ((
        'warnings_issued_by', 'warnings_employee_acknowledgement', 'warnings_escalation_window_months',
    ), ()),
    # Insurance: who is covered by which plan and for how long are recorded; member numbers, identity numbers,
    # names, shares, premiums and notes are insurance data and are named, never copied into the trail.
    'liwan.hr.insurance.provider': (('name', 'active'), ()),
    'liwan.hr.insurance.plan': (('provider_id', 'name', 'tier', 'valid_from', 'valid_to', 'active'), (
        'policy_number', 'annual_premium',
    )),
    'liwan.hr.insurance.enrollment': (('employee_id', 'plan_id', 'date_from', 'date_to', 'state'), (
        'member_number', 'employee_share', 'company_share', 'notes',
    )),
    'liwan.hr.insurance.dependent': (('relation', 'date_from', 'date_to', 'state'), (
        'name', 'birth_date', 'national_id',
    )),
    'liwan.hr.insurance.settings': ((
        'insurance_visibility', 'insurance_expiry_alert_days', 'insurance_require_dependent_id',
    ), ()),
}

# Warning actions are authorized by the warning itself (`_liwan_audit_authorized`): the HR officer who issues or
# withdraws, the direct manager who issues when the company allows it, and the employee who answers their own
# warning hold no single capability in common. Insurance enrollment and dependent actions use the same hook, since
# the record carries the company its manager is checked in.
SELF_AUTHORIZED = None
# action -> (audited model, capability the caller holds in the record's company)
ACTIONS = {
    'payroll_settings_changed': ('liwan.hr.payroll.settings', 'hr.payroll.config'),
    'gosi_rate_created': ('liwan.hr.gosi.rate', 'hr.payroll.config'),
    'gosi_rate_changed': ('liwan.hr.gosi.rate', 'hr.payroll.config'),
    'gosi_rate_deleted': ('liwan.hr.gosi.rate', 'hr.payroll.config'),
    'bank_profile_created': ('liwan.hr.payroll.bank.profile', 'hr.payroll.config'),
    'bank_profile_changed': ('liwan.hr.payroll.bank.profile', 'hr.payroll.config'),
    'bank_profile_deleted': ('liwan.hr.payroll.bank.profile', 'hr.payroll.config'),
    'eos_case_changed': ('liwan.hr.payroll.eos.case', 'hr.payroll.config'),
    'settlement_saved': ('liwan.hr.payroll.eos.settlement', 'hr.payroll.manage'),
    'settlement_confirmed': ('liwan.hr.payroll.eos.settlement', 'hr.payroll.approve'),
    'compensation_changed': ('liwan.hr.compensation', 'hr.payroll.manage'),
    'run_inputs_changed': ('hr.payslip.run', 'hr.payroll.manage'),
    'run_approved': ('hr.payslip.run', 'hr.payroll.approve'),
    'run_cancelled': ('hr.payslip.run', 'hr.payroll.manage'),
    'payment_file_generated': ('liwan.hr.payroll.file', 'hr.payroll.read'),
    'warning_created': ('liwan.hr.warning', SELF_AUTHORIZED),
    'warning_issued': ('liwan.hr.warning', SELF_AUTHORIZED),
    'warning_acknowledged': ('liwan.hr.warning', SELF_AUTHORIZED),
    'warning_contested': ('liwan.hr.warning', SELF_AUTHORIZED),
    'warning_withdrawn': ('liwan.hr.warning', SELF_AUTHORIZED),
    'warning_type_created': ('liwan.hr.warning.type', 'hr.warnings.manage'),
    'warning_type_changed': ('liwan.hr.warning.type', 'hr.warnings.manage'),
    'warning_settings_changed': ('liwan.hr.warning.settings', 'hr.warnings.manage'),
    'provider_created': ('liwan.hr.insurance.provider', 'hr.insurance.manage'),
    'provider_changed': ('liwan.hr.insurance.provider', 'hr.insurance.manage'),
    'plan_created': ('liwan.hr.insurance.plan', 'hr.insurance.manage'),
    'plan_changed': ('liwan.hr.insurance.plan', 'hr.insurance.manage'),
    'enrollment_created': ('liwan.hr.insurance.enrollment', SELF_AUTHORIZED),
    'enrollment_changed': ('liwan.hr.insurance.enrollment', SELF_AUTHORIZED),
    'enrollment_ended': ('liwan.hr.insurance.enrollment', SELF_AUTHORIZED),
    'enrollment_cancelled': ('liwan.hr.insurance.enrollment', SELF_AUTHORIZED),
    'dependent_added': ('liwan.hr.insurance.dependent', SELF_AUTHORIZED),
    'dependent_changed': ('liwan.hr.insurance.dependent', SELF_AUTHORIZED),
    'dependent_ended': ('liwan.hr.insurance.dependent', SELF_AUTHORIZED),
    'insurance_settings_changed': ('liwan.hr.insurance.settings', 'hr.insurance.manage'),
}
# The warning trail is never listed with the payroll audit: it is confidential to the warnings capabilities.
WARNING_MODELS = ('liwan.hr.warning', 'liwan.hr.warning.type', 'liwan.hr.warning.settings')
# Nor is the insurance trail: it belongs to the insurance capabilities.
INSURANCE_MODELS = (
    'liwan.hr.insurance.provider', 'liwan.hr.insurance.plan', 'liwan.hr.insurance.enrollment',
    'liwan.hr.insurance.dependent', 'liwan.hr.insurance.settings',
)
NON_PAYROLL_MODELS = WARNING_MODELS + INSURANCE_MODELS
# Actions logged ahead of the record's unlink, inside the caller's savepoint: the old side keeps the values.
DELETE_ACTIONS = frozenset({'gosi_rate_deleted', 'bank_profile_deleted', 'run_cancelled'})
PAYROLL_ACTION_SELECTION = [
    ('payroll_settings_changed', 'Payroll settings changed'),
    ('gosi_rate_created', 'GOSI rate created'),
    ('gosi_rate_changed', 'GOSI rate changed'),
    ('gosi_rate_deleted', 'GOSI rate deleted'),
    ('bank_profile_created', 'Salary file profile created'),
    ('bank_profile_changed', 'Salary file profile changed'),
    ('bank_profile_deleted', 'Salary file profile deleted'),
    ('eos_case_changed', 'End-of-service case changed'),
    ('settlement_saved', 'Final settlement saved'),
    ('settlement_confirmed', 'Final settlement confirmed'),
    ('compensation_changed', 'Compensation changed'),
    ('run_inputs_changed', 'Payroll run inputs changed'),
    ('run_approved', 'Payroll run approved'),
    ('run_cancelled', 'Payroll run cancelled'),
    ('payment_file_generated', 'Salary file generated'),
]
WARNING_ACTION_SELECTION = [
    ('warning_created', 'Warning drafted'),
    ('warning_issued', 'Warning issued'),
    ('warning_acknowledged', 'Warning acknowledged'),
    ('warning_contested', 'Warning contested'),
    ('warning_withdrawn', 'Warning withdrawn'),
    ('warning_type_created', 'Warning type created'),
    ('warning_type_changed', 'Warning type changed'),
    ('warning_settings_changed', 'Warning settings changed'),
]
INSURANCE_ACTION_SELECTION = [
    ('provider_created', 'Insurance provider created'),
    ('provider_changed', 'Insurance provider changed'),
    ('plan_created', 'Insurance plan created'),
    ('plan_changed', 'Insurance plan changed'),
    ('enrollment_created', 'Insurance enrollment created'),
    ('enrollment_changed', 'Insurance enrollment changed'),
    ('enrollment_ended', 'Insurance enrollment ended'),
    ('enrollment_cancelled', 'Insurance enrollment cancelled'),
    ('dependent_added', 'Insurance dependent added'),
    ('dependent_changed', 'Insurance dependent changed'),
    ('dependent_ended', 'Insurance dependent ended'),
    ('insurance_settings_changed', 'Insurance settings changed'),
]
ACTION_SELECTION = PAYROLL_ACTION_SELECTION + WARNING_ACTION_SELECTION + INSURANCE_ACTION_SELECTION


def _render(record, name):
    """The text of one field value: references by name, lines by their tracked fields, never a secret field."""
    field = record._fields[name]
    value = record[name]
    if field.type == 'one2many':
        line_fields = TRACKED_FIELDS[field.comodel_name][0]
        return '; '.join('/'.join(_render(line, part) for part in line_fields) for line in value) or False
    if field.type == 'many2many':
        # ``_origin``: an unsaved settings record holds virtual copies of its relations.
        return ', '.join(sorted(value._origin.mapped('display_name'))) or False
    if field.type == 'many2one':
        return value._origin.display_name or False
    if field.type == 'boolean':
        return 'true' if value else 'false'
    if value is False or value is None:
        return False
    return value.isoformat() if field.type == 'date' else str(value)


class LiwanHrAuditEvent(models.Model):
    """The immutable audit trail of the payroll policy and payroll record writes.

    One row per action: who (``create_uid``) and when (``create_date``) from the ORM, which company and
    record, and one change row per field that moved. Rows are created only by ``_liwan_log`` in the
    caller's own environment (the ACL grants create to the payroll capability groups, no ``sudo()``) and
    can never be changed or deleted.
    """

    _name = 'liwan.hr.audit.event'
    _description = 'LiwanOS HR payroll audit event'
    _liwan_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    action = fields.Selection(ACTION_SELECTION, required=True, index=True)
    res_model = fields.Char(required=True)
    res_id = fields.Integer(required=True)
    change_ids = fields.One2many('liwan.hr.audit.change', 'event_id')

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(IMMUTABLE)

    def write(self, vals):
        raise AccessError(IMMUTABLE)

    def unlink(self):
        raise AccessError(IMMUTABLE)

    @api.model
    def _liwan_policy_snapshot(self, record):
        """``{field: text}`` of the tracked fields of ``record`` read in the caller's environment; {} when absent."""
        if not record:
            return {}
        record.ensure_one()
        value_fields, name_fields = TRACKED_FIELDS[record._name]
        return {name: _render(record, name) for name in (*value_fields, *name_fields)}

    @api.model
    def _liwan_log(self, action, record, before=None, names=()):
        """Record ``action`` on ``record``; ``before`` is its snapshot taken ahead of the write.

        A create passes no ``before``; a delete is logged before the unlink, so the record still holds the old
        values and the new side stays empty. ``names`` are further fields written that the event names
        without any value (the input codes of a payslip). Every value comes from ``record`` and the
        environment, never from the request.
        """
        target = ACTIONS.get(action)
        if not target:
            msg = 'audit_action_unknown'
            raise AccessError(msg)
        res_model, capability = target
        record.ensure_one()
        if record._name != res_model:
            msg = 'audit_record_mismatch'
            raise AccessError(msg)
        company = record.company_id
        if not company or company not in self.env.companies:
            msg = 'audit_company_out_of_scope'
            raise AccessError(msg)
        if capability is SELF_AUTHORIZED:
            allowed = record._liwan_audit_authorized(action)
        else:
            allowed = self.env['liwan.access.service']._liwan_has_capability(self.env.user, capability, company=company)
        if not allowed:
            msg = 'audit_capability_missing'
            raise AccessError(msg)
        deleting = action in DELETE_ACTIONS
        old = self._liwan_policy_snapshot(record) if deleting else before or {}
        new = {} if deleting else self._liwan_policy_snapshot(record)
        event = super().create([{
            'company_id': company.id, 'action': action, 'res_model': res_model, 'res_id': record.id,
        }])
        value_fields = TRACKED_FIELDS[res_model][0]
        rows = [
            {
                'event_id': event.id,
                'field_name': name,
                'old_value': old.get(name, False) if name in value_fields else False,
                'new_value': new.get(name, False) if name in value_fields else False,
            }
            for name in sorted(set(old) | set(new)) if old.get(name, False) != new.get(name, False)
        ]
        rows += [
            {'event_id': event.id, 'field_name': name, 'old_value': False, 'new_value': False}
            for name in sorted(set(names) - set(old) - set(new))
        ]
        if rows:
            # The change model refuses ``create`` like the event; its rows are written past that refusal
            # here only, so no second entry point can attach a change to an event.
            models.Model.create(self.env['liwan.hr.audit.change'], rows)
        return event


class LiwanHrAuditChange(models.Model):
    """One field of an audit event: its name, and its old and new text when the field is policy, not pay."""

    _name = 'liwan.hr.audit.change'
    _description = 'LiwanOS HR payroll audit change'
    _liwan_scope = 'company'
    _order = 'event_id, field_name, id'

    event_id = fields.Many2one('liwan.hr.audit.event', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='event_id.company_id', store=True, index=True)
    field_name = fields.Char(required=True)
    old_value = fields.Char()
    new_value = fields.Char()

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(IMMUTABLE)

    def write(self, vals):
        raise AccessError(IMMUTABLE)

    def unlink(self):
        raise AccessError(IMMUTABLE)
