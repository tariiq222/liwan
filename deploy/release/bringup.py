#!/usr/bin/env python3
"""Host bring-up for a release host: checks, and with --apply creates, what docs/operations/environment-bringup.md asks for by hand.

  bringup.py --environment <name> [--apply] [--post-run]

One line per item: ``ok <item>``, ``created <item>`` (only with --apply), ``MISSING <item>: <what a human must do>`` or
``FAILED <item>: <reason>`` (a symlink or wrong file type where a path must be what it should, or a command that failed).
The last line is ``RESULT: bringup ok`` (exit 0) or ``RESULT: bringup incomplete <n>`` (exit 1). Default is check-only;
``--apply`` needs root (exit 2 otherwise). A second ``--apply`` changes nothing. ``--post-run`` adds the checks of A8.2a to
A8.7 (after the first release). The tool never prints a secret, a file content or a command output.

The items are a flat registry (``REGISTRY``); the runner knows none of them, so a new item is one more entry. Every host
access goes through ``Host``. The environment name only selects the release config; all differences come from that file.
"""
from __future__ import annotations

import argparse
import contextlib
import grp
import json
import os
import pwd
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from deploy.release import common  # noqa: E402 - path set just above
from deploy.release.release import (  # noqa: E402
    CONFIG_KEYS, CONTROL_DB_PORT, DB_SUPERUSER, RELEASE_FOLDER, SHARED_WORKER_UNIT, TENANT_DB_PORT, Paths)
from deploy.release.source import (  # noqa: E402
    COMMIT as COMMIT_ID, CREDENTIAL_HELPER, ENVIRONMENTS, GITHUB_TOKEN_VAR, REGISTRY as IMAGE_REGISTRY, REGISTRY_HOST,
    RELEASE_IMAGE, REPOSITORY_URL, TOKEN_VAR, USER_VAR, highest_release_tag, parse_listing)

EXIT_INCOMPLETE, EXIT_USAGE = 1, 2
ROOT_UID = 0
PRIVATE_FILE_MODE = 0o600
# A3.1: the worker account, the Oracle image's default login that must leave the docker group, and the group itself.
WORKER_USER = 'liwan-worker'
WORKER_HOME = '/var/lib/liwan-worker'
NOLOGIN_SHELL = '/usr/sbin/nologin'
DOCKER_GROUP = 'docker'
COMMAND_TIMEOUT_SECONDS = 120
IMAGE_DOCKER_USER = 'ubuntu'
# A3.3: the fixed parents (the others come from the release config) and their modes.
ETC_LIWAN = Path('/etc/liwan')
PUBLIC_DIR_MODE, STATE_DIR_MODE, WORKER_DIR_MODE = 0o755, 0o700, 0o750
# A3.2: what init-host.sh creates, by the env-file key that names the directory.
INIT_HOST_SCRIPT = ('deploy', 'control-plane', 'init-host.sh')
INIT_HOST_FILES = {
    'LIWAN_CONTROL_CONFIG_DIR': ('shared-runtime.json', 'inventory-v2.json'),
    'LIWAN_TENANT_REGISTRY_DIR': ('registry.json',),
    'LIWAN_CONTROL_PRIVATE_DIR': ('control-ca.key', 'control-ca.pem', 'control-tls.key', 'control-tls.crt',
                                  'effect-tls.key', 'effect-tls.crt', 'control-db-password'),
}
INIT_HOST_DIRS = ('LIWAN_AI_PLATFORM_DIR',)
# A3.4a: command, minimum major version (0 = any), apt package that provides it. Node 22 comes from NodeSource.
PACKAGES = (('node', 22, 'nodejs (NodeSource node_22.x repository)'), ('npm', 0, 'nodejs (NodeSource node_22.x repository)'),
            ('pg_dump', 16, 'postgresql-client-16'), ('git', 0, 'git'), ('python3', 0, 'python3'))
# A3.5: disk alert (D22, 70%) on LIWAN_RELEASE_DISK_PATH, /var/lib/docker and the shared stack's directory. The host has 12 GB RAM
# and a 4 GB swap file, so the defaults leave a little below each; optional release config keys override the two sizes.
DISK_ALERT_PERCENT = 70
DOCKER_DISK_PATH = '/var/lib/docker'
MIN_MEMORY_MIB, MIN_SWAP_MIB = 11000, 4000
MEMORY_KEY, SWAP_KEY = 'LIWAN_BRINGUP_MIN_MEMORY_MIB', 'LIWAN_BRINGUP_MIN_SWAP_MIB'
BYTES_PER_MIB = 1024 * 1024
# A3.6, A6.1: the units and where systemd reads them.
SYSTEMD_DIR = Path('/etc/systemd/system')
FIREWALL_UNIT = 'liwan-firewall.service'
FIREWALL_SCRIPT = 'liwan-firewall.sh'
UNIT_FILE_MODE = 0o644
# A3.6, A8.4: the shared worker's listener on the control bridge gateway.
WORKER_EFFECT_ADDRESS, WORKER_EFFECT_PORT = '172.29.40.1', '4188'
LOOPBACK = '127.0.0.1'
# A5.1: the read credential file next to the release configs; the probe ref is only ever used with `push --dry-run`.
CREDENTIAL_FILE = 'github-read'
CREDENTIAL_KEYS = (USER_VAR, TOKEN_VAR)
PROBE_REF = 'HEAD:refs/heads/liwan-bringup-probe'
# A5.2: the scope header of a classic token; the registry token must list this scope and no other.
SCOPES_URL = 'https://api.github.com/user'
SCOPES_HEADER = 'x-oauth-scopes'
READ_ONLY_SCOPES = {'read:packages'}
RELEASE_TAG_PATTERN = 'refs/tags/release/*'
# What git prints when the server refuses a write for lack of permission (the only refusal that proves a read-only token).
WRITE_REFUSED_MARKERS = ('The requested URL returned error: 403', 'Write access to repository not granted', 'remote: Permission to ')
# A8.4b: the only container allowed on the host network.
HOST_NETWORK_MARKER = 'openship'
TICK_MARKER = 'commercial_scheduler_tick'
HTTP_OK = re.compile(r'^[23]\d\d 0$')
STATUS_LINE = re.compile(r'^\s*HTTP/\d(?:\.\d)?\s+(\d{3})\b')
RESTORE_PROXY_PORT = '443'
FIRST_NUMBER = re.compile(r'\d+')


