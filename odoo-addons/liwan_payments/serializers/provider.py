# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_provider(provider):
    """Whitelist the wire shape. Credential values never leave the database: only their presence."""
    country = provider._liwan_payments_definition().get('account_country')
    return {
        'id': provider.id,
        'code': provider.code,
        'name': provider.name,
        'state': provider.state,
        'credentials': [
            {'field': field, 'present': present}
            for field, present in provider._liwan_payments_credentials_present().items()
        ],
        'configured': provider._liwan_payments_configured(),
        'methods': provider.payment_method_ids.filtered('active').mapped('code'),
        'account_country': provider._liwan_payments_account_country(),
        'account_country_options': list(country['codes']) if country else [],
    }
