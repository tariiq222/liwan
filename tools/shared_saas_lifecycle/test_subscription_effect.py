# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Unit tests (no Odoo, no Docker): fake runner replaces script execution."""
import ast
import inspect
import io
import json
import signal
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tools.shared_saas_lifecycle import subscription_effect as se
from tools.shared_saas_lifecycle.odoo_effect import EffectError

DB = 'liwan_scratch_' + 'a' * 32
OP = '11111111-1111-4111-8111-111111111111'
PREV = '22222222-2222-4222-8222-222222222222'
TARGET = '33333333-3333-4333-8333-333333333333'
OTHER = '44444444-4444-4444-8444-444444444444'
B1 = '55555555-5555-4555-8555-555555555555'
B2 = '66666666-6666-4666-8666-666666666666'
DIGEST = 'b' * 64


def make_request(**over):
    request = {
        'action': 'reconfigure', 'tenant': {'database': DB, 'host': 'acme.example.test'},
        'order_id': 'order-1', 'operation_id': OP, 'previous_revision_id': PREV,
        'target_revision_id': TARGET,
        'entitlement': {'modules': ['liwan_core', 'liwan_platform', 'liwan_api', 'liwan_pmo'],
                        'features': {'users.limit': 10, 'projects.max_projects': 5,
                                     'storage.limit_mb': 100, 'branches.extra_limit': 2},
                        'digest': DIGEST, 'compiler_version': 1},
        'branches': {'apply': [], 'archive': []},
    }
    request.update(over)
    return request


def observation(**over):
    value = {'database': DB, 'root_company_id': 1, 'status': 'active', 'commercial_revision_id': PREV, 'commercial_digest': 'c' * 64,
             'commercial_applied_at': None, 'commercial_valid_until': None, 'commercial_expiry_supported': True, 'commercial_valid_until_revision': 0, 'features': {'users.limit': 3},
             'modules': ['liwan_api', 'liwan_core', 'liwan_platform'], 'branches': [],
             'usage': {'users.limit': 1, 'projects.max_projects': 0, 'storage.limit_mb': 0, 'branches.extra_limit': 0},
             'limit_gates': {'users.limit': [], 'projects.max_projects': ['pmo.enabled'],
                             'storage.limit_mb': [], 'branches.extra_limit': []}}
    value.update(over)
    return value


LOWERABLE = {'users.limit': 20, 'projects.max_projects': 20, 'storage.limit_mb': 200}


def _script_values(script):
    line = next(item for item in script.splitlines() if item.startswith('values = json.loads('))
    payload = line.split('values = json.loads(', 1)[1].rstrip(')')
    return json.loads(ast.literal_eval(payload))


def wrap(value):
    return 'noise\n' + se.SENTINEL + json.dumps(value) + '\n'


class FakeRunner:
    """Serves observations in order; 'apply' scripts update a simulated state."""
    def __init__(self, state, *, exists=True, apply_state=None, crash_after_apply=False, apply_result=None):
        self.apply_result = apply_result or {'applied': True}
        self.state, self.exists, self.apply_state = state, exists, apply_state
        self.crash_after_apply = crash_after_apply
        self.scripts, self.installed, self.applies = [], [], 0

    def database_exists(self):
        return self.exists

    def install_modules(self, names):
        self.installed.append(list(names))

    def run_script(self, script, stage, mutate=False):
        self.scripts.append((stage, mutate, script))
        if stage == 'apply':
            self.applies += 1
            if self.apply_state is not None:
                self.state = self.apply_state
            if self.crash_after_apply:
                raise EffectError('runtime_timeout')
            return wrap(self.apply_result)
        return wrap(self.state)


def applied_state(request, **over):
    """Mirror what the real apply writes, so post-apply verify is exercised honestly."""
    ent = request['entitlement']
    branches = [{'branch_id': b['branch_id'], 'state': 'active', 'odoo_company_id': 7 + i,
                 'active': True, 'parent_is_root': True} for i, b in enumerate(request['branches']['apply'])]
    base = dict(commercial_valid_until=request.get('commercial_valid_until'),
                commercial_valid_until_revision=request.get('commercial_valid_until_revision', 0))
    if over.get('excess_supported') is True:
        base['excess_settled'] = True
    base.update(over)
    return observation(commercial_revision_id=TARGET, commercial_digest=ent['digest'],
                       features=dict(ent['features']), branches=branches,
                       modules=sorted(ent['modules']), **base)


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name).resolve() / 'journal'

    def effect(self, runner):
        return se.SubscriptionEffect(runner, self.dir, clock=lambda: '2026-01-01T00:00:00Z')


class ValidationTests(unittest.TestCase):
    def bad(self, **over):
        with self.assertRaises(EffectError):
            se.validate_reconfigure(make_request(**over))

    def test_valid(self):
        se.validate_reconfigure(make_request())

    def test_bad_database(self):
        for db in ('odoo19', 'liwan_scratch_x', DB + ';'):
            self.bad(tenant={'database': db, 'host': 'a.test'})

    def test_bad_digest_and_modules(self):
        ent = make_request()['entitlement']
        self.bad(entitlement={**ent, 'digest': 'z' * 64})
        self.bad(entitlement={**ent, 'digest': 'B' * 64})
        self.bad(entitlement={**ent, 'modules': ['liwan_core', 'sale']})
        self.bad(entitlement={**ent, 'features': {'users.limit': -1}})
        self.bad(entitlement={**ent, 'features': {'x': 'yes'}})

    def test_commercial_expiry_validation(self):
        se.validate_reconfigure(make_request(commercial_valid_until='2026-11-08'))
        se.validate_reconfigure(make_request(commercial_valid_until=None))
        self.bad(commercial_valid_until='08/11/2026')
        self.bad(commercial_valid_until=20261108)

    def test_branch_validation(self):
        self.bad(branches={'apply': [{'branch_id': B1, 'name': 'a'}, {'branch_id': B1, 'name': 'b'}], 'archive': []})
        self.bad(branches={'apply': [{'branch_id': B1, 'name': 'a'}], 'archive': [B1]})
        self.bad(branches={'apply': [{'branch_id': 'nope', 'name': 'a'}], 'archive': []})
        self.bad(branches={'apply': [], 'archive': [B2, B2]})
        self.bad(operation_id='x')


