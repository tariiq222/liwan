# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest import mock

from psycopg2 import errorcodes
from psycopg2.errors import DeadlockDetected, LockNotAvailable, SerializationFailure
from werkzeug.exceptions import NotFound

from odoo import http
from odoo.exceptions import AccessError, ConcurrencyError, MissingError
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers import common
from odoo.addons.liwan_api.controllers.common import api_handler
from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan')
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
            mock.patch.object(common, '_require_mobile_number'),
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

    def test_liwan_access_error_keeps_its_written_message(self):
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


@tagged('post_install', '-at_install', 'liwan')
class TestApiHandlerUnexpectedFailure(TransactionCase):
    """Odoo serializes an uncaught exception with its traceback, arguments and model names.

    ``api_handler`` is the only mapper between a controller failing and the browser, for a session
    route and for the ``auth='public'`` namespace alike, so it answers the contract body instead.
    """

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
            mock.patch.object(common, '_require_mobile_number'),
        ):
            return handler()

    @staticmethod
    def _defect():
        message = "no key 'gross' in the hr.employee payroll serializer"
        raise KeyError(message)

    def test_an_unexpected_failure_answers_a_generic_500_and_logs_the_traceback(self):
        with self.assertLogs(common._logger, 'ERROR') as logs:
            status, body = self._answer(self._defect)
        self.assertEqual(status, 500)
        self.assertEqual(body, {'code': 'internal', 'message': 'An unexpected error occurred'})
        self.assertNotIn('gross', str(body))
        self.assertNotIn('hr.employee', str(body))
        logged = '\n'.join(logs.output)
        self.assertIn('api internal error', logged)
        self.assertIn('Traceback', logged)
        self.assertIn('KeyError', logged)

    def test_the_body_carries_no_traceback_field(self):
        _, body = self._answer(self._defect)
        self.assertEqual(set(body), {'code', 'message'})

    def test_a_framework_refusal_keeps_its_own_status(self):
        def refuse():
            raise NotFound()

        with self.assertRaises(NotFound):
            self._answer(refuse)

    def test_odoo_replays_every_concurrency_failure_and_api_handler_never_answers_one(self):
        """The retry matches these exact types (odoo/service/model.py), so answering would fake a conflict."""
        for failure in (
            SerializationFailure(),
            LockNotAvailable(),
            DeadlockDetected(),
            ConcurrencyError('the guarded write lost the race'),
        ):
            with self.subTest(failure=type(failure).__name__):
                def replay(failure=failure):
                    raise failure

                with self.assertRaises(type(failure)):
                    self._answer(replay)

    def test_a_serialization_failure_keeps_the_pgcode_the_retry_matches(self):
        failure = SerializationFailure()
        failure.__setstate__({'pgcode': errorcodes.SERIALIZATION_FAILURE})

        def replay():
            raise failure

        with self.assertRaises(SerializationFailure) as caught:
            self._answer(replay)
        self.assertEqual(caught.exception.pgcode, errorcodes.SERIALIZATION_FAILURE)


@tagged('post_install', '-at_install', 'liwan')
class TestApiHandlerUnexpectedFailureOverTheWire(LiwanApiCase):
    """One real json2 request each: the dispatcher's own body would carry the traceback, arguments and model names."""

    def assert_generic_internal(self, response):
        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(response.json(), {'code': 'internal', 'message': 'An unexpected error occurred'})
        self.assertNotIn(b'debug', response.content)
        self.assertNotIn(b'arguments', response.content)
        self.assertNotIn(b'Traceback', response.content)

    def test_a_defect_in_a_session_route_answers_the_contract_body(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        with mock.patch('odoo.addons.liwan_api.controllers.me.dump_me', side_effect=KeyError('gross')):
            response = self.api('GET', '/api/v1/me')
        self.assert_generic_internal(response)

    def test_a_broken_database_constraint_answers_invalid_and_writes_nothing(self):
        """A unique violation is the caller's 422, as Odoo's retry words it, and the savepoint keeps no half write."""
        def write_then_break(*args, **kwargs):
            http.request.env['ir.config_parameter'].sudo().set_param('liwan.test.half_write', 'kept')
            http.request.env.cr.execute(
                "INSERT INTO ir_config_parameter (key, value) VALUES ('database.uuid', 'duplicate')",
            )

        self.authenticate('api_emp', 'api_emp_pass_123')
        with mock.patch('odoo.addons.liwan_api.controllers.me.dump_me', side_effect=write_then_break):
            response = self.api('GET', '/api/v1/me')
        self.assertEqual(response.status_code, 422, response.text)
        body = response.json()
        self.assertEqual(body['code'], 'invalid')
        self.assertTrue(body['message'].startswith('The operation cannot be completed'))
        self.assertNotIn(b'debug', response.content)
        self.assertFalse(self.env['ir.config_parameter'].sudo().get_param('liwan.test.half_write'))

    def test_a_defect_in_a_public_route_answers_the_contract_body(self):
        def defect(service, token, purpose):
            message = 'token table unavailable'
            raise RuntimeError(message)

        self.patch(type(self.env['liwan.access.service']), '_liwan_token_usable', defect)
        response = self.api('POST', '/api/v1/public/account/token', {'token': 'x', 'purpose': 'invite'})
        self.assert_generic_internal(response)

    def test_a_defect_in_the_public_branding_read_answers_the_contract_body(self):
        """The login page reads this without a session; a defect there must not hand the browser a traceback."""
        def defect(company):
            message = 'branding serializer failed'
            raise RuntimeError(message)

        with mock.patch('odoo.addons.liwan_api.controllers.branding.dump_branding', defect):
            response = self.url_open('/api/v1/branding')
        self.assert_generic_internal(response)
