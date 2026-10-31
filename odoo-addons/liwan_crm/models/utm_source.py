# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

# Stock sources that suit no Saudi business; the others (Facebook, X, LinkedIn, Referral) stay.
STOCK_SOURCES = (
    'utm_source_search_engine', 'utm_source_mailing', 'utm_source_newsletter',
    'utm_source_monster', 'utm_source_glassdoor', 'utm_source_craigslist',
)


class UtmSource(models.Model):
    _inherit = 'utm.source'

    # Stock sources cannot be archived; opportunities keep a source the settings page retired.
    active = fields.Boolean(default=True)

    @api.model
    def _liwan_retire_stock_sources(self):
        """Archive the unsuitable stock sources once, before the starter list exists.

        The seed file calls this ahead of its records, so a later update finds the starter list
        and leaves alone a stock source the tenant chose to bring back.
        """
        if self.env.ref('liwan_crm.source_whatsapp', raise_if_not_found=False):
            return
        self._liwan_archive_stock_sources()

    @api.model
    def _liwan_archive_stock_sources(self):
        for name in STOCK_SOURCES:
            source = self.env.ref(f'utm.{name}', raise_if_not_found=False)
            if source:
                source.active = False
