# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from .tenant_export_columns import COLUMNS
from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_columns_pinned,
    assert_contribution,
    datasets_by_key,
)

KEYS = (
    'meetings', 'meeting_series', 'meeting_minutes', 'meeting_minutes_versions', 'meeting_resolutions', 'meeting_settings',
)


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingsTenantExport(TransactionCase):

    def test_the_datasets_read_and_meetings_carry_their_files(self):
        assert_contribution(self, KEYS, {'meetings': ('id', 'name', 'start', 'stop')})
        self.assertTrue(datasets_by_key(self.env)['meetings']['files'])

    def test_the_exported_columns_are_pinned(self):
        assert_columns_pinned(self, COLUMNS)
