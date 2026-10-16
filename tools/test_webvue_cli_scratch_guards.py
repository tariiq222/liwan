# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Regression baseline for scratch-target admission in the local operator.

These tests pin the *existing* safety behaviour of ``tools/webvue_cli/operator.py``
before any later task widens the managed-target boundary. They cover four
admission guards:

1. a target whose ``kind`` is not exactly ``scratch`` is refused before any
   child command runs,
2. an unknown target id is invalid input before any child command runs,
3. two inventory ids that alias one physical database or one data directory are
   refused,
4. the inventory document itself must be the strict full version-2 shape.

Scope and limits: this is source-level admission coverage only. Every external
command is replaced by an injected fake or by a runner that fails the test if it
is ever reached; no ``psql``, ``odoo-bin``, subprocess, database or service is
started, and the only filesystem writes land in a ``TemporaryDirectory`` owned by
the test. Nothing here proves a live install, and nothing here asserts a runtime
impossibility: the automated end-to-end worker/operator coverage gap is separate
and is not exercised by these unit tests.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from webvue_cli import operator

PROFILE_LINE = 'non_saas\x1flocal_policy\x1f\x1f3\x1f1\x1factive\n'
DEFAULT_FEATURES = {
    'users.limit': 25,
    'storage.limit_mb': None,
    'pmo.enabled': True,
}
REFUSAL_MESSAGE = 'admission must be refused before any child command runs'


class _ForbiddenRunner:
    """Injected runner that fails the test if admission ever reaches it."""

    def __init__(self):
        self.calls = []

    def __call__(self, argv, env=None, stdin_text=None):
        self.calls.append((argv, env, stdin_text))
        raise AssertionError(REFUSAL_MESSAGE)


class _InspectRunner:
    """Injected runner answering only the two read-only snapshot queries."""

    def __init__(self, features=None):
        self.calls = []
        self.features = DEFAULT_FEATURES if features is None else features

    def __call__(self, argv, env=None, stdin_text=None):
        self.calls.append((argv, env, stdin_text))
        if 'features::text' in argv[-1]:
            return 0, json.dumps(self.features) + '\n', ''
        return 0, PROFILE_LINE, ''


