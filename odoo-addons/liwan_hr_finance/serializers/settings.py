# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_finance.serializers.parsing import reject_unknown
from odoo.addons.liwan_hr.serializers.assets.common import ref
from odoo.addons.liwan_hr_finance.models.payroll_finance_settings import (
    ACCOUNT_KEYS,
    account_field,
)

SETTINGS_FIELDS = ('journal_id', 'accounts', 'default_analytic_account_id', 'entry_detail')
ENTRY_DETAILS = ('aggregated', 'per_employee')


def dump_settings(settings):
    return {
        'journal': ref(settings.journal_id),
        'accounts': {key: ref(settings[account_field(key)]) for key in ACCOUNT_KEYS},
        'default_analytic_account': ref(settings.default_analytic_account_id),
        'entry_detail': settings.entry_detail,
    }


def dump_cost_center(department, analytic_account):
    return {'department': ref(department), 'analytic_account': ref(analytic_account)}


def parse_optional_id(value, field):
    """A record id, or None to clear the reference; 422 on anything else."""
    return None if value is None else parse_positive_int(value, field)


def parse_settings(payload):
    """The checked request values: ``journal_id``, ``default_analytic_account_id``, ``accounts`` (key to id or
    None) and ``entry_detail``, each only when the body names it. Existence and company are checked by the route."""
    reject_unknown(payload, SETTINGS_FIELDS)
    parsed = {}
    for name in ('journal_id', 'default_analytic_account_id'):
        if name in payload:
            parsed[name] = parse_optional_id(payload[name], name)
    if 'accounts' in payload:
        accounts = payload['accounts']
        if not isinstance(accounts, dict):
            raise ApiError(422, 'invalid', 'accounts must be an object', field='accounts')
        reject_unknown(accounts, ACCOUNT_KEYS, prefix='accounts.')
        parsed['accounts'] = {
            key: parse_optional_id(value, f'accounts.{key}') for key, value in accounts.items()
        }
    if 'entry_detail' in payload:
        if payload['entry_detail'] not in ENTRY_DETAILS:
            raise ApiError(422, 'invalid', 'entry_detail must be aggregated or per_employee', field='entry_detail')
        parsed['entry_detail'] = payload['entry_detail']
    return parsed
