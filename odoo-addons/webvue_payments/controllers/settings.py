# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_payments.models.access_service import SETTINGS_MANAGE
from odoo.addons.webvue_payments.serializers.settings import (
    dump_settings,
    parse_settings,
)

FEATURE = 'payments.enabled'
STALE_MESSAGE = 'payments settings changed; reload before saving'


class PaymentSettingsController(http.Controller):
    """The current company's payments settings, plus the one tenant-wide setting (invoice when paid)."""

    @http.route('/api/v1/payments/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(SETTINGS_MANAGE)
    def get_settings(self, **_):
        model = request.env['webvue.payments.settings']
        return dump_settings(model._webvue_for(request.env.company), model._webvue_invoices_when_paid())

    @http.route('/api/v1/payments/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(SETTINGS_MANAGE)
    def patch_settings(self, **payload):
        parsed = parse_settings(payload)
        revision = parsed['revision']
        model = request.env['webvue.payments.settings']
        row = model._webvue_for(request.env.company)
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', STALE_MESSAGE)
        if 'invoice_when_paid' in parsed:
            model._webvue_set_invoice_when_paid(parsed['invoice_when_paid'])
        try:
            with request.env.cr.savepoint():
                if row:
                    row.write({**parsed['values'], 'revision': revision + 1})
                else:
                    row = model.create({**parsed['values'], 'company_id': request.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', STALE_MESSAGE) from error
        return dump_settings(row, model._webvue_invoices_when_paid())
