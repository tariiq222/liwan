# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Execute the complete Woodpecker pipeline with isolated local resources."""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REQUIRED_STAGES = ('static', 'ai-service', 'control-plane', 'vendor-admin', 'odoo',
                   'odoo-tasks-standalone', 'odoo-tasks-bridge', 'upgrade',
                   'restore-drill', 'image', 'e2e-mock', 'rtl-stories')
TOOLS = ('git', 'bash', 'node', 'npm', 'python3', 'ruff', 'semgrep', 'psql',
         'pg_dump', 'pg_restore', 'createdb', 'dropdb', 'curl', 'docker', 'woodpecker-cli')


def fail(message):
    raise RuntimeError(message)


def clean_environment():
    """The local backend inherits its process environment, including API keys."""
    allowed = ('PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL',
               'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR',
               'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR')
    return {**{key: os.environ[key] for key in allowed if key in os.environ},
            'PYTHONDONTWRITEBYTECODE': '1', 'NO_COLOR': '1',
            'WOODPECKER_DISABLE_UPDATE_CHECK': 'true'}


def output(command, *, env):
    return subprocess.check_output(command, env=env, text=True, stderr=subprocess.STDOUT).strip()


def preflight(base, commit, env):
    missing = [tool for tool in TOOLS if not shutil.which(tool, path=env.get('PATH'))]
    if missing:
        fail('missing required tools: ' + ', '.join(missing))
    node_major = Path('.nvmrc').read_text(encoding='utf-8').strip().lstrip('v').split('.')[0]
    if not node_major.isdigit() or output(['node', '--version'], env=env).lstrip('v').split('.')[0] != node_major:
        fail('Node.js major version must match .nvmrc')
    for sha in (base, commit):
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            fail('base and commit must be full commit SHAs')
        output(['git', 'cat-file', '-e', f'{sha}^{{commit}}'], env=env)
    if output(['git', 'rev-parse', 'HEAD'], env=env) != commit:
        fail('candidate HEAD does not match --commit')
    output(['git', 'merge-base', '--is-ancestor', base, commit], env=env)
    if output(['git', 'status', '--porcelain', '--untracked-files=all'], env=env):
        fail('candidate checkout must be clean')
    stages = re.findall(r'^  - name: ([a-z][a-z0-9-]*)\s*$', Path('.woodpecker.yml').read_text(encoding='utf-8'), re.M)
    if tuple(stages) != REQUIRED_STAGES:
        fail('pipeline must contain all twelve required stages in order')
    for path in ('node_modules', 'apps/web/node_modules', 'apps/web/.nuxt',
                 'apps/vendor-admin/node_modules', 'apps/vendor-admin/.nuxt', 'apps/ai-service/.venv'):
        if Path(path).is_symlink():
            fail('shared dependency or generated directory is forbidden: ' + path)
    upstream = Path(os.environ.get('WEBVUE_CI_ODOO_ROOT', '/Users/tariq/code/odoo')).resolve()
    pin = Path('deploy/odoo/ODOO_COMMIT').read_text(encoding='utf-8').strip()
    if output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], env=env) != pin:
        fail('read-only Odoo checkout does not match deploy/odoo/ODOO_COMMIT')
    if output(['git', '-C', str(upstream), 'status', '--porcelain', '--untracked-files=no'], env=env):
        fail('read-only Odoo checkout has tracked modifications')
    python = upstream / '.venv/bin/python3.12'
    if not (upstream / 'odoo-bin').is_file() or not os.access(python, os.X_OK):
        fail('pinned Odoo checkout and Python 3.12 environment are required')
    version = output(['pg_dump', '--version'], env=env)
    match = re.search(r'(?:PostgreSQL\)?\s+)(\d+)', version)
    if not match or int(match[1]) < 16:
        fail('PostgreSQL client tools version 16 or newer are required')
    output(['docker', 'compose', 'version'], env=env)
    return upstream, python


