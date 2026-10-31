# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation inventory of the GET record routes of liwan_notify.

None of its GET /api/v1 routes carries a record id, an export or a file. A route that does must
come with an isolation case (cover_isolation_routes) or an explicit exemption, and this count moves with it.
"""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase, assert_isolation_discovery

EXPECTED_GET_RECORD_ROUTES = 0


@tagged('post_install', '-at_install', 'liwan')
class TestLiwanNotifyIsolationDiscovery(LiwanApiCase):

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_notify', EXPECTED_GET_RECORD_ROUTES)
