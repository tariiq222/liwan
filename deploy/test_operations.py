# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Mock-only tests for isolated check and manual backup wrappers.

These tests must not contact PostgreSQL, Docker, or a live Odoo/Nuxt process.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from deploy import backup, check_isolated


def _touch(path: Path, content: str = '') -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')


def _fake_worktree(root: Path) -> tuple[Path, Path, Path]:
    """Standard Odoo layout: odoo/addons/base plus extra addons/project and addons/hr."""
    worktree = root / 'worktree'
    addons = worktree / 'odoo-addons'
    stock = root / 'addons'
    _touch(root / 'odoo' / 'addons' / 'base' / '__manifest__.py', '{}')
    _touch(stock / 'project' / '__manifest__.py', '{}')
    _touch(stock / 'hr' / '__manifest__.py', '{}')
    for name in check_isolated.LIWAN_ADDONS:
        _touch(addons / name / '__manifest__.py', '{}')
    python = root / 'python'
    odoo_bin = root / 'odoo-bin'
    conf = root / 'odoo.conf'
    _touch(python, 'x')
    _touch(odoo_bin, 'x')
    _touch(conf, '[options]\n')
    python.chmod(0o755)
    odoo_bin.chmod(0o755)
    return worktree, addons, stock


class FakeCompleted:
    def __init__(self, returncode: int = 0) -> None:
        self.returncode = returncode


class TestScratchDbAndPorts(unittest.TestCase):
    def test_rejects_odoo19_and_production_names(self) -> None:
        for name in (
            'odoo19',
            'production',
            'prod',
            'postgres',
            'liwan_scratch_odoo19',
            'liwan_scratch_production',
            'liwan_scratch;dropdb',
            'liwan_scratch && true',
        ):
            with self.subTest(name=name), self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_scratch_db(
                    name,
                    lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                )

    def test_scratch_substring_without_lifecycle_is_rejected(self) -> None:
        for lifecycle in ('', 'existing', 'reuse', 'true', 'scratch', 'CREATE_NEW'):
            with self.subTest(lifecycle=lifecycle), self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_scratch_db('liwan_scratch_wp8_iso', lifecycle=lifecycle)

    def test_accepts_explicit_scratch_name_with_new_lifecycle(self) -> None:
        self.assertEqual(
            check_isolated.validate_scratch_db(
                'liwan_scratch_wp8_iso',
                lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
            ),
            'liwan_scratch_wp8_iso',
        )

    def test_rejects_default_dev_ports(self) -> None:
        for port in (80, 443, 3000, 5432, 8069, 8072, 22):
            with self.subTest(port=port), self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_port(port)

    def test_rejects_localhost_3000_base_url(self) -> None:
        for url in (
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost',
            'https://localhost:443',
        ):
            with self.subTest(url=url), self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_base_url(url)

    def test_rejects_credentials_in_url(self) -> None:
        with self.assertRaises(check_isolated.IsolationError):
            check_isolated.validate_base_url('http://user:secret@127.0.0.1:3100')

    def test_loopback_urls_without_extra_path_are_accepted(self) -> None:
        self.assertEqual(
            check_isolated.validate_base_url('http://127.0.0.1:3100'),
            'http://127.0.0.1:3100',
        )
        self.assertEqual(
            check_isolated.validate_base_url('http://localhost:3100'),
            'http://localhost:3100',
        )
        self.assertEqual(
            check_isolated.validate_odoo_url('http://[::1]:8169'),
            'http://[::1]:8169',
        )
        self.assertEqual(
            check_isolated.validate_ws_url('ws://127.0.0.1:8169/websocket'),
            'ws://127.0.0.1:8169/websocket',
        )

    def test_rejects_remote_hosts_and_unexpected_url_parts(self) -> None:
        for url in (
            'http://example.com:3100',
            'http://192.168.1.8:3100',
            'http://0.0.0.0:3100',
            'http://127.0.0.1:3100/secret',
            'http://127.0.0.1:3100?q=1',
            'http://127.0.0.1:3100/#frag',
            'ws://127.0.0.1:8169',
            'ws://127.0.0.1:8169/websocket?token=1',
            'ws://evil.example:8169/websocket',
        ):
            with self.subTest(url=url), self.assertRaises(check_isolated.IsolationError):
                if url.startswith('ws'):
                    check_isolated.validate_ws_url(url)
                else:
                    check_isolated.validate_base_url(url)

    def test_parser_has_no_dev_defaults(self) -> None:
        parser = check_isolated.build_parser()
        odoo = parser.parse_args
        with self.assertRaises(SystemExit):
            odoo(['odoo'])
        e2e = check_isolated.build_parser()
        with self.assertRaises(SystemExit):
            e2e.parse_args(['e2e'])