class ReconfigureTests(Base):
    def test_applies_and_receipt(self):
        request = make_request(branches={'apply': [{'branch_id': B1, 'name': 'Riyadh'}], 'archive': []})
        runner = FakeRunner(observation(), apply_state=applied_state(request))
        receipt = self.effect(runner).reconfigure(request)
        self.assertEqual(runner.installed, [['liwan_pmo']])
        self.assertEqual(runner.applies, 1)
        self.assertEqual(receipt['modules_installed'], ['liwan_pmo'])
        self.assertEqual(receipt['observed_entitlement_digest'], DIGEST)
        self.assertEqual(receipt['branch_bindings'], [{'branch_id': B1, 'odoo_company_id': 7}])
        self.assertEqual(receipt['order_id'], 'order-1')
        self.assertEqual(receipt['target_revision_id'], TARGET)
        self.assertEqual(receipt['root_company_id'], 1)
        self.assertIs(receipt['commercial_expiry_supported'], True)

    def test_writes_the_commercial_expiry(self):
        request = make_request(commercial_valid_until='2026-11-08', commercial_valid_until_revision=1)
        runner = FakeRunner(observation(), apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        script = [item for item in runner.scripts if item[0] == 'apply'][-1][2]
        values = _script_values(script)
        self.assertEqual(values['commercial_valid_until'], '2026-11-08')
        self.assertEqual(values['commercial_valid_until_revision'], 1)
        self.assertIn("_commercial_expiry_vals(values, profile, refuse)", script)
        self.assertIn("'commercial_valid_until_revision': wanted_revision", script)
        self.assertIn("write_vals.update(expiry_vals)", script)

    def test_clears_the_commercial_expiry_when_requested(self):
        request = make_request(commercial_valid_until=None, commercial_valid_until_revision=2)
        state = applied_state(request)
        runner = FakeRunner(observation(commercial_valid_until='2026-11-08', commercial_valid_until_revision=1), apply_state=state)
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)
        script = [item for item in runner.scripts if item[0] == 'apply'][-1][2]
        self.assertIsNone(_script_values(script)['commercial_valid_until'])

    def test_unrelated_revision_change_keeps_the_expiry(self):
        request = make_request()
        state = applied_state(request, commercial_valid_until='2026-11-08')
        runner = FakeRunner(observation(commercial_valid_until='2026-11-08'), apply_state=state)
        self.effect(runner).reconfigure(request)
        self.assertNotIn('commercial_valid_until', _script_values([item for item in runner.scripts if item[0] == 'apply'][-1][2]))

    def test_refuses_a_stale_expiry_revision(self):
        request = make_request(commercial_valid_until='2026-11-01', commercial_valid_until_revision=1)
        runner = FakeRunner(observation(commercial_valid_until='2026-11-08', commercial_valid_until_revision=2))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'commercial_expiry_revision_stale')
        self.assertEqual(runner.applies, 0)

    def test_reports_unsupported_when_only_the_date_field_exists(self):
        # A 19.0.1.6.0 profile has the date field but not the revision field.
        class DateOnly:
            commercial_valid_until = None
            database = DB
            root_company_id = 1
            commercial_revision_id = PREV
            commercial_digest = 'c' * 64
            commercial_applied_at = None
            features = {'users.limit': 3}
        supported = {'date': hasattr(DateOnly(), 'commercial_valid_until'),
                     'revision': hasattr(DateOnly(), 'commercial_valid_until_revision')}
        self.assertEqual(supported, {'date': True, 'revision': False})
        request = make_request(commercial_valid_until='2026-11-08', commercial_valid_until_revision=1)
        runner = FakeRunner(observation(commercial_expiry_supported=False))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'tenant_upgrade_required')

    def test_refuses_to_write_the_expiry_on_an_unupgraded_tenant(self):
        request = make_request(commercial_valid_until='2026-11-08')
        runner = FakeRunner(observation(commercial_expiry_supported=False))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'tenant_upgrade_required')
        self.assertEqual(runner.applies, 0)

    def test_clearing_an_expiry_on_an_old_tenant_is_a_noop(self):
        request = make_request(commercial_valid_until=None)
        state = applied_state(request)
        state['commercial_valid_until'] = None
        runner = FakeRunner(observation(commercial_expiry_supported=False), apply_state=state)
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)
        self.assertNotIn('commercial_valid_until', _script_values([item for item in runner.scripts if item[0] == 'apply'][-1][2]))

    def test_idempotent_when_already_applied(self):
        request = make_request()
        runner = FakeRunner(applied_state(request))
        receipt = self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 0)
        self.assertEqual(runner.installed, [])
        self.assertEqual(receipt['observed_entitlement_digest'], DIGEST)

    def test_stale_target(self):
        request = make_request()
        runner = FakeRunner(observation(commercial_revision_id=OTHER))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'stale_target')
        self.assertEqual(runner.applies, 0)

    def ai_request(self, **over):
        request = make_request(previous_revision_id=TARGET, ai_push=True, **over)
        request['entitlement']['features'].update({'ai.balance.granted': 5, 'ai.allowance.trial': 6, 'ai.allowance.monthly': 0})
        return request

    def test_ai_push_is_refused_unless_the_tenant_is_on_the_target_revision_with_its_digest(self):
        for label, state in [('no revision', observation(commercial_revision_id=None, commercial_digest=None)),
                             ('target without digest', observation(commercial_revision_id=TARGET, commercial_digest=None)),
                             ('another revision', observation(commercial_revision_id=PREV)),
                             ('the target with another digest', observation(commercial_revision_id=TARGET, commercial_digest='c' * 64))]:
            runner = FakeRunner(state)
            with self.subTest(label), self.assertRaises(EffectError) as ctx:
                self.effect(runner).reconfigure(self.ai_request())
            self.assertEqual(str(ctx.exception), 'stale_target')
            self.assertEqual(runner.applies, 0)

    def test_ai_push_on_the_target_revision_rewrites_only_the_ai_keys_and_carries_the_guard(self):
        request = self.ai_request()
        held = dict(request['entitlement']['features'], **{'ai.balance.granted': 1, 'ai.allowance.trial': 1})
        runner = FakeRunner(observation(commercial_revision_id=TARGET, commercial_digest=DIGEST, features=held,
                                        modules=request['entitlement']['modules']),
                            apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)
        script = next(script for stage, _, script in runner.scripts if stage == 'apply')
        values = _script_values(script)
        self.assertIs(values['ai_push'], True)
        # The same guard runs under the profile lock in Odoo, whatever the payload says.
        self.assertIn("values.get('ai_push') and (current != values['target_revision_id']", script)
        self.assertLess(script.index("values.get('ai_push')"), script.index("if current != values['target_revision_id']:"))

    def test_ai_push_may_not_carry_branches_expiry_or_a_false_flag(self):
        for over in [{'branches': {'apply': [{'branch_id': B1, 'name': 'x'}], 'archive': []}}, {'commercial_valid_until': '2030-01-01', 'commercial_valid_until_revision': 1}]:
            with self.subTest(over), self.assertRaises(EffectError) as ctx:
                se.validate_reconfigure(self.ai_request(**over))
            self.assertEqual(str(ctx.exception), 'input_invalid')
        with self.assertRaises(EffectError):
            se.validate_reconfigure(make_request(ai_push=False))

    def test_first_revision_from_null(self):
        request = make_request(previous_revision_id=None)
        runner = FakeRunner(observation(commercial_revision_id=None), apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)

    def test_same_revision_other_digest(self):
        request = make_request()
        runner = FakeRunner(observation(commercial_revision_id=TARGET, commercial_digest='d' * 64))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'observed_mismatch')
        self.assertEqual(runner.applies, 0)

    def test_downgrade_below_usage(self):
        for usage, over in [({'users.limit': 11}, None), ({'projects.max_projects': 6}, None), ({'storage.limit_mb': 101}, None)]:
            runner = FakeRunner(observation(usage={**observation()['usage'], **usage}, features=LOWERABLE))
            with self.assertRaises(EffectError) as ctx:
                self.effect(runner).reconfigure(make_request())
            self.assertEqual(str(ctx.exception), 'downgrade_below_usage')
            self.assertEqual((runner.applies, runner.installed), (0, []))
        self.assertFalse(self.dir.exists())

    def test_limit_equal_to_usage_is_accepted(self):
        request = make_request()
        usage = {**observation()['usage'], 'users.limit': 10, 'projects.max_projects': 5, 'storage.limit_mb': 100}
        runner = FakeRunner(observation(usage=usage, features=LOWERABLE), apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)

    def test_unlimited_target_is_never_refused(self):
        ent = make_request()['entitlement']
        request = make_request(entitlement={**ent, 'features': {**ent['features'], 'users.limit': None}})
        runner = FakeRunner(observation(usage={**observation()['usage'], 'users.limit': 10**6}),
                            apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)

    def test_open_application_limit_is_checked(self):
        ent = make_request()['entitlement']
        request = make_request(entitlement={**ent, 'features': {**ent['features'], 'pmo.enabled': True, 'projects.max_projects': 2}})
        runner = FakeRunner(observation(usage={**observation()['usage'], 'projects.max_projects': 3}))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'downgrade_below_usage')
        self.assertEqual(runner.applies, 0)

    def _gated(self, previous, target, projects):
        ent = make_request()['entitlement']
        request = make_request(entitlement={**ent, 'features': {**ent['features'], **target}})
        usage = {**observation()['usage'], 'projects.max_projects': projects}
        return request, FakeRunner(observation(features=previous, usage=usage), apply_state=applied_state(request))

    def test_closed_app_keeps_rows_while_another_gate_stays_open(self):
        base = {'users.limit': 20, 'storage.limit_mb': 200, 'branches.extra_limit': 2}
        request, runner = self._gated({**base, 'pmo.enabled': True, 'meetings.enabled': True, 'projects.max_projects': None},
                                      {'pmo.enabled': False, 'meetings.enabled': True, 'projects.max_projects': 0}, 9)
        runner.state['limit_gates'] = {**runner.state['limit_gates'], 'projects.max_projects': ['pmo.enabled', 'meetings.enabled']}
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'downgrade_below_usage')
        runner.state['limit_gates']['projects.max_projects'] = ['pmo.enabled']
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)

    def test_reopened_app_is_checked(self):
        base = {'users.limit': 20, 'storage.limit_mb': 200, 'branches.extra_limit': 2}
        request, runner = self._gated({**base, 'pmo.enabled': False, 'projects.max_projects': 0},
                                      {'pmo.enabled': True, 'projects.max_projects': 5}, 9)
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'downgrade_below_usage')

    def test_raised_limit_of_an_open_app_is_not_checked(self):
        base = {'users.limit': 20, 'storage.limit_mb': 200, 'branches.extra_limit': 2}
        request, runner = self._gated({**base, 'pmo.enabled': True, 'projects.max_projects': 10},
                                      {'pmo.enabled': True, 'projects.max_projects': 20}, 25)
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)

    def test_downgrade_branches(self):
        active = [{'branch_id': str(i) * 8 + B1[8:], 'state': 'active', 'odoo_company_id': i,
                   'active': True, 'parent_is_root': True} for i in range(1, 4)]
        runner = FakeRunner(observation(branches=active, usage={**observation()['usage'], 'branches.extra_limit': 3}))
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(make_request())
        self.assertEqual(str(ctx.exception), 'downgrade_below_usage')
        # archiving one in the same revision makes it legal
        request = make_request(branches={'apply': [], 'archive': [active[0]['branch_id']]})
        after = applied_state(request, usage=observation()['usage'])
        after['branches'] = [{**active[0], 'state': 'archived', 'active': False}, *active[1:]]
        runner = FakeRunner(observation(branches=active), apply_state=after)
        self.effect(runner).reconfigure(request)

    def test_observed_mismatch_after_apply(self):
        request = make_request()
        wrong = applied_state(request, )
        wrong['features'] = {**wrong['features'], 'users.limit': 99}
        runner = FakeRunner(observation(), apply_state=wrong)
        with self.assertRaises(EffectError) as ctx:
            self.effect(runner).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'observed_mismatch')

    def test_unbound_branch_is_mismatch(self):
        request = make_request(branches={'apply': [{'branch_id': B1, 'name': 'x'}], 'archive': []})
        state = applied_state(request)
        state['branches'][0]['parent_is_root'] = False
        with self.assertRaises(EffectError) as ctx:
            self.effect(FakeRunner(observation(), apply_state=state)).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'observed_mismatch')

    def test_journal_resume_after_crash(self):
        request = make_request(branches={'apply': [{'branch_id': B1, 'name': 'x'}], 'archive': []})
        first = FakeRunner(observation(), apply_state=applied_state(request), crash_after_apply=True)
        with self.assertRaises(EffectError):
            self.effect(first).reconfigure(request)
        self.assertEqual(len(list(self.dir.glob('*.json'))), 1)
        second = FakeRunner(first.state)
        receipt = self.effect(second).reconfigure(request)
        self.assertEqual(second.applies, 0)
        self.assertEqual(receipt['branch_bindings'][0]['branch_id'], B1)
        self.assertEqual(len(list(self.dir.glob('*.done'))), 1)

    def test_journal_conflict(self):
        request = make_request()
        self.dir.mkdir(mode=0o700)
        (self.dir / (DB + '.' + OP + '.json')).write_text(json.dumps({'operation_id': OP, 'target_revision_id': OTHER, 'database': DB}))
        with self.assertRaises(EffectError) as ctx:
            self.effect(FakeRunner(observation(), apply_state=applied_state(request))).reconfigure(request)
        self.assertEqual(str(ctx.exception), 'journal_conflict')

    def test_missing_database(self):
        with self.assertRaises(EffectError) as ctx:
            self.effect(FakeRunner(observation(), exists=False)).reconfigure(make_request())
        self.assertEqual(str(ctx.exception), 'database_missing')

    def test_script_error_codes_are_whitelisted(self):
        self.assertEqual(se.parse_output(wrap({'applied': True})), {'applied': True})
        for payload, code in [({'error_code': 'stale_target'}, 'stale_target'),
                              ({'error_code': 'secret detail'}, 'subscription_script_failed')]:
            with self.assertRaises(EffectError) as ctx:
                se.parse_output(wrap(payload))
            self.assertEqual(str(ctx.exception), code)
        with self.assertRaises(EffectError):
            se.parse_output('nothing')

    def test_apply_script_closes_unlisted_keys_through_odoo(self):
        script = se.build_apply_script(make_request())
        self.assertIn("._liwan_close_unlisted_features(values['features'])", script)
        self.assertNotIn("item['type'] == 'boolean' and key not in features", script)

    def test_apply_script_rewrites_only_the_ai_keys_when_the_revision_is_delivered_again(self):
        script = se.build_apply_script(make_request())
        self.assertIn("k.startswith(('ai.balance.', 'ai.allowance.'))", script)
        self.assertIn("dict(profile.features, **ai)", script)

    def test_delivery_with_the_derived_ai_keys_is_accepted_and_every_key_is_registered_by_the_ai_addon(self):
        keys = {'ai.balance.granted': 666666, 'ai.allowance.trial': 133333, 'ai.allowance.monthly': 0}
        request = make_request()
        request['entitlement']['features'].update(keys)
        se.validate_reconfigure(request)
        self.assertEqual(_script_values(se.build_apply_script(request))['features'], request['entitlement']['features'])
        runner = FakeRunner(observation(commercial_revision_id=PREV), apply_state=applied_state(request))
        self.assertEqual(self.effect(runner).reconfigure(request)['target_revision_id'], TARGET)
        # The effect passes them to Odoo, whose entitlement service refuses a key no addon registers. This is the
        # registry that the real service reads (the Odoo test of liwan_ai drives the service itself).
        registry = (Path(__file__).resolve().parents[2] / 'odoo-addons/liwan_ai/models/feature_registry.py').read_text()
        for key in keys:
            self.assertIn(f"{{'key': '{key}', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'}}", registry)

    def test_apply_script_grants_newly_opened_roles_to_the_enrolment_admin_only(self):
        script = se.build_apply_script(make_request(admin_login='boss@acme.test'))
        self.assertIn("values = json.loads(", script)
        self.assertIn('boss@acme.test', script)
        self.assertIn("roles_before = env['liwan.entitlement.service']._liwan_entitled_admin_roles()", script)
        self.assertIn("operator._liwan_grant_opened_admin_roles(values['admin_login'], roles_before)", script)
        self.assertLess(script.index('roles_before ='), script.index("'features': features"))
        # An older job without a login passes None; Odoo grants nothing and logs it.
        self.assertIn('"admin_login": null', se.build_apply_script(make_request()))

    def test_apply_script_signals_cache_invalidation_after_its_commit(self):
        script = se.build_apply_script(make_request())
        # odoo shell does not signal; running workers would keep stale groups and policy caches.
        self.assertLess(script.index('env.cr.commit()'), script.index('env.registry.signal_changes()'))
        self.assertEqual(script.count('env.registry.signal_changes()'), 1)

    def test_script_reports_a_due_grant_that_found_no_admin(self):
        script = se.build_apply_script(make_request())
        self.assertIn("'roles_not_granted': True", script)
        for reason in ("'no_admin_login'", "'admin_not_found'", "'roles_missing'"):
            self.assertIn(reason, script)

    def test_receipt_carries_roles_not_granted_with_the_reason(self):
        request = make_request()
        runner = FakeRunner(observation(), apply_state=applied_state(request),
                            apply_result={'applied': True, 'roles_not_granted': True, 'roles_not_granted_reason': 'admin_not_found'})
        receipt = self.effect(runner).reconfigure(request)
        self.assertIs(receipt['roles_not_granted'], True)
        self.assertEqual(receipt['roles_not_granted_reason'], 'admin_not_found')
        plain = self.effect(FakeRunner(observation(), apply_state=applied_state(request))).reconfigure(request)
        self.assertNotIn('roles_not_granted', plain)

    def test_receipt_carries_roles_missing(self):
        request = make_request()
        runner = FakeRunner(observation(), apply_state=applied_state(request),
                            apply_result={'applied': True, 'roles_not_granted': True, 'roles_not_granted_reason': 'roles_missing'})
        self.assertEqual(self.effect(runner).reconfigure(request)['roles_not_granted_reason'], 'roles_missing')

    def test_sigterm_handler_ignores_further_sigterm_first(self):
        source = inspect.getsource(se.main)
        body = source[source.index('def terminate'):]
        self.assertLess(body.index('signal.SIG_IGN'), body.index('runner.cancel()'))

    def test_admin_login_is_optional_and_validated(self):
        se.validate_reconfigure(make_request())
        se.validate_reconfigure(make_request(admin_login='boss@acme.test'))
        for bad in ('', 5, 'a' * 255, 'x\ny'):
            with self.assertRaises(EffectError, msg=repr(bad)):
                se.validate_reconfigure(make_request(admin_login=bad))

    def test_release_complete_target_installs_nothing(self):
        modules = ['liwan_api', 'liwan_core', 'liwan_platform', 'liwan_pmo']
        request = make_request(entitlement={**make_request()['entitlement'], 'modules': modules})
        runner = FakeRunner(observation(modules=modules), apply_state=applied_state(request))
        receipt = self.effect(runner).reconfigure(request)
        self.assertEqual(runner.installed, [])
        self.assertEqual(receipt['modules_installed'], [])

    def test_closing_an_application_is_not_below_usage(self):
        ent = make_request()['entitlement']
        request = make_request(entitlement={**ent, 'features': {**ent['features'], 'pmo.enabled': False, 'projects.max_projects': 0}})
        runner = FakeRunner(observation(usage={**observation()['usage'], 'projects.max_projects': 6}),
                            apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)


