# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import (
    PROBE_FEATURE,
    WebVueApiCase,
    register_probe_feature,
    set_probe_feature,
)


@tagged('post_install', '-at_install', 'webvue')
class TestPeopleDirectory(WebVueApiCase):
    """/api/v1/people without any application: the gate is a probe feature for one test."""

    def setUp(self):
        super().setUp()
        self.patch(type(self.env['webvue.directory']), '_webvue_directory_feature_keys', lambda model: (PROBE_FEATURE,))
        register_probe_feature(self)
        set_probe_feature(self)

    def _user(self, login, groups='base.group_user', company=None, **values):
        company = company or self.env.company
        return new_test_user(
            self.env, login=login, name=values.pop('name', login), groups=groups,
            company_id=company.id, company_ids=[company.id], **values,
        )

    def test_the_directory_is_a_global_service(self):
        self.assertEqual(self.env['webvue.directory']._webvue_scope, 'global')

    def test_people_are_user_ids_even_when_an_employee_exists(self):
        if 'hr.employee' in self.env:
            self.env['hr.employee'].create({'name': 'Sara E', 'user_id': self.employee.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/people?q=sara').json()
        self.assertEqual(items, [{'id': self.employee.id, 'name': 'Sara', 'user_id': self.employee.id}])

    def test_bad_limit_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people?limit=abc')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'limit')

    def test_population_is_active_internal_users_of_the_current_company(self):
        kept = self._user('dir_kept', name='Dir kept')
        inactive = self._user('dir_inactive', name='Dir inactive')
        inactive.active = False
        portal = self._user('dir_portal', groups='base.group_portal', name='Dir portal')
        foreign = self._user('dir_foreign', company=self.env['res.company'].create({'name': 'Dir company B'}), name='Dir foreign')
        directory = self.env['webvue.directory']
        self.assertEqual(directory._webvue_people([kept.id, inactive.id, portal.id, foreign.id]), kept)
        self.assertEqual(directory._webvue_search_people('Dir ', limit=10), kept)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(
            self.api('GET', '/api/v1/people?q=Dir%20').json(),
            [{'id': kept.id, 'name': 'Dir kept', 'user_id': kept.id}],
        )

    def test_route_is_closed_without_a_registered_feature(self):
        self.patch(type(self.env['webvue.directory']), '_webvue_directory_feature_keys', lambda model: ())
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'feature_not_included')
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': None})

    def test_route_follows_the_registered_feature(self):
        set_probe_feature(self, enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/people')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': PROBE_FEATURE})

    def test_the_reported_key_does_not_follow_registration_order(self):
        second = 'zz_probe.enabled'
        register_probe_feature(self, second)
        # Write the new key first: every registered platform boolean must be present.
        set_probe_feature(self, second, enabled=False)
        set_probe_feature(self, enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        directory = type(self.env['webvue.directory'])
        for order in ((PROBE_FEATURE, second), (second, PROBE_FEATURE)):
            self.patch(directory, '_webvue_directory_feature_keys', lambda model, order=order: order)
            response = self.api('GET', '/api/v1/people')
            self.assertEqual(response.status_code, 403, order)
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': second}, order)
