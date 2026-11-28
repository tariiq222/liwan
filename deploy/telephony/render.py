# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Render the telephony package of one company from one environment file.

``compose.yml`` and the ``asterisk/``, ``coturn/``, ``logrotate/`` and ``postgres/`` templates are the package; this
command turns them into the directory Compose runs, with the static schema and test page beside them. Its only
structural variation is a block between
``# @if LIWAN_TELEPHONY_<NAME>`` and ``# @endif`` lines: the block stays when that toggle is on and goes when it is
off. Three toggles are derived here from facts the operator types (``LIWAN_TELEPHONY_TRUNK_AUTH`` and
``LIWAN_TELEPHONY_MODE_B_DEVICES``): the public SIP port exists only for a provider that authenticates by address or
for mode-b devices registering from outside (design 12.3), so it can never be published by omission. The RTP block is
published in every mode and needs no toggle. The fourth, ``LIWAN_TELEPHONY_TURN_PUBLISHED``, is typed exactly ``true``
or ``false``. Blocks do not nest, every block is closed, and every toggle a template uses is known here (``TOGGLES``).

The Asterisk and coturn templates take strict ``{{KEY}}`` placeholders whose key is the env variable without its
``LIWAN_TELEPHONY_`` prefix. A placeholder the env file does not fill, an empty one, and a value that cannot be written
safely into the rendered files are refused before anything reaches the disk, so a broken package is never half on it.
Compose's own ``${VAR:?}`` interpolation is left to Compose, which reads the same env file at run time.

Nothing here prints a value, a derived key or a secret: the output is file names and a final count.

    python3 -B deploy/telephony/render.py --env <env file> --out <directory> [--force]
"""
from __future__ import annotations

import ipaddress
import os
import re
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
PREFIX = 'LIWAN_TELEPHONY_'
TOGGLES = frozenset({
    'LIWAN_TELEPHONY_PUBLIC_SIP',
    'LIWAN_TELEPHONY_TRUNK_IP_AUTH',
    'LIWAN_TELEPHONY_TRUNK_CREDENTIALS',
    'LIWAN_TELEPHONY_TURN_PUBLISHED',
})
TOGGLE_PREFIX = 'LIWAN_TELEPHONY_'
IF_LINE = re.compile(r'^\s*[#;] @if (\S+)\s*$')
ENDIF_LINE = re.compile(r'^\s*[#;] @endif\s*$')
PLACEHOLDER = re.compile(r'\{\{([A-Z0-9_]+)\}\}')
COMPOSE_VARIABLE = re.compile(r'\$\{([A-Za-z_][A-Za-z0-9_]*):\?')
BOOLEANS = {'true': True, 'false': False}
AUTH_METHODS = ('ip', 'credentials')
LINE_STATES = ('available', 'moving')
COMPANY_ID = re.compile(r'^[a-z][a-z0-9-]{1,30}$')
DATABASE_NAME = re.compile(r'^[a-z][a-z0-9_]{0,62}$')
HOSTNAME = re.compile(r'^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$')
ARI_USER = re.compile(r'^[A-Za-z0-9_-]{1,32}$')
CODECS = re.compile(r'^[a-z0-9]+(?:,[a-z0-9]+)*$')
SOUND = re.compile(r'^[A-Za-z0-9_/-]+$')
DIAL_PREFIX = re.compile(r'^[0-9+]*$')
STUN_URL = re.compile(r'^stuns?:[^\s]+$')
TURN_URL = re.compile(r'^turns?:[^\s]+$')
PBX_DB_PASSWORD = re.compile(r'^[A-Za-z0-9._~-]+$')
# Every target file, in write order: the rendered config, then Compose. Paths are relative to the render directory.
TEMPLATES = (
    ('asterisk/modules.conf', 'asterisk/modules.conf.template'),
    ('asterisk/pjsip.conf', 'asterisk/pjsip.conf.template'),
    ('asterisk/extensions.conf', 'asterisk/extensions.conf.template'),
    ('asterisk/http.conf', 'asterisk/http.conf.template'),
    ('asterisk/ari.conf', 'asterisk/ari.conf.template'),
    ('asterisk/rtp.conf', 'asterisk/rtp.conf.template'),
    ('asterisk/logger.conf', 'asterisk/logger.conf.template'),
    ('asterisk/cel.conf', 'asterisk/cel.conf.template'),
    ('asterisk/cel_custom.conf', 'asterisk/cel_custom.conf.template'),
    ('asterisk/sorcery.conf', 'asterisk/sorcery.conf.template'),
    ('asterisk/extconfig.conf', 'asterisk/extconfig.conf.template'),
    ('asterisk/res_pgsql.conf', 'asterisk/res_pgsql.conf.template'),
    ('coturn/turnserver.conf', 'coturn/turnserver.conf.template'),
    ('logrotate/telephony-cel', 'logrotate/telephony-cel.template'),
    ('postgres/02-seed.sql', 'postgres/02-seed.sql.template'),
    ('compose.yml', 'compose.yml'),
)
# Written verbatim: neither file holds any secret or per-company value.
STATIC_FILES = (
    ('postgres/01-schema.sql', 'postgres/01-schema.sql'),
    ('test-page/index.html', 'test-page/index.html'),
)
# Inputs the package documents but no template reads: the shared edge route and the DNS zone are separate parts that
# read the same env file (design 12.3, 12.8), so it is validated here and must not drift.
CONTRACT_INPUTS = ('LIWAN_TELEPHONY_SIP_DNS_NAME',)
MAY_BE_EMPTY = frozenset({'LIWAN_TELEPHONY_TRUNK_DIAL_PREFIX'})
SECRETS = (
    'LIWAN_TELEPHONY_ARI_PASSWORD',
    'LIWAN_TELEPHONY_PBX_DB_PASSWORD',
    'LIWAN_TELEPHONY_EXTENSION_101_PASSWORD',
    'LIWAN_TELEPHONY_EXTENSION_102_PASSWORD',
    'LIWAN_TELEPHONY_EXTENSION_103_PASSWORD',
    'LIWAN_TELEPHONY_TRUNK_PASSWORD',
    'LIWAN_TELEPHONY_TURN_SECRET',
    'LIWAN_TELEPHONY_EVENTS_KEY',
    'LIWAN_TELEPHONY_REVERSE_KEY',
)
DIRECTORY_MODE = 0o700
FILE_MODE = 0o644
EXIT_USAGE = 2
USAGE = ('usage: render.py --env <env file> --out <directory> [--force]\n')


class RenderError(Exception):
    """The env file, a template or the output directory cannot produce the package."""


def unquote(value: str) -> str:
    """One matching pair of surrounding quotes is syntax, as in a Compose env file."""
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'' else value


def read_env(path: Path) -> dict[str, str]:
    """``KEY=VALUE`` lines of the env file, with the same rules as the release command's reader (``deploy/release/common.py``)."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = unquote(value.strip())
    return values


