# Part of Odoo. See LICENSE file for full copyright and licensing details.
from dateutil.relativedelta import relativedelta

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    """Conversations that exist before the cycles do get one cycle each (an approximation of their history), then every report day is built."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    Cycle = env['webvue.inbox.conversation.cycle']
    for conversation in env['webvue.inbox.conversation'].search([('id', 'not in', Cycle.search([]).conversation_id.ids)]):
        inbound = conversation.message_ids.filtered(lambda message: message.direction == 'in').sorted('date')
        if not inbound:
            continue
        opened_at = inbound[0].date
        replies = conversation.message_ids.filtered(
            lambda message: message.direction == 'out' and message.author_id and not message.automated and message.date >= opened_at,
        ).sorted('date')
        ended = conversation.state in ('resolved', 'closed')
        Cycle.create({
            'company_id': conversation.company_id.id, 'conversation_id': conversation.id, 'channel_id': conversation.channel_id.id,
            'department_id': conversation.department_id.id, 'opened_at': opened_at,
            'first_response_at': replies[:1].date or False, 'responder_id': replies[:1].author_id.id,
            'ended_at': conversation.last_message_at if ended else False, 'end_reason': conversation.state if ended else False,
            'resolver_id': conversation.assignee_id.id if ended else False,
            'csat_score': conversation.csat_score if ended else False, 'csat_at': conversation.csat_at if ended else False,
        })
    Build = env['webvue.inbox.report.build']
    for company in env['res.company'].search([]):
        settings = env['webvue.inbox.settings']._get_for_company(company)
        today = Build._webvue_today(company)
        Build._webvue_rebuild(company, today - relativedelta(months=settings.report_retention_months), today)
        settings.reports_built_timezone = settings.hours_timezone
