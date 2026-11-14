# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The columns each tenant export dataset of this addon writes, pinned.

A field added to or removed from a model changes a dataset that derives its columns, and fails the test that compares them
with this file until someone decides whether the new column belongs in an export a tenant takes away.
"""
COLUMNS = {
    'customers': (
        'id',
        'name',
        'phone',
        'email',
        'is_company',
        'parent_id',
        'active',
        'street',
        'street2',
        'city',
        'zip',
        'state_id',
        'country_id',
        'vat',
        'company_registry',
        'website',
        'function',
        'comment',
        'company_id',
        'category_id',
        'create_date',
        'write_date',
        'properties',
    ),
    'customer_bank_accounts': (
        'id',
        'partner_id',
        'bank_id',
        'acc_number',
        'acc_holder_name',
        'active',
    ),
    'customer_tags': (
        'id',
        'name',
        'parent_id',
        'active',
        'color',
    ),
    'customer_settings': (
        'id',
        'create_date',
        'party_kinds',
        'phone_country_id',
        'revision',
        'sharing',
        'write_date',
    ),
}
