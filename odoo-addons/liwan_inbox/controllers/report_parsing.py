# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Query parsing of the report routes: local-day ranges and the channel, department and agent filters."""
from datetime import date

from dateutil.relativedelta import relativedelta

from odoo.http import request

from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_inbox.controllers.helpers import not_found, reject

MAX_REPORT_DAYS = 366
MAX_TEMPLATE_DAYS = 90
QUERY_KEYS = {'from', 'to', 'channel_id', 'department_id', 'agent_id', 'by'}


def parse_day(args, key):
    value = args.get(key) or ''
    try:
        if len(value) == 10:
            return date.fromisoformat(value)
    except ValueError:
        pass
    return reject(f'{key} is required as a date as YYYY-MM-DD', key)


def parse_range(args, maximum=MAX_REPORT_DAYS, earliest=None):
    """(from, to) of the query: both included, forward, at most `maximum` days, none before `earliest`."""
    date_from, date_to = parse_day(args, 'from'), parse_day(args, 'to')
    if not 0 <= (date_to - date_from).days < maximum:
        reject(f'the range runs forward and covers at most {maximum} days', 'to')
    if earliest and date_from < earliest:
        reject('the range starts before the report retention', 'from')
    return date_from, date_to


def reject_unknown(args, allowed):
    unknown = sorted(set(args) - allowed)
    if unknown:
        reject(f'parameter {unknown[0]!r} is not accepted', unknown[0])


def retention_start(settings, today):
    """The earliest local day a report may ask for."""
    return today - relativedelta(months=settings.report_retention_months)


def find_filter(args, key, model, domain=()):
    """The record named by the id query parameter; another company's record is a plain 404."""
    if key not in args:
        return request.env[model]
    record = request.env[model].search([('id', '=', parse_positive_int(args[key], key)), *domain], limit=1)
    if not record:
        raise not_found()
    return record


def parse_filters(args, allow_agent=True):
    """The channel, department and agent filters, each checked to belong to the current company."""
    company = request.env.company
    filters = {
        'channel': find_filter(args, 'channel_id', 'liwan.inbox.channel', [('owner_company_id', '=', company.id)]),
        'department': find_filter(args, 'department_id', 'liwan.inbox.department', [('company_id', '=', company.id)]),
    }
    if allow_agent:
        filters['agent'] = find_filter(args, 'agent_id', 'res.users', [('company_ids', 'in', company.id)])
    return filters
