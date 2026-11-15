# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The record checks of the setup agent's readiness check (spec 2026-11-04 §6.13): what an application expects to hold once
it is in use, declared in its own addon (``_liwan_ai_record_checks``). The contract lives in the foundation so an
application declares them without depending on liwan_ai, which runs the readiness check itself."""
import re

from odoo import api, models
from odoo.exceptions import ValidationError

CHECK_KEY = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
CHECK_TEXT = ('owner', 'feature_key', 'model', 'capability', 'label_ar', 'label_en', 'page')


class LiwanAiReadiness(models.AbstractModel):
    _name = 'liwan.ai.readiness'
    _description = 'LiwanOS AI readiness check'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_record_checks(self):
        """Pure descriptors, composed through ``super()``: one per model an application expects to hold records once it is in
        use. A descriptor has ``key`` (``<app>.<name>``), ``owner``, ``feature_key``, ``model``, an optional ``domain``
        (which records count), ``capability`` (what its reader needs), ``label_ar``, ``label_en`` (what is missing) and
        ``page`` (the application's page, where the first record is added)."""
        return ()

    def _liwan_ai_error(self, key, message):
        raise ValidationError(self.env._('liwan_ai: readiness check %(key)s: %(message)s', key=key, message=message))

    @api.model
    def _liwan_ai_check_validate(self, check):
        key = check.get('key')
        if not isinstance(key, str) or not CHECK_KEY.match(key):
            self._liwan_ai_error(repr(key), 'key must be <app>.<name>')
        for name in CHECK_TEXT:
            if not check.get(name) or not isinstance(check[name], str):
                self._liwan_ai_error(key, f'missing {name}')
        if key.split('.')[0] != check['owner'].removeprefix('liwan_'):
            self._liwan_ai_error(key, f"key prefix must match owner {check['owner']}")
        if not check['page'].startswith('/') or self.env.get(check['model']) is None:
            self._liwan_ai_error(key, 'page must be an absolute path and model an existing model')
        if not isinstance(check.get('domain', []), (list, tuple)):
            self._liwan_ai_error(key, 'domain must be a list')

    @api.model
    def _liwan_ai_check_map(self):
        checks = {}
        for check in self._liwan_ai_record_checks():
            self._liwan_ai_check_validate(check)
            if check['key'] in checks:
                self._liwan_ai_error(check['key'], 'duplicate check')
            checks[check['key']] = check
        return checks
