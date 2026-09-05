# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from io import BytesIO

from PIL import Image

from odoo.tests import HttpCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestBrandingEndpoint(HttpCase):

    def test_branding_is_public_and_cached(self):
        company = self.env.ref('base.main_company')
        company.write({'name': 'Erada', 'primary_color': '#0055ff'})

        res = self.url_open('/api/v1/branding')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get('Content-Type'), 'application/json; charset=utf-8')
        self.assertEqual(res.headers.get('Cache-Control'), 'public, max-age=300')
        body = res.json()
        self.assertEqual(set(body), {'name', 'logo_url', 'primary_color', 'font'})
        self.assertEqual(body['name'], 'Erada')
        self.assertEqual(body['primary_color'], '#0055ff')
        self.assertEqual(body['font'], 'IBM_Plex_Sans_Arabic')
        self.assertRegex(body['logo_url'], rf'^/web/binary/company_logo\?company={company.id}&v=.+$')

    def test_branding_falls_back_to_default_color(self):
        self.env.ref('base.main_company').primary_color = False
        res = self.url_open('/api/v1/branding')
        self.assertEqual(res.json()['primary_color'], '#18181b')


def image_base64(image_format):
    stream = BytesIO()
    Image.new('RGB', (1, 1), (0, 85, 255)).save(stream, format=image_format)
    return base64.b64encode(stream.getvalue()).decode()


@tagged('post_install', '-at_install', 'nasq')
class TestAdminBranding(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The scoped customer-admin partner rule grants access to contacts
        # belonging to the active company, including its company contact.
        cls.env.company.partner_id.company_id = cls.env.company
        cls.employee = new_test_user(
            cls.env, login='branding_employee', password='branding_employee_pass_123',
            groups='nasq_core.group_employee',
        )
        cls.admin = new_test_user(
            cls.env, login='branding_admin', password='branding_admin_pass_123',
            groups='nasq_core.group_customer_admin',
        )
        cls.vendor = new_test_user(
            cls.env, login='branding_vendor', password='branding_vendor_pass_123',
            groups='nasq_core.group_vendor_support',
        )

    def api(self, method, path, json=None):
        return self.url_open(path, json=json, headers={'Content-Type': 'application/json'}, method=method)

    def test_employee_cannot_read_or_update_admin_branding(self):
        self.authenticate('branding_employee', 'branding_employee_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/branding').status_code, 403)
        self.assertEqual(self.api('PATCH', '/api/v1/admin/branding', {'name': 'Nope'}).status_code, 403)

    def test_admin_can_read_and_update_partial_branding(self):
        self.authenticate('branding_admin', 'branding_admin_pass_123')
        response = self.api('GET', '/api/v1/admin/branding')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'name', 'logo_url', 'primary_color', 'font'})

        response = self.api('PATCH', '/api/v1/admin/branding', {'name': '  Erada Admin  ', 'primary_color': '#0055ff'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['name'], 'Erada Admin')
        self.assertEqual(response.json()['primary_color'], '#0055ff')

    def test_vendor_can_read_and_update_via_implied_admin_role(self):
        self.authenticate('branding_vendor', 'branding_vendor_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/branding').status_code, 200)
        response = self.api('PATCH', '/api/v1/admin/branding', {'primary_color': '#123456'})
        self.assertEqual(response.status_code, 200, response.text)

    def test_logo_accepts_png_and_jpeg_and_changes_version_rapidly(self):
        self.authenticate('branding_admin', 'branding_admin_pass_123')
        png = self.api('PATCH', '/api/v1/admin/branding', {'logo': image_base64('PNG')})
        self.assertEqual(png.status_code, 200, png.text)
        png_url = png.json()['logo_url']
        jpeg = self.api('PATCH', '/api/v1/admin/branding', {'logo': image_base64('JPEG')})
        self.assertEqual(jpeg.status_code, 200, jpeg.text)
        self.assertNotEqual(png_url, jpeg.json()['logo_url'])

    def test_logo_and_payload_validation_return_contract_errors(self):
        self.authenticate('branding_admin', 'branding_admin_pass_123')
        invalid_payloads = [
            {'logo': '@@@'},
            {'logo': base64.b64encode(b'GIF89a').decode()},
            {'logo': base64.b64encode(b'corrupt-image').decode()},
            {'logo': 'data:image/png;base64,' + image_base64('PNG')},
            {},
        ]
        for payload in invalid_payloads:
            response = self.api('PATCH', '/api/v1/admin/branding', payload)
            self.assertEqual(response.status_code, 422, (payload, response.text))

        unknown = self.api('PATCH', '/api/v1/admin/branding', {'unknown': True})
        self.assertEqual(unknown.status_code, 422, unknown.text)
        self.assertEqual(unknown.json()['code'], 'invalid')
        self.assertEqual(unknown.json()['field'], 'unknown')

        oversized = base64.b64encode(b'x' * (1024 * 1024 + 1)).decode()
        response = self.api('PATCH', '/api/v1/admin/branding', {'logo': oversized})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['code'], 'logo_too_large')
