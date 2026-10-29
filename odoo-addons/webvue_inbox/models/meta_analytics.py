# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Pulls Meta's own analytics (cost and volume per day, template insights) into the tenant's tables."""
import logging
from collections import defaultdict
from datetime import timedelta

from odoo import api, fields, models

from .batch import process_each
from .health_constants import (
    ANALYTICS_COOLDOWN,
    PRICING_BACKFILL_DAYS,
    PRICING_REFRESH_DAYS,
    TEMPLATE_REFRESH_DAYS,
)
from odoo.addons.webvue_inbox.adapters import whatsapp

_logger = logging.getLogger(__name__)
ERROR_TEXT_LENGTH = 200


class WebVueInboxMetaAnalytics(models.AbstractModel):
    _name = 'webvue.inbox.meta.analytics'
    _description = 'Customer Inbox Meta analytics sync'
    _webvue_scope = 'global'

    @api.model
    def _webvue_cooling_down(self, channel):
        attempted = channel.analytics_attempted_at
        return bool(attempted and fields.Datetime.now() - attempted < ANALYTICS_COOLDOWN)

    @api.model
    def _webvue_sync(self, channel):
        """Pull the pricing and template analytics of one channel; a provider error is kept on the channel, not raised."""
        channel.ensure_one()
        now = fields.Datetime.now()
        channel.analytics_attempted_at = now
        try:
            with self.env.cr.savepoint():
                credentials = channel._webvue_credentials()
                if not channel.display_phone_number:
                    channel._webvue_fetch_health()
                if not channel.display_phone_number:
                    self._webvue_unknown_number()
                if not channel.currency_code:
                    self._webvue_read_currency(channel, credentials)
                self._webvue_sync_pricing(channel, credentials, now)
                if channel.template_insights_enabled:
                    self._webvue_sync_templates(channel, credentials, now)
        except whatsapp.ProviderError as error:
            channel.analytics_error = str(error)[:ERROR_TEXT_LENGTH]
        else:
            channel.write({'analytics_synced_at': now, 'analytics_error': False})

    @api.model
    def _webvue_unknown_number(self):
        message = 'the phone number is not known yet'
        raise whatsapp.ProviderError(message, retryable=False)

    @api.model
    def _webvue_read_currency(self, channel, credentials):
        try:
            channel.currency_code = whatsapp.fetch_currency(credentials) or False
        except whatsapp.ProviderError:
            channel.currency_code = False  # Meta does not offer the field on every account: amounts then show without a currency

    @api.model
    def _webvue_sync_pricing(self, channel, credentials, now):
        today = now.date()
        days = PRICING_REFRESH_DAYS if channel.analytics_synced_at else PRICING_BACKFILL_DAYS
        start = today - timedelta(days=days - 1)
        points = whatsapp.fetch_pricing(credentials, channel.display_phone_number, start, today)
        merged = defaultdict(lambda: [0, None])
        for point in points:
            entry = merged[point.day, point.category, point.pricing_type, point.country]
            entry[0] += point.volume
            if point.cost is not None:
                entry[1] = (entry[1] or 0.0) + point.cost
        Cost = self.env['webvue.inbox.cost.day']
        Cost.search([('channel_id', '=', channel.id), ('day', '>=', start)]).unlink()
        Cost.create([
            {'owner_company_id': channel.owner_company_id.id, 'channel_id': channel.id, 'day': day, 'pricing_category': category,
             'pricing_type': pricing_type, 'country': country, 'volume': volume, 'cost': cost or 0.0,
             'has_cost': cost is not None, 'synced_at': now}
            for (day, category, pricing_type, country), (volume, cost) in merged.items()
        ])

    @api.model
    def _webvue_sync_templates(self, channel, credentials, now):
        today = now.date()
        start = today - timedelta(days=TEMPLATE_REFRESH_DAYS - 1)
        templates = self.env['webvue.inbox.template'].search([
            ('channel_id', '=', channel.id), ('provider_template_id', '!=', False),
        ]).filtered(lambda template: template.provider_template_id.isdigit())
        by_provider_id = {template.provider_template_id: template for template in templates}
        ids = sorted(by_provider_id)
        Day = self.env['webvue.inbox.template.day']
        Day.search([('template_id', 'in', templates.ids), ('day', '>=', start)]).unlink()
        step = whatsapp.TEMPLATE_IDS_PER_REQUEST
        for index in range(0, len(ids), step):
            for point in whatsapp.fetch_template_analytics(credentials, ids[index:index + step], start, today):
                template = by_provider_id.get(point.template_id)
                if template:
                    self._webvue_store_template_day(channel, template, point, now)

    @api.model
    def _webvue_store_template_day(self, channel, template, point, now):
        company = channel.owner_company_id.id
        clicks = defaultdict(int)
        for click in point.clicks:
            clicks[click.kind, click.text] += click.count
        self.env['webvue.inbox.template.day'].create({
            'owner_company_id': company, 'template_id': template.id, 'day': point.day, 'sent': point.sent,
            'delivered': point.delivered, 'read': point.read, 'amount_spent': point.amount_spent or 0.0,
            'has_amount': point.amount_spent is not None, 'synced_at': now,
            'click_ids': [
                (0, 0, {'owner_company_id': company, 'button_type': kind, 'button_text': text, 'count': count})
                for (kind, text), count in clicks.items()
            ],
        })

    @api.model
    def _webvue_enable_template_insights(self, channel):
        """Turn on Meta's template analytics for the channel's business account (irreversible at Meta)."""
        if not channel.template_insights_enabled:
            whatsapp.enable_template_insights(channel._webvue_credentials())
            channel.template_insights_enabled = True

    @api.model
    def _webvue_run(self):
        """Pull the analytics of every connected channel (daily)."""
        channels = self.env['webvue.inbox.channel'].search([('kind', '=', 'whatsapp'), ('state', '=', 'connected')])
        process_each(channels, self._webvue_sync, self._webvue_failed)

    @api.model
    def _webvue_failed(self, channel, error):
        _logger.warning('analytics sync of channel %s failed: %s', channel.id, type(error).__name__)