def free_ports(count):
    sockets = [socket.socket() for _ in range(count)]
    try:
        for sock in sockets:
            sock.bind(('127.0.0.1', 0))
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def stage_results(run_dir, run_id, commit):
    results = []
    for name in REQUIRED_STAGES:
        path = run_dir / 'stages' / (name + '.json')
        result = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {'name': name, 'status': 'missing'}
        valid = (result.get('name') == name and result.get('run_id') == run_id
                 and result.get('commit') == commit and type(result.get('exit_code')) is int
                 and result['exit_code'] == 0
                 and result.get('result') in (('checked', 'no_baseline') if name == 'upgrade' else ('checked',)))
        results.append({**result, 'status': 'passed' if valid else 'failed'})
    return results


def execute_pipeline(command, env, log):
    process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT,
                               start_new_session=True)
    try:
        return process.wait()
    except BaseException:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise


def cleanup_resources(prefix, network, env, log):
    # --rm removes successful image containers before this point. A missing
    # container is expected, but an unavailable Docker daemon must fail closed.
    existing = output(['docker', 'ps', '--all', '--format', '{{.Names}}'], env=env).splitlines()
    for name in (prefix + '-image', prefix + '-check', prefix + '-pg'):
        if name in existing:
            subprocess.run(['docker', 'rm', '-fv', name], env=env, stdout=log,
                           stderr=subprocess.STDOUT, check=True)
    networks = output(['docker', 'network', 'ls', '--format', '{{.Name}}'], env=env).splitlines()
    if network in networks:
        subprocess.run(['docker', 'network', 'rm', network], env=env, stdout=log,
                       stderr=subprocess.STDOUT, check=True)


