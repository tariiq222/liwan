# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Builds the daily report rows from the messages and conversation cycles; a day is always rebuilt whole, never incremented."""
import logging
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from .batch import process_each
from .report_day import NIGHTLY_DAYS

_logger = logging.getLogger(__name__)
REPORTS_FEATURE = 'inbox.reports'
SENT_STATES = ('sent', 'delivered', 'read')
# The first response buckets: (counter, exclusive upper bound in seconds); anything longer is over 24 hours.
RESPONSE_BUCKETS = (
    ('frt_under_5m', 5 * 60), ('frt_under_15m', 15 * 60), ('frt_under_1h', 3600), ('frt_under_4h', 4 * 3600),
    ('frt_under_24h', 24 * 3600),
)
OVER_DAY = 'frt_over_24h'
CSAT_COUNTERS = {'good': 'csat_good', 'neutral': 'csat_neutral', 'bad': 'csat_bad'}


def local_day(value, zone):
    """The local date of a naive UTC datetime."""
    return value.replace(tzinfo=timezone.utc).astimezone(zone).date()


def utc_bounds(zone, date_from, date_to):
    """The naive UTC datetimes that start the local day `date_from` and end the local day `date_to`."""
    def utc(day):
        return datetime.combine(day, time.min, zone).astimezone(timezone.utc).replace(tzinfo=None)
    return utc(date_from), utc(date_to + timedelta(days=1))