class ItemError(Exception):
    """An item cannot proceed: a symlink or wrong file type on a path it must touch, or a command that failed."""


REDIRECT_CODES = (301, 302, 303, 307, 308)


class RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """No redirect is followed: urllib would forward the Authorization header to the target host."""

    def redirect_request(self, *args, **kwargs):
        return None


@dataclass(frozen=True)
class Status:
    ok: bool
    detail: str = ''


OK = Status(True)
NEEDS_CONFIG = Status(False, 'needs the release config (see release-config)')


def missing(detail: str) -> Status:
    return Status(False, detail)


@dataclass(frozen=True)
class Item:
    name: str
    check: Callable[['Context'], Status]
    missing: str
    apply: Callable[['Context'], None] | None = None
    post_run: bool = False


class Host:
    """Everything the tool does to the machine. Thin on purpose; tests replace it with a fake."""

    def __init__(self, timeout: float = COMMAND_TIMEOUT_SECONDS) -> None:
        self.timeout = timeout

    def euid(self) -> int:
        return os.geteuid()

    def lstat(self, path):
        try:
            return os.lstat(path)
        except FileNotFoundError:
            return None

    def readlink(self, path) -> str:
        return os.readlink(path)

    def listdir(self, path) -> list[str]:
        try:
            return os.listdir(path)
        except FileNotFoundError:
            return []

    def read_env(self, path) -> dict[str, str]:
        return common.parse_env_text(self.read_text(path))

    def read_text(self, path) -> str:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as handle:
            data = handle.read()
        try:
            return data.decode('utf-8')
        except UnicodeDecodeError:
            raise ItemError(f'{path} is not valid UTF-8 text') from None

    def write_new(self, path, text: str, mode: int) -> None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            os.fchmod(handle.fileno(), mode)
            handle.write(text)

    def make_dir(self, path, mode: int, uid: int, gid: int) -> None:
        """Created relative to the opened parent, so a symlink as the parent or as the target is refused."""
        parent_fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.mkdir(Path(path).name, mode, dir_fd=parent_fd)
            try:
                fd = os.open(Path(path).name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
                try:
                    os.fchown(fd, uid, gid)
                    os.fchmod(fd, mode)
                finally:
                    os.close(fd)
            except BaseException:
                os.rmdir(Path(path).name, dir_fd=parent_fd)  # never leave the half-made directory with the wrong owner
                raise
        finally:
            os.close(parent_fd)

    def symlink(self, target: str, link) -> None:
        os.symlink(target, link)

    @contextlib.contextmanager
    def scratch_dir(self):
        """A private temporary directory, removed on exit."""
        with tempfile.TemporaryDirectory(prefix='liwan-bringup-') as path:
            yield path

    def run(self, argv: list[str], env: dict | None = None, cwd=None, stdin: str | None = None) -> tuple[int, str]:
        base = {'PATH': os.environ.get('PATH', '/usr/sbin:/usr/bin:/sbin:/bin'), 'HOME': os.environ.get('HOME', '/root'),
                'LC_ALL': 'C'}
        try:
            done = subprocess.run(argv, env={**base, **(env or {})}, cwd=cwd, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, check=False, timeout=self.timeout,
                                  **({'stdin': subprocess.DEVNULL} if stdin is None else {'input': stdin}))
        except FileNotFoundError:
            return 127, ''
        except subprocess.TimeoutExpired:
            raise ItemError(f'{argv[0]} timed out') from None
        return done.returncode, done.stdout

    def https_headers(self, url: str, token: str) -> tuple[int, dict[str, str]]:
        """Status and lower-cased headers of a HEAD request with the token in a header (never in an argument)."""
        request = urllib.request.Request(url, method='HEAD', headers={'Authorization': f'Bearer {token}', 'User-Agent': 'liwan-bringup'})
        host = urllib.parse.urlsplit(url).hostname
        try:
            with urllib.request.build_opener(RefuseRedirect).open(request, timeout=self.timeout) as response:
                return response.status, {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as error:
            if error.code in REDIRECT_CODES:
                raise ItemError(f'{host} answered with a redirect') from None
            return error.code, {key.lower(): value for key, value in error.headers.items()}
        except (urllib.error.URLError, OSError):
            raise ItemError(f'{host} is unreachable') from None

    def user(self, name: str):
        try:
            entry = pwd.getpwnam(name)
        except KeyError:
            return None
        return entry.pw_uid, entry.pw_gid

    def group(self, name: str):
        try:
            entry = grp.getgrnam(name)
        except KeyError:
            return None
        return entry.gr_gid, list(entry.gr_mem)

    def disk_usage(self, path):
        try:
            usage = os.statvfs(path)
        except FileNotFoundError:
            return None
        return usage.f_blocks * usage.f_frsize, usage.f_bavail * usage.f_frsize

    def meminfo(self) -> tuple[int, int]:
        values = {}
        with open('/proc/meminfo', encoding='ascii') as handle:
            for line in handle:
                key, _, rest = line.partition(':')
                values[key] = int(rest.split()[0]) * 1024
        return values['MemTotal'], values['SwapTotal']


class Context:
    def __init__(self, host, environment: str, paths: Paths, apply: bool, repo_dir: Path):
        self.host, self.environment, self.paths, self.apply, self.repo_dir = host, environment, paths, apply, repo_dir
        self._config: tuple[dict | None, str] | None = None

    def release_config(self) -> tuple[dict | None, str]:
        """The release config and, when it cannot be used, the reason. Cached: the file is the operator's."""
        if self._config is None:
            self._config = self._load_config()
        return self._config

    def config(self) -> dict | None:
        return self.release_config()[0]

    def _load_config(self) -> tuple[dict | None, str]:
        path = self.paths.config_root / f'{self.environment}.env'
        info = inspect(self.host, path, REGULAR_FILE)
        if info is None:
            return None, f'{path} does not exist'
        if stat.S_IMODE(info.st_mode) != PRIVATE_FILE_MODE or info.st_uid != ROOT_UID:
            return None, f'{path} must be mode 0600 and owned by root'
        values = self.host.read_env(path)
        absent = [key for key in CONFIG_KEYS if not values.get(key)]
        return (None, f'{path} lacks {", ".join(absent)}') if absent else (values, '')

    def shared_env(self) -> dict | None:
        config = self.config()
        if config is None:
            return None
        path = Path(config['LIWAN_SHARED_ENV_FILE'])
        info = inspect(self.host, path, REGULAR_FILE)
        if info is None:
            return None
        worker = self.host.user(WORKER_USER)
        owners = {ROOT_UID} | ({worker[0]} if worker else set())
        if info.st_uid not in owners or stat.S_IMODE(info.st_mode) & 0o077:
            raise ItemError(f'{path} must be owned by root or {WORKER_USER} with no group or other permissions')
        return self.host.read_env(path)

    def must(self, argv: list[str], env: dict | None = None, cwd=None) -> None:
        code, _ = self.host.run(argv, env=env, cwd=cwd)
        if code != 0:
            raise ItemError(f'{argv[0]} exited {code}; run it by hand to see the reason: {shlex.join(argv)}')


REGULAR_FILE, DIRECTORY = 'regular file', 'directory'
KIND_TESTS = {REGULAR_FILE: stat.S_ISREG, DIRECTORY: stat.S_ISDIR}


def inspect(host, path, kind: str):
    """lstat of a path that must be a ``kind`` and not a symlink; None when absent. Anything else refuses the item."""
    info = host.lstat(path)
    if info is None:
        return None
    if stat.S_ISLNK(info.st_mode):
        raise ItemError(f'{path} is a symlink; refusing to touch it')
    if not KIND_TESTS[kind](info.st_mode):
        raise ItemError(f'{path} is not a {kind}')
    return info


def shape(info) -> str:
    return f'{stat.S_IMODE(info.st_mode):04o} {info.st_uid}:{info.st_gid}'


# --- A3.1 worker account ---------------------------------------------------------------------------------------------
def docker_members(ctx: Context) -> list[str] | None:
    group = ctx.host.group(DOCKER_GROUP)
    return None if group is None else group[1]


def check_worker_user(ctx: Context) -> Status:
    problems = []
    if ctx.host.user(WORKER_USER) is None:
        problems.append(f'account {WORKER_USER} does not exist')
    members = docker_members(ctx)
    if members is None:
        return missing(f'group {DOCKER_GROUP} does not exist: install Docker first')
    if WORKER_USER not in members:
        problems.append(f'{WORKER_USER} is not in group {DOCKER_GROUP}')
    others = [name for name in members if name != WORKER_USER]
    if others:
        problems.append(f'{DOCKER_GROUP} also lists {", ".join(others)}')
    return missing('; '.join(problems)) if problems else OK


def apply_worker_user(ctx: Context) -> None:
    members = docker_members(ctx)
    if members is None:
        raise ItemError(f'group {DOCKER_GROUP} does not exist: install Docker first')
    if ctx.host.user(WORKER_USER) is None:
        ctx.must(['useradd', '--system', '--create-home', '--home-dir', WORKER_HOME, '--shell', NOLOGIN_SHELL, WORKER_USER])
    if WORKER_USER not in members:
        ctx.must(['usermod', '-aG', DOCKER_GROUP, WORKER_USER])
    if IMAGE_DOCKER_USER in members:
        ctx.must(['gpasswd', '-d', IMAGE_DOCKER_USER, DOCKER_GROUP])


# --- the release config (A4.4, existence and mode only) --------------------------------------------------------------
def check_release_config(ctx: Context) -> Status:
    config, problem = ctx.release_config()
    return OK if config is not None else missing(problem)


# --- A3.2 init-host.sh -----------------------------------------------------------------------------------------------
def init_host_inputs(ctx: Context) -> tuple[dict | None, str]:
    """The shared env values init-host.sh reads, or why it cannot run yet."""
    shared = ctx.shared_env()
    if shared is None:
        return None, 'the shared env file (A4.1) does not exist yet'
    keys = [*INIT_HOST_FILES, *INIT_HOST_DIRS]
    absent = [key for key in keys if not shared.get(key)]
    if absent:
        return None, f'the shared env file lacks {", ".join(absent)}'
    return shared, ''


def init_host_outputs(shared: dict) -> list[tuple[Path, str]]:
    files = [(Path(shared[key]) / name, REGULAR_FILE) for key, names in INIT_HOST_FILES.items() for name in names]
    return files + [(Path(shared[key]), DIRECTORY) for key in INIT_HOST_DIRS]


def check_init_host(ctx: Context) -> Status:
    if ctx.config() is None:
        return NEEDS_CONFIG
    shared, problem = init_host_inputs(ctx)
    if shared is None:
        return missing(problem)
    absent = [str(path) for path, kind in init_host_outputs(shared) if inspect(ctx.host, path, kind) is None]
    if not absent:
        return OK
    detail = f'absent: {", ".join(absent)}'
    if not first_bring_up(ctx, shared):  # bring-up never runs the script here: a human decides
        detail += f'; run as root: {init_host_command(ctx, ctx.config())}'
    return missing(detail)


def init_host_script(ctx: Context) -> Path:
    return ctx.paths.current.joinpath(*INIT_HOST_SCRIPT)


def init_host_command(ctx: Context, config: dict) -> str:
    return shlex.join([str(init_host_script(ctx)), config['LIWAN_SHARED_ENV_FILE'], config['LIWAN_RELEASE_PROJECT']])


def first_bring_up(ctx: Context, shared: dict) -> bool:
    """The script runs as root from here only when no release was ever served and none of its outputs exist: after that the
    shared env file belongs to the worker account and root does not act on paths read from it."""
    if ctx.host.lstat(ctx.paths.state_root / ctx.environment / 'served.json') is not None:
        return False
    return all(inspect(ctx.host, path, kind) is None for path, kind in init_host_outputs(shared))


def apply_init_host(ctx: Context) -> None:
    config = ctx.config()
    shared, _ = init_host_inputs(ctx)
    if config is None or shared is None or ctx.host.user(WORKER_USER) is None:
        return  # the recheck reports what is still missing
    script = init_host_script(ctx)
    if inspect(ctx.host, script, REGULAR_FILE) is None or not first_bring_up(ctx, shared):
        return
    ctx.must([str(script), config['LIWAN_SHARED_ENV_FILE'], config['LIWAN_RELEASE_PROJECT']])


# --- A3.3 directories ------------------------------------------------------------------------------------------------
def directory_specs(ctx: Context, config: dict) -> list[tuple[Path, int, str]]:
    """Path, mode and group of each directory, parents first; the owner is always root."""
    srv = Path(config['LIWAN_SHARED_ENV_FILE']).parent
    root_group = 'root'
    return [(ctx.paths.releases.parent, PUBLIC_DIR_MODE, root_group), (ctx.paths.releases, PUBLIC_DIR_MODE, root_group),
            (ETC_LIWAN, PUBLIC_DIR_MODE, root_group), (srv, PUBLIC_DIR_MODE, root_group),
            (ctx.paths.state_root, PUBLIC_DIR_MODE, root_group), (ctx.paths.maintenance.parent, PUBLIC_DIR_MODE, root_group),
            (ctx.paths.state_root / ctx.environment, STATE_DIR_MODE, root_group),
            (srv / 'config', WORKER_DIR_MODE, WORKER_USER), (srv / 'control', WORKER_DIR_MODE, WORKER_USER)]


def group_id(ctx: Context, name: str) -> int | None:
    group = ctx.host.group(name)
    return None if group is None else group[0]


def check_directories(ctx: Context) -> Status:
    config = ctx.config()
    if config is None:
        return NEEDS_CONFIG
    problems = []
    for path, mode, group in directory_specs(ctx, config):
        info = inspect(ctx.host, path, DIRECTORY)
        gid = group_id(ctx, group)
        if info is None:
            problems.append(f'{path} absent')
        elif gid is None:
            problems.append(f'group {group} absent')
        elif (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) != (mode, ROOT_UID, gid):
            problems.append(f'{path} is {shape(info)}, expected {mode:04o} {ROOT_UID}:{gid}')
    return missing('; '.join(problems)) if problems else OK


def apply_directories(ctx: Context) -> None:
    config = ctx.config()
    if config is None:
        return
    for path, mode, group in directory_specs(ctx, config):
        gid = group_id(ctx, group)
        if inspect(ctx.host, path, DIRECTORY) is None and gid is not None:
            ctx.host.make_dir(path, mode, ROOT_UID, gid)


# --- A3.4 bootstrap checkout -----------------------------------------------------------------------------------------
def checkout_candidates(ctx: Context) -> list[Path]:
    names = [name for name in ctx.host.listdir(ctx.paths.releases)
             if (found := RELEASE_FOLDER.match(name)) and found.group(2) is None]
    return [ctx.paths.releases / name for name in sorted(names)]


def check_checkout(ctx: Context) -> Status:
    info = ctx.host.lstat(ctx.paths.current)
    if info is None:
        return missing(f'{ctx.paths.current} does not exist')
    if not stat.S_ISLNK(info.st_mode):
        raise ItemError(f'{ctx.paths.current} is not a symlink (the release refuses current_not_symlink)')
    target = Path(os.path.join(ctx.paths.current.parent, ctx.host.readlink(ctx.paths.current)))
    if target.parent != ctx.paths.releases:
        return missing(f'{ctx.paths.current} points at {target}, outside {ctx.paths.releases}')
    if inspect(ctx.host, target, DIRECTORY) is None:
        return missing(f'{ctx.paths.current} points at {target}, which does not exist (current_dangling)')
    return OK


def apply_checkout(ctx: Context) -> None:
    if ctx.host.lstat(ctx.paths.current) is not None:
        return  # never replaced: a link that points elsewhere is the operator's to fix
    candidates = checkout_candidates(ctx)
    if len(candidates) == 1 and inspect(ctx.host, candidates[0], DIRECTORY) is not None:
        ctx.host.symlink(str(candidates[0]), ctx.paths.current)


# --- A3.4a packages --------------------------------------------------------------------------------------------------
def package_item(command: str, minimum: int, package: str) -> Item:
    def check(ctx: Context) -> Status:
        code, output = ctx.host.run([command, '--version'])
        if code != 0:
            return missing(f'{command} is not installed')
        found = FIRST_NUMBER.search(output)
        major = int(found.group()) if found else 0
        return missing(f'{command} is major version {major}, need {minimum}') if major < minimum else OK

    return Item(f'package-{command}', check, f'install apt package {package} (A3.4a, as root)')


# --- A3.5 disk, memory, swap -----------------------------------------------------------------------------------------
def check_disk(ctx: Context) -> Status:
    config = ctx.config()
    if config is None:
        return NEEDS_CONFIG
    problems = []
    for path in dict.fromkeys((config['LIWAN_RELEASE_DISK_PATH'], DOCKER_DISK_PATH, str(Path(config['LIWAN_SHARED_ENV_FILE']).parent))):
        usage = ctx.host.disk_usage(path)
        if usage is None:
            problems.append(f'{path} does not exist')
        elif (used := 100 - usage[1] * 100 // usage[0]) >= DISK_ALERT_PERCENT:
            problems.append(f'{path} is {used}% used, limit {DISK_ALERT_PERCENT}%')
    return missing('; '.join(problems)) if problems else OK


def size_check(index: int, key: str, default: int, label: str) -> Callable[[Context], Status]:
    def check(ctx: Context) -> Status:
        config = ctx.config()
        if config is None:
            return NEEDS_CONFIG
        override = config.get(key)
        if override and not (override.isascii() and override.isdigit()):
            raise ItemError(f'{key} must be a whole number')
        minimum = int(override or default)
        have = ctx.host.meminfo()[index] // BYTES_PER_MIB
        return missing(f'{label} is {have} MiB, need {minimum} MiB') if have < minimum else OK

    return check


# --- A3.6 firewall ---------------------------------------------------------------------------------------------------
def firewall_script(ctx: Context) -> str:
    return str(ctx.repo_dir / FIREWALL_SCRIPT)


def check_firewall_rules(ctx: Context) -> Status:
    code, _ = ctx.host.run(['sh', firewall_script(ctx), '--check'])
    return OK if code == 0 else missing('a rule of A3.6 is absent (run as root to check)')


def apply_firewall_rules(ctx: Context) -> None:
    ctx.must(['sh', firewall_script(ctx)])


def unit_status(ctx: Context, unit: str, source: Path, compare: bool, active: bool = False) -> Status:
    path = SYSTEMD_DIR / unit
    if inspect(ctx.host, path, REGULAR_FILE) is None:
        return missing(f'{path} is not installed')
    if compare and unit_differs(ctx, path, source):
        return missing(f'{path} differs from {source}; review it and replace it by hand')
    code, output = ctx.host.run(['systemctl', 'is-enabled', unit])
    if code != 0 or output.strip() != 'enabled':
        return missing(f'{unit} is not enabled')
    if active:
        code, output = ctx.host.run(['systemctl', 'is-active', unit])
        if code != 0 or output.strip() != 'active':
            return missing(f'{unit} is not active')
    return OK


def unit_differs(ctx: Context, path: Path, source: Path) -> bool:
    return ctx.host.read_text(path) != source.read_text(encoding='utf-8')


def install_unit(ctx: Context, unit: str, source: Path, compare: bool, start: bool = False) -> None:
    """Writes a missing unit file; an installed one that must match the repository copy and does not is left alone, with
    no systemctl call, for the check to report. ``start`` enables and starts it (systemd restarts only active units)."""
    path = SYSTEMD_DIR / unit
    if inspect(ctx.host, path, REGULAR_FILE) is None:
        ctx.host.write_new(path, source.read_text(encoding='utf-8'), UNIT_FILE_MODE)
    elif compare and unit_differs(ctx, path, source):
        return
    ctx.must(['systemctl', 'daemon-reload'])
    ctx.must(['systemctl', 'enable', *(['--now'] if start else []), unit])


def check_firewall_unit(ctx: Context) -> Status:
    return unit_status(ctx, FIREWALL_UNIT, ctx.repo_dir / FIREWALL_UNIT, compare=True, active=True)


def apply_firewall_unit(ctx: Context) -> None:
    install_unit(ctx, FIREWALL_UNIT, ctx.repo_dir / FIREWALL_UNIT, compare=True, start=True)


# --- A5 read credential ----------------------------------------------------------------------------------------------
def credential_path(ctx: Context) -> Path:
    return ctx.paths.config_root / CREDENTIAL_FILE


def credential_values(ctx: Context) -> tuple[dict | None, str]:
    path = credential_path(ctx)
    info = inspect(ctx.host, path, REGULAR_FILE)
    if info is None:
        return None, f'{path} does not exist'
    if stat.S_IMODE(info.st_mode) != PRIVATE_FILE_MODE or info.st_uid != ROOT_UID:
        return None, f'{path} must be mode 0600 and owned by root'
    values = ctx.host.read_env(path)
    absent = [key for key in CREDENTIAL_KEYS if not values.get(key)]
    return (None, f'{path} lacks {", ".join(absent)}') if absent else (values, '')


def check_credential_file(ctx: Context) -> Status:
    values, problem = credential_values(ctx)
    return OK if values is not None else missing(problem)


def check_credential_access(ctx: Context) -> Status:
    values, problem = credential_values(ctx)
    if values is None:
        return missing(problem)
    problem = registry_scope_problem(ctx, values)
    if problem:
        return missing(problem)
    token = values.get(GITHUB_TOKEN_VAR)
    git = ['git', '-c', f'credential.helper={CREDENTIAL_HELPER}'] if token else ['git']
    env = {'GIT_TERMINAL_PROMPT': '0', **({GITHUB_TOKEN_VAR: token} if token else {})}
    code, output = ctx.host.run([*git, 'ls-remote', '--tags', REPOSITORY_URL, RELEASE_TAG_PATTERN], env=env)
    if code != 0:
        return missing('the credential cannot read the repository')
    refs = parse_listing(output)
    tag = highest_release_tag(refs)
    if tag is None:
        return missing('no release document exists yet: the first release must be published (A8.1) before the registry read can be checked')
    problem = registry_read_problem(ctx, values, tag, refs[f'refs/tags/{tag}'])
    if problem:
        return missing(problem)
    return git_write_problem(ctx, git, env) if token else OK


def git_write_problem(ctx: Context, git: list[str], env: dict) -> Status:
    """A5.2: the source token cannot push. Only a refusal for lack of permission proves it."""
    checkout = str(ctx.paths.current)
    code, output = ctx.host.run(['git', '-C', checkout, 'rev-parse', 'HEAD'])
    if code != 0 or not COMMIT_ID.match(output.strip()):
        return missing(f'{checkout} is not a git checkout yet, so the write probe cannot run')
    code, output = ctx.host.run([*git, 'push', '--dry-run', REPOSITORY_URL, PROBE_REF], env=env, cwd=checkout)
    if code == 0:
        return missing('the credential can write to the repository: replace it with a read-only token')
    if not any(marker in output for marker in WRITE_REFUSED_MARKERS):
        raise ItemError('write probe inconclusive')  # a network or git failure proves nothing about the token
    return OK


def registry_scope_problem(ctx: Context, values: dict) -> str:
    """A5.2: the registry token lists ``read:packages`` only (the scope header of a classic token, no write attempt)."""
    status, headers = ctx.host.https_headers(SCOPES_URL, values[TOKEN_VAR])
    if status != 200:
        return 'api.github.com does not accept the registry token'
    if SCOPES_HEADER not in headers:
        return f'api.github.com shows no {SCOPES_HEADER} for the registry token, so a missing write scope cannot be shown'
    scopes = {scope.strip() for scope in headers[SCOPES_HEADER].split(',') if scope.strip()}
    return '' if scopes == READ_ONLY_SCOPES else 'the registry token has scopes beyond read:packages: replace it with a read-only token'


def registry_read_problem(ctx: Context, values: dict, tag: str, commit: str) -> str:
    """A5.2: the token reads one release document of the private registry. It goes to docker on stdin, into a throwaway config."""
    image = f'{IMAGE_REGISTRY}/{RELEASE_IMAGE}:{commit}'
    with ctx.host.scratch_dir() as scratch:
        env = {'DOCKER_CONFIG': scratch}
        login = ['docker', 'login', REGISTRY_HOST, '--username', values[USER_VAR], '--password-stdin']
        if ctx.host.run(login, env=env, stdin=values[TOKEN_VAR] + '\n')[0] != 0:
            return f'the credential cannot log in to {REGISTRY_HOST}'
        if ctx.host.run(['docker', 'manifest', 'inspect', image], env=env)[0] != 0:
            return f'cannot read {image}: either the release document of {tag} is not published yet or the token cannot read the registry'
    return ''


# --- A6.1 shared worker unit -----------------------------------------------------------------------------------------
def worker_unit_source(ctx: Context) -> Path:
    return ctx.repo_dir.parent / 'control-plane' / SHARED_WORKER_UNIT


def check_worker_unit(ctx: Context) -> Status:
    return unit_status(ctx, SHARED_WORKER_UNIT, worker_unit_source(ctx), compare=False)


def apply_worker_unit(ctx: Context) -> None:
    install_unit(ctx, SHARED_WORKER_UNIT, worker_unit_source(ctx), compare=False)  # enabled, never started: the release commit starts it


# --- A8.2a to A8.7, after the first release --------------------------------------------------------------------------
def shared_values(ctx: Context, *keys: str) -> tuple[list[str] | None, Status]:
    """The values of ``keys`` in the shared env file, or the status that says why they are not there."""
    config = ctx.config()
    if config is None:
        return None, NEEDS_CONFIG
    shared = ctx.shared_env()
    if shared is None:
        return None, missing('the shared env file does not exist')
    absent = [key for key in keys if not shared.get(key)]
    return (None, missing(f'the shared env file lacks {", ".join(absent)}')) if absent else ([shared[k] for k in keys], OK)


def check_shared_file_owners(ctx: Context) -> Status:
    values, status = shared_values(ctx, 'LIWAN_SHARED_COMPOSE_FILE')
    if values is None:
        return status
    worker = ctx.host.user(WORKER_USER)
    if worker is None:
        return missing(f'account {WORKER_USER} does not exist')
    problems = []
    for path in (values[0], ctx.config()['LIWAN_SHARED_ENV_FILE']):
        info = inspect(ctx.host, path, REGULAR_FILE)
        if info is None:
            problems.append(f'{path} does not exist')
        elif (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) != (PRIVATE_FILE_MODE, *worker):
            problems.append(f'{path} is {shape(info)}, expected 0600 {worker[0]}:{worker[1]}')
    return missing('; '.join(problems)) if problems else OK


def check_ai_role(ctx: Context) -> Status:
    config = ctx.config()
    if config is None:
        return NEEDS_CONFIG
    project = config['LIWAN_RELEASE_PROJECT']
    query = "select count(*) from pg_roles where rolname='liwan_ai'"
    code, output = ctx.host.run(['docker', 'exec', f'{project}-db-1', 'psql', '-U', DB_SUPERUSER, '-d', 'postgres', '-tAc', query])
    if code != 0 or output.strip() != '1':
        return missing('role liwan_ai does not exist in the tenant database')
    code, output = ctx.host.run(['docker', 'ps', '--filter', 'name=-ai-1', '--format', '{{.Status}}'])
    healthy = code == 0 and 'Up' in output and 'healthy' in output and 'unhealthy' not in output
    return OK if healthy else missing('the ai container is not up and healthy')


def served_commit(ctx: Context, served: Path) -> str | None:
    try:
        record = json.loads(ctx.host.read_text(served))
    except json.JSONDecodeError:
        raise ItemError(f'{served} is not valid JSON') from None
    commit = record.get('commit') if isinstance(record, dict) else None
    return commit if isinstance(commit, str) else None


def current_commit(ctx: Context) -> str | None:
    """The commit named by the release folder that ``current`` links to."""
    info = ctx.host.lstat(ctx.paths.current)
    if info is None or not stat.S_ISLNK(info.st_mode):
        return None
    found = RELEASE_FOLDER.match(Path(ctx.host.readlink(ctx.paths.current)).name)
    return found.group(1) if found else None


def check_release_state(ctx: Context) -> Status:
    if ctx.config() is None:
        return NEEDS_CONFIG
    state = ctx.paths.state_root / ctx.environment
    problems = []
    served = state / 'served.json'
    if inspect(ctx.host, served, REGULAR_FILE) is None:
        problems.append('served.json is absent: no release has been committed')
    elif served_commit(ctx, served) != current_commit(ctx):
        problems.append(f'the served commit is not the one {ctx.paths.current} points to')
    problems += [f'{name} exists' for name in ('run.json', 'halted.json') if ctx.host.lstat(state / name) is not None]
    return missing('; '.join(problems)) if problems else OK


def shared_port(shared: dict, setting: tuple[str, str]) -> str:
    """The port the release command uses: an absent or empty key means the default."""
    return shared.get(setting[0]) or setting[1]


def check_pg_dump(ctx: Context) -> Status:
    config = ctx.config()
    if config is None:
        return NEEDS_CONFIG
    pgpass = config.get('PGPASSFILE')
    if not pgpass:
        return missing('the release config has no PGPASSFILE')
    _, status = shared_values(ctx)
    if not status.ok:
        return status
    port = shared_port(ctx.shared_env(), TENANT_DB_PORT)
    argv = [config['LIWAN_RELEASE_PG_DUMP'], '-h', config['LIWAN_RELEASE_PG_HOST'], '-p', port, '-U', DB_SUPERUSER,
            '--schema-only', '-d', 'postgres']
    code, _ = ctx.host.run(argv, env={'PGPASSFILE': pgpass})
    return OK if code == 0 else missing('pg_dump cannot reach the tenant database over loopback')


def listeners(output: str) -> list[tuple[str, str]]:
    """(address, port) of each line of ``ss -ltn``."""
    found = []
    for line in output.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 4:
            address, _, port = fields[3].rpartition(':')
            found.append((address, port))
    return found


def expected_binds(shared: dict) -> dict[str, str]:
    binds = {shared_port(shared, TENANT_DB_PORT): LOOPBACK, shared_port(shared, CONTROL_DB_PORT): LOOPBACK,
             WORKER_EFFECT_PORT: WORKER_EFFECT_ADDRESS}
    if shared.get('LIWAN_EDGE_BIND'):
        binds.update({shared[key]: shared['LIWAN_EDGE_BIND'] for key in ('LIWAN_EDGE_HTTP_PORT', 'LIWAN_EDGE_HTTPS_PORT')
                      if shared.get(key)})
    return binds


def check_listeners(ctx: Context) -> Status:
    _, status = shared_values(ctx)
    if not status.ok:
        return status
    code, output = ctx.host.run(['ss', '-ltn'])
    if code != 0:
        return missing('ss -ltn failed')
    binds = expected_binds(ctx.shared_env())
    wrong = [f'{address}:{port}' for address, port in listeners(output) if port in binds and address != binds[port]]
    return missing(f'listening beyond the expected address: {", ".join(wrong)}') if wrong else OK


def http_status(output: str) -> str | None:
    """The code of the first status line among the first three lines of ``wget --server-response``."""
    for line in output.splitlines()[:3]:
        found = STATUS_LINE.match(line)
        if found:
            return found.group(1)
    return None


def check_restore_route(ctx: Context) -> Status:
    values, status = shared_values(ctx, 'LIWAN_RESTORE_DOMAIN')
    if values is None:
        return status
    project = ctx.config()['LIWAN_RELEASE_PROJECT']
    proxy = f'{project}-proxy-1'
    argv = ['docker', 'exec', proxy, 'wget', '-qO-', '--server-response', '--header',
            f'Host: rabc.restore.{values[0]}', 'http://127.0.0.1:80/']
    _, output = ctx.host.run(argv)
    if http_status(output) != '404':
        return missing('the closed restore route did not answer 404')
    code, output = ctx.host.run(['docker', 'exec', proxy, 'ss', '-ltn'])
    if code != 0:
        return missing('ss -ltn failed inside the proxy container')
    return missing(f'the proxy container listens on :{RESTORE_PROXY_PORT}') \
        if any(port == RESTORE_PROXY_PORT for _, port in listeners(output)) else OK


def check_host_network(ctx: Context) -> Status:
    code, output = ctx.host.run(['docker', 'ps', '--filter', 'network=host', '--format', '{{.Names}}'])
    if code != 0:
        return missing('docker ps failed')
    others = [name for name in output.split() if HOST_NETWORK_MARKER not in name]
    return missing(f'containers on the host network: {", ".join(others)}') if others else OK


def check_edge_answer(ctx: Context) -> Status:
    values, status = shared_values(ctx, 'LIWAN_PROSPECT_HOST')
    if values is None:
        return status
    argv = ['curl', '-sS', '-o', '/dev/null', '-w', '%{http_code} %{ssl_verify_result}', f'https://{values[0]}/favicon.ico']
    code, output = ctx.host.run(argv)
    return OK if code == 0 and HTTP_OK.match(output.strip()) else missing(f'https://{values[0]} did not answer with valid TLS')


def check_worker_ticks(ctx: Context) -> Status:
    code, output = ctx.host.run(['systemctl', 'is-active', SHARED_WORKER_UNIT])
    if code != 0 or output.strip() != 'active':
        return missing(f'{SHARED_WORKER_UNIT} is not active')
    code, output = ctx.host.run(['journalctl', '-u', SHARED_WORKER_UNIT, '--since', '10 minutes ago'])
    return OK if code == 0 and TICK_MARKER in output else missing(f'no {TICK_MARKER} in the last 10 minutes')


REGISTRY: list[Item] = [
    Item('release-config', check_release_config,
         'write /etc/liwan-release/<environment>.env (A4.4) as root, mode 0600, with the keys of release/README.md "Config"'),
    Item('worker-user', check_worker_user, f'as root: create {WORKER_USER} and fix the docker group (A3.1)', apply_worker_user),
    Item('directories', check_directories, 'create the directories of A3.3 with the stated modes and owners', apply_directories),
    Item('current-checkout', check_checkout,
         f'as root: git clone {REPOSITORY_URL} to {Paths().releases}/<commit> at the bootstrap commit of main '
         f'(release/README.md "Bootstrap"), then run --apply to link {Paths().current}', apply_checkout),
    Item('init-host', check_init_host,
         'write the shared env file (A4.1) and make the checkout (A3.4); then run init-host.sh (A3.2) with --apply',
         apply_init_host),
    *[package_item(*package) for package in PACKAGES],
    Item('disk', check_disk, 'free disk space (A3.5)'),
    Item('memory', size_check(0, MEMORY_KEY, MIN_MEMORY_MIB, 'memory'), 'the host is too small (A3.5)'),
    Item('swap', size_check(1, SWAP_KEY, MIN_SWAP_MIB, 'swap'), 'add the swap file of A3.5 and list it in /etc/fstab'),
    Item('firewall-rules', check_firewall_rules, 'add the three firewall rules of A3.6 as root', apply_firewall_rules),
    Item('firewall-unit', check_firewall_unit, f'install and enable {FIREWALL_UNIT} (A3.6)', apply_firewall_unit),
    Item('read-credential-file', check_credential_file,
         f'as root: create /etc/liwan-release/{CREDENTIAL_FILE} (A5.1), mode 0600, with the read-only tokens'),
    Item('read-credential-access', check_credential_access, 'the read credential must read the repository, pull a release document and must not write (A5.2)'),
    Item('shared-worker-unit', check_worker_unit, f'install and enable {SHARED_WORKER_UNIT} without starting it (A6.1)',
         apply_worker_unit),
    Item('post-run-shared-files', check_shared_file_owners, 'shared.compose.json and shared.env must be 0600, owned by the worker (A8.2a)',
         post_run=True),
    Item('post-run-ai-role', check_ai_role, 'the liwan_ai role and a healthy ai container (A8.2b)', post_run=True),
    Item('post-run-release-state', check_release_state, 'a committed release that is the checkout current points to, with no run and no halt (A8.3)', post_run=True),
    Item('post-run-pg-dump', check_pg_dump, 'the host pg_dump over loopback (A8.3a)', post_run=True),
    Item('post-run-listeners', check_listeners, 'a port listens beyond its expected address (A8.4)', post_run=True),
    Item('post-run-restore-route', check_restore_route, 'the closed restore route must answer 404 and the proxy must not listen on :443 (A8.4a)', post_run=True),
    Item('post-run-host-network', check_host_network, 'only the Openship edge may use the host network (A8.4b)', post_run=True),
    Item('post-run-edge-answer', check_edge_answer, 'the prospect host must answer with valid TLS (A8.5)', post_run=True),
    Item('post-run-worker-ticks', check_worker_ticks, 'the shared worker must be active and ticking (A8.7)', post_run=True),
]


def evaluate(item: Item, ctx: Context) -> tuple[str, bool]:
    """The output line of one item and whether it counts as not done."""
    try:
        status = item.check(ctx)
        if status.ok:
            return f'ok {item.name}', False
        if ctx.apply and item.apply is not None:
            item.apply(ctx)
            status = item.check(ctx)
            if status.ok:
                return f'created {item.name}', False
    except (ItemError, OSError) as error:
        return f'FAILED {item.name}: {error}', True
    except Exception as error:  # the class name only: its message could carry file content
        return f'FAILED {item.name}: unexpected {type(error).__name__}', True
    suffix = f' ({status.detail})' if status.detail else ''
    return f'MISSING {item.name}: {item.missing}{suffix}', True


def parse_args(argv):
    parser = argparse.ArgumentParser(description=(__doc__ or '').split('\n', 1)[0])
    parser.add_argument('--environment', required=True)
    parser.add_argument('--apply', action='store_true', help='create what is missing and may be created (needs root)')
    parser.add_argument('--post-run', action='store_true', help='also run the checks of A8.2a to A8.7')
    return parser.parse_args(argv)


def main(argv=None, out=sys.stdout, host=None, registry=None, paths=None, repo_dir=None) -> int:
    args = parse_args(argv)
    host = host or Host()
    if args.environment not in ENVIRONMENTS:
        out.write(f'bringup: environment must be one of {list(ENVIRONMENTS)}\n')
        return EXIT_USAGE
    if args.apply and host.euid() != ROOT_UID:
        out.write('bringup: --apply needs root\n')
        return EXIT_USAGE
    ctx = Context(host, args.environment, paths or Paths(), args.apply, repo_dir or Path(__file__).resolve().parent)
    items = [item for item in (REGISTRY if registry is None else registry) if args.post_run or not item.post_run]
    incomplete = 0
    for item in items:
        line, bad = evaluate(item, ctx)
        out.write(line + '\n')
        out.flush()  # a later crash must not lose the lines already earned
        incomplete += bad
    out.write('RESULT: bringup ok\n' if not incomplete else f'RESULT: bringup incomplete {incomplete}\n')
    out.flush()
    return 0 if not incomplete else EXIT_INCOMPLETE


if __name__ == '__main__':
    raise SystemExit(main())
