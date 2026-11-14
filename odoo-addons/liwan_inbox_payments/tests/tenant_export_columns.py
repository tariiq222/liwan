# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The columns this addon adds to a tenant export dataset of another addon, pinned.

The dataset derives its columns from the model, so a field this addon defines on it reaches the export. The test that
compares them with this file fails until someone decides whether a new column belongs in an export a tenant takes away.
"""
ADDED = {
    'inbox_channels': (
        'paid_notice_enabled',
        'paid_notice_text',
        'commerce_cart_enabled',
        'commerce_catalog_visible',
        'commerce_phone',
    ),
}
