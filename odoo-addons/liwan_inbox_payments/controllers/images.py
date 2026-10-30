# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The public product image route Meta fetches catalog images from (no session, the item's own token)."""
import base64
import hmac

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import requires_feature
from odoo.addons.liwan_inbox_payments.models.catalog_image import public_image

CACHE_SECONDS = 86400


class CatalogImageController(http.Controller):

    @http.route('/api/v1/public/inbox/catalog/images/<int:item_id>/<string:token>', type='http', auth='public', methods=['GET'], save_session=False)
    @requires_feature('inbox.enabled', 'inbox.catalog', operation='read')
    def product_image(self, item_id, token, **_):
        """The image of a listed catalog item, JPEG or PNG; an unknown or unlisted item and a wrong token answer the same 404.

        The public user holds no right on items or products, so the item is read elevated and matched by its token.
        """
        item = request.env['liwan.inbox.catalog.item'].sudo().search([('id', '=', item_id), ('listed', '=', True)], limit=1)
        raw = item.product_id.image_1024 if item else None
        if not item or not raw or not hmac.compare_digest(item.image_token.encode(), token.encode()):
            return request.not_found()
        data, mimetype = public_image(base64.b64decode(raw))
        return request.make_response(data, [
            ('Content-Type', mimetype), ('Cache-Control', f'public, max-age={CACHE_SECONDS}'),
            ('X-Content-Type-Options', 'nosniff'),
        ])
