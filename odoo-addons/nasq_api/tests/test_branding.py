# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestBrandingEndpoint(HttpCase):

    def test_branding_is_public_and_cached(self):
        company = self.env.ref('base.main_company')
        company.write({'name': 'Erada', 'primary_color': '#0055ff'})

        res = self.url_open('/api/v1/branding')

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get('Content-Type'), 'application/json; charset=utf-8')
        self.assertEqual(res.headers.get('Cache-Control'), 'public, max-age=300')
        self.assertEqual(res.json(), {
            'name': 'Erada',
            'logo_url': f'/web/binary/company_logo?company={company.id}',
            'primary_color': '#0055ff',
            'font': 'IBM_Plex_Sans_Arabic',
        })

    def test_branding_falls_back_to_default_color(self):
        self.env.ref('base.main_company').primary_color = False
        res = self.url_open('/api/v1/branding')
        self.assertEqual(res.json()['primary_color'], '#18181b')