class ObserveTests(Base):
    def test_observe_snapshot(self):
        runner = FakeRunner(observation())
        value = self.effect(runner).observe({'tenant': {'database': DB, 'host': 'a.test'}})
        self.assertEqual(value['observed_at'], '2026-01-01T00:00:00Z')
        self.assertEqual(value['usage']['branches.extra_limit'], 0)
        self.assertTrue(all(not mutate for _, mutate, _ in runner.scripts))

    def test_observation_shape_validated(self):
        bad = observation()
        bad['usage'] = {**observation()['usage'], 'users.limit': -1}
        with self.assertRaises(EffectError):
            self.effect(FakeRunner(bad)).observe({'tenant': {'database': DB, 'host': 'a.test'}})

    def test_observation_gates_must_name_every_usage_key(self):
        bad = observation()
        bad['limit_gates'] = {'users.limit': []}
        with self.assertRaises(EffectError):
            self.effect(FakeRunner(bad)).observe({'tenant': {'database': DB, 'host': 'a.test'}})

    def test_observation_must_carry_platform_limits(self):
        for missing in ('users.limit', 'storage.limit_mb', 'branches.extra_limit'):
            bad = observation()
            del bad['usage'][missing]
            del bad['limit_gates'][missing]
            with self.assertRaises(EffectError, msg=missing):
                self.effect(FakeRunner(bad)).observe({'tenant': {'database': DB, 'host': 'a.test'}})

    def test_observation_must_carry_the_root_company(self):
        missing = observation()
        del missing['root_company_id']
        for bad in (missing, observation(root_company_id=None), observation(root_company_id=False),
                    observation(root_company_id=0), observation(root_company_id='1'),
                    observation(root_company_id=True)):
            with self.assertRaises(EffectError):
                self.effect(FakeRunner(bad)).observe({'tenant': {'database': DB, 'host': 'a.test'}})

    def test_observe_script_reads_the_root_company(self):
        self.assertIn("'root_company_id': root.id", se.build_observe_script(DB))

    def test_verified_rerun_receipt_carries_the_root_company(self):
        request = make_request()
        receipt = self.effect(FakeRunner(applied_state(request, root_company_id=3))).reconfigure(request)
        self.assertEqual(receipt['root_company_id'], 3)


