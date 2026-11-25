"""Tests for deploy/release/pools.py: pool ids and order, per-pool paths, the tenant capacity and the one-time
migration of a host that predates pools. No docker, git or database is used."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from deploy import odoo_sizing
from deploy.release import pools
from deploy.release.common import EXIT_REFUSED, ReleaseError


class PoolsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state_root = self.root / 'var'
        self.messages = []

    def log(self, message):
        self.messages.append(message)

    def refused(self, reason, function, *args, **kwargs):
        with self.assertRaises(ReleaseError) as caught:
            function(*args, **kwargs)
        self.assertEqual((caught.exception.reason, caught.exception.exit_code), (reason, EXIT_REFUSED))
        return caught.exception

    # --- the plan ---------------------------------------------------------------------------------------
    def test_a_config_without_the_pool_keys_is_one_pool_named_default(self):
        plan = pools.plan({}, 'staging', self.state_root)
        self.assertEqual((plan.ids, plan.owner, plan.order), (('default',), 'default', ('default',)))
        self.assertEqual(plan.root, self.state_root / 'staging/pools')

    def test_a_second_pool_is_refused_until_the_host_renders_one_stack_per_pool(self):
        for config in ({'LIWAN_RELEASE_POOLS': 'a,b'}, {'LIWAN_RELEASE_POOLS': 'a,b', 'LIWAN_RELEASE_OWNER_POOL': 'b'}):
            with self.subTest(config=config):
                self.refused('pools_per_host_unsupported', pools.plan, config, 'staging', self.state_root)

    def test_an_owner_outside_the_list_is_refused(self):
        self.refused('owner_pool_missing', pools.plan, {'LIWAN_RELEASE_OWNER_POOL': 'b'}, 'staging', self.state_root)
        self.refused('owner_pool_missing', pools.plan,
                     {'LIWAN_RELEASE_POOLS': 'a,b', 'LIWAN_RELEASE_OWNER_POOL': 'c'}, 'staging', self.state_root)

    def test_a_malformed_duplicate_or_relative_pool_setting_is_refused(self):
        for config in ({'LIWAN_RELEASE_POOLS': 'a,a'}, {'LIWAN_RELEASE_POOLS': 'a,,b'}, {'LIWAN_RELEASE_POOLS': 'A'},
                       {'LIWAN_RELEASE_POOLS': 'a-b'}, {'LIWAN_RELEASE_POOL_ROOT': 'pools'}):
            with self.subTest(config=config):
                self.refused('invalid_pools', pools.plan, config, 'staging', self.state_root)

    def test_pool_root_inside_the_environment_directory_must_be_the_default_pools(self):
        env_dir = self.state_root / 'staging'
        env_dir.mkdir(parents=True)
        outside_link = self.root / 'sneaky-link'
        outside_link.symlink_to(env_dir / 'p')
        for bad in (env_dir, env_dir / 'p', env_dir / 'a/b', env_dir / 'pools/nested',
                    env_dir / 'pools/../p', outside_link):
            with self.subTest(pool_root=str(bad)):
                self.refused('invalid_pools', pools.plan, {'LIWAN_RELEASE_POOL_ROOT': str(bad)},
                             'staging', self.state_root)
        # Default (unset or explicit) and roots outside the environment directory are accepted.
        for good in (env_dir / 'pools', self.root / 'pools', self.state_root / 'staging-pools'):
            with self.subTest(pool_root=str(good)):
                plan = pools.plan({'LIWAN_RELEASE_POOL_ROOT': str(good)}, 'staging', self.state_root)
                self.assertEqual(plan.root, good)

    def test_the_owner_is_upgraded_first_and_the_rest_keep_their_config_order(self):
        # A Plan built directly, because a config that declares three pools is refused until the stack renders one per
        # pool: the order and the per-pool paths are what a second pool needs.
        plan = pools.Plan(ids=('a', 'b', 'c'), owner='b', order=('b', 'a', 'c'), root=self.root / 'pools')
        self.assertEqual([pool.id for pool in plan.ordered_paths()], ['b', 'a', 'c'])
        self.assertEqual(plan.owner_paths, plan.paths('b'))
        self.refused('unknown_pool', plan.paths, 'd')

    def test_a_pool_directory_holds_its_state_its_marker_and_its_own_current_link(self):
        plan = pools.Plan(ids=('a',), owner='a', order=('a',), root=self.root / 'pools')
        pool = plan.paths('a')
        self.assertEqual(pool.state, self.root / 'pools/a/state')
        self.assertEqual(pool.release_env, self.root / 'pools/a/state/release.env')
        self.assertEqual(pool.maintenance, self.root / 'pools/a/state/maintenance')
        self.assertEqual(pool.marker, self.root / 'pools/a/state/maintenance/active')
        self.assertEqual(pool.current, self.root / 'pools/a/current')

    # --- the one capacity number ------------------------------------------------------------------------
    def test_the_capacity_is_the_one_number_of_the_sizing_plan(self):
        self.assertEqual(pools.capacity({}), odoo_sizing.DEFAULT_TENANT_CAPACITY)
        self.assertEqual(odoo_sizing.Assumptions().tenants, odoo_sizing.DEFAULT_TENANT_CAPACITY)
        self.assertEqual(odoo_sizing.DEFAULT_TENANT_CAPACITY, 40)
        self.assertEqual(odoo_sizing.TENANT_CAPACITY_CEILING, 42)

    def test_the_capacity_accepts_one_to_the_registry_lru_bound_and_nothing_else(self):
        for value in ('1', '40', '42'):
            with self.subTest(value=value):
                self.assertEqual(pools.capacity({'LIWAN_TENANT_CAPACITY': value}), int(value))
        for value in ('0', '43', 'abc', '-1', '4.0', '٤٠'):
            with self.subTest(value=value):
                self.refused('invalid_tenant_capacity', pools.capacity, {'LIWAN_TENANT_CAPACITY': value})

    def test_a_capacity_of_forty_applies_no_tenant_memory_cap(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions(tenants=40))
        self.assertEqual(sizing.tenants_served, 40)
        self.assertNotIn('tenants_memory_cap', sizing.caps_applied)

    # --- the one-time migration -------------------------------------------------------------------------
    def legacy(self, *names, relative_link=False):
        """The state of a host that predates pools: those files directly in the environment directory."""
        environment = self.state_root / 'staging'
        environment.mkdir(parents=True, exist_ok=True)
        for name in names:
            target = environment / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('{"commit": "old"}\n' if name.endswith('.json') else 'STATE\n')
        (environment / 'lock').write_text('')
        release_dir = self.root / 'releases/old'
        release_dir.mkdir(parents=True, exist_ok=True)
        current = self.root / 'current'
        current.symlink_to(Path('releases/old') if relative_link else release_dir)
        return environment, current

    def migrate(self, environment, current, config=None, resume_unfinished=False):
        plan = pools.plan(config or {}, 'staging', self.state_root)
        return pools.migrate(environment, plan, self.log, current=current, resume_unfinished=resume_unfinished)

    def test_a_host_that_predates_pools_is_migrated_once_into_its_pool(self):
        environment, current = self.legacy('served.json', 'release.env', 'docker-config/config.json', 'releases/old.json')
        moves = self.migrate(environment, current)
        pool = pools.Plan(ids=('default',), owner='default', order=('default',),
                          root=self.state_root / 'staging/pools').paths('default')
        self.assertEqual(sorted(target.relative_to(pool.root).as_posix() for _, target in moves),
                         ['state/docker-config', 'state/release.env', 'state/releases', 'state/served.json'])
        for name in ('served.json', 'release.env', 'releases/old.json', 'docker-config/config.json'):
            self.assertFalse((environment / name).exists())
            self.assertTrue((pool.state / name).exists())
        self.assertEqual(os.readlink(pool.current), str((self.root / 'releases/old').resolve()))
        self.assertEqual([message for message in self.messages if message.startswith('migrated ')],
                         [f'migrated docker-config -> {pool.state / "docker-config"}',
                          f'migrated release.env -> {pool.state / "release.env"}',
                          f'migrated releases -> {pool.state / "releases"}',
                          f'migrated served.json -> {pool.state / "served.json"}'])
        self.assertEqual(self.migrate(environment, current), [])  # nothing is left to move

    def test_a_migration_that_died_before_seeding_the_link_is_repaired_by_the_next_run(self):
        # The proved failure: every entry moved, then the process died before the pool's link was created. The next run
        # has nothing to move and must still seed the link, or the host keeps no pool current.
        environment, current = self.legacy('served.json', 'release.env')
        self.assertTrue(self.migrate(environment, current))
        pool = pools.plan({}, 'staging', self.state_root).owner_paths
        pool.current.unlink()
        self.assertEqual(self.migrate(environment, current), [])
        self.assertEqual(os.readlink(pool.current), str((self.root / 'releases/old').resolve()))
        self.assertEqual(self.migrate(environment, current), [])  # a link that already exists is left alone

    def test_a_relative_host_link_resolves_to_an_absolute_pool_link_and_dangling_pool_link_repairs(self):
        environment, current = self.legacy('served.json', relative_link=True)
        self.assertTrue(self.migrate(environment, current))
        pool = pools.plan({}, 'staging', self.state_root).owner_paths
        target = Path(os.readlink(pool.current))
        self.assertTrue(target.is_absolute())
        self.assertTrue(pool.current.exists())
        self.assertEqual(target, (self.root / 'releases/old').resolve())
        # A dangling pool link (e.g. from an earlier verbatim relative copy) is reseeded on the next run.
        pool.current.unlink()
        pool.current.symlink_to('releases/old')
        self.assertTrue(pool.current.is_symlink() and not pool.current.exists())
        self.assertEqual(self.migrate(environment, current), [])
        self.assertEqual(Path(os.readlink(pool.current)), (self.root / 'releases/old').resolve())
        self.assertTrue(pool.current.exists())

    def test_a_non_symlink_pool_current_is_left_alone_and_a_dangling_host_link_does_not_crash(self):
        environment, current = self.legacy('served.json')
        pool = pools.plan({}, 'staging', self.state_root).owner_paths
        pool.current.mkdir(parents=True)
        self.assertTrue(self.migrate(environment, current))
        self.assertTrue(pool.current.is_dir() and not pool.current.is_symlink())
        # A dangling host link must not crash migrate with FileNotFoundError; require_symlink refuses current_dangling.
        pool.current.rmdir()
        (self.root / 'releases/old').rmdir()
        self.assertTrue(current.is_symlink() and not current.exists())
        self.assertEqual(self.migrate(environment, current), [])
        self.assertFalse(pool.current.is_symlink())

    def test_a_legacy_entry_that_would_overwrite_a_pool_state_file_is_refused(self):
        environment, current = self.legacy('served.json')
        pool = pools.plan({}, 'staging', self.state_root).owner_paths
        pool.state.mkdir(parents=True)
        (pool.state / 'served.json').write_text('{}\n')
        self.refused('legacy_state_ambiguous', self.migrate, environment, current)
        self.assertTrue((environment / 'served.json').exists())  # refused before anything moved

    def test_an_unfinished_legacy_run_is_refused_until_rollback_finishes_it(self):
        environment, current = self.legacy('served.json', 'run.json')
        self.refused('legacy_state_ambiguous', self.migrate, environment, current)
        self.assertTrue((environment / 'run.json').exists())
        moved = self.migrate(environment, current, resume_unfinished=True)
        self.assertIn('run.json', [source.name for source, _ in moved])

    def test_legacy_state_beside_a_second_pool_is_refused(self):
        environment, current = self.legacy('served.json')
        plan = pools.Plan(ids=('a', 'b'), owner='a', order=('a', 'b'), root=self.root / 'pools')
        with self.assertRaises(ReleaseError) as caught:
            pools.migrate(environment, plan, self.log, current=current)
        self.assertEqual(caught.exception.reason, 'legacy_state_ambiguous')
        self.assertTrue((environment / 'served.json').exists())

    def test_a_fresh_host_migrates_nothing(self):
        self.assertEqual(self.migrate(self.state_root / 'staging', self.root / 'current'), [])


if __name__ == '__main__':
    unittest.main()