class LiwanInboxReportBuild(models.AbstractModel):
    _name = 'liwan.inbox.report.build'
    _description = 'Customer Inbox report builder'
    _liwan_scope = 'global'

    @api.model
    def _liwan_zone_name(self, company):
        """The report timezone of a company: the one of its inbox working hours."""
        return self.env['liwan.inbox.settings']._get_for_company(company).hours_timezone

    @api.model
    def _liwan_today(self, company):
        return local_day(fields.Datetime.now(), ZoneInfo(self._liwan_zone_name(company)))

    @api.model
    def _liwan_rebuild(self, company, date_from, date_to):
        """Replace the rows of the local days `date_from` to `date_to` of `company` with freshly counted ones."""
        zone_name = self._liwan_zone_name(company)
        zone = ZoneInfo(zone_name)
        start, end = utc_bounds(zone, date_from, date_to)
        rows = defaultdict(Counter)
        self._liwan_count_messages(rows, company, zone_name, start, end)
        self._liwan_count_cycles(rows, company, zone, start, end)
        now = fields.Datetime.now()
        Row = self.env['liwan.inbox.report.day']
        Row.search([('company_id', '=', company.id), ('day', '>=', date_from), ('day', '<=', date_to)]).unlink()
        Row.create([
            {'company_id': company.id, 'day': day, 'channel_id': channel, 'department_id': department,
             'agent_id': agent, 'computed_at': now, **counters}
            for (day, channel, department, agent), counters in rows.items()
        ])

    @api.model
    def _liwan_count_messages(self, rows, company, zone_name, start, end):
        groups = self.env['liwan.inbox.message'].with_context(tz=zone_name)._read_group(
            [('company_id', '=', company.id), ('direction', 'in', ('in', 'out')), ('date', '>=', start), ('date', '<', end)],
            ['date:day', 'conversation_id.channel_id', 'conversation_id.department_id', 'author_id', 'automated',
             'direction', 'kind', 'delivery_state'],
            ['__count'],
        )
        for day, channel, department, author, automated, direction, kind, state, count in groups:
            day = day.date() if isinstance(day, datetime) else day
            if direction == 'in':
                key, counters = (day, channel.id, department.id, False), {'messages_in': count}
            else:
                agent = False if automated else author.id
                key = (day, channel.id, department.id, agent)
                counters = {'messages_automated' if automated else 'messages_out': count}
                if state == 'failed':
                    counters['messages_failed'] = count
                if kind == 'template' and not automated and (state == 'failed' or state in SENT_STATES):
                    counters['templates_failed' if state == 'failed' else 'templates_sent'] = count
            rows[key].update(counters)

    @api.model
    def _liwan_count_cycles(self, rows, company, zone, start, end):
        Cycle = self.env['liwan.inbox.conversation.cycle']
        fields_read = ['channel_id', 'department_id', 'opened_at', 'first_response_at', 'first_response_seconds',
                       'responder_id', 'ended_at', 'end_reason', 'resolution_seconds', 'resolver_id', 'csat_score', 'csat_at']

        def key(cycle, moment, agent):
            return (local_day(cycle[moment], zone), cycle['channel_id'][0], cycle['department_id'][0] if cycle['department_id'] else False,
                    cycle[agent][0] if agent and cycle[agent] else False)

        def within(column):
            return [('company_id', '=', company.id), (column, '>=', start), (column, '<', end)]

        for cycle in Cycle.search_read(within('opened_at'), fields_read):
            rows[key(cycle, 'opened_at', None)]['conversations_opened'] += 1
        for cycle in Cycle.search_read(within('first_response_at'), fields_read):
            counters = rows[key(cycle, 'first_response_at', 'responder_id')]
            seconds = cycle['first_response_seconds']
            counters['first_response_count'] += 1
            counters['first_response_seconds_sum'] += seconds
            counters[next((name for name, limit in RESPONSE_BUCKETS if seconds < limit), OVER_DAY)] += 1
        for cycle in Cycle.search_read(within('ended_at'), fields_read):
            if cycle['end_reason'] == 'auto_closed':
                rows[key(cycle, 'ended_at', None)]['conversations_auto_closed'] += 1
            elif cycle['end_reason'] == 'resolved':
                counters = rows[key(cycle, 'ended_at', 'resolver_id')]
                counters['conversations_resolved'] += 1
                counters['resolution_count'] += 1
                counters['resolution_seconds_sum'] += cycle['resolution_seconds']
        for cycle in Cycle.search_read(within('csat_at') + [('csat_score', '!=', False)], fields_read):
            rows[key(cycle, 'csat_at', 'resolver_id')][CSAT_COUNTERS[cycle['csat_score']]] += 1

    # crons

    @api.model
    def _liwan_enabled(self):
        return self.env['liwan.entitlement.service']._liwan_feature_write(REPORTS_FEATURE)

    @api.model
    def _liwan_run_recent(self, days):
        """Rebuild the last `days` local days of every company."""
        if not self._liwan_enabled():
            return
        companies = self.env['res.company'].search([])
        process_each(companies, lambda company: self._liwan_rebuild_recent(company, days), self._liwan_failed)

    @api.model
    def _liwan_rebuild_recent(self, company, days):
        settings = self.env['liwan.inbox.settings']._get_for_company(company)
        today = self._liwan_today(company)
        if days >= NIGHTLY_DAYS and settings.reports_built_timezone != settings.hours_timezone:
            # The timezone changed (or this is the first build): every retained day moves to the new local days.
            self._liwan_rebuild(company, self._liwan_backed_start(settings, today), today)
            settings.reports_built_timezone = settings.hours_timezone
        else:
            self._liwan_rebuild(company, today - timedelta(days=days - 1), today)

    @api.model
    def _liwan_backed_start(self, settings, today):
        """The first local day a full rebuild may cover: later than the report retention and the conversation retention.

        Older days keep their rows, because the conversations behind them are purged and a rebuild would empty them.
        """
        return max(
            today - relativedelta(months=settings.report_retention_months), today - relativedelta(months=settings.retention_months),
        )

    @api.model
    def _liwan_failed(self, company, error):
        _logger.warning('report build of company %s failed: %s', company.id, type(error).__name__)

    @api.model
    def _liwan_purge(self, company, now):
        """Delete the company's report, cost and template analytics rows older than its retention."""
        cutoff = fields.Date.to_date(now) - relativedelta(months=self.env['liwan.inbox.settings']._get_for_company(company).report_retention_months)
        for model, owner in (
            ('liwan.inbox.report.day', 'company_id'), ('liwan.inbox.cost.day', 'owner_company_id'),
            ('liwan.inbox.template.day', 'owner_company_id'),
        ):
            self.env[model].search([(owner, '=', company.id), ('day', '<', cutoff)]).unlink()
