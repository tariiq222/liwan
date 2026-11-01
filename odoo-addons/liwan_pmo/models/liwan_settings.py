# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import api, fields, models
from odoo.exceptions import AccessError

PARAM_CREATORS = 'liwan_pmo.project_creators'
PARAM_STAGES = 'liwan_pmo.default_stages'
PARAM_REQUIRE_MANAGER = 'liwan_pmo.require_manager_on_create'
PARAM_REQUIRE_END_DATE = 'liwan_pmo.require_end_date_on_create'
PARAM_DEFAULT_APPROVAL = 'liwan_pmo.default_completion_approval'
PARAM_REMINDERS_ENABLED = 'liwan_pmo.deadline_reminders_enabled'
PARAM_REMINDERS_DAYS = 'liwan_pmo.deadline_reminders_days_before'
PARAM_DIGEST_ENABLED = 'liwan_pmo.overdue_digest_enabled'
PARAM_REQUIRE_CHARTER_APPROVAL = 'liwan_pmo.require_charter_approval'
PARAM_CLOSE_WITH_OPEN_TASKS = 'liwan_pmo.close_with_open_tasks'
PARAM_REGISTER_TRANSITIONS = 'liwan_pmo.register_status_transitions'
PARAM_CHANGE_CONTROL_MODE = 'liwan_pmo.change_control_mode'
PARAM_BASELINE_GATE = 'liwan_pmo.baseline_gate'
CREATORS = ('managers', 'employees')
CLOSE_WITH_OPEN_TASKS = ('block', 'allow_with_warning')
REGISTER_TRANSITIONS = ('sequence', 'free')
CHANGE_CONTROL_MODES = ('off', 'optional', 'required')
BASELINE_GATES = ('off', 'warning', 'required')
# Choice settings kept as company-suffixed parameters: API key -> (parameter, allowed values, default).
PSC_CHOICES = {
    'close_with_open_tasks': (PARAM_CLOSE_WITH_OPEN_TASKS, CLOSE_WITH_OPEN_TASKS, 'block'),
    'register_status_transitions': (PARAM_REGISTER_TRANSITIONS, REGISTER_TRANSITIONS, 'sequence'),
    'change_control_mode': (PARAM_CHANGE_CONTROL_MODE, CHANGE_CONTROL_MODES, 'optional'),
    'baseline_gate': (PARAM_BASELINE_GATE, BASELINE_GATES, 'warning'),
}
APPROVAL_DEFAULTS = ('none', 'project_manager')
MAX_STAGES = 20
MAX_REMINDER_DAYS = 30
FALLBACK_STAGES = [
    {'name': 'جديد', 'fold': False},
    {'name': 'قيد التنفيذ', 'fold': False},
    {'name': 'مراجعة', 'fold': False},
    {'name': 'منجز', 'fold': True},
]
PMO_SETTINGS_COMPANY_MARKER = 'liwan_pmo.settings_company_ids'
PMO_SETTINGS_COMPANY_FIELDS = {
    'liwan_pmo_settings_initialized',
    'liwan_pmo_project_creators',
    'liwan_pmo_default_stages',
}
# The res.company field types a settings extension may declare, by the kind the API reports.
EXTENSION_KINDS = {'selection': 'selection', 'boolean': 'boolean'}
PSC_DEFAULTS = {
    'require_manager_on_create': True,
    'require_end_date_on_create': True,
    'default_completion_approval': 'none',
    'deadline_reminders_enabled': True,
    'deadline_reminders_days_before': 1,
    'overdue_digest_enabled': True,
    'require_charter_approval': False,
    'close_with_open_tasks': 'block',
    'register_status_transitions': 'sequence',
    'change_control_mode': 'optional',
    'baseline_gate': 'warning',
}


