# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation of the leave approval route this bridge adds to the HR pillar.

Same matrix as ``liwan_hr``: from the parent company its own and its branches' leaves are visible and an
independent company's leave answers 404 ``not_found`` plainly and under every company forgery; from a branch
only the branch is visible.
"""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)
from odoo.addons.liwan_hr.tests.common import set_hr_feature
from odoo.addons.liwan_hr.tests.test_company_isolation import MATRIX
from odoo.addons.liwan_hr_operations.models.common import BRIDGE, BRIDGE_CONTEXT

# The discovery test pins this count: a new GET record route must come with a case or an exemption.
EXPECTED_GET_RECORD_ROUTES = 1
APPROVAL = '/api/v1/hr/leave/requests/{}/approval'


@tagged('post_install', '-at_install', 'liwan')
class TestHrOperationsCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        set_hr_feature(cls, 'operations.enabled', True)
        for company in cls.by_tag.values():
            cls.env['liwan.access.assignment'].sudo().create({
                'user_id': cls.iso_user.id, 'role_id': cls.env.ref('liwan_hr.role_hr_manager').id,
                'company_id': company.id,
            })
        cls.recs = {}
        for tag, company in cls.by_tag.items():
            company._hr_leave_seed_default_process()
            employee = cls.env['hr.employee'].create({
                'name': f'Isolation Staff {tag.upper()}', 'company_id': company.id,
            })
            leave_type = cls.env['hr.leave.type'].create({
                'name': f'Isolation Approved Leave {tag.upper()}', 'requires_allocation': False,
                'leave_validation_type': 'both', 'company_id': company.id,
            })
            leave = cls.env['hr.leave'].with_company(company).create({
                'employee_id': employee.id, 'holiday_status_id': leave_type.id,
                'request_date_from': '2026-05-04', 'request_date_to': '2026-05-05',
            })
            # The workflow request is created through the bridge, as the leave's own filing does, without the
            # submit step: the route only reads the request linked to the leave.
            process = cls.env['liwan.operation.process']._hr_leave_governing_process(company)
            cls.env['liwan.operation.request'].with_company(company).with_context(**{BRIDGE_CONTEXT: BRIDGE}).create({
                'name': leave._hr_leave_summary(), 'process_id': process.id, 'target_id': leave.id,
            })
            assert leave.liwan_approval_request_ids, f'the fixture leave of {tag} must carry an approval request'
            cls.recs[tag] = leave

    def assert_hidden_every_way(self, path, hidden_company):
        for response in self.api_forged('GET', path, hidden_company.id):
            self.assertEqual(response.status_code, 404, f'{path} must stay hidden: {response.text[:200]}')
            self.assertEqual(response.json()['code'], 'not_found', path)

    def test_leave_approval_is_company_scoped(self):
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                self.assertVisible(APPROVAL.format(self.recs[tag].id))
            for tag in hidden:
                self.assert_hidden_every_way(APPROVAL.format(self.recs[tag].id), self.by_tag[tag])

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_hr_operations', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/hr/leave/requests/<int:leave_id>/approval',
), source='liwan_hr_operations/tests/test_company_isolation.py')
