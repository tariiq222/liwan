# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one country/state lookup behind every address picker; each route keeps its own capability and feature gate."""
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import MAX_PAGE_LIMIT, parse_page
from odoo.addons.webvue_api.serializers.lookup import dump_lookup_items


def _lookup_page(model, domain):
    """One page of ``model`` (``limit`` up to ``MAX_PAGE_LIMIT``, ``offset``) matching the request's ``q`` on name or code."""
    args = request.httprequest.args
    query = (args.get('q') or '').strip()
    if query:
        domain = [*domain, '|', ('name', 'ilike', query), ('code', 'ilike', query)]
    limit, offset = parse_page(args, maximum=MAX_PAGE_LIMIT)
    records = request.env[model].search(domain, order='name', limit=limit, offset=offset)
    return {'items': dump_lookup_items(records), 'total': request.env[model].search_count(domain)}


def list_countries():
    return _lookup_page('res.country', [])


def list_states(country_id):
    if not request.env['res.country'].search_count([('id', '=', country_id)]):
        raise MissingError(request.env._('res.country %(id)s does not exist', id=country_id))
    return _lookup_page('res.country.state', [('country_id', '=', country_id)])
