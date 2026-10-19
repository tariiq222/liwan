# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one streaming helper behind every ``.../attachments/<id>/download`` route.

Odoo's own ``/web/content/<id>`` serves any attachment the ORM lets the caller read, which
ignores the capability of the owning application, so the product never links to it. Each
owning application authorizes its parent record and capability, then hands the attachments
linked to that parent to ``download_linked_attachment``.
"""
from odoo.exceptions import MissingError
from odoo.http import request


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
    # A download is never rendered: no sniffing, no scripts, no shared cache.
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = 'sandbox'
    response.headers['Cache-Control'] = 'private, no-store'
    return response