class TestOdooWrapper(unittest.TestCase):
    def test_liwan_addons_cover_every_shipped_pillar(self) -> None:
        root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(root / 'tools'))
        try:
            import catalog_check
        finally:
            sys.path.pop(0)
        _name, release = catalog_check.current_release(root)
        self.assertEqual(check_isolated.LIWAN_ADDONS[:3], ('liwan_core', 'liwan_platform', 'liwan_api'))
        self.assertEqual(sorted(check_isolated.LIWAN_ADDONS), release)

    def test_build_odoo_argv_is_explicit_and_overrides_conf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, stock = _fake_worktree(root)
            argv = check_isolated.build_odoo_argv(
                python=str(root / 'python'),
                odoo_bin=str(root / 'odoo-bin'),
                odoo_conf=str(root / 'odoo.conf'),
                stock_addons=str(stock),
                worktree_addons=str(addons),
                scratch_db='liwan_scratch_wp8_iso',
                scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                http_port=8169,
                modules='liwan_core,liwan_api,liwan_pmo,liwan_hr',
                test_tags='/liwan_core,/liwan_api',
            )
            self.assertEqual(argv[0], str((root / 'python').resolve()))
            self.assertIn('-d', argv)
            self.assertEqual(argv[argv.index('-d') + 1], 'liwan_scratch_wp8_iso')
            self.assertIn('--http-port', argv)
            self.assertEqual(argv[argv.index('--http-port') + 1], '8169')
            self.assertTrue(any(item.startswith('--addons-path=') for item in argv))
            joined = next(item for item in argv if item.startswith('--addons-path='))
            core = (root / 'odoo' / 'addons').resolve()
            self.assertIn(str(core), joined)
            self.assertIn(str(addons.resolve()), joined)
            self.assertIn(str(stock.resolve()), joined)
            self.assertTrue(joined.startswith(f'--addons-path={core},{stock.resolve()},'))
            self.assertNotIn('odoo19', argv)
            self.assertNotIn('3000', argv)
            self.assertNotIn('8069', argv)
            self.assertIn('--stop-after-init', argv)
            self.assertEqual(worktree.name, 'worktree')

    def test_pinned_oca_addons_are_appended_last_and_must_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _worktree, addons, stock = _fake_worktree(root)
            oca = root / 'oca' / 'demo'
            oca.mkdir(parents=True)
            kwargs = {
                'python': str(root / 'python'), 'odoo_bin': str(root / 'odoo-bin'),
                'odoo_conf': str(root / 'odoo.conf'), 'stock_addons': str(stock),
                'worktree_addons': str(addons), 'scratch_db': 'liwan_scratch_wp8_iso',
                'scratch_lifecycle': check_isolated.SCRATCH_LIFECYCLE_TOKEN, 'http_port': 8169,
            }
            argv = check_isolated.build_runtime_argv(**kwargs, oca_addons=str(oca))
            joined = next(item for item in argv if item.startswith('--addons-path='))
            self.assertTrue(joined.endswith(f',{addons.resolve()},{oca.resolve()}'))
            argv = check_isolated.build_runtime_argv(**kwargs)
            self.assertTrue(next(item for item in argv if item.startswith('--addons-path=')).endswith(str(addons.resolve())))
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.build_runtime_argv(**kwargs, oca_addons=str(root / 'missing'))

    def test_resolve_oca_addons_fails_closed_when_not_fetched(self) -> None:
        class Done:
            def __init__(self, code: int, out: str, err: str) -> None:
                self.returncode, self.stdout, self.stderr = code, out, err
        worktree = Path('/w')
        self.assertEqual(check_isolated.resolve_oca_addons(worktree, runner=lambda *a, **k: Done(0, '/o/a,/o/b\n', '')), '/o/a,/o/b')
        with self.assertRaises(check_isolated.IsolationError):
            check_isolated.resolve_oca_addons(worktree, runner=lambda *a, **k: Done(2, '', 'run fetch'))

    def test_venv_python_symlink_is_kept_in_argv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _worktree, addons, stock = _fake_worktree(root)
            real = root / 'real-python'
            _touch(real, 'x')
            real.chmod(0o755)
            link = root / 'venv-python'
            link.symlink_to(real)
            argv = check_isolated.build_odoo_argv(
                python=str(link),
                odoo_bin=str(root / 'odoo-bin'),
                odoo_conf=str(root / 'odoo.conf'),
                stock_addons=str(stock),
                worktree_addons=str(addons),
                scratch_db='liwan_scratch_wp8_iso',
                scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                http_port=8169,
                modules='liwan_core,liwan_api,liwan_pmo,liwan_hr',
                test_tags='/liwan_core',
            )
            self.assertEqual(argv[0], str(link))
            self.assertNotEqual(argv[0], str(real.resolve()))

    def test_rejects_bool_ports_and_comma_database_names(self) -> None:
        with self.assertRaises(check_isolated.IsolationError):
            check_isolated.validate_port(True)  # noqa: FBT003
        with self.assertRaises(check_isolated.IsolationError):
            check_isolated.validate_scratch_db(
                'liwan_scratch,odoo19',
                lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
            )

    def test_rejects_addons_path_outside_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, _stock = _fake_worktree(root)
            other = root / 'other' / 'odoo-addons'
            _touch(other / 'liwan_core' / '__manifest__.py', '{}')
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_worktree_addons(str(worktree), str(other))
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_worktree_addons(str(worktree / 'missing'), str(addons))

    def test_upgrade_and_runtime_argv_stay_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, stock = _fake_worktree(root)
            kwargs = dict(
                python=str(root / 'python'),
                odoo_bin=str(root / 'odoo-bin'),
                odoo_conf=str(root / 'odoo.conf'),
                stock_addons=str(stock),
                worktree_addons=str(addons),
                scratch_db='liwan_psc_scratch_integration_e2e_20260906',
                scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                http_port=9791,
            )
            upgrade = check_isolated.build_upgrade_argv(
                **kwargs,
                modules='liwan_core,liwan_api,liwan_pmo,liwan_hr',
                test_tags='/liwan_pmo',
            )
            self.assertIn('-u', upgrade)
            self.assertNotIn('-i', upgrade)
            self.assertIn('--stop-after-init', upgrade)
            runtime = check_isolated.build_runtime_argv(**kwargs)
            self.assertNotIn('--stop-after-init', runtime)
            self.assertNotIn('-i', runtime)
            self.assertIn('--db-filter=^liwan_psc_scratch_integration_e2e_20260906$', runtime)
            self.assertEqual(runtime[runtime.index('--http-port') + 1], '9791')
            parser = check_isolated.build_parser()
            with self.assertRaises(SystemExit):
                parser.parse_args(['upgrade'])
            with self.assertRaises(SystemExit):
                parser.parse_args(['runtime'])
            with self.assertRaises(SystemExit):
                parser.parse_args(['odoo', '--http-port', '8069'])
            self.assertEqual(worktree.name, 'worktree')

    def test_nested_base_layout_is_accepted_and_bad_addon_dirs_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, stock = _fake_worktree(root)
            core = check_isolated.validate_core_addons(root / 'odoo-bin')
            self.assertEqual(core, (root / 'odoo' / 'addons').resolve())
            self.assertEqual(check_isolated.validate_stock_addons(str(stock)), stock.resolve())
            self.assertEqual(worktree.name, 'worktree')
            self.assertTrue((addons / 'liwan_core' / '__manifest__.py').is_file())

            only_base = root / 'looks-like-core'
            _touch(only_base / 'base' / '__manifest__.py', '{}')
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_stock_addons(str(only_base))

            empty = root / 'empty-addons'
            empty.mkdir()
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_stock_addons(str(empty))

            missing_base_root = root / 'no-core'
            _touch(missing_base_root / 'odoo-bin', 'x')
            (missing_base_root / 'odoo-bin').chmod(0o755)
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_core_addons(missing_base_root / 'odoo-bin')

            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_stock_addons(str(root / 'odoo' / 'addons'))

    def test_missing_addons_path_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, stock = _fake_worktree(root)
            del addons, stock
            with self.assertRaises(check_isolated.IsolationError):
                check_isolated.validate_worktree_addons(str(worktree), str(worktree / 'missing'))

    def test_run_argv_uses_list_and_shell_false(self) -> None:
        calls: list[dict] = []

        def runner(argv, **kwargs):
            calls.append({'argv': argv, **kwargs})
            return FakeCompleted(0)

        with tempfile.TemporaryDirectory() as tmp:
            code = check_isolated.run_argv(
                ['true', 'ok'],
                cwd=tmp,
                env={'A': 'b'},
                runner=runner,
            )
        self.assertEqual(code, 0)
        self.assertEqual(calls[0]['argv'], ['true', 'ok'])
        self.assertFalse(calls[0]['shell'])
        self.assertEqual(calls[0]['env'], {'A': 'b'})

    def test_run_argv_rejects_newline_injection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(check_isolated.IsolationError):
            check_isolated.run_argv(['true', 'ok\nwhoami'], cwd=tmp)

    def test_command_odoo_does_not_invoke_real_runner_when_mocked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, stock = _fake_worktree(root)
            args = SimpleNamespace(
                worktree=str(worktree),
                addons_path=str(addons),
                stock_addons=str(stock),
                python=str(root / 'python'),
                odoo_bin=str(root / 'odoo-bin'),
                odoo_conf=str(root / 'odoo.conf'),
                scratch_db='liwan_scratch_wp8_iso',
                scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                http_port=8169,
                modules='liwan_core,liwan_api,liwan_pmo,liwan_hr',
                test_tags='/liwan_core',
                with_oca=False,
            )
            seen = {}

            def runner(argv, **kwargs):
                seen['argv'] = argv
                seen['kwargs'] = kwargs
                return FakeCompleted(0)

            code = check_isolated.command_odoo(args, runner=runner)
            self.assertEqual(code, 0)
            self.assertFalse(seen['kwargs']['shell'])
            self.assertIsInstance(seen['argv'], list)


