# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.http import content_disposition, request


def pdf_response(order, content):
    """``content`` as a PDF download named after the stock quotation report of ``order``."""
    filename = request.env['liwan.sales.document']._liwan_filename(order)
    return request.make_response(content, headers=[
        ('Content-Type', 'application/pdf'),
        ('Content-Disposition', content_disposition(filename)),
    ])
