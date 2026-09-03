# Part of Odoo. See LICENSE file for full copyright and licensing details.
DEFAULT_PRIMARY_COLOR = '#18181b'


def dump_branding(company):
    """Public branding of ``company`` for the login page and app chrome."""
    return {
        'name': company.name,
        'logo_url': f'/web/binary/company_logo?company={company.id}',
        'primary_color': company.primary_color or DEFAULT_PRIMARY_COLOR,
        'font': company.font,
    }
