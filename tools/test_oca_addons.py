# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Offline tests for tools/oca_addons.py: a local directory of bare-style repos stands in for GitHub."""
import contextlib
import copy
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import oca_addons

GOOD = {'repo': 'OCA/demo', 'branch': '19.0', 'commit': 'a' * 40}


def git(*args, cwd):
    return subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *args], cwd=cwd, check=True,
                          text=True, capture_output=True).stdout.strip()


class ValidateTest(unittest.TestCase):
    def test_the_committed_pin_file_is_valid(self):
        self.assertEqual(oca_addons.validate(json.loads(oca_addons.PINS.read_text(encoding='utf-8'))), [])

    def test_rejects_short_sha_bad_name_duplicate_and_empty(self):
        self.assertTrue(oca_addons.validate({'repos': []}))
        self.assertTrue(oca_addons.validate({'repos': [dict(GOOD, commit='abc123')]}))
        self.assertTrue(oca_addons.validate({'repos': [dict(GOOD, commit='A' * 40)]}))
        self.assertTrue(oca_addons.validate({'repos': [dict(GOOD, repo='odoo/demo')]}))
        self.assertTrue(oca_addons.validate({'repos': [GOOD, copy.deepcopy(GOOD)]}))

    def test_python_requirements_must_name_a_pinned_repo(self):
        bad = {'repos': [GOOD], 'python_requirements': [{'module': 'm', 'repo': 'OCA/other', 'packages': ['x']}]}
        self.assertTrue(oca_addons.validate(bad))


class DestTest(unittest.TestCase):
    def test_env_wins_and_default_is_beside_the_main_checkout(self):
        self.assertEqual(oca_addons.default_dest({'WEBVUE_OCA_DIR': '/x/oca'}), Path('/x/oca'))
        self.assertEqual(oca_addons.default_dest({}), oca_addons.main_checkout().parent / 'oca-19.0')

    def test_path_joins_repo_directories_in_pin_order(self):
        pins = {'repos': [GOOD, dict(GOOD, repo='OCA/second')]}
        self.assertEqual(oca_addons.addons_path(pins, '/d'), '/d/demo,/d/second')


class FetchTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        remote = self.root / 'remote' / 'OCA' / 'demo.git'
        remote.mkdir(parents=True)
        git('init', '-q', cwd=remote)
        (remote / 'mod').mkdir()
        (remote / 'mod' / '__manifest__.py').write_text("{'name': 'mod'}\n", encoding='utf-8')
        git('add', '.', cwd=remote)
        git('commit', '-q', '-m', 'one', cwd=remote)
        self.pin = git('rev-parse', 'HEAD', cwd=remote)
        (remote / 'later.txt').write_text('x\n', encoding='utf-8')
        git('add', '.', cwd=remote)
        git('commit', '-q', '-m', 'two', cwd=remote)
        git('config', 'uploadpack.allowAnySHA1InWant', 'true', cwd=remote)
        self.base = str(self.root / 'remote')
        self.dest = self.root / 'dest'
        self.entry = {'repo': 'OCA/demo', 'branch': '19.0', 'commit': self.pin}

    def test_fetch_checks_out_the_pin_and_is_idempotent(self):
        self.assertEqual(oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True), 'fetched')
        target = self.dest / 'demo'
        self.assertEqual(git('rev-parse', 'HEAD', cwd=target), self.pin)
        self.assertTrue((target / 'mod' / '__manifest__.py').is_file())
        self.assertFalse((target / 'later.txt').exists())
        self.assertEqual(oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True), 'kept')

    def test_fetch_repairs_a_dirty_checkout(self):
        oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True)
        stray = self.dest / 'demo' / 'stray.txt'
        stray.write_text('x\n', encoding='utf-8')
        self.assertEqual(oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True), 'kept')
        self.assertFalse(stray.exists())

    def test_unknown_commit_fails(self):
        with self.assertRaises(oca_addons.OcaError):
            oca_addons.fetch_repo(dict(self.entry, commit='b' * 40), self.dest, self.base, allow_local_base=True)

    def test_failed_fetch_leaves_no_half_made_clone(self):
        with self.assertRaises(oca_addons.OcaError):
            oca_addons.fetch_repo(dict(self.entry, commit='b' * 40), self.dest, self.base, allow_local_base=True)
        self.assertFalse((self.dest / 'demo').exists())

    def test_a_directory_left_by_a_died_fetch_is_replaced(self):
        (self.dest / 'demo').mkdir(parents=True)
        (self.dest / 'demo' / 'junk').write_text('x\n', encoding='utf-8')
        self.assertEqual(oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True), 'fetched')
        self.assertFalse((self.dest / 'demo' / 'junk').exists())

    def test_non_https_base_is_refused_unless_test_only_parameter_is_set(self):
        for base in ('/local/path', 'http://github.com', 'git://github.com', 'file:///x'):
            with self.subTest(base=base), self.assertRaises(oca_addons.OcaError):
                oca_addons.fetch_repo(self.entry, self.dest, base)
        self.assertFalse((self.dest / 'demo').exists())

    def test_verify_reports_a_head_mismatch_missing_clone_and_local_changes(self):
        with self.assertRaisesRegex(oca_addons.OcaError, 'not fetched'):
            oca_addons.verify_repo(self.entry, self.dest)
        oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True)
        oca_addons.verify_repo(self.entry, self.dest)
        (self.dest / 'demo' / 'mod' / '__manifest__.py').write_text("{'name': 'changed'}\n", encoding='utf-8')
        with self.assertRaisesRegex(oca_addons.OcaError, 'local changes'):
            oca_addons.verify_repo(self.entry, self.dest)
        with self.assertRaisesRegex(oca_addons.OcaError, 'expected b+'):
            oca_addons.verify_repo(dict(self.entry, commit='b' * 40), self.dest)

    def test_path_check_cli_fails_with_exit_code_2_until_fetched(self):
        pins = self.root / 'pins.json'
        pins.write_text(json.dumps({'repos': [self.entry]}), encoding='utf-8')
        cli = ['path', '--check', '--pins', str(pins), '--dest', str(self.dest)]
        result = subprocess.run([sys.executable, '-B', str(Path(oca_addons.__file__)), *cli],
                                check=False, text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('fetch', result.stderr)
        oca_addons.fetch_repo(self.entry, self.dest, self.base, allow_local_base=True)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(oca_addons.main(cli), 0)
        self.assertEqual(out.getvalue().strip(), str(self.dest / 'demo'))


class PinFileTest(unittest.TestCase):
    def test_dms_is_available_in_the_verified_runtime_path(self):
        pins = oca_addons.load_pins(oca_addons.PINS)
        self.assertIn('/opt/oca/dms', oca_addons.image_path().split(','))
        self.assertEqual(next(item for item in pins['repos'] if item['repo'] == 'OCA/dms')['commit'],
                         '42aec9613f64402ec702e8e21cfb643626a41056')

    def test_image_path_uses_the_image_destination(self):
        for part in oca_addons.image_path().split(','):
            self.assertTrue(part.startswith('/opt/oca/'))

    def test_python_requirements_are_satisfied_by_the_odoo_requirements_file(self):
        data = json.loads(oca_addons.PINS.read_text(encoding='utf-8'))
        text = (oca_addons.REPO / 'deploy' / 'odoo' / 'requirements-python312-linux.txt').read_text(encoding='utf-8')
        pinned = {re.split(r'[=<>~!\[ ;]', line, maxsplit=1)[0].lower().replace('_', '-')
                  for line in text.splitlines() if line.strip() and not line.startswith('#')}
        for item in data['python_requirements']:
            for package in item['packages']:
                self.assertIn(package.lower().replace('_', '-'), pinned, '%s needs %s' % (item['module'], package))


class FetchRetryTest(unittest.TestCase):
    NETWORK = oca_addons.OcaError("git fetch -q failed: fatal: unable to access 'https://github.com/OCA/x.git/': "
                                  "Failed to connect to github.com port 443 after 134380 ms: Couldn't connect to server")
    REFUSED = oca_addons.OcaError('git fetch -q failed: fatal: remote error: upload-pack: not our ref ' + 'b' * 40)

    def fetch(self, *outcomes):
        with mock.patch.object(oca_addons, 'git', side_effect=list(outcomes)) as git_call, \
                mock.patch.object(oca_addons.time, 'sleep') as sleep, \
                contextlib.redirect_stderr(io.StringIO()):
            try:
                return oca_addons.fetch_commit('https://github.com/OCA/x.git', 'a' * 40, Path('.')), git_call, sleep
            except oca_addons.OcaError as exc:
                return exc, git_call, sleep

    def test_a_network_failure_is_retried_until_the_fetch_succeeds(self):
        result, git_call, sleep = self.fetch(self.NETWORK, self.NETWORK, '')
        self.assertEqual(result, '')
        self.assertEqual(git_call.call_count, 3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], list(oca_addons.FETCH_RETRY_DELAYS))

    def test_a_network_failure_fails_after_the_last_attempt(self):
        result, git_call, _ = self.fetch(*[self.NETWORK] * (len(oca_addons.FETCH_RETRY_DELAYS) + 1))
        self.assertIs(result, self.NETWORK)
        self.assertEqual(git_call.call_count, len(oca_addons.FETCH_RETRY_DELAYS) + 1)

    def test_a_refused_commit_or_access_is_not_retried(self):
        forbidden = oca_addons.OcaError('git fetch -q failed: error: RPC failed; HTTP 403 curl 22 '
                                        'The requested URL returned error: 403')
        for refusal in (self.REFUSED, forbidden):
            result, git_call, sleep = self.fetch(refusal)
            self.assertIs(result, refusal)
            self.assertEqual(git_call.call_count, 1)
            sleep.assert_not_called()

    def test_a_dropped_transfer_and_a_server_error_are_retried(self):
        for message in ('error: RPC failed; curl 56 Recv failure: Connection reset by peer',
                        'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502'):
            result, git_call, _ = self.fetch(oca_addons.OcaError(message), '')
            self.assertEqual(result, '')
            self.assertEqual(git_call.call_count, 2)


if __name__ == '__main__':
    unittest.main()
