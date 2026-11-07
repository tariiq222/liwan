# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent (spec 2026-11-04 §6.13): what is still missing for the tenant, as the caller may see
it. It changes nothing; each item names the page that fixes it. liwan_ai knows no application, so what an application
expects to hold once it is in use is declared in its ``liwan_<app>_ai`` bridge (``_liwan_ai_record_checks``). An
unsigned AI acknowledgement is not listed: no run, and so no readiness check, happens without a signed one."""
import re

from odoo import api, models
from odoo.exceptions import AccessError, ValidationError

SEVERITIES = ('recommended', 'optional')
SETTINGS_PAGE = '/settings'
USERS_PAGE = '/settings/team/users'
USERS_READ = 'access.users.read'
CHECK_KEY = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
CHECK_TEXT = ('owner', 'feature_key', 'model', 'capability', 'label_ar', 'label_en', 'page')
LISTED_SETTINGS = 3


def item(key, severity, page, label_ar, label_en):
    return {'key': key, 'severity': severity, 'page': page, 'label': {'ar': label_ar, 'en': label_en}}


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

    @api.model
    def _liwan_ai_missing(self):
        """The items still missing for the tenant, as the caller may see them, most urgent first."""
        found = [
            *self._liwan_ai_user_items(),
            *self._liwan_ai_settings_items(),
            *self._liwan_ai_record_items(),
        ]
        return sorted(found, key=lambda entry: SEVERITIES.index(entry['severity']))

    @api.model
    def _liwan_ai_user_items(self):
        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, USERS_READ):
            return []
        assigned = self.env['liwan.access.assignment']._read_group([('company_id', '=', self.env.company.id)], ['user_id'])
        idle = self.env['res.users'].search_count([
            ('share', '=', False), ('company_ids', 'in', self.env.company.ids), ('id', 'not in', [user.id for [user] in assigned]),
        ])
        if not idle:
            return []
        return [item(
            'access.users_without_role', 'recommended', USERS_PAGE,
            f'{idle} من المستخدمين بلا أي دور في هذه الشركة، فلا يرون شيئًا حتى يُمنحوا دورًا',
            f'{idle} users have no role in this company, so they see nothing until given one',
        )]

    @api.model
    def _liwan_ai_settings_items(self):
        """One item per application whose settings the caller may change but nobody has saved yet."""
        unsaved = {}
        for setting in self.env['liwan.ai.setting.registry']._liwan_ai_manageable():
            if not self.env[setting['model']]._liwan_current():
                unsaved.setdefault(setting['owner'], []).append(setting)
        found = []
        for owner, settings in unsaved.items():
            listed = settings[:LISTED_SETTINGS]
            more = len(settings) > len(listed)
            found.append(item(
                f"settings.{owner.removeprefix('liwan_')}", 'recommended', SETTINGS_PAGE,
                'إعدادات لم تُحفظ بعد: ' + '، '.join(entry['label_ar'] for entry in listed) + ('…' if more else ''),
                'Settings not saved yet: ' + ', '.join(entry['label_en'] for entry in listed) + ('…' if more else ''),
            ))
        return found

    @api.model
    def _liwan_ai_record_items(self):
        """An enabled application the caller may read that holds no record yet; a cheap existence check in the caller's own access."""
        entitlement = self.env['liwan.entitlement.service']
        access = self.env['liwan.access.service']
        found = []
        for check in self._liwan_ai_check_map().values():
            if not entitlement._liwan_feature_read(check['feature_key']) or not access._liwan_has_capability(self.env.user, check['capability']):
                continue
            try:
                empty = not self.env[check['model']].search_count(list(check.get('domain', [])), limit=1)
            except AccessError:
                continue
            if empty:
                found.append(item(f"records.{check['key']}", 'optional', check['page'], check['label_ar'], check['label_en']))
        return found
