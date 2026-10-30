# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan', 'liwan_maintenance')
class TestMaintenanceApi(LiwanApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env['liwan.entitlement.service']._liwan_profile().root_company_id
        cls.manager = new_test_user(cls.env, login='maintenance_api_mgr', password='maintenance_pass_123', groups='liwan_core.group_customer_admin,liwan_platform.group_maintenance_manager', company_id=cls.company.id)
        cls.release = cls.env['liwan.maintenance.release'].with_context(**{OPERATOR_CONTEXT: True}).create({
            'company_id': cls.company.id, 'release_id': 'api-release-1',
            'deadline_at': fields.Datetime.now() + timedelta(days=30),
            'estimated_seconds': 120, 'scope': 'tenant', 'policy': 'Deadline set by the operator.',
        })

    def login_manager(self):
        self.authenticate(self.manager.login, 'maintenance_pass_123')

    def test_employee_cannot_read_or_change_maintenance(self):
        self.authenticate(self.employee.login, 'api_emp_pass_123')
        for method, path, payload in [
            ('GET', '/api/v1/admin/maintenance', None),
            ('PATCH', '/api/v1/admin/maintenance/preference', {'revision': 0}),
            ('POST', '/api/v1/admin/maintenance/bookings', {'releaseId': self.release.id}),
        ]:
            response = self.api(method, path, json=payload)
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual(response.json()['code'], 'forbidden')

    def test_preference_roundtrip_and_stale_revision(self):
        self.login_manager()
        payload = {'timezone': 'Asia/Riyadh', 'weekday': 4, 'startMinute': 120, 'durationMinutes': 60, 'revision': 0}
        response = self.api('PATCH', '/api/v1/admin/maintenance/preference', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['revision'], 1)
        stale = self.api('PATCH', '/api/v1/admin/maintenance/preference', json=payload)
        self.assertEqual(stale.status_code, 409, stale.text)
        body = self.api('GET', '/api/v1/admin/maintenance').json()
        self.assertEqual(body['preference']['timezone'], 'Asia/Riyadh')
        self.assertIn('items', body['releases'])
        self.assertEqual(body['releases']['items'][0]['releaseId'], 'api-release-1')
        self.assertNotIn('company_id', body['releases']['items'][0])

    def test_current_notice_remains_bookable_after_more_than_200_historical_notices(self):
        Release = self.env['liwan.maintenance.release'].with_context(**{OPERATOR_CONTEXT: True})
        previous = Release.create({
            'company_id': self.company.id, 'release_id': 'previous-booked-release',
            'deadline_at': fields.Datetime.now() + timedelta(days=31),
            'estimated_seconds': 120, 'policy': 'Previously booked update.',
        })
        booking = self.env['liwan.maintenance.booking'].with_user(self.manager)._liwan_schedule({
            'release_id': previous.id, 'scheduled_at': fields.Datetime.now() + timedelta(days=2),
            'timezone': 'UTC', 'duration_minutes': 60,
        })
        booking._liwan_update({'status': 'cancelled'}, booking.revision)
        previous.write({'status': 'withdrawn', 'deadline_at': fields.Datetime.now() - timedelta(days=365)})
        Release.create([{
            'company_id': self.company.id, 'release_id': 'historical-release-%s' % index,
            'deadline_at': fields.Datetime.now() - timedelta(days=index + 1),
            'estimated_seconds': 120, 'status': 'withdrawn' if index % 2 else 'supported',
            'policy': 'Historical update.',
        } for index in range(201)])

        self.login_manager()
        response = self.api('GET', '/api/v1/admin/maintenance')
        self.assertEqual(response.status_code, 200, response.text)
        snapshot = response.json()
        notices = snapshot['releases']['items']
        self.assertIn(self.release.id, [notice['id'] for notice in notices])
        self.assertEqual(notices[0]['id'], self.release.id)
        self.assertIn(previous.id, [notice['id'] for notice in notices])
        self.assertEqual(len(notices), 200)
        self.assertEqual(snapshot['releases']['total'], 203)
        self.assertEqual(snapshot['bookings']['items'][0]['releaseId'], previous.id)
        response = self.api('POST', '/api/v1/admin/maintenance/bookings', json={
            'releaseId': notices[0]['id'],
            'localDateTime': (fields.Datetime.now() + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M'),
            'timezone': 'UTC', 'durationMinutes': 60,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['releaseId'], self.release.id)

    def test_maintenance_snapshot_rejects_a_manager_outside_the_root_company(self):
        company = self.env['res.company'].create({'name': 'Another maintenance company'})
        manager = new_test_user(
            self.env, login='maintenance_other_company', password='maintenance_other_pass_123',
            groups='liwan_core.group_customer_admin,liwan_platform.group_maintenance_manager',
            company_id=company.id,
        )
        self.authenticate(manager.login, 'maintenance_other_pass_123')
        response = self.api('GET', '/api/v1/admin/maintenance')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'forbidden')

    def test_booking_cancel_and_whitelist(self):
        self.login_manager()
        payload = {'releaseId': self.release.id, 'localDateTime': (fields.Datetime.now() + timedelta(days=1)).strftime('%Y-%m-%dT%H:%M'), 'timezone': 'UTC', 'durationMinutes': 60}
        response = self.api('POST', '/api/v1/admin/maintenance/bookings', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        booking = response.json()
        self.assertEqual(booking['status'], 'scheduled')
        path = '/api/v1/admin/maintenance/bookings/%s' % booking['id']
        invalid = self.api('PATCH', path, json={'revision': 1, 'status': 'complete'})
        self.assertEqual(invalid.status_code, 422, invalid.text)
        cancelled = self.api('PATCH', path, json={'revision': 1, 'status': 'cancelled'})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()['revision'], 2)
        stale = self.api('PATCH', path, json={'revision': 1, 'status': 'cancelled'})
        self.assertEqual(stale.status_code, 409, stale.text)

    def test_bad_timezone_unknown_release_dst_and_unknown_fields(self):
        self.login_manager()
        payload = {'releaseId': self.release.id, 'localDateTime': '2030-10-27T01:30', 'timezone': 'Europe/London', 'durationMinutes': 60}
        for patch in [{}, {'timezone': 'Invalid/Zone'}, {'companyId': 2}, {'status': 'complete'}]:
            response = self.api('POST', '/api/v1/admin/maintenance/bookings', json={**payload, **patch})
            self.assertEqual(response.status_code, 422, response.text)
        response = self.api('POST', '/api/v1/admin/maintenance/bookings', json={**payload, 'localDateTime': '2030-01-01T00:00', 'releaseId': 2147483647})
        self.assertEqual(response.status_code, 404, response.text)
