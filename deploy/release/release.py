#!/usr/bin/env python3
"""Release command: apply the candidate commit of one environment to this server. An Openship job runs it.

  release.py run      --environment <name> [--tag <tag>]   resolve, verify, pull, back up, stop, snapshot, upgrade, start, open, commit
  release.py status   --environment <name>   print the served release, the unfinished run and the halt record
  release.py rollback --environment <name>   clear a halt and finish the rollback of an unfinished run

An environment with ``LIWAN_RELEASE_TAG_POLICY=highest`` follows the highest ``release/19.0.X.Y.Z`` tag; one with
``explicit`` applies only the tag it is given with ``--tag`` and refuses to run without one. The
candidate and its release document (the image ``liwan-release:<commit>`` in the private GHCR registry) are read with
the read-only credentials in ``LIWAN_GHCR_READ_USER``, ``LIWAN_GHCR_READ_TOKEN`` and, optionally,
``LIWAN_GITHUB_READ_TOKEN`` (the source repository is public today). The command never waits for
input. The last log line is ``RESULT: committed <commit>``, ``RESULT: rolled back <reason>``, ``RESULT: nothing to do``,
``RESULT: refused <reason>``, ``RESULT: halted <reason>`` or ``RESULT: incomplete <commit> <reason>``; the exit code
is 0 (committed, nothing to do), 2 (refused), 3 (halted), 4 (rolled back or incomplete) or 5 (rollback failed).

The environment name selects the root-only config ``/etc/liwan-release/<name>.env`` (mode 0600). Every phase is written
to ``run.json`` before it acts, so a killed run resumes from real state: forward up to ``snapshotted``, rollback from
``upgrading`` and ``starting``, forward again from ``opening``. Rollback swaps the pre-upgrade database snapshots and
filestore copies back and restarts the previous release. Arguments never carry a secret.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
import platform
import re
import shutil
import stat
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from deploy.release import databases  # noqa: E402 - path set just above
from deploy.release.common import (  # noqa: E402
    EXIT_FAILED, EXIT_HALTED, EXIT_OK, EXIT_REFUSED, EXIT_ROLLBACK_FAILED, FAILURE_TAIL_LINES, TIMED_OUT, CommandFailed, Lock,
    ReleaseError,
    Runner, free_bytes, make_log, now, read_env_file, sensitive_values, read_json, write_atomic, write_json)
from deploy.release.source import (  # noqa: E402
    COMMIT, ENVIRONMENT_NAME, GITHUB_TOKEN_VAR, TAG_POLICY_KEY, TOKEN_VAR, USER_VAR, Credential, Source, explicit_tag,
    host_architecture)
from deploy.release.tenant_postgres import (  # noqa: E402
    ODOO_RUNTIME_ROLE, POSTGRES_ADMIN_ROLE, RUNTIME_ROLE_RULES, identifier, runtime_role_assertion_sql, tenant_isolation_statements)

TENANT_DATABASE = re.compile(r'^[a-z][a-z0-9_]{0,62}$')
# What psql prints when the host's volume has no usable admin role: the role is missing, its login is refused, or
# DB_ADMIN_PASSWORD does not match the password the volume was bootstrapped with. The other refusals print the reason of
# RUNTIME_ROLE_RULES. A transient connection failure (the container restarting, the server still starting) names none of
# these, so the next run retries it instead of recording the candidate as failed.
ROLE_PROBLEM_OUTPUT = re.compile(
    rf'role "{POSTGRES_ADMIN_ROLE}" does not exist'
    rf'|password authentication failed for user "{POSTGRES_ADMIN_ROLE}"'
    rf'|role "{POSTGRES_ADMIN_ROLE}" is not permitted to log in')
RELEASE_FOLDER = re.compile(r'^([0-9a-f]{40})(\.partial|\.tar)?$')
CONTROL_DB = 'liwan_control'
CONTROL_DB_USER = 'liwan_control'
CONTROL_PROJECT = 'liwan-control'
SHARED_WORKER_UNIT = 'liwan-shared-worker.service'
APP_SERVICES = ('odoo', 'web', 'ai')
PROXY_SERVICE = 'proxy'
EDGE_SERVICE = 'guard'
UP = ('up', '-d', '--wait', '--no-build', '--pull', 'never')
WORKER_WORKSPACE = 'apps/control-plane'
# The control project's long-running services the release manages. The shared stack joins the networks the project creates
# (control and console edge) as external, so both start before it; the console waits for the API's health itself.
CONTROL_SERVICES = ('control-api', 'vendor-console')
WORKER_STOPPED_PHASES = ('quiescing', 'captured', 'stopping', 'snapshotted', 'upgrading', 'starting', 'opening',
                         'opened')
MAINTENANCE_PHASES = ('stopping', 'snapshotted', 'upgrading', 'starting', 'opening')
PRE_SNAPSHOT_PHASES = ('verified', 'quiescing', 'captured')
# From `opened` on, customers can write to the new release: a failure never rolls back, the next run resumes.
POST_OPEN_PHASES = ('opened', 'committed', 'cleanup')
ROLLBACK_PHASES = ('upgrading', 'starting', 'rolling_back')
CLASSIFICATION_DIR = '/run/liwan-runtime/classifications'
SMOKE_MARKER = 'UPGRADE_SMOKE_OK'
PULL_TIMEOUT_SECONDS = 600  # one attempt; a stuck pull was seen to hang past 7 minutes
PULL_ATTEMPTS = 3
PULL_RETRY_PAUSE_SECONDS = 10
# npm writes node_modules/.package-lock.json last, so its presence marks a finished install of the worker's workspace.
DEPENDENCY_MARKER = 'node_modules/.package-lock.json'
# The wait between `systemctl start` and the check of the worker. The unit restarts a crashed worker only after
# RestartSec=10, and until then it is `activating (auto-restart)`, which `is-active` reports as not active; the wait
# must stay below that delay, or a worker that crashed at once is seen again as active.
WORKER_SETTLE_SECONDS = 5
AI_DATABASE_URL_KEY = 'AI_DATABASE_URL'
ODOO_CONFIG_KEY = 'LIWAN_SHARED_ODOO_CONFIG'
RESTORE_ODOO_CONFIG_KEY = 'LIWAN_RESTORE_ODOO_CONFIG'
VENDOR_ADMIN_ENV_KEY = 'LIWAN_VENDOR_ADMIN_ENV_FILE'
ALERT_REASON_PREFIX = 'alerts: '  # how deploy/alerts.py starts the reason it writes to stderr
BACKUP_COPIES = 3  # the encrypted capture stages a dump, a plain tar and a ciphertext under the work root
DISK_MARGIN = 1.5  # free space must cover every snapshot (database plus filestore) with half again as much
# Each release renders its own stack: `python3 -B -m deploy.stack.render bundle` run inside its checkout writes the files and the
# `stack.json` manifest this command reads, so no release's template is ever read by another release's code.
STACK_RENDERER = 'deploy/stack/render.py'
STACK_MANIFEST = 'stack.json'
STACK_CONTRACT = 1
# The first line of a config this command rendered: a live config without it is a hand-written one, adopted only when it
# says what the render says (`odoo_config_drift`). Both lines of the template header carry it.
RENDERED_MARKER = '; Rendered by deploy/stack/render.py'
CONFIG_KEYS = ('LIWAN_RELEASE_PROJECT', 'LIWAN_SHARED_ENV_FILE', 'LIWAN_RELEASE_PG_DUMP', 'LIWAN_RELEASE_PG_HOST',
               'LIWAN_RELEASE_CONTROL_PG_HOST', 'LIWAN_RELEASE_ODOO_DATA_DIR', 'LIWAN_RELEASE_DISK_PATH')
# The loopback ports the two host-link overlays publish; the shared env file sets them, these are the overlays' defaults.
TENANT_DB_PORT = ('LIWAN_DB_HOST_PORT', '15433')
CONTROL_DB_PORT = ('LIWAN_CONTROL_DB_HOST_PORT', '15432')


def runtime_role_failure_output(output: str) -> bool:
    """Whether a failed role check names a problem with the host's volume — a rule of RUNTIME_ROLE_RULES, or a missing,
    unloggable or wrongly authenticated admin role — rather than a transient connection error the next run can retry."""
    return any(reason in output for reason, _ in RUNTIME_ROLE_RULES) or bool(ROLE_PROBLEM_OUTPUT.search(output))


@dataclass(frozen=True)
class StackBundle:
    """What a release's renderer wrote for one environment (``stack.json`` names every file, relative to its directory)."""
    compose: Path
    env_files: list
    odoo_conf: Path
    project_directory: Path


