"""deploy/ai/ensure_secrets.sh provisions the AI secrets once: never printed, never rotated, never duplicated."""
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy' / 'ai' / 'ensure_secrets.sh'
HEX_64 = re.compile(r'^[0-9a-f]{64}$')
TOKEN = 'existing-token-0123456789abcdef'  # 30 characters, the minimum is 24


@unittest.skipUnless(shutil.which('openssl'), 'openssl is required')
class EnsureSecretsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env_file = Path(self.tmp.name) / '.env'

    def run_script(self):
        completed = subprocess.run(
            ['sh', str(SCRIPT), str(self.env_file)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout + completed.stderr

    def values(self, name):
        lines = [line for line in self.env_file.read_text().splitlines() if line.startswith(name + '=')]
        return [line[len(name) + 1:] for line in lines]

    def test_provision_generates_missing_secrets(self):
        self.env_file.write_text('COMPOSE_PROFILES=ai\n')
        output = self.run_script()
        token = self.values('AI_SERVICE_TOKEN')
        password = self.values('AI_DB_PASSWORD')
        self.assertEqual(len(token), 1)
        self.assertEqual(len(password), 1)
        self.assertRegex(token[0], HEX_64)
        self.assertRegex(password[0], HEX_64)
        self.assertEqual(stat.S_IMODE(os.stat(self.env_file).st_mode), 0o600)
        self.assertNotIn(token[0], output)
        self.assertNotIn(password[0], output)

    def test_provision_keeps_existing_token(self):
        self.env_file.write_text(f'COMPOSE_PROFILES=ai\nAI_SERVICE_TOKEN={TOKEN}\n')
        self.run_script()
        self.run_script()
        self.assertEqual(self.values('AI_SERVICE_TOKEN'), [TOKEN])
        self.assertEqual(len(self.values('AI_DB_PASSWORD')), 1)

    def test_replaces_empty_value_in_place(self):
        self.env_file.write_text('COMPOSE_PROFILES=ai\nAI_SERVICE_TOKEN=\nAI_DB_PASSWORD=\nLAST=kept\n')
        self.run_script()
        lines = self.env_file.read_text().splitlines()
        self.assertEqual(lines[0], 'COMPOSE_PROFILES=ai')
        self.assertRegex(lines[1], r'^AI_SERVICE_TOKEN=[0-9a-f]{64}$')
        self.assertRegex(lines[2], r'^AI_DB_PASSWORD=[0-9a-f]{64}$')
        self.assertEqual(lines[3], 'LAST=kept')


if __name__ == '__main__':
    unittest.main()
