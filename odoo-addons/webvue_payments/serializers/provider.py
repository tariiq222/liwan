# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_provider(provider):
    """Whitelist the wire shape. Credential values never leave the database: only their presence."""
    present = provider._webvue_payments_credentials_present()
    return {
        'id': provider.id,
        'code': provider.code,
        'name': provider.name,
        'state': provider.state,
        'credentials': [{'field': field, 'present': value} for field, value in present.items()],
        'configured': all(present.values()),
        'methods': provider.payment_method_ids.filtered('active').mapped('code'),
        'webhook_url': provider._webvue_payments_webhook_url(),
    }
