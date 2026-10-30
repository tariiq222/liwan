# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

HOURLY_DAYS = 2
NIGHTLY_DAYS = 7

COUNTERS = (
    'messages_in', 'messages_out', 'messages_automated', 'messages_failed', 'templates_sent', 'templates_failed',
    'conversations_opened', 'conversations_resolved', 'conversations_auto_closed',
    'first_response_count', 'first_response_seconds_sum',
    'frt_under_5m', 'frt_under_15m', 'frt_under_1h', 'frt_under_4h', 'frt_under_24h', 'frt_over_24h',
    'resolution_count', 'resolution_seconds_sum', 'csat_good', 'csat_neutral', 'csat_bad',
)


class WebVueInboxReportDay(models.Model):
    """The counters of one local day, channel, department and agent. Rebuilt from the messages and cycles, never incremented."""
    _name = 'webvue.inbox.report.day'
    _description = 'Customer Inbox daily report row'
    _order = 'day desc, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    day = fields.Date(required=True, index=True)
    channel_id = fields.Many2one('webvue.inbox.channel', required=True, index=True, ondelete='cascade')
    department_id = fields.Many2one('webvue.inbox.department', ondelete='cascade')
    # Empty for what no agent did: inbound messages, automation, conversations that opened.
    agent_id = fields.Many2one('res.users', ondelete='cascade')
    messages_in = fields.Integer()
    messages_out = fields.Integer()
    messages_automated = fields.Integer()
    messages_failed = fields.Integer()
    templates_sent = fields.Integer()
    templates_failed = fields.Integer()
    conversations_opened = fields.Integer()
    conversations_resolved = fields.Integer()
    conversations_auto_closed = fields.Integer()
    first_response_count = fields.Integer()
    first_response_seconds_sum = fields.Integer()
    frt_under_5m = fields.Integer()
    frt_under_15m = fields.Integer()
    frt_under_1h = fields.Integer()
    frt_under_4h = fields.Integer()
    frt_under_24h = fields.Integer()
    frt_over_24h = fields.Integer()
    resolution_count = fields.Integer()
    resolution_seconds_sum = fields.Integer()
    csat_good = fields.Integer()
    csat_neutral = fields.Integer()
    csat_bad = fields.Integer()
    computed_at = fields.Datetime(required=True)

    _row_unique = models.UniqueIndex(
        '(company_id, day, channel_id, COALESCE(department_id, 0), COALESCE(agent_id, 0))',
        'A report row is unique per day, channel, department and agent.',
    )
    _counters_check = models.Constraint(
        'CHECK(' + ' AND '.join(f'{name} >= 0' for name in COUNTERS) + ')', 'Report counters are not negative.',
    )

    @api.model
    def _webvue_run_hourly(self):
        """Rebuild today and yesterday of every company."""
        self.env['webvue.inbox.report.build']._webvue_run_recent(HOURLY_DAYS)

    @api.model
    def _webvue_run_nightly(self):
        """Rebuild the last week, which catches late delivery statuses and survey answers (and a changed timezone)."""
        self.env['webvue.inbox.report.build']._webvue_run_recent(NIGHTLY_DAYS)
