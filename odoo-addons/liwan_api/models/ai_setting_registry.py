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

    The registration contract lives in the foundation so an application declares its settings in its own addon without
    depending on liwan_ai. Each application declares the fields of its own settings model the setup agent
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
