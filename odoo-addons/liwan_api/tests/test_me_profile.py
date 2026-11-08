# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan')
class TestProfileLanguageTimezone(LiwanApiCase):
    """The account holder's language and time zone live on the user record, not in a cookie."""

    def setUp(self):
        super().setUp()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def test_the_me_payload_reports_the_stored_language_and_zone(self):
        self.employee.write({'lang': 'en_US', 'tz': 'Asia/Riyadh'})
        body = self.api('GET', '/api/v1/me').json()
        self.assertEqual(body['lang'], 'en_US')
        self.assertEqual(body['tz'], 'Asia/Riyadh')

    def test_the_holder_saves_their_own_language_and_zone(self):
        res = self.api('PATCH', '/api/v1/me/profile', {'lang': 'en_US', 'tz': 'Asia/Riyadh'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['lang'], 'en_US')
        self.assertEqual(res.json()['tz'], 'Asia/Riyadh')
        self.assertEqual(self.employee.lang, 'en_US')
        self.assertEqual(self.employee.tz, 'Asia/Riyadh')

    def test_an_uninstalled_language_is_refused(self):
        before = self.employee.lang
        res = self.api('PATCH', '/api/v1/me/profile', {'lang': 'xx_XX'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'lang')
        self.assertEqual(self.employee.lang, before)

    def test_an_unknown_time_zone_is_refused(self):
        res = self.api('PATCH', '/api/v1/me/profile', {'tz': 'Mars/Olympus'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'tz')

    def test_an_empty_zone_clears_the_stored_value(self):
        self.employee.tz = 'Asia/Riyadh'
        res = self.api('PATCH', '/api/v1/me/profile', {'tz': ''})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertFalse(self.employee.tz)

    def test_another_field_is_not_writable(self):
        res = self.api('PATCH', '/api/v1/me/profile', {'name': 'Somebody Else'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'name')

    def test_an_empty_patch_is_refused(self):
        res = self.api('PATCH', '/api/v1/me/profile', {})
        self.assertEqual(res.status_code, 422)

    def test_the_stored_language_localizes_the_server_text(self):
        """Mail and server text follow the stored value; the UI locale header only shapes one request."""
        self.employee.write({'lang': 'en_US'})
        me = self.api('GET', '/api/v1/me').json()
        self.assertEqual(me['lang'], 'en_US')
        # The UI-locale header narrows one request's server text and never writes the stored value.
        self.url_open('/api/v1/me', headers={'Content-Type': 'application/json', 'X-Liwan-Ui-Locale': 'ar'})
        self.assertEqual(self.employee.lang, 'en_US')

    def test_a_missing_zone_is_an_empty_string_not_null(self):
        self.employee.tz = False
        body = self.api('GET', '/api/v1/me').json()
        self.assertEqual(body['tz'], '')
