# Part of Odoo. See LICENSE file for full copyright and licensing details.
import argparse
import importlib
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent / 'perf'))
odoo_launch = importlib.import_module('odoo_launch')
measure = importlib.import_module('measure')

LOG = (
    '2026-10-19 08:00:00,000 1 INFO db werkzeug: 127.0.0.1 - - [19/Oct/2026 08:00:00] '
    '"GET /api/v1/finance/invoices?q=INV%2F2026%2F0&limit=50 HTTP/1.1" 200 - 22 0.050 0.020\n'
    '2026-10-19 08:00:01,000 1 INFO db werkzeug: 127.0.0.1 - - [19/Oct/2026 08:00:01] '
    '"GET /api/v1/hr/expiring HTTP/1.1" 500 - 3 0.010 0.010\n'
    'unrelated line\n'
)


class TestStatistics(unittest.TestCase):
    def test_percentile_is_nearest_rank(self):
        values = list(range(1, 101))
        self.assertEqual(measure.percentile(values, 0.95), 95)
        self.assertEqual(measure.percentile(values, 0.5), 50)
        self.assertEqual(measure.percentile([7], 0.95), 7)

    def test_p95_is_withheld_below_the_minimum_sample_count(self):
        few = measure.summarise([0.1] * (measure.MIN_SAMPLES_P95 - 1))
        self.assertIsNone(few['p95_s'])
        self.assertEqual(few['p50_s'], 0.1)
        enough = measure.summarise([0.1] * measure.MIN_SAMPLES_P95)
        self.assertEqual(enough['p95_s'], 0.1)
        self.assertEqual(measure.summarise([])['p50_s'], None)

    def test_runs_must_be_positive(self):
        self.assertEqual(measure.positive_int('3'), 3)
        for bad in ('0', '-2'):
            with self.assertRaises(argparse.ArgumentTypeError):
                measure.positive_int(bad)


class TestRequestLog(unittest.TestCase):
    def test_lines_are_parsed_and_joined_on_the_normalised_target(self):
        log = measure.parse_request_log(LOG)
        key = measure.normalise(measure.query('/api/v1/finance/invoices', limit=50, q='INV/2026/0'))
        self.assertEqual(log[key], [(200, 22, 0.05, 0.02)])
        self.assertEqual(log[measure.normalise('/api/v1/hr/expiring')], [(500, 3, 0.01, 0.01)])

    def test_a_route_without_log_samples_fails_loudly(self):
        row = {'route': 'x', 'path': '/api/v1/none', 'samples': 2}
        with self.assertRaises(SystemExit):
            measure.attach_queries([row], LOG)

    def test_non_200_log_lines_are_not_counted(self):
        row = {'route': 'hr', 'path': '/api/v1/hr/expiring', 'samples': 1}
        with self.assertRaises(SystemExit):
            measure.attach_queries([row], LOG)

    def test_queries_are_attached_from_the_last_samples(self):
        row = {'route': 'inv', 'path': measure.query('/api/v1/finance/invoices', limit=50, q='INV/2026/0'), 'samples': 1}
        measure.attach_queries([row], LOG)
        self.assertEqual((row['queries_p50'], row['sql_p50_s'], row['python_p50_s']), (22, 0.05, 0.02))


class TestProcessTree(unittest.TestCase):
    def test_descendants_walk_the_parent_links(self):
        rows = ['10 1 100 odoo-bin', '11 10 200 worker', '12 10 300 worker', '13 12 50 child', '20 1 999 other']
        table = measure.parse_ps(rows)
        self.assertEqual(sorted(measure.descendants(table, 10)), [10, 11, 12, 13])
        self.assertEqual(measure.descendants(table, 20)[20][1], 999)

    def test_malformed_rows_are_skipped(self):
        self.assertEqual(measure.parse_ps(['garbage', '5 1 10 cmd']), {5: (1, 10, 'cmd')})


class TestLaunch(unittest.TestCase):
    def test_non_scratch_databases_are_rejected(self):
        for name in ('odoo19', 'webvue_dev', 'webvue_scratch_', 'postgres', ''):
            with self.assertRaises(odoo_launch.OdooTestError):
                odoo_launch.require_scratch(name)
        self.assertEqual(odoo_launch.require_scratch('webvue_scratch_perf'), 'webvue_scratch_perf')

    def test_protected_ports_are_refused(self):
        for port in (8069, 8072, 3000):
            with self.assertRaises(odoo_launch.OdooTestError):
                odoo_launch.require_free_port(port)

    def test_a_listening_port_is_refused(self):
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen()
            with self.assertRaises(odoo_launch.OdooTestError):
                odoo_launch.require_free_port(server.getsockname()[1])

    def test_the_command_pins_the_database_and_omits_dash_d_without_preload(self):
        with tempfile.TemporaryDirectory() as root, \
                mock.patch.dict('os.environ', {'PERF_ROOT': root}), \
                mock.patch.object(odoo_launch, 'addons_path', return_value='a,b'):
            preload = odoo_launch.odoo_command('shell', 'webvue_scratch_perf', ['--no-http'])
            server = odoo_launch.odoo_command('', 'webvue_scratch_perf', preload=False)
        self.assertIn('shell', preload)
        self.assertEqual(preload[preload.index('-d') + 1], 'webvue_scratch_perf')
        self.assertNotIn('-d', server)
        self.assertIn('--db-filter=^webvue_scratch_perf$', server)
        with self.assertRaises(odoo_launch.OdooTestError):
            odoo_launch.odoo_command('', 'odoo19')


if __name__ == '__main__':
    unittest.main()
