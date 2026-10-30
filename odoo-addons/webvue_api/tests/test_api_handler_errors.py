# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest import mock

from odoo.exceptions import AccessError, MissingError
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_api.controllers import common
from odoo.addons.webvue_api.controllers.common import api_handler


@tagged('post_install', '-at_install', 'webvue')
class TestApiHandlerNeutralErrors(TransactionCase):
    """Odoo's own access and missing-record text names models and user ids; it never reaches the client."""

    def _answer(self, error):
        @api_handler
        def handler():
            raise error

        request = mock.MagicMock()
        request.env._.side_effect = lambda text: text
        request.make_json_response.side_effect = lambda body, status: (status, body)
        with (
            mock.patch.object(common, 'request', request),
            mock.patch.object(common, '_pin_current_company'),
            mock.patch.object(common, '_reject_foreign_company_payload'),
            self.assertLogs(common._logger, 'INFO') as logs,
        ):
            return handler(), logs.output

    def test_access_error_answers_fixed_forbidden_and_logs_the_original(self):
        leak = "You are not allowed to access 'Task' (project.task) records. (User: 7)"
        (status, body), logs = self._answer(AccessError(leak))
        self.assertEqual(status, 403)
        self.assertEqual(body['code'], 'forbidden')
        self.assertEqual(body['message'], 'You do not have permission to do this')
        self.assertNotIn('project.task', str(body))
        self.assertTrue(any('project.task' in line for line in logs))

    def test_missing_error_answers_fixed_not_found(self):
        (status, body), _logs = self._answer(MissingError('hr.employee 9 does not exist'))
        self.assertEqual((status, body['code'], body['message']), (404, 'not_found', 'Record does not exist'))
