# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii
import hashlib
import re
import warnings
from io import BytesIO

from PIL import Image

from odoo.addons.nasq_api.controllers.common import ApiError

DEFAULT_PRIMARY_COLOR = '#18181b'
MAX_LOGO_BYTES = 1024 * 1024
MAX_LOGO_PIXELS = 25_000_000
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
JPEG_SIGNATURE = b'\xff\xd8\xff'


def _logo_error(message):
    return ApiError(422, 'logo_format', message, field='logo')


def _parse_logo(value):
    if not isinstance(value, str) or value.startswith('data:'):
        raise _logo_error('logo must be raw base64 PNG or JPEG data')
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise _logo_error('logo must be valid base64') from None
    if len(decoded) > MAX_LOGO_BYTES:
        raise ApiError(422, 'logo_too_large', 'logo must be at most 1 MiB decoded', field='logo')

    expected_format = None
    if decoded.startswith(PNG_SIGNATURE):
        expected_format = 'PNG'
    elif decoded.startswith(JPEG_SIGNATURE):
        expected_format = 'JPEG'
    if expected_format is None:
        raise _logo_error('logo must be a PNG or JPEG image')

    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(decoded)) as image:
                if image.format != expected_format:
                    raise _logo_error('logo image header does not match its format')
                if image.width * image.height > MAX_LOGO_PIXELS:
                    raise _logo_error('logo image dimensions are too large')
                image.verify()
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, OSError, ValueError):
        raise _logo_error('logo image is corrupt or unsupported') from None
    return value


def parse_branding_vals(payload):
    if not isinstance(payload, dict) or not payload:
        raise ApiError(422, 'invalid', 'branding patch must include at least one field')
    vals = {}
    for key, value in payload.items():
        if key not in {'name', 'primary_color', 'logo'}:
            raise ApiError(422, 'invalid', f"field {key!r} is not writable", field=key)
        if key == 'name':
            if not isinstance(value, str) or not 1 <= len(value.strip()) <= 100:
                raise ApiError(422, 'invalid', 'name must be between 1 and 100 characters', field=key)
            vals[key] = value.strip()
        elif key == 'primary_color':
            if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
                raise ApiError(422, 'invalid', 'primary_color must be a six-digit hex color', field=key)
            vals[key] = value
        else:
            vals[key] = _parse_logo(value)
    return vals


def _logo_version(company):
    timestamp = company.write_date.strftime('%Y%m%d%H%M%S%f') if company.write_date else '0'
    logo = company.logo or b''
    if isinstance(logo, str):
        logo = logo.encode()
    digest = hashlib.sha256(logo).hexdigest()[:12]
    return f'{timestamp}-{digest}'


def dump_branding(company):
    """Public branding of ``company`` for the login page and app chrome."""
    return {
        'name': company.name,
        'logo_url': f'/web/binary/company_logo?company={company.id}&v={_logo_version(company)}',
        'primary_color': company.primary_color or DEFAULT_PRIMARY_COLOR,
        'font': company.font,
    }
