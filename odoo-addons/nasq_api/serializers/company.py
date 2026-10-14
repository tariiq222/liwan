# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import re

from odoo.addons.nasq_api.controllers.common import ApiError

DEFAULT_PRIMARY_COLOR = '#18181b'


def parse_branding_vals(payload):
    if not isinstance(payload, dict) or not payload:
        raise ApiError(422, 'invalid', 'branding patch must include a color')
    # Reject the entire request, including a mixed colour/identity patch.
    # Institution identity is managed through the Odoo console.
    for key in ('name', 'logo'):
        if key in payload:
            raise ApiError(403, 'forbidden', 'institution identity is managed in Odoo', field=key)
    for key in payload:
        if key not in {'primary_color', 'secondary_color'}:
            raise ApiError(422, 'invalid', f"field {key!r} is not writable", field=key)
    values = {}
    for key, value in payload.items():
        if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise ApiError(422, 'invalid', f'{key} must be a six-digit hex color', field=key)
        values[key] = value
    return values


def _logo_version(company):
    timestamp = company.write_date.strftime('%Y%m%d%H%M%S%f') if company.write_date else '0'
    logo = company.logo or b''
    if isinstance(logo, str):
        logo = logo.encode()
    digest = hashlib.sha256(logo).hexdigest()[:12]
    return f'{timestamp}-{digest}'


def dump_branding(company):
    """Public branding of ``company`` for the login page and app chrome."""
    # Odoo serves (and stores) its own stock logo when the company has none; never expose that URL.
    logo_url = (
        f'/web/binary/company_logo?company={company.id}&v={_logo_version(company)}'
        if company.logo and not company.uses_default_logo else None
    )
    payload = {
        'name': company.name,
        'logo_url': logo_url,
        'primary_color': company.primary_color or DEFAULT_PRIMARY_COLOR,
        'font': company.font,
    }
    if company.secondary_color:
        payload['secondary_color'] = company.secondary_color
    return payload