class Paths:
    def __init__(self, config_root=Path('/etc/liwan-release'), state_root=Path('/var/lib/liwan-release'),
                 releases=Path('/opt/liwan/releases'), current=Path('/opt/liwan/current'),
                 maintenance=Path('/var/lib/liwan-release/maintenance/active')):
        self.config_root, self.state_root, self.releases = config_root, state_root, releases
        self.current, self.maintenance = current, maintenance


def load_config(paths: Paths, environment: str) -> dict[str, str]:
    """The root-only config of one environment; a readable-by-others or foreign-owned file is refused."""
    if not ENVIRONMENT_NAME.fullmatch(environment):
        raise ReleaseError('invalid_environment', EXIT_REFUSED, 'an environment name is lowercase letters, digits and hyphens')
    path = paths.config_root / f'{environment}.env'
    if not path.is_file():
        raise ReleaseError('missing_config', EXIT_REFUSED, f'{path} does not exist')
    info = path.stat()
    if info.st_mode & 0o077 or info.st_uid != os.geteuid():
        raise ReleaseError('config_not_private', EXIT_REFUSED, f'{path} must be mode 0600 and owned by the running user')
    config = read_env_file(path)
    missing = [key for key in CONFIG_KEYS if not config.get(key)]
    if missing:
        raise ReleaseError('invalid_config', EXIT_REFUSED, f'{path} lacks {", ".join(missing)}')
    return config


def unreadable_by_worker(info: os.stat_result) -> bool:
    """A root-owned file that group and others cannot read: the worker account could never read what is copied from it."""
    return info.st_uid == 0 and not info.st_mode & 0o044


def release_env_text(commit: str, odoo_commit: str) -> str:
    return f'LIWAN_IMAGE_TAG={commit}\nODOO_COMMIT={odoo_commit}\n'


def normalize_tree(root: Path) -> None:
    """Release trees are read by the liwan-worker user: 0755 directories, 0644 files, exec bits kept."""
    root.chmod(0o755)
    for directory, dirnames, filenames in os.walk(root):
        for name in dirnames + filenames:
            path = Path(directory) / name
            if path.is_symlink():
                continue
            mode = path.stat().st_mode
            path.chmod(0o755 if path.is_dir() or mode & 0o111 else 0o644)


