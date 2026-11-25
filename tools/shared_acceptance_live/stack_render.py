# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Render the one stack (deploy/stack/compose.yml) for an acceptance harness.

A harness runs the same stack as every environment: `deploy/environments/local.env.example` plus the harness's own
values (ports, subnets, image tag, domain, secrets), nothing stacked on top of the compose file. The harness writes its
values to `<run dir>/harness.env`; this module renders the compose file, `sizing.env` and the Odoo config beside it, and
`compose_command` is the one way to run compose against them.

    python3 -B tools/shared_acceptance_live/stack_render.py render <run dir>
    python3 -B tools/shared_acceptance_live/stack_render.py command <run dir> <project>   # NUL-separated argv

The Odoo config (`odoo.conf`) holds secrets: it is written 0400 and the caller sets its owner.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from deploy.stack import render  # noqa: E402  (needs the repository root on the path)

LOCAL_ENV = ROOT / 'deploy/environments/local.env.example'
SUBNETS = Path(__file__).resolve().parent / 'subnets.yml'
HARNESS_ENV = 'harness.env'
COMPOSE_FILE = 'compose.yml'
SIZING_FILE = render.SIZING_FILE
ODOO_CONF = 'odoo.conf'
PBKDF2_ROUNDS = 600000


def odoo_admin_hash(password: str) -> str:
    """Odoo's master-password hash (`$pbkdf2-sha512$rounds$salt$checksum`, passlib's adapted base64)."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha512', password.encode(), salt, PBKDF2_ROUNDS)

    def adapted(raw: bytes) -> str:
        return base64.b64encode(raw).decode().rstrip('=').replace('+', '.')

    return f'$pbkdf2-sha512${PBKDF2_ROUNDS}${adapted(salt)}${adapted(digest)}'


def unquoted(value: str) -> str:
    """The value of an env file line as compose reads it: one pair of surrounding single quotes is dropped."""
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] == "'" else value


def compose_command(run_dir: Path, project: str, *extra_files: Path) -> list[str]:
    """`docker compose` on the rendered stack: the stack's own directory as project directory, env files in order.

    Later `--env-file` wins: local defaults, then the harness values, then the sizing plan. Extra files are
    add-only (harness-only services and network pins) and never redefine a stack service.
    """
    run_dir = Path(run_dir)
    command = ['docker', 'compose', '--project-directory', str(ROOT / 'deploy'), '-p', project,
               '--env-file', str(LOCAL_ENV), '--env-file', str(run_dir / HARNESS_ENV),
               '--env-file', str(run_dir / SIZING_FILE), '-f', str(run_dir / COMPOSE_FILE), '-f', str(SUBNETS)]
    for path in extra_files:
        command += ['-f', str(path)]
    return command


def render_run(run_dir: Path) -> dict[str, Path]:
    """Write the compose file, `sizing.env` and `odoo.conf` of `<run dir>/harness.env` on top of the local env file."""
    run_dir = Path(run_dir)
    env = {name: unquoted(value) for name, value in render.read_env(LOCAL_ENV, run_dir / HARNESS_ENV).items()}
    compose_text = render.render_stack(env)
    sizing_text = ''.join(f'{name}={value}\n' for name, value in render.sizing_variables(env).items())
    odoo_text = render.odoo_conf(env)
    paths = {name: run_dir / name for name in (COMPOSE_FILE, SIZING_FILE, ODOO_CONF)}
    paths[COMPOSE_FILE].write_text(compose_text, encoding='utf-8')
    paths[SIZING_FILE].write_text(sizing_text, encoding='utf-8')
    paths[ODOO_CONF].unlink(missing_ok=True)
    descriptor = os.open(paths[ODOO_CONF], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(odoo_text)
    os.chmod(paths[ODOO_CONF], 0o400)
    return paths


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 2 and argv[0] == 'render':
            render_run(Path(argv[1]))
        elif len(argv) == 3 and argv[0] == 'command':
            sys.stdout.write(''.join(f'{part}\0' for part in compose_command(Path(argv[1]), argv[2])))
        else:
            sys.stderr.write('usage: stack_render.py render <run dir> | command <run dir> <project>\n')
            return 2
    except (render.StackError, OSError) as error:
        sys.stderr.write(f'stack_render: {error}\n')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
