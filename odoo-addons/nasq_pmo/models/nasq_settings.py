# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import models
from odoo.exceptions import AccessError

PARAM_CREATORS = 'nasq_pmo.project_creators'
PARAM_STAGES = 'nasq_pmo.default_stages'
CREATORS = ('managers', 'employees')
MAX_STAGES = 20
FALLBACK_STAGES = [
    {'name': 'جديد', 'fold': False},
    {'name': 'قيد التنفيذ', 'fold': False},
    {'name': 'مراجعة', 'fold': False},
    {'name': 'منجز', 'fold': True},
]


class NasqPmoSettings(models.AbstractModel):
    """The two company-wide project policies, stored in ir.config_parameter.

    ir.config_parameter is readable only by admins, so the reads/writes below are
    the one documented ``sudo()`` for configuration in nasq_pmo: this is policy,
    not business data, and every caller of ``set_values`` is gated on
    ``nasq_core.group_customer_admin`` first.
    """
    _name = 'nasq.pmo.settings'
    _description = 'nasq project policies'

    def _params(self):
        return self.env['ir.config_parameter'].sudo()

    def get(self):
        creators = self._params().get_param(PARAM_CREATORS, 'managers')
        raw = self._params().get_param(PARAM_STAGES)
        try:
            stages = json.loads(raw) if raw else FALLBACK_STAGES
        except ValueError:
            stages = FALLBACK_STAGES
        return {
            'project_creators': creators if creators in CREATORS else 'managers',
            'default_stages': [{'name': s['name'], 'fold': bool(s.get('fold'))} for s in stages],
        }

    def _can_edit(self):
        return self.env.user.has_group('nasq_core.group_customer_admin')

    def set_values(self, vals):
        if not self._can_edit():
            raise AccessError(self.env._("Only a customer administrator can change project policies."))
        if 'project_creators' in vals:
            if vals['project_creators'] not in CREATORS:
                field, msg = 'project_creators', "project_creators must be 'managers' or 'employees'"
                raise _invalid(field, msg)
            self._params().set_param(PARAM_CREATORS, vals['project_creators'])
        if 'default_stages' in vals:
            stages = vals['default_stages']
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
            self._params().set_param(PARAM_STAGES, json.dumps(clean, ensure_ascii=False))
        return self.get()

    def _default_stage_vals(self):
        """Create-ready vals for a new project's stages, in policy order."""
        return [
            {'name': s['name'], 'fold': s['fold'], 'sequence': (i + 1) * 10}
            for i, s in enumerate(self.get()['default_stages'])
        ]


def _invalid(field, message):
    err = ValueError(message)
    err.nasq_field = field
    return err