class ScratchGuardCase(unittest.TestCase):
    """Builds the real full version-2 inventory entry used by the operator."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'state'
        self.data = self.root / 'data'
        self.backups = self.root / 'backups'
        self.releases = self.root / 'releases'
        self.addons = self.root / 'addons'
        for directory in (self.data, self.backups, self.releases, self.addons):
            directory.mkdir()
        for module in operator.CREATE_MODULES:
            module_dir = self.addons / module
            module_dir.mkdir()
            (module_dir / '__manifest__.py').write_text('{}')
        self.tools = {}
        for name in ('odoo-bin', 'psql', 'pg_dump', 'pg_restore', 'createdb'):
            path = self.root / name
            path.write_text('fixture')
            self.tools[name] = str(path)
        self.classification = self.root / 'classification.json'
        self.classification.write_text(json.dumps({
            'schema_version': 1, 'database': 'webvue_scratch_demo',
            'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }))
        self.inventory = self.root / 'inventory.json'
        self.base_entry = {
            'database': 'webvue_scratch_demo', 'kind': 'scratch',
            'pg_host': '127.0.0.1', 'pg_port': 5432, 'pg_user': 'scratch_user',
            'python': sys.executable, 'odoo_bin': self.tools['odoo-bin'],
            'addons_paths': [str(self.addons)], 'data_dir': str(self.data),
            'psql': self.tools['psql'], 'pg_dump': self.tools['pg_dump'],
            'pg_restore': self.tools['pg_restore'],
            'createdb': self.tools['createdb'],
            'backup_root': str(self.backups), 'release_root': str(self.releases),
            'classification_file': str(self.classification),
        }
        self.old_env = {name: os.environ.get(name) for name in (
            operator.INVENTORY_ENV, operator.STATE_ENV, 'PGPASSWORD')}
        os.environ[operator.INVENTORY_ENV] = str(self.inventory)
        os.environ[operator.STATE_ENV] = str(self.state)
        os.environ['PGPASSWORD'] = 'hidden-password'
        self.addCleanup(self.restore_env)
        self.write_inventory({'demo': self.base_entry})

    def restore_env(self):
        for name, value in self.old_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def entry(self, **overrides):
        """A full version-2 entry with one field deliberately changed."""
        entry = dict(self.base_entry)
        entry.update(overrides)
        return entry

    def write_inventory(self, targets, *, version=2):
        self.inventory.write_text(json.dumps({'version': version, 'targets': targets}))

    def fields(self, operation='tenant.inspect', target='demo', **extra):
        result = {'operation': operation, 'target': target}
        result.update(extra)
        return result

    def refuse(self, expected_code, expected_error, fields=None, runner=None):
        """Run one operation and assert it was refused before the runner."""
        runner = _ForbiddenRunner() if runner is None else runner
        code, payload = operator.operation_adapter(
            self.fields() if fields is None else fields, runner=runner)
        self.assertEqual(code, expected_code, payload)
        self.assertEqual(payload['status'], 'error', payload)
        self.assertEqual(payload['error']['code'], expected_error, payload)
        self.assertEqual(runner.calls, [], 'the admission guard must precede any child command')
        return payload

    # --- positive control -------------------------------------------------

    def test_full_v2_scratch_entry_is_admitted_and_reaches_the_runner(self):
        """The fixture itself is valid, so the refusal tests cannot pass vacuously."""
        runner = _InspectRunner()
        code, payload = operator.operation_adapter(self.fields(), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['status'], 'ok', payload)
        self.assertEqual(payload['stage'], 'snapshot', payload)
        self.assertEqual(payload['profile']['commercial_mode'], 'non_saas')
        self.assertEqual(payload['profile']['policy_revision'], 3)
        self.assertTrue(runner.calls, 'an admitted scratch read must reach the runner')
        argv = runner.calls[0][0]
        self.assertEqual(argv[0], self.tools['psql'])
        self.assertEqual(argv[argv.index('-d') + 1], 'webvue_scratch_demo')

    # --- guard 1: kind must be exactly scratch ----------------------------

    def test_customer_kind_is_refused_before_any_child_command(self):
        self.write_inventory({'demo': self.entry(kind='customer')})
        self.refuse(3, 'target_forbidden')

    def test_customer_kind_is_refused_even_when_the_database_is_named_scratch(self):
        """``kind`` is authoritative; a scratch-looking database name is not enough."""
        self.write_inventory({'demo': self.entry(kind='customer', database='webvue_scratch_customer')})
        self.refuse(3, 'target_forbidden')

    def test_kind_is_refused_for_every_operation_before_child_handling(self):
        """Minimal fields prove admission precedes per-operation input handling."""
        self.write_inventory({'demo': self.entry(kind='customer')})
        for operation in ('tenant.inspect', 'health', 'tenant.preflight', 'tenant.entitle',
                          'tenant.create', 'backup', 'restore', 'upgrade', 'status'):
            with self.subTest(operation=operation):
                self.refuse(3, 'target_forbidden', fields=self.fields(operation=operation))

    def test_unknown_kind_values_are_refused(self):
        for kind in ('production', 'managed', 'customer_hosted'):
            with self.subTest(kind=kind):
                self.write_inventory({'demo': self.entry(kind=kind)})
                self.refuse(3, 'target_forbidden')

    def test_scratch_kind_is_the_admitted_shape(self):
        self.write_inventory({'demo': self.entry(kind='scratch')})
        runner = _InspectRunner()
        code, payload = operator.operation_adapter(self.fields(), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['stage'], 'snapshot')

    # --- guard 2: unknown target ------------------------------------------

    def test_unknown_target_is_invalid_input(self):
        self.refuse(2, 'invalid_input', fields=self.fields(target='missing'))

    def test_unknown_target_is_refused_before_an_unknown_operation(self):
        payload = self.refuse(2, 'invalid_input', fields=self.fields('tenant.nonsense', target='missing'))
        self.assertEqual(payload['error']['message'],
                         'target is absent or inventory entry is incomplete')

    def test_known_target_with_an_unknown_operation_is_still_invalid_input(self):
        self.refuse(2, 'invalid_input', fields=self.fields('tenant.nonsense'))

    def test_inventory_environment_variable_is_required(self):
        os.environ.pop(operator.INVENTORY_ENV, None)
        self.refuse(2, 'invalid_input')

    # --- guard 3: aliases -------------------------------------------------

    def test_alias_to_the_same_database_is_refused(self):
        self.write_inventory({'demo': self.base_entry, 'alias': self.entry()})
        self.refuse(3, 'target_alias_forbidden')

    def test_alias_is_refused_when_the_selected_target_is_the_second_one(self):
        self.write_inventory({'alias': self.entry(), 'demo': self.base_entry})
        self.refuse(3, 'target_alias_forbidden', fields=self.fields(target='demo'))

    def test_alias_to_the_same_data_directory_is_refused(self):
        other = self.entry(database='webvue_scratch_other',
                           classification_file=str(self.classification))
        self.write_inventory({'demo': self.base_entry, 'alias': other})
        self.refuse(3, 'target_alias_forbidden')

    def test_alias_among_three_targets_is_refused(self):
        clean_data = self.root / 'data-clean'
        clean_data.mkdir()
        clean = self.entry(database='webvue_scratch_clean', data_dir=str(clean_data))
        self.write_inventory({
            'demo': self.base_entry,
            'clean': clean,
            'alias': self.entry(database='webvue_scratch_clean',
                                data_dir=str(clean_data)),
        })
        self.refuse(3, 'target_alias_forbidden', fields=self.fields(target='clean'))

    def test_alias_is_detected_whichever_member_is_selected(self):
        """Either member of an alias pair is refused once it is the requested target."""
        clean_data = self.root / 'data-clean'
        clean_data.mkdir()
        self.write_inventory({
            'demo': self.base_entry,
            'clean': self.entry(database='webvue_scratch_clean', data_dir=str(clean_data)),
        })
        self.assertEqual(operator.operation_adapter(self.fields(target='clean'),
                                                    runner=_InspectRunner())[0], 0)
        self.write_inventory({
            'demo': self.base_entry,
            'clean': self.entry(database='webvue_scratch_clean', data_dir=str(clean_data)),
            'moved': self.entry(),
        })
        self.refuse(3, 'target_alias_forbidden', fields=self.fields(target='moved'))

    def test_alias_between_two_unselected_targets_is_not_a_global_check(self):
        """The guard is selected-target-relative.

        A pair that aliases each other is not reported while a third, unrelated
        target is the requested one. Either member of the pair is still refused
        as soon as it is selected (see the test above), so the operation that
        actually runs is always covered.
        """
        demo_two = self.entry()
        unrelated_data = self.root / 'data-unrelated'
        unrelated_data.mkdir()
        self.write_inventory({
            'demo': self.base_entry,
            'demo-two': demo_two,
            'unrelated': self.entry(database='webvue_scratch_unrelated',
                                    data_dir=str(unrelated_data)),
        })
        runner = _InspectRunner()
        code, payload = operator.operation_adapter(
            self.fields(target='unrelated'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertTrue(runner.calls)

    def test_same_database_on_a_different_host_is_not_an_alias(self):
        """The alias identity is the (host, port, database) triple or the data dir."""
        other_data = self.root / 'data-other'
        other_data.mkdir()
        other = self.entry(pg_host='127.0.0.2', data_dir=str(other_data))
        self.write_inventory({'demo': self.base_entry, 'remote': other})
        runner = _InspectRunner()
        code, payload = operator.operation_adapter(self.fields(target='remote'), runner=runner)
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload['stage'], 'snapshot')
        self.assertTrue(runner.calls)

    # --- guard 4: strict inventory document shape -------------------------

    def test_incomplete_entry_is_invalid_input(self):
        incomplete = self.entry()
        incomplete.pop('pg_user')
        self.write_inventory({'demo': incomplete})
        self.refuse(2, 'invalid_input')

    def test_entry_with_an_extra_key_is_invalid_input(self):
        self.write_inventory({'demo': self.entry(unexpected_key='value')})
        self.refuse(2, 'invalid_input')

    def test_an_unselected_incomplete_entry_is_invalid_input(self):
        incomplete = self.entry()
        incomplete.pop('psql')
        self.write_inventory({'demo': self.base_entry, 'broken': incomplete})
        self.refuse(2, 'invalid_input')

    def test_version_one_inventory_is_refused_by_the_operator(self):
        """The legacy version-1 document is a separate compatibility lane."""
        self.write_inventory({'demo': self.base_entry}, version=1)
        self.refuse(2, 'invalid_input')

    def test_missing_targets_mapping_is_invalid_input(self):
        self.inventory.write_text(json.dumps({'version': 2}))
        self.refuse(2, 'invalid_input')

    def test_forbidden_database_names_are_refused(self):
        for database in ('odoo19', 'production', 'webvue_scratch_odoo19',
                         'webvue_scratch_production', 'webvue_scratch_prod',
                         'webvue_demo', 'webvue_scratch_demo_prod'):
            with self.subTest(database=database):
                self.write_inventory({'demo': self.entry(database=database)})
                self.refuse(3, 'target_forbidden')

    def test_explicit_postgres_coordinates_are_required(self):
        for overrides in ({'pg_host': ''}, {'pg_user': 'Not-An-Identifier'},
                          {'pg_port': 70000}, {'pg_port': '5432'}):
            with self.subTest(**overrides):
                self.write_inventory({'demo': self.entry(**overrides)})
                self.refuse(2, 'invalid_input')

    def test_missing_inventory_directories_are_invalid_input(self):
        self.write_inventory({'demo': self.entry(data_dir=str(self.root / 'absent'))})
        self.refuse(2, 'invalid_input')

    def test_addons_paths_must_be_existing_absolute_directories(self):
        self.write_inventory({'demo': self.entry(addons_paths=[str(self.root / 'absent')])})
        self.refuse(2, 'invalid_input')


if __name__ == '__main__':
    unittest.main()
