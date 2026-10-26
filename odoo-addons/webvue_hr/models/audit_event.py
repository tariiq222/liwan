# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

IMMUTABLE = 'audit_is_immutable'

# Per audited model: (fields whose old and new values are recorded, fields recorded by name only).
# The first list holds non-secret payroll policy only; wages, IBANs, settlement figures and a salary
# file's constant values never leave the second list (owner decisions D-8 and D-9).
TRACKED_FIELDS = {
    'webvue.hr.payroll.settings': (
        ('day_divisor', 'structure_id', 'unpaid_leave_type_ids', 'annual_leave_type_id'), (),
    ),
    'webvue.hr.gosi.rate': (
        ('branch', 'nationality_class', 'date_from', 'employee_rate', 'employer_rate', 'wage_min', 'wage_max'), (),
    ),
    'webvue.hr.payroll.bank.profile': (
        ('name', 'kind', 'delimiter', 'encoding', 'include_header', 'footer', 'column_ids'), (),
    ),
    # A line renders inside its profile's ``column_ids`` as sequence/source/label only; ``constant_value`` may hold
    # a bank account and is never read (detailed decision under D-8 in .scratch/hr-fixes/issues/04-hr-audit-trail.md).
    'webvue.hr.payroll.bank.profile.column': (('sequence', 'source', 'label'), ()),
    'webvue.hr.payroll.eos.case': (('departure_reason_id', 'case'), ()),
    'webvue.hr.payroll.eos.settlement': ((), (
        'departure_date', 'case', 'service_years', 'eos_wage', 'award', 'leave_days', 'leave_amount',
        'open_deductions', 'total', 'state',
    )),
    'webvue.hr.compensation': ((), (
        'basic_wage', 'housing_allowance', 'transport_allowance', 'other_allowance', 'iban', 'bank_id',
        'gosi_number', 'gosi_registration_date',
    )),
    # The lifecycle of a pay month; the entered input amounts are named in the event, never valued.
    'hr.payslip.run': (('webvue_state', 'webvue_approved_by_id', 'webvue_approved_at'), ()),
    # A handed-out salary file: what kind, under which name, for which value date. Its content (IBANs, amounts)
    # and checksum are never recorded.
    'webvue.hr.payroll.file': (('kind', 'filename', 'value_date'), ()),
}

# action -> (audited model, capability the caller holds in the record's company)
ACTIONS = {
    'payroll_settings_changed': ('webvue.hr.payroll.settings', 'hr.payroll.config'),
    'gosi_rate_created': ('webvue.hr.gosi.rate', 'hr.payroll.config'),
    'gosi_rate_changed': ('webvue.hr.gosi.rate', 'hr.payroll.config'),
    'gosi_rate_deleted': ('webvue.hr.gosi.rate', 'hr.payroll.config'),
    'bank_profile_created': ('webvue.hr.payroll.bank.profile', 'hr.payroll.config'),
    'bank_profile_changed': ('webvue.hr.payroll.bank.profile', 'hr.payroll.config'),
    'bank_profile_deleted': ('webvue.hr.payroll.bank.profile', 'hr.payroll.config'),
    'eos_case_changed': ('webvue.hr.payroll.eos.case', 'hr.payroll.config'),
    'settlement_saved': ('webvue.hr.payroll.eos.settlement', 'hr.payroll.manage'),
    'settlement_confirmed': ('webvue.hr.payroll.eos.settlement', 'hr.payroll.approve'),
    'compensation_changed': ('webvue.hr.compensation', 'hr.payroll.manage'),
    'run_inputs_changed': ('hr.payslip.run', 'hr.payroll.manage'),
    'run_approved': ('hr.payslip.run', 'hr.payroll.approve'),
    'run_cancelled': ('hr.payslip.run', 'hr.payroll.manage'),
    'payment_file_generated': ('webvue.hr.payroll.file', 'hr.payroll.read'),
}
# Actions logged ahead of the record's unlink, inside the caller's savepoint: the old side keeps the values.
DELETE_ACTIONS = frozenset({'gosi_rate_deleted', 'bank_profile_deleted', 'run_cancelled'})
ACTION_SELECTION = [
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


class WebVueHrAuditEvent(models.Model):
    """The immutable audit trail of the payroll policy and payroll record writes.

    One row per action: who (``create_uid``) and when (``create_date``) from the ORM, which company and
    record, and one change row per field that moved. Rows are created only by ``_webvue_log`` in the
    caller's own environment (the ACL grants create to the payroll capability groups, no ``sudo()``) and
    can never be changed or deleted.
    """

    _name = 'webvue.hr.audit.event'
    _description = 'WebVue HR payroll audit event'
    _webvue_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    action = fields.Selection(ACTION_SELECTION, required=True, index=True)
    res_model = fields.Char(required=True)
    res_id = fields.Integer(required=True)
    change_ids = fields.One2many('webvue.hr.audit.change', 'event_id')

    @api.model_create_multi
    def create(self, vals_list):
        raise AccessError(IMMUTABLE)

    def write(self, vals):
        raise AccessError(IMMUTABLE)

    def unlink(self):
        raise AccessError(IMMUTABLE)

    @api.model
    def _webvue_policy_snapshot(self, record):
        """``{field: text}`` of the tracked fields of ``record`` read in the caller's environment; {} when absent."""
        if not record:
            return {}
        record.ensure_one()
        value_fields, name_fields = TRACKED_FIELDS[record._name]
        return {name: _render(record, name) for name in (*value_fields, *name_fields)}

    @api.model
    def _webvue_log(self, action, record, before=None, names=()):
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
        if not self.env['webvue.access.service']._webvue_has_capability(self.env.user, capability, company=company):
            msg = 'audit_capability_missing'
            raise AccessError(msg)
        deleting = action in DELETE_ACTIONS
        old = self._webvue_policy_snapshot(record) if deleting else before or {}
        new = {} if deleting else self._webvue_policy_snapshot(record)
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
            models.Model.create(self.env['webvue.hr.audit.change'], rows)
        return event


class WebVueHrAuditChange(models.Model):
    """One field of an audit event: its name, and its old and new text when the field is policy, not pay."""

    _name = 'webvue.hr.audit.change'
    _description = 'WebVue HR payroll audit change'
    _webvue_scope = 'company'
    _order = 'event_id, field_name, id'

    event_id = fields.Many2one('webvue.hr.audit.event', required=True, index=True, ondelete='cascade')
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
