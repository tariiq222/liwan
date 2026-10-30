# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Inbox reports (capability inbox.reports.read): LiwanOS's own metrics, Meta's cost and template analytics."""
import csv
import io

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.controllers.conversation_files import safe_cell
from odoo.addons.liwan_inbox.controllers.helpers import not_found, reject
from odoo.addons.liwan_inbox.controllers.report_parsing import (
    MAX_TEMPLATE_DAYS,
    find_filter,
    parse_filters,
    parse_range,
    reject_unknown,
    retention_start,
)
from odoo.addons.liwan_inbox.models.access_service import REPORTS_READ
from odoo.addons.liwan_inbox.serializers.reports import (
    dump_breakdown_row,
    dump_cost_report,
    dump_overview,
    dump_template_detail,
    dump_template_row,
)

REPORTS_FEATURE = 'inbox.reports'
BREAKDOWNS = ('agent', 'department', 'channel')
EXPORT_COLUMNS = (
    'conversations_opened', 'conversations_resolved', 'conversations_auto_closed', 'messages_in', 'messages_out',
    'messages_automated', 'messages_failed', 'templates_sent', 'templates_failed',
)


def settings():
    return request.env['liwan.inbox.settings']._get_for_company(request.env.company)


def report_range(args):
    build = request.env['liwan.inbox.report.build']
    return parse_range(args, earliest=retention_start(settings(), build._liwan_today(request.env.company)))


def parse_by(args):
    by = args.get('by')
    if by not in BREAKDOWNS:
        reject(f'by must be one of {list(BREAKDOWNS)}', 'by')
    return by


def breakdown_filters(args, by):
    if by == 'agent' and 'agent_id' in args:
        reject('agent_id cannot narrow a breakdown by agent', 'agent_id')
    filters = parse_filters(args)
    return {name: record for name, record in filters.items() if name != by}


def sheet(rows):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(('subject', *EXPORT_COLUMNS, 'first_response_average_seconds', 'resolution_average_seconds', 'csat_score'))
    for subject, metrics in rows:
        writer.writerow((
            safe_cell(subject.name) if subject else '', *(metrics[name] for name in EXPORT_COLUMNS),
            *('' if value is None else value for value in (
                metrics['first_response']['average_seconds'], metrics['resolution']['average_seconds'], metrics['csat']['score'],
            )),
        ))
    return out.getvalue()


class ReportController(http.Controller):

    @http.route('/api/v1/inbox/reports/overview', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', REPORTS_FEATURE, operation='read')
    @requires_capability(REPORTS_READ)
    def overview(self, **_):
        args = request.httprequest.args
        reject_unknown(args, {'from', 'to', 'channel_id', 'department_id', 'agent_id'})
        date_from, date_to = report_range(args)
        filters = parse_filters(args)
        result = request.env['liwan.inbox.report.query']._liwan_overview(request.env.company, date_from, date_to, **filters)
        return dump_overview(settings().hours_timezone, date_from, date_to, result)

    @http.route('/api/v1/inbox/reports/breakdown', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', REPORTS_FEATURE, operation='read')
    @requires_capability(REPORTS_READ)
    def breakdown(self, **_):
        args = request.httprequest.args
        reject_unknown(args, {'by', 'from', 'to', 'channel_id', 'department_id', 'agent_id'})
        by = parse_by(args)
        date_from, date_to = report_range(args)
        rows = request.env['liwan.inbox.report.query']._liwan_breakdown(
            request.env.company, date_from, date_to, by, **breakdown_filters(args, by),
        )
        return {'items': [dump_breakdown_row(subject, metrics) for subject, metrics in rows], 'total': len(rows)}

    @http.route('/api/v1/inbox/reports/export', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', REPORTS_FEATURE, operation='read')
    @requires_capability(REPORTS_READ)
    def export(self, **_):
        args = request.httprequest.args
        reject_unknown(args, {'by', 'from', 'to', 'channel_id', 'department_id', 'agent_id'})
        by = parse_by(args)
        date_from, date_to = report_range(args)
        rows = request.env['liwan.inbox.report.query']._liwan_breakdown(
            request.env.company, date_from, date_to, by, **breakdown_filters(args, by),
        )
        return request.make_response('﻿' + sheet(rows), headers=[
            ('Content-Type', 'text/csv; charset=utf-8'),
            ('Content-Disposition', f'attachment; filename="inbox-report-{by}.csv"'),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])

    @http.route('/api/v1/inbox/reports/costs', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', REPORTS_FEATURE, operation='read')
    @requires_capability(REPORTS_READ)
    def costs(self, **_):
        args = request.httprequest.args
        reject_unknown(args, {'from', 'to', 'channel_id'})
        date_from, date_to = report_range(args)
        channel = find_filter(args, 'channel_id', 'liwan.inbox.channel', [('owner_company_id', '=', request.env.company.id)])
        channels = channel or request.env['liwan.inbox.channel'].search([
            ('owner_company_id', '=', request.env.company.id), ('kind', '=', 'whatsapp'),
        ])
        currencies = set(channels.mapped('currency_code'))  # a channel with no known currency counts as one of its own
        if len(currencies) > 1:
            reject('the selected channels are billed in different currencies; pick one channel', 'channel_id')
        result = request.env['liwan.inbox.report.meta.query']._liwan_cost_report(channels, date_from, date_to)
        return dump_cost_report(date_from, date_to, next(iter(currencies), None) or None, result, channels)

    @http.route('/api/v1/inbox/reports/templates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', REPORTS_FEATURE, operation='read')
    @requires_capability(REPORTS_READ)
    def templates(self, **_):
        args = request.httprequest.args
        reject_unknown(args, {'from', 'to', 'channel_id'})
        if 'channel_id' not in args:
            reject('channel_id is required', 'channel_id')
        date_from, date_to = parse_range(args, maximum=MAX_TEMPLATE_DAYS)
        channel = find_filter(args, 'channel_id', 'liwan.inbox.channel', [('owner_company_id', '=', request.env.company.id)])
        rows = request.env['liwan.inbox.report.meta.query']._liwan_template_rows(channel, date_from, date_to)
        items = [dump_template_row(template, *rest) for template, *rest in rows]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/inbox/reports/templates/<int:template_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', REPORTS_FEATURE, operation='read')
    @requires_capability(REPORTS_READ)
    def template_detail(self, template_id, **_):
        args = request.httprequest.args
        reject_unknown(args, {'from', 'to'})
        date_from, date_to = parse_range(args, maximum=MAX_TEMPLATE_DAYS)
        template = request.env['liwan.inbox.template'].search([
            ('id', '=', template_id), ('company_id', '=', request.env.company.id),
        ], limit=1)
        if not template:
            raise not_found()
        query = request.env['liwan.inbox.report.meta.query']
        ((_template, *rest),) = [row for row in query._liwan_template_rows(template.channel_id, date_from, date_to) if row[0] == template] or [
            (template, (0, 0, 0, 0, None), 0, 0),
        ]
        days, clicks = query._liwan_template_detail(template, date_from, date_to)
        row = dump_template_row(template, *rest)
        return dump_template_detail(template, date_from, date_to, row, days, clicks)
