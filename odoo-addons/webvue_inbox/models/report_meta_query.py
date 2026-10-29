# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Reads of Meta's cost per day and template analytics, in the shape of the reports contract."""
from datetime import datetime, time, timedelta

from odoo import api, models

from .report_query import bucket_start, bucket_starts, granularity_of

PAID_TYPE = 'regular'
SENT_STATES = ('sent', 'delivered', 'read')


class WebVueInboxReportMetaQuery(models.AbstractModel):
    _name = 'webvue.inbox.report.meta.query'
    _description = 'Customer Inbox Meta report reads'
    _webvue_scope = 'global'

    @api.model
    def _webvue_cost_report(self, channels, date_from, date_to):
        """Meta's volume and cost of `channels` between two UTC days: totals, by category, by country and per day."""
        Cost = self.env['webvue.inbox.cost.day']
        domain = [('channel_id', 'in', channels.ids), ('day', '>=', date_from), ('day', '<=', date_to)]
        granularity = granularity_of((date_to - date_from).days + 1)
        by_category = [
            {'category': category, 'type': pricing_type, 'volume': volume, 'cost': cost if has_cost else None}
            for category, pricing_type, volume, cost, has_cost in Cost._read_group(
                domain, ['pricing_category', 'pricing_type'], ['volume:sum', 'cost:sum', 'has_cost:bool_or'])
        ]
        by_country = sorted((
            {'country': country, 'volume': volume, 'cost': cost if has_cost else None}
            for country, volume, cost, has_cost in Cost._read_group(domain, ['country'], ['volume:sum', 'cost:sum', 'has_cost:bool_or'])
        ), key=lambda row: (-row['volume'], row['country']))
        buckets = {start: {'volume': 0, 'paid_volume': 0, 'cost': 0.0, 'has_cost': False} for start in bucket_starts(date_from, date_to, granularity)}
        for day, pricing_type, volume, cost, has_cost in Cost._read_group(
                domain, ['day:day', 'pricing_type'], ['volume:sum', 'cost:sum', 'has_cost:bool_or']):
            bucket = buckets[bucket_start(day, granularity)]
            bucket['volume'] += volume
            bucket['paid_volume'] += volume if pricing_type == PAID_TYPE else 0
            bucket['cost'] += cost
            bucket['has_cost'] |= has_cost
        volume = sum(bucket['volume'] for bucket in buckets.values())
        paid = sum(bucket['paid_volume'] for bucket in buckets.values())
        has_cost = any(bucket['has_cost'] for bucket in buckets.values())
        return {
            'granularity': granularity,
            'totals': {
                'volume': volume, 'paid_volume': paid, 'free_volume': volume - paid,
                'cost': sum(bucket['cost'] for bucket in buckets.values()) if has_cost else None,
            },
            'by_category': by_category,
            'by_country': by_country,
            'series': [
                {'start': start.isoformat(), 'volume': bucket['volume'], 'paid_volume': bucket['paid_volume'],
                 'cost': bucket['cost'] if bucket['has_cost'] else None}
                for start, bucket in buckets.items()
            ],
        }

    @api.model
    def _webvue_template_rows(self, channel, date_from, date_to):
        """[(template, Meta sums, WebVue sent, WebVue failed)] of the channel's templates with any figure in the range."""
        Day = self.env['webvue.inbox.template.day']
        domain = [('template_id.channel_id', '=', channel.id), ('day', '>=', date_from), ('day', '<=', date_to)]
        meta = {
            template.id: (sent, delivered, read, clicked, spent if has_amount else None)
            for template, sent, delivered, read, clicked, spent, has_amount in Day._read_group(
                domain, ['template_id'],
                ['sent:sum', 'delivered:sum', 'read:sum', 'clicked:sum', 'amount_spent:sum', 'has_amount:bool_or'])
        }
        own = self._webvue_own_sends([('template_id.channel_id', '=', channel.id)], date_from, date_to)
        templates = self.env['webvue.inbox.template'].browse(sorted(set(meta) | {template_id for template_id, _s in own}))
        return [
            (template, meta.get(template.id, (0, 0, 0, 0, None)),
             sum(count for (template_id, state), count in own.items() if template_id == template.id and state in SENT_STATES),
             own.get((template.id, 'failed'), 0))
            for template in templates
        ]

    @api.model
    def _webvue_own_sends(self, domain, date_from, date_to):
        """{(template id, delivery state): count} of WebVue's own template messages between two UTC days."""
        start = datetime.combine(date_from, time.min)
        end = datetime.combine(date_to + timedelta(days=1), time.min)
        groups = self.env['webvue.inbox.message']._read_group(
            [*domain, ('direction', '=', 'out'), ('date', '>=', start), ('date', '<', end)],
            ['template_id', 'delivery_state'], ['__count'],
        )
        return {(template.id, state): count for template, state, count in groups if template}

    @api.model
    def _webvue_template_detail(self, template, date_from, date_to):
        Day = self.env['webvue.inbox.template.day']
        days = Day.search([('template_id', '=', template.id), ('day', '>=', date_from), ('day', '<=', date_to)], order='day')
        clicks = self.env['webvue.inbox.template.click']._read_group(
            [('template_day_id', 'in', days.ids)], ['button_type', 'button_text'], ['count:sum'],
        )
        return days, sorted(clicks, key=lambda row: (-row[2], row[1]))[:10]
