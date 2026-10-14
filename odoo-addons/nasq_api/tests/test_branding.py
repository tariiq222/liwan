# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from io import BytesIO

from PIL import Image

from odoo.exceptions import AccessError
from odoo.tests import HttpCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestBrandingEndpoint(HttpCase):

    def test_branding_is_public_and_cached(self):
        company = self.env.ref('base.main_company')
        company.write({'name': 'Erada', 'primary_color': '#0055ff', 'logo': image_base64('PNG')})

        res = self.url_open('/api/v1/branding')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get('Content-Type'), 'application/json; charset=utf-8')
        self.assertEqual(res.headers.get('Cache-Control'), 'public, max-age=300')
        body = res.json()
        self.assertEqual(set(body) - {'secondary_color'}, {'name', 'logo_url', 'primary_color', 'font'})
        self.assertEqual(body['name'], 'Erada')
        self.assertEqual(body['primary_color'], '#0055ff')
        self.assertEqual(body['font'], 'IBM_Plex_Sans_Arabic')
        self.assertRegex(body['logo_url'], rf'^/web/binary/company_logo\?company={company.id}&v=.+$')

    def test_branding_has_no_logo_url_without_a_company_logo(self):
        company = self.env.ref('base.main_company')
        company.logo = False
        body = self.url_open('/api/v1/branding').json()
        self.assertIn('logo_url', body)
        self.assertIsNone(body['logo_url'])

    def test_branding_has_no_logo_url_for_the_stock_odoo_logo(self):
        company = self.env.ref('base.main_company')
        company.logo = company._get_logo()
        self.assertIsNone(self.url_open('/api/v1/branding').json()['logo_url'])

    def test_branding_falls_back_to_default_color(self):
        self.env.ref('base.main_company').primary_color = False
        res = self.url_open('/api/v1/branding')
        self.assertEqual(res.json()['primary_color'], '#18181b')

    def test_branding_uses_root_company_not_lowest_id(self):
        decoy = self.env.ref('base.main_company')
        decoy.write({'name': 'Decoy', 'primary_color': '#111111'})
        root = self.env['res.company'].create({
            'name': 'Root Brand', 'primary_color': '#00aa00',
        })
        self.env.ref('nasq_platform.tenant_profile').root_company_id = root
        res = self.url_open('/api/v1/branding')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['name'], 'Root Brand')
        self.assertEqual(body['primary_color'], '#00aa00')
        self.assertNotEqual(body['name'], decoy.name)
        self.assertGreater(root.id, decoy.id)


def image_base64(image_format):
    stream = BytesIO()
    Image.new('RGB', (1, 1), (0, 85, 255)).save(stream, format=image_format)
    return base64.b64encode(stream.getvalue()).decode()


