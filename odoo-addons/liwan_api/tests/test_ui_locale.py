# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.http import request
from odoo.tests import HttpCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestUiLocaleHeader(HttpCase):
    """The UI language chooses the server text language of one /api/v1 request, nothing else."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['res.lang']._activate_lang('ar_001')
        cls.env['res.lang']._activate_lang('en_US')
        cls.user = new_test_user(
            cls.env, login='locale_emp', password='locale_emp_pass_123', groups='liwan_core.group_employee',
        )
        cls.user.lang = 'en_US'

    def _probe(self, header=None):
        headers = {'Content-Type': 'application/json'}
        if header is not None:
            headers['X-Liwan-Ui-Locale'] = header
        return self.url_open('/api/v1/me', headers=headers)

    def _request_lang(self, header):
        seen = []
        model = type(self.env['ir.http'])
        original = model._pre_dispatch

        def spy(rule, args):
            original(rule, args)
            seen.append(request.env.lang)
        with patch.object(model, '_pre_dispatch', staticmethod(spy)):
            self.authenticate('locale_emp', 'locale_emp_pass_123')
            self._probe(header)
        return seen[-1]

    def test_the_header_selects_the_request_language(self):
        self.assertEqual(self._request_lang('ar'), 'ar_001')
        self.assertEqual(self._request_lang('en'), 'en_US')

    def test_an_unsupported_or_forged_value_falls_back(self):
        baseline = self._request_lang(None)
        for value in ('fr', 'ar_001', 'ar; drop', '', 'x' * 500):
            with self.subTest(value=value[:20]):
                self.assertEqual(self._request_lang(value), baseline)

    def test_the_stored_language_is_never_changed(self):
        self._request_lang('ar')
        self.user.invalidate_recordset()
        self.assertEqual(self.user.lang, 'en_US')
