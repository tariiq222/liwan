# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestPmoFeatureEnforcement(NasqPmoCase):

    def test_withdrawn_pmo_keeps_reads_and_blocks_writes(self):
        profile = self.env.ref('nasq_platform.tenant_profile')
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

    def test_bell_and_people_stay_open_while_any_owner_feature_is_on(self):
        profile = self.env.ref('nasq_platform.tenant_profile')
        operator = profile.with_context(**{OPERATOR_CONTEXT: True})
        gated = ('pmo.enabled', 'meetings.enabled')
        # Switching a feature off keeps its reads open through
        # retained_read_features; drop both keys to test the closed gate.
        retained = [key for key in (profile.retained_read_features or []) if key not in gated]
        paths = ('/api/v1/notifications', '/api/v1/people')
        self.authenticate('api_emp', 'api_emp_pass_123')
        for path in paths:
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        operator.write({'features': {**profile.features, 'pmo.enabled': False}, 'retained_read_features': retained})
        for path in paths:
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        operator.write({
            'features': {**profile.features, 'pmo.enabled': False, 'meetings.enabled': False},
            'retained_read_features': retained,
        })
        for path in paths:
            response = self.api('GET', path)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()['code'], 'feature_not_included', path)
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'meetings.enabled'}, path)