class Releaser:
    def __init__(self, environment: str, config: dict[str, str], paths: Paths, runner, log, environ: dict, machine: str,
                 tag: str | None = None):
        self.environment = environment
        self.tag = tag
        self.config = config
        self.paths = paths
        self.runner = runner
        self.log = log
        self.environ = environ
        self.machine = machine
        self.state = paths.state_root / environment
        self.docker_config = self.state / 'docker-config'
        credentials = (USER_VAR, TOKEN_VAR, GITHUB_TOKEN_VAR)
        self.child_env = {**{k: v for k, v in environ.items() if k not in credentials}, **config,
                          'DOCKER_CONFIG': str(self.docker_config)}
        self.platform = ''
        self.source: Source | None = None
        self.bundles: dict = {}

    def run_command(self, argv: list[str], *, env: dict | None = None, **options) -> tuple[int, str]:
        """Every subprocess gets an explicit environment: a call that names none gets ``child_env``, which holds no token."""
        return self.runner(argv, env=self.child_env if env is None else env, **options)

    # --- results and state files -----------------------------------------------------------------------
    def finish(self, code: int, result: str) -> int:
        self.log(f'RESULT: {result}')
        return code

    def file(self, name: str) -> Path:
        return self.state / name

    def set_phase(self, run: dict, phase: str) -> None:
        run['phase'] = phase
        run['updatedAt'] = now()
        write_json(self.file('run.json'), run)
        self.log(f'phase {phase} ({run["commit"]})')

    def current_release_env(self) -> str | None:
        path = self.file('release.env')
        return path.read_text(encoding='utf-8') if path.exists() else None

    # --- maintenance marker (Caddy shows the maintenance page only while it exists) --------------------
    def enter_maintenance(self) -> None:
        marker = self.paths.maintenance
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.parent.chmod(0o755)
        marker.touch()
        marker.chmod(0o644)

    def leave_maintenance(self) -> None:
        self.paths.maintenance.unlink(missing_ok=True)

    # --- run -------------------------------------------------------------------------------------------
    def require_current_symlink(self) -> None:
        """``current`` is only ever replaced by a symlink into releases/; a real directory would fail mid-upgrade."""
        current = self.paths.current
        if current.exists() and not current.is_symlink():
            raise ReleaseError('current_not_symlink', EXIT_REFUSED,
                               f'{current} must be a symlink into {self.paths.releases}, not a directory')
        if current.is_symlink() and not current.exists():
            raise ReleaseError('current_dangling', EXIT_REFUSED,
                               f'{current} points at {os.readlink(current)}, which does not exist; relink it to a release folder')

    def run(self) -> int:
        tag = explicit_tag(self.shared_env().get(TAG_POLICY_KEY), self.tag)
        self.require_current_symlink()
        halted = read_json(self.file('halted.json'))
        if halted is not None:
            self.log('halted: fix the cause, then run "rollback" to finish and clear it')
            return self.finish(EXIT_HALTED, f'halted {halted.get("reason", "unknown")}')
        credential = Credential.from_environment(self.environ)
        self.platform = f'linux/{host_architecture(self.machine)}'
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state.chmod(0o700)
        self.docker_config.mkdir(exist_ok=True, mode=0o700)
        self.docker_config.chmod(0o700)
        github_token = self.environ.get(GITHUB_TOKEN_VAR) or None
        self.source = Source(tag, self.state, credential, github_token, self.run_command, self.log,
                             self.child_env)
        self.source.login()
        unfinished = read_json(self.file('run.json'))
        if unfinished is not None:
            return self.resume(unfinished)
        served = read_json(self.file('served.json'))
        candidate = self.source.candidate()
        if candidate is None:
            return self.finish(EXIT_OK, 'nothing to do: no release tag exists')
        if served is not None and served['commit'] == candidate['commit']:
            return self.finish(EXIT_OK, f'nothing to do: serving {served["commit"]}')
        failed = read_json(self.file('failed.json'))
        if failed is not None and failed['commit'] == candidate['commit']:
            return self.finish(EXIT_HALTED, f'nothing to do: {failed["commit"]} failed before ({failed["reason"]}); '
                               'run "rollback" to try it again')
        self.source.fetch(candidate['commit'])
        self.source.refuse_older(candidate, served)
        self.source.require_on_main(candidate)
        document = self.source.document(candidate, self.platform.removeprefix('linux/'))
        run = {**candidate, 'document': document, 'previous': served,
               'previousReleaseEnv': self.current_release_env(), 'startedAt': now()}
        self.set_phase(run, 'verified')
        return self.forward(run)

    def resume(self, run: dict) -> int:
        self.log(f'resuming {run["commit"]} at {run["phase"]}')
        if run['phase'] in ROLLBACK_PHASES:
            return self.roll_back(run, run.get('failure', 'interrupted'))
        return self.forward(run)

    def forward(self, run: dict) -> int:
        steps = (('verified', self.prepare), ('quiescing', self.quiesce), ('captured', self.capture), ('stopping', self.stop),
                 ('snapshotted', self.snapshot), ('upgrading', self.upgrade), ('starting', self.start),
                 ('opening', self.open), ('opened', self.reopen), ('committed', self.commit), ('cleanup', self.cleanup))
        names = [name for name, _ in steps]
        if run['phase'] in WORKER_STOPPED_PHASES[1:] and run['previous'] is not None:
            self.stop_worker()  # a resumed run keeps the worker stopped, as the interrupted one had it
        for name, step in steps[names.index(run['phase']):]:
            if run['phase'] != name:
                self.set_phase(run, name)
            if name in MAINTENANCE_PHASES:
                self.enter_maintenance()
            try:
                step(run)
            except (ReleaseError, CommandFailed, OSError, ValueError) as error:
                reason = error.reason if isinstance(error, ReleaseError) else f'{name}_failed'
                code = error.exit_code if isinstance(error, ReleaseError) else EXIT_FAILED
                if isinstance(error, ReleaseError) and error.detail:
                    self.log(error.detail)
                return self.fail(run, name, reason, code)
        return self.finish(EXIT_OK, f'committed {run["commit"]}')

    def fail(self, run: dict, phase: str, reason: str, code: int) -> int:
        if phase in PRE_SNAPSHOT_PHASES:  # nothing but the worker was stopped, and the served release never moved
            if phase != 'verified' and run['previous'] is not None:
                reason = self.restart_worker(reason)
            self.alert('deploy_failed', run['commit'], phase, reason)
            self.file('run.json').unlink()
            if phase != 'verified' or reason == 'runtime_role_rejected':
                # A refusal before anything stopped costs nothing to repeat, except one about the host's volume: it
                # does not change with the next scheduled run, so it alerts once per candidate (``rollback`` clears it).
                self.record_failure(run['commit'], reason)
            if code == EXIT_REFUSED:
                return self.finish(EXIT_REFUSED, f'refused {reason}')
            return self.finish(EXIT_FAILED, f'rolled back {reason}')
        if phase in POST_OPEN_PHASES:  # served.json is written; the next run resumes from run.json
            self.alert('deploy_failed', run['commit'], phase, reason)
            return self.finish(EXIT_FAILED, f'incomplete {run["commit"]} {reason}')
        return self.roll_back(run, reason)

    def record_failure(self, commit: str, reason: str) -> None:
        """A candidate that failed after the stop is not retried until the candidate changes or ``rollback`` clears it."""
        write_json(self.file('failed.json'), {'commit': commit, 'reason': reason, 'at': now()})

    def restart_worker(self, reason: str) -> str:
        """Nothing else was stopped, so the served release keeps running; a worker that stays down is the reason."""
        try:
            self.start_worker()
        except (ReleaseError, CommandFailed):
            return 'worker_not_ready'
        return reason

    def halt(self, run: dict, phase: str, reason: str, event: str) -> None:
        write_json(self.file('halted.json'), {'commit': run['commit'], 'phase': phase, 'reason': reason,
                                              'event': event, 'at': now()})
        self.alert(event, run['commit'], phase, reason)

    def alert(self, event: str, commit: str, phase: str, reason: str) -> None:
        code, output = self.run_command(['python3', '-B', str(ROOT / 'deploy/alerts.py'), event, '--environment',
                                    self.environment, '--release', commit, '--phase', phase, '--reason', reason],
                                   env=self.child_env, check=False)
        if code != 0:
            reasons = [line.removeprefix(ALERT_REASON_PREFIX) for line in output.splitlines()
                       if line.startswith(ALERT_REASON_PREFIX)]
            self.log(f'alert {event} was not delivered (exit {code})' + (f': {reasons[-1]}' if reasons else ''))

    # --- steps -----------------------------------------------------------------------------------------
    def checkout(self, commit: str) -> Path:
        return self.paths.releases / commit

    def prepare(self, run: dict) -> None:
        """Checkout with the worker's dependencies, every image by digest, and the disk checks; nothing running changes."""
        self.shared_compose_target()  # a render that can only fail after the stop is refused here
        self.require_config_target(ODOO_CONFIG_KEY)
        self.require_host_file(VENDOR_ADMIN_ENV_KEY)
        self.require_classification_dir()
        if run['previous'] is not None:  # a served release that cannot render its own stack cannot be stopped or rolled back to
            self.stack(self.paths.current.resolve(), self.file('release.env'), 'previous_not_stack')
        target = self.checkout(run['commit'])
        if not target.exists():
            self.extract(run['commit'], target)
        elif not (target / DEPENDENCY_MARKER).exists():  # a folder made by hand, or by an install that never finished
            self.install_dependencies(target)
            normalize_tree(target)
        self.prepare_odoo_config(target)
        self.require_renderable(run, target)
        if run['previous'] is not None:  # before the first image pull and the first size query, both of which assume the admin role
            self.assert_runtime_role(self.paths.current.resolve(), {'tenants': self.tenants(target)})
        images = self.images(target, run['document'])
        for image in self.external_images(target):  # not recorded below: no old release's prune may remove one
            self.pull(image)
        pulled = []
        for reference, image in images:
            self.pull(image)
            self.run_command(['docker', 'tag', image, f'{reference}:{run["commit"]}'])
            pulled += [image, f'{reference}:{run["commit"]}']
        write_json(self.file(f'releases/{run["commit"]}.json'), {'images': pulled})
        self.check_disk(run, target)

    def pull(self, image: str) -> None:
        """One image, a bounded number of attempts each with a timeout: a stuck or reset connection must not stall the run."""
        for attempt in range(1, PULL_ATTEMPTS + 1):
            try:
                self.run_command(['docker', 'pull', '--quiet', image], env=self.child_env, timeout=PULL_TIMEOUT_SECONDS)
                return
            except CommandFailed as error:
                how = 'timed out' if error.returncode == TIMED_OUT else 'failed'
                self.log(f'pull of {image} {how} (attempt {attempt} of {PULL_ATTEMPTS})')
                if attempt < PULL_ATTEMPTS:
                    time.sleep(PULL_RETRY_PAUSE_SECONDS)
        raise ReleaseError('image_pull_failed')

    def external_images(self, checkout: Path) -> list[str]:
        """Every third-party image the stacks run as ``reference@digest``, from the pins of the candidate's checkout."""
        _, output = self.run_command(['python3', '-B', str(checkout / 'deploy/image_pins.py'), '--print-external'])
        return output.split()

    def extract(self, commit: str, target: Path) -> None:
        """git archive, the shared worker's node dependencies, readable modes."""
        staging = target.with_name(target.name + '.partial')
        if staging.exists():
            shutil.rmtree(staging)
        staging.mkdir(parents=True)
        archive = staging.parent / f'{commit}.tar'
        self.source.archive(commit, archive)
        self.run_command(['tar', '-x', '-f', str(archive), '-C', str(staging)])
        archive.unlink()
        self.install_dependencies(staging)
        normalize_tree(staging)
        self.paths.releases.chmod(0o755)
        os.replace(staging, target)

    def install_dependencies(self, root: Path) -> None:
        """The shared worker's node dependencies (tsx is a dev dependency needed at run time, so dev packages are installed
        even when NODE_ENV=production). A failed install removes what it left, so no later run takes it as complete."""
        try:
            self.run_command(['npm', '--prefix', str(root), 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
                              '--include=dev', '--workspace', WORKER_WORKSPACE], env=self.child_env)
        except CommandFailed:
            shutil.rmtree(root / 'node_modules', ignore_errors=True)
            raise ReleaseError('worker_dependencies_failed') from None

    def images(self, checkout: Path, document: dict) -> list[tuple[str, str]]:
        """(local name, registry image@digest of the host's architecture) for every published build; the document must
        list exactly those."""
        images = document['images']
        _, output = self.run_command(['python3', '-B', str(checkout / 'deploy/image_pins.py'), '--print-builds'])
        published = {}
        for line in output.splitlines():
            registry_image, reference = line.split('\t')[:2]
            if registry_image != '-':
                published[reference] = registry_image
        if set(published) != set(images) or any(not images[ref].startswith(published[ref] + '@') for ref in published):
            raise ReleaseError('document_images_mismatch', EXIT_REFUSED)
        return sorted((reference, f'{published[reference]}@{document["platforms"][reference][self.platform]}')
                      for reference in published)

    def check_disk(self, run: dict, checkout: Path) -> None:
        """Refuse before anything stops when the free space cannot hold a snapshot of every database and filestore."""
        if run['previous'] is None:
            return
        current = self.paths.current.resolve()
        tenants = self.tenants(checkout)
        names = {item['database']: item for item in tenants}
        quoted = ','.join(databases.literal(name) for name in names)
        sizes = {} if not names else dict(row.split('|') for row in self.psql(
            current, f'SELECT datname, pg_database_size(datname) FROM pg_database WHERE datname IN ({quoted});\n').splitlines())
        control = self.psql(current, f'SELECT pg_database_size({databases.literal(CONTROL_DB)});\n', control=True)
        needed = int(control) + sum(int(size) for size in sizes.values())
        filestores = {item['database']: databases.tree_bytes(Path(item['filestore'])) for item in tenants}
        needed += sum(filestores.values())
        largest = max([int(control)] + [int(size) + filestores[name] for name, size in sizes.items()])
        needed += BACKUP_COPIES * largest  # the encrypted capture of the largest database, one at a time
        required = int(needed * DISK_MARGIN)
        free = free_bytes(self.config['LIWAN_RELEASE_DISK_PATH'])
        if free < required:
            raise ReleaseError('insufficient_disk', EXIT_REFUSED,
                               f'{free} bytes are free but a snapshot of every database and filestore needs {required}')

    def quiesce(self, run: dict) -> None:
        """Stop the shared worker before the inventory, so no tenant is provisioned past the snapshot."""
        if run['previous'] is not None:
            self.stop_worker()
        run['tenants'] = self.tenants(self.checkout(run['commit']))
        if run['previous'] is None and run['tenants']:
            raise ReleaseError('bootstrap_with_tenants', EXIT_REFUSED)
        write_json(self.file('run.json'), run)

    def tenants(self, checkout: Path) -> list[dict]:
        registry = Path(read_env_file(Path(self.config['LIWAN_SHARED_ENV_FILE']))['LIWAN_TENANT_REGISTRY_DIR'])
        registry_file = registry / 'registry.json'
        if not registry_file.exists():
            return []  # no tenant was ever created on this host
        try:
            _, output = self.run_command(['node', str(checkout / 'deploy/shared/backup-binding.mjs'), '--list',
                                          str(registry_file)])
        except CommandFailed:
            raise ReleaseError('tenant_registry_unavailable') from None
        try:
            items = json.loads(output)
        except ValueError:
            raise ReleaseError('tenant_registry_unavailable') from None
        return [self.checked_tenant(item) for item in items]

    def checked_tenant(self, item: dict) -> dict:
        """The registry names the filestore like the database; the backup package places it at <data>/filestore/<name>."""
        if not isinstance(item, dict) or not isinstance(item.get('tenantId'), str) or not item['tenantId']:
            raise ReleaseError('invalid_tenant_registry', EXIT_REFUSED, 'a registry entry has no tenantId')
        database, name = str(item.get('database', '')), str(item.get('filestore', ''))
        if not TENANT_DATABASE.fullmatch(database) or name != database:
            raise ReleaseError('invalid_tenant_registry', EXIT_REFUSED)
        filestore = Path(self.config['LIWAN_RELEASE_ODOO_DATA_DIR']).resolve() / 'filestore' / name
        return {'tenantId': item['tenantId'], 'database': database, 'filestore': str(filestore)}

    def capture(self, run: dict) -> None:
        """Encrypted disaster copy of every tenant and the control plane, through the existing pipeline."""
        if run['previous'] is None:
            return  # first deploy: no stack has run, so there is no data to copy
        self.assert_runtime_role(self.paths.current.resolve(), run)  # refused before anything but the worker stopped
        work = self.file(f'runs/{run["commit"]}/backup')
        common = ['--kind', 'hourly', '--work-root', str(work), '--pg-dump', self.config['LIWAN_RELEASE_PG_DUMP']]
        if self.config.get('LIWAN_RELEASE_BACKUP_STORE_ROOT'):
            common += ['--store-root', self.config['LIWAN_RELEASE_BACKUP_STORE_ROOT']]
        pipeline = ['python3', '-B', '-m', 'deploy.backup', 'capture']
        # The package is a module of this checkout, so the child imports it from ROOT wherever it is started.
        env = {**self.child_env, 'PYTHONPATH': str(ROOT)}
        try:
            for tenant in run['tenants']:
                self.run_command(pipeline + common + [
                    '--tenant', tenant['tenantId'], '--data-dir', self.config['LIWAN_RELEASE_ODOO_DATA_DIR'],
                    '--pg-host', self.config['LIWAN_RELEASE_PG_HOST'], '--pg-port', self.db_port(TENANT_DB_PORT),
                    '--pg-user', POSTGRES_ADMIN_ROLE], env=env)
            self.run_command(pipeline + common + [
                '--control-plane', '--db-name', CONTROL_DB, '--pg-host', self.config['LIWAN_RELEASE_CONTROL_PG_HOST'],
                '--pg-port', self.db_port(CONTROL_DB_PORT), '--pg-user', CONTROL_DB_USER],
                env=env)
        except CommandFailed:
            raise ReleaseError('backup_failed') from None

    def stack(self, checkout: Path, release_env: Path, missing: str = 'candidate_not_stack') -> StackBundle:
        """The stack of ``checkout`` for this environment, rendered by that checkout's own renderer into ``stack/<commit>/`` of the
        state directory (cleared first, so a refused or older render leaves nothing behind). A checkout without a renderer is
        ``missing`` (refused before anything stops); a renderer that cannot render the environment's values is
        ``invalid_shared_env``; a manifest of another contract is ``stack_contract_mismatch``."""
        if not (checkout / STACK_RENDERER).is_file():
            raise ReleaseError(missing, EXIT_REFUSED, f'{checkout.name} has no {STACK_RENDERER}; it predates the stack definition '
                               f'(deploy/release/README.md, "Pre-stack cutover")')
        directory = self.file(f'stack/{checkout.name}')
        shared_env = Path(self.config['LIWAN_SHARED_ENV_FILE'])
        # A render is a pure function of the checkout and the two env files, so unchanged inputs reuse the files on disk. The
        # directory is one per commit, so one entry per commit: new inputs render over it and replace the entry.
        inputs = (shared_env.read_bytes(), release_env.read_bytes() if release_env.exists() else None)
        cached = self.bundles.get(checkout.name)
        if cached is not None and cached[0] == inputs and (directory / STACK_MANIFEST).exists():
            return cached[1]
        self.bundles.pop(checkout.name, None)
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, mode=0o700)
        directory.chmod(0o700)
        command = ['python3', '-B', '-m', 'deploy.stack.render', 'bundle', '--env-file', self.config['LIWAN_SHARED_ENV_FILE']]
        if release_env.exists():
            command += ['--env-file', str(release_env)]
        code, output = self.run_command(command + ['--out', str(directory)], env={**self.child_env, 'PYTHONPATH': str(checkout)},
                                        cwd=checkout, check=False)
        if code != 0:
            for line in output.splitlines()[-FAILURE_TAIL_LINES:]:
                self.log('  ' + line)
            if code == 1:
                raise ReleaseError('invalid_shared_env', EXIT_REFUSED,
                                   f'{self.config["LIWAN_SHARED_ENV_FILE"]} cannot render the stack of {checkout.name} (see above)')
            raise ReleaseError('stack_render_failed', EXIT_REFUSED, f'the renderer of {checkout.name} exited {code}')
        bundle = self.read_bundle(checkout, directory)
        self.bundles[checkout.name] = (inputs, bundle)
        return bundle

    def read_bundle(self, checkout: Path, directory: Path) -> StackBundle:
        try:
            manifest = json.loads((directory / STACK_MANIFEST).read_text(encoding='utf-8'))
            contract = manifest.get('contract')
            names = [manifest['compose'], manifest['odooConf'], *manifest['envFiles']]
            project = manifest['projectDirectory']
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            raise ReleaseError('stack_contract_mismatch', EXIT_REFUSED, f'{checkout.name} wrote no readable {STACK_MANIFEST}') from None
        if contract != STACK_CONTRACT:
            raise ReleaseError('stack_contract_mismatch', EXIT_REFUSED,
                               f'{checkout.name} renders stack contract {contract!r}, this command reads {STACK_CONTRACT}')
        if not all(isinstance(name, str) and name and '/' not in name and name != '..' for name in names + [project.replace('/', '')]) \
                or Path(project).is_absolute() or '..' in Path(project).parts \
                or not all((directory / name).is_file() for name in names):
            raise ReleaseError('stack_contract_mismatch', EXIT_REFUSED, f'{checkout.name} wrote an invalid {STACK_MANIFEST}')
        return StackBundle(compose=directory / manifest['compose'], env_files=[directory / name for name in manifest['envFiles']],
                           odoo_conf=directory / manifest['odooConf'], project_directory=checkout / project)

    def compose(self, checkout: Path, release_env: Path | None = None) -> list[str]:
        """``docker compose`` on the stack ``checkout`` rendered, run from the project directory its manifest names so the
        stack's relative paths resolve. Later ``--env-file`` wins: the bundle's own, the shared env file, then the release env."""
        release_env = release_env or self.file('release.env')
        bundle = self.stack(checkout, release_env)
        command = ['docker', 'compose', '--project-directory', str(bundle.project_directory), '-p', self.config['LIWAN_RELEASE_PROJECT'],
                   '-f', str(bundle.compose)]
        for env_file in bundle.env_files:
            command += ['--env-file', str(env_file)]
        return command + ['--env-file', self.config['LIWAN_SHARED_ENV_FILE'], '--env-file', str(release_env)]

    def shared_env(self) -> dict[str, str]:
        return read_env_file(Path(self.config['LIWAN_SHARED_ENV_FILE']))

    def compose_env_value(self, key: str) -> str:
        """The value compose will substitute for ``key``: the process environment (``child_env``) over the later
        ``--env-file`` (release.env) over the shared env file; a key present but empty still wins."""
        release_env = self.file('release.env')
        for source in (self.child_env, read_env_file(release_env) if release_env.exists() else {}, self.shared_env()):
            if key in source:
                return source[key]
        return ''

    def db_port(self, setting: tuple[str, str]) -> str:
        key, default = setting
        return self.shared_env().get(key) or default

    def shared_compose_target(self) -> Path:
        """Where the worker's compose file goes, or a refusal: an absolute path in a writable directory, and a shared env
        file the worker can read (the file takes its owner and mode)."""
        env_path = Path(self.config['LIWAN_SHARED_ENV_FILE'])
        compose_file = self.shared_env().get('LIWAN_SHARED_COMPOSE_FILE')
        if not compose_file or not os.path.isabs(compose_file):
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED,
                               f'{env_path} needs LIWAN_SHARED_COMPOSE_FILE set to an absolute path')
        target = Path(compose_file)
        if not os.access(target.parent, os.W_OK | os.X_OK):
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED, f'{target.parent} does not exist or is not writable')
        if unreadable_by_worker(env_path.stat()):
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED,
                               f'{env_path} is root-owned and unreadable by group and others: the worker could not read '
                               'the compose file rendered from it')
        return target

    def require_host_file(self, key: str) -> None:
        """The compose files read or bind-mount the file this shared env key names (the vendor console's env file); Docker would create a directory at a missing bind path, or fail only after the stop. Only the path is named."""
        env_path = Path(self.config['LIWAN_SHARED_ENV_FILE'])
        path = self.shared_env().get(key)
        if not path or not os.path.isabs(path):
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED, f'{env_path} needs {key} set to an absolute path')
        if not Path(path).is_file():
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED, f'{path} ({key}) is not a file')

    def require_config_target(self, key: str) -> None:
        """The path this shared env key names is where the release writes the rendered Odoo config: absolute, in a writable
        directory, and a file if it exists (Docker would create a directory at a missing bind path). Only the path is named."""
        env_path = Path(self.config['LIWAN_SHARED_ENV_FILE'])
        path = self.shared_env().get(key)
        if not path or not os.path.isabs(path):
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED, f'{env_path} needs {key} set to an absolute path')
        if Path(path).exists() and not Path(path).is_file():
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED, f'{path} ({key}) is not a file')
        if not os.access(Path(path).parent, os.W_OK | os.X_OK):
            raise ReleaseError('invalid_shared_env', EXIT_REFUSED, f'{Path(path).parent} ({key}) does not exist or is not writable')

    def rendered_odoo_config(self, checkout: Path) -> str:
        """The Odoo config the candidate's own renderer wrote for this environment."""
        return self.stack(checkout, self.file('release.env')).odoo_conf.read_text(encoding='utf-8')

    @staticmethod
    def config_options(text: str) -> dict[str, str]:
        options = {}
        for line in text.splitlines():
            line = line.strip()
            if line and not line.startswith((';', '#', '[')) and '=' in line:
                name, _, value = line.partition('=')
                options[name.strip()] = value.strip()
        return options

    def config_drift(self, live_text: str, rendered_text: str) -> list[str]:
        """Names of the options the hand-written live config and the render disagree on. Values are compared in constant time
        (a secret included) and only the names are ever reported."""
        live, rendered = self.config_options(live_text), self.config_options(rendered_text)
        return sorted(name for name in live.keys() | rendered.keys()
                      if (name in live) != (name in rendered)
                      or not hmac.compare_digest(live[name].encode(), rendered[name].encode()))

    def prepare_odoo_config(self, checkout: Path, check_drift: bool = True) -> None:
        """Render the candidate's Odoo config beside the live file (``<file>.next``), validate it with the candidate's own
        validator as the container's launcher will run it, and refuse a hand-written live file that differs from it. Nothing
        running changes: ``activate`` renames it into place. The live file must exist (the operator creates it as root with the
        Odoo group, A4.7): a file this command made would not be readable by the container. The render takes the live file's
        owner, group and mode exactly. One this command rendered earlier is replaced freely; a hand-written one is adopted only
        when it says what the render says, option by option (names are logged, never values). A rollback skips that guard
        (``check_drift`` false): it replaces the failed release's config with the previous release's own render, and the
        validator still runs."""
        live = Path(self.shared_env()[ODOO_CONFIG_KEY])
        pending = live.with_name(live.name + '.next')
        if not live.exists():
            raise ReleaseError('odoo_config_missing', EXIT_REFUSED,
                               f'{live} ({ODOO_CONFIG_KEY}) does not exist; create it as the bring-up guide row A4.7 says '
                               f'(owner root, the Odoo group, mode 0440) before this release')
        text = self.rendered_odoo_config(checkout)
        owner = live.stat()
        if check_drift and RENDERED_MARKER not in live.read_text(encoding='utf-8'):
            drift = self.config_drift(live.read_text(encoding='utf-8'), text)
            if drift:
                raise ReleaseError('odoo_config_drift', EXIT_REFUSED,
                                   f'{live} ({ODOO_CONFIG_KEY}) was not rendered by this command and differs from the render of '
                                   f'{checkout.name} in: {", ".join(drift)}; move it aside so the release renders it, or make it match')
        pending.unlink(missing_ok=True)
        os.close(os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        pending.write_text(text, encoding='utf-8')
        pending.chmod(stat.S_IMODE(owner.st_mode))
        if (owner.st_uid, owner.st_gid) != (pending.stat().st_uid, pending.stat().st_gid):
            os.chown(pending, owner.st_uid, owner.st_gid)
        self.require_odoo_config(checkout, pending)

    def require_classification_dir(self) -> None:
        """Odoo bind-mounts ``<LIWAN_CONTROL_STATE_DIR>/classifications`` read-only without creating it (``create_host_path:
        false``), so a missing directory would stop ``compose up`` after the stop. An unset key is the compose render's refusal."""
        state = self.shared_env().get('LIWAN_CONTROL_STATE_DIR')
        if state and not (Path(state) / 'classifications').is_dir():
            raise ReleaseError('classification_dir_missing', EXIT_REFUSED,
                               f'{Path(state) / "classifications"} (LIWAN_CONTROL_STATE_DIR) is not a directory; '
                               f'create it before this release')

    def require_odoo_config(self, checkout: Path, pending: Path) -> None:
        """The rendered Odoo config, and the restore profile's external one when it is set, must pass the candidate's own
        validator: a config the new release rejects makes ``odoo`` exit and restart in a loop after the stop. Only the path is
        named, never content."""
        validator = str(checkout / 'deploy/shared/validate_odoo_config.py')
        # The restore profile is the external file `restore-odoo` mounts when LIWAN_RESTORE_ODOO_CONFIG is set (the validator
        # picks the profile from LIWAN_RESTORE_ROLE); unset, compose mounts the incomplete reference, which only `--profile restore` starts.
        restore = self.compose_env_value(RESTORE_ODOO_CONFIG_KEY)
        checks = [(ODOO_CONFIG_KEY, str(pending), self.child_env)]
        if restore:
            restore_path = str(Path(restore) if os.path.isabs(restore) else checkout / 'deploy' / restore)
            checks.append((RESTORE_ODOO_CONFIG_KEY, restore_path, {**self.child_env, 'LIWAN_RESTORE_ROLE': '1'}))
        for key, path, env in checks:
            try:
                self.run_command(['python3', '-B', validator, path], env=env)
            except CommandFailed:
                raise ReleaseError('odoo_config_invalid', EXIT_REFUSED,
                                   f'{path} ({key}) is rejected by deploy/shared/validate_odoo_config.py of '
                                   f'{checkout.name}; fix the file before this release') from None

    def adopt_odoo_config(self) -> None:
        """The rendered config replaces the live one (owner, group and mode were set when it was rendered); a second call, after
        a resume, finds nothing left to rename."""
        live = Path(self.shared_env()[ODOO_CONFIG_KEY])
        pending = live.with_name(live.name + '.next')
        if pending.exists():
            os.replace(pending, live)

    def install_odoo_config(self, checkout: Path, check_drift: bool = True) -> None:
        """Render, validate and put in place the Odoo config of ``checkout``: ``activate`` does it for the candidate through
        ``prepare`` and ``adopt``, a rollback does it again for the previous release, whose own renderer then decides what its
        Odoo runs with."""
        self.prepare_odoo_config(checkout, check_drift)
        self.adopt_odoo_config()

    def require_renderable(self, run: dict, checkout: Path) -> None:
        """Both compose projects of the candidate render as later steps run them, with its own image tag (a temporary env file,
        nothing activated). A required key the shared env file lacks is refused here, not after the stop. ``--quiet`` prints
        nothing, so no interpolated secret reaches the log; a failure logs the tail, which names the missing variable."""
        candidate = self.file('candidate.env')
        write_atomic(candidate, release_env_text(run['commit'], run['document']['release']['odooCommit']))
        try:
            for command in (self.compose(checkout, candidate) + ['--profile', '*'],
                            self.control_compose(checkout, candidate) + ['--profile', 'migrate']):
                try:
                    self.run_command(command + ['config', '--quiet'], env=self.child_env)
                except CommandFailed:
                    raise ReleaseError('invalid_shared_env', EXIT_REFUSED,
                                       f'{self.config["LIWAN_SHARED_ENV_FILE"]} does not satisfy the compose files of '
                                       f'{run["commit"]} (see the compose error above)') from None
        finally:
            candidate.unlink(missing_ok=True)

    def write_shared_compose(self, checkout: Path) -> None:
        """The file ``composeFile`` of shared-runtime.json names: the shared stack of ``checkout`` as one resolved compose file
        (every profile), which the host worker and its effects run ``docker compose --file`` on. It holds the interpolated
        secrets of the shared env file, so it takes that file's owner, group and mode."""
        target = self.shared_compose_target()
        owner = Path(self.config['LIWAN_SHARED_ENV_FILE']).stat()
        temporary = target.with_name(target.name + '.tmp')
        os.close(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600))
        try:
            try:
                self.run_command(self.compose(checkout) + ['--profile', '*', 'config', '--format', 'json',
                                                           '--output', str(temporary)], env=self.child_env)
            except CommandFailed:
                raise ReleaseError('shared_compose_render_failed') from None
            os.chown(temporary, owner.st_uid, owner.st_gid)
            temporary.chmod(stat.S_IMODE(owner.st_mode))
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def control_compose(self, checkout: Path, release_env: Path | None = None) -> list[str]:
        return ['docker', 'compose', '-p', CONTROL_PROJECT,
                '-f', str(checkout / 'deploy/control-plane/compose.production.yml'),
                '-f', str(checkout / 'deploy/control-plane/compose.host-link.yml'),
                '--env-file', self.config['LIWAN_SHARED_ENV_FILE'],
                '--env-file', str(release_env or self.file('release.env'))]

    def stop_services(self, checkout: Path) -> None:
        self.run_command(self.compose(checkout) + ['stop', EDGE_SERVICE, *APP_SERVICES], env=self.child_env)
        self.run_command(self.control_compose(checkout) + ['stop', *CONTROL_SERVICES], env=self.child_env)

    def stop_worker(self) -> None:
        self.run_command(['systemctl', 'stop', SHARED_WORKER_UNIT])

    def start_worker(self) -> None:
        """The worker can charge a saved card on its first tick, so it runs only on a committed release."""
        self.run_command(['systemctl', 'start', SHARED_WORKER_UNIT])
        time.sleep(WORKER_SETTLE_SECONDS)
        code, _ = self.run_command(['systemctl', 'is-active', '--quiet', SHARED_WORKER_UNIT], check=False)
        if code != 0:
            raise ReleaseError('worker_not_ready')

    def stop(self, run: dict) -> None:
        """Maintenance: the edge (Caddy) and the databases stay up; Caddy answers 503 while the guard is down."""
        if run['previous'] is not None:
            self.stop_services(self.paths.current.resolve())

    def psql_command(self, checkout: Path, *, control: bool = False, database: str = 'postgres') -> list[str]:
        if control:
            base = self.control_compose(checkout) + ['exec', '-T', 'control-db', 'psql', '-U', CONTROL_DB_USER]
        else:
            base = self.compose(checkout) + ['exec', '-T', 'db', 'psql', '-U', POSTGRES_ADMIN_ROLE]
        return base + ['-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-']

    def psql(self, checkout: Path, sql: str, *, control: bool = False) -> str:
        """Tooling SQL runs as the admin role (the runtime role is no superuser), always in database ``postgres``: the release
        never opens a session inside a tenant database, where tenant-controlled code could run with admin rights."""
        return self.run_command(self.psql_command(checkout, control=control), stdin=sql, env=self.child_env)[1].strip()

    def assert_runtime_role(self, checkout: Path, run: dict) -> None:
        """Odoo's database role must be a plain login role that owns no tenant database; an old volume that still has
        a privileged ``odoo`` (or no admin role at all) is refused here instead of running on, as is a DB_ADMIN_PASSWORD
        that the volume's admin role rejects. Only a failure whose output names the role problem is a refusal about the
        volume (recorded once per candidate); any other failure (a db container that is restarting, a timeout) is an
        ordinary failure that the next run retries."""
        names = [tenant['database'] for tenant in run['tenants']]
        sql = runtime_role_assertion_sql(ODOO_RUNTIME_ROLE, names) + ';\n'
        code, output = self.run_command(self.psql_command(checkout), stdin=sql, env=self.child_env, check=False)
        if code == 0:
            return
        if runtime_role_failure_output(output):
            raise ReleaseError('runtime_role_rejected', EXIT_REFUSED)
        for line in output.splitlines()[-FAILURE_TAIL_LINES:]:
            self.log('  ' + line)
        raise ReleaseError('runtime_role_check_failed')

    def databases(self, run: dict) -> list[dict]:
        tenants = [{'database': t['database'], 'filestore': t['filestore'], 'control': False} for t in run['tenants']]
        return tenants + [{'database': CONTROL_DB, 'filestore': None, 'control': True}]

    def acl(self, checkout: Path, database: str, control: bool) -> dict:
        """Owner, then one ``aclexplode`` row per grant (PUBLIC as ''), NULL read as PostgreSQL's default."""
        name = databases.literal(database)
        rows = self.psql(checkout, f'SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = {name};\n'
                         "SELECT CASE WHEN a.grantee = 0 THEN '' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type, "
                         'a.is_grantable FROM pg_database d, '
                         "LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a "
                         f'WHERE d.datname = {name} ORDER BY 1, 2, 3;\n', control=control).splitlines()
        grants = [[grantee, privilege, grantable == 't']
                  for grantee, privilege, grantable in (row.split('|') for row in rows[1:])]
        return {'owner': rows[0], 'grants': grants}

    def snapshot(self, run: dict) -> None:
        """Copy every database (FILE_COPY template) and hard-link every filestore before anything is upgraded."""
        if run['previous'] is None:
            return  # first deploy: nothing to roll back to
        checkout = self.paths.current.resolve()
        run.setdefault('access', {})
        run.setdefault('snapshots', {})
        for item in self.databases(run):
            database = item['database']
            if run['snapshots'].get(database):
                continue
            run['access'][database] = self.acl(checkout, database, item['control'])
            write_json(self.file('run.json'), run)
            self.psql(checkout, databases.snapshot_sql(database), control=item['control'])
            if item['filestore']:
                copy = Path(item['filestore'] + '.pre')
                if copy.exists():
                    shutil.rmtree(copy)
                self.run_command(['cp', '-al', item['filestore'], str(copy)])
            run['snapshots'][database] = True
            write_json(self.file('run.json'), run)

    def activate(self, commit: str, odoo_commit: str) -> None:
        self.adopt_odoo_config()
        write_atomic(self.file('release.env'), release_env_text(commit, odoo_commit))
        self.write_shared_compose(self.checkout(commit))
        self.point_current(self.checkout(commit))

    def point_current(self, target: Path) -> None:
        link = self.paths.current.with_name(self.paths.current.name + '.next')
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(target)
        os.replace(link, self.paths.current)

    def upgrade(self, run: dict) -> None:
        """Release env and checkout first, then every tenant with the CI-proven flags, then the control plane."""
        self.activate(run['commit'], run['document']['release']['odooCommit'])
        checkout = self.checkout(run['commit'])
        modules = ','.join(run['document']['release']['upgradeModules'])
        for tenant in run['tenants']:
            self.upgrade_tenant(run, checkout, tenant['database'], modules)
        try:
            self.run_command(self.control_compose(checkout) + ['--profile', 'migrate', 'run', '--rm', '--pull',
                                                               'never', '-T', 'control-migrate'], env=self.child_env)
        except CommandFailed:
            raise ReleaseError('control_migrate_failed') from None
        self.initialize_ai_control(checkout)

    def initialize_ai_control(self, checkout: Path) -> None:
        """The ai service validates its control tables when it starts and refuses to start without them; the per-tenant
        provisioning creates them too late for the first start. Idempotent. Without ``AI_DATABASE_URL`` the service keeps its
        state in memory and has nothing to create. No ``--no-deps``: on a first deploy the database is not running yet."""
        if not self.compose_env_value(AI_DATABASE_URL_KEY):
            return
        try:
            self.run_command(self.compose(checkout) + ['run', '--rm', '--pull', 'never', '-T', 'ai', 'python', '-m',
                                                       'liwan_ai_service.store', '--initialize-control'],
                             env=self.child_env)
        except CommandFailed:
            raise ReleaseError('ai_control_initialization_failed') from None

    def odoo_run(self, checkout: Path, database: str, args: list[str], stdin: str | None = None) -> str:
        command = self.compose(checkout) + [
            'run', '--rm', '--no-deps', '--pull', 'never', '-T', '-e', f'LIWAN_COMMERCIAL_CONFIG={CLASSIFICATION_DIR}/{database}.json',
            '--entrypoint', '/usr/local/bin/liwan-odoo', 'odoo', *args]
        return self.run_command(command, stdin=stdin, env=self.child_env)[1]

    def upgrade_tenant(self, run: dict, checkout: Path, database: str, modules: str) -> None:
        log = self.file(f'runs/{run["commit"]}/upgrade-{database}.log')
        try:
            output = self.odoo_run(checkout, database, ['-c', '/etc/odoo/odoo.conf', '-d', database, '-u', modules,
                                                        '-i', modules, '--stop-after-init', '--no-http'])
        except CommandFailed:
            raise ReleaseError('upgrade_failed') from None
        write_atomic(log, output)
        code, _ = self.run_command(['python3', '-B', str(checkout / 'tools/upgrade_log_guard.py'), str(log)],
                                   check=False)
        if code != 0:
            raise ReleaseError('upgrade_log_rejected')
        smoke = (checkout / 'deploy/odoo/upgrade_smoke.py').read_text(encoding='utf-8')
        try:
            output = self.odoo_run(checkout, database, ['shell', '-c', '/etc/odoo/odoo.conf', '-d', database,
                                                        '--no-http'], stdin=smoke)
        except CommandFailed:
            raise ReleaseError('upgrade_smoke_failed') from None
        if SMOKE_MARKER not in output:
            raise ReleaseError('upgrade_smoke_failed')

    def start_services(self, checkout: Path, with_edge: bool) -> None:
        """The control API and the vendor console first (their project creates the networks the shared stack joins as external),
        then the proxy (80/443) and the applications, healthy; the guard too when ``with_edge``. Never the worker."""
        services = [PROXY_SERVICE, *APP_SERVICES] + ([EDGE_SERVICE] if with_edge else [])
        self.run_command(self.control_compose(checkout) + [*UP, *CONTROL_SERVICES], env=self.child_env)
        self.run_command(self.compose(checkout) + [*UP, *services], env=self.child_env)

    def start(self, run: dict) -> None:
        checkout = self.checkout(run['commit'])
        try:
            self.run_command(self.compose(checkout) + [*UP, 'db'], env=self.child_env)
        except CommandFailed:
            raise ReleaseError('health_check_failed') from None
        self.assert_runtime_role(checkout, run)  # before any application connects
        try:
            self.start_services(checkout, with_edge=False)
        except CommandFailed:
            raise ReleaseError('health_check_failed') from None

    def open(self, run: dict) -> None:
        """Starting the guard healthy is the commit point: customers reach the new release."""
        try:
            self.run_command(self.compose(self.checkout(run['commit'])) + [*UP, EDGE_SERVICE], env=self.child_env)
        except CommandFailed:
            raise ReleaseError('health_check_failed') from None

    def reopen(self, run: dict) -> None:
        """The phase is written before the marker goes, so a crash here never rolls back customers' new writes."""
        self.leave_maintenance()

    def commit(self, run: dict) -> None:
        write_json(self.file('served.json'), {'commit': run['commit'], 'ref': run['ref'], 'version': run['version'],
                                              'odooCommit': run['document']['release']['odooCommit'], 'at': now()})
        self.start_worker()

    def cleanup(self, run: dict) -> None:
        """Drop the snapshots, then prune everything older than the previous release; the run is over."""
        self.drop_snapshots(run, self.checkout(run['commit']))
        self.file('run.json').unlink()
        self.prune(run)

    def drop_snapshots(self, run: dict, checkout: Path) -> None:
        for item in self.databases(run):
            if not run.get('snapshots', {}).get(item['database']):
                continue
            self.psql(checkout, databases.reopen_sql(item['database']), control=item['control'])
            self.psql(checkout, f'DROP DATABASE IF EXISTS {identifier(databases.snapshot_name(item["database"]))} '
                      'WITH (FORCE);\n', control=item['control'])
            copy = Path(item['filestore'] + '.pre') if item['filestore'] else None
            if copy is not None and copy.exists():
                shutil.rmtree(copy)

    def prune(self, run: dict) -> None:
        """Keep the served release and the previous one; remove the images and release folders of every older one."""
        keep = {run['commit']} | ({run['previous']['commit']} if run['previous'] else set())
        for record in sorted(self.file('releases').glob('*.json')):
            if record.stem in keep:
                continue
            images = (read_json(record) or {}).get('images', [])
            if images:
                self.run_command(['docker', 'image', 'rm', *images], env=self.child_env, check=False)
            record.unlink()
        for runs in sorted(self.file('runs').glob('*')):
            if runs.name not in keep:
                shutil.rmtree(runs, ignore_errors=True)
        for bundle in sorted(self.file('stack').glob('*')):  # each holds a rendered odoo.conf with the database password
            if bundle.name not in keep:
                shutil.rmtree(bundle, ignore_errors=True)
        for folder in sorted(self.paths.releases.glob('*')):
            match = RELEASE_FOLDER.match(folder.name)
            if match and match.group(1) not in keep:
                shutil.rmtree(folder) if folder.is_dir() else folder.unlink()

    # --- rollback --------------------------------------------------------------------------------------
    def roll_back(self, run: dict, reason: str) -> int:
        failed_phase = run.get('failedPhase', run['phase'])
        run.update(failure=reason, failedPhase=failed_phase)
        self.set_phase(run, 'rolling_back')
        self.enter_maintenance()
        try:
            if run['previous'] is None:
                self.stop_bootstrap(run)
                self.halt(run, failed_phase, reason, 'deploy_failed')
                self.file('run.json').unlink()
                return self.finish(EXIT_FAILED, f'halted {reason}')
            self.restore(run)
        except (ReleaseError, CommandFailed, OSError, ValueError) as error:
            code = error.reason if isinstance(error, ReleaseError) else 'rollback_command_failed'
            self.halt(run, failed_phase, code, 'deploy_rollback_failed')
            return self.finish(EXIT_ROLLBACK_FAILED, f'halted {code}')
        self.alert('deploy_failed', run['commit'], failed_phase, reason)
        self.file('run.json').unlink()
        self.record_failure(run['commit'], reason)
        return self.finish(EXIT_FAILED, f'rolled back {reason}')

    def cancel_pending(self, run: dict) -> int:
        """Before the stop nothing was snapshotted and no tenant inventory is certain (``run['tenants']`` may not exist),
        so there is no data to restore: the served stack stays as it is, only a worker stopped for the inventory restarts."""
        if run['phase'] != 'verified' and run['previous'] is not None and self.restart_worker('') != '':
            return self.finish(EXIT_FAILED, f'worker_not_ready: {run["commit"]} stays pending, run "rollback" again')
        self.file('run.json').unlink()
        return self.finish(EXIT_OK, f'cancelled {run["commit"]} before anything was stopped or snapshotted')

    def stop_bootstrap(self, run: dict) -> None:
        """First deploy: nothing older exists, so the failed stack is stopped and left in maintenance."""
        if self.file('release.env').exists():
            checkout = self.checkout(run['commit'])
            self.run_command(self.compose(checkout) + ['stop', EDGE_SERVICE, PROXY_SERVICE, *APP_SERVICES],
                             env=self.child_env)
            self.run_command(self.control_compose(checkout) + ['stop', *CONTROL_SERVICES], env=self.child_env)

    def restore(self, run: dict) -> None:
        """Swap every snapshot back, restore owner, grants and isolation, restart the previous release, then give the worker its
        file and start it."""
        previous = run['previous']
        checkout = self.checkout(previous['commit'])
        self.stop_worker()  # a reboot during a resumed rollback starts the enabled unit again
        self.stop_services(self.paths.current.resolve())
        for item in self.databases(run):
            self.swap_back(run, checkout, item)
        write_atomic(self.file('release.env'), run['previousReleaseEnv']
                     or release_env_text(previous['commit'], previous['odooCommit']))
        self.point_current(checkout)
        self.install_odoo_config(checkout, check_drift=False)
        self.start_services(checkout, with_edge=True)
        self.leave_maintenance()  # the previous release serves from here on, whatever the worker's file does
        self.shared_compose_target().unlink(missing_ok=True)  # still the failed release's render: a failed render below must leave no file
        self.write_shared_compose(checkout)  # only the worker needs it, so a failed render never keeps the stack down
        self.start_worker()

    def swap_back(self, run: dict, checkout: Path, item: dict) -> None:
        database, snap = item['database'], databases.snapshot_name(item['database'])
        live = self.exists(checkout, database, item['control'])
        if database in run.get('access', {}) and live:
            self.psql(checkout, databases.reopen_sql(database), control=item['control'])  # a failed snapshot left it closed
        if not run.get('snapshots', {}).get(database):
            return  # never snapshotted in this run, so never upgraded: an older liwan_pre_* is not ours to swap in
        recorded = run['access'][database]
        if self.exists(checkout, snap, item['control']):
            self.psql(checkout, databases.swap_sql(database, live), control=item['control'])
        owner = recorded['owner']
        statements = [f'ALTER DATABASE {identifier(database)} ALLOW_CONNECTIONS true',
                      f'ALTER DATABASE {identifier(database)} OWNER TO {identifier(owner)}']
        if not item['control']:
            statements += list(tenant_isolation_statements(database, ODOO_RUNTIME_ROLE))
        statements += databases.grant_statements(database, recorded['grants'], owner)  # last: the recorded ACL wins
        self.psql(checkout, ''.join(statement + ';\n' for statement in statements), control=item['control'])
        if self.acl(checkout, database, item['control']) != recorded:
            raise ReleaseError('acl_mismatch')
        if item['filestore']:
            databases.restore_filestore(Path(item['filestore']))

    def exists(self, checkout: Path, database: str, control: bool) -> bool:
        return self.psql(checkout, f'SELECT count(*) FROM pg_database WHERE datname = {databases.literal(database)};\n',
                         control=control) == '1'

    # --- status and rollback commands ------------------------------------------------------------------
    def status(self) -> int:
        report = {name: read_json(self.file(f'{name}.json')) for name in ('served', 'run', 'halted')}
        if report['run']:
            report['run'] = {key: report['run'][key] for key in ('commit', 'ref', 'phase', 'updatedAt')}
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
        return EXIT_HALTED if report['halted'] else EXIT_OK

    def rollback(self) -> int:
        """Operator command: clear the halt and failed-candidate records and finish the rollback of the unfinished run, if there is one."""
        self.require_current_symlink()
        run = read_json(self.file('run.json'))
        if run is not None and run['phase'] in POST_OPEN_PHASES:
            return self.finish(EXIT_REFUSED, f'refused {run["phase"]}_cannot_roll_back')
        self.file('halted.json').unlink(missing_ok=True)
        self.file('failed.json').unlink(missing_ok=True)
        if run is None:
            return self.finish(EXIT_OK, 'nothing to do: the halt record is cleared and no run is unfinished')
        if run['phase'] in PRE_SNAPSHOT_PHASES:
            return self.cancel_pending(run)
        return self.roll_back(run, run.get('failure', 'operator_rollback'))