class ResCompany(models.Model):
    _inherit = 'res.company'

    liwan_pmo_settings_initialized = fields.Boolean(default=False)
    liwan_pmo_project_creators = fields.Selection(
        selection=[('managers', 'Managers'), ('employees', 'Employees')],
        default='managers',
    )
    liwan_pmo_default_stages = fields.Text()

    def _liwan_pmo_settings_fields(self):
        return PMO_SETTINGS_COMPANY_FIELDS | self.env['liwan.pmo.settings']._liwan_settings_extension_fields()

    def write(self, vals):
        settings_fields = self._liwan_pmo_settings_fields()
        if settings_fields.intersection(vals):
            allowed_ids = self.env.cr.precommit.data.get(
                PMO_SETTINGS_COMPANY_MARKER, set(),
            )
            if (
                not self.ids
                or not set(self.ids) <= allowed_ids
                or not set(vals) <= settings_fields
            ):
                msg = 'use_protected_liwan_access_operation'
                raise AccessError(msg)
        return super().write(vals)

    def _liwan_write_pmo_settings(self, vals):
        self.ensure_one()
        self.env['liwan.access.service']._liwan_require_capability('pmo.settings.manage')
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        if not vals or set(vals) - self._liwan_pmo_settings_fields():
            msg = 'use_protected_liwan_access_operation'
            raise AccessError(msg)
        marker = self.env.cr.precommit.data
        previous = marker.get(PMO_SETTINGS_COMPANY_MARKER)
        marker[PMO_SETTINGS_COMPANY_MARKER] = {self.id}
        try:
            # Documented liwan_pmo configuration sudo(): policy fields, not
            # business data. Callers are gated on pmo.settings.manage; the
            # precommit marker (not a forgeable context key) is the only ORM
            # write path. Branding/identity guards on super() stay intact.
            return self.sudo().write(vals)
        finally:
            if previous is None:
                marker.pop(PMO_SETTINGS_COMPANY_MARKER, None)
            else:
                marker[PMO_SETTINGS_COMPANY_MARKER] = previous


