# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class AccountTax(models.Model):
    _inherit = 'account.tax'

    # The tax this one is a price-included or price-excluded copy of, made by the online order service so an order can charge
    # as the company decides while the original tax stays as other documents use it. One active copy per tax and kind: a
    # request that races another one to make it fails on the index and retries.
    liwan_copy_of_id = fields.Many2one('account.tax', string='Copy of', copy=False, index='btree_not_null', ondelete='cascade')

    _liwan_copy_unique = models.UniqueIndex(
        '(liwan_copy_of_id, price_include_override) WHERE liwan_copy_of_id IS NOT NULL AND active',
        'A tax has one active copy of each kind.',
    )
