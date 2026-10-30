# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from odoo import http
from odoo.http import request

from .common import list_page, parse_choice, parse_day, require_capability
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_finance.serializers.audit import dump_audit_events


def _utc_start_of(day):
    """Midnight of ``day`` in the user's timezone (else the company's, else UTC) as a naive UTC datetime."""
    tz = ZoneInfo(request.env.user.tz or request.env.company.partner_id.tz or 'UTC')
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(ZoneInfo('UTC')).replace(tzinfo=None)


class FinanceAuditController(http.Controller):

    @http.route('/api/v1/finance/audit-events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def list_audit_events(self, **_):
        require_capability('finance.audit.read')
        args = request.httprequest.args
        domain = [('company_id', '=', request.env.company.id)]
        action = parse_choice(
            args.get('action'), request.env['liwan.finance.audit.event']._fields['action'].get_values(request.env), 'action',
        )
        if action:
            domain.append(('action', '=', action))
        date_from = parse_day(args['date_from'], 'date_from') if args.get('date_from') else None
        date_to = parse_day(args['date_to'], 'date_to') if args.get('date_to') else None
        if date_from and date_to and date_from > date_to:
            raise ApiError(422, 'invalid', 'date_to must be on or after date_from', field='date_to')
        if date_from:
            domain.append(('create_date', '>=', _utc_start_of(date_from)))
        if date_to:
            domain.append(('create_date', '<', _utc_start_of(date_to + timedelta(days=1))))
        return list_page('liwan.finance.audit.event', domain, dump_audit_events)
