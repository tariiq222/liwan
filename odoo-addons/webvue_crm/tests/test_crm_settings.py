# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import WebVueCrmCase

URL = '/api/v1/crm/settings'
TERMS_URL = '/api/v1/crm/terms'
CUSTOMER_TERM = {
    'ar': {'singular': 'مستفيد', 'plural': 'مستفيدون'},
    'en': {'singular': 'client', 'plural': 'clients'},
    'gender': 'm',
}


@tagged('post_install', '-at_install', 'webvue')
class TestCrmSettings(WebVueCrmCase):

    def _rows(self, company=None):
        return self.env['webvue.crm.settings'].search([('company_id', '=', (company or self.company).id)])

    def test_get_without_row_returns_defaults_at_revision_zero_and_writes_nothing(self):
        body = self.as_manager().api('GET', URL).json()
        self.assertEqual(body['revision'], 0)
        values = body['values']
        self.assertEqual(values['followup_attempts'], 2)
        self.assertEqual(values['followup_interval_hours'], 24)
        self.assertEqual(values['after_attempts'], 'lost')
        self.assertTrue(values['recycle_enabled'])
        self.assertEqual(values['recycle_after_days'], 30)
        self.assertEqual(values['recycle_cycles'], 1)
        self.assertEqual(values['distribution_mode'], 'round_robin')
        self.assertEqual(values['distribution_user_ids'], [])
        self.assertEqual(values['visibility'], 'own')
        self.assertFalse(values['view_log_enabled'])
        self.assertFalse(values['discount_allowed'])
        self.assertEqual(values['discount_max_percent'], 0)
        self.assertEqual(values['preset'], 'general')
        self.assertEqual(values['terms']['customer'], {
            'ar': {'singular': 'عميل', 'plural': 'عملاء'},
            'en': {'singular': 'customer', 'plural': 'customers'},
            'gender': 'm',
        })
        self.assertEqual(values['terms']['opportunity']['ar'], {'singular': 'فرصة', 'plural': 'فرص'})
        self.assertEqual(values['terms']['opportunity']['gender'], 'f')
        self.assertEqual(values['terms']['package']['en'], {'singular': 'package', 'plural': 'packages'})
        self.assertEqual(values['terms']['package']['gender'], 'f')
        self.assertFalse(self._rows())

    def test_options_describe_every_enum_and_range(self):
        options = self.as_manager().api('GET', URL).json()['options']
        self.assertEqual(options['preset'], ['general', 'phone_packages'])
        self.assertEqual(options['after_attempts'], ['lost', 'manager'])
        self.assertEqual(options['distribution_mode'], ['round_robin', 'manual', 'on_import'])
        self.assertEqual(options['visibility'], ['own', 'team', 'all'])
        self.assertEqual(options['term_gender'], ['m', 'f'])
        self.assertEqual(options['followup_attempts'], {'min': 0, 'max': 10})
        self.assertEqual(options['followup_interval_hours'], {'min': 1, 'max': 720})
        self.assertEqual(options['recycle_after_days'], {'min': 1, 'max': 365})
        self.assertEqual(options['recycle_cycles'], {'min': 0, 'max': 5})
        self.assertEqual(options['discount_max_percent'], {'min': 0, 'max': 100})

    def test_agent_can_neither_read_nor_patch(self):
        self.as_agent()
        self.assertEqual(self.api('GET', URL).status_code, 403)
        response = self.api('PATCH', URL, {'revision': 0, 'values': {'visibility': 'all'}})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self._rows())

    def test_terms_route_serves_agents_the_current_words_and_nothing_else(self):
        self.as_agent()
        body = self.api('GET', TERMS_URL).json()
        self.assertEqual(set(body), {'customer', 'opportunity', 'package'})
        self.assertEqual(body['customer']['ar'], {'singular': 'عميل', 'plural': 'عملاء'})
        self.as_manager()
        self.api('PATCH', URL, {'revision': 0, 'values': {'terms': {'customer': CUSTOMER_TERM}}})
        self.as_agent()
        self.assertEqual(self.api('GET', TERMS_URL).json()['customer'], CUSTOMER_TERM)

    def test_terms_route_needs_read_access(self):
        self.as_user(self.outsider)
        self.assertEqual(self.api('GET', TERMS_URL).status_code, 403)

    def test_patch_creates_the_row_and_bumps_revision(self):
        response = self.as_manager().api('PATCH', URL, {
            'revision': 0, 'values': {'visibility': 'team', 'followup_attempts': 4},
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['revision'], 1)
        self.assertEqual(body['values']['visibility'], 'team')
        self.assertEqual(body['values']['followup_attempts'], 4)
        self.assertEqual(body['values']['followup_interval_hours'], 24)
        again = self.api('PATCH', URL, {'revision': 1, 'values': {'view_log_enabled': True}}).json()
        self.assertEqual(again['revision'], 2)
        self.assertEqual(again['values']['visibility'], 'team')
        self.assertTrue(self.api('GET', URL).json()['values']['view_log_enabled'])

    def test_patch_with_stale_revision_is_409(self):
        self.as_manager()
        first = self.api('PATCH', URL, {'revision': 0, 'values': {'visibility': 'all'}})
        self.assertEqual(first.status_code, 200, first.text)
        stale = self.api('PATCH', URL, {'revision': 0, 'values': {'visibility': 'team'}})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['code'], 'conflict')
        self.assertEqual(self._rows().visibility, 'all')

    def test_out_of_range_value_is_422(self):
        self.as_manager()
        for field, value in (
            ('followup_attempts', 11), ('followup_attempts', -1), ('followup_interval_hours', 0),
            ('followup_interval_hours', 721), ('recycle_after_days', 366), ('recycle_cycles', 6),
            ('discount_max_percent', 101),
        ):
            response = self.api('PATCH', URL, {'revision': 0, 'values': {field: value}})
            self.assertEqual(response.status_code, 422, (field, value))
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], field)
        self.assertFalse(self._rows())

    def test_wrong_types_unknown_and_internal_fields_are_422(self):
        self.as_manager()
        for field, value in (
            ('followup_attempts', '3'), ('followup_attempts', True), ('recycle_enabled', 1),
            ('visibility', 'everyone'), ('distribution_mode', 'random'), ('after_attempts', 'x'),
            ('preset', 'general'), ('company_id', 1), ('revision', 1),
        ):
            response = self.api('PATCH', URL, {'revision': 0, 'values': {field: value}})
            self.assertEqual(response.status_code, 422, (field, value))
        self.assertFalse(self._rows())

    def test_patch_shape_errors_are_422(self):
        self.as_manager()
        for body in (
            {'values': {'visibility': 'all'}},
            {'revision': 0},
            {'revision': -1, 'values': {'visibility': 'all'}},
            {'revision': 0, 'values': {}},
            {'revision': 0, 'values': {'visibility': 'all'}, 'preset': 'general'},
            {'revision': 0, 'preset': 'unknown'},
        ):
            self.assertEqual(self.api('PATCH', URL, body).status_code, 422, body)

    def test_terms_are_patched_partially_in_both_languages(self):
        self.as_manager()
        body = self.api('PATCH', URL, {'revision': 0, 'values': {'terms': {'customer': CUSTOMER_TERM}}}).json()
        terms = body['values']['terms']
        self.assertEqual(terms['customer'], CUSTOMER_TERM)
        self.assertEqual(terms['opportunity']['ar'], {'singular': 'فرصة', 'plural': 'فرص'})
        partial = {'revision': 1, 'values': {'terms': {'package': {'en': {'plural': 'plans'}}}}}
        terms = self.api('PATCH', URL, partial).json()['values']['terms']
        self.assertEqual(terms['package']['en'], {'singular': 'package', 'plural': 'plans'})
        self.assertEqual(terms['customer'], CUSTOMER_TERM)

    def test_invalid_terms_are_422(self):
        self.as_manager()
        for terms in (
            {'lead': CUSTOMER_TERM},
            {'customer': {'fr': {'singular': 'x'}}},
            {'customer': {'gender': 'n'}},
            {'customer': {'ar': {'singular': '  '}}},
            {'customer': {'ar': {'singular': 'x' * 61}}},
            {'customer': {'ar': {'title': 'x'}}},
            {'customer': 'x'},
        ):
            response = self.api('PATCH', URL, {'revision': 0, 'values': {'terms': terms}})
            self.assertEqual(response.status_code, 422, terms)
            self.assertEqual(response.json()['field'], 'terms')
        self.assertFalse(self._rows())

    def test_distribution_users_round_trip_and_reject_unknown_users(self):
        self.as_manager()
        ids = [self.agent.id, self.agent2.id]
        body = self.api('PATCH', URL, {'revision': 0, 'values': {'distribution_user_ids': ids}}).json()
        self.assertEqual(sorted(body['values']['distribution_user_ids']), sorted(ids))
        cleared = self.api('PATCH', URL, {'revision': 1, 'values': {'distribution_user_ids': []}}).json()
        self.assertEqual(cleared['values']['distribution_user_ids'], [])
        for bad in ([999999999], 'x', [True], [self.agent.id, self.agent.id + 10**6]):
            response = self.api('PATCH', URL, {'revision': 2, 'values': {'distribution_user_ids': bad}})
            self.assertEqual(response.status_code, 422, bad)
            self.assertEqual(response.json()['field'], 'distribution_user_ids')

    def test_preset_phone_packages_sets_its_values(self):
        self.as_manager()
        self.api('PATCH', URL, {'revision': 0, 'values': {
            'followup_attempts': 7, 'visibility': 'all', 'distribution_mode': 'manual',
            'discount_allowed': True, 'discount_max_percent': 40,
        }})
        response = self.api('PATCH', URL, {'revision': 1, 'preset': 'phone_packages'})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['revision'], 2)
        values = body['values']
        self.assertEqual(values['preset'], 'phone_packages')
        self.assertEqual(values['followup_attempts'], 2)
        self.assertEqual(values['distribution_mode'], 'round_robin')
        self.assertEqual(values['visibility'], 'own')
        self.assertFalse(values['discount_allowed'])
        self.assertEqual(values['discount_max_percent'], 0)

    def test_preset_general_turns_followup_off_and_distribution_manual(self):
        body = self.as_manager().api('PATCH', URL, {'revision': 0, 'preset': 'general'}).json()
        self.assertEqual(body['revision'], 1)
        self.assertEqual(body['values']['preset'], 'general')
        self.assertEqual(body['values']['followup_attempts'], 0)
        self.assertEqual(body['values']['distribution_mode'], 'manual')

    def test_preset_keeps_terms_and_distribution_users(self):
        self.as_manager()
        self.api('PATCH', URL, {'revision': 0, 'values': {
            'terms': {'customer': CUSTOMER_TERM}, 'distribution_user_ids': [self.agent.id],
        }})
        values = self.api('PATCH', URL, {'revision': 1, 'preset': 'phone_packages'}).json()['values']
        self.assertEqual(values['terms']['customer'], CUSTOMER_TERM)
        self.assertEqual(values['distribution_user_ids'], [self.agent.id])

    def test_effective_never_writes_and_the_row_holds_no_rotation_cursor(self):
        Settings = self.env['webvue.crm.settings']
        self.assertFalse(Settings._webvue_current())
        effective = Settings._webvue_effective()
        self.assertEqual(effective['followup_attempts'], 2)
        self.assertEqual(effective['distribution_user_ids'], [])
        self.assertFalse(self._rows())
        row = Settings.create({'company_id': self.company.id, 'visibility': 'all'})
        self.assertEqual(Settings._webvue_current(), row)
        self.assertEqual(Settings._webvue_effective()['visibility'], 'all')
        self.assertNotIn('round_robin_index', Settings._fields)
        self.assertNotIn('round_robin_index', Settings._webvue_effective())

    def test_other_company_row_is_untouched(self):
        other = self.env['webvue.crm.settings'].create({
            'company_id': self.other_company.id, 'visibility': 'all', 'followup_attempts': 9,
        })
        body = self.as_manager().api('GET', URL).json()
        self.assertEqual(body['revision'], 0)
        self.assertEqual(body['values']['visibility'], 'own')
        response = self.api('PATCH', URL, {'revision': 0, 'values': {'visibility': 'team'}})
        self.assertEqual(response.status_code, 200, response.text)
        other.invalidate_recordset()
        self.assertEqual(other.visibility, 'all')
        self.assertEqual(other.followup_attempts, 9)
        self.assertEqual(other.revision, 1)
        self.assertEqual(self._rows().visibility, 'team')

    def test_one_row_per_company(self):
        self.env['webvue.crm.settings'].create({'company_id': self.company.id})
        with self.assertRaises(UniqueViolation), mute_logger('odoo.sql_db'), self.cr.savepoint():
            self.env['webvue.crm.settings'].create({'company_id': self.company.id})