class TestE2EWrapper(unittest.TestCase):
    def test_env_overwrites_inherited_localhost_3000(self) -> None:
        env = check_isolated.build_e2e_env(
            base_url='http://127.0.0.1:3100',
            odoo_url='http://127.0.0.1:8169',
            ws_url='ws://127.0.0.1:8169/websocket',
            scratch_db='liwan_scratch_wp8_iso',
            scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
            parent_env={
                'E2E_BASE_URL': 'http://localhost:3000',
                'NUXT_ODOO_DB': 'odoo19',
                'NUXT_ODOO_URL': 'http://localhost:8069',
                'PATH': '/usr/bin',
            },
        )
        self.assertEqual(env['E2E_BASE_URL'], 'http://127.0.0.1:3100')
        self.assertEqual(env['NUXT_ODOO_DB'], 'liwan_scratch_wp8_iso')
        self.assertEqual(env['NUXT_ODOO_URL'], 'http://127.0.0.1:8169')
        self.assertNotEqual(env['E2E_BASE_URL'], 'http://localhost:3000')
        self.assertNotEqual(env['NUXT_ODOO_DB'], 'odoo19')

    def test_missing_base_url_has_no_dev_default(self) -> None:
        with self.assertRaises(check_isolated.IsolationError):
            check_isolated.build_e2e_env(
                base_url='',
                odoo_url='http://127.0.0.1:8169',
                ws_url='ws://127.0.0.1:8169/websocket',
                scratch_db='liwan_scratch_wp8_iso',
                scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                parent_env={},
            )

    def test_e2e_parser_requires_base_url_and_lifecycle(self) -> None:
        parser = check_isolated.build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args([
                'e2e',
                '--worktree', '/x',
                '--addons-path', '/x/odoo-addons',
                '--scratch-db', 'liwan_scratch_x',
            ])

    def test_command_e2e_sets_explicit_env_and_npm_argv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree, addons, _stock = _fake_worktree(root)
            args = SimpleNamespace(
                worktree=str(worktree),
                addons_path=str(addons),
                scratch_db='liwan_scratch_wp8_iso',
                scratch_lifecycle=check_isolated.SCRATCH_LIFECYCLE_TOKEN,
                base_url='http://127.0.0.1:3100',
                odoo_url='http://127.0.0.1:8169',
                ws_url='ws://127.0.0.1:8169/websocket',
            )
            seen = {}

            def runner(argv, **kwargs):
                seen['argv'] = argv
                seen['kwargs'] = kwargs
                return FakeCompleted(0)

            with patch.dict(os.environ, {'E2E_BASE_URL': 'http://localhost:3000'}, clear=False):
                code = check_isolated.command_e2e(args, runner=runner)
            self.assertEqual(code, 0)
            self.assertEqual(seen['argv'], ['npm', '-w', 'apps/web', 'run', 'test:e2e'])
            self.assertFalse(seen['kwargs']['shell'])
            self.assertEqual(seen['kwargs']['env']['E2E_BASE_URL'], 'http://127.0.0.1:3100')


