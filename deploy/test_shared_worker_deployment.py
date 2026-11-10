# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The shared control-plane worker must actually be started by a deployment file.

Issue #444: `apps/control-plane/src/shared-worker-main.ts` is the only process that
runs the commercial scheduler and pushes tenant status to Odoo, but no deployment
file started it, so a suspension or a renewal never reached Odoo. These tests read
the deployment files (no service is started):

* `run-local.sh` decides the shared worker from `LIWAN_TENANCY_MODE` only, and the
  decision block is executed here in bash for both modes;
* `local-process.sh` knows the process name `shared-worker` and its exact argv;
* the systemd unit is a real supervisor for `run-shared-worker.sh` and names every
  environment variable that entrypoint or `getConfig()` requires.

Compose is deliberately not covered: `deploy/docker-compose.shared.yml` has no
control-plane service because the guard image holds neither the control-plane code,
its Node/tsx dependencies nor a Docker client, and the worker needs the Docker socket
to run its Odoo effects. `deploy/test_image_pins.py` would fail any service added
there without a recorded image, which is the check that keeps that decision honest.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTROL = ROOT / 'deploy' / 'control-plane'
RUN_LOCAL = CONTROL / 'run-local.sh'
LOCAL_PROCESS = CONTROL / 'local-process.sh'
UNIT = CONTROL / 'liwan-shared-worker.service'
ENTRYPOINT = CONTROL / 'run-shared-worker.sh'
WORKER_MAIN = ROOT / 'apps' / 'control-plane' / 'src' / 'shared-worker-main.ts'
RUNBOOK = ROOT / 'docs' / 'operations' / 'saas-commercial-runbook.md'
NODE_BIN = '/opt/homebrew/opt/node@22/bin'  # only interpolated into argv strings; never executed


def _between(text: str, start: str, end: str) -> str:
    """The text from the first `start` up to and including the matching `end`."""
    left = text.index(start)
    right = text.index(end, left)
    return text[left:right + len(end)]


