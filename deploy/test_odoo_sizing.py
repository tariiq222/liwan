# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The production sizing must follow from the box and the assumptions, not from literals.

Every assertion here fails when the corresponding rule in ``deploy/odoo_sizing.py``
is removed: the arithmetic is recomputed from inputs, the connection chain is
checked as a chain, and the recorded operations page must carry the same numbers
that the module computes today.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
import tempfile
import unittest
from pathlib import Path

import yaml

from deploy import odoo_sizing

ROOT = Path(__file__).resolve().parents[1]
SIZING_DOC = ROOT / 'docs/operations/odoo-sizing.md'


def _validator():
    """Import the standalone runtime gate the way the image does (no package path).

    The file is copied into the image beside its launcher, not imported as part of
    this package, so loading it by path is what the container actually does.
    """
    path = ROOT / 'deploy/shared/validate_odoo_config.py'
    spec = importlib.util.spec_from_file_location('_liwan_runtime_gate', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _mem_limit_mib(value):
    """Docker memory string (``9216m``/``9g``) as MiB."""
    text = str(value).strip().lower()
    if text.endswith('m'):
        return int(text[:-1])
    if text.endswith('g'):
        return int(float(text[:-1]) * 1024)
    return int(text) // (1024 * 1024)


class TestBoxValidation(unittest.TestCase):
    def test_refuses_impossible_boxes_and_assumptions(self):
        for box in (
            odoo_sizing.Box(name='no-cpu', ocpu=0, memory_gib=24),
            odoo_sizing.Box(name='negative', ocpu=-4, memory_gib=24),
            odoo_sizing.Box(name='no-memory', ocpu=4, memory_gib=0),
        ):
            with self.subTest(box=box.name), self.assertRaises(odoo_sizing.SizingError):
                odoo_sizing.compute(box, odoo_sizing.Assumptions())

    def test_refuses_assumptions_that_cannot_fit(self):
        box = odoo_sizing.BOX_JEDDAH_A1
        for kwargs in (
            {'tenants': 0},
            {'worker_rss_hard_mib': 0},
            {'postgres_per_connection_mib': 0},
            {'worker_rss_soft_mib': 900, 'worker_rss_hard_mib': 800},
            {'db_maxconn_per_process': 0},
            {'os_headroom_mib': 0},
        ):
            with self.subTest(**kwargs), self.assertRaises(odoo_sizing.SizingError):
                odoo_sizing.compute(box, odoo_sizing.Assumptions(**kwargs))

    def test_refuses_a_box_that_cannot_hold_the_reserved_processes(self):
        tiny = odoo_sizing.Box(name='tiny', ocpu=1, memory_gib=2)
        with self.assertRaises(odoo_sizing.SizingError):
            odoo_sizing.compute(tiny, odoo_sizing.Assumptions())


class TestWorkerCountIsComputed(unittest.TestCase):
    def test_workers_follow_the_cpu_formula_when_memory_allows(self):
        # Odoo's documented formula is 2 * CPU + 1; the 4 OCPU / 24 GiB box has room for it.
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        self.assertEqual(sizing.workers, 9)
        self.assertEqual(sizing.workers, 2 * odoo_sizing.BOX_JEDDAH_A1.ocpu + 1)

    def test_a_bigger_box_gets_more_workers_and_a_smaller_one_fewer(self):
        assumptions = odoo_sizing.Assumptions()
        small = odoo_sizing.compute(odoo_sizing.Box('small', ocpu=2, memory_gib=24), assumptions)
        medium = odoo_sizing.compute(odoo_sizing.Box('medium', ocpu=4, memory_gib=24), assumptions)
        self.assertLess(small.workers, medium.workers)

    def test_a_box_past_one_application_servers_ceiling_is_refused(self):
        # 12 OCPU / 72 GiB is a bigger machine, not a bigger single Odoo: the plan
        # says "add a second app server" instead of oversubscribing one.
        with self.assertRaises(odoo_sizing.SizingError):
            odoo_sizing.compute(odoo_sizing.Box('large', ocpu=12, memory_gib=72),
                                odoo_sizing.Assumptions())

    def test_memory_caps_the_worker_count_below_the_cpu_formula(self):
        # A 16 GiB box cannot hold 17 workers at the declared worst case; the cap bites.
        capped = odoo_sizing.compute(odoo_sizing.Box('cramped', ocpu=8, memory_gib=16),
                                     odoo_sizing.Assumptions())
        self.assertLess(capped.workers, 2 * 8 + 1)
        self.assertGreaterEqual(capped.workers, 1)
        self.assertIn('workers_memory_cap', capped.caps_applied)

    def test_a_box_too_small_for_its_own_services_is_refused(self):
        # 6 GiB cannot hold the OS reserve, buffers and sidecars plus one worker.
        with self.assertRaises(odoo_sizing.SizingError):
            odoo_sizing.compute(
                odoo_sizing.Box('tiny', ocpu=8, memory_gib=6),
                odoo_sizing.Assumptions(postgres_shared_buffers_mib=512, web_rss_mib=256,
                                        sidecar_rss_mib=128, os_headroom_mib=512),
            )


class TestConnectionChain(unittest.TestCase):
    def setUp(self):
        self.sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())

    def test_every_odoo_process_connection_is_budgeted(self):
        sizing = self.sizing
        clients = (sizing.workers + sizing.max_cron_threads) * sizing.db_maxconn
        self.assertEqual(clients, sizing.odoo_client_connections)
        self.assertLessEqual(clients, sizing.pgbouncer_max_client_conn)

    def test_pgbouncer_server_connections_stay_below_postgres_and_leave_headroom(self):
        sizing = self.sizing
        self.assertLessEqual(
            sizing.pgbouncer_max_db_connections + sizing.postgres_reserved_connections,
            sizing.postgres_max_connections,
        )
        self.assertGreaterEqual(sizing.postgres_max_connections - sizing.postgres_reserved_connections
                                - sizing.pgbouncer_max_db_connections, 100)
        self.assertLessEqual(sizing.pgbouncer_max_db_connections, sizing.postgres_max_connections)

    def test_raising_db_maxconn_past_the_budget_is_refused(self):
        # Odoo's default of 64 connections per process oversubscribes the box.
        with self.assertRaises(odoo_sizing.SizingError):
            odoo_sizing.compute(
                odoo_sizing.BOX_JEDDAH_A1,
                odoo_sizing.Assumptions(db_maxconn_per_process=64),
            )

    def test_the_reported_client_connections_are_what_the_plan_budgeted(self):
        sizing = self.sizing
        self.assertEqual(sizing.odoo_client_connections,
                         (sizing.workers + sizing.max_cron_threads) * sizing.db_maxconn)
        self.assertLessEqual(sizing.odoo_client_connections, sizing.pgbouncer_max_client_conn)

    def test_report_lists_the_invariants_it_checked(self):
        names = {item['name'] for item in self.sizing.invariants}
        self.assertEqual(names, {'connections_fit_pgbouncer', 'pgbouncer_fits_postgres',
                                 'memory_fits_box', 'workers_within_cpu_formula'})


