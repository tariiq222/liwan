# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_inbox.controllers.helpers import (
    get_channel,
    holds,
    no_content,
    not_found,
    reject,
)
from odoo.addons.webvue_inbox_payments.adapters import meta_catalog
from odoo.addons.webvue_inbox_payments.controllers.parsing import (
    parse_catalog_create,
    parse_catalog_patch,
    provider_failure,
)
from odoo.addons.webvue_inbox_payments.models.access_service import CATALOG_MANAGE
from odoo.addons.webvue_inbox_payments.models.constants import CATALOG_FEATURE
from odoo.addons.webvue_inbox_payments.serializers.catalog import dump_catalog


def get_catalog(catalog_id):
    """A catalog of a company where the caller manages catalogs; any other is a plain 404."""
    catalog = request.env['webvue.inbox.catalog'].search([('id', '=', catalog_id)], limit=1)
    if not catalog or not holds(CATALOG_MANAGE, catalog.company_id):
        raise not_found()
    return catalog


def check_with_meta(credentials, meta_catalog_id, connect):
    """The catalog's name, after checking it is a commerce catalog and connecting it to the WhatsApp account (or that it is)."""
    try:
        found = meta_catalog.get_catalog(credentials, meta_catalog_id)
        if found['vertical'] != 'commerce':
            reject('the catalog must be a commerce catalog made in Commerce Manager', 'meta_catalog_id')
        if connect:
            meta_catalog.connect_catalog(credentials, meta_catalog_id)
        elif meta_catalog_id not in meta_catalog.list_waba_catalogs(credentials):
            reject('the catalog is not connected to the WhatsApp account; connect it or switch on connect', 'meta_catalog_id')
    except whatsapp.ProviderError as error:
        provider_failure(error)
    return found['name']


class CatalogController(http.Controller):

    @http.route('/api/v1/inbox/catalogs', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(CATALOG_MANAGE)
    def list_catalogs(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Catalog = request.env['webvue.inbox.catalog']
        return {
            'items': [dump_catalog(catalog) for catalog in Catalog.search([], limit=limit, offset=offset)],
            'total': Catalog.search_count([]),
        }

    @http.route('/api/v1/inbox/catalogs', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def create_catalog(self, **payload):
        channel_id, meta_catalog_id, connect, values = parse_catalog_create(payload)
        channel = get_channel(channel_id, CATALOG_MANAGE)
        if channel.owner_company_id != request.env.company:
            raise not_found()
        Catalog = request.env['webvue.inbox.catalog']
        if Catalog.search_count([('business_account_id', '=', channel.business_account_id)]):
            raise ApiError(409, 'conflict', 'this WhatsApp account already has a catalog')
        credentials = channel._webvue_credentials()
        name = check_with_meta(credentials, meta_catalog_id, connect)
        try:
            catalog = Catalog.create({
                'company_id': channel.owner_company_id.id, 'business_account_id': channel.business_account_id,
                'meta_catalog_id': meta_catalog_id, 'name': name, **values,
            })
            request.env.flush_all()
        except UniqueViolation:
            raise ApiError(409, 'conflict', 'this WhatsApp account already has a catalog') from None
        return request.make_json_response(dump_catalog(catalog), status=201)

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(CATALOG_MANAGE)
    def read_catalog(self, catalog_id, **_):
        return dump_catalog(get_catalog(catalog_id))

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def patch_catalog(self, catalog_id, **payload):
        catalog = get_catalog(catalog_id)
        catalog.write(parse_catalog_patch(payload))
        return dump_catalog(catalog)

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def delete_catalog(self, catalog_id, **_):
        catalog = get_catalog(catalog_id)
        if catalog.with_context(active_test=False).item_ids.filtered(
            lambda item: item.synced_hash or item.sync_state in ('syncing', 'removing'),
        ):
            reject('the catalog still has products at Meta; unlist or delete them and let the sync finish first')
        catalog.unlink()
        return no_content()

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>/sync', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def sync_catalog(self, catalog_id, **_):
        catalog = get_catalog(catalog_id)
        catalog._webvue_mark_all_pending()
        return request.make_json_response(dump_catalog(catalog), status=202)
