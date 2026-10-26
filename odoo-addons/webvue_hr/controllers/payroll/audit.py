# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, time, timedelta

from pytz import UTC, timezone

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date
from odoo.addons.webvue_hr.serializers.payroll.audit import dump_audit_event


def _utc_start_of(day):
    """Midnight of ``day`` in the user's timezone (else the company's, else UTC) as a naive UTC datetime."""
    zone = timezone(request.env.user.tz or request.env.company.partner_id.tz or 'UTC')
    return zone.localize(datetime.combine(day, time.min)).astimezone(UTC).replace(tzinfo=None)


def _audit_domain(args):
    domain = [('company_id', '=', request.env.company.id)]
    action = args.get('action')
    if action:
        actions = dict(request.env['webvue.hr.audit.event']._fields['action'].selection)
        if action not in actions:
            raise ApiError(422, 'invalid', f"action must be one of {', '.join(sorted(actions))}", field='action')
        domain.append(('action', '=', action))
    date_from = parse_optional_date(args.get('date_from'), 'date_from')
    date_to = parse_optional_date(args.get('date_to'), 'date_to')
    if date_from and date_to and date_from > date_to:
        raise ApiError(422, 'invalid', 'date_to must be on or after date_from', field='date_to')
    # Both days are inclusive local days: ``date_to`` ends at the next local midnight, compared as naive UTC
    # against ``create_date`` (stored in UTC). HR has no shared helper for this; finance uses the same rule.
    if date_from:
        domain.append(('create_date', '>=', _utc_start_of(date_from)))
    if date_to:
        domain.append(('create_date', '<', _utc_start_of(date_to + timedelta(days=1))))
    return domain


class HrPayrollAuditController(http.Controller):

    @http.route('/api/v1/hr/payroll/audit-events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.audit.read')
    def list_audit_events(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = _audit_domain(args)
        Event = request.env['webvue.hr.audit.event']
        events = Event.search(domain, limit=limit, offset=offset)
        return {'items': [dump_audit_event(event) for event in events], 'total': Event.search_count(domain)}