class SigtermTests(unittest.TestCase):
    def test_sigterm_during_run_script_kills_the_current_container(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for name in ('compose.yml', 'env'):
                (root / name).write_text('')
            request = make_request(
                fence=1, attemptId='aaaaaaaa-1111-4111-8111-111111111111',
                config={'schemaVersion': 1, 'projectName': 'liwan-shared-acme', 'composeFile': str(root / 'compose.yml'),
                        'envFile': str(root / 'env'), 'stateDir': str(root), 'domainSuffix': 'example.test'})
            handlers, killed = {}, []

            def hang(self, args, **kwargs):
                # SIGTERM arrives while the effect container is running.
                handlers[signal.SIGTERM](signal.SIGTERM, None)

            def fake_run(args, **kwargs):
                killed.append(args)

            def fake_observe(self_, request_):
                self_.runner.run_script('print(1)', 'observe')

            out = io.StringIO()
            with mock.patch.object(se.signal, 'signal', lambda num, fn: handlers.__setitem__(num, fn)), \
                    mock.patch.object(se.ComposeRunner, 'command', hang), \
                    mock.patch.object(se.odoo_effect.subprocess, 'run', fake_run), \
                    mock.patch.object(se.SubscriptionEffect, 'observe', fake_observe):
                code = se.main(stdin=io.StringIO(json.dumps(dict(request, action='observe')) + '\n'), stdout=out)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue()), {'error_code': 'authority_lost'})
        self.assertEqual(len(killed), 1)
        self.assertEqual(killed[0][:2], ['docker', 'kill'])
        self.assertRegex(killed[0][2], r'^liwan-shared-acme-effect-aaaaaaaa-observe-[0-9a-f]{8}$')



