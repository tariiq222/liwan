# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation inventory of the GET record routes of liwan_hr_operations.

Its one record route reads the leave through liwan_hr's own ``_current_leave`` and adds only the approval
workflow of that leave, so the company matrix of the leave record route
(``liwan_hr/tests/test_company_isolation.py``) is the isolation case of the leave, and the leave approval
tests cover the other-company answer. A route that does not delegate must come with an isolation case
(``cover_isolation_routes``) or an exemption, and this count moves with it.
"""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    LiwanApiCase,
    assert_isolation_discovery,
    exempt_isolation_route,
)

EXPECTED_GET_RECORD_ROUTES = 1

exempt_isolation_route(
    '/api/v1/hr/leave/requests/<int:leave_id>/approval',
    'resolves its leave through liwan_hr _current_leave, covered by the leave record matrix; '
    'test_another_company_leave_is_404 in test_leave_approval_http.py covers the foreign-company answer',
)


@tagged('post_install', '-at_install', 'liwan')
class TestLiwanHrOperationsIsolationDiscovery(LiwanApiCase):

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_hr_operations', EXPECTED_GET_RECORD_ROUTES)
