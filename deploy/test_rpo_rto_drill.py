# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The RPO/RTO drill may only create and drop a database this repository owns (issue #463).

The drill drops ``--db`` twice: once before it seeds, and once while the failure is
simulated. The guard was an exact-match set of six names, so ``--db odoo19_copy`` or
``--db liwan_prod_copy`` passed it and the source database was deleted. These tests pin
the boundary that replaces it: a drill name is a plain identifier, carries no
live-looking segment, and both starts with ``liwan_`` and ends with ``_scratch``.
"""
import unittest

from deploy import rpo_rto_drill as drill


class TestDrillDatabaseGuard(unittest.TestCase):
    def test_the_defaults_of_the_cli_are_drill_names(self) -> None:
        args = drill.build_parser().parse_args(['--odoo-root', '/tmp/odoo', '--output-dir', '/tmp/out'])
        self.assertEqual(drill.validate_db_name(args.db, '--db'), args.db)
        self.assertEqual(drill.validate_db_name(args.restored_db, '--restored-db'), args.restored_db)

    def test_a_live_or_ambiguous_name_is_refused(self) -> None:
        for name in (
            'odoo19',
            'production',
            'postgres',
            'template0',
            'odoo19_copy',
            'odoo19_scratch',
            'liwan_prod_copy',
            'liwan_production_scratch',
            'customer_live',
            'liwan_scratch',
            'scratch_liwan',
            'liwan_backupcopy',
            'liwan_restore_scratch ',
            'liwan-restore-scratch',
            '',
            '1liwan_restore_scratch',
        ):
            with self.subTest(name=name), self.assertRaises(drill.DrillError):
                drill.validate_db_name(name)

    def test_a_drill_owned_name_is_accepted(self) -> None:
        for name in (
            'liwan_rpo_rto_drill_scratch_src',
            'liwan_rpo_rto_drill_scratch_restored',
            'liwan_restore_scratch',
        ):
            with self.subTest(name=name):
                self.assertEqual(drill.validate_db_name(name), name)

    def test_dropdb_refuses_before_running_any_command(self) -> None:
        calls = []

        def runner(argv, **kwargs):
            calls.append(argv)
            raise AssertionError('dropdb must not run for an unsafe name')

        original = drill.run
        drill.run = runner
        try:
            cfg = drill.DrillConfig(
                odoo_root=drill.Path('/tmp/odoo'), repo_root=drill.REPO_ROOT, work_dir=drill.Path('/tmp/w'),
                db='liwan_rpo_rto_drill_scratch_src', restored_db='liwan_rpo_rto_drill_scratch_restored',
                pg_host='127.0.0.1', pg_user='odoo', pg_password='odoo',
                employees=1, projects=1, tasks_per_project=1, attachments_per_task=0, attachment_kib=1,
            )
            for name in ('odoo19_copy', 'liwan_prod_copy', 'liwan_backupcopy'):
                with self.assertRaises(drill.DrillError):
                    drill.dropdb(cfg, name)
            self.assertEqual(calls, [])
        finally:
            drill.run = original

    def test_the_guard_covers_a_name_that_merely_contains_scratch(self) -> None:
        """A copy of a live database named to look like a drill one is still refused."""
        with self.assertRaises(drill.DrillError):
            drill.validate_db_name('liwan_odoo19_copy_scratch')

    def test_an_existing_database_is_refused_before_the_seed(self) -> None:
        """A name that already holds data is not the drill's own, so it is never dropped (issue #463)."""
        cfg = drill.DrillConfig(
            odoo_root=drill.Path('/tmp/odoo'), repo_root=drill.REPO_ROOT, work_dir=drill.Path('/tmp/w'),
            db='liwan_rpo_rto_drill_scratch_src', restored_db='liwan_rpo_rto_drill_scratch_restored',
            pg_host='127.0.0.1', pg_user='odoo', pg_password='odoo',
            employees=1, projects=1, tasks_per_project=1, attachments_per_task=0, attachment_kib=1,
        )
        original = drill.run
        answers = {'exists': '1\n', 'absent': ''}
        try:
            def run_exists(argv, **kwargs):
                return drill.subprocess.CompletedProcess(argv, 0, stdout=answers['exists'], stderr='')
            drill.run = run_exists
            with self.assertRaises(drill.DrillError):
                drill.require_absent(cfg, cfg.db)

            def run_absent(argv, **kwargs):
                return drill.subprocess.CompletedProcess(argv, 0, stdout=answers['absent'], stderr='')
            drill.run = run_absent
            drill.require_absent(cfg, cfg.db)
        finally:
            drill.run = original

    def test_a_failed_existence_check_is_an_error_not_an_assumption(self) -> None:
        cfg = drill.DrillConfig(
            odoo_root=drill.Path('/tmp/odoo'), repo_root=drill.REPO_ROOT, work_dir=drill.Path('/tmp/w'),
            db='liwan_rpo_rto_drill_scratch_src', restored_db='liwan_rpo_rto_drill_scratch_restored',
            pg_host='127.0.0.1', pg_user='odoo', pg_password='odoo',
            employees=1, projects=1, tasks_per_project=1, attachments_per_task=0, attachment_kib=1,
        )
        original = drill.run
        try:
            drill.run = lambda argv, **kwargs: drill.subprocess.CompletedProcess(argv, 2, stdout='', stderr='boom')
            with self.assertRaises(drill.DrillError):
                drill.require_absent(cfg, cfg.db)
        finally:
            drill.run = original


if __name__ == '__main__':
    unittest.main()
