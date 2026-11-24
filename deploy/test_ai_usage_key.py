"""The AI usage root secret: how it is generated and stored, and which services receive it."""
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


class ComposeDeliveryTest(unittest.TestCase):
    """The root reaches web and odoo and no other service, in the base file and in the shared overlay."""

    @staticmethod
    def holders(path):
        holder, found = None, []
        for line in (DEPLOY / path).read_text().splitlines():
            service = re.match(r'^  ([a-z0-9-]+):\s*$', line)
            if service:
                holder = service.group(1)
            elif line.strip().startswith('LIWAN_AI_USAGE_KEY:') and holder not in found:
                found.append(holder)
        return found

    def test_only_web_and_odoo_receive_the_root(self):
        for path in ('docker-compose.yml', 'docker-compose.shared.yml'):
            with self.subTest(path=path):
                self.assertEqual(sorted(self.holders(path)), ['odoo', 'web'])

    def test_no_other_compose_file_names_the_root(self):
        for path in sorted(DEPLOY.glob('docker-compose*.yml')):
            if path.name not in ('docker-compose.yml', 'docker-compose.shared.yml'):
                with self.subTest(path=path.name):
                    self.assertNotIn('LIWAN_AI_USAGE_KEY', path.read_text())


if __name__ == '__main__':
    unittest.main()
