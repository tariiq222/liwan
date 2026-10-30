# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_tasks.tests.routes_common import BASE, TasksRoutesCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestMyTasksFeatureGate(TasksRoutesCase):
    def close_feature(self, retain_reads=False):
        profile = self.env.ref('liwan_platform.tenant_profile')
        retained = [key for key in (profile.retained_read_features or []) if key != 'tasks.enabled']
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'tasks.enabled': False},
            'retained_read_features': [*retained, 'tasks.enabled'] if retain_reads else retained,
        })

    def test_feature_gate_403_when_disabled(self):
        created = self.ok('tasks_alice', 'POST', BASE, {'name': 'Before'})
        path = f'{BASE}/{created["id"]}'
        self.close_feature()
        for method, target, body in (
            ('GET', BASE, None),
            ('GET', f'{BASE}/summary', None),
            ('POST', BASE, {'name': 'After'}),
            ('GET', path, None),
            ('PATCH', path, {'name': 'x'}),
            ('POST', f'{path}/done', None),
            ('POST', f'{path}/reopen', None),
            ('POST', f'{path}/cancel', None),
        ):
            with self.subTest(method=method, path=target):
                status, payload = self.call('tasks_alice', method, target, body)
                self.assertEqual(status, 403, payload)
                self.assertEqual(payload['code'], 'feature_not_included')
                self.assertEqual(payload['details'], {'reason': 'feature', 'feature': 'tasks.enabled'})
        self.assertEqual(self.env['project.task'].browse(created['id']).name, 'Before')

    def test_retained_reads_stay_open_but_writes_close(self):
        created = self.ok('tasks_alice', 'POST', BASE, {'name': 'Kept'})
        self.close_feature(retain_reads=True)
        self.assertEqual(self.call('tasks_alice', 'GET', BASE)[0], 200)
        self.assertEqual(self.call('tasks_alice', 'GET', f'{BASE}/{created["id"]}')[0], 200)
        status, payload = self.call('tasks_alice', 'POST', BASE, {'name': 'x'})
        self.assertEqual((status, payload['code']), (403, 'feature_not_included'))
        status, payload = self.call('tasks_alice', 'POST', f'{BASE}/{created["id"]}/done')
        self.assertEqual((status, payload['code']), (403, 'feature_not_included'))