def required(env: dict[str, str], name: str) -> str:
    if not env.get(name):
        raise RenderError(f'{name} is missing from the env file')
    return env[name]


def boolean(env: dict[str, str], name: str) -> bool:
    if name not in env:
        raise RenderError(f'{name} is missing from the env file (true or false)')
    if env[name] not in BOOLEANS:
        raise RenderError(f'{name} must be exactly true or false')
    return BOOLEANS[env[name]]


def toggles_of(env: dict[str, str]) -> dict[str, bool]:
    """The template's toggles: two derived from the line and the devices, one typed, one its complement."""
    method = required(env, 'LIWAN_TELEPHONY_TRUNK_AUTH')
    if method not in AUTH_METHODS:
        raise RenderError(f'LIWAN_TELEPHONY_TRUNK_AUTH must be one of {", ".join(AUTH_METHODS)}')
    mode_b = boolean(env, 'LIWAN_TELEPHONY_MODE_B_DEVICES')
    return {
        'LIWAN_TELEPHONY_PUBLIC_SIP': method == 'ip' or mode_b,
        'LIWAN_TELEPHONY_TRUNK_IP_AUTH': method == 'ip',
        'LIWAN_TELEPHONY_TRUNK_CREDENTIALS': method == 'credentials',
        'LIWAN_TELEPHONY_TURN_PUBLISHED': boolean(env, 'LIWAN_TELEPHONY_TURN_PUBLISHED'),
    }