def parse_args(argv):
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('command', choices=('run', 'status', 'rollback'))
    parser.add_argument('--environment', required=True)
    parser.add_argument('--tag', action='append', help='production only: the release/19.0.X.Y.Z tag to apply (once)')
    return parser.parse_args(argv)


def main(argv=None, paths: Paths | None = None, runner=None, log=None, environ: dict | None = None,
         machine: str | None = None) -> int:
    args = parse_args(argv)
    paths = paths or Paths()
    environ = dict(os.environ) if environ is None else environ
    log = log or make_log([environ.get(name, '') for name in (USER_VAR, TOKEN_VAR, GITHUB_TOKEN_VAR)])
    try:
        tags = args.tag or []
        if len(tags) > 1:
            raise ReleaseError('tag_repeated', EXIT_REFUSED, '--tag may be given once')
        tag = tags[0] if tags else None
        if tag is not None and args.command != 'run':
            raise ReleaseError('tag_not_allowed', EXIT_REFUSED, '--tag belongs to the run command only')
        config = load_config(paths, args.environment)
        log.secrets.extend(sensitive_values(config, read_env_file(Path(config['LIWAN_SHARED_ENV_FILE']))))
        releaser = Releaser(args.environment, config, paths, runner or Runner(log), log, environ,
                            machine or platform.machine(), tag=tag)
        if args.command == 'status':
            return releaser.status()  # read-only: it must answer while a run holds the lock
        with Lock(releaser.file('lock')) as held:
            if not held:
                log('another run holds the lock')
                return releaser.finish(EXIT_OK, 'nothing to do: another run holds the lock')
            return getattr(releaser, args.command)()
    except ReleaseError as error:
        if error.detail:
            log(error.detail)
        kind = 'nothing to do' if error.exit_code == EXIT_OK else 'refused' if error.exit_code == EXIT_REFUSED else 'failed'
        log(f'RESULT: {kind} {error.reason}')
        return error.exit_code
    except Exception as error:  # last resort: state stays resumable, the job still gets a RESULT line
        log(f'RESULT: failed unexpected_error {type(error).__name__}')
        return EXIT_FAILED


if __name__ == '__main__':
    raise SystemExit(main())
