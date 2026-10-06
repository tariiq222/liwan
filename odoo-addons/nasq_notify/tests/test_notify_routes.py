# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_api.tests.common import (
    PROBE_FEATURE,
    NasqApiCase,
    set_probe_feature,
)
from odoo.addons.nasq_notify.tests.common import NotifyProbe


@tagged('post_install', '-at_install', 'nasq')
class TestNotifyRoutes(NotifyProbe, NasqApiCase):

    def setUp(self):
        super().setUp()
        self.nora = new_test_user(
            self.env, login='notify_nora', password='notify_nora_pass_123', name='Nora',
            groups='nasq_core.group_employee',
        )
        # Users first: creating one with project installed delivers a PMO
        # onboarding notification, a kind the probe registry hides.
        self._install_probe()
        self.source = self.env['res.partner'].create({'name': 'Route source'})

    def _deliver(self, partner):
        return self.env['nasq.notify.service']._nasq_deliver(
            'res.partner', self.source.id, 'probe_ping', partner, 'Route ping',
        ).notification_ids

    def test_bell_lists_and_marks_through_the_service(self):
        first = self._deliver(self.employee.partner_id)
        self._deliver(self.employee.partner_id)
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/notifications').json()
        self.assertEqual((body['total'], body['unread_count']), (2, 2))
        self.assertEqual({item['kind'] for item in body['items']}, {'probe_ping'})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{first.id}/read', {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{first.id}/read', {}).json(), {'updated': 0})
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 1})
        self.assertEqual(
            self.api('GET', '/api/v1/notifications?unread=true').json(),
            {'items': [], 'total': 0, 'unread_count': 0},
        )

    def test_another_recipients_row_is_404(self):
        row = self._deliver(self.nora.partner_id)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', f'/api/v1/notifications/{row.id}/read', {})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'not_found')

    def test_malformed_query_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for query, field in (('limit=wat', 'limit'), ('unread=maybe', 'unread'), ('unexpected=1', 'unexpected')):
            response = self.api('GET', f'/api/v1/notifications?{query}')
            self.assertEqual(response.status_code, 422, query)
            self.assertEqual(response.json()['code'], 'invalid', query)
            self.assertEqual(response.json()['field'], field, query)

    def test_the_bell_is_closed_when_no_application_registers_a_type(self):
        self.patch(type(self.env['nasq.notify.registry']), '_nasq_notification_types', lambda model: ())
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': None})

    def test_reads_follow_the_owner_feature(self):
        set_probe_feature(self, enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': PROBE_FEATURE})