class TestBackupFailClosed(unittest.TestCase):
    def test_opt_in_true_is_not_evidence(self) -> None:
        with self.assertRaises(backup.BackupError):
            backup.validate_opt_in('true')
        with self.assertRaises(backup.BackupError):
            backup.validate_opt_in('yes')
        with self.assertRaises(backup.BackupError):
            backup.validate_opt_in('1')

    def test_unverified_ack_required(self) -> None:
        with self.assertRaises(backup.BackupError):
            backup.validate_unverified_ack('true')
        with self.assertRaises(backup.BackupError):
            backup.validate_unverified_ack('consistent')

    def test_refuses_odoo19_db(self) -> None:
        with self.assertRaises(backup.BackupError):
            backup.validate_db_name('odoo19')

    def test_reachable_http_port_declines_candidate(self) -> None:
        with self.assertRaises(backup.BackupDeclined):
            backup.observe_http_port('127.0.0.1', 8069, connector=lambda _h, _p: 0)

    def test_closed_port_is_not_consistency_proof(self) -> None:
        observation = backup.observe_http_port(
            '127.0.0.1',
            18169,
            connector=lambda _h, _p: 61,
        )
        self.assertEqual(observation['certifies_consistency'], 'false')
        self.assertIn('not proof', observation['interpretation'])

    def test_boolean_quiesced_flag_declines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code = backup.main([
                '--opt-in', backup.OPT_IN_TOKEN,
                '--acknowledge-unverified', backup.UNVERIFIED_TOKEN,
                '--db-name', 'customerdb',
                '--filestore', str(root),
                '--output-dir', str(root / 'out'),
                '--pg-dump', str(root / 'pg_dump'),
                '--quiesced',
            ])
        self.assertEqual(code, 3)

    def test_assume_stopped_declines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code = backup.main([
                '--opt-in', backup.OPT_IN_TOKEN,
                '--acknowledge-unverified', backup.UNVERIFIED_TOKEN,
                '--db-name', 'customerdb',
                '--filestore', str(root),
                '--output-dir', str(root / 'out'),
                '--pg-dump', str(root / 'pg_dump'),
                '--assume-stopped',
            ])
        self.assertEqual(code, 3)

    def test_consistent_flag_declines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code = backup.main([
                '--opt-in', backup.OPT_IN_TOKEN,
                '--acknowledge-unverified', backup.UNVERIFIED_TOKEN,
                '--db-name', 'customerdb',
                '--filestore', str(root),
                '--output-dir', str(root / 'out'),
                '--pg-dump', str(root / 'pg_dump'),
                '--consistent',
            ])
        self.assertEqual(code, 3)

    def test_verify_port_flag_declines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code = backup.main([
                '--opt-in', backup.OPT_IN_TOKEN,
                '--acknowledge-unverified', backup.UNVERIFIED_TOKEN,
                '--db-name', 'customerdb',
                '--filestore', str(root),
                '--output-dir', str(root / 'out'),
                '--pg-dump', str(root / 'pg_dump'),
                '--verify-port', '127.0.0.1:18169',
            ])
        self.assertEqual(code, 3)

    def test_pg_dump_argv_has_no_password(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pg_dump = Path(tmp) / 'pg_dump'
            _touch(pg_dump, 'x')
            pg_dump.chmod(0o755)
            out = Path(tmp) / 'database.dump'
            argv = backup.build_pg_dump_argv(
                pg_dump=str(pg_dump),
                db_name='customerdb',
                output_file=str(out),
                pg_host='127.0.0.1',
                pg_port='5432',
                pg_user='odoo',
            )
        self.assertNotIn('--password', argv)
        self.assertNotIn('-W', argv)
        self.assertNotIn('secret', ' '.join(argv))
        self.assertEqual(argv[1], '-Fc')
        self.assertFalse(any('PGPASSWORD' in item for item in argv))

    def test_candidate_copy_manifest_is_unverified_even_if_port_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = 'customerdb'
            filestore = root / 'data' / 'filestore' / db
            _touch(filestore / 'blob', 'file')
            pg_dump = root / 'pg_dump'
            _touch(pg_dump, 'x')
            pg_dump.chmod(0o755)
            output = root / 'backup-out'

            def runner(argv, **kwargs):
                self.assertFalse(kwargs['shell'])
                self.assertIsInstance(argv, list)
                Path(argv[argv.index('-f') + 1]).write_bytes(b'dump')
                return FakeCompleted(0)

            manifest = backup.perform_backup(
                opt_in=backup.OPT_IN_TOKEN,
                acknowledge_unverified=backup.UNVERIFIED_TOKEN,
                db_name=db,
                filestore=str(filestore),
                output_dir=str(output),
                pg_dump=str(pg_dump),
                observe_http_port_value='127.0.0.1:18169',
                runner=runner,
                connector=lambda _h, _p: 61,
            )
            payload = json.loads(manifest.read_text(encoding='utf-8'))
            self.assertTrue((output / 'database.dump').is_file())
            self.assertTrue((output / 'filestore' / 'blob').is_file())
            self.assertEqual(payload['consistency'], 'UNVERIFIED')
            self.assertFalse(payload['recovery_ready'])
            self.assertFalse(payload['atomic'])
            self.assertNotIn('writer_stop_verified', payload)
            self.assertNotIn('consistency_verified', payload)
            self.assertNotIn('live_consistent', payload)
            self.assertEqual(payload['http_port_observation']['certifies_consistency'], 'false')
            self.assertIn('not proof', payload['http_port_observation']['interpretation'])
            self.assertIn('RPO is not defined', payload['unresolved'])
            self.assertIn('restore', payload['actions_not_performed'])
            self.assertIn('not recovery-ready', payload['not_recovery_ready_reason'])

    def test_open_port_observation_prevents_copy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = 'customerdb'
            filestore = root / 'data' / 'filestore' / db
            filestore.mkdir(parents=True)
            pg_dump = root / 'pg_dump'
            _touch(pg_dump, 'x')
            pg_dump.chmod(0o755)
            ran = {'dump': False}

            def runner(argv, **kwargs):
                ran['dump'] = True
                return FakeCompleted(0)

            with self.assertRaises(backup.BackupDeclined):
                backup.perform_backup(
                    opt_in=backup.OPT_IN_TOKEN,
                    acknowledge_unverified=backup.UNVERIFIED_TOKEN,
                    db_name=db,
                    filestore=str(filestore),
                    output_dir=str(root / 'out'),
                    pg_dump=str(pg_dump),
                    observe_http_port_value='127.0.0.1:18169',
                    runner=runner,
                    connector=lambda _h, _p: 0,
                )
            self.assertFalse(ran['dump'])
            self.assertFalse((root / 'out').exists())

    def test_parser_has_no_restore_or_schedule(self) -> None:
        parser = backup.build_parser()
        actions = {action.dest for action in parser._actions}
        self.assertNotIn('restore', actions)
        self.assertNotIn('schedule', actions)
        self.assertNotIn('delete', actions)
        self.assertNotIn('stop', actions)
        with self.assertRaises(SystemExit):
            parser.parse_args(['restore'])


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class BackupCase(unittest.TestCase):
    """A scratch data dir with a filestore, a fake pg_dump and a private lock directory."""

    DB = 'customerdb'

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.filestore = self.root / 'data' / 'filestore' / self.DB
        _touch(self.filestore / 'ab' / 'one', 'x')
        _touch(self.filestore / 'cd' / 'two', 'yy')
        self.pg_dump = self.root / 'pg_dump'
        _touch(self.pg_dump, 'x')
        self.pg_dump.chmod(0o755)
        self.locks = self.root / 'locks'
        self.locks.mkdir()
        self.argvs: list[list[str]] = []

    def dump_runner(self, argv, **kwargs):
        self.argvs.append(argv)
        Path(argv[argv.index('-f') + 1]).write_bytes(b'dump')
        return FakeCompleted(0)

    def backup(self, name: str, *, db: str | None = None, runner=None, **extra) -> Path:
        db = db or self.DB
        store = self.filestore.parent / db
        return backup.perform_backup(
            opt_in=backup.OPT_IN_TOKEN,
            acknowledge_unverified=backup.UNVERIFIED_TOKEN,
            db_name=db,
            filestore=str(store),
            output_dir=str(self.root / name),
            pg_dump=str(self.pg_dump),
            lock_dir=str(self.locks),
            runner=runner or self.dump_runner,
            **extra,
        )


class TestBackupIntegrity(BackupCase):
    def test_manifest_pins_the_dump_and_the_filestore(self) -> None:
        payload = json.loads(self.backup('out').read_text(encoding='utf-8'))
        lines = f'{_sha256(b"x")}  ab/one\n{_sha256(b"yy")}  cd/two\n'
        self.assertEqual(payload['database_dump_sha256'], _sha256(b'dump'))
        self.assertEqual(payload['filestore_sha256'], _sha256(lines.encode()))
        self.assertEqual(payload['filestore_file_count'], 2)
        self.assertEqual(payload['consistency'], 'UNVERIFIED')

    def test_pg_dump_takes_a_serializable_deferrable_snapshot(self) -> None:
        self.backup('out')
        self.assertIn('--serializable-deferrable', self.argvs[0])

    def test_the_digest_follows_the_content_and_the_names(self) -> None:
        before = backup.filestore_digest(self.filestore)
        _touch(self.filestore / 'ab' / 'one', 'z')
        changed = backup.filestore_digest(self.filestore)
        self.assertNotEqual(before[0], changed[0])
        self.assertEqual(before[1], changed[1])
        (self.filestore / 'ab' / 'one').rename(self.filestore / 'ab' / 'renamed')
        self.assertNotEqual(changed[0], backup.filestore_digest(self.filestore)[0])
        self.assertEqual(backup.filestore_digest(self.filestore)[1], 2)

    def test_an_empty_filestore_has_a_digest_and_a_zero_count(self) -> None:
        empty = self.root / 'empty'
        empty.mkdir()
        self.assertEqual(backup.filestore_digest(empty), (_sha256(b''), 0))

    def assert_refused_before_any_work(self, message: str) -> None:
        with self.assertRaisesRegex(backup.BackupError, message):
            self.backup('out')
        self.assertEqual(self.argvs, [])
        self.assertFalse((self.root / 'out').exists())

    def test_a_symlinked_file_is_refused(self) -> None:
        (self.filestore / 'ab' / 'escape').symlink_to('/etc/hosts')
        self.assert_refused_before_any_work('symlink')

    def test_a_dangling_symlink_is_refused(self) -> None:
        (self.filestore / 'ab' / 'dangling').symlink_to(self.root / 'missing')
        self.assert_refused_before_any_work('symlink')

    def test_a_symlinked_directory_is_refused(self) -> None:
        (self.filestore / 'outside').symlink_to(self.root, target_is_directory=True)
        self.assert_refused_before_any_work('symlink')

    def test_a_special_file_is_refused(self) -> None:
        os.mkfifo(self.filestore / 'ab' / 'pipe')
        self.assert_refused_before_any_work('special file')

    def test_a_symlinked_filestore_root_is_refused(self) -> None:
        moved = self.root / 'elsewhere' / self.DB
        moved.parent.mkdir()
        self.filestore.rename(moved)
        self.filestore.symlink_to(moved, target_is_directory=True)
        self.assert_refused_before_any_work('must not be a symlink')

    def test_the_filestore_copy_is_not_asked_to_carry_links(self) -> None:
        seen = {}

        def copier(source, destination, **kwargs):
            seen.update(kwargs)
            return shutil.copytree(source, destination, **kwargs)

        self.backup('out', copier=copier)
        self.assertFalse(seen.get('symlinks', False))


class TestBackupLock(BackupCase):
    def test_a_second_concurrent_run_for_the_same_database_is_refused(self) -> None:
        refusals: list[str] = []

        def runner(argv, **kwargs):
            try:
                self.backup('second')
            except backup.BackupError as error:
                refusals.append(str(error))
            return self.dump_runner(argv, **kwargs)

        self.backup('first', runner=runner)
        self.assertEqual(len(refusals), 1)
        self.assertIn(f'another backup of database {self.DB} is already running', refusals[0])
        self.assertFalse((self.root / 'second').exists())

    def test_a_run_is_allowed_again_after_the_first_released_the_lock(self) -> None:
        self.backup('first')
        self.assertTrue(self.backup('second').is_file())

    def test_the_lock_is_released_when_the_run_fails(self) -> None:
        with self.assertRaises(backup.BackupError):
            self.backup('first', runner=lambda argv, **kwargs: FakeCompleted(1))
        self.assertTrue(self.backup('second').is_file())

    def test_the_lock_is_released_when_the_run_raises_unexpectedly(self) -> None:
        def runner(argv, **kwargs):
            raise RuntimeError('pg_dump could not start')

        with self.assertRaises(RuntimeError):
            self.backup('first', runner=runner)
        self.assertTrue(self.backup('second').is_file())

    def test_another_database_is_not_blocked(self) -> None:
        _touch(self.filestore.parent / 'otherdb' / 'blob', 'x')
        results: list[Path] = []

        def runner(argv, **kwargs):
            results.append(self.backup('other', db='otherdb'))
            return self.dump_runner(argv, **kwargs)

        self.backup('first', runner=runner)
        self.assertTrue(results[0].is_file())

    def test_a_lock_held_by_another_process_refuses_the_run(self) -> None:
        holder = subprocess.Popen(
            [sys.executable, '-B', '-c',
             'import sys; sys.path.insert(0, sys.argv[1]); import backup; '
             'lock = backup.database_lock(sys.argv[2], sys.argv[3]); lock.__enter__(); '
             'print("locked", flush=True); sys.stdin.read()',
             str(Path(backup.__file__).parent), self.DB, str(self.locks)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'locked')
            with self.assertRaisesRegex(backup.BackupError, 'already running'):
                self.backup('out')
        finally:
            holder.communicate()
        self.assertTrue(self.backup('out').is_file())

    def test_the_command_line_refuses_with_a_message_and_exit_code_2(self) -> None:
        arguments = [
            '--opt-in', backup.OPT_IN_TOKEN,
            '--acknowledge-unverified', backup.UNVERIFIED_TOKEN,
            '--db-name', self.DB,
            '--filestore', str(self.filestore),
            '--output-dir', str(self.root / 'out'),
            '--pg-dump', str(self.pg_dump),
            '--lock-dir', str(self.locks),
        ]
        stderr = io.StringIO()
        with backup.database_lock(self.DB, str(self.locks)), patch('sys.stderr', stderr):
            code = backup.main(arguments)
        self.assertEqual(code, 2)
        self.assertIn('already running', stderr.getvalue())
        self.assertFalse((self.root / 'out').exists())

    def lock_path(self) -> Path:
        return self.locks / f'{self.DB}.lock'

    def test_the_lock_file_is_created_0644_whatever_the_umask(self) -> None:
        previous = os.umask(0o077)
        try:
            with backup.database_lock(self.DB, str(self.locks)):
                pass
        finally:
            os.umask(previous)
        self.assertEqual(self.lock_path().stat().st_mode & 0o777, 0o644)

    def test_a_lock_file_the_caller_cannot_write_is_lockable_again(self) -> None:
        """Another user's leftover file: flock needs no write access, so a read-only file works."""
        self.backup('first')
        self.lock_path().chmod(0o444)
        self.assertTrue(self.backup('second').is_file())
        with backup.database_lock(self.DB, str(self.locks)):
            with self.assertRaisesRegex(backup.BackupError, 'already running'):
                self.backup('third')
        self.assertEqual(self.lock_path().stat().st_mode & 0o777, 0o444)

    def test_a_lock_file_that_cannot_be_opened_is_an_explicit_error(self) -> None:
        with patch('os.open', side_effect=PermissionError(13, 'Permission denied')):
            with self.assertRaisesRegex(backup.BackupError, 'cannot open the backup lock .*Permission denied'):
                with backup.database_lock(self.DB, str(self.locks)):
                    pass

    def test_a_fifo_in_place_of_the_lock_file_is_refused_without_hanging(self) -> None:
        os.mkfifo(self.lock_path())
        with self.assertRaisesRegex(backup.BackupError, 'not a regular file'):
            with backup.database_lock(self.DB, str(self.locks)):
                pass

    def test_a_symlink_in_place_of_the_lock_file_is_refused(self) -> None:
        target = self.root / 'elsewhere'
        target.write_text('x')
        self.lock_path().symlink_to(target)
        with self.assertRaisesRegex(backup.BackupError, 'cannot open the backup lock'):
            with backup.database_lock(self.DB, str(self.locks)):
                pass

    def test_the_default_lock_directory_is_private_and_owned_by_this_user(self) -> None:
        with patch('tempfile.gettempdir', return_value=str(self.root)):
            directory = backup.lock_directory(None)
        self.assertEqual(directory, self.root / backup.LOCK_DIR_NAME)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

    def test_a_default_lock_directory_that_is_a_symlink_is_refused(self) -> None:
        (self.root / backup.LOCK_DIR_NAME).symlink_to(self.locks, target_is_directory=True)
        with patch('tempfile.gettempdir', return_value=str(self.root)):
            with self.assertRaisesRegex(backup.BackupError, 'not a directory owned by this user'):
                backup.lock_directory(None)


class TestHelpAndChecksFragment(unittest.TestCase):
    def test_check_isolated_help_exits_zero(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            check_isolated.build_parser().parse_args(['--help'])
        self.assertEqual(ctx.exception.code, 0)

    def test_backup_help_exits_zero(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            backup.build_parser().parse_args(['--help'])
        self.assertEqual(ctx.exception.code, 0)

    def test_verification_checks_are_required_and_have_no_env_fallback(self) -> None:
        path = Path(__file__).with_name('verification-checks.json')
        data = json.loads(path.read_text(encoding='utf-8'))
        self.assertTrue(data['checks'])
        ids = {item['id'] for item in data['checks']}
        self.assertIn('odoo-isolated', ids)
        self.assertIn('e2e-isolated', ids)
        for item in data['checks']:
            self.assertTrue(item['required'])
            argv = item['argv']
            self.assertIsInstance(argv, list)
            self.assertNotIn('http://localhost:3000', argv)
            self.assertNotIn('odoo19', argv)
            joined = ' '.join(argv)
            self.assertNotIn('${', joined)
            self.assertIn('REPLACE_WITH_', joined)
            self.assertIn('--scratch-lifecycle', argv)
            self.assertIn('CREATE_NEW_SCRATCH', argv)
