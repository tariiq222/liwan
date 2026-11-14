# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .customers_settings import PROPERTIES_FIELD
from odoo.addons.liwan_api.models.tenant_export_hooks import (
    REASON_CREDENTIALS,
    REASON_LOG,
    model_dataset,
)

APP = 'customers'
# Settings are an explicit allowlist: a new field is not exported until someone decides it belongs in the export.
SETTINGS_FIELDS = (
    'id',
    'create_date',
    'party_kinds',
    'phone_country_id',
    'revision',
    'sharing',
    'write_date',
)
PARTY_SCOPE = 'Only customer parties and their contacts: not suppliers, employee contacts or other partner rows.'
BANK_SCOPE = 'Only the bank accounts of customer parties.'
PARTY_FIELDS = (
    'id', 'name', 'phone', 'email', 'is_company', 'parent_id', 'active', 'street', 'street2', 'city', 'zip', 'state_id',
    'country_id', 'vat', 'company_registry', 'website', 'function', 'comment', 'company_id', 'category_id', 'create_date',
    'write_date', PROPERTIES_FIELD,
)
BANK_FIELDS = ('id', 'partner_id', 'bank_id', 'acc_number', 'acc_holder_name', 'active')
TAG_FIELDS = ('id', 'name', 'parent_id', 'active', 'color')


class LiwanCustomersTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        party = [('liwan_party', '=', True)]
        return [
            *super()._liwan_export_datasets(),
            model_dataset(
                self.env, APP, 'customers', 'Customers', 'res.partner', fields=PARTY_FIELDS, domain=party, scope=PARTY_SCOPE,
                attachments=True,
            ),
            model_dataset(
                self.env, APP, 'customer_bank_accounts', 'Bank accounts', 'res.partner.bank', fields=BANK_FIELDS,
                domain=[('partner_id.liwan_party', '=', True)], scope=BANK_SCOPE,
            ),
            model_dataset(self.env, APP, 'customer_tags', 'Tags', 'res.partner.category', fields=TAG_FIELDS),
            model_dataset(self.env, APP, 'customer_settings', 'Settings', 'liwan.customers.settings', fields=SETTINGS_FIELDS),
        ]

    @api.model
    def _liwan_export_technical_models(self):
        return {
            **super()._liwan_export_technical_models(),
            'liwan.customers.privacy.token': REASON_CREDENTIALS,
            'liwan.customers.privacy.request': REASON_LOG,
        }
