# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class AccountTax(models.Model):
    _inherit = 'account.tax'

    # The tax this one is the price-included copy of, made by the online order service for prices that already contain
    # their tax. One active copy per tax: a request that races another one to make it fails on the index and retries.
    liwan_included_of_id = fields.Many2one('account.tax', string='Price-included copy of', copy=False, index='btree_not_null', ondelete='cascade')

    _liwan_included_of_unique = models.UniqueIndex(
        '(liwan_included_of_id) WHERE liwan_included_of_id IS NOT NULL AND active',
        'A tax has one active price-included copy.',
    )