def run(args):
    report_dir = Path(args.report_dir)
    if not report_dir.is_absolute():
        fail('--report-dir must be absolute')
    report_dir.mkdir(parents=True, exist_ok=True)
    if any(os.path.lexists(report_dir / name) for name in ('report.json', 'pipeline.log', 'stages')):
        fail('report directory already contains a CI run')
    report = {'base': args.base, 'commit': args.commit, 'status': 'failed', 'stages': []}
    env = clean_environment()
    run_id = secrets.token_hex(8)
    prefix = 'webvue-ci-' + run_id
    container, network = prefix + '-pg', prefix + '-net'
    owned = False
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='webvue-ci-') as temporary, (report_dir / 'pipeline.log').open('x') as log:
        run_dir = Path(temporary)
        try:
            upstream, python = preflight(args.base, args.commit, env)
            output(['docker', 'info'], env=env)
            owned = True
            output(['docker', 'network', 'create', network], env=env)
            password = secrets.token_hex(16)
            output(['docker', 'run', '--detach', '--name', container, '--network', network,
                    '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_USER=postgres',
                    '-e', 'POSTGRES_PASSWORD=' + password, 'postgres:16'], env=env)
            port_output = output(['docker', 'port', container, '5432/tcp'], env=env)
            port = port_output.rsplit(':', 1)[-1]
            if not port.isdigit():
                fail('Docker did not publish a PostgreSQL loopback port')
            for attempt in range(60):
                ready = subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres'],
                                       env=env, stdout=log, stderr=subprocess.STDOUT, check=False)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                fail('isolated PostgreSQL did not become ready')
            output(['docker', 'exec', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
                    '-c', "CREATE ROLE odoo LOGIN CREATEDB PASSWORD '" + password + "'"], env=env)
            output(['psql', '-h', '127.0.0.1', '-p', port, '-U', 'odoo', '-d', 'postgres',
                    '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1'], env={**env, 'PGPASSWORD': password})
            ports = free_ports(7)
            (run_dir / 'odoo.conf').write_text('[options]\n')
            values = {'PGHOST': '127.0.0.1', 'PGPORT': port, 'PGUSER': 'odoo', 'PGPASSWORD': password,
                      'ODOO_ROOT': str(upstream), 'ODOO_PYTHON': str(python),
                      'ODOO_RC': str(run_dir / 'odoo.conf'),
                      'WEBVUE_CI_RUN_ID': run_id, 'WEBVUE_CI_COMMIT': args.commit,
                      'WEBVUE_CI_NETWORK': network, 'WEBVUE_CI_PG_CONTAINER': container,
                      'WEBVUE_CI_IMAGE': 'webvue-odoo:' + run_id,
                      'WEBVUE_CI_IMAGE_CONTAINER': prefix + '-image',
                      'WEBVUE_CI_CHECK_CONTAINER': prefix + '-check',
                      'DOCKER_CONFIG': env.get('DOCKER_CONFIG', str(Path(env['HOME']) / '.docker')),
                      **dict(zip(('ODOO_PORT', 'TASKS_PORT', 'BRIDGE_PORT', 'MOCK_PORT',
                                  'AI_MOCK_PORT', 'WEB_PORT', 'STORYBOOK_RTL_PORT'), map(str, ports)))}
            (run_dir / 'stages').mkdir()
            (run_dir / 'config.json').write_text(json.dumps({'run_id': run_id, 'commit': args.commit}))
            config = run_dir / 'environment.sh'
            config.write_text(''.join('export ' + key + '=' + shlex.quote(value) + '\n' for key, value in values.items()))
            config.chmod(0o600)
            # Woodpecker 3.19 accepts --repo but its metadata builder reads the
            # removed repo-name flag. The supported metadata file supplies it.
            metadata = run_dir / 'metadata.json'
            metadata.write_text(json.dumps({'repo': {'owner': 'tariiq222', 'name': 'webvue', 'branch': 'main'}}))
            command = ['woodpecker-cli', '--disable-update-check', 'exec', '--local', '--backend-engine', 'local',
                       '--timeout', '4h', '--metadata-file', str(metadata),
                       '--repo', 'tariiq222/webvue', '--pipeline-event', 'manual',
                       '--commit-branch', 'main', '--commit-ref', 'refs/heads/main',
                       '--commit-sha', args.commit, '--prev-commit-sha', args.base,
                       '--pipeline-number', str(time.time_ns() // 1000000),
                       '--env', 'WEBVUE_CI_RUN_DIR=' + str(run_dir), '.woodpecker.yml']
            sys.stdout.write('Running all twelve Woodpecker stages; log: ' + str(report_dir / 'pipeline.log') + '\n')
            sys.stdout.flush()
            report['pipeline_exit_code'] = execute_pipeline(command, env, log)
            report['stages'] = stage_results(run_dir, run_id, args.commit)
            if report['pipeline_exit_code'] or any(stage['status'] != 'passed' for stage in report['stages']):
                fail('pipeline failed or a required stage did not complete successfully')
            if output(['git', 'rev-parse', 'HEAD'], env=env) != args.commit or output(
                    ['git', 'status', '--porcelain', '--untracked-files=all'], env=env):
                fail('candidate checkout changed during verification')
            report['status'] = 'passed'
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError, KeyboardInterrupt) as error:
            report['error'] = str(error) or 'interrupted'
            sys.stderr.write('local_ci: ' + report['error'] + '\n')
        finally:
            if (run_dir / 'stages').exists():
                shutil.copytree(run_dir / 'stages', report_dir / 'stages')
            if owned:
                try:
                    cleanup_resources(prefix, network, env, log)
                except (OSError, subprocess.SubprocessError):
                    report['status'] = 'failed'
                    report['error'] = 'isolated Docker resource cleanup failed; inspect pipeline.log'
            report['elapsed_seconds'] = round(time.monotonic() - started, 3)
            with (report_dir / 'report.json').open('x') as receipt:
                receipt.write(json.dumps(report, indent=2) + '\n')
    return 0 if report['status'] == 'passed' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--report-dir', required=True)
    args = parser.parse_args()

    def interrupted(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        return run(args)
    except (OSError, RuntimeError) as error:
        sys.stderr.write('local_ci: ' + str(error) + '\n')
        return 1


if __name__ == '__main__':
    sys.exit(main())
