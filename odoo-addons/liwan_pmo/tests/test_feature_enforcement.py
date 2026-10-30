# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestPmoFeatureEnforcement(LiwanPmoCase):

    def test_withdrawn_pmo_keeps_reads_and_blocks_writes(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        self.authenticate('api_emp', 'api_emp_pass_123')
        listed = self.api('GET', '/api/v1/projects?minimal=1')
        self.assertEqual(listed.status_code, 200)
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'pmo.enabled': False},
        })
        kept = self.api('GET', '/api/v1/projects?minimal=1')
        self.assertEqual(kept.status_code, 200)
        created = self.api('POST', '/api/v1/projects', {'name': 'Blocked by entitlement'})
        self.assertEqual(created.status_code, 403)
        self.assertEqual(created.json()['code'], 'feature_not_included')
