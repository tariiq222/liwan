# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest
from datetime import datetime, timedelta, timezone

from psycopg2.extras import Json

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_core.models.access_service import CAPABILITIES, WebVueAccessRule
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestEntitlements(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.env['webvue.tenant.profile'].sudo()
        cls.service = cls.env['webvue.entitlement.service'].sudo()
        cls.features = cls.env['webvue.feature.registry']
        cls.record = cls.env.ref('webvue_platform.tenant_profile')
        cls.record._webvue_initialize_legacy_policy(
            cls.features._webvue_installed_module_ids(),
        )
        cls.employee = new_test_user(
            cls.env, login='entitlement_emp', groups='webvue_core.group_employee',
        )

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    # Fixed per-app literals; the installed apps come from ir.module.module,
    # never from the registry under test.
    APP_BOOLEANS = {
        'webvue_pmo': {'pmo.enabled'},
        'webvue_meetings': {'meetings.enabled'},
        'webvue_hr': {'hr.enabled'},
        'webvue_chat': {'chat.enabled'},
    }

    def _release_boolean_keys(self):
        return set().union(*self.APP_BOOLEANS.values())

    # Owners of today's capabilities; an application added later owns more.
    RELEASE_CAPABILITY_OWNERS = {'webvue_core', 'webvue_hr', 'webvue_pmo', 'webvue_meetings'}

    def _installed_apps(self):
        return {
            module.name for module in self.env['ir.module.module'].sudo().search([
                ('name', 'in', list(self.APP_BOOLEANS)), ('state', '=', 'installed'),
            ])
        }

    def _require_app(self, app):
        if app not in self._installed_apps():
            raise unittest.SkipTest(f'needs {app} installed')

    def _installed_boolean_keys(self):
        keys = set()
        for app in self._installed_apps():
            keys |= self.APP_BOOLEANS[app]
        return keys

    def _readable_key(self):
        # A boolean of an installed application: pmo.enabled first, as before.
        for app in ('webvue_pmo', 'webvue_hr', 'webvue_meetings', 'webvue_chat'):
            if app in self._installed_apps():
                return sorted(self.APP_BOOLEANS[app])[0]
        reason = 'needs an application installed'
        raise unittest.SkipTest(reason)

    def test_legacy_initializer_grants_installed_pillars_once(self):
        self.assertGreaterEqual(self.record.policy_revision, 1)
        self.assertEqual(self.record.status, 'active')
        self.assertFalse(self.record.valid_until)
        flags = self._installed_boolean_keys()
        for key in flags:
            self.assertTrue(self.record.features[key])
        self.assertIsNone(self.record.features['users.limit'])
        if 'webvue_pmo' in self._installed_apps():
            self.assertIsNone(self.record.features['projects.max_projects'])
        self.assertIsNone(self.record.features['storage.limit_mb'])
        # An application added later is granted too: its keys are extra.
        retained = set(self.record.retained_read_features)
        self.assertEqual(retained & self._release_boolean_keys(), flags)
        self.assertTrue(all(key.endswith('.enabled') for key in retained - flags))
        if self._installed_apps() == set(self.APP_BOOLEANS):
            self.assertEqual(retained & self._release_boolean_keys(), {
                'pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled',
            })
        first_revision = self.record.policy_revision
        self.record._webvue_initialize_legacy_policy(('webvue_pmo',))
        self.assertEqual(self.record.policy_revision, first_revision)
        if 'webvue_hr' in self._installed_apps():
            self.assertTrue(self.record.features['hr.enabled'])

    def test_legacy_missing_branch_preserves_feature_keys_and_input(self):
        legacy = {key: value for key, value in self.record.features.items()
                  if key != 'branches.extra_limit'}
        original = dict(legacy)
        cached = dict(self.record.features)
        cleaned = self.service._webvue_validate_features(legacy)
        self.assertEqual(cleaned, original)
        self.assertEqual(legacy, original)
        self.assertEqual(self.record.features, cached)
        self._operator().write({'features': legacy})
        self.record.invalidate_recordset(['features'])
        self.assertEqual(self.record.features, original)
        for key in ('users.limit', 'storage.limit_mb', self._readable_key()):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                self.service._webvue_validate_features({k: v for k, v in legacy.items() if k != key})

    def test_branch_limit_values_remain_strict(self):
        for value in (True, False, 0.0, -1):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.service._webvue_validate_features({**self.record.features, 'branches.extra_limit': value})
        for value in (None, 0, 1):
            self.assertEqual(self.service._webvue_validate_features(
                {**self.record.features, 'branches.extra_limit': value},
            )['branches.extra_limit'], value)

    def test_customer_cannot_write_policy_fields(self):
        with self.assertRaises(AccessError):
            self.record.with_user(self.employee).write({'status': 'suspended'})
        with self.assertRaises(AccessError):
            self.record.write({'features': dict(self.record.features)})

    def test_unknown_and_invalid_feature_types_are_rejected(self):
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'unknown.enabled': True}})
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, self._readable_key(): 1}})
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'users.limit': -1}})
        with self.assertRaises(ValidationError):
            self._operator().write({'features': {**self.record.features, 'users.limit': True}})

    def test_withdrawn_feature_keeps_retained_read(self):
        self._require_app('webvue_meetings')
        self._operator().write({
            'features': {**self.record.features, 'meetings.enabled': False},
        })
        self.assertFalse(self.service.get('meetings.enabled'))
        self.assertIn('meetings.enabled', self.record.retained_read_features)
        self.service.require_read('meetings.enabled')
        with self.assertRaises(WebVueAccessRule) as error:
            self.service.require('meetings.enabled')
        self.assertEqual(error.exception.code, 'feature_not_included')
        self.assertEqual(error.exception.status, 403)

    def test_never_entitled_feature_is_not_readable(self):
        self._require_app('webvue_chat')
        self._operator().write({
            'features': {**self.record.features, 'chat.enabled': False},
            'retained_read_features': [
                key for key in self.record.retained_read_features if key != 'chat.enabled'
            ],
        })
        with self.assertRaises(WebVueAccessRule):
            self.service.require_read('chat.enabled')

    def test_expiry_clears_writes_but_keeps_reads(self):
        expiry = {'valid_until': datetime.now(timezone.utc).date() - timedelta(days=1)}
        if self.record.commercial_mode == 'non_saas':
            with self.assertRaises(ValidationError):
                self._operator().write(expiry)
            self.assertFalse(self.record.valid_until)
            self.assertEqual(self.service._webvue_effective_state(), 'active')
            self.service.require(self._readable_key())
            return
        self._operator().write(expiry)
        self.assertEqual(self.service._webvue_effective_state(), 'expired')
        key = self._readable_key()
        self.service.require_read(key)
        with self.assertRaises(WebVueAccessRule) as error:
            self.service.require(key)
        self.assertEqual(error.exception.code, 'tenant_read_only')

    def test_xmlid_is_repaired_when_profile_row_survives(self):
        self.env['ir.model.data'].search([
            ('module', '=', 'webvue_platform'), ('name', '=', 'tenant_profile'),
        ]).unlink()
        repaired = self.profile._webvue_ensure_root_company()
        self.assertEqual(repaired, self.record)
        self.assertEqual(self.env.ref('webvue_platform.tenant_profile'), self.record)

    def test_registry_exposes_owned_keys_and_baseline_capabilities(self):
        apps = self._installed_apps()
        # Today's applications are exact; an application added later only adds
        # keys, and every key it adds belongs to an installed module.
        installed_modules = set(self.features._webvue_installed_module_ids())
        release = set(self.APP_BOOLEANS)
        module_map = set(self.features._webvue_module_map())
        self.assertEqual(module_map & release, apps)
        self.assertLessEqual(module_map, installed_modules | release)
        booleans = set(self.features._webvue_boolean_keys())
        self.assertEqual(booleans & self._release_boolean_keys(), self._installed_boolean_keys())
        self.assertTrue(all(key.endswith('.enabled') for key in booleans))
        limits = {'users.limit', 'storage.limit_mb', 'branches.extra_limit'}
        if 'webvue_pmo' in apps:
            limits.add('projects.max_projects')
        actual_limits = set(self.features._webvue_limit_keys())
        self.assertLessEqual(limits, actual_limits)
        if module_map <= release:
            self.assertEqual(actual_limits, limits)
        capability_map = self.env['webvue.access.service']._webvue_capability_map()
        self.assertTrue(set(capability_map) >= CAPABILITIES)
        release_map = {
            key: value for key, value in capability_map.items()
            if value['owner'] in self.RELEASE_CAPABILITY_OWNERS
        }
        # Capabilities may belong to foundations/shared services, not only
        # application modules in the feature registry's module map.
        installed_owners = set(self.env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))
        for key, value in capability_map.items():
            self.assertTrue(value['owner'], key)
            if key not in release_map:
                self.assertIn(value['owner'], installed_owners, key)
        self.assertEqual(capability_map['settings.maintenance.manage']['owner'], 'webvue_platform')
        # 9 core capabilities, plus 12 for HR, 8 for PMO and 3 for meetings (32 in all).
        expected = 9 + 12 * ('webvue_hr' in apps) + 8 * ('webvue_pmo' in apps) + 3 * ('webvue_meetings' in apps)
        self.assertEqual(len(release_map), expected)
        if apps == set(self.APP_BOOLEANS):
            self.assertEqual(len(release_map), 32)
        self.assertNotIn('probe.inspect', capability_map)
        self.assertNotIn('probe.enabled', self.features._webvue_feature_map())

    def test_limit_null_is_unlimited_and_zero_is_closed(self):
        self.service.require_within_limit('users.limit', 1000)
        self._operator().write({'features': {**self.record.features, 'users.limit': 0}})
        with self.assertRaises(WebVueAccessRule) as error:
            self.service.require_within_limit('users.limit', 1)
        self.assertEqual(error.exception.details['reason'], 'limit')

    def _grow_registry(self, *extra):
        registry = type(self.features)
        definitions = registry._webvue_feature_definitions
        self.patch(registry, '_webvue_feature_definitions', lambda model: (*definitions(model), *extra))

    def test_closing_unlisted_keys_adds_only_closed_values_of_installed_apps(self):
        installed = self.features._webvue_installed_module_ids()
        if not installed:
            self.skipTest('needs an installed application')
        app = installed[0]
        self._grow_registry(
            {'key': 'zz_probe.enabled', 'type': 'boolean', 'owner': app, 'module': app},
            {'key': 'zz_probe.max_items', 'type': 'limit', 'owner': app, 'module': app},
            {'key': 'zz_probe.listed', 'type': 'limit', 'owner': app, 'module': app},
            {'key': 'zz_gone.enabled', 'type': 'boolean', 'owner': 'zz_not_installed', 'module': 'zz_not_installed'},
            {'key': 'zz_gone.max_items', 'type': 'limit', 'owner': 'zz_not_installed', 'module': 'zz_not_installed'},
        )
        given = {'users.limit': None, 'zz_probe.listed': 9}
        completed = self.service._webvue_close_unlisted_features(given)
        self.assertIs(completed['zz_probe.enabled'], False)
        self.assertEqual(completed['zz_probe.max_items'], 0)
        self.assertIs(type(completed['zz_probe.max_items']), int)
        self.assertEqual(completed['zz_probe.listed'], 9)  # a listed limit passes through
        self.assertIsNone(completed['users.limit'])
        self.assertNotIn('zz_gone.enabled', completed)  # an uninstalled app stays absent
        self.assertNotIn('zz_gone.max_items', completed)
        self.assertEqual(given, {'users.limit': None, 'zz_probe.listed': 9})
        # Every added key is a closed value: nothing is granted.
        for key in set(completed) - set(given):
            self.assertTrue(completed[key] is False or (type(completed[key]) is int and completed[key] == 0), key)

    def test_a_registered_limit_missing_from_the_payload_counts_as_zero(self):
        installed = self.features._webvue_installed_module_ids()
        if not installed:
            self.skipTest('needs an installed application')
        app = installed[0]
        self._grow_registry(
            {'key': 'zz_probe.max_items', 'type': 'limit', 'owner': app, 'module': app},
            {'key': 'zz_gone.max_items', 'type': 'limit', 'owner': 'zz_not_installed', 'module': 'zz_not_installed'},
        )
        self.assertNotIn('zz_probe.max_items', self.record.features)
        self.service.require_within_limit('zz_probe.max_items', 0)
        with self.assertRaises(WebVueAccessRule) as error:
            self.service.require_within_limit('zz_probe.max_items', 1)
        self.assertEqual(error.exception.details['limit_key'], 'zz_probe.max_items')
        # An uninstalled owner keeps the old behaviour: absent means no stored limit.
        self.service.require_within_limit('zz_gone.max_items', 1000)
        # A key that is not registered is still refused as before.
        with self.assertRaises(WebVueAccessRule) as error:
            self.service.require_within_limit('zz_unregistered.max_items', 0)
        self.assertEqual(error.exception.details['reason'], 'limit')
        # An explicit null stays unlimited.
        self._operator().write({'features': {**self.record.features, 'zz_probe.max_items': None}})
        self.service.require_within_limit('zz_probe.max_items', 1000)

    def test_a_missing_platform_limit_keeps_its_legacy_unlimited_meaning(self):
        features = dict(self.record.features)
        del features['storage.limit_mb']
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE webvue_tenant_profile SET features = %s WHERE id = %s',
            [Json(features), self.record.id],
        )
        self.record.invalidate_recordset()
        self.assertTrue(self.service._webvue_claim_storage(1))

    def _admin_role_probe(self):
        registry = self.features._webvue_feature_map()
        if 'pmo.enabled' not in registry or 'pmo_manager' not in self.env['webvue.access.service']._webvue_legacy_admin_roles():
            self.skipTest('needs webvue_pmo installed')
        closed = self.service._webvue_close_unlisted_features(
            {k: v for k, v in self.record.features.items() if k in ('users.limit', 'storage.limit_mb', 'branches.extra_limit')},
        )
        self._operator().write({'features': closed})
        before = self.service._webvue_entitled_admin_roles()
        self.assertNotIn('pmo_manager', before)
        self._operator().write({'features': {**closed, 'pmo.enabled': True}})
        return before

    def _assigned(self, user):
        return set(self.env['webvue.access.assignment'].search([
            ('user_id', '=', user.id), ('company_id', '=', self.record.root_company_id.id),
        ]).mapped('role_id.key'))

    def test_newly_opened_roles_go_to_the_enrolment_admin_only(self):
        before = self._admin_role_probe()
        other = new_test_user(self.env, login='other_internal', groups='webvue_core.group_employee')
        admin = new_test_user(self.env, login='enrolment_admin', groups='webvue_core.group_employee')
        granted = self._operator()._webvue_grant_opened_admin_roles('enrolment_admin', before)
        self.assertIn('pmo_manager', granted)
        self.assertIn('pmo_manager', self._assigned(admin))
        self.assertNotIn('pmo_manager', self._assigned(other))
        self.assertTrue(set(granted).isdisjoint(before))  # roles already open are not re-granted
        # Replays are idempotent and nothing is revoked when the app closes again.
        self._operator()._webvue_grant_opened_admin_roles('enrolment_admin', before)
        self.assertEqual(
            self.env['webvue.access.assignment'].search_count([
                ('user_id', '=', admin.id), ('role_id.key', '=', 'pmo_manager'),
            ]), 1,
        )
        self._operator().write({'features': self.service._webvue_close_unlisted_features(
            {k: v for k, v in self.record.features.items() if k in ('users.limit', 'storage.limit_mb', 'branches.extra_limit')},
        )})
        self.assertEqual(self._operator()._webvue_grant_opened_admin_roles('enrolment_admin', before), [])
        self.assertIn('pmo_manager', self._assigned(admin))

    def test_no_login_or_unusable_login_grants_nothing(self):
        before = self._admin_role_probe()
        inactive = new_test_user(self.env, login='inactive_admin', groups='webvue_core.group_employee')
        inactive.active = False
        portal = new_test_user(self.env, login='portal_admin', groups='base.group_portal')
        with self.assertLogs('odoo.addons.webvue_platform.models.tenant_profile', level='INFO'):
            self.assertEqual(self._operator()._webvue_grant_opened_admin_roles(None, before), [])
        for login in ('inactive_admin', 'portal_admin', 'nobody_here'):
            self.assertEqual(self._operator()._webvue_grant_opened_admin_roles(login, before), [], login)
        self.assertNotIn('pmo_manager', self._assigned(inactive))
        self.assertNotIn('pmo_manager', self._assigned(portal))

    def test_granting_roles_needs_the_operator(self):
        with self.assertRaises(AccessError):
            self.record._webvue_grant_opened_admin_roles('enrolment_admin', [])
