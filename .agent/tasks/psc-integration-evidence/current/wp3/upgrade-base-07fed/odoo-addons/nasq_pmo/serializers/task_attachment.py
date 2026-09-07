# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.nasq_api.controllers.common import ApiError

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Four base64 characters encode three bytes. This is the largest canonical
# base64 representation that can contain exactly MAX_ATTACHMENT_BYTES.
MAX_ENCODED_CHARS = 4 * ((MAX_ATTACHMENT_BYTES + 2) // 3)
ALLOWED_MIMETYPES = frozenset({
    'text/plain',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})
GENERIC_MIMETYPE = 'application/octet-stream'
UPLOAD_FIELDS = frozenset({'name', 'mimetype', 'data'})


def dump_task_attachment(attachment):
    """Return the intentionally small wire shape for one task attachment."""
    return {
        'id': attachment.id,
        'name': attachment.name,
        'mimetype': attachment.mimetype or '',
        'url': f'/web/content/{attachment.id}?download=true',
    }


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', 'name must not be empty', field='name')
    name = value.strip()
    if '\x00' in name or '/' in name or '\\' in name or name in {'.', '..'}:
        raise ApiError(422, 'invalid', 'name must be a basename', field='name')
    return name


def _parse_mimetype(value):
    if value in (None, False, ''):
        return None
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'mimetype must be a string', field='mimetype')
    mimetype = value.strip().lower()
    if mimetype not in ALLOWED_MIMETYPES and mimetype != GENERIC_MIMETYPE:
        raise ApiError(422, 'invalid', 'mimetype is not allowed', field='mimetype')
    return mimetype


def parse_task_attachment_upload(payload):
    extra = set(payload) - UPLOAD_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    name = _parse_name(payload.get('name'))
    hinted_mimetype = _parse_mimetype(payload.get('mimetype'))
    data = payload.get('data')
    if not isinstance(data, str) or not data.strip():
        raise ApiError(422, 'invalid', 'data is required', field='data')
    if len(data) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'attachment data exceeds the encoded size limit', field='data')
    cleaned = ''.join(data.split())
    if len(cleaned) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'attachment data exceeds the encoded size limit', field='data')
    try:
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, 'invalid', 'data must be valid base64', field='data') from None
    if not raw:
        raise ApiError(422, 'invalid', 'data must contain a non-empty file', field='data')
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, 'invalid', 'attachment exceeds 10MB', field='data')

    detected = (guess_mimetype(raw) or GENERIC_MIMETYPE).lower().split(';', 1)[0].strip()
    if detected not in ALLOWED_MIMETYPES:
        raise ApiError(422, 'invalid', 'file type is not allowed', field='data')
    # The client MIME is only a checked hint. The sniffed bytes decide the
    # server response so a filename or browser hint cannot make unsafe data
    # acceptable; application/octet-stream is the normal empty browser hint.
    return {
        'name': name,
        'raw': raw,
        'mimetype': detected,
        'hinted_mimetype': hinted_mimetype,
    }
