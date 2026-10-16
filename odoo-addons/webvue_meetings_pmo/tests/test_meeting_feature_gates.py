# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.webvue_pmo.tests.common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingFeatureGates(WebVuePmoCase):
    """The bell and the people picker stay open while projects or meetings are readable."""

    def test_bell_and_people_stay_open_while_any_owner_feature_is_on(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        operator = profile.with_context(**{OPERATOR_CONTEXT: True})
        # Every installed application that owns bell kinds or picks people registers its feature
        # in these two registries (projects, meetings and any further application, e.g. tasks),
        # and the gate stays open while any one of them is readable.
        owners = {
            '/api/v1/notifications': set(self.env['webvue.notify.registry']._webvue_notify_feature_keys()),
            '/api/v1/people': set(self.env['webvue.directory']._webvue_directory_feature_keys()),
        }
        self.assertTrue({'pmo.enabled', 'meetings.enabled'} <= owners['/api/v1/notifications'])
        gated = set().union(*owners.values())
        # Switching a feature off keeps its reads open through
        # retained_read_features; drop every owner key to test the closed gate.
        retained = [key for key in (profile.retained_read_features or []) if key not in gated]
        self.authenticate('api_emp', 'api_emp_pass_123')
        for path in owners:
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        operator.write({'features': {**profile.features, 'pmo.enabled': False}, 'retained_read_features': retained})
        for path in owners:
            self.assertEqual(self.api('GET', path).status_code, 200, path)
        # Closing the owners one at a time leaves each route open until its last owner is off.
        closed = {}
        remaining = {path: {key for key in keys if profile.features.get(key)} for path, keys in owners.items()}
        for key in sorted(gated):
            closed[key] = False
            operator.write({'features': {**profile.features, **closed}, 'retained_read_features': retained})
            for path, keys in owners.items():
                remaining[path].discard(key)
                response = self.api('GET', path)
                if remaining[path]:
                    self.assertEqual(response.status_code, 200, (path, key))
                    continue
                self.assertEqual(response.status_code, 403, (path, key))
                self.assertEqual(response.json()['code'], 'feature_not_included', path)
                # The gate checks the keys sorted and reports the last failing one.
                self.assertEqual(
                    response.json()['details'], {'reason': 'feature', 'feature': max(keys)}, path)