@tagged('post_install', '-at_install', 'nasq')
class TestAdminBranding(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
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

    def test_admin_can_read_and_update_only_colour(self):
        self.authenticate('branding_admin', 'branding_admin_pass_123')
        original = self.api('GET', '/api/v1/admin/branding')
        self.assertEqual(original.status_code, 200)
        response = self.api('PATCH', '/api/v1/admin/branding', {'primary_color': '#0055ff'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['name'], original.json()['name'])
        self.assertEqual(response.json()['primary_color'], '#0055ff')

    def test_secondary_color_save_preserves_primary_and_identity(self):
        self.authenticate('branding_admin', 'branding_admin_pass_123')
        original = self.api('GET', '/api/v1/admin/branding').json()
        response = self.api('PATCH', '/api/v1/admin/branding', {'secondary_color': '#aabbcc'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['secondary_color'], '#aabbcc')
        self.assertEqual(response.json()['primary_color'], original['primary_color'])
        self.assertEqual(response.json()['name'], original['name'])
        self.assertEqual(self.api('GET', '/api/v1/admin/branding').json()['secondary_color'], '#aabbcc')
        for payload in [{'secondary_color': '#abc'}, {'secondary_color': None},
                        {'secondary_color': '#ffffff', 'primary_color': 'invalid'}]:
            before = self.api('GET', '/api/v1/admin/branding').json()
            response = self.api('PATCH', '/api/v1/admin/branding', payload)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(self.api('GET', '/api/v1/admin/branding').json(), before)
        response = self.api('PATCH', '/api/v1/admin/branding', {'secondary_color': '#ffffff', 'name': 'Forbidden'})
        self.assertEqual(response.status_code, 403, response.text)

    def test_identity_patches_are_forbidden_for_admin_and_vendor_atomically(self):
        for login, password in [
            ('branding_admin', 'branding_admin_pass_123'),
            ('branding_vendor', 'branding_vendor_pass_123'),
        ]:
            self.authenticate(login, password)
            original = self.api('GET', '/api/v1/admin/branding').json()
            for identity in [{'name': 'Forbidden rename'}, {'logo': image_base64('PNG')}, {'logo': False}]:
                for payload in [identity, {'primary_color': '#123456', **identity}]:
                    response = self.api('PATCH', '/api/v1/admin/branding', payload)
                    self.assertEqual(response.status_code, 403, response.text)
                    self.assertEqual(response.json()['code'], 'forbidden')
                    self.assertEqual(self.api('GET', '/api/v1/admin/branding').json(), original)

    def test_customer_admin_cannot_write_company_identity_through_orm(self):
        company = self.env.company.with_user(self.admin)
        for vals in [{'name': 'Forbidden'}, {'logo': image_base64('PNG')}, {'logo_web': False},
                     {'partner_id': self.admin.partner_id.id}]:
            with self.assertRaises(AccessError), self.cr.savepoint():
                company.write(vals)
        for vals in [{'name': 'Forbidden'}, {'image_1920': image_base64('PNG')}, {'image_128': False}]:
            with self.assertRaises(AccessError), self.cr.savepoint():
                company.partner_id.write(vals)

    def test_vendor_can_manage_identity_in_odoo_and_public_branding_reflects_it(self):
        company = self.env.company.with_user(self.vendor)
        company.write({'name': 'Odoo managed name', 'logo': image_base64('PNG')})
        original = self.api('GET', '/api/v1/branding').json()
        self.assertEqual(original['name'], 'Odoo managed name')
        company.write({'logo': image_base64('JPEG')})
        self.assertNotEqual(original['logo_url'], self.api('GET', '/api/v1/branding').json()['logo_url'])

    def test_customer_admin_cannot_bypass_logo_guard_through_attachments(self):
        self.admin.group_ids |= self.env.ref('base.group_partner_manager')
        company = self.env.company
        company.logo = image_base64('PNG')
        attachment = self.env['ir.attachment'].search([
            ('res_model', '=', 'res.partner'), ('res_id', '=', company.partner_id.id),
            ('res_field', '=', 'image_1920'),
        ], limit=1)
        self.assertTrue(attachment)
        with self.assertRaises(AccessError), self.cr.savepoint():
            attachment.with_user(self.admin).write({'datas': image_base64('JPEG')})
        with self.assertRaises(AccessError), self.cr.savepoint():
            attachment.with_user(self.admin).unlink()
        with self.assertRaises(AccessError), self.cr.savepoint():
            attachment.with_user(self.admin).write({'res_id': self.admin.partner_id.id})
        target = {'res_model': 'res.partner', 'res_id': company.partner_id.id, 'res_field': 'image_1920'}
        with self.assertRaises(AccessError), self.cr.savepoint():
            self.env['ir.attachment'].with_user(self.admin).create({
                **target, 'name': 'Replacement', 'datas': image_base64('PNG'),
            })
        ordinary = self.env['ir.attachment'].create({'name': 'Ordinary attachment', 'datas': image_base64('PNG')})
        with self.assertRaises(AccessError), self.cr.savepoint():
            ordinary.with_user(self.admin).write(target)

    def test_customer_admin_cannot_create_a_company_to_replace_identity(self):
        partner = self.env['res.partner'].create({'name': 'Unlinked institution contact'})
        with self.assertRaises(AccessError), self.cr.savepoint():
            self.env['res.company'].with_user(self.admin).create({
                'name': 'Customer-controlled institution', 'partner_id': partner.id,
            })
        company = self.env['res.company'].with_user(self.vendor).create({'name': 'Vendor-managed institution'})
        self.assertEqual(company.name, 'Vendor-managed institution')

    def test_contact_manager_can_still_edit_an_ordinary_contact(self):
        contact_manager = new_test_user(
            self.env, login='branding_contacts', groups='base.group_user,base.group_partner_manager',
        )
        partner = self.env['res.partner'].create({'name': 'Ordinary contact'})
        partner.with_user(contact_manager).write({'name': 'Updated contact', 'image_1920': image_base64('PNG')})
        self.assertEqual(partner.name, 'Updated contact')

    def test_contact_manager_cannot_edit_company_partner_identity(self):
        contact_manager = new_test_user(
            self.env, login='branding_company_contact', groups='base.group_user,base.group_partner_manager',
        )
        with self.assertRaises(AccessError):
            self.env.company.partner_id.with_user(contact_manager).write({'name': 'Contact manager rename'})

    def test_vendor_can_update_colour_via_implied_admin_role(self):
        self.authenticate('branding_vendor', 'branding_vendor_pass_123')
        response = self.api('PATCH', '/api/v1/admin/branding', {'primary_color': '#123456'})
        self.assertEqual(response.status_code, 200, response.text)

    def test_invalid_colour_and_unknown_fields_are_rejected(self):
        self.authenticate('branding_admin', 'branding_admin_pass_123')
        for payload in [{}, {'primary_color': '#abc'}, {'primary_color': None}, {'unknown': True}]:
            response = self.api('PATCH', '/api/v1/admin/branding', payload)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['code'], 'invalid')
