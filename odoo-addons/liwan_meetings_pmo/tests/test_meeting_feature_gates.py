# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingFeatureGates(LiwanPmoCase):
    """The bell and the people picker stay open while projects or meetings are readable."""

    def test_bell_and_people_stay_open_while_any_owner_feature_is_on(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        operator = profile.with_context(**{OPERATOR_CONTEXT: True})
        # Every installed application that owns bell kinds or picks people registers its feature
        # in these two registries (projects, meetings and any further application, e.g. tasks),
        # and the gate stays open while any one of them is readable.
        owners = {
            '/api/v1/notifications': set(self.env['liwan.notify.registry']._liwan_notify_feature_keys()),
            '/api/v1/people': set(self.env['liwan.directory']._liwan_directory_feature_keys()),
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
        # The bell also carries platform-owned kinds (an access change) that no application feature
        # gates, so it stays open once every application feature is off; each row is still filtered.
        always_open = {'/api/v1/notifications'} if self.env['liwan.notify.registry']._liwan_notify_has_platform_kind() else set()
        closed = {}
        remaining = {path: {key for key in keys if profile.features.get(key)} for path, keys in owners.items()}
        for key in sorted(gated):
            closed[key] = False
            operator.write({'features': {**profile.features, **closed}, 'retained_read_features': retained})
            for path, keys in owners.items():
                remaining[path].discard(key)
                response = self.api('GET', path)
                if remaining[path] or path in always_open:
                    self.assertEqual(response.status_code, 200, (path, key))
                    continue
                self.assertEqual(response.status_code, 403, (path, key))
                self.assertEqual(response.json()['code'], 'feature_not_included', path)
                # The gate checks the keys sorted and reports the last failing one.
                self.assertEqual(
                    response.json()['details'], {'reason': 'feature', 'feature': max(keys)}, path)

    def test_linking_a_project_is_refused_while_projects_are_off(self):
        role = self.env['liwan.access.role'].create({
            'name_ar': 'ربط الاجتماعات بالمشاريع', 'key': 'meeting_project_link_gate',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create', 'pmo.projects.read']),
            ]).ids)],
        })
        self.env['liwan.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = {'name': 'Linked', 'meeting_date': '2026-11-20', 'project_id': self.project.id}
        created = self.api('POST', '/api/v1/meetings', body)
        self.assertEqual(created.status_code, 201, created.text)
        profile = self.env.ref('liwan_platform.tenant_profile')
        operator = profile.with_context(**{OPERATOR_CONTEXT: True})
        retained = [key for key in (profile.retained_read_features or []) if key != 'pmo.enabled']
        operator.write({'features': {**profile.features, 'pmo.enabled': False}, 'retained_read_features': retained})
        refused = self.api('POST', '/api/v1/meetings', body)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'feature_not_included'), refused.text)
        patched = self.api('PATCH', f'/api/v1/meetings/{created.json()["id"]}', {'project_id': self.project.id})
        self.assertEqual((patched.status_code, patched.json()['code']), (403, 'feature_not_included'), patched.text)
        without = self.api('POST', '/api/v1/meetings', {'name': 'No project', 'meeting_date': '2026-11-20'})
        self.assertEqual(without.status_code, 201, without.text)