def render_template(text: str, toggles: dict[str, bool]) -> str:
    """The text with each ``@if`` block kept or dropped by its toggle, marker lines removed; the marker carries the comment
    character of its file, ``#`` in Compose and ``;`` in the Asterisk files (the rule of ``deploy/stack/render.py``)."""
    output: list[str] = []
    open_key: str | None = None
    keep = True
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        start = IF_LINE.match(line)
        if start:
            if open_key is not None:
                raise RenderError(f'line {number}: blocks do not nest ({open_key} is still open)')
            if start.group(1) not in TOGGLES:
                raise RenderError(f'line {number}: unknown toggle {start.group(1)}')
            open_key, keep = start.group(1), toggles[start.group(1)]
        elif ENDIF_LINE.match(line):
            if open_key is None:
                raise RenderError(f'line {number}: # @endif without a block')
            open_key, keep = None, True
        elif keep:
            output.append(line)
    if open_key is not None:
        raise RenderError(f'block {open_key} is never closed')
    return ''.join(output)


def placeholder_values(env: dict[str, str]) -> dict[str, str]:
    """Every ``LIWAN_TELEPHONY_`` value under its short key, so a template writes ``{{ARI_PASSWORD}}``."""
    return {key[len(PREFIX):]: value for key, value in env.items() if key.startswith(PREFIX)}


def required_variables(rendered: dict[str, str]) -> set[str]:
    """Every env name a rendered file needs: its placeholders, Compose's ``${VAR:?}`` names, and the contract inputs."""
    names = set(CONTRACT_INPUTS)
    for text in rendered.values():
        names |= {PREFIX + key for key in PLACEHOLDER.findall(text)}
        names |= set(COMPOSE_VARIABLE.findall(text))
    return names


def check_values(env: dict[str, str]) -> None:
    """Refuse a value that cannot be written into one line of a rendered file, wherever it is used."""
    for name, value in env.items():
        if '\n' in value or '\r' in value:
            raise RenderError(f'{name} must be a single line')
        if ';' in value or '#' in value:
            raise RenderError(f'{name} cannot contain ";" or "#": both start a comment in the rendered files')


def pattern(env: dict[str, str], name: str, regex: re.Pattern[str], meaning: str) -> None:
    if not regex.match(env.get(name, '')):
        raise RenderError(f'{name} must be {meaning}')


def integer(env: dict[str, str], name: str, low: int, high: int) -> int:
    raw = required(env, name)
    if not raw.isdigit() or not low <= int(raw) <= high:
        raise RenderError(f'{name} must be a whole number between {low} and {high}')
    return int(raw)