class LiwanPmoSettings(models.AbstractModel):
    """Company-scoped project policies, with a read-only legacy fallback.

    Until a company saves, ``get()`` reads the global ir.config_parameter keys
    (the documented configuration ``sudo()``). The first ``set_values`` snapshots
    the effective creators/stages onto the current company and never mutates those
    keys, so other companies keep the same fallback until they save.

    PSC requirement/approval/reminder keys are company-suffixed
    (``<key>.<company_id>``) and are never migrated from the legacy globals.
    """
    _name = 'liwan.pmo.settings'
    _description = 'liwan project policies'
    _liwan_scope = 'global'

    def _params(self):
        return self.env['ir.config_parameter'].sudo()

    def _company_key(self, base):
        return f'{base}.{self.env.company.id}'

    def _coerce_stages(self, raw):
        parsed = raw
        if isinstance(raw, str) and raw:
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = None
        if isinstance(parsed, list) and parsed and all(
            isinstance(s, dict) and isinstance(s.get('name'), str) and s['name'].strip()
            for s in parsed
        ):
            return [{'name': s['name'], 'fold': bool(s.get('fold'))} for s in parsed]
        return [{'name': s['name'], 'fold': bool(s.get('fold'))} for s in FALLBACK_STAGES]

    def _get_bool(self, base, default=True):
        raw = self._params().get_param(self._company_key(base))
        if raw in (None, False, ''):
            return default
        return str(raw).strip().lower() in ('1', 'true', 'yes')

    def _get_choice(self, base, allowed, default):
        raw = self._params().get_param(self._company_key(base))
        return raw if raw in allowed else default

    def _get_int(self, base, default, minimum, maximum):
        raw = self._params().get_param(self._company_key(base))
        if raw in (None, False, ''):
            return default
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return default
        if value < minimum or value > maximum:
            return default
        return value

    def change_control_mode(self):
        """The company's change control mode; `off` while the tenant's plan lacks the sub-feature (a retained read does not count)."""
        if not self.env['liwan.entitlement.service']._liwan_feature_write('pmo.change_control'):
            return 'off'
        return self._get_choice(PARAM_CHANGE_CONTROL_MODE, CHANGE_CONTROL_MODES, 'optional')

    def baseline_gate(self):
        """What the planning -> executing gate asks of baselines; `off` while the tenant's plan lacks the sub-feature."""
        if not self.env['liwan.entitlement.service']._liwan_feature_write('pmo.baselines'):
            return 'off'
        return self._get_choice(PARAM_BASELINE_GATE, BASELINE_GATES, 'warning')

    def _company_psc_values(self):
        approval = self._params().get_param(self._company_key(PARAM_DEFAULT_APPROVAL), 'none')
        return {
            'require_manager_on_create': self._get_bool(PARAM_REQUIRE_MANAGER, True),
            'require_end_date_on_create': self._get_bool(PARAM_REQUIRE_END_DATE, True),
            'default_completion_approval': (
                approval if approval in APPROVAL_DEFAULTS else 'none'
            ),
            'deadline_reminders_enabled': self._get_bool(PARAM_REMINDERS_ENABLED, True),
            'deadline_reminders_days_before': self._get_int(
                PARAM_REMINDERS_DAYS, 1, 0, MAX_REMINDER_DAYS,
            ),
            'overdue_digest_enabled': self._get_bool(PARAM_DIGEST_ENABLED, True),
            'require_charter_approval': self._get_bool(PARAM_REQUIRE_CHARTER_APPROVAL, False),
            **{key: self._get_choice(*spec) for key, spec in PSC_CHOICES.items()},
        }

    @api.model
    def _liwan_settings_extensions(self):
        """Company settings an installed application adds to the project settings.

        Extension point: override with ``super()`` and append specs ``{'name': <res.company field>,
        'kind': 'selection' | 'boolean', 'label': <translated>, 'help': <translated>}``. The field must exist
        on ``res.company`` with a matching type. ``get`` returns each one under ``extensions`` and
        ``set_values`` writes it through ``res.company._liwan_write_pmo_settings``. Read the specs through
        ``_liwan_settings_extension_specs``.
        """
        return []

    @api.model
    def _liwan_settings_extension_specs(self):
        """The declared extensions, each checked: a bad declaration is a programming error and raises."""
        return self.env['res.company']._liwan_check_company_field_extensions(
            'project settings', self._liwan_settings_extensions(), PMO_SETTINGS_COMPANY_FIELDS, EXTENSION_KINDS,
        )

    @api.model
    def _liwan_settings_extension_fields(self):
        return {spec['name'] for spec in self._liwan_settings_extension_specs()}

    def _dump_extension(self, spec):
        company = self.env.company
        field = company._fields[spec['name']]
        value = company[spec['name']]
        dumped = {
            'name': spec['name'],
            'kind': spec['kind'],
            'label': spec['label'],
            'help': spec.get('help') or None,
            'value': (value or None) if spec['kind'] == 'selection' else bool(value),
        }
        if spec['kind'] == 'selection':
            dumped['options'] = [
                {'value': key, 'label': label} for key, label in field._description_selection(self.env)
            ]
        return dumped

    def _validate_extension_payload(self, vals):
        company = self.env.company
        writes = {}
        for spec in self._liwan_settings_extension_specs():
            name = spec['name']
            if name not in vals:
                continue
            value = vals[name]
            if spec['kind'] == 'boolean':
                if not isinstance(value, bool):
                    raise _invalid(name, f"{name} must be a boolean")
            elif value not in [key for key, _label in company._fields[name]._description_selection(self.env)]:
                raise _invalid(name, f"{name} is not one of the allowed options")
            writes[name] = value
        return writes

    def _legacy_get(self):
        creators = self._params().get_param(PARAM_CREATORS, 'managers')
        return {
            'project_creators': creators if creators in CREATORS else 'managers',
            'default_stages': self._coerce_stages(self._params().get_param(PARAM_STAGES)),
        }

    def _core_values(self):
        """The settings without the extensions of installed bridges: what PMO's own rules read."""
        company = self.env.company
        if not company.liwan_pmo_settings_initialized:
            values = self._legacy_get()
        else:
            creators = company.liwan_pmo_project_creators
            values = {
                'project_creators': creators if creators in CREATORS else 'managers',
                'default_stages': self._coerce_stages(company.liwan_pmo_default_stages),
            }
        values.update(self._company_psc_values())
        return values

    def get(self):
        values = self._core_values()
        values['extensions'] = [self._dump_extension(spec) for spec in self._liwan_settings_extension_specs()]
        return values

    def get_create_defaults(self):
        values = self._company_psc_values()
        return {
            'require_manager_on_create': values['require_manager_on_create'],
            'require_end_date_on_create': values['require_end_date_on_create'],
            'default_manager_id': self.env.uid,
        }

    def _can_edit(self):
        return self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'pmo.settings.manage',
        )

    def _clean_stages(self, stages):
        if not isinstance(stages, list) or not stages or len(stages) > MAX_STAGES:
            field, msg = 'default_stages', f"default_stages must hold 1..{MAX_STAGES} stages"
            raise _invalid(field, msg)
        clean = []
        for s in stages:
            name = (s.get('name') if isinstance(s, dict) else None)
            if not isinstance(name, str) or not name.strip():
                field, msg = 'default_stages', "every default stage needs a name"
                raise _invalid(field, msg)
            clean.append({'name': name.strip(), 'fold': bool(s.get('fold'))})
        return clean

    def _validate_psc_payload(self, vals):
        writes = []
        if 'require_manager_on_create' in vals:
            if not isinstance(vals['require_manager_on_create'], bool):
                field, msg = 'require_manager_on_create', "require_manager_on_create must be a boolean"
                raise _invalid(field, msg)
            writes.append((
                self._company_key(PARAM_REQUIRE_MANAGER),
                'true' if vals['require_manager_on_create'] else 'false',
            ))
        if 'require_end_date_on_create' in vals:
            if not isinstance(vals['require_end_date_on_create'], bool):
                field, msg = 'require_end_date_on_create', "require_end_date_on_create must be a boolean"
                raise _invalid(field, msg)
            writes.append((
                self._company_key(PARAM_REQUIRE_END_DATE),
                'true' if vals['require_end_date_on_create'] else 'false',
            ))
        if 'default_completion_approval' in vals:
            if vals['default_completion_approval'] not in APPROVAL_DEFAULTS:
                field, msg = 'default_completion_approval', "default_completion_approval must be 'none' or 'project_manager'"
                raise _invalid(field, msg)
            writes.append((self._company_key(PARAM_DEFAULT_APPROVAL), vals['default_completion_approval']))
        if 'deadline_reminders_enabled' in vals:
            if not isinstance(vals['deadline_reminders_enabled'], bool):
                field, msg = 'deadline_reminders_enabled', "deadline_reminders_enabled must be a boolean"
                raise _invalid(field, msg)
            writes.append((
                self._company_key(PARAM_REMINDERS_ENABLED),
                'true' if vals['deadline_reminders_enabled'] else 'false',
            ))
        if 'deadline_reminders_days_before' in vals:
            days = vals['deadline_reminders_days_before']
            if not isinstance(days, int) or isinstance(days, bool) or days < 0 or days > MAX_REMINDER_DAYS:
                field, msg = 'deadline_reminders_days_before', f"deadline_reminders_days_before must be 0..{MAX_REMINDER_DAYS}"
                raise _invalid(field, msg)
            writes.append((self._company_key(PARAM_REMINDERS_DAYS), str(days)))
        if 'overdue_digest_enabled' in vals:
            if not isinstance(vals['overdue_digest_enabled'], bool):
                field, msg = 'overdue_digest_enabled', "overdue_digest_enabled must be a boolean"
                raise _invalid(field, msg)
            writes.append((
                self._company_key(PARAM_DIGEST_ENABLED),
                'true' if vals['overdue_digest_enabled'] else 'false',
            ))
        if 'require_charter_approval' in vals:
            if not isinstance(vals['require_charter_approval'], bool):
                field, msg = 'require_charter_approval', "require_charter_approval must be a boolean"
                raise _invalid(field, msg)
            writes.append((
                self._company_key(PARAM_REQUIRE_CHARTER_APPROVAL),
                'true' if vals['require_charter_approval'] else 'false',
            ))
        for key, (base, allowed, _default) in PSC_CHOICES.items():
            if key in vals:
                if vals[key] not in allowed:
                    raise _invalid(key, f"{key} must be one of {', '.join(allowed)}")
                writes.append((self._company_key(base), vals[key]))
        return writes

    def set_values(self, vals):
        if not self._can_edit():
            raise AccessError(self.env._("Only a customer administrator can change project policies."))
        before = self.get()
        effective = {
            'project_creators': before['project_creators'],
            'default_stages': [dict(stage) for stage in before['default_stages']],
        }
        if 'project_creators' in vals:
            if vals['project_creators'] not in CREATORS:
                field, msg = 'project_creators', "project_creators must be 'managers' or 'employees'"
                raise _invalid(field, msg)
            effective['project_creators'] = vals['project_creators']
        if 'default_stages' in vals:
            effective['default_stages'] = self._clean_stages(vals['default_stages'])
        psc_writes = self._validate_psc_payload(vals)
        extension_writes = self._validate_extension_payload(vals)
        company = self.env.company
        snapshot = not company.liwan_pmo_settings_initialized
        write_vals = {}
        if snapshot:
            write_vals = {
                'liwan_pmo_settings_initialized': True,
                'liwan_pmo_project_creators': effective['project_creators'],
                'liwan_pmo_default_stages': json.dumps(
                    effective['default_stages'], ensure_ascii=False,
                ),
            }
        else:
            if 'project_creators' in vals:
                write_vals['liwan_pmo_project_creators'] = effective['project_creators']
            if 'default_stages' in vals:
                write_vals['liwan_pmo_default_stages'] = json.dumps(
                    effective['default_stages'], ensure_ascii=False,
                )
        main_changed = (
            effective['project_creators'] != before['project_creators']
            or effective['default_stages'] != before['default_stages']
        )
        if write_vals and (snapshot or main_changed):
            company._liwan_write_pmo_settings(write_vals)
        if extension_writes:
            company._liwan_write_pmo_settings(extension_writes)
        if psc_writes:
            params = self._params()
            for key, value in psc_writes:
                params.set_param(key, value)
        result = self.get()
        if result != before:
            self.env['liwan.access.service']._liwan_bump_policy(company)
        return result

    def _default_stage_vals(self):
        """Create-ready vals for a new project's stages, in policy order."""
        return [
            {'name': s['name'], 'fold': s['fold'], 'sequence': (i + 1) * 10}
            for i, s in enumerate(self._core_values()['default_stages'])
        ]


def _invalid(field, message):
    err = ValueError(message)
    err.liwan_field = field
    return err
