# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import Command, http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_crm.serializers.settings import (
    dump_settings,
    dump_terms,
    parse_settings_patch,
)

STALE = 'CRM settings changed; reload before saving'


class CrmSettingsController(http.Controller):

    @http.route('/api/v1/crm/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.settings.read')
    def get_settings(self, **_):
        model = request.env['webvue.crm.settings']
        row = model._webvue_current()
        return dump_settings(model._webvue_effective(), row.revision if row else 0)

    @http.route('/api/v1/crm/terms', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def get_terms(self, **_):
        # Display words only: every CRM user needs them to read the screens, unlike the policy values.
        return dump_terms(request.env['webvue.crm.settings']._webvue_effective())

    @http.route('/api/v1/crm/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.settings.manage')
    def patch_settings(self, **payload):
        parsed = parse_settings_patch(payload)
        vals = parsed['vals']
        if parsed['user_ids'] is not None:
            vals['distribution_user_ids'] = [Command.set(_existing_company_users(parsed['user_ids']))]
        model = request.env['webvue.crm.settings']
        row = model._webvue_current()
        revision = parsed['revision']
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', STALE)
        try:
            with request.env.cr.savepoint():
                if row:
                    row.write({**vals, 'revision': revision + 1})
                else:
                    model.create({**vals, 'company_id': request.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', STALE) from error
        row = model._webvue_current()
        return dump_settings(model._webvue_effective(), row.revision)


def _existing_company_users(user_ids):
    users = request.env['res.users'].search([
        ('id', 'in', user_ids), ('company_ids', 'in', request.env.company.id),
    ])
    if set(users.ids) != set(user_ids):
        raise ApiError(422, 'invalid', 'every user must belong to the current company', field='distribution_user_ids')
    return users.ids
