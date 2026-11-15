# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanAiSettingRegistry(models.AbstractModel):
    """What liwan_ai adds to the setting registry of liwan_api: which declared settings the caller may change, and the
    change itself, as the caller."""
    _inherit = 'liwan.ai.setting.registry'

    @api.model
    def _liwan_ai_company(self, item):
        """Where the setting's capability is checked: the tenant's root company for a tenant setting, else the current one."""
        if item['scope'] == 'tenant':
            return self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        return self.env.company

    @api.model
    def _liwan_ai_manageable(self):
        """The declared settings of enabled applications that the caller may change, in declaration order."""
        access = self.env['liwan.access.service']
        entitlement = self.env['liwan.entitlement.service']
        return [
            item for item in self._liwan_ai_setting_map().values()
            if entitlement._liwan_feature_read(item['feature_key'])
            and access._liwan_has_capability(self.env.user, item['capability'], company=self._liwan_ai_company(item))
        ]

    @api.model
    def _liwan_ai_current_value(self, item):
        model = self.env[item['model']]
        row = model._liwan_current()
        if row:
            return row[item['field']]
        return model._fields[item['field']].default(model) if model._fields[item['field']].default else None

    @api.model
    def _liwan_ai_check_value(self, item, value):
        """The value as stored, or a ``ValueError`` naming why it is refused."""
        kind = item['type']
        if kind == 'boolean' and not isinstance(value, bool):
            msg = 'the value must be true or false'
            raise ValueError(msg)
        if kind == 'integer':
            if not isinstance(value, int) or isinstance(value, bool) or not item['min'] <= value <= item['max']:
                msg = f"the value must be a whole number from {item['min']} to {item['max']}"
                raise ValueError(msg)
        if kind == 'selection' and value not in item['options']:
            msg = f"the value must be one of {', '.join(item['options'])}"
            raise ValueError(msg)
        return value

    @api.model
    def _liwan_ai_apply(self, item, value):
        """Write one setting as the caller and record the change in the access audit; returns ``(before, after)``."""
        model = self.env[item['model']]
        before = self._liwan_ai_current_value(item)
        row = model._liwan_current()
        if row:
            row.write({item['field']: value, 'revision': row.revision + 1})
        else:
            model.create({item['field']: value, 'company_id': self.env.company.id})
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        self.env['liwan.access.audit']._liwan_log(
            'ai.setting.apply', root if item['scope'] == 'tenant' else self.env.company,
            before={'key': item['key'], 'value': before}, after={'key': item['key'], 'value': value},
        )
        return before, value
