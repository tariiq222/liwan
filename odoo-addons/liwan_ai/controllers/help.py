# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import http
from odoo.http import request

from odoo.addons.liwan_ai.controllers.ai import AI_FEATURE
from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

MAX_QUERY = 200
PAGE_NAME = re.compile(r'^[a-z][a-z_-]{0,39}$')


class AiHelpController(http.Controller):
    """The help agent's one route: the sections of the shipped user guide that answer a question.

    It reads the guide files only, never a tenant record, so the assistant's own capability is all it asks.
    """

    @http.route('/api/v1/ai/help', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_USE)
    def search_help(self, **_):
        args = request.httprequest.args
        query = (args.get('q') or '').strip()
        page = args.get('page') or None
        if len(query) > MAX_QUERY:
            raise ApiError(422, 'invalid', f'q must be at most {MAX_QUERY} characters', field='q')
        if page is not None and not PAGE_NAME.match(page):
            raise ApiError(422, 'invalid', 'page must be a page name', field='page')
        if not query and page is None:
            raise ApiError(422, 'invalid', 'send a question (q) or a page', field='q')
        items = request.env['liwan.ai.help.guide']._liwan_ai_help_search(query, page)
        return {'items': items, 'total': len(items)}
