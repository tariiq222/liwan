# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What every bank statement file format shares: the text checks and which format a file is."""
import re

from odoo.addons.liwan_api.controllers.common import ApiError

MAX_BYTES = 2 * 1024 * 1024
FORMATS = ('csv', 'ofx', 'camt')
OFX_MARK = re.compile(r'OFXHEADER|<OFX[\s>]', re.IGNORECASE)
CAMT_MARK = re.compile(r'xsd:camt\.\d{3}\.')
SNIFFED_CHARS = 4096


def refuse(message, field):
    raise ApiError(422, 'invalid', message, field=field)


def read_text(content):
    """The text of an uploaded file once it is known to be a readable text of an accepted size."""
    if not isinstance(content, str) or not content.strip():
        refuse('content must be the text of a statement file', 'content')
    if len(content.encode()) > MAX_BYTES:
        refuse(f'the file is larger than {MAX_BYTES // (1024 * 1024)} MiB', 'content')
    text = content.lstrip('\ufeff')
    if any(ord(char) < 32 and char not in '\t\r\n' for char in text):
        refuse('the file is not readable text', 'content')
    return text


def file_format(payload):
    """The ``format`` the caller names, else the one the start of the text shows (CSV when it shows none)."""
    named = payload.get('format')
    if named is not None:
        if named not in FORMATS:
            refuse(f'format must be one of {", ".join(FORMATS)}', 'format')
        return named
    head = read_text(payload['content'])[:SNIFFED_CHARS]
    if OFX_MARK.search(head):
        return 'ofx'
    return 'camt' if CAMT_MARK.search(head) else 'csv'
