# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shapes of the analytic plans and accounts (cost centers), the distribution on document lines
and the analytic report.

A distribution is stored by Odoo as a JSON object ``{"<account id>[,<account id>...]": percent}`` on a
journal item. On the wire it is a strict object ``{"<account id>": percent}`` in a request and a list of
``{account, percent}`` in a response; a stored key that names several accounts is flattened to one entry
per account, which keeps the percentage each plan receives.
"""
import re

from .common import dump_day, dump_ref
from .parsing import (
    parse_bool,
    parse_id,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.webvue_api.controllers.common import ApiError

ACCOUNT_KEY = re.compile(r'[1-9][0-9]*', re.ASCII)
PLAN_CREATE_FIELDS = frozenset({'name', 'parent_id'})
PLAN_PATCH_FIELDS = frozenset({'name'})
ACCOUNT_CREATE_FIELDS = frozenset({'name', 'code', 'plan_id', 'active'})
ACCOUNT_PATCH_FIELDS = ACCOUNT_CREATE_FIELDS


def dump_analytic_plan(plan):
    return {'id': plan.id, 'name': plan.name, 'parent': dump_ref(plan.parent_id)}


def dump_analytic_plans(plans):
    return [dump_analytic_plan(plan) for plan in plans]


def dump_analytic_account_ref(account):
    return {'id': account.id, 'name': account.name, 'code': account.code or ''}


def dump_analytic_account(account):
    return {
        **dump_analytic_account_ref(account),
        'plan': dump_ref(account.plan_id),
        'active': account.active,
    }


def dump_analytic_accounts(accounts):
    return [dump_analytic_account(account) for account in accounts]


def _readable_accounts(lines):
    """The analytic accounts the lines name that the caller may read, in one query."""
    ids = {
        int(raw_id)
        for line in lines for key in (line.analytic_distribution or {}) for raw_id in key.split(',') if raw_id.isdecimal()
    }
    return lines.env['account.analytic.account'].with_context(active_test=False).search([('id', 'in', list(ids))])


def has_combined_keys(line):
    """True when the stored distribution has a key naming several accounts (``"1,2"``), which the API cannot express."""
    return any(',' in key for key in (line.analytic_distribution or {}))


def distribution_shares(lines):
    """``{line: [{account, percent}]}`` ordered by account id; one account query for all the lines.

    A stored key naming several accounts is flattened to one entry per account, which keeps the percentage each
    plan receives; writing such a line back is lossy, so the write routes refuse to replace it. An account the
    caller cannot read (legacy data of another company, a shared account) keeps its percentage and shows as
    ``{id, name: '', code: ''}`` instead of failing the whole document.
    """
    readable = _readable_accounts(lines)
    result = {}
    for line in lines:
        percents = {}
        for key, percent in (line.analytic_distribution or {}).items():
            for raw_id in key.split(','):
                if raw_id.isdecimal():
                    percents[int(raw_id)] = percents.get(int(raw_id), 0) + percent
        refs = {account.id: dump_analytic_account_ref(account) for account in readable if account.id in percents}
        result[line] = [
            {'account': refs.get(account_id, {'id': account_id, 'name': '', 'code': ''}), 'percent': percents[account_id]}
            for account_id in sorted(percents)
        ]
    return result


def parse_distribution(raw, field):
    """``{account id: percent}`` of a request object; every percent is above 0 and at most 100.

    Keys are canonical positive integers (no sign, no leading zero). The accounts are resolved and the sum per
    plan is checked by the route.
    """
    if not isinstance(raw, dict):
        raise ApiError(422, 'invalid', f'{field} must be an object of account id to percent', field=field)
    distribution = {}
    for key, value in raw.items():
        if not ACCOUNT_KEY.fullmatch(key):
            raise ApiError(422, 'invalid', f'{field} keys must be analytic account ids', field=field)
        distribution[int(key)] = parse_number(value, field, minimum=0, maximum=100, exclusive_minimum=True)
    return distribution


def _parse_account_fields(payload):
    parsed = {}
    if 'name' in payload:
        parsed['name'] = parse_text(payload['name'], 'name', required=True)
    if 'code' in payload:
        parsed['code'] = parse_text(payload['code'], 'code')
    if 'plan_id' in payload:
        parsed['plan_id'] = parse_id(payload['plan_id'], 'plan_id')
    if 'active' in payload:
        parsed['active'] = parse_bool(payload['active'], 'active')
    return parsed


def parse_plan_create(payload):
    reject_unknown(payload, PLAN_CREATE_FIELDS)
    require_keys(payload, ('name',))
    parsed = {'name': parse_text(payload['name'], 'name', required=True)}
    if payload.get('parent_id') is not None:
        parsed['parent_id'] = parse_id(payload['parent_id'], 'parent_id')
    return parsed


def parse_plan_patch(payload):
    reject_unknown(payload, PLAN_PATCH_FIELDS)
    return {'name': parse_text(payload['name'], 'name', required=True)} if 'name' in payload else {}


def parse_account_create(payload):
    reject_unknown(payload, ACCOUNT_CREATE_FIELDS)
    require_keys(payload, ('name', 'plan_id'))
    return _parse_account_fields(payload)


def parse_account_patch(payload):
    reject_unknown(payload, ACCOUNT_PATCH_FIELDS)
    return _parse_account_fields(payload)


def dump_analytic_report(company, date_from, date_to, plan, rows):
    """The cost center report of a period: ``rows`` is ``[(account, income, expense)]`` in company currency."""
    currency = company.currency_id
    accounts = [
        {
            'account': dump_analytic_account_ref(account),
            'plan': dump_ref(account.plan_id),
            'income': currency.round(income),
            'expense': currency.round(expense),
            'net': currency.round(income - expense),
        }
        for account, income, expense in rows
    ]
    income = currency.round(sum(row['income'] for row in accounts))
    expense = currency.round(sum(row['expense'] for row in accounts))
    return {
        'date_from': dump_day(date_from),
        'date_to': dump_day(date_to),
        'currency': currency.name,
        'plan': dump_ref(plan),
        'accounts': accounts,
        'totals': {'income': income, 'expense': expense, 'net': currency.round(income - expense)},
    }


def dump_analytic_report_line(line):
    return {
        'id': line.id,
        'date': dump_day(line.date),
        'name': line.name or '',
        'ref': line.ref or '',
        'move': dump_ref(line.move_line_id.move_id),
        'general_account': dump_ref(line.general_account_id),
        'partner': dump_ref(line.partner_id),
        'kind': line.general_account_id.internal_group,
        'amount': line.amount,
    }


def dump_analytic_report_lines(lines):
    return [dump_analytic_report_line(line) for line in lines]
