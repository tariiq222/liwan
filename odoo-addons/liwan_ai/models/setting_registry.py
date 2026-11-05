# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

SETTING_KEY = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
SETTING_TYPES = ('selection', 'boolean', 'integer')  # each is also the Odoo field type it declares
SETTING_SCOPES = ('tenant', 'company')
SETTING_TEXT = ('owner', 'feature_key', 'model', 'field', 'capability', 'label_ar', 'label_en', 'impact_ar', 'impact_en')


class LiwanAiSettingRegistry(models.AbstractModel):
    """The settings an assistant may read and, after a person's approval, change (spec 2026-11-04 §6.5).

    Each application declares, in its ``liwan_<app>_ai`` bridge, the fields of its own settings model the setup agent
    may work with. A declaration is data only: reading and writing follow the LiwanOS settings pattern, as the caller,
    through that model's ACLs and constraints (``_liwan_current()``; a ``revision`` bumped by every write; one row per
    company created on the first write, or the tenant's one record). Roles and permissions are never declared here: the
    setup agent may suggest them in words, never change them.
    """
    _name = 'liwan.ai.setting.registry'
    _description = 'LiwanOS AI setting registry'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_setting_definitions(self):
        """Pure descriptors; never a process-global set."""
        return ()

    def _liwan_ai_error(self, key, message):
        raise ValidationError(self.env._('liwan_ai: setting %(key)s: %(message)s', key=key, message=message))

    @api.model
    def _liwan_ai_validate(self, item):
        key = item.get('key')
        if not isinstance(key, str) or not SETTING_KEY.match(key):
            self._liwan_ai_error(repr(key), 'key must be <app>.<field>')
        for name in SETTING_TEXT:
            if not item.get(name) or not isinstance(item[name], str):
                self._liwan_ai_error(key, f'missing {name}')
        if key.split('.')[0] != item['owner'].removeprefix('liwan_'):
            self._liwan_ai_error(key, f"key prefix must match owner {item['owner']}")
        if item.get('scope') not in SETTING_SCOPES:
            self._liwan_ai_error(key, f'scope must be one of {SETTING_SCOPES}')
        if item.get('type') not in SETTING_TYPES:
            self._liwan_ai_error(key, f'type must be one of {tuple(SETTING_TYPES)}')
        model = self.env.get(item['model'])
        field = model._fields.get(item['field']) if model is not None else None
        if field is None or field.type != item['type']:
            self._liwan_ai_error(key, f"{item['model']}.{item['field']} is not a {item['type']} field")
        if 'revision' not in model._fields or not hasattr(model, '_liwan_current'):
            self._liwan_ai_error(key, f"{item['model']} does not follow the settings pattern")
        if item['type'] == 'selection':
            allowed = {value for value, _label in field._description_selection(self.env)}
            options = item.get('options')
            if not isinstance(options, (list, tuple)) or not options or not set(options) <= allowed:
                self._liwan_ai_error(key, 'options must be values of the field')
        if item['type'] == 'integer':
            low, high = item.get('min'), item.get('max')
            if not all(isinstance(bound, int) and not isinstance(bound, bool) for bound in (low, high)) or low > high:
                self._liwan_ai_error(key, 'an integer setting declares min <= max')

    @api.model
    def _liwan_ai_setting_map(self):
        settings = {}
        for item in self._liwan_ai_setting_definitions():
            self._liwan_ai_validate(item)
            if item['key'] in settings:
                self._liwan_ai_error(item['key'], 'duplicate setting')
            settings[item['key']] = item
        return settings

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
