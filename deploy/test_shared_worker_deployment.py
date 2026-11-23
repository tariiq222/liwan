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
TENANCY = CONTROL / 'runtime-tenancy.sh'
UNIT = CONTROL / 'liwan-shared-worker.service'
EFFECT_SOCKET = CONTROL / 'liwan-effect.socket'
EFFECT_UNIT = CONTROL / 'liwan-effect@.service'
ENTRYPOINT = CONTROL / 'run-shared-worker.sh'
WORKER_MAIN = ROOT / 'apps' / 'control-plane' / 'src' / 'shared-worker-main.ts'
MAIL_ADAPTER = ROOT / 'apps' / 'control-plane' / 'src' / 'commercial' / 'mail-adapter.ts'
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
        cls.block = _between(cls.source, 'tenancy_mode="$(runtime_tenancy_mode)"', 'shared_worker=1\nfi')
        # The mode comes from the shared helper, and the value sourced from runtime.env
        # is dropped before the decision, so the file is the only input.
        assert cls.block.index('unset LIWAN_TENANCY_MODE') < cls.block.index('shared_worker=0')

    def decide(self, runtime_env: str, **env: str) -> subprocess.CompletedProcess:
        with tempfile.TemporaryDirectory(prefix='liwan-run-local-mode-') as home:
            Path(home, 'runtime.env').write_text(runtime_env)
            # run-local.sh sources runtime.env under `set -a` and the mode helper before the
            # decision block; the block then reads the mode from that same file again.
            script = (f'set -euo pipefail\nHOME_DIR={home!r}\nDEPLOY={str(CONTROL)!r}\n'
                      'set -a; . "$HOME_DIR/runtime.env"; set +a\n'
                      'source "$DEPLOY/runtime-tenancy.sh"\n'
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
        self.assertIn('if [[ "$n" == shared-worker && "$(runtime_tenancy_mode)" != shared ]]; then', self.source)
        # The gate reads the mode through the helper that every script shares, from the
        # same private runtime.env the child would be started from.
        self.assertIn('source "$(dirname "$0")/runtime-tenancy.sh"', self.source)
        self.assertIn('. "$HOME_DIR/runtime.env"', TENANCY.read_text(encoding='utf-8'))

    def test_shared_worker_stop_budget_is_derived_from_the_scheduled_mail_bound(self):
        # A stop waits for the mail in flight; its bound lives in TypeScript and the stop
        # budget in bash, so this keeps the two numbers one decision.
        bound_ms = re.search(r'export const SCHEDULED_MAIL_SEND_TIMEOUT_MS = ([\d_]+);',
                             MAIL_ADAPTER.read_text(encoding='utf-8'))
        self.assertIsNotNone(bound_ms, 'the scheduled mail bound must be a named constant')
        inflight = re.search(r'^SHARED_WORKER_INFLIGHT_SECONDS=(\d+)$', self.source, re.MULTILINE)
        self.assertIsNotNone(inflight)
        self.assertEqual(int(inflight.group(1)) * 1000, int(bound_ms.group(1).replace('_', '')))
        script = (f'STOP_SECONDS=30\n{inflight.group(0)}\n'
                  f'{_between(self.source, "stop_budget() {", "fi; }")}\n'
                  'printf "%s %s %s" "$(stop_budget shared-worker)" "$(stop_budget worker)" "$(stop_budget api)"')
        result = _bash(script, _clean_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, f'{int(inflight.group(1)) + 30} 30 30')

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


def _parse_unit(path: Path) -> dict[str, list[tuple[str, str]]]:
    """Every `Key=value` of a unit file in order, per section (a key may repeat, as SystemCallFilter does)."""
    sections: dict[str, list[tuple[str, str]]] = {}
    section = None
    for line in path.read_text(encoding='utf-8').splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(('#', ';')):
            continue
        if stripped.startswith('[') and stripped.endswith(']'):
            section = stripped[1:-1]
            sections[section] = []
        elif section is not None and '=' in stripped:
            key, value = stripped.split('=', 1)
            sections[section].append((key.strip(), value.strip()))
    return sections


# The directives both services carry (docs: the common sandbox set of the effect boundary).
COMMON_SANDBOX = [
    ('NoNewPrivileges', 'true'), ('PrivateTmp', 'true'), ('ProtectSystem', 'strict'), ('ProtectHome', 'true'),
    ('PrivateDevices', 'true'), ('ProtectKernelTunables', 'true'), ('ProtectKernelModules', 'true'),
    ('ProtectKernelLogs', 'true'), ('ProtectControlGroups', 'true'), ('ProtectClock', 'true'),
    ('ProtectHostname', 'true'), ('ProtectProc', 'invisible'), ('ProcSubset', 'pid'), ('CapabilityBoundingSet', ''),
    ('AmbientCapabilities', ''), ('RestrictNamespaces', 'true'), ('RestrictRealtime', 'true'),
    ('RestrictSUIDSGID', 'true'), ('LockPersonality', 'true'), ('SystemCallArchitectures', 'native'),
    ('SystemCallFilter', '@system-service'), ('SystemCallFilter', '~@privileged'), ('SystemCallErrorNumber', 'EPERM'),
]


class EffectBoundaryUnits(unittest.TestCase):
    """The worker has no docker access; tenant effects run as `liwan-effect`, started per connection by a socket."""

    @classmethod
    def setUpClass(cls):
        cls.worker = _parse_unit(UNIT)
        cls.socket = _parse_unit(EFFECT_SOCKET)
        cls.effect = _parse_unit(EFFECT_UNIT)

    @staticmethod
    def values(section: list[tuple[str, str]], key: str) -> list[str]:
        return [value for name, value in section if name == key]

    def test_the_socket_is_root_owned_group_shared_with_the_worker_and_accepts_per_connection(self):
        self.assertEqual([('ListenStream', '/run/liwan-effect.sock'), ('SocketUser', 'root'), ('SocketGroup', 'liwan-worker'),
                          ('SocketMode', '0660'), ('Accept', 'yes'), ('MaxConnections', '8')], self.socket['Socket'])
        self.assertEqual([('WantedBy', 'sockets.target')], self.socket['Install'])

    def test_the_effect_service_runs_the_gate_as_its_own_account_with_the_socket_as_stdio(self):
        service = dict(self.effect['Service'])
        self.assertEqual('liwan-effect', service['User'])
        self.assertEqual('liwan-worker', service['Group'])
        self.assertEqual('docker', service['SupplementaryGroups'])
        self.assertEqual('0007', service['UMask'])
        self.assertEqual('socket', service['StandardInput'])
        self.assertEqual('socket', service['StandardOutput'])
        self.assertEqual('journal', service['StandardError'])
        self.assertEqual('/opt/liwan/current', service['WorkingDirectory'])
        self.assertEqual('/usr/bin/python3 -E -s -B -m tools.shared_saas_lifecycle.effect_gate', service['ExecStart'])
        self.assertEqual('control-group', service['KillMode'])
        self.assertEqual('30', service['TimeoutStopSec'])
        self.assertEqual('7500', service['RuntimeMaxSec'])
        self.assertEqual(['docker.service'], self.values(self.effect['Unit'], 'After'))
        self.assertNotIn('Install', self.effect, 'a template instance is started by its socket, never enabled')
        # The gate reads its runtime config from its own environment and the docker client config from a root-owned directory.
        self.assertEqual(['PATH=/usr/bin:/bin', 'HOME=/nonexistent', 'DOCKER_CONFIG=/etc/liwan/docker',
                          'LIWAN_SHARED_RUNTIME_CONFIG=/srv/liwan/control/config/shared-runtime.json'],
                         self.values(self.effect['Service'], 'Environment'))

    def test_the_deletion_kill_switch_is_set_for_the_gate_only_by_an_optional_operator_file(self):
        self.assertEqual(['-/etc/liwan/effect.env'], self.values(self.effect['Service'], 'EnvironmentFile'))
        text = EFFECT_UNIT.read_text(encoding='utf-8')
        # Disabled by default: the unit never names the flag with a value.
        self.assertNotRegex(text, r'(?m)^(?:Environment=)?LIWAN_TENANT_DELETION_ENABLED=')
        self.assertIn('LIWAN_TENANT_DELETION_ENABLED=true', text)  # the header tells the operator what to put in the file

    def test_the_effect_service_has_the_common_sandbox_and_its_own_network_and_write_scope(self):
        service = self.effect['Service']
        for entry in COMMON_SANDBOX:
            with self.subTest(directive=entry):
                self.assertIn(entry, service)
        self.assertIn(('MemoryDenyWriteExecute', 'true'), service)
        self.assertEqual(['/srv/liwan/control/state'], self.values(service, 'ReadWritePaths'))
        self.assertEqual(['AF_UNIX AF_INET AF_INET6'], self.values(service, 'RestrictAddressFamilies'))
        self.assertEqual(['any'], self.values(service, 'IPAddressDeny'))
        self.assertEqual(['localhost'], self.values(service, 'IPAddressAllow'))

    def test_the_worker_has_the_common_sandbox_without_docker_and_without_write_exec_denial(self):
        service = self.worker['Service']
        for entry in COMMON_SANDBOX:
            with self.subTest(directive=entry):
                self.assertIn(entry, service)
        self.assertEqual(['0007'], self.values(service, 'UMask'))
        self.assertEqual(['/srv/liwan/control/state /srv/liwan/state/registry'], self.values(service, 'ReadWritePaths'))
        self.assertEqual(['-/run/docker.sock -/run/containerd'], self.values(service, 'InaccessiblePaths'))
        self.assertEqual(['AF_INET AF_INET6 AF_UNIX AF_NETLINK'], self.values(service, 'RestrictAddressFamilies'))
        self.assertNotIn('MemoryDenyWriteExecute', dict(service), 'the V8 JIT needs writable executable memory')
        self.assertIn('Environment=LIWAN_EFFECT_SOCKET=/run/liwan-effect.sock', [f'{k}={v}' for k, v in service])
        # Kept as before.
        self.assertIn(('User', 'liwan-worker'), service)
        self.assertIn(('Group', 'liwan-worker'), service)
        self.assertIn(('EnvironmentFile', '/etc/liwan/shared-worker.env'), service)
        self.assertIn(('TimeoutStopSec', '300'), service)

    def test_the_worker_waits_for_the_effect_socket_and_no_longer_requires_docker(self):
        unit = self.worker['Unit']
        self.assertIn(('Requires', 'liwan-effect.socket'), unit)
        self.assertIn('liwan-effect.socket', ' '.join(self.values(unit, 'After')))
        self.assertNotIn('docker', ' '.join(v for k, v in unit if k in ('After', 'Requires', 'Wants', 'BindsTo')))

    def test_docker_access_exists_only_on_the_effect_service(self):
        for path in (UNIT, EFFECT_SOCKET):
            directives = [(k, v) for section in _parse_unit(path).values() for k, v in section]
            with self.subTest(file=path.name):
                self.assertNotIn('SupplementaryGroups', [k for k, _ in directives])
                self.assertEqual([], [d for d in directives if 'docker' in d[1].split()], directives)
        effect_groups = [(k, v) for k, v in self.effect['Service'] if k in ('Group', 'SupplementaryGroups')]
        self.assertEqual([('Group', 'liwan-worker'), ('SupplementaryGroups', 'docker')], effect_groups)
        self.assertNotIn('shared-worker', EFFECT_UNIT.read_text(encoding='utf-8').split('[Service]')[1])
        self.assertNotIn('liwan-worker', self.values(self.effect['Service'], 'User'))

    def test_the_worker_unit_header_installs_all_three_units(self):
        header = UNIT.read_text(encoding='utf-8').split('[Unit]')[0]
        for name in ('liwan-shared-worker.service', 'liwan-effect.socket', 'liwan-effect@.service'):
            self.assertIn(name, header)
        self.assertIn('systemctl enable --now liwan-effect.socket', header)

    def test_the_effect_socket_is_documented_where_the_code_reads_it(self):
        self.assertIn('LIWAN_EFFECT_SOCKET', (CONTROL / 'shared-worker.env.example').read_text(encoding='utf-8'))


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
