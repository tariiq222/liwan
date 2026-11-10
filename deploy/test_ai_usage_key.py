"""The AI usage recorder key (issue #557): how provisioning stores it and what the seed script may print."""
import contextlib
import io
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parent
KEY = 'ab12' * 10


def write_secret(env_file, value, name='LIWAN_AI_USAGE_KEY'):
    return subprocess.run(['sh', str(DEPLOY / 'ai' / 'write_env_secret.sh'), str(env_file), name], input=value, text=True, capture_output=True, check=False)


class WriteEnvSecretTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.env_file = Path(self.dir.name) / '.env'

    def test_appends_when_absent_and_replaces_in_place_when_present(self):
        self.env_file.write_text('A=1\nLIWAN_AI_USAGE_KEY=\nB=2\n')
        self.assertEqual(write_secret(self.env_file, KEY).returncode, 0)
        self.assertEqual(self.env_file.read_text(), f'A=1\nLIWAN_AI_USAGE_KEY={KEY}\nB=2\n')
        rotated = 'cd34' * 10
        write_secret(self.env_file, rotated)
        self.assertEqual(self.env_file.read_text(), f'A=1\nLIWAN_AI_USAGE_KEY={rotated}\nB=2\n')
        other = Path(self.dir.name) / 'other.env'
        other.write_text('A=1\n')
        write_secret(other, KEY)
        self.assertEqual(other.read_text(), f'A=1\nLIWAN_AI_USAGE_KEY={KEY}\n')

    def test_duplicate_assignments_collapse_to_one(self):
        self.env_file.write_text('LIWAN_AI_USAGE_KEY=old\nX=1\nLIWAN_AI_USAGE_KEY=older\n')
        write_secret(self.env_file, KEY)
        self.assertEqual(self.env_file.read_text(), f'LIWAN_AI_USAGE_KEY={KEY}\nX=1\n')

    def test_the_file_is_owner_only_and_nothing_is_printed(self):
        self.env_file.write_text('A=1\n')
        os.chmod(self.env_file, 0o644)
        done = write_secret(self.env_file, KEY)
        self.assertEqual(stat.S_IMODE(self.env_file.stat().st_mode), 0o600)
        self.assertNotIn(KEY, done.stdout + done.stderr)
        self.assertFalse((Path(self.dir.name) / '.env.tmp').exists())

    def test_refuses_a_value_that_is_not_a_hex_key_and_a_bad_name_without_touching_the_file(self):
        self.env_file.write_text('A=1\n')
        for value in ('', 'not hex', 'AB12', f'{KEY}\nINJECTED=1', 'x;rm -rf'):
            with self.subTest(value=value):
                done = write_secret(self.env_file, value)
                self.assertNotEqual(done.returncode, 0)
                self.assertNotIn(value.strip() or 'never', done.stdout + done.stderr) if value.strip() else None
        self.assertNotEqual(write_secret(self.env_file, KEY, name='bad name').returncode, 0)
        self.assertNotEqual(write_secret(Path(self.dir.name) / 'missing.env', KEY).returncode, 0)
        self.assertEqual(self.env_file.read_text(), 'A=1\n')


class SeedScriptTest(unittest.TestCase):
    def run_seed(self, existing=0):
        calls = []

        class Keys:
            def search(self, domain):
                calls.append(('search', domain))
                return self

            def remove(self):
                calls.append(('remove', existing))

            def with_user(self, user):
                calls.append(('with_user', user))
                return self

            def sudo(self):
                return self

            def _generate(self, scope, name, expiration):
                calls.append(('generate', scope, name, expiration))
                return KEY

        class Cursor:
            def commit(self):
                calls.append(('commit',))

        class Env:
            cr = Cursor()

            def ref(self, xmlid):
                calls.append(('ref', xmlid))
                return type('User', (), {'id': 7})()

            def __getitem__(self, model):
                assert model == 'res.users.apikeys'
                return Keys()

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exec(compile((DEPLOY / 'seed_ai_usage_key.py').read_text(), 'seed_ai_usage_key.py', 'exec'), {'env': Env()})
        return calls, out.getvalue()

    def test_rotates_the_recorders_keys_and_prints_exactly_one_line(self):
        calls, out = self.run_seed()
        self.assertEqual(out, f'LIWAN_AI_USAGE_KEY={KEY}\n')
        kinds = [call[0] for call in calls]
        self.assertEqual(kinds, ['ref', 'search', 'remove', 'with_user', 'generate', 'commit'])
        self.assertEqual(calls[0], ('ref', 'liwan_ai.user_ai_usage'))
        self.assertEqual(calls[1], ('search', [('user_id', '=', 7)]))
        # Scope `rpc` is the one Odoo's bearer authentication accepts; no expiry date is asked for (rotation replaces it).
        self.assertEqual(calls[4], ('generate', 'rpc', 'LiwanOS AI usage recorder', None))


class ProvisionWiringTest(unittest.TestCase):
    """provision.sh needs Docker, so what is checked here is the wiring a regression would silently break."""

    def setUp(self):
        self.script = (DEPLOY / 'provision.sh').read_text()
        self.compose = (DEPLOY / 'docker-compose.yml').read_text()

    def test_the_seed_is_staged_and_the_key_is_filtered_then_stored_without_echo(self):
        self.assertIn('cp seed_ai_usage_key.py data/seed/seed_ai_usage_key.py', self.script)
        self.assertIn("sed -n 's/^LIWAN_AI_USAGE_KEY=", self.script)
        self.assertIn('ai/write_env_secret.sh .env LIWAN_AI_USAGE_KEY', self.script)
        # The key reaches neither a log line nor a command line: no echo expands it, only stdin carries it.
        for line in self.script.splitlines():
            if 'echo' in line:
                self.assertIsNone(re.search(r'echo[^;]*\$\{?(minted|LIWAN_AI_USAGE_KEY)', line), line)
        self.assertIn("printf '%s' \"$minted\" | sh ai/write_env_secret.sh", self.script)

    def test_a_key_already_in_the_env_file_is_kept_and_rotation_is_explicit(self):
        self.assertIn('[ -z "${LIWAN_AI_USAGE_KEY:-}" ]', self.script)
        self.assertIn('--rotate-ai-usage-key', self.script)
        self.assertIn('docker compose up -d web', self.script)

    def test_only_web_receives_the_key(self):
        holder, holders = None, []
        for line in self.compose.splitlines():
            service = re.match(r'^  ([a-z0-9-]+):\s*$', line)
            if service:
                holder = service.group(1)
            elif 'LIWAN_AI_USAGE_KEY' in line and holder not in holders:
                holders.append(holder)
        self.assertEqual(holders, ['web'])


if __name__ == '__main__':
    unittest.main()
