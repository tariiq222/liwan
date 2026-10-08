# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Unit tests (no Odoo, no Docker): fake runner replaces script execution."""
import inspect
import io
import json
import signal
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools.shared_saas_lifecycle import subscription_effect as se
from tools.shared_saas_lifecycle.odoo_effect import EffectError

DB = 'nasq_scratch_' + 'a' * 32
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
        'entitlement': {'modules': ['nasq_core', 'nasq_platform', 'nasq_api', 'nasq_pmo'],
                        'features': {'users.limit': 10, 'projects.max_projects': 5,
                                     'storage.limit_mb': 100, 'branches.extra_limit': 2},
                        'digest': DIGEST, 'compiler_version': 1},
        'branches': {'apply': [], 'archive': []},
    }
    request.update(over)
    return request


def observation(**over):
    value = {'database': DB, 'commercial_revision_id': PREV, 'commercial_digest': 'c' * 64,
             'commercial_applied_at': None, 'features': {'users.limit': 3},
             'modules': ['nasq_api', 'nasq_core', 'nasq_platform'], 'branches': [],
             'usage': {'users.limit': 1, 'projects.max_projects': 0, 'storage.limit_mb': 0, 'branches.extra_limit': 0},
             'limit_gates': {'users.limit': [], 'projects.max_projects': ['pmo.enabled'],
                             'storage.limit_mb': [], 'branches.extra_limit': []}}
    value.update(over)
    return value


LOWERABLE = {'users.limit': 20, 'projects.max_projects': 20, 'storage.limit_mb': 200}


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
    ent = request['entitlement']
    branches = [{'branch_id': b['branch_id'], 'state': 'active', 'odoo_company_id': 7 + i,
                 'active': True, 'parent_is_root': True} for i, b in enumerate(request['branches']['apply'])]
    return observation(commercial_revision_id=TARGET, commercial_digest=ent['digest'],
                       features=dict(ent['features']), branches=branches,
                       modules=sorted(ent['modules']), **over)


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
        for db in ('odoo19', 'nasq_scratch_x', DB + ';'):
            self.bad(tenant={'database': db, 'host': 'a.test'})

    def test_bad_digest_and_modules(self):
        ent = make_request()['entitlement']
        self.bad(entitlement={**ent, 'digest': 'z' * 64})
        self.bad(entitlement={**ent, 'digest': 'B' * 64})
        self.bad(entitlement={**ent, 'modules': ['nasq_core', 'sale']})
        self.bad(entitlement={**ent, 'features': {'users.limit': -1}})
        self.bad(entitlement={**ent, 'features': {'x': 'yes'}})

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
        self.assertEqual(runner.installed, [['nasq_pmo']])
        self.assertEqual(runner.applies, 1)
        self.assertEqual(receipt['modules_installed'], ['nasq_pmo'])
        self.assertEqual(receipt['observed_entitlement_digest'], DIGEST)
        self.assertEqual(receipt['branch_bindings'], [{'branch_id': B1, 'odoo_company_id': 7}])
        self.assertEqual(receipt['order_id'], 'order-1')
        self.assertEqual(receipt['target_revision_id'], TARGET)

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
        self.assertIn("._nasq_close_unlisted_features(values['features'])", script)
        self.assertNotIn("item['type'] == 'boolean' and key not in features", script)

    def test_apply_script_grants_newly_opened_roles_to_the_enrolment_admin_only(self):
        script = se.build_apply_script(make_request(admin_login='boss@acme.test'))
        self.assertIn("values = json.loads(", script)
        self.assertIn('boss@acme.test', script)
        self.assertIn("roles_before = env['nasq.entitlement.service']._nasq_entitled_admin_roles()", script)
        self.assertIn("operator._nasq_grant_opened_admin_roles(values['admin_login'], roles_before)", script)
        self.assertLess(script.index('roles_before ='), script.index("'features': features"))
        # An older job without a login passes None; Odoo grants nothing and logs it.
        self.assertIn('"admin_login": null', se.build_apply_script(make_request()))

    def test_script_reports_a_due_grant_that_found_no_admin(self):
        script = se.build_apply_script(make_request())
        self.assertIn("'roles_not_granted': True", script)
        self.assertIn("'no_admin_login' if not values['admin_login'] else 'admin_not_found'", script)

    def test_receipt_carries_roles_not_granted_with_the_reason(self):
        request = make_request()
        runner = FakeRunner(observation(), apply_state=applied_state(request),
                            apply_result={'applied': True, 'roles_not_granted': True, 'roles_not_granted_reason': 'admin_not_found'})
        receipt = self.effect(runner).reconfigure(request)
        self.assertIs(receipt['roles_not_granted'], True)
        self.assertEqual(receipt['roles_not_granted_reason'], 'admin_not_found')
        plain = self.effect(FakeRunner(observation(), apply_state=applied_state(request))).reconfigure(request)
        self.assertNotIn('roles_not_granted', plain)

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
        modules = ['nasq_api', 'nasq_core', 'nasq_platform', 'nasq_pmo']
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


class SigtermTests(unittest.TestCase):
    def test_sigterm_during_run_script_kills_the_current_container(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for name in ('compose.yml', 'env'):
                (root / name).write_text('')
            request = make_request(
                fence=1, attemptId='aaaaaaaa-1111-4111-8111-111111111111',
                config={'schemaVersion': 1, 'projectName': 'nasq-shared-acme', 'composeFile': str(root / 'compose.yml'),
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
        self.assertRegex(killed[0][2], r'^nasq-shared-acme-effect-aaaaaaaa-observe-[0-9a-f]{8}$')


if __name__ == '__main__':
    unittest.main()
