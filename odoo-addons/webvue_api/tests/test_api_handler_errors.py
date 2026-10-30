# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest import mock

from odoo.exceptions import AccessError, MissingError
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_api.controllers import common
from odoo.addons.webvue_api.controllers.common import api_handler


@tagged('post_install', '-at_install', 'webvue')
class TestApiHandlerNeutralErrors(TransactionCase):
    """Stock Odoo's access and missing-record text names models and user ids; it never reaches the client."""

    def _answer(self, action):
        @api_handler
        def handler():
            action()

        request = mock.MagicMock()
        request.env._.side_effect = lambda text: text
        request.make_json_response.side_effect = lambda body, status: (status, body)
        with (
            mock.patch.object(common, 'request', request),
            mock.patch.object(common, '_pin_current_company'),
            mock.patch.object(common, '_reject_foreign_company_payload'),
        ):
            return handler()

    def test_stock_access_error_answers_fixed_forbidden_and_logs_the_original(self):
        public = self.env.ref('base.public_user')
        with self.assertLogs(common._logger, 'INFO') as logs:
            status, body = self._answer(lambda: self.env['ir.config_parameter'].with_user(public).check_access('read'))
        self.assertEqual(status, 403)
        self.assertEqual(body['code'], 'forbidden')
        self.assertEqual(body['message'], 'You do not have permission to do this')
        self.assertNotIn('ir.config_parameter', str(body))
        self.assertTrue(any('ir.config_parameter' in line for line in logs.output))

    def test_webvue_access_error_keeps_its_written_message(self):
        def refuse():
            message = 'Only the organizer may confirm this meeting.'
            raise AccessError(message)

        status, body = self._answer(refuse)
        self.assertEqual(status, 403)
        self.assertEqual(body['message'], 'Only the organizer may confirm this meeting.')

    def test_missing_error_answers_fixed_not_found(self):
        def missing():
            message = 'hr.employee 9 does not exist'
            raise MissingError(message)

        status, body = self._answer(missing)
        self.assertEqual((status, body['code'], body['message']), (404, 'not_found', 'Record does not exist'))
