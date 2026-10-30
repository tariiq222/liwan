# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one streaming helper behind every ``.../attachments/<id>/download`` route.

Odoo's own ``/web/content/<id>`` serves any attachment the ORM lets the caller read, which
ignores the capability of the owning application, so the product never links to it. Each
owning application authorizes its parent record and capability, then hands the attachments
linked to that parent to ``download_linked_attachment``.
"""
import os
import re
import unicodedata
from urllib.parse import quote

from odoo.exceptions import MissingError
from odoo.http import request

_UNSAFE_ASCII = re.compile(r'[^A-Za-z0-9._ -]+')


def attachment_disposition(filename):
    """``Content-Disposition`` for a download: an ASCII fallback plus the RFC 5987 UTF-8 name.

    Werkzeug builds the fallback by dropping non-ASCII characters, so an Arabic name ends up
    as ``filename=.txt``. The fallback here keeps the extension and never comes out empty.
    """
    stem, extension = os.path.splitext(filename)
    ascii_stem = _UNSAFE_ASCII.sub('', unicodedata.normalize('NFKD', stem).encode('ascii', 'ignore').decode()).strip()
    ascii_extension = _UNSAFE_ASCII.sub('', extension)
    fallback = f'{ascii_stem or "attachment"}{ascii_extension}'
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def download_linked_attachment(attachments, attachment_id):
    """Stream ``attachment_id`` when it is one of the caller-authorized ``attachments``.

    ``attachments`` is the parent's own attachment set, so an id that belongs to another
    record is a 404 exactly like a missing one. The ORM read check still runs, without ``sudo``.
    """
    attachment = attachments.filtered(lambda item: item.id == attachment_id)
    if not attachment:
        raise MissingError(request.env._('Attachment %(id)s is not linked to this record', id=attachment_id))
    attachment.check_access('read')
    response = request.env['ir.binary']._get_stream_from(attachment).get_response(as_attachment=True)
    response.headers['Content-Disposition'] = attachment_disposition(attachment.name)
    # A download is never rendered: no sniffing, no scripts, no shared cache.
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = 'sandbox'
    response.headers['Cache-Control'] = 'private, no-store'
    return response
