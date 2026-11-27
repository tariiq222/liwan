# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanTelephonyCase


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyAccessComposition(LiwanTelephonyCase):

    def test_the_four_capabilities_exist(self):
        service = self.env['liwan.access.service']
        keys = {entry['key'] for entry in service._liwan_capability_definitions()}
        for key in (
            'telephony.use', 'telephony.calls.read_all',
            'telephony.recordings.listen', 'telephony.manage',
        ):
            self.assertIn(key, keys)

    def test_listening_is_not_implied_by_reading(self):
        dependencies = self.env['liwan.access.service']._liwan_permission_dependencies()
        self.assertNotIn('telephony.recordings.listen', dependencies.get('telephony.calls.read_all', set()))

    def test_the_manager_holds_every_capability(self):
        service = self.env['liwan.access.service']
        for key in (
            'telephony.use', 'telephony.calls.read_all',
            'telephony.recordings.listen', 'telephony.manage',
        ):
            self.assertTrue(service._liwan_has_capability(self.manager, key), key)

    def test_an_outsider_holds_none(self):
        service = self.env['liwan.access.service']
        self.assertFalse(service._liwan_has_capability(self.outsider, 'telephony.use'))