class ReleaseSubscriptionBoundaryTests(Base):
    def test_wrong_or_missing_helper_pool_refuses_database_process(self):
        import os
        import json
        root = self.dir.parent
        (root / 'tenant_a.json').write_text(json.dumps({'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 4, 'routeRevision': 2, 'poolId': 'blue', 'releaseId': 'r1', 'fence': 8, 'state': 'serving'}))
        request = make_request(releaseBinding={'tenantId': 'tenant_a', 'registryRevision': 4, 'database': DB})
        for pool_id in ('', 'green'):
            runner = FakeRunner(observation())
            with mock.patch.dict(os.environ, {'LIWAN_RELEASE_ROUTES_DIR': str(root), 'LIWAN_RELEASE_HELPER_POOL_ID': pool_id}):
                with self.assertRaises(EffectError): self.effect(runner).observe(request)
            self.assertFalse(runner.scripts)

    def test_observation_and_reconfigure_keep_the_runtime_lease(self):
        import os
        import json
        root = self.dir.parent
        (root / 'tenant_a.json').write_text(json.dumps({'schemaVersion': 1, 'tenantId': 'tenant_a', 'identityRevision': 4, 'routeRevision': 2, 'poolId': 'blue', 'releaseId': 'r1', 'fence': 8, 'state': 'serving'}))
        from deploy.releases.test_helper_runtime import helper_fixture
        import subprocess
        config, _, _, rendered = helper_fixture(root)
        request = make_request(config=config, releaseBinding={'tenantId': 'tenant_a', 'registryRevision': 4, 'database': DB})
        runner = FakeRunner(observation(), apply_state=applied_state(request))
        original = runner.run_script
        seen = []
        def script(*args, **kwargs):
            seen.append(len(list((root / 'leases' / 'tenant_a').glob('*.json'))))
            return original(*args, **kwargs)
        runner.run_script = script
        with mock.patch.dict(os.environ, {'LIWAN_RELEASE_ROUTES_DIR': str(root), 'LIWAN_RELEASE_HELPER_POOL_ID': 'blue'}), mock.patch('deploy.releases.helper_runtime.subprocess.run', lambda argv, **kwargs: subprocess.CompletedProcess(argv,0,json.dumps(rendered),'')):
            self.effect(runner).observe(request)
            self.effect(runner).reconfigure(request)
        self.assertTrue(seen and all(count == 1 for count in seen))
        self.assertFalse(list((root / 'leases' / 'tenant_a').glob('*.json')))

    def test_maintenance_blocks_before_subscription_database_observation(self):
        import os
        root = self.dir.parent
        (root / 'tenant_a.maintenance').write_text('{}')
        request = make_request(releaseBinding={'tenantId': 'tenant_a', 'registryRevision': 4, 'database': DB})
        runner = FakeRunner(observation())
        with mock.patch.dict(os.environ, {'LIWAN_RELEASE_ROUTES_DIR': str(root)}):
            with self.assertRaises(EffectError): self.effect(runner).reconfigure(request)
        self.assertFalse(runner.scripts)
        self.assertFalse(runner.installed)


if __name__ == '__main__':
    unittest.main()


class RestoreRuntimeTests(unittest.TestCase):
    def request(self, root):
        return make_request(fence=1, attemptId='aaaaaaaa-1111-4111-8111-111111111111',
            config={'schemaVersion':1,'projectName':'liwan-shared-acme','composeFile':str(root/'compose.yml'),
                    'envFile':str(root/'env'),'stateDir':str(root),'domainSuffix':'example.test',
                    'releaseBackupConfig':str(root/'release-backup.json')})

    def test_bridge_configuration_keeps_ordinary_subscription_commands_available(self):
        with tempfile.TemporaryDirectory() as tmp:
            request=self.request(Path(tmp).resolve())
            runner=se.ComposeRunner(request)
            with mock.patch.object(runner,'command',return_value='output') as command:
                runner.run_script('print(1)','observe')
            self.assertIn('odoo',command.call_args.args[0])
            self.assertNotIn('restore-odoo',command.call_args.args[0])
            request['config']['unknown']=True
            with self.assertRaisesRegex(EffectError,'runtime_invalid'):se.ComposeRunner(request)

    def test_restore_shell_and_install_use_only_restore_database_and_filestore(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            request = self.request(root)
            request['restore'] = {'approvalId': TARGET, 'requestId': OP, 'backupId': PREV,
                                  'digest': DIGEST, 'manifestSha256': 'c' * 64}
            effects = root / 'restore-effects'
            effects.mkdir()
            completion = {key: val for key, val in request['restore'].items() if key != 'requestId'}
            (effects / (OP + '.complete')).write_text(json.dumps(dict(completion, targetDatabase=DB)))
            classification = root / 'classifications' / (DB + '.json')
            classification.parent.mkdir()
            classification.write_text(json.dumps({'database': DB}))
            runner = se.ComposeRunner(request, permit=lambda _: None)
            with mock.patch.object(runner, 'command', return_value='1') as command:
                self.assertTrue(runner.database_exists())
                exists = command.call_args.args[0]
                runner.run_script('print(1)', 'observe')
                observe = command.call_args.args[0]
                runner.install_modules(['liwan_platform'])
                install = command.call_args.args[0]
            self.assertIn('restore-db', exists)
            self.assertNotIn('db', exists)
            for args in (observe, install):
                self.assertIn('restore-odoo', args)
                self.assertNotIn('odoo', args)
                self.assertIn('--db_host=restore-db', args)
                self.assertIn(str(classification) + ':/run/liwan/classification.json:ro', args)
            self.assertEqual(observe[observe.index('restore-odoo') + 1], 'shell')
            self.assertEqual(install[install.index('restore-odoo') + 1], 'server')
            request['restore']['approvalId'] = OTHER
            with self.assertRaisesRegex(EffectError, 'restore_target_unverified'):
                se.ComposeRunner(request)


class TrialEndEffectTests(Base):
    def execute_apply(self, request, *, current=PREV, digest='c' * 64, pending=None):
        """Execute the generated Odoo code against an isolated protocol double, including write ordering."""
        events = []
        clock = datetime(2026, 1, 2)

        class Profile:
            commercial_revision_id = current
            commercial_digest = digest
            commercial_valid_until_revision = 0
            features = {'users.limit': 10, 'pmo.enabled': False, 'ai.balance.granted': 1}
            trial_ends_at = None
            post_trial_features = pending or {}
            post_trial_modules = []
            post_trial_digest = None

            def _liwan_lock(self):
                return self

            def with_context(self, **_context):
                return self

            def write(self, values):
                events.append('write')
                for key, value in values.items():
                    setattr(self, key, value)

            def _liwan_grant_opened_admin_roles(self, _login, before):
                events.append(('roles', tuple(service._liwan_entitled_admin_roles()), tuple(before)))
                return True

            def _liwan_apply_post_trial(self):
                if self.trial_ends_at and self.trial_ends_at <= clock:
                    self.features = dict(self.post_trial_features)
                    self.commercial_digest = self.post_trial_digest
                    self.trial_ends_at = False
                    events.append('materialized')
                    service._liwan_settle_excess()

            def _liwan_apply_branches(self, *_args):
                if self.trial_ends_at and self.trial_ends_at <= clock:
                    raise RuntimeError('unsettled_due_branch_quota')
                events.append('branches')

        profile = Profile()
        service = SimpleNamespace(
            _liwan_entitled_admin_roles=lambda: ['pmo'] if profile.features.get('pmo.enabled') else [],
            _liwan_close_unlisted_features=lambda values: dict(values),
            _liwan_settle_excess=lambda: events.append('settled'),
        )

        class Env:
            su = True
            cr = SimpleNamespace(dbname=DB, commit=lambda: events.append('commit'), rollback=lambda: events.append('rollback'))
            registry = SimpleNamespace(signal_changes=lambda: events.append('signal'))

            def __getitem__(self, model):
                if model == 'liwan.entitlement.service':
                    return service
                raise AssertionError(model)

        fields = SimpleNamespace(Datetime=SimpleNamespace(now=lambda: clock), Date=SimpleNamespace(to_date=lambda value: value))
        namespace = {'env': Env()}
        values = _script_values(se.build_apply_script(request))
        exec(se._prefix(values) + se._COMMON, namespace)
        namespace['read_profile'] = lambda: profile
        with mock.patch.dict(sys.modules, {'odoo': SimpleNamespace(fields=fields),
                                           'odoo.addons.liwan_platform.models.entitlement_service': SimpleNamespace(OPERATOR_CONTEXT='operator')}):
            exec(se._APPLY_BODY, namespace)
        return namespace['result'], profile, events

    def request(self, **over):
        return make_request(**{
            'trial_ends_at': '2026-12-01T00:00:00Z',
            'post_trial_features': {'users.limit': 3, 'storage.limit_mb': 20, 'branches.extra_limit': 0},
            'post_trial_modules': ['liwan_core', 'liwan_platform', 'liwan_api'],
            'post_trial_digest': 'd' * 64, **over,
        })

    def test_system_settle_accepts_excess_platform_capacity(self):
        request = make_request(excess_settle=True)
        seen = observation(excess_supported=True, features=LOWERABLE,
                           usage={'users.limit': 30, 'storage.limit_mb': 300, 'branches.extra_limit': 3},
                           branches=[dict(OptionalTrialEndKeysTest.BRANCH, branch_id=str(i)) for i in range(3)])
        se.check_downgrade(request, seen)

    def test_system_settle_requires_observed_capability(self):
        with self.assertRaisesRegex(EffectError, 'tenant_upgrade_required'):
            se.check_downgrade(make_request(excess_settle=True), observation())

    def test_system_settle_never_bypasses_application_limits(self):
        seen = observation(excess_supported=True, features={**LOWERABLE, 'pmo.enabled': True},
                           usage={'users.limit': 30, 'storage.limit_mb': 300,
                                  'branches.extra_limit': 3, 'projects.max_projects': 21})
        with self.assertRaisesRegex(EffectError, 'downgrade_below_usage'):
            se.check_downgrade(make_request(excess_settle=True), seen)

    def test_customer_downgrade_counts_only_full_branches(self):
        request = make_request()
        request['entitlement']['features']['branches.extra_limit'] = 0
        se.check_downgrade(request, observation(branches=[dict(OptionalTrialEndKeysTest.BRANCH, read_only=True)]))
        with self.assertRaisesRegex(EffectError, 'downgrade_below_usage'):
            se.check_downgrade(request, observation(branches=[OptionalTrialEndKeysTest.BRANCH]))

    def test_apply_payload_carries_expiry_and_settlement(self):
        request = self.request(excess_settle=True)
        values = _script_values(se.build_apply_script(request))
        for key in ('trial_ends_at', 'post_trial_features', 'post_trial_modules', 'post_trial_digest', 'excess_settle'):
            self.assertEqual(values.get(key), request[key], key)

    def test_applied_revision_does_not_skip_a_changed_trial_policy(self):
        request = self.request()
        seen = applied_state(request, post_trial_supported=True, trial_ends_at='2026-11-30T00:00:00Z',
                             post_trial_features=request['post_trial_features'], post_trial_modules=request['post_trial_modules'],
                             post_trial_digest=request['post_trial_digest'])
        self.assertFalse(se.verify(request, seen))
        seen['trial_ends_at'] = request['trial_ends_at']
        self.assertTrue(se.verify(request, seen))
        seen['post_trial_digest'] = 'e' * 64
        self.assertFalse(se.verify(request, seen))

    def test_trial_policy_requires_supported_tenant_before_mutation(self):
        request = self.request()
        runner = FakeRunner(observation(), apply_state=applied_state(request))
        with self.assertRaisesRegex(EffectError, 'tenant_upgrade_required'):
            self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 0)
        self.assertEqual(runner.installed, [])

    def test_receipt_reports_capabilities_and_read_only_branches(self):
        request = make_request()
        seen = applied_state(request, post_trial_supported=True, excess_supported=True,
                             excess={'users.limit': 2, 'branches.extra_limit': 1})
        seen['branches'] = [dict(OptionalTrialEndKeysTest.BRANCH, read_only=True)]
        receipt = self.effect(FakeRunner(seen)).reconfigure(request)
        self.assertIs(receipt.get('post_trial_supported'), True)
        self.assertIs(receipt.get('excess_supported'), True)
        self.assertEqual(receipt.get('excess'), seen['excess'])
        self.assertEqual(receipt.get('branch_read_only'), [{'branch_id': B1, 'read_only': True}])

    def test_late_apply_verifies_only_exact_post_trial_target(self):
        request = self.request(trial_ends_at='2026-01-01T00:00:00Z')
        seen = applied_state(request, post_trial_supported=True, excess_supported=True,
                             excess={'users.limit': 0, 'branches.extra_limit': 0})
        seen.update(commercial_digest=request['post_trial_digest'], features=request['post_trial_features'], trial_ends_at=None)
        self.assertTrue(se.verify(request, seen, now='2026-01-02T00:00:00Z'))
        seen['commercial_digest'] = 'e' * 64
        self.assertFalse(se.verify(request, seen, now='2026-01-02T00:00:00Z'))
        seen['commercial_digest'] = request['post_trial_digest']
        self.assertFalse(se.verify(request, seen, now='2025-12-31T00:00:00Z'))

    def test_equivalent_trial_instants_do_not_reapply(self):
        request = self.request(trial_ends_at='2026-12-01T03:00:00+03:00')
        seen = applied_state(request, post_trial_supported=True, trial_ends_at='2026-12-01T00:00:00Z',
                             post_trial_features=request['post_trial_features'], post_trial_modules=request['post_trial_modules'],
                             post_trial_digest=request['post_trial_digest'])
        self.assertTrue(se.verify(request, seen, now='2026-11-01T00:00:00Z'))

    def test_matching_revision_without_settlement_is_not_a_receipt(self):
        request = make_request(excess_settle=True)
        seen = applied_state(request, excess_supported=True, excess={'users.limit': 0, 'branches.extra_limit': 0})
        seen['usage']['users.limit'] = 11
        self.assertFalse(se.verify(request, seen))
        seen['usage']['users.limit'] = 10
        self.assertTrue(se.verify(request, seen))
        seen['modules'].remove('liwan_pmo')
        self.assertFalse(se.verify(request, seen))

    def test_expired_fallback_still_requires_materialization(self):
        request = self.request(trial_ends_at='2026-01-01T00:00:00Z')
        seen = applied_state(request, post_trial_supported=True, excess_supported=True,
                             excess={'users.limit': 0, 'branches.extra_limit': 0})
        seen.update(commercial_digest=request['post_trial_digest'], features=request['post_trial_features'],
                    trial_ends_at=request['trial_ends_at'])
        self.assertFalse(se.verify(request, seen, now='2026-01-02T00:00:00Z'))
        seen['trial_ends_at'] = None
        self.assertTrue(se.verify(request, seen, now='2026-01-02T00:00:00Z'))

    def test_null_trial_clear_is_noop_on_an_older_tenant(self):
        request = make_request(trial_ends_at=None)
        runner = FakeRunner(observation(), apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        values = _script_values(next(script for stage, _mutate, script in runner.scripts if stage == 'apply'))
        self.assertNotIn('trial_ends_at', values)

    def test_generated_apply_grants_only_after_the_effective_policy_write(self):
        request = make_request(admin_login='owner@example.test')
        request['entitlement']['features']['pmo.enabled'] = True
        result, _profile, events = self.execute_apply(request)
        self.assertEqual(result, {'applied': True})
        self.assertIn(('roles', ('pmo',), ()), events)
        self.assertLess(events.index('write'), events.index(('roles', ('pmo',), ())))

    def test_generated_late_apply_settles_before_paid_branch_binding(self):
        request = self.request(trial_ends_at='2026-01-01T00:00:00Z', excess_settle=True,
                               branches={'apply': [{'branch_id': B1, 'name': 'Paid branch'}], 'archive': []})
        result, profile, events = self.execute_apply(request)
        self.assertEqual(result, {'applied': True})
        self.assertEqual(profile.features, request['post_trial_features'])
        self.assertLess(events.index('materialized'), events.index('branches'))
        self.assertLess(events.index('settled'), events.index('branches'))
        self.assertLess(events.index('branches'), events.index('commit'))

    def test_generated_ai_delivery_updates_pending_policy_without_reopening_apps(self):
        request = make_request(previous_revision_id=TARGET, ai_push=True)
        request['entitlement']['features']['ai.balance.granted'] = 8
        pending = {'pmo.enabled': False, 'ai.balance.granted': 1}
        result, profile, _events = self.execute_apply(request, current=TARGET, digest=DIGEST, pending=pending)
        self.assertEqual(result, {'applied': True})
        self.assertEqual(profile.features['ai.balance.granted'], 8)
        self.assertEqual(profile.post_trial_features, {'pmo.enabled': False, 'ai.balance.granted': 8})

    def test_ai_delivery_on_materialized_policy_preserves_locked_apps(self):
        request = make_request(previous_revision_id=TARGET, ai_push=True, ai_expected_post_trial_digest='d' * 64)
        request['entitlement']['features'].update({'ai.balance.granted': 8, 'pmo.enabled': True})
        result, profile, events = self.execute_apply(request, current=TARGET, digest='d' * 64)
        self.assertEqual(result, {'applied': True})
        self.assertFalse(profile.features['pmo.enabled'])
        self.assertEqual(profile.commercial_digest, 'd' * 64)
        self.assertEqual(profile.features['ai.balance.granted'], 8)
        self.assertIn('commit', events)

    def test_late_apply_checks_the_effective_application_limit_before_install(self):
        request = self.request(trial_ends_at='2025-12-31T00:00:00Z')
        request['post_trial_features'].update({'pmo.enabled': True, 'projects.max_projects': 1})
        seen = observation(post_trial_supported=True, excess_supported=True,
                           features={'pmo.enabled': True, 'projects.max_projects': 5, 'users.limit': 10})
        seen['usage']['projects.max_projects'] = 2
        runner = FakeRunner(seen)
        with self.assertRaisesRegex(EffectError, 'downgrade_below_usage'):
            self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 0)
        self.assertEqual(runner.installed, [])

    def test_empty_or_non_integer_ai_ledger_is_refused(self):
        for values in ({}, {'ai.balance.granted': True}):
            request = make_request(ai_push=True)
            request['entitlement']['features'] = values
            with self.subTest(values=values), self.assertRaisesRegex(EffectError, 'input_invalid'):
                se.validate_reconfigure(request)

    def test_new_trial_policy_must_be_complete_before_module_install(self):
        request = make_request(trial_ends_at='2026-12-01T00:00:00Z')
        runner = FakeRunner(observation(post_trial_supported=True, excess_supported=True))
        with self.assertRaisesRegex(EffectError, 'input_invalid'):
            self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 0)
        self.assertEqual(runner.installed, [])

    def test_unsettled_storage_cannot_be_acknowledged_even_when_full_seats_fit(self):
        request = make_request(excess_settle=True)
        seen = applied_state(request, excess_supported=True, excess_settled=False,
                             excess={'users.limit': 0, 'branches.extra_limit': 0, 'storage.limit_mb': 20})
        self.assertFalse(se.verify(request, seen))
        seen['excess_settled'] = True
        self.assertTrue(se.verify(request, seen))

    def test_storage_bytes_are_exact_and_safely_typed(self):
        seen = observation(storage_bytes=1048577)
        self.assertEqual(se.validate_observation(seen)['storage_bytes'], 1048577)
        for invalid in (True, -1, 1.5, 9007199254740992):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(EffectError, 'observation_invalid'):
                se.validate_observation(observation(storage_bytes=invalid))

    def test_settlement_preserves_the_proven_last_admin_floor_only(self):
        request = make_request(excess_settle=True)
        request['entitlement']['features']['users.limit'] = 0
        seen = applied_state(request, excess_supported=True, excess_settled=True,
                             excess={'users.limit': 3, 'branches.extra_limit': 0, 'storage.limit_mb': 0})
        self.assertTrue(se.verify(request, seen))
        seen['usage']['users.limit'] = 2
        self.assertFalse(se.verify(request, seen))


class OptionalTrialEndKeysTest(unittest.TestCase):
    """New optional keys are type-checked when present and ignored otherwise."""

    VALID_REQUEST = {
        'excess_settle': True, 'trial_ends_at': '2026-12-01T00:00:00Z',
        'post_trial_features': {'users.limit': 3, 'pmo.enabled': False},
        'post_trial_modules': ['liwan_core'], 'post_trial_digest': 'd' * 64,
    }
    INVALID_REQUEST = (
        ('excess_settle', 'yes', 'input_invalid'), ('excess_settle', None, 'input_invalid'),
        ('excess_settle', 1, 'input_invalid'),
        ('trial_ends_at', 1700000000, 'input_invalid'), ('trial_ends_at', 'garbage', 'input_invalid'),
        ('trial_ends_at', '2026-12-01', 'input_invalid'), ('trial_ends_at', '2026-12-01T00:00:00', 'input_invalid'),
        ('post_trial_features', [], 'features_invalid'), ('post_trial_features', None, 'features_invalid'),
        ('post_trial_features', {'Bad Key': True}, 'features_invalid'),
        ('post_trial_modules', 'liwan_core', 'modules_invalid'), ('post_trial_modules', None, 'modules_invalid'),
        ('post_trial_modules', ['liwan_core', 'liwan_core'], 'modules_invalid'),
        ('post_trial_modules', ['liwan_core', 7], 'modules_invalid'),
        ('post_trial_modules', ['Not-An-Addon'], 'modules_invalid'),
        ('post_trial_modules', ['liwan_x'] * 2, 'modules_invalid'),
        ('post_trial_modules', ['liwan_m%d' % i for i in range(257)], 'modules_invalid'),
        ('post_trial_digest', 'xyz', 'entitlement_invalid'), ('post_trial_digest', None, 'entitlement_invalid'),
    )
    BRANCH = {'branch_id': B1, 'state': 'active', 'odoo_company_id': 2, 'active': True, 'parent_is_root': True}

    def test_request_accepts_each_valid_key(self):
        for key, value in self.VALID_REQUEST.items():
            with self.subTest(key=key):
                se.validate_reconfigure(make_request(**{key: value}))
        se.validate_reconfigure(make_request(trial_ends_at=None))
        se.validate_reconfigure(make_request(**self.VALID_REQUEST))

    def test_request_rejects_each_wrong_type_with_its_code(self):
        for key, value, code in self.INVALID_REQUEST:
            with self.subTest(key=key, value=value), self.assertRaisesRegex(EffectError, code):
                se.validate_reconfigure(make_request(**{key: value}))

    def test_post_trial_modules_is_shape_only(self):
        for modules in ([], ['liwan_not_on_this_host'], ['customer_acme_x', 'liwan_core']):
            with self.subTest(modules=modules):
                se.validate_reconfigure(make_request(post_trial_modules=modules))

    def test_trial_ends_at_needs_an_explicit_timezone(self):
        for text in ('2026-12-01T00:00:00Z', '2026-12-01T00:00:00+03:00', '2026-12-01T00:00:00.500000+00:00'):
            with self.subTest(text=text):
                se.validate_reconfigure(make_request(trial_ends_at=text))

    def test_request_without_keys_is_unchanged(self):
        request = make_request()
        before = json.dumps(request, sort_keys=True)
        self.assertIs(se.validate_reconfigure(request), request)
        self.assertEqual(json.dumps(request, sort_keys=True), before)

    def test_request_still_ignores_other_unknown_keys(self):
        se.validate_reconfigure(make_request(unrelated_key=object()))

    def test_new_keys_are_applied_and_verified(self):
        plain, extended = make_request(), make_request(**self.VALID_REQUEST)
        self.assertNotEqual(se.build_apply_script(plain), se.build_apply_script(extended))
        matching = observation(commercial_revision_id=TARGET, commercial_digest=DIGEST,
                               features=plain['entitlement']['features'], modules=plain['entitlement']['modules'],
                               excess_supported=True, excess_settled=True, excess={'users.limit': 0, 'branches.extra_limit': 0})
        self.assertTrue(se.verify(plain, matching))
        self.assertFalse(se.verify(extended, matching))
        matching.update({key: value for key, value in self.VALID_REQUEST.items() if key != 'excess_settle'})
        self.assertTrue(se.verify(extended, matching, now='2026-11-01T00:00:00Z'))

    def test_observation_accepts_each_valid_key(self):
        for over in ({'post_trial_supported': True}, {'excess_supported': False},
                     {'excess': {'users.limit': 0, 'storage.limit_mb': 1000000000}}, {'excess': {}},
                     {'branches': [dict(self.BRANCH, read_only=True)]}):
            with self.subTest(over=sorted(over)):
                se.validate_observation(observation(**over))

    def test_observation_rejects_each_wrong_type(self):
        for over in ({'post_trial_supported': 1}, {'excess_supported': None},
                     {'excess': []}, {'excess': {'users.limit': -1}}, {'excess': {'users.limit': True}},
                     {'excess': {'users.limit': 1000000001}},
                     {'excess': {'k%d' % i: 0 for i in range(257)}},
                     {'excess': {'Bad Key': 1}},
                     {'branches': [dict(self.BRANCH, read_only='no')]}):
            with self.subTest(over=over), self.assertRaisesRegex(EffectError, 'observation_invalid'):
                se.validate_observation(observation(**over))

    def test_observation_without_keys_is_unchanged(self):
        value = observation(branches=[dict(self.BRANCH)])
        self.assertIs(se.validate_observation(value), value)
        with self.assertRaisesRegex(EffectError, 'observation_invalid'):
            se.validate_observation(observation(unknown_flag=True))
        with self.assertRaisesRegex(EffectError, 'observation_invalid'):
            se.validate_observation(observation(branches=[dict(self.BRANCH, extra=1)]))
