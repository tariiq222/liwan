# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Reads of the daily report rows: totals, series and breakdowns, in the shape of the reports contract."""
from datetime import timedelta

from odoo import api, models

from .report_build import OVER_DAY
from .report_day import COUNTERS

DAY_SERIES_MAX_DAYS = 62
WEEK_SERIES_MAX_DAYS = 190
SUMS = [f'{name}:sum' for name in COUNTERS]
BUCKET_KEYS = {
    'frt_under_5m': 'under_5m', 'frt_under_15m': 'under_15m', 'frt_under_1h': 'under_1h', 'frt_under_4h': 'under_4h',
    'frt_under_24h': 'under_24h', OVER_DAY: 'over_24h',
}


def ratio(part, whole):
    return part / whole if whole else None


def average(total, count):
    return total / count if count else None


def granularity_of(days):
    return 'day' if days <= DAY_SERIES_MAX_DAYS else 'week' if days <= WEEK_SERIES_MAX_DAYS else 'month'


def bucket_start(day, granularity):
    """The first local day of the series bucket that holds `day` (a Monday for weeks, the 1st for months)."""
    if granularity == 'week':
        return day - timedelta(days=day.weekday())
    return day.replace(day=1) if granularity == 'month' else day


def bucket_starts(date_from, date_to, granularity):
    """Every bucket start of the range, empty buckets included."""
    starts, day = [], date_from
    while day <= date_to:
        start = bucket_start(day, granularity)
        if not starts or starts[-1] != start:
            starts.append(start)
        day += timedelta(days=1)
    return starts


def metrics_of(sums):
    """The contract metrics of a dict of summed counters."""
    out, automated = sums['messages_out'], sums['messages_automated']
    good, neutral, bad = sums['csat_good'], sums['csat_neutral'], sums['csat_bad']
    return {
        **{name: sums[name] for name in (
            'conversations_opened', 'conversations_resolved', 'conversations_auto_closed', 'messages_in', 'messages_out',
            'messages_automated', 'messages_failed', 'templates_sent', 'templates_failed')},
        'automated_share': ratio(automated, automated + out),
        'first_response': {
            'count': sums['first_response_count'],
            'average_seconds': average(sums['first_response_seconds_sum'], sums['first_response_count']),
            'buckets': {key: sums[name] for name, key in BUCKET_KEYS.items()},
        },
        'resolution': {
            'count': sums['resolution_count'],
            'average_seconds': average(sums['resolution_seconds_sum'], sums['resolution_count']),
        },
        'csat': {'good': good, 'neutral': neutral, 'bad': bad, 'score': ratio(good, good + neutral + bad)},
    }


def sums_of(values):
    return dict(zip(COUNTERS, (value or 0 for value in values), strict=True))


class LiwanInboxReportQuery(models.AbstractModel):
    _name = 'liwan.inbox.report.query'
    _description = 'Customer Inbox report reads'
    _liwan_scope = 'global'

    @api.model
    def _liwan_domain(self, company, date_from, date_to, **filters):
        """The report rows of `company` between the local days, narrowed by channel, department and agent records."""
        domain = [('company_id', '=', company.id), ('day', '>=', date_from), ('day', '<=', date_to)]
        return domain + [(f'{name}_id', '=', record.id) for name, record in filters.items() if record]

    @api.model
    def _liwan_totals(self, domain):
        (values,) = self.env['liwan.inbox.report.day']._read_group(domain, [], SUMS)
        return metrics_of(sums_of(values))

    @api.model
    def _liwan_series(self, domain, date_from, date_to, granularity):
        buckets = {start: {name: 0 for name in COUNTERS} for start in bucket_starts(date_from, date_to, granularity)}
        for day, *values in self.env['liwan.inbox.report.day']._read_group(domain, ['day:day'], SUMS):
            bucket = buckets[bucket_start(day, granularity)]
            for name, value in zip(COUNTERS, values, strict=True):
                bucket[name] += value or 0
        return [
            {
                'start': start.isoformat(),
                **{name: sums[name] for name in (
                    'messages_in', 'messages_out', 'messages_automated', 'conversations_opened', 'conversations_resolved')},
                'first_response_average_seconds': average(sums['first_response_seconds_sum'], sums['first_response_count']),
                'resolution_average_seconds': average(sums['resolution_seconds_sum'], sums['resolution_count']),
            }
            for start, sums in buckets.items()
        ]

    @api.model
    def _liwan_computed_at(self, domain):
        ((latest,),) = self.env['liwan.inbox.report.day']._read_group(domain, [], ['computed_at:max'])
        return latest

    @api.model
    def _liwan_overview(self, company, date_from, date_to, **filters):
        days = (date_to - date_from).days + 1
        granularity = granularity_of(days)
        domain = self._liwan_domain(company, date_from, date_to, **filters)
        previous = self._liwan_domain(company, date_from - timedelta(days=days), date_from - timedelta(days=1), **filters)
        return {
            'granularity': granularity,
            'totals': self._liwan_totals(domain),
            'previous': self._liwan_totals(previous),
            'series': self._liwan_series(domain, date_from, date_to, granularity),
            'computed_at': self._liwan_computed_at(domain),
        }

    @api.model
    def _liwan_breakdown(self, company, date_from, date_to, by, **filters):
        """[(record or empty, metrics)] per agent, department or channel, most resolved conversations first."""
        domain = self._liwan_domain(company, date_from, date_to, **filters)
        rows = [
            (subject, metrics_of(sums_of(values)))
            for subject, *values in self.env['liwan.inbox.report.day']._read_group(domain, [f'{by}_id'], SUMS)
        ]
        return sorted(rows, key=lambda row: (-row[1]['conversations_resolved'], row[0].id or 0))
