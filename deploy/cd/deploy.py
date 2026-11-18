#!/usr/bin/env python3
"""Host deploy script: apply the newest signed release document of one environment's channel.

  deploy.py run    --environment <name>   verify, pull, back up, stop, snapshot, upgrade, start, open, commit
  deploy.py status --environment <name>   print the served release, the unfinished run and the halt record
  deploy.py clear  --environment <name>   remove the halt record after an operator has looked

The environment name selects the root-only config ``/etc/liwan-deploy/<name>.env`` (mode 0600, owned by the
running user). Its ``LIWAN_DEPLOY_CHANNEL`` is ``main`` (newest signed document of the main branch head) or
``release`` (newest signed document of the highest ``release/19.0.X.Y.Z`` tag); nothing else differs between
environments. Every phase is written to ``run.json`` before it acts, so a killed run resumes from real state:
forward up to ``snapshotted``, rollback from ``upgrading`` and ``starting``, forward again from ``opening``.
Rollback swaps the pre-upgrade database snapshots and filestore copies back and restarts the previous release.
Arguments never carry a secret: databases are reached through ``docker compose exec -T`` on the socket and
secrets stay in the env files, which are passed to children as files or environment only.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from deploy.releases.postgres import identifier, tenant_isolation_statements  # noqa: E402 - path set just above

CHANNELS = ('main', 'release')
OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
ATTESTATION_BASE = 'https://liwanos.com/attestations/release-manifest'
RELEASE_TAG = re.compile(r'^release/19\.0\.(\d+)\.(\d+)\.(\d+)$')
TENANT_DATABASE = re.compile(r'^[a-z][a-z0-9_]{0,62}$')
COMMIT = re.compile(r'^[0-9a-f]{40}$')
DB_SUPERUSER = 'odoo'
CONTROL_DB = 'liwan_control'
CONTROL_DB_USER = 'liwan_control'
CONTROL_PROJECT = 'liwan-control'
SHARED_WORKER_UNIT = 'liwan-shared-worker.service'
APP_SERVICES = ('odoo', 'web', 'ai')
EDGE_SERVICE = 'guard'
CONTROL_SERVICE = 'control-api'
MAINTENANCE_MARKER = Path('/var/lib/liwan-deploy/maintenance/active')
MAINTENANCE_PHASES = ('stopping', 'snapshotted', 'upgrading', 'starting', 'opening')
CLASSIFICATION_DIR = '/run/liwan-runtime/classifications'
SMOKE_MARKER = 'UPGRADE_SMOKE_OK'
FORWARD_PHASES = ('verified', 'captured', 'stopping', 'snapshotted')
ROLLBACK_PHASES = ('upgrading', 'starting', 'rolling_back')
EXIT_OK, EXIT_REFUSED, EXIT_HALTED, EXIT_FAILED, EXIT_ROLLBACK_FAILED = 0, 2, 3, 4, 5
CONFIG_KEYS = ('LIWAN_DEPLOY_CHANNEL', 'LIWAN_DEPLOY_REPOSITORY', 'LIWAN_DEPLOY_MIRROR', 'LIWAN_DEPLOY_PROJECT',
               'LIWAN_SHARED_ENV_FILE', 'LIWAN_DEPLOY_PG_DUMP', 'LIWAN_DEPLOY_PG_HOST', 'LIWAN_DEPLOY_PG_PORT',
               'LIWAN_DEPLOY_CONTROL_PG_HOST', 'LIWAN_DEPLOY_CONTROL_PG_PORT', 'LIWAN_DEPLOY_DATA_ROOT')


class DeployError(Exception):
    """A failure with a closed reason code (``^[a-z][a-z0-9_]{0,63}$``) that alerts may carry."""

    def __init__(self, reason: str, exit_code: int = EXIT_FAILED):
        super().__init__(reason)
        self.reason = reason
        self.exit_code = exit_code


class CommandFailed(Exception):
    def __init__(self, argv: list[str], returncode: int):
        super().__init__(f'{argv[0]} exited {returncode}')
        self.returncode = returncode


@dataclass(frozen=True)
class Paths:
    config_root: Path = Path('/etc/liwan-deploy')
    state_root: Path = Path('/var/lib/liwan-deploy')
    releases: Path = Path('/opt/liwan/releases')
    current: Path = Path('/opt/liwan/current')
    maintenance: Path = MAINTENANCE_MARKER


class Runner:
    """Runs one command, logs its argv (never its environment or stdin), returns combined output."""

    def __init__(self, log):
        self.log = log

    def __call__(self, argv: list[str], *, stdin: str | None = None, env: dict | None = None,
                 check: bool = True) -> tuple[int, str]:
        self.log('$ ' + ' '.join(argv))
        done = subprocess.run(argv, input=stdin, env=env, text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, check=False)
        if check and done.returncode != 0:
            raise CommandFailed(argv, done.returncode)
        return done.returncode, done.stdout


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def read_env_file(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with open(temporary, 'w', encoding='utf-8') as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def write_json(path: Path, value: dict) -> None:
    write_atomic(path, json.dumps(value, indent=2, sort_keys=True) + '\n')


def read_json(path: Path) -> dict | None:
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def load_config(paths: Paths, environment: str) -> dict[str, str]:
    """The root-only config of one environment; a readable-by-others or foreign-owned file is refused."""
    if not re.fullmatch(r'[a-z][a-z0-9-]{0,31}', environment):
        raise DeployError('invalid_environment', EXIT_REFUSED)
    path = paths.config_root / f'{environment}.env'
    if not path.is_file():
        raise DeployError('missing_config', EXIT_REFUSED)
    info = path.stat()
    if info.st_mode & 0o077 or info.st_uid != os.geteuid():
        raise DeployError('config_not_private', EXIT_REFUSED)
    config = read_env_file(path)
    missing = [key for key in CONFIG_KEYS if not config.get(key)]
    if missing or config['LIWAN_DEPLOY_CHANNEL'] not in CHANNELS:
        raise DeployError('invalid_config', EXIT_REFUSED)
    return config


def release_version(tag: str) -> tuple[int, int, int] | None:
    match = RELEASE_TAG.match(tag)
    if match is None:
        return None
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def tag_order(tag: str) -> tuple[int, int, int]:
    return release_version(tag) or (-1, -1, -1)


def snapshot_name(database: str) -> str:
    return 'liwan_pre_' + hashlib.sha256(database.encode()).hexdigest()[:16]


def release_env_text(commit: str, odoo_commit: str) -> str:
    return f'LIWAN_IMAGE_TAG={commit}\nODOO_COMMIT={odoo_commit}\n'


class Deployer:
    def __init__(self, environment: str, config: dict[str, str], paths: Paths, runner, log):
        self.environment = environment
        self.config = config
        self.paths = paths
        self.run_command = runner
        self.log = log
        self.state = paths.state_root / environment
        self.child_env = {**os.environ, **config}
        self.registry = f'ghcr.io/{config["LIWAN_DEPLOY_REPOSITORY"].split("/")[0]}'

    # --- state files ---------------------------------------------------------------------------------
    def file(self, name: str) -> Path:
        return self.state / name

    def set_phase(self, run: dict, phase: str) -> None:
        run['phase'] = phase
        run['updatedAt'] = now()
        write_json(self.file('run.json'), run)
        self.log(f'phase {phase} ({run["commit"]})')

    # --- candidate -----------------------------------------------------------------------------------
    def git(self, *args: str) -> str:
        return self.run_command(['git', '--git-dir', self.config['LIWAN_DEPLOY_MIRROR'], *args])[1].strip()

    def candidate(self) -> dict:
        """Main head on the main channel; the highest release tag on the release channel. Never an older one."""
        self.git('fetch', '--prune', 'origin', '+refs/heads/main:refs/heads/main',
                 '+refs/tags/release/*:refs/tags/release/*')
        if self.config['LIWAN_DEPLOY_CHANNEL'] == 'main':
            return {'commit': self.git('rev-parse', 'refs/heads/main^{commit}'), 'ref': 'refs/heads/main',
                    'version': None, 'attestation': 'staging'}
        tags = [tag for tag in self.git('for-each-ref', '--format=%(refname:strip=2)', 'refs/tags/release/').split()
                if release_version(tag)]
        if not tags:
            raise DeployError('no_release_tag', EXIT_OK)
        tag = max(tags, key=tag_order)
        return {'commit': self.git('rev-parse', f'refs/tags/{tag}^{{commit}}'), 'ref': f'refs/tags/{tag}',
                'version': list(tag_order(tag)), 'attestation': 'production'}

    def refuse_older(self, candidate: dict, served: dict | None) -> None:
        if served is None:
            return
        code, _ = self.run_command(['git', '--git-dir', self.config['LIWAN_DEPLOY_MIRROR'], 'merge-base',
                                    '--is-ancestor', served['commit'], candidate['commit']], check=False)
        if code != 0:
            raise DeployError('older_candidate', EXIT_REFUSED)
        if candidate['version'] is not None and (served.get('version') is None
                                                 or tuple(candidate['version']) <= tuple(served['version'])):
            raise DeployError('older_candidate', EXIT_REFUSED)

    def verified_document(self, candidate: dict) -> dict:
        """The release document signed by the publish workflow for exactly this commit and ref."""
        commit = candidate['commit']
        anchor = f'{self.registry}/liwan-release:{commit}'
        code, _ = self.run_command(['docker', 'manifest', 'inspect', anchor], env=self.child_env, check=False)
        if code != 0:
            raise DeployError('document_not_published', EXIT_OK)
        kind = f'{ATTESTATION_BASE}/{candidate["attestation"]}/v1'
        identity = (f'https://github.com/{self.config["LIWAN_DEPLOY_REPOSITORY"]}'
                    f'/.github/workflows/publish.yml@{candidate["ref"]}')
        try:
            _, output = self.run_command(['cosign', 'verify-attestation', '--type', kind, '--certificate-oidc-issuer',
                                          OIDC_ISSUER, '--certificate-identity', identity,
                                          '--certificate-github-workflow-sha', commit, anchor], env=self.child_env)
        except CommandFailed:
            raise DeployError('bad_signature', EXIT_REFUSED) from None
        return self.document_from(output, kind, commit)

    def document_from(self, output: str, kind: str, commit: str) -> dict:
        for line in output.splitlines():
            if not line.startswith('{'):
                continue
            statement = json.loads(base64.b64decode(json.loads(line)['payload']))
            predicate = statement.get('predicate') or {}
            if statement.get('predicateType') == kind and predicate.get('commit') == commit:
                self.check_document(predicate, commit)
                return predicate
        raise DeployError('document_mismatch', EXIT_REFUSED)

    def check_document(self, document: dict, commit: str) -> None:
        release = document.get('release') or {}
        images = document.get('images') or {}
        valid_images = images and all(self.pinned_image(reference).fullmatch(image)
                                      for reference, image in images.items())
        if release.get('liwanCommit') != commit or not valid_images or not release.get('upgradeModules'):
            raise DeployError('document_mismatch', EXIT_REFUSED)

    def pinned_image(self, reference: str) -> re.Pattern:
        """Exactly ``<configured registry>/<reference>@sha256:<64 hex>``; any other owner or form is refused."""
        return re.compile(re.escape(f'{self.registry}/{reference}') + r'@sha256:[0-9a-f]{64}')

    # --- maintenance marker (Caddy shows the maintenance page only while it exists) ---------------------
    def enter_maintenance(self) -> None:
        marker = self.paths.maintenance
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.parent.chmod(0o755)
        marker.touch()
        marker.chmod(0o644)

    def leave_maintenance(self) -> None:
        self.paths.maintenance.unlink(missing_ok=True)

    # --- run -----------------------------------------------------------------------------------------
    def run(self) -> int:
        if self.file('halted.json').exists():
            self.log('halted: run "deploy.py clear" after an operator has looked')
            return EXIT_HALTED
        unfinished = read_json(self.file('run.json'))
        if unfinished is not None:
            return self.resume(unfinished)
        served = read_json(self.file('served.json'))
        candidate = self.candidate()
        if not COMMIT.match(candidate['commit']):
            raise DeployError('invalid_commit', EXIT_REFUSED)
        if served is not None and served['commit'] == candidate['commit']:
            self.log(f'no change: serving {served["commit"]}')
            return EXIT_OK
        self.refuse_older(candidate, served)
        document = self.verified_document(candidate)
        run = {**candidate, 'document': document, 'previous': served,
               'previousReleaseEnv': self.current_release_env(), 'startedAt': now()}
        self.set_phase(run, 'verified')
        return self.forward(run)

    def current_release_env(self) -> str | None:
        path = self.file('release.env')
        return path.read_text(encoding='utf-8') if path.exists() else None

    def resume(self, run: dict) -> int:
        self.log(f'resuming {run["commit"]} at {run["phase"]}')
        if run['phase'] in ROLLBACK_PHASES:
            return self.rollback(run, run.get('failure', 'interrupted'))
        return self.forward(run)

    def forward(self, run: dict) -> int:
        steps = (('verified', self.prepare), ('captured', self.capture), ('stopping', self.stop),
                 ('snapshotted', self.snapshot), ('upgrading', self.upgrade), ('starting', self.start),
                 ('opening', self.open), ('committed', self.commit), ('cleanup', self.cleanup))
        names = [name for name, _ in steps]
        for name, step in steps[names.index(run['phase']):]:
            if run['phase'] != name:
                self.set_phase(run, name)
            if name in MAINTENANCE_PHASES:
                self.enter_maintenance()
            try:
                step(run)
            except (DeployError, CommandFailed, OSError, ValueError) as error:
                reason = error.reason if isinstance(error, DeployError) else f'{name}_failed'
                return self.fail(run, name, reason)
        self.log(f'applied {run["commit"]}')
        return EXIT_OK

    def fail(self, run: dict, phase: str, reason: str) -> int:
        if phase in FORWARD_PHASES[:2]:
            self.halt(run, phase, reason, 'deploy_failed')
            self.file('run.json').unlink()
            return EXIT_FAILED
        if phase in ('committed', 'cleanup'):
            self.halt(run, phase, reason, 'deploy_failed')
            return EXIT_FAILED
        return self.rollback(run, reason)

    def halt(self, run: dict, phase: str, reason: str, event: str) -> None:
        write_json(self.file('halted.json'), {'commit': run['commit'], 'phase': phase, 'reason': reason,
                                              'event': event, 'at': now()})
        self.alert(event, run['commit'], phase, reason)

    def alert(self, event: str, commit: str, phase: str, reason: str) -> None:
        code, _ = self.run_command(['python3', '-B', str(ROOT / 'deploy/alerts.py'), event, '--environment',
                                    self.environment, '--release', commit, '--phase', phase, '--reason', reason],
                                   env=self.child_env, check=False)
        if code != 0:
            self.log(f'alert {event} was not delivered (exit {code})')

    # --- steps ---------------------------------------------------------------------------------------
    def checkout(self, commit: str) -> Path:
        return self.paths.releases / commit

    def prepare(self, run: dict) -> None:
        """Checkout, images by digest tagged to the local names, and the tenant list; nothing running changes."""
        target = self.checkout(run['commit'])
        if not target.exists():
            staging = target.with_name(target.name + '.partial')
            shutil.rmtree(staging, ignore_errors=True)
            staging.mkdir(parents=True)
            archive = staging.parent / f'{run["commit"]}.tar'
            self.git('archive', '--format=tar', '-o', str(archive), run['commit'])
            self.run_command(['tar', '-x', '-f', str(archive), '-C', str(staging)])
            archive.unlink()
            os.replace(staging, target)
        for reference, image in sorted(run['document']['images'].items()):
            self.run_command(['docker', 'pull', image], env=self.child_env)
            self.run_command(['docker', 'tag', image, f'{reference}:{run["commit"]}'])
        run['tenants'] = self.tenants(target)
        if run['previous'] is None and run['tenants']:
            raise DeployError('bootstrap_with_tenants', EXIT_REFUSED)
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
            raise DeployError('tenant_registry_unavailable') from None
        return [self.checked_tenant(item) for item in json.loads(output)]

    def checked_tenant(self, item: dict) -> dict:
        """A registry entry is used only with a plain database name and a filestore inside the data root."""
        database, filestore = str(item.get('database', '')), str(item.get('filestore', ''))
        data_root = Path(self.config['LIWAN_DEPLOY_DATA_ROOT']).resolve()
        resolved = Path(filestore).resolve()
        if (not TENANT_DATABASE.fullmatch(database) or '..' in Path(filestore).parts or not Path(filestore).is_absolute()
                or data_root not in resolved.parents):
            raise DeployError('invalid_tenant_registry', EXIT_REFUSED)
        return {'tenantId': item['tenantId'], 'database': database, 'filestore': filestore}

    def capture(self, run: dict) -> None:
        """Encrypted disaster copy of every tenant and the control plane, through the existing pipeline."""
        if run['previous'] is None:
            return  # first deploy: no stack has run, so there is no data to copy
        work = self.file(f'runs/{run["commit"]}/backup')
        common = ['--kind', 'hourly', '--work-root', str(work), '--pg-dump', self.config['LIWAN_DEPLOY_PG_DUMP']]
        if self.config.get('LIWAN_DEPLOY_BACKUP_STORE_ROOT'):
            common += ['--store-root', self.config['LIWAN_DEPLOY_BACKUP_STORE_ROOT']]
        pipeline = ['python3', '-B', str(ROOT / 'deploy/backup_pipeline.py'), 'capture']
        try:
            for tenant in run['tenants']:
                self.run_command(pipeline + common + [
                    '--tenant', tenant['tenantId'], '--data-dir', str(Path(tenant['filestore']).parent.parent),
                    '--pg-host', self.config['LIWAN_DEPLOY_PG_HOST'], '--pg-port', self.config['LIWAN_DEPLOY_PG_PORT'],
                    '--pg-user', DB_SUPERUSER], env=self.child_env)
            self.run_command(pipeline + common + [
                '--control-plane', '--db-name', CONTROL_DB, '--pg-host', self.config['LIWAN_DEPLOY_CONTROL_PG_HOST'],
                '--pg-port', self.config['LIWAN_DEPLOY_CONTROL_PG_PORT'], '--pg-user', CONTROL_DB_USER],
                env=self.child_env)
        except CommandFailed:
            raise DeployError('backup_failed') from None

    def compose(self, checkout: Path) -> list[str]:
        files = ('docker-compose.yml', 'docker-compose.shared.yml', 'docker-compose.shared-commercial.yml',
                 'docker-compose.production.yml')
        command = ['docker', 'compose', '-p', self.config['LIWAN_DEPLOY_PROJECT']]
        for name in files:
            command += ['-f', str(checkout / 'deploy' / name)]
        return command + ['--env-file', self.config['LIWAN_SHARED_ENV_FILE'],
                          '--env-file', str(self.file('release.env'))]

    def control_compose(self, checkout: Path) -> list[str]:
        return ['docker', 'compose', '-p', CONTROL_PROJECT,
                '-f', str(checkout / 'deploy/control-plane/compose.production.yml'),
                '-f', str(checkout / 'deploy/control-plane/compose.host-link.yml'),
                '--env-file', self.config['LIWAN_SHARED_ENV_FILE'], '--env-file', str(self.file('release.env'))]

    def stop_services(self, checkout: Path) -> None:
        self.run_command(self.compose(checkout) + ['stop', EDGE_SERVICE, *APP_SERVICES], env=self.child_env)
        self.run_command(self.control_compose(checkout) + ['stop', CONTROL_SERVICE], env=self.child_env)
        self.run_command(['systemctl', 'stop', SHARED_WORKER_UNIT])

    def stop(self, run: dict) -> None:
        """Maintenance: the edge (Caddy) and the databases stay up; Caddy answers 503 while the guard is down."""
        if run['previous'] is not None:
            self.stop_services(self.paths.current.resolve())

    def psql(self, checkout: Path, sql: str, *, control: bool = False) -> str:
        if control:
            base = self.control_compose(checkout) + ['exec', '-T', 'control-db', 'psql', '-U', CONTROL_DB_USER]
        else:
            base = self.compose(checkout) + ['exec', '-T', 'db', 'psql', '-U', DB_SUPERUSER]
        return self.run_command(base + ['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
                                stdin=sql, env=self.child_env)[1].strip()

    def databases(self, run: dict) -> list[dict]:
        tenants = [{'database': t['database'], 'filestore': t['filestore'], 'control': False} for t in run['tenants']]
        return tenants + [{'database': CONTROL_DB, 'filestore': None, 'control': True}]

    @staticmethod
    def literal(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    def acl(self, checkout: Path, database: str, control: bool) -> dict:
        row = self.psql(checkout, 'SELECT pg_get_userbyid(datdba), COALESCE(datacl::text, \'\') FROM pg_database '
                                  f'WHERE datname = {self.literal(database)};\n', control=control)
        owner, _, acl = row.partition('|')
        return {'owner': owner, 'acl': acl}

    def terminate(self, database: str) -> str:
        return ('SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
                f'WHERE datname = {self.literal(database)} AND pid <> pg_backend_pid();\n')

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
            self.psql(checkout, self.snapshot_sql(database), control=item['control'])
            if item['filestore']:
                copy = Path(item['filestore'] + '.pre')
                if copy.exists():
                    shutil.rmtree(copy)
                self.run_command(['cp', '-al', item['filestore'], str(copy)])
            run['snapshots'][database] = True
            write_json(self.file('run.json'), run)

    def snapshot_sql(self, database: str) -> str:
        """Closed to new connections first, so no client can reconnect between the terminate and the copy."""
        db, snap = identifier(database), identifier(snapshot_name(database))
        return (f'ALTER DATABASE {db} ALLOW_CONNECTIONS false;\n' + self.terminate(database)
                + f'DROP DATABASE IF EXISTS {snap} WITH (FORCE);\n'
                f'CREATE DATABASE {snap} TEMPLATE {db} STRATEGY FILE_COPY;\n'
                f'ALTER DATABASE {db} ALLOW_CONNECTIONS true;\n')

    def activate(self, commit: str, odoo_commit: str) -> None:
        write_atomic(self.file('release.env'), release_env_text(commit, odoo_commit))
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
            self.run_command(self.control_compose(checkout) + ['--profile', 'migrate', 'run', '--rm', '-T',
                                                               'control-migrate'], env=self.child_env)
        except CommandFailed:
            raise DeployError('control_migrate_failed') from None

    def odoo_run(self, checkout: Path, database: str, args: list[str], stdin: str | None = None) -> str:
        command = self.compose(checkout) + [
            'run', '--rm', '--no-deps', '-T', '-e', f'LIWAN_COMMERCIAL_CONFIG={CLASSIFICATION_DIR}/{database}.json',
            '--entrypoint', '/usr/local/bin/liwan-odoo', 'odoo', *args]
        return self.run_command(command, stdin=stdin, env=self.child_env)[1]

    def upgrade_tenant(self, run: dict, checkout: Path, database: str, modules: str) -> None:
        log = self.file(f'runs/{run["commit"]}/upgrade-{database}.log')
        try:
            output = self.odoo_run(checkout, database, ['-c', '/etc/odoo/odoo.conf', '-d', database, '-u', modules,
                                                        '-i', modules, '--stop-after-init', '--no-http'])
        except CommandFailed:
            raise DeployError('upgrade_failed') from None
        write_atomic(log, output)
        code, _ = self.run_command(['python3', '-B', str(checkout / 'tools/upgrade_log_guard.py'), str(log)],
                                   check=False)
        if code != 0:
            raise DeployError('upgrade_log_rejected')
        smoke = (checkout / 'deploy/odoo/upgrade_smoke.py').read_text(encoding='utf-8')
        try:
            output = self.odoo_run(checkout, database, ['shell', '-c', '/etc/odoo/odoo.conf', '-d', database,
                                                        '--no-http'], stdin=smoke)
        except CommandFailed:
            raise DeployError('upgrade_smoke_failed') from None
        if SMOKE_MARKER not in output:
            raise DeployError('upgrade_smoke_failed')

    def start_services(self, checkout: Path, with_edge: bool) -> None:
        services = [*APP_SERVICES, EDGE_SERVICE] if with_edge else list(APP_SERVICES)
        self.run_command(self.compose(checkout) + ['up', '-d', '--wait', *services], env=self.child_env)
        self.run_command(self.control_compose(checkout) + ['up', '-d', '--wait', CONTROL_SERVICE], env=self.child_env)
        self.run_command(['systemctl', 'start', SHARED_WORKER_UNIT])

    def start(self, run: dict) -> None:
        try:
            self.start_services(self.checkout(run['commit']), with_edge=False)
        except CommandFailed:
            raise DeployError('health_check_failed') from None

    def open(self, run: dict) -> None:
        """Starting the guard healthy is the commit point: customers reach the new release."""
        try:
            self.run_command(self.compose(self.checkout(run['commit'])) + ['up', '-d', '--wait', EDGE_SERVICE],
                             env=self.child_env)
        except CommandFailed:
            raise DeployError('health_check_failed') from None
        self.leave_maintenance()

    def commit(self, run: dict) -> None:
        write_json(self.file('served.json'), {'commit': run['commit'], 'ref': run['ref'], 'version': run['version'],
                                              'odooCommit': run['document']['release']['odooCommit'], 'at': now()})

    def drop_snapshots(self, run: dict, checkout: Path) -> None:
        for item in self.databases(run):
            if not run.get('snapshots', {}).get(item['database']):
                continue
            self.psql(checkout, self.reopen_sql(item['database']), control=item['control'])
            self.psql(checkout, f'DROP DATABASE IF EXISTS {identifier(snapshot_name(item["database"]))} WITH (FORCE);\n',
                      control=item['control'])
            copy = Path(item['filestore'] + '.pre') if item['filestore'] else None
            if copy is not None and copy.exists():
                shutil.rmtree(copy)

    def cleanup(self, run: dict) -> None:
        self.drop_snapshots(run, self.checkout(run['commit']))
        self.file('run.json').unlink()

    # --- rollback ------------------------------------------------------------------------------------
    def rollback(self, run: dict, reason: str) -> int:
        failed_phase = run.get('failedPhase', run['phase'])
        run.update(failure=reason, failedPhase=failed_phase)
        self.set_phase(run, 'rolling_back')
        self.enter_maintenance()
        try:
            if run['previous'] is None:
                self.stop_bootstrap(run)
                self.halt(run, failed_phase, reason, 'deploy_failed')
                self.file('run.json').unlink()
                return EXIT_FAILED
            self.restore(run)
        except (DeployError, CommandFailed, OSError, ValueError) as error:
            code = error.reason if isinstance(error, DeployError) else 'rollback_command_failed'
            self.halt(run, failed_phase, code, 'deploy_rollback_failed')
            return EXIT_ROLLBACK_FAILED
        self.leave_maintenance()
        self.halt(run, failed_phase, reason, 'deploy_failed')
        self.file('run.json').unlink()
        return EXIT_FAILED

    def stop_bootstrap(self, run: dict) -> None:
        """First deploy: nothing older exists, so the failed stack is stopped and left in maintenance."""
        if self.file('release.env').exists():
            self.stop_services(self.checkout(run['commit']))

    def restore(self, run: dict) -> None:
        """Swap every snapshot back, restore owner, grants and isolation, then restart the previous release."""
        previous = run['previous']
        checkout = self.checkout(previous['commit'])
        self.stop_services(self.paths.current.resolve())
        for item in self.databases(run):
            self.swap_back(run, checkout, item)
        write_atomic(self.file('release.env'), run['previousReleaseEnv']
                     or release_env_text(previous['commit'], previous['odooCommit']))
        self.point_current(checkout)
        self.start_services(checkout, with_edge=True)

    def swap_back(self, run: dict, checkout: Path, item: dict) -> None:
        database, snap = item['database'], snapshot_name(item['database'])
        live = self.exists(checkout, database, item['control'])
        if database in run.get('access', {}) and live:
            self.psql(checkout, self.reopen_sql(database), control=item['control'])  # a failed snapshot left it closed
        if not run.get('snapshots', {}).get(database):
            return  # never snapshotted in this run, so never upgraded: an older liwan_pre_* is not ours to swap in
        recorded = run['access'][database]
        if self.exists(checkout, snap, item['control']):
            self.psql(checkout, self.swap_sql(database, live), control=item['control'])
        statements = [f'ALTER DATABASE {identifier(database)} ALLOW_CONNECTIONS true',
                      f'ALTER DATABASE {identifier(database)} OWNER TO {identifier(recorded["owner"])}']
        if not item['control']:
            statements += list(tenant_isolation_statements(database, DB_SUPERUSER))
        self.psql(checkout, ''.join(statement + ';\n' for statement in statements), control=item['control'])
        if self.acl(checkout, database, item['control']) != recorded:
            raise DeployError('acl_mismatch')
        if item['filestore']:
            restore_filestore(Path(item['filestore']))

    def exists(self, checkout: Path, database: str, control: bool) -> bool:
        return self.psql(checkout, f'SELECT count(*) FROM pg_database WHERE datname = {self.literal(database)};\n',
                         control=control) == '1'

    @staticmethod
    def reopen_sql(database: str) -> str:
        return f'ALTER DATABASE {identifier(database)} ALLOW_CONNECTIONS true;\n'

    def swap_sql(self, database: str, live: bool) -> str:
        """Close and drop the live database only when it still exists; a resumed swap may find it already gone."""
        db, snap = identifier(database), identifier(snapshot_name(database))
        drop = (f'ALTER DATABASE {db} ALLOW_CONNECTIONS false;\n' + self.terminate(database)
                + f'DROP DATABASE {db} WITH (FORCE);\n') if live else ''
        return drop + f'ALTER DATABASE {snap} RENAME TO {db};\n'

    # --- status and clear ----------------------------------------------------------------------------
    def status(self) -> int:
        report = {name: read_json(self.file(f'{name}.json')) for name in ('served', 'run', 'halted')}
        if report['run']:
            report['run'] = {key: report['run'][key] for key in ('commit', 'ref', 'phase', 'updatedAt')}
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=True) + '\n')
        return EXIT_HALTED if report['halted'] else EXIT_OK

    def clear(self) -> int:
        path = self.file('halted.json')
        if path.exists():
            path.unlink()
            self.log('halt cleared; an unfinished run resumes on the next run')
        return EXIT_OK


def restore_filestore(live: Path) -> None:
    """live -> live.failed, live.pre -> live, remove live.failed; each step resumes from what it finds."""
    pre, failed = live.with_name(live.name + '.pre'), live.with_name(live.name + '.failed')
    if pre.exists() and live.exists():
        if failed.exists():
            shutil.rmtree(failed)
        os.replace(live, failed)
    if pre.exists():
        os.replace(pre, live)
    if failed.exists():
        shutil.rmtree(failed)


class Lock:
    """One run per environment: a non-blocking flock on ``<state>/lock``."""

    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.handle = open(path, 'a+', encoding='utf-8')

    def __enter__(self) -> bool:
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True

    def __exit__(self, *_):
        self.handle.close()


def make_log(stream=sys.stderr):
    def log(message: str) -> None:
        stream.write(f'{now()} deploy: {message}\n')
        stream.flush()
    return log


def parse_args(argv):
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('command', choices=('run', 'status', 'clear'))
    parser.add_argument('--environment', required=True)
    return parser.parse_args(argv)


def main(argv=None, paths: Paths = Paths(), runner=None, log=None) -> int:
    args = parse_args(argv)
    log = log or make_log()
    try:
        config = load_config(paths, args.environment)
        deployer = Deployer(args.environment, config, paths, runner or Runner(log), log)
        with Lock(deployer.file('lock')) as held:
            if not held:
                log('another run holds the lock')
                return EXIT_OK
            return getattr(deployer, args.command)()
    except DeployError as error:
        log(f'stopped: {error.reason}')
        return error.exit_code


if __name__ == '__main__':
    raise SystemExit(main())
