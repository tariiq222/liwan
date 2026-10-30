# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Audiences of the campaigns (capability inbox.campaigns.manage)."""
from odoo import http
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    get_record,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.controllers.campaign_parsing import parse_audience
from odoo.addons.liwan_inbox.controllers.helpers import (
    no_content,
    reject,
    unique_as_invalid,
)
from odoo.addons.liwan_inbox.models.access_service import CAMPAIGNS
from odoo.addons.liwan_inbox.models.campaign_constants import CONSENT_STATES
from odoo.addons.liwan_inbox.models.constants import CAMPAIGNS_FEATURE
from odoo.addons.liwan_inbox.serializers.campaigns import (
    dump_audience,
    dump_audience_member,
)

MAX_SEARCH = 128


def search_term(args):
    query = (args.get('q') or '').strip()
    if len(query) > MAX_SEARCH:
        reject(f'q must be at most {MAX_SEARCH} characters', 'q')
    return query


class AudienceController(http.Controller):

    @http.route('/api/v1/inbox/audiences', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def list_audiences(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('name', 'ilike', search_term(args))] if search_term(args) else []
        Audience = request.env['liwan.inbox.audience']
        return {
            'items': [dump_audience(a) for a in Audience.search(domain, limit=limit, offset=offset)],
            'total': Audience.search_count(domain),
        }

    @http.route('/api/v1/inbox/audiences', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def create_audience(self, **payload):
        values = parse_audience(payload)
        with unique_as_invalid('name', 'an audience with this name exists', 'inbox_audience_name_taken'):
            audience = request.env['liwan.inbox.audience'].create(values)
        return request.make_json_response(dump_audience(audience), status=201)

    @http.route('/api/v1/inbox/audiences/<int:audience_id>', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def read_audience(self, audience_id, **_):
        return dump_audience(get_record('liwan.inbox.audience', audience_id))

    @http.route('/api/v1/inbox/audiences/<int:audience_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def patch_audience(self, audience_id, **payload):
        audience = get_record('liwan.inbox.audience', audience_id)
        values = parse_audience(payload, partial=True)
        with unique_as_invalid('name', 'an audience with this name exists', 'inbox_audience_name_taken'):
            audience.write(values)
        return dump_audience(audience)

    @http.route('/api/v1/inbox/audiences/<int:audience_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def delete_audience(self, audience_id, **_):
        audience = get_record('liwan.inbox.audience', audience_id)
        if audience.campaign_ids:
            reject('an audience used by a campaign cannot be deleted')
        audience.unlink()
        return no_content()

    @http.route('/api/v1/inbox/audiences/<int:audience_id>/members', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(CAMPAIGNS)
    def list_members(self, audience_id, **_):
        audience = get_record('liwan.inbox.audience', audience_id)
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = audience._liwan_contact_domain()
        if args.get('consent') is not None:
            if args['consent'] not in dict(CONSENT_STATES):
                reject(f'consent must be one of {sorted(dict(CONSENT_STATES))}', 'consent')
            domain &= Domain('marketing_consent', '=', args['consent'])
        query = search_term(args)
        if query:
            domain &= Domain('name', 'ilike', query) | Domain('phone', 'ilike', query)
        Contact = request.env['liwan.inbox.contact']
        return {
            'items': [dump_audience_member(c) for c in Contact.search(domain, limit=limit, offset=offset)],
            'total': Contact.search_count(domain),
        }
