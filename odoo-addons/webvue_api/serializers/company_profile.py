# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape and write parsing of the company profile (``/api/v1/admin/company``)."""
import base64
import binascii
import re

from odoo.tools import html2plaintext, plaintext2html
from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.controllers.vat import check_vat
from odoo.addons.webvue_api.serializers.company import dump_logo_url

MAX_TEXT_LENGTH = 255
MAX_LOGO_BYTES = 2 * 1024 * 1024
# Four base64 characters encode three bytes: the longest canonical encoding of MAX_LOGO_BYTES.
MAX_LOGO_ENCODED_CHARS = 4 * ((MAX_LOGO_BYTES + 2) // 3)
LOGO_MIMETYPES = frozenset({'image/png', 'image/jpeg'})
EMAIL_PATTERN = re.compile(r'[^@\s]+@[^@\s]+\.[^@\s]+')
# Saudi (l10n_sa_edi) fields: present only while that module is installed.
SAUDI_SCHEME_FIELD = 'l10n_sa_edi_additional_identification_scheme'
SAUDI_IDENTITY_FIELDS = (
    'l10n_sa_edi_additional_identification_scheme', 'l10n_sa_edi_additional_identification_number',
)
SAUDI_ADDRESS_FIELDS = ('l10n_sa_edi_building_number', 'l10n_sa_edi_plot_identification')
TEXT_FIELDS = (
    'company_registry', 'vat', 'street', 'street2', 'city', 'zip', 'email', 'phone', 'website',
    *SAUDI_ADDRESS_FIELDS, 'l10n_sa_edi_additional_identification_number',
)
# The country is set at provisioning and read-only here; the state is validated against it.
EDITABLE_FIELDS = (
    'name', 'report_header', *TEXT_FIELDS, 'state_id', 'l10n_sa_edi_additional_identification_scheme',
)
# What a finished profile holds; ``completeness`` counts the filled ones.
COMPLETENESS_FIELDS = ('company_registry', 'vat', 'street', 'city', 'zip', 'email', 'phone')


def _ref(record, *extra):
    return {'id': record.id, 'name': record.name, **{key: record[key] for key in extra}} if record else None


def _text(company, field):
    return (company[field] if field in company._fields else None) or None


def _tagline(company):
    return html2plaintext(company.report_header or '').strip() or None


def _completeness(company, logo_url):
    filled = [bool(company.name), bool(logo_url), bool(company.country_id)]
    filled += [bool(company[field]) for field in COMPLETENESS_FIELDS]
    return {'done': sum(filled), 'total': len(filled)}


def dump_company_profile(company):
    logo_url = dump_logo_url(company)
    return {
        'id': company.id,
        'name': company.name,
        'logo_url': logo_url,
        'report_header': _tagline(company),
        'company_registry': company.company_registry or None,
        'vat': company.vat or None,
        'saudi_fields': SAUDI_SCHEME_FIELD in company._fields,
        **{field: _text(company, field) for field in SAUDI_IDENTITY_FIELDS},
        'address': {
            'street': company.street or None,
            'street2': company.street2 or None,
            'city': company.city or None,
            'zip': company.zip or None,
            'state': _ref(company.state_id),
            'country': _ref(company.country_id, 'code'),
            **{field: _text(company, field) for field in SAUDI_ADDRESS_FIELDS},
        },
        'email': company.email or None,
        'phone': company.phone or None,
        'website': company.website or None,
        'currency': _ref(company.currency_id, 'symbol'),
        'completeness': _completeness(company, logo_url),
    }


def _parse_text(value, field):
    if value is not None and not isinstance(value, str):
        raise ApiError(422, 'invalid', f'{field} must be a string or null', field=field)
    text = (value or '').strip()
    if len(text) > MAX_TEXT_LENGTH:
        raise ApiError(422, 'invalid', f'{field} must be at most {MAX_TEXT_LENGTH} characters', field=field)
    if field == 'email' and text and not EMAIL_PATTERN.fullmatch(text):
        raise ApiError(422, 'invalid', 'email is not a valid address', field=field)
    return text or False


def _parse_state(env, value):
    if value is None:
        return False
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ApiError(422, 'invalid', 'state_id must be a positive integer or null', field='state_id')
    if not env['res.country.state'].browse(value).exists():
        raise ApiError(422, 'invalid', 'state_id does not exist', field='state_id')
    return value


def _parse_scheme(company, value):
    allowed = {key for key, _label in company._fields['l10n_sa_edi_additional_identification_scheme']._description_selection(company.env)}
    if value is not None and value not in allowed:
        raise ApiError(422, 'invalid', 'scheme is not one of the allowed identification schemes',
                       field='l10n_sa_edi_additional_identification_scheme')
    return value or False


def _parse_field(company, field, value):
    if field == 'name':
        name = _parse_text(value, field)
        if not name:
            raise ApiError(422, 'invalid', 'name must not be empty', field=field)
        return name
    if field == 'report_header':
        text = _parse_text(value, field)
        return plaintext2html(text) if text else False
    if field == 'state_id':
        return _parse_state(company.env, value)
    if field == 'l10n_sa_edi_additional_identification_scheme':
        return _parse_scheme(company, value)
    return _parse_text(value, field)


def parse_company_profile_vals(payload, company):
    """Validated ORM values of a PATCH body; any unknown field rejects the whole request."""
    if not isinstance(payload, dict) or not payload:
        raise ApiError(422, 'invalid', 'no fields to update')
    for field in payload:
        if field not in EDITABLE_FIELDS or field not in company._fields:
            raise ApiError(422, 'invalid', f'field {field!r} is not writable', field=field)
    vals = {field: _parse_field(company, field, value) for field, value in payload.items()}
    state = company.env['res.country.state'].browse(vals.get('state_id') or [])
    if state and state.country_id != company.country_id:
        raise ApiError(422, 'invalid', 'state_id does not belong to the company country', field='state_id')
    if 'vat' in vals:
        check_vat(company.country_id, vals['vat'], vals.get('name', company.name))
    return vals


def parse_logo_upload(payload):
    """The decoded-and-checked base64 ``data`` of a logo upload (PNG or JPEG, up to 2 MiB)."""
    if not isinstance(payload, dict) or set(payload) != {'data'}:
        raise ApiError(422, 'invalid', 'the body must be {"data": <base64 image>}', field='data')
    data = payload['data']
    if not isinstance(data, str) or not data.strip():
        raise ApiError(422, 'invalid', 'data is required', field='data')
    cleaned = ''.join(data.split())
    if len(cleaned) > MAX_LOGO_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'the logo exceeds 2MB', field='data')
    try:
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, 'invalid', 'data must be valid base64', field='data') from None
    if not raw or len(raw) > MAX_LOGO_BYTES:
        raise ApiError(422, 'invalid', 'the logo must be a non-empty file of at most 2MB', field='data')
    if guess_mimetype(raw) not in LOGO_MIMETYPES:
        raise ApiError(422, 'invalid', 'the logo must be a PNG or JPEG image', field='data')
    return cleaned