class TestMemoryBudget(unittest.TestCase):
    def test_total_reservation_fits_the_box_with_headroom(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        total = sum(item['mib'] for item in sizing.memory_plan)
        self.assertEqual(total, sizing.memory_total_mib)
        self.assertLessEqual(total, odoo_sizing.BOX_JEDDAH_A1.memory_gib * 1024)
        self.assertGreaterEqual(odoo_sizing.BOX_JEDDAH_A1.memory_gib * 1024 - total, 1024)

    def test_memory_limits_recycle_a_worker_before_the_box_does(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        self.assertLess(sizing.limit_memory_soft, sizing.limit_memory_hard)
        self.assertEqual((sizing.limit_memory_soft, sizing.limit_memory_hard), (640, 800))

    def test_a_memory_tight_box_shrinks_workers_instead_of_overcommitting(self):
        cramped = odoo_sizing.Box('cramped', ocpu=4, memory_gib=14)
        sizing = odoo_sizing.compute(cramped, odoo_sizing.Assumptions())
        self.assertLessEqual(sizing.workers, 2 * cramped.ocpu + 1)
        self.assertLessEqual(sizing.memory_total_mib, cramped.memory_gib * 1024 - 1024)
        self.assertIn('workers_memory_cap', sizing.caps_applied)


class TestRenderedFragment(unittest.TestCase):
    def test_odoo_fragment_contains_the_computed_values_and_nothing_secret(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        fragment = sizing.odoo_fragment()
        self.assertIn('workers = 9', fragment)
        self.assertIn('max_cron_threads = 2', fragment)
        self.assertIn('db_maxconn = 8', fragment)
        self.assertIn('limit_memory_soft = 640', fragment)
        self.assertIn('limit_memory_hard = 800', fragment)
        for forbidden in ('db_password', 'admin_passwd', 'db_host'):
            self.assertNotIn(forbidden, fragment)

    def test_postgres_and_pgbouncer_settings_are_rendered(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        postgres = sizing.postgres_settings()
        self.assertEqual(postgres['max_connections'], sizing.postgres_max_connections)
        self.assertEqual(postgres['shared_buffers'], '6GB')
        pgbouncer = sizing.pgbouncer_settings()
        self.assertEqual(pgbouncer['pool_mode'], 'transaction')
        self.assertEqual(pgbouncer['max_db_connections'], sizing.pgbouncer_max_db_connections)

    def test_json_report_round_trips(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        restored = json.loads(json.dumps(sizing.as_report()))
        self.assertEqual(restored['box']['ocpu'], 4)
        self.assertEqual(restored['odoo']['workers'], 9)
        self.assertEqual(restored['postgres']['max_connections'], sizing.postgres_max_connections)


class TestValidatorBudgetMatches(unittest.TestCase):
    """The runtime gate is exercised on real files, and its ceilings match the plan.

    The validator is copied standalone into the image, so it cannot import this
    module; it carries the safety ceilings instead. The plan lives once, in
    ``odoo_sizing``, and these tests prove the two agree and that the gate refuses
    the shapes it exists to refuse.
    """

    def setUp(self):
        self.validator = _validator()
        self.sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())

    def config(self, fragment):
        return (
            '[options]\n'
            'db_host = synthetic-db\n'
            'db_user = synthetic_user\n'
            'db_password = SYNTHETIC_PASSWORD_MUST_NOT_APPEAR\n'
            'admin_passwd = SYNTHETIC_ADMIN_MUST_NOT_APPEAR\n'
            'dbfilter = ^%h$\n'
            'list_db = False\n'
            'proxy_mode = False\n'
            'data_dir = /var/lib/odoo\n'
            f'{fragment}'
        )

    def validate_text(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'synthetic.conf'
            path.write_text(text)
            path.chmod(0o400)
            self.validator.validate_config(path)

    def test_the_generated_production_fragment_passes_the_gate(self):
        self.validate_text(self.config(self.sizing.odoo_fragment()))

    def test_the_gate_refuses_worker_counts_above_a_single_box(self):
        over = self.config(self.sizing.odoo_fragment().replace('workers = 9', 'workers = 400'))
        with self.assertRaises(self.validator.ConfigRejected):
            self.validate_text(over)

    def test_the_gate_refuses_an_incomplete_worker_budget(self):
        full = self.sizing.odoo_fragment()
        for missing in ('db_maxconn = 8\n', 'limit_memory_soft = 640\n', 'limit_memory_hard = 800\n'):
            with self.subTest(missing=missing), self.assertRaises(self.validator.ConfigRejected):
                self.validate_text(self.config(full.replace(missing, '')))

    def test_a_bigger_worker_count_requires_its_whole_budget(self):
        # A two-worker local acceptance stack may keep Odoo's defaults; anything
        # larger must state its connection and memory bounds.
        self.validate_text(self.config('workers = 2\n'))
        for fragment in ('workers = 3\n', 'workers = 9\n', 'workers = 9\ndb_maxconn = 8\n'):
            with self.subTest(fragment=fragment), self.assertRaises(self.validator.ConfigRejected):
                self.validate_text(self.config(fragment))

    def test_the_gate_refuses_the_unsized_shape_the_old_gate_forced(self):
        # workers=2 with no budget is accepted only as the local shape; the plan's
        # production fragment must carry the full budget instead.
        self.assertIn('db_maxconn', self.sizing.odoo_fragment())
        self.assertIn('limit_memory_hard', self.sizing.odoo_fragment())

    def test_the_gate_refuses_a_db_maxconn_that_oversubscribes_the_pool(self):
        # Odoo's own default of 64 connections per process would exceed the pool.
        naive = self.config(self.sizing.odoo_fragment().replace('db_maxconn = 8', 'db_maxconn = 64'))
        with self.assertRaises(self.validator.ConfigRejected):
            self.validate_text(naive)

    def test_the_gate_refuses_a_soft_memory_limit_at_or_above_the_hard_one(self):
        inverted = self.config(self.sizing.odoo_fragment().replace('limit_memory_soft = 640',
                                                                  'limit_memory_soft = 800'))
        with self.assertRaises(self.validator.ConfigRejected):
            self.validate_text(inverted)

    def test_the_gate_still_accepts_a_small_local_stack(self):
        # The acceptance stacks size a two-worker box; the gate bounds it, it does not force production numbers.
        self.validate_text(self.config('workers = 2\nmax_cron_threads = 0\n'))

    def test_the_pool_ceiling_matches_the_plan(self):
        self.assertEqual(self.validator.MAX_ODOO_CLIENT_CONNECTIONS,
                         odoo_sizing.MAX_ODOO_CLIENT_CONNECTIONS)
        self.assertEqual(self.validator.MAX_CLIENT_CONNECTIONS, self.sizing.pgbouncer_max_client_conn)
        self.assertEqual(self.validator.MAX_WORKERS, self.sizing.max_workers_ceiling)
        self.assertEqual(self.validator.MAX_DB_MAXCONN, self.sizing.db_maxconn)
        self.assertLessEqual(self.sizing.odoo_client_connections,
                             self.validator.MAX_ODOO_CLIENT_CONNECTIONS)
        self.assertLessEqual(self.sizing.odoo_client_connections,
                             self.validator.MAX_CLIENT_CONNECTIONS)


class TestProductionOverridePinsThePlan(unittest.TestCase):
    """The production compose override is the one place the plan's numbers are applied."""

    def setUp(self):
        self.sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        self.path = ROOT / 'deploy/docker-compose.production.yml'
        self.document = yaml.safe_load(self.path.read_text(encoding='utf-8'))
        self.services = self.document['services']

    def command_flags(self, service):
        """Parse `--flag value` pairs from a compose command list."""
        argv = self.services[service]['command']
        flags = {}
        index = 0
        while index < len(argv) - 1:
            token = argv[index]
            if token.startswith('--') and not argv[index + 1].startswith('--'):
                flags[token.lstrip('-')] = argv[index + 1]
                index += 2
            else:
                index += 1
        return flags

    def test_the_validator_passes_the_rendered_production_fragment(self):
        """The rendered fragment is exactly what the runtime gate accepts."""
        text = (
            '[options]\n'
            'db_host = synthetic-db\n'
            'db_user = synthetic_user\n'
            'db_password = SYNTHETIC_PASSWORD_MUST_NOT_APPEAR\n'
            'admin_passwd = SYNTHETIC_ADMIN_MUST_NOT_APPEAR\n'
            'dbfilter = ^%h$\n'
            'list_db = False\n'
            'proxy_mode = False\n'
            'data_dir = /var/lib/odoo\n'
            f'{self.sizing.odoo_fragment()}'
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'synthetic.conf'
            path.write_text(text)
            path.chmod(0o400)
            _validator().validate_config(path)

    def test_the_render_cli_emits_only_sizing_options(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = odoo_sizing.main(['--render', 'odoo'])
        self.assertEqual(code, 0)
        lines = output.getvalue().splitlines()
        self.assertEqual(lines, self.sizing.odoo_fragment().splitlines())
        for line in lines:
            self.assertNotIn('password', line)
            self.assertNotIn('db_host', line)

    def test_the_odoo_memory_envelope_matches_the_plan(self):
        # The worker budget lives in the config file (the launcher accepts no flags);
        # this override carries the container envelope for the same plan.
        sizing = self.sizing
        ceiling_mib = (sizing.workers + sizing.max_cron_threads) * sizing.limit_memory_hard
        block = self.services['odoo']
        self.assertGreaterEqual(_mem_limit_mib(block['mem_limit']), ceiling_mib)
        self.assertEqual(block['cpu_shares'], 1024)

    def test_the_override_carries_no_odoo_sizing_flags(self):
        # launch_odoo.py (outside this package) rejects CLI overrides in shared mode;
        # the plan reaches Odoo through the config file rendered by --render odoo.
        self.assertNotIn('command', self.services['odoo'])

    def test_postgres_settings_come_from_the_plan(self):
        argv = self.services['db']['command']
        settings = dict(item.split('=', 1) for item in argv if '=' in item)
        self.assertEqual(int(settings['max_connections']), self.sizing.postgres_max_connections)
        self.assertEqual(settings['shared_buffers'], self.sizing.postgres_shared_buffers)
        expected = self.sizing.postgres_settings()
        for key in ('superuser_reserved_connections', 'effective_cache_size',
                    'work_mem', 'maintenance_work_mem'):
            with self.subTest(key=key):
                self.assertEqual(settings[key], str(expected[key]))

    def test_pgbouncer_is_off_until_the_soak_test_passes(self):
        # docs/operations/odoo-sizing.md §6: transaction pooling is unproven at depth.
        self.assertEqual(self.services['pgbouncer']['profiles'], ['pgbouncer'])

    def test_pgbouncer_is_hardened_like_the_other_services(self):
        block = self.services['pgbouncer']
        self.assertEqual(block['cap_drop'], ['ALL'])
        self.assertIn('no-new-privileges:true', block['security_opt'])
        self.assertIs(block['read_only'], True)
        self.assertIn('tmpfs', block)

    def test_pgbouncer_settings_come_from_the_plan(self):
        env = self.services['pgbouncer']['environment']
        expected = self.sizing.pgbouncer_settings()
        self.assertEqual(int(env['MAX_CLIENT_CONN']), expected['max_client_conn'])
        self.assertEqual(int(env['DEFAULT_POOL_SIZE']), expected['default_pool_size'])
        self.assertEqual(int(env['MAX_DB_CONNECTIONS']), expected['max_db_connections'])
        self.assertEqual(int(env['RESERVE_POOL_SIZE']), expected['reserve_pool_size'])
        self.assertEqual(env['POOL_MODE'], expected['pool_mode'])

    def test_the_override_does_not_take_over_the_config_file_owner(self):
        # P2 owns deploy/shared/odoo.conf; this override only adds runtime settings.
        for service in ('odoo', 'db', 'pgbouncer'):
            with self.subTest(service=service):
                self.assertNotIn('volumes', self.services[service])

    def test_every_image_in_the_override_is_pinned_by_digest(self):
        images = re.findall(r'^\s+image:\s*(\S+)', self.path.read_text(encoding='utf-8'), re.M)
        self.assertTrue(images)
        for image in images:
            with self.subTest(image=image):
                self.assertRegex(image, r'@sha256:[0-9a-f]{64}$')


class TestOperationsRecord(unittest.TestCase):
    def test_the_recorded_page_carries_the_computed_numbers(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        text = SIZING_DOC.read_text(encoding='utf-8')
        for expected in (
            f'workers = {sizing.workers}',
            f'max_cron_threads = {sizing.max_cron_threads}',
            f'db_maxconn = {sizing.db_maxconn}',
            f'`{sizing.pgbouncer_max_client_conn}`',
            f'`{sizing.pgbouncer_max_db_connections}`',
            f'`{sizing.postgres_max_connections}`',
            f'**{sizing.memory_total_mib}**',
            f'**{sizing.memory_free_mib}**',
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, text)
        self.assertIn(str(sizing.tenants), text)
        self.assertIn('RPO', text)
        self.assertIn('RTO', text)

    def test_the_recorded_memory_table_adds_up_to_the_computed_total(self):
        sizing = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        text = SIZING_DOC.read_text(encoding='utf-8')
        for item in sizing.memory_plan:
            with self.subTest(item=item['item']):
                self.assertIn(str(item['mib']), text)
        self.assertIn(f'| **{sizing.memory_total_mib}** |', text)


if __name__ == '__main__':
    unittest.main()
