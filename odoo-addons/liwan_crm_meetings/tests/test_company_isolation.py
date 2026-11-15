# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the meetings of an opportunity."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)

PATH = '/api/v1/crm/opportunities/{}/meetings'
EXPECTED_GET_RECORD_ROUTES = 1


@tagged('post_install', '-at_install', 'liwan')
class TestCrmMeetingsCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['liwan.access.assignment'].sudo()
        permissions = cls.env['liwan.access.permission'].search([
            ('key', 'in', ['crm.leads.read', 'crm.leads.work', 'meetings.read', 'meetings.create']),
        ])
        for tag, company in cls.by_tag.items():
            role = cls.env['liwan.access.role'].with_company(company).create({
                'key': f'iso_crm_meetings_{tag}', 'name_ar': f'iso_crm_meetings_{tag}', 'name_en': f'iso_crm_meetings_{tag}',
                'type': 'custom', 'assignable': True, 'company_id': company.id,
                'permission_ids': [(6, 0, permissions.ids)],
            })
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': role.id, 'company_id': company.id})
        Lead = cls.env['crm.lead'].with_context(mail_auto_subscribe_no_notify=True)
        cls.leads = {
            tag: Lead.with_company(company).create({
                'name': f'Lead {tag}', 'type': 'opportunity', 'company_id': company.id,
                'user_id': cls.iso_user.id,
            })
            for tag, company in cls.by_tag.items()
        }

    def test_list_and_create_follow_the_opportunity_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            created = self.api('POST', PATH.format(self.leads[current].id), {'name': f'Meeting {current}'})
            self.assertEqual(created.status_code, 201, created.text)
            listed = self.assertVisible(PATH.format(self.leads[current].id)).json()
            self.assertEqual([item['name'] for item in listed['items']], [f'Meeting {current}'])
            for tag, lead in self.leads.items():
                if tag != current:
                    self.assertHiddenEveryWay('GET', PATH.format(lead.id), self.by_tag[tag].id)
                    refused = self.api('POST', PATH.format(lead.id), {'name': 'Cross'})
                    self.assertEqual(refused.status_code, 404, (current, tag))
        self.assertFalse(self.env['liwan.meeting.minute'].search([('name', '=', 'Cross')]))

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_crm_meetings', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/crm/opportunities/<int:opportunity_id>/meetings',
), source='liwan_crm_meetings/tests/test_company_isolation.py')