def _bash(script: str, env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run(['/bin/bash', '-c', script], env=env, capture_output=True, text=True, timeout=20)


def _clean_env(**extra: str) -> dict[str, str]:
    """The host PATH plus exactly the variables under test; no inherited mode/paths."""
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
    env.update(extra)
    return env


class RunLocalSharedMode(unittest.TestCase):
    """`run-local.sh` must start the shared worker for shared mode and nothing else."""

    @classmethod
    def setUpClass(cls):
        cls.source = RUN_LOCAL.read_text(encoding='utf-8')
        # The mode decision is one block; executing it in bash is the behavioural
        # check, not a string match on a whole script that needs Docker and Postgres.
        cls.block = _between(cls.source, 'runtime_tenancy_mode="$(', 'shared_worker=1\nfi')
        # The inherited mode is dropped before the decision, so the file is the only input.
        assert cls.block.index('unset LIWAN_TENANCY_MODE') < cls.block.index('shared_worker=0')

    def decide(self, runtime_env: str, **env: str) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory(prefix='liwan-run-local-mode-') as home:
            Path(home, 'runtime.env').write_text(runtime_env)
            # run-local.sh sources runtime.env under `set -a` before the decision block
            # (line 41); the block then reads the mode from that same file again.
            script = (f'set -euo pipefail\nHOME_DIR={home!r}\n'
                      'set -a; . "$HOME_DIR/runtime.env"; set +a\n'
                      f'{self.block}\n'
                      'printf "shared_worker=%s\\n" "$shared_worker"')
            return _bash(script, _clean_env(**env))

    def test_dedicated_mode_starts_api_and_worker_only(self):
        for runtime_env in ('', 'export LIWAN_TENANCY_MODE=dedicated\n'):
            with self.subTest(runtime_env=runtime_env):
                result = self.decide(runtime_env)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), 'shared_worker=0')

    def test_an_exported_shell_mode_does_not_override_the_private_runtime_file(self):
        # The decision must match what the child will read from runtime.env; a stray
        # exported variable in the operator's shell must not start a process the
        # child would then refuse or misconfigure.
        (result,) = [self.decide('', LIWAN_TENANCY_MODE='shared',
                                LIWAN_SHARED_RUNTIME_CONFIG='/etc/liwan/shared-runtime.json',
                                LIWAN_TENANT_REGISTRY_PATH='/etc/liwan/registry.json')]
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'shared_worker=0')

    def test_shared_mode_with_absolute_paths_starts_the_third_process(self):
        result = self.decide('export LIWAN_TENANCY_MODE=shared\n'
                             'export LIWAN_SHARED_RUNTIME_CONFIG=/etc/liwan/shared-runtime.json\n'
                             'export LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'shared_worker=1')

    def test_shared_mode_refuses_missing_or_relative_paths_before_starting_anything(self):
        for runtime_env in ('export LIWAN_TENANCY_MODE=shared\n'
                            'export LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json\n',
                            'export LIWAN_TENANCY_MODE=shared\n'
                            'export LIWAN_SHARED_RUNTIME_CONFIG=/etc/liwan/shared-runtime.json\n',
                            'export LIWAN_TENANCY_MODE=shared\n'
                            'export LIWAN_SHARED_RUNTIME_CONFIG=relative/shared-runtime.json\n'
                            'export LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json\n'):
            with self.subTest(runtime_env=runtime_env):
                result = self.decide(runtime_env)
                self.assertEqual(result.returncode, 8, result.stdout + result.stderr)
                self.assertIn('absolute', result.stderr)

    def test_the_start_calls_are_gated_on_the_decision(self):
        # Unconditional children stay exactly what a dedicated runtime has today.
        self.assertIn('"$DEPLOY/local-process.sh" start api\n', self.source)
        self.assertIn('"$DEPLOY/local-process.sh" start worker\n', self.source)
        gated = '[[ "$shared_worker" == 0 ]] || "$DEPLOY/local-process.sh" start shared-worker'
        self.assertIn(gated, self.source)
        # No other line starts it: exactly one start of the shared worker, and it is gated.
        starts = [line for line in self.source.splitlines()
                  if 'local-process.sh" start shared-worker' in line]
        self.assertEqual(starts, [gated])
        # The generation record is published for the shared worker only in shared mode.
        self.assertIn('children=(api worker); [[ "$shared_worker" == 0 ]] || children+=(shared-worker)',
                      self.source)

    def test_dedicated_paths_do_not_name_the_shared_worker_entrypoint(self):
        # The only reference to the shared worker outside the decision block is the
        # gated start and the gated generation record above.
        lines = [line for line in self.source.splitlines()
                 if 'shared-worker' in line or 'shared_worker' in line]
        allowed = re.compile(r'shared_worker|shared-worker-main|start shared-worker|children\+=\(')
        for line in lines:
            with self.subTest(line=line):
                self.assertRegex(line, allowed)


class LocalProcessSharedWorker(unittest.TestCase):
    """`local-process.sh` owns the process name and its exact argv."""

    @classmethod
    def setUpClass(cls):
        cls.source = LOCAL_PROCESS.read_text(encoding='utf-8')

    def expected_argv(self, name: str) -> str:
        script = (f'NODE_BIN={NODE_BIN!r}; ROOT={str(ROOT)!r}\n'
                  f'{_between(self.source, "expected() {", "esac; }")}\n'
                  f'expected {name}')
        result = _bash(script, _clean_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_start_status_stop_accept_the_shared_worker(self):
        usage = _between(self.source, 'case "$mode:$name" in', 'exit 2;;')
        for action in ('start', 'status', 'stop'):
            self.assertIn(f'{action}:shared-worker', usage)
        self.assertIn('recover:runtime', usage)

    def test_expected_argv_is_the_shared_worker_entrypoint(self):
        self.assertTrue(WORKER_MAIN.is_file(), 'the shared worker entrypoint must exist')
        argv = self.expected_argv('shared-worker')
        self.assertEqual(argv, f'{NODE_BIN}/node {ROOT}/node_modules/tsx/dist/cli.mjs '
                               f'{ROOT}/apps/control-plane/src/shared-worker-main.ts')
        # api and worker keep their argv, so a dedicated generation is unchanged.
        self.assertEqual(self.expected_argv('api'),
                         f'{NODE_BIN}/node {ROOT}/node_modules/tsx/dist/cli.mjs '
                         f'{ROOT}/apps/control-plane/src/main.ts')
        self.assertEqual(self.expected_argv('worker'),
                         f'{NODE_BIN}/node {ROOT}/node_modules/tsx/dist/cli.mjs '
                         f'{ROOT}/apps/control-plane/src/worker-main.ts')

    def test_start_maps_the_name_to_the_entrypoint_and_gates_on_shared_mode(self):
        self.assertIn('shared-worker) script=shared-worker-main;;', self.source)
        self.assertIn('if [[ "$n" == shared-worker ]] && ! shared_mode; then', self.source)
        # The gate reads the same private runtime.env the child would be started from.
        self.assertIn('. "$HOME_DIR/runtime.env"', self.source)

    def test_generation_records_include_the_shared_worker(self):
        records = _between(self.source, 'RECORD_NAMES=(', ')')
        self.assertIn('shared-worker.pid', records)
        self.assertIn('shared-worker.start', records)
        self.assertIn('shared-worker.generation', records)
        # Stop and status must handle it, otherwise it is started and never supervised.
        self.assertIn('"$state/shared-worker.pid" "$state/shared-worker.start" "$state/shared-worker.generation"',
                      self.source)
        self.assertIn('valid shared-worker || { printf \'Shared worker identity mismatch.', self.source)

    def test_a_dedicated_generation_without_the_record_is_still_complete(self):
        # prevalidate_owners must not require shared-worker.* when it was never written.
        self.assertIn('[[ "$(owner_state shared-worker)" == missing ]] || names="$names shared-worker"',
                      self.source)


class SupervisorUnit(unittest.TestCase):
    """The systemd unit is the deployment file that actually starts the worker."""

    @classmethod
    def setUpClass(cls):
        cls.text = UNIT.read_text(encoding='utf-8')
        cls.sections: dict[str, dict[str, str]] = {}
        section = None
        for line in cls.text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith('#') or stripped.startswith(';'):
                continue
            if stripped.startswith('[') and stripped.endswith(']'):
                section = stripped[1:-1]
                cls.sections[section] = {}
            elif section is not None and '=' in stripped:
                key, value = stripped.split('=', 1)
                cls.sections[section][key.strip()] = value.strip()

    def test_entrypoint_exists_is_executable_and_runs_the_worker_main(self):
        self.assertTrue(ENTRYPOINT.is_file())
        self.assertTrue(os.access(ENTRYPOINT, os.X_OK), 'systemd ExecStart needs an executable file')
        entrypoint = ENTRYPOINT.read_text(encoding='utf-8')
        self.assertIn('apps/control-plane/src/shared-worker-main.ts', entrypoint)
        self.assertIn('LIWAN_TENANCY_MODE', entrypoint)
        self.assertIn('LIWAN_SHARED_RUNTIME_CONFIG', entrypoint)
        self.assertIn('LIWAN_TENANT_REGISTRY_PATH', entrypoint)

    def test_unit_runs_the_shared_entrypoint(self):
        service = self.sections['Service']
        # A unit on a host names the deployment prefix, not this checkout; the tail must
        # still be the repository's own entrypoint.
        self.assertTrue(service['ExecStart'].endswith('/deploy/control-plane/run-shared-worker.sh'),
                        service['ExecStart'])
        self.assertEqual(Path(service['WorkingDirectory']).name, 'current')
        self.assertEqual(service['Type'], 'simple')
        self.assertNotEqual(service.get('User', '').strip(), 'root')
        self.assertIn(service.get('Restart'), ('on-failure', 'always'))
        self.assertIn('KillSignal', service)

    def test_unit_injects_every_required_variable_from_a_private_file(self):
        service = self.sections['Service']
        env_file = Path(service['EnvironmentFile'].lstrip('-'))
        self.assertEqual(env_file, Path('/etc/liwan/shared-worker.env'))
        # The unit comments carry the required names; the EnvironmentFile carries values.
        # LIWAN_CLI_PYTHON is optional (getConfig defaults it), so it is not in this list.
        required = ('LIWAN_TENANCY_MODE', 'LIWAN_SHARED_RUNTIME_CONFIG', 'LIWAN_TENANT_REGISTRY_PATH',
                    'CONTROL_DATABASE_URL', 'CONTROL_INSTALLATION_ID', 'CONTROL_SERVICE_KEY',
                    'LIWAN_CLI_INVENTORY', 'LIWAN_CLI_STATE_DIR', 'LIWAN_REPOSITORY_ROOT')
        for name in required:
            with self.subTest(name=name):
                self.assertIn(name, self.text)
        # Every name getConfig() calls required() on must be covered above.
        config = (ROOT / 'apps' / 'control-plane' / 'src' / 'config.ts').read_text(encoding='utf-8')
        self.assertIn("required('CONTROL_INSTALLATION_ID')", config)
        self.assertIn("required('LIWAN_CLI_INVENTORY')", config)
        self.assertIn("required('LIWAN_CLI_STATE_DIR')", config)
        self.assertIn("required('LIWAN_REPOSITORY_ROOT')", config)
        self.assertIn("required('CONTROL_DATABASE_URL')", config)
        self.assertIn("LIWAN_CLI_PYTHON ?? 'python3'", config)
        for name in required:
            with self.subTest(name=name):
                self.assertIn(name, self.text)
        # No value of a secret is written here.
        self.assertNotRegex(self.text, r'(?m)^(?:Environment=)?[A-Z_]*(?:KEY|SECRET|PASSWORD|TOKEN)=[^\s<]')

    def test_unit_documents_the_install_and_the_health_signal(self):
        self.assertIn('/etc/systemd/system/', self.text)
        self.assertIn('systemctl enable --now liwan-shared-worker', self.text)


class RunbookNamesTheRealMechanism(unittest.TestCase):
    def test_runbook_names_the_unit_local_runtime_and_the_log_line(self):
        text = RUNBOOK.read_text(encoding='utf-8')
        self.assertIn('deploy/control-plane/liwan-shared-worker.service', text)
        self.assertIn('deploy/control-plane/run-shared-worker.sh', text)
        self.assertIn('status-local.sh', text)
        self.assertIn('commercial_scheduler_tick', text)
        # The scheduler line the runbook tells the operator to watch must exist.
        scheduler = (ROOT / 'apps' / 'control-plane' / 'src' / 'commercial' / 'scheduler.ts').read_text(encoding='utf-8')
        self.assertIn("event: 'commercial_scheduler_tick'", scheduler)


if __name__ == '__main__':
    unittest.main()