def optional_integer(env: dict[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name, '')
    if not raw:
        return default
    if not raw.isdigit() or not low <= int(raw) <= high:
        raise RenderError(f'{name} must be a whole number between {low} and {high}')
    return int(raw)


def sql_escape(value: str) -> str:
    """Escape a value for a single-quoted PostgreSQL string literal."""
    return value.replace("'", "''")


def substitute(target: str, text: str, values: dict[str, str]) -> str:
    escape = sql_escape if target.endswith('.sql') else (lambda value: value)
    return PLACEHOLDER.sub(lambda match: escape(values[match.group(1)]), text)


def range_of(env: dict[str, str], first: str, last: str) -> tuple[int, int]:
    low, high = integer(env, first, 1024, 65535), integer(env, last, 1024, 65535)
    if low > high:
        raise RenderError(f'{first} must not be greater than {last}')
    return low, high


def overlaps(first: int, last: int, other_first: int, other_last: int) -> bool:
    return first <= other_last and other_first <= last


def check_ranges(env: dict[str, str]) -> None:
    """The fixed RTP block, the TURN relay block and the listening ports share one address, so none may overlap (12.3)."""
    rtp_start, rtp_end = range_of(env, 'LIWAN_TELEPHONY_RTP_START', 'LIWAN_TELEPHONY_RTP_END')
    turn_start, turn_end = range_of(env, 'LIWAN_TELEPHONY_TURN_MIN_PORT', 'LIWAN_TELEPHONY_TURN_MAX_PORT')
    sip_port = integer(env, 'LIWAN_TELEPHONY_SIP_PORT', 1024, 65535)
    turn_port = integer(env, 'LIWAN_TELEPHONY_TURN_PORT', 1024, 65535)
    if overlaps(rtp_start, rtp_end, turn_start, turn_end):
        raise RenderError(f'LIWAN_TELEPHONY_RTP_START..END ({rtp_start}-{rtp_end}) must not overlap '
                           f'LIWAN_TELEPHONY_TURN_MIN_PORT..MAX_PORT ({turn_start}-{turn_end})')
    for name, port in (('LIWAN_TELEPHONY_SIP_PORT', sip_port), ('LIWAN_TELEPHONY_TURN_PORT', turn_port)):
        if rtp_start <= port <= rtp_end or turn_start <= port <= turn_end:
            raise RenderError(f'{name} must not fall inside the RTP or TURN relay ranges')
    if sip_port == turn_port:
        raise RenderError(f'LIWAN_TELEPHONY_SIP_PORT ({sip_port}) and LIWAN_TELEPHONY_TURN_PORT ({turn_port}) must differ')


def validate(env: dict[str, str], toggles: dict[str, bool]) -> None:
    """Every fact the package writes, checked before a byte is rendered."""
    check_values(env)
    pattern(env, 'LIWAN_TELEPHONY_COMPANY_ID', COMPANY_ID, 'a lowercase tag of 2 to 31 letters, digits or hyphens')
    pattern(env, 'LIWAN_TELEPHONY_DATABASE', DATABASE_NAME,
            'a database name: a letter, then lowercase letters, digits or underscore')
    pattern(env, 'LIWAN_TELEPHONY_HOST_NAME', HOSTNAME, 'a lowercase host name')
    pattern(env, 'LIWAN_TELEPHONY_SIP_DNS_NAME', HOSTNAME, 'a lowercase host name')
    pattern(env, 'LIWAN_TELEPHONY_ARI_USER', ARI_USER, 'letters, digits, "_" or "-" (it names a config section)')
    pattern(env, 'LIWAN_TELEPHONY_TRUNK_CODECS', CODECS, 'lowercase codec names separated by commas')
    pattern(env, 'LIWAN_TELEPHONY_UNAVAILABLE_SOUND', SOUND, 'a sound name or a path without spaces')
    pattern(env, 'LIWAN_TELEPHONY_RECORDING_ANNOUNCE_SOUND', SOUND, 'a sound name or a path without spaces')
    pattern(env, 'LIWAN_TELEPHONY_TRUNK_DIAL_PREFIX', DIAL_PREFIX, 'only digits and "+" (or empty)')
    address = required(env, 'LIWAN_TELEPHONY_STATIC_ADDRESS')
    try:
        ipaddress.IPv4Address(address)
    except ValueError:
        raise RenderError(f'LIWAN_TELEPHONY_STATIC_ADDRESS must be an IPv4 address, not {address!r}') from None
    if required(env, 'LIWAN_TELEPHONY_LINE_STATE') not in LINE_STATES:
        raise RenderError(f'LIWAN_TELEPHONY_LINE_STATE must be one of {", ".join(LINE_STATES)}')
    integer(env, 'LIWAN_TELEPHONY_TRUNK_PORT', 1, 65535)
    integer(env, 'LIWAN_TELEPHONY_RECORDINGS_MIN_FREE_BYTES', 0, 1 << 50)
    integer(env, 'LIWAN_TELEPHONY_RECONCILE_SECONDS', 30, 86400)
    integer(env, 'LIWAN_TELEPHONY_TURN_USER_QUOTA', 1, 64)
    integer(env, 'LIWAN_TELEPHONY_TURN_TOTAL_QUOTA', 1, 10000)
    integer(env, 'LIWAN_TELEPHONY_TURN_MAX_BPS', 0, 1000000000)
    session_seconds = optional_integer(env, 'LIWAN_TELEPHONY_SESSION_SECONDS', 120, 30, 120)
    overlap_seconds = optional_integer(env, 'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS', 30, 0, 60)
    if overlap_seconds >= session_seconds:
        raise RenderError(
            f'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS ({overlap_seconds}) must be less than '
            f'LIWAN_TELEPHONY_SESSION_SECONDS ({session_seconds})',
        )
    if env.get('LIWAN_TELEPHONY_STUN_URL'):
        pattern(env, 'LIWAN_TELEPHONY_STUN_URL', STUN_URL, 'a stun: or stuns: URL without whitespace')
    if env.get('LIWAN_TELEPHONY_TURN_URL'):
        pattern(env, 'LIWAN_TELEPHONY_TURN_URL', TURN_URL, 'a turn: or turns: URL without whitespace')
    check_ranges(env)
    secret_length = len(required(env, 'LIWAN_TELEPHONY_TURN_SECRET'))
    if secret_length < 32:
        raise RenderError(f'LIWAN_TELEPHONY_TURN_SECRET must be at least 32 characters, not {secret_length}')
    if not PBX_DB_PASSWORD.fullmatch(required(env, 'LIWAN_TELEPHONY_PBX_DB_PASSWORD')):
        msg = (
            'LIWAN_TELEPHONY_PBX_DB_PASSWORD must use only URI-safe unreserved characters '
            '(letters, digits, ".", "_", "~", "-")'
        )
        raise RenderError(msg)
    for name in SECRETS:
        if name in env and re.search(r'\s', env[name]):
            raise RenderError(f'{name} must not contain whitespace')
    if toggles['LIWAN_TELEPHONY_TRUNK_CREDENTIALS']:
        required(env, 'LIWAN_TELEPHONY_TRUNK_HOST')
        required(env, 'LIWAN_TELEPHONY_TRUNK_USERNAME')
        required(env, 'LIWAN_TELEPHONY_TRUNK_PASSWORD')
        required(env, 'LIWAN_TELEPHONY_TRUNK_FROM_USER')
    required(env, 'LIWAN_TELEPHONY_TRUNK_CALLER_ID')


def package_files(env: dict[str, str]) -> dict[str, str]:
    """Every rendered file of the package, or a refusal that names the env variable and never its value."""
    toggles = toggles_of(env)
    rendered = {target: render_template((PACKAGE / source).read_text(encoding='utf-8'), toggles)
                for target, source in TEMPLATES}
    missing = sorted(name for name in required_variables(rendered)
                     if name not in env or (not env[name] and name not in MAY_BE_EMPTY))
    if missing:
        raise RenderError(f'the env file lacks {", ".join(missing)}')
    validate(env, toggles)
    values = placeholder_values(env)
    files = {target: substitute(target, text, values) for target, text in rendered.items()}
    for target, source in STATIC_FILES:
        files[target] = (PACKAGE / source).read_text(encoding='utf-8')
    return files


def write_file(path: Path, text: str) -> None:
    """A rendered file at mode 0644 from its first byte, inside a 0700 directory: the container's Asterisk user reads its
    configuration, and no other host user can traverse the directory to reach the secrets it holds."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, FILE_MODE)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        handle.write(text)
    path.chmod(FILE_MODE)


def write_package(out: Path, files: dict[str, str], force: bool) -> list[Path]:
    """Write the package into ``out``; an existing non-empty directory is refused unless ``force`` is set."""
    if out.exists() and not out.is_dir():
        raise RenderError(f'{out} exists and is not a directory')
    if out.is_dir() and any(out.iterdir()) and not force:
        raise RenderError(f'{out} is not empty: pass --force to overwrite the package files')
    if not out.is_dir():
        out.mkdir(parents=True)
    # The directory is the boundary that keeps the rendered secrets from other host users, so it is 0700 whether it was
    # created here or handed over empty.
    out.chmod(DIRECTORY_MODE)
    written = []
    for target, text in files.items():
        path = out / target
        if not path.parent.is_dir():
            path.parent.mkdir(parents=True)
            path.parent.chmod(DIRECTORY_MODE)
        write_file(path, text)
        written.append(path)
    return written


def main(argv: list[str]) -> int:
    env_file = out = None
    force = False
    arguments = iter(argv)
    for argument in arguments:
        if argument == '--force':
            force = True
            continue
        value = next(arguments, None)
        if value is None or argument not in ('--env', '--out'):
            sys.stderr.write(USAGE)
            return EXIT_USAGE
        if argument == '--env':
            env_file = Path(value)
        else:
            out = Path(value)
    if env_file is None or out is None:
        sys.stderr.write(USAGE)
        return EXIT_USAGE
    try:
        files = package_files(read_env(env_file))
    except RenderError as error:
        sys.stderr.write(f'render: {error}\n')
        return 1
    except OSError as error:
        sys.stderr.write(f'render: {error.filename or env_file}: {error.strerror}\n')
        return 1
    try:
        written = write_package(out, files, force)
    except (RenderError, OSError) as error:
        sys.stderr.write(f'render: {error}\n')
        return 1
    for path in written:
        sys.stdout.write(f'render: wrote {path}\n')
    sys.stdout.write(f'render: {len(written)} files written to {out}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
