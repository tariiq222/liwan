# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company isolation inventory of the GET record routes of liwan_ai.

Its one GET route with a path parameter answers the mode of a conversation from the caller's own message rows only
(exempted below). A route that carries a record id, an export or a file must come with an isolation case
(cover_isolation_routes) or an explicit exemption, and this count moves with it.
"""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    LiwanApiCase,
    assert_isolation_discovery,
    exempt_isolation_route,
)

EXPECTED_GET_RECORD_ROUTES = 1
exempt_isolation_route(
    '/api/v1/ai/conversations/<string:conversation_id>/mode',
    "reads only the caller's own audit rows of that conversation; no company-owned record is returned",
)


@tagged('post_install', '-at_install', 'liwan')
class TestLiwanAiIsolationDiscovery(LiwanApiCase):

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_ai', EXPECTED_GET_RECORD_ROUTES)
