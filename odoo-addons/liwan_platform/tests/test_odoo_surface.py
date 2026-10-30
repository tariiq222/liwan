# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta
from unittest.mock import patch

from odoo.tests import HttpCase, get_db_name, new_test_user, tagged

BROWSER_NAVIGATION = {
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1',
}
JSON_HEADERS = {'Content-Type': 'application/json'}


@tagged('post_install', '-at_install', 'liwan')
class TestSessionOdooSurface(HttpCase):
    """A signed-in request reaches /api/v1 and the app's few Odoo routes, nothing else."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile._liwan_initialize_legacy_policy(
            cls.env['liwan.feature.registry']._liwan_installed_module_ids(),
        )
        cls.user = new_test_user(
            cls.env, login='surface_emp', password='surface_emp_pass_123',
            groups='liwan_core.group_employee',
        )
        cls.admin = new_test_user(
            cls.env, login='surface_admin', password='surface_admin_pass_123',
            groups='base.group_system',
        )
        cls.api_key = cls.env['res.users.apikeys'].with_user(cls.user)._generate(
            None, 'surface', datetime.now() + timedelta(days=1),
        )
        cls.attachment = cls.env['ir.attachment'].create({
            'name': 'surface.txt', 'raw': b'surface-bytes', 'mimetype': 'text/plain',
            'res_model': 'res.users', 'res_id': cls.user.id,
        })

    def _rpc(self, path, params):
        return self.url_open(
            path, json={'jsonrpc': '2.0', 'method': 'call', 'params': params}, headers=JSON_HEADERS,
        )

    def _assert_rpc_closed(self, response):
        # Odoo answers a jsonrpc route error with HTTP 200 and an error body.
        body = response.json()
        self.assertNotIn('result', body)
        self.assertEqual(body['error']['code'], 404)

    def test_generic_orm_endpoints_are_closed_to_a_session(self):
        self.authenticate('surface_emp', 'surface_emp_pass_123')
        self._assert_rpc_closed(self._rpc('/web/dataset/call_kw/res.users/search_read', {
            'model': 'res.users', 'method': 'search_read', 'args': [], 'kwargs': {'fields': ['login']},
        }))
        for path in ('/doc/index.json', '/doc', '/report/pdf/base.report_irmodulereference/1', '/my/home'):
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 404)
        by_session = self.url_open(
            '/json/2/res.users/search_read', json={'fields': ['login']},
            headers={**JSON_HEADERS, **BROWSER_NAVIGATION},
        )
        self.assertEqual(by_session.status_code, 404)

    def test_system_admin_session_is_closed_too(self):
        self.authenticate('surface_admin', 'surface_admin_pass_123')
        for path in ('/odoo', '/odoo/action-1', '/web', '/web/webclient/load_menus', '/doc/index.json'):
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 404)
        self._assert_rpc_closed(self._rpc('/web/dataset/call_kw/res.users/search_read', {
            'model': 'res.users', 'method': 'search_read', 'args': [], 'kwargs': {},
        }))

    def test_api_key_cannot_reach_json2(self):
        self.opener.cookies.clear()
        response = self.url_open(
            '/json/2/res.users/search_read', json={'fields': ['login']},
            headers={**JSON_HEADERS, 'Authorization': f'bearer {self.api_key}'},
        )
        self.assertEqual(response.status_code, 404)

    def test_password_rpc_is_closed_for_everyone(self):
        self.opener.cookies.clear()
        xmlrpc = self.url_open(
            '/xmlrpc/2/object', data=b'<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName></methodCall>',
            headers={'Content-Type': 'text/xml'},
        )
        self.assertEqual(xmlrpc.status_code, 404)
        self.assertEqual(self.url_open('/xmlrpc/2/common', data=b'<x/>').status_code, 404)
        jsonrpc = self.url_open(
            '/jsonrpc', json={'jsonrpc': '2.0', 'method': 'call', 'params': {
                'service': 'object', 'method': 'execute_kw',
                'args': [get_db_name(), self.user.id, 'surface_emp_pass_123', 'res.users', 'search_read', [[]]],
            }},
            headers=JSON_HEADERS,
        )
        self._assert_rpc_closed(jsonrpc)

    def test_image_routes_are_limited_to_the_app_patterns(self):
        self.authenticate('surface_emp', 'surface_emp_pass_123')
        company = self.env.company
        allowed = (
            f'/web/image/res.company/{company.id}/logo/32x32?v=0-0123456789ab',
            '/web/binary/company_logo',
        )
        for path in allowed:
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 200)
        blocked = (
            f'/web/image/res.users/{self.user.id}/avatar_128',
            f'/web/image/res.company/{company.id}/logo',
            f'/web/content/res.users/{self.user.id}/avatar_128',
            f'/web/content/{self.attachment.id}/extra',
        )
        for path in blocked:
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 404)

    def test_stock_attachment_download_is_closed_for_sessions(self):
        # Attachments are served only by the owning /api/v1 routes, which check the app capability.
        self.authenticate('surface_emp', 'surface_emp_pass_123')
        base = f'/web/content/{self.attachment.id}'
        for path in (base, f'{base}?download=true', f'{base}?unique=1', f'{base}?model=hr.employee&field=image_1920'):
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 404)

    def test_image_routes_reject_unexpected_query_strings(self):
        self.authenticate('surface_emp', 'surface_emp_pass_123')
        favicon = f'/web/image/res.company/{self.env.company.id}/logo/32x32'
        version = '0-0123456789ab'
        self.assertEqual(self.url_open(f'{favicon}?v={version}').status_code, 200)
        for query in ('', '?v=first', f'?v={version}&width=64', '?download=true'):
            with self.subTest(query=query):
                self.assertEqual(self.url_open(f'{favicon}{query}').status_code, 404)
        self.assertEqual(self.url_open('/web/image/hr.employee/1/avatar_128?x=1').status_code, 404)

    @patch('odoo.addons.base.models.ir_actions_report.IrActionsReport.barcode', return_value=b'png')
    def test_report_barcode_is_open_for_wkhtmltopdf(self, _barcode):
        # The image backend of reportlab is not part of every test host; the route itself is stock.
        qr = '/report/barcode/?barcode_type=QR&value=surface&width=64&height=64'
        anonymous = self.url_open(qr)
        self.assertEqual(anonymous.status_code, 200)
        self.authenticate('surface_emp', 'surface_emp_pass_123')
        signed_in = self.url_open(qr)
        self.assertEqual(signed_in.status_code, 200)
        self.assertEqual(self.url_open('/report/barcode?barcode_type=QR&value=surface').status_code, 200)
        self.assertEqual(self.url_open('/report/barcode/QR/surface').status_code, 404)

    def test_anonymous_requests_reach_only_what_the_login_needs(self):
        self.opener.cookies.clear()
        for path in ('/web/health', '/web/binary/company_logo', '/api/v1/branding'):
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 200)
        closed = (
            '/web/login', '/web/signup', '/web/reset_password', '/odoo', '/mail/view', '/discuss/channel/1',
            '/chat/token', '/meet/token', '/web/webclient/translations', '/web/bundle/web.assets_web',
            '/web/set_profiling', '/rate/token/1', '/dashboard/share/x', f'/web/content/{self.attachment.id}',
        )
        for path in closed:
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path).status_code, 404)
        login = self._rpc('/web/session/authenticate', {
            'db': get_db_name(), 'login': 'surface_emp', 'password': 'surface_emp_pass_123',
        })
        self.assertEqual(login.json()['result']['uid'], self.user.id)

    def test_session_routes_the_app_needs_still_work(self):
        self.authenticate('surface_emp', 'surface_emp_pass_123')
        self.assertEqual(self.url_open('/api/v1/me').status_code, 200)
        self.assertEqual(self.url_open('/web/health').status_code, 200)
        info = self._rpc('/web/session/get_session_info', {}).json()
        self.assertEqual(info['result']['uid'], self.user.id, info)
        destroyed = self._rpc('/web/session/destroy', {})
        self.assertNotIn('error', destroyed.json(), destroyed.text)
        after = self.url_open('/api/v1/me')
        self.assertIn(after.status_code, (401, 403), after.text)
