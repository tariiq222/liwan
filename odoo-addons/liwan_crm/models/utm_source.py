# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

# Stock sources that suit no Saudi business, by xml id and stock name; the others (Facebook, X, LinkedIn,
# Referral) stay.
STOCK_SOURCES = {
    'utm_source_search_engine': 'Search engine',
    'utm_source_mailing': 'Lead Recall',
    'utm_source_newsletter': 'Newsletter',
    'utm_source_monster': 'Monster',
    'utm_source_glassdoor': 'Glassdoor',
    'utm_source_craigslist': 'Craigslist',
}
# The Arabic starter set, by xml id. UTM keeps names unique and untranslated, so they are plain Arabic.
STARTER_SOURCES = {
    'source_whatsapp': 'واتساب',
    'source_phone': 'اتصال هاتفي',
    'source_website': 'الموقع الإلكتروني',
    'source_walk_in': 'زيارة للفرع',
    'source_customer_referral': 'توصية من عميل',
    'source_instagram': 'إنستغرام',
    'source_snapchat': 'سناب شات',
}


class UtmSource(models.Model):
    _inherit = 'utm.source'

    # Stock sources cannot be archived; opportunities keep a source the settings page retired.
    active = fields.Boolean(default=True)

    @api.model
    def _liwan_seed_sources(self):
        """Seed the Arabic starter sources and, once, archive the unsuitable stock ones.

        The seed file calls this on install and the migration on update (a noupdate function does not
        run on update). A source the tenant already created under a starter name is adopted, not
        duplicated, so the unique name never fails the update. The first call is the one that archives;
        a later call leaves a stock source the tenant brought back alone, and a stock source the tenant
        renamed is never archived.
        """
        first = not self.env.ref('liwan_crm.source_whatsapp', raise_if_not_found=False)
        Source = self.with_context(active_test=False)
        xmlids = []
        for xmlid, name in STARTER_SOURCES.items():
            if self.env.ref(f'liwan_crm.{xmlid}', raise_if_not_found=False):
                continue
            source = Source.search([('name', '=', name)], limit=1) or self.create({'name': name})
            xmlids.append({'xml_id': f'liwan_crm.{xmlid}', 'record': source, 'noupdate': True})
        self.env['ir.model.data']._update_xmlids(xmlids)
        if first:
            for xmlid, name in STOCK_SOURCES.items():
                stock = self.env.ref(f'utm.{xmlid}', raise_if_not_found=False)
                if stock and stock.name == name:
                    stock.active = False
