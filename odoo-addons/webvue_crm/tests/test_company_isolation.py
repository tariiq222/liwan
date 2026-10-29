# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the CRM GET record, list and export routes."""
import csv
import io

from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)

DETAIL = '/api/v1/crm/opportunities/{}'
EXPECTED_GET_RECORD_ROUTES = 3


@tagged('post_install', '-at_install', 'webvue')
class TestCrmCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['webvue.access.assignment'].sudo()
        manager = cls.env.ref('webvue_crm.role_crm_manager')
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': manager.id, 'company_id': company.id})
        # Same company, employee role only: no CRM capability at all.
        cls.no_cap = new_test_user(
            cls.env, login='iso_crm_nocap', password='iso_crm_nocap_pass_123', name='No CRM',
            groups='webvue_core.group_employee', company_id=cls.company_p.id,
        )
        cls.no_cap.company_ids = [(6, 0, [cls.company_p.id])]
        Assignment.create({
            'user_id': cls.no_cap.id, 'role_id': cls.env.ref('webvue_core.role_employee').id,
            'company_id': cls.company_p.id,
        })
        Lead = cls.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
        cls.leads = {
            tag: Lead.with_company(company).create({
                'name': f'Lead {tag}', 'type': 'opportunity', 'company_id': company.id,
                'phone': f'+96650{i:07d}', 'contact_name': f'Customer {tag.upper()}',
            })
            for i, (tag, company) in enumerate(cls.by_tag.items(), start=1)
        }

    def test_detail_matrix(self):
        """The owning company reads the opportunity; every other company answers the not-found."""
        for current, company in self.by_tag.items():
            self.env_in(company)
            self.assertVisible(DETAIL.format(self.leads[current].id))
            for tag, lead in self.leads.items():
                if tag != current:
                    self.assertHiddenEveryWay('GET', DETAIL.format(lead.id), lead.id)

    def test_calls_route_matrix(self):
        """The call log of an opportunity follows the opportunity's company."""
        for current, company in self.by_tag.items():
            self.env_in(company)
            self.assertVisible(f'/api/v1/crm/opportunities/{self.leads[current].id}/calls')
            for tag, lead in self.leads.items():
                if tag != current:
                    self.assertHiddenEveryWay('GET', f'/api/v1/crm/opportunities/{lead.id}/calls', lead.id)

    def test_list_never_shows_another_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            body = self.assertVisible('/api/v1/crm/opportunities?limit=200').json()
            ids = {item['id'] for item in body['items']}
            self.assertIn(self.leads[current].id, ids)
            for tag, lead in self.leads.items():
                if tag != current:
                    self.assertNotIn(lead.id, ids, f'{tag} leaked into {current}')

    def test_export_never_includes_another_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            response = self.assertVisible('/api/v1/crm/export?status=all')
            names = {row[0] for row in csv.reader(io.StringIO(response.content.decode('utf-8-sig')))}
            self.assertIn(f'Customer {current.upper()}', names)
            for tag in self.by_tag:
                if tag != current:
                    self.assertNotIn(f'Customer {tag.upper()}', names, f'{tag} leaked into {current}')

    def test_missing_capability_in_the_same_company_stays_forbidden(self):
        self.authenticate('iso_crm_nocap', 'iso_crm_nocap_pass_123')
        for path in (DETAIL.format(self.leads['p'].id), '/api/v1/crm/opportunities', '/api/v1/crm/export'):
            response = self.api('GET', path)
            self.assertEqual((response.status_code, response.json().get('code')), (403, 'forbidden'), path)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'webvue_crm', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/crm/opportunities/<int:lead_id>',
    '/api/v1/crm/opportunities/<int:lead_id>/calls',
    '/api/v1/crm/export',
), source='webvue_crm/tests/test_company_isolation.py')
