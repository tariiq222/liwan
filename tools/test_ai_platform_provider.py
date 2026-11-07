"""deploy/ai/platform_provider.py writes the AI service's platform provider file: mode 600, atomic, revisioned, never printed."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy'
SCRIPT = DEPLOY / 'ai' / 'platform_provider.py'
KEY = 'sk-operator-secret-0123456789'


class PlatformProviderWriterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env_file = Path(self.tmp.name) / '.env'
        self.target = Path(self.tmp.name) / 'data' / 'ai' / 'platform-provider.json'

    def write_env(self, **values):
        self.env_file.write_text(''.join(f'{name}={value}\n' for name, value in values.items()), encoding='utf-8')

    def run_script(self, expect=0, **env):
        # This test runs as the developer or CI user: accept an unowned file unless the test is about ownership.
        environment = {**os.environ, 'LIWAN_AI_PLATFORM_FILE_UNOWNED': '1', **env}
        completed = subprocess.run([sys.executable, '-B', str(SCRIPT), str(self.env_file), str(self.target)], capture_output=True, text=True, check=False, env=environment)
        self.assertEqual(completed.returncode, expect, completed.stderr)
        self.assertNotIn(KEY, completed.stdout + completed.stderr)  # a value is never printed
        return completed

    def content(self):
        return json.loads(self.target.read_text(encoding='utf-8'))

    def test_writes_the_operator_variables_as_a_mode_600_file(self):
        self.write_env(AI_PROVIDER='openai_compatible', AI_MODEL='deepseek-chat', AI_API_KEY=KEY, AI_BASE_URL='https://api.deepseek.com/v1')
        self.run_script()
        self.assertEqual(self.content(), {'provider': 'openai_compatible', 'model': 'deepseek-chat', 'api_key': KEY,
                                          'base_url': 'https://api.deepseek.com/v1', 'revision': 1})
        self.assertEqual(stat.S_IMODE(os.stat(self.target).st_mode), 0o600)
        self.assertEqual([p.name for p in self.target.parent.iterdir()], ['platform-provider.json'])  # no staging file is left

    def test_a_local_model_needs_no_key_and_the_default_provider_is_ollama(self):
        self.write_env(AI_MODEL='qwen2.5:7b', AI_BASE_URL='http://ollama:11434')
        self.run_script()
        self.assertEqual(self.content(), {'provider': 'ollama', 'model': 'qwen2.5:7b', 'base_url': 'http://ollama:11434', 'revision': 1})

    def test_the_last_assignment_wins_and_an_inline_comment_is_not_part_of_the_value_as_in_compose(self):
        self.env_file.write_text(
            f'AI_PROVIDER=ollama\nAI_MODEL=old # first\nAI_PROVIDER=openai   # the real one\nAI_MODEL="gpt-4o" # quoted, then a comment\n'
            f"AI_API_KEY='{KEY}'   # keep\nexport AI_BASE_URL=\n", encoding='utf-8')
        self.run_script()
        self.assertEqual(self.content(), {'provider': 'openai', 'model': 'gpt-4o', 'api_key': KEY, 'revision': 1})

    def test_a_hash_without_a_space_before_it_stays_in_the_value(self):
        self.write_env(AI_PROVIDER='openai', AI_MODEL='gpt-4o', AI_API_KEY=KEY + '#tail')
        self.run_script()
        self.assertEqual(self.content()['api_key'], KEY + '#tail')

    @unittest.skipIf(os.geteuid() in (0, 10001), 'ownership cannot fail for root or for the ai user itself')
    def test_it_fails_without_writing_or_claiming_success_when_the_file_would_be_unreadable_by_the_service(self):
        self.write_env(AI_PROVIDER='openai', AI_MODEL='gpt-4o', AI_API_KEY=KEY)
        completed = subprocess.run([sys.executable, '-B', str(SCRIPT), str(self.env_file), str(self.target)], capture_output=True, text=True, check=False,
                                   env={key: value for key, value in os.environ.items() if key != 'LIWAN_AI_PLATFORM_FILE_UNOWNED'})
        self.assertEqual(completed.returncode, 1)
        self.assertNotIn('revision', completed.stdout)  # no success line
        self.assertIn('10001', completed.stderr)
        self.assertIn('LIWAN_AI_PLATFORM_FILE_UNOWNED', completed.stderr)
        self.assertFalse(self.target.exists())
        self.assertNotIn(KEY, completed.stdout + completed.stderr)

    def test_stream_usage_is_written_only_when_the_operator_states_it_and_the_provider_asks_for_it(self):
        base = dict(AI_PROVIDER='openai_compatible', AI_MODEL='m', AI_API_KEY=KEY, AI_BASE_URL='https://llm.example.com/v1')
        self.write_env(**base)
        self.run_script()
        self.assertNotIn('stream_usage', self.content())
        self.write_env(**base, AI_STREAM_USAGE='true')
        self.run_script()
        self.assertEqual((self.content()['stream_usage'], self.content()['revision']), (True, 2))
        self.write_env(**base, AI_STREAM_USAGE='False')
        self.run_script()
        self.assertEqual(self.content()['stream_usage'], False)
        self.write_env(AI_PROVIDER='ollama', AI_MODEL='m', AI_STREAM_USAGE='true')
        self.run_script()
        self.assertNotIn('stream_usage', self.content())
        self.write_env(**base, AI_STREAM_USAGE='maybe')
        self.assertIn('AI_STREAM_USAGE', self.run_script(expect=1).stderr)

    def test_anthropic_never_carries_a_base_url(self):
        self.write_env(AI_PROVIDER='anthropic', AI_MODEL='claude-sonnet-4-5', AI_API_KEY=KEY, AI_BASE_URL='http://ollama:11434')
        self.run_script()
        self.assertNotIn('base_url', self.content())

    def test_quotes_comments_and_blank_lines_in_the_env_file_are_read_like_compose_does(self):
        self.env_file.write_text(f'# provider\n\nAI_PROVIDER="openai"\nAI_MODEL=\'gpt-4o\'\nAI_API_KEY={KEY}\n', encoding='utf-8')
        self.run_script()
        self.assertEqual(self.content()['provider'], 'openai')
        self.assertEqual(self.content()['model'], 'gpt-4o')

    def test_an_unchanged_configuration_leaves_the_file_as_it_is_and_a_changed_one_raises_the_revision(self):
        self.write_env(AI_PROVIDER='openai', AI_MODEL='gpt-4o', AI_API_KEY=KEY)
        self.run_script()
        before = os.stat(self.target)
        self.run_script()
        self.assertEqual(os.stat(self.target).st_ino, before.st_ino)
        self.assertEqual(self.content()['revision'], 1)
        self.write_env(AI_PROVIDER='openai', AI_MODEL='gpt-5', AI_API_KEY=KEY)
        self.run_script()
        self.assertEqual((self.content()['model'], self.content()['revision']), ('gpt-5', 2))

    def test_a_loose_mode_is_tightened_without_changing_the_revision(self):
        self.write_env(AI_PROVIDER='openai', AI_MODEL='gpt-4o', AI_API_KEY=KEY)
        self.run_script()
        os.chmod(self.target, 0o644)
        self.run_script()
        self.assertEqual(stat.S_IMODE(os.stat(self.target).st_mode), 0o600)
        self.assertEqual(self.content()['revision'], 1)

    def test_a_missing_variable_stops_provisioning_naming_the_variable_and_writes_nothing(self):
        for values, variable in (
            ({'AI_PROVIDER': 'gemini', 'AI_MODEL': 'm'}, 'AI_PROVIDER'),
            ({'AI_PROVIDER': 'openai', 'AI_API_KEY': KEY}, 'AI_MODEL'),
            ({'AI_PROVIDER': 'anthropic', 'AI_MODEL': 'm'}, 'AI_API_KEY'),
            ({'AI_PROVIDER': 'openai_compatible', 'AI_MODEL': 'm', 'AI_API_KEY': KEY}, 'AI_BASE_URL'),
        ):
            with self.subTest(variable=variable):
                self.write_env(**values)
                self.assertIn(variable, self.run_script(expect=1).stderr)
                self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()


@unittest.skipUnless(shutil.which('openssl') and shutil.which('bash'), 'openssl and bash are required')
class ProvisionPreflightTest(unittest.TestCase):
    """provision.sh stops before anything starts when the ai profile is on but the platform provider cannot be written."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.deploy = Path(self.tmp.name) / 'deploy'
        (self.deploy / 'ai').mkdir(parents=True)
        shutil.copy(DEPLOY / 'provision.sh', self.deploy / 'provision.sh')
        for name in ('ensure_secrets.sh', 'egress_hosts.sh', 'platform_provider.py'):
            shutil.copy(DEPLOY / 'ai' / name, self.deploy / 'ai' / name)

    def provision(self, env_text, **environment):
        (self.deploy / '.env').write_text(env_text, encoding='utf-8')
        base = {key: value for key, value in os.environ.items() if key != 'LIWAN_AI_PLATFORM_DIR'}
        return subprocess.run(['bash', str(self.deploy / 'provision.sh'), 'app.example.sa', 'acme'], capture_output=True, text=True, check=False,
                              env={**base, 'LIWAN_AI_PLATFORM_FILE_UNOWNED': '1', **environment}, cwd=self.deploy)

    def test_a_missing_ai_model_stops_with_a_message_that_names_it(self):
        completed = self.provision('COMPOSE_PROFILES=ai\nAI_PROVIDER=ollama\nAI_MODEL=\n')
        self.assertEqual(completed.returncode, 1)
        self.assertIn('AI_MODEL is not set in deploy/.env', completed.stderr)
        self.assertFalse((self.deploy / 'data' / 'ai').exists())

    def test_a_model_that_is_only_a_comment_counts_as_missing(self):
        self.assertIn('AI_MODEL is not set', self.provision('COMPOSE_PROFILES=ai\nAI_MODEL=   # fill in\n').stderr)

    ENV = 'COMPOSE_PROFILES=ai\nAI_PROVIDER=openai\nAI_MODEL=gpt-4o\nAI_API_KEY=sk-operator-secret-0123456789\n'

    def test_the_file_goes_to_data_ai_by_default(self):
        self.provision(self.ENV)
        self.assertTrue((self.deploy / 'data' / 'ai' / 'platform-provider.json').is_file())

    def test_the_file_goes_where_compose_mounts_it_when_the_env_file_names_the_directory(self):
        # Compose reads LIWAN_AI_PLATFORM_DIR from deploy/.env too, and a relative path is relative to deploy/.
        for line in ('LIWAN_AI_PLATFORM_DIR=./custom/ai', 'LIWAN_AI_PLATFORM_DIR="./custom/ai"  # the mounted directory'):
            with self.subTest(line=line):
                shutil.rmtree(self.deploy / 'custom', ignore_errors=True)
                self.provision(self.ENV + line + '\n')
                self.assertTrue((self.deploy / 'custom' / 'ai' / 'platform-provider.json').is_file())
                self.assertFalse((self.deploy / 'data' / 'ai').exists())

    def test_the_shell_environment_wins_over_the_env_file_as_in_compose_and_an_empty_value_means_the_default(self):
        elsewhere = Path(self.tmp.name) / 'elsewhere'
        self.provision(self.ENV + 'LIWAN_AI_PLATFORM_DIR=./from-env-file\n', LIWAN_AI_PLATFORM_DIR=str(elsewhere))
        self.assertTrue((elsewhere / 'platform-provider.json').is_file())
        self.assertFalse((self.deploy / 'from-env-file').exists())
        self.provision(self.ENV + 'LIWAN_AI_PLATFORM_DIR=\n')
        self.assertTrue((self.deploy / 'data' / 'ai' / 'platform-provider.json').is_file())

    def test_a_missing_key_stops_at_the_writer_with_a_message_naming_the_variable(self):
        completed = self.provision('COMPOSE_PROFILES=ai\nAI_PROVIDER=anthropic\nAI_MODEL=claude-sonnet-4-5\n')
        self.assertEqual(completed.returncode, 1)
        self.assertIn('AI_API_KEY is required for provider anthropic', completed.stderr)
        self.assertIn('the ai service will not start without it', completed.stderr)
