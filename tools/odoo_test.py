# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run the Odoo tests of the changed Nasq addons on a disposable scratch database.

The release modules are installed once into a template database built from the
base branch (keyed by Odoo commit, module list and the base ``odoo-addons``
tree). Each run clones that template, updates only the changed addons and the
addons that depend on them, runs their tests and drops the clone. Only
``nasq_scratch_*`` databases are ever created, cloned or dropped; the dev
``odoo19`` database is never touched. ``npm test`` and CI stay the binding gate.
"""
from __future__ import annotations

import argparse
import ast
import fcntl
import getpass
import hashlib
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ODOO_ROOT = Path(os.environ.get('ODOO_ROOT', '/Users/tariq/code/odoo'))
SCRATCH_DB = re.compile(r'^nasq_scratch_[a-z0-9_]{1,42}$')
RESULT_RE = re.compile(r'(\d+) failed, (\d+) error\(s\) of (\d+) tests')
OWNED_PREFIXES = ('nasq_', 'customer_')


class OdooTestError(Exception):
    """A refused or failed step; the message is shown to the user."""


def require_scratch(name):
    if not SCRATCH_DB.match(name):
        raise OdooTestError('refusing database %r: only nasq_scratch_* names are allowed' % name)
    return name


def changed_addons(paths, known):
    """Addon names under ``odoo-addons/`` touched by ``paths`` that are in ``known``."""
    found = set()
    for path in paths:
        parts = path.split('/')
        if len(parts) > 2 and parts[0] == 'odoo-addons' and parts[1] in known:
            found.add(parts[1])
    return found


def with_dependents(changed, depends):
    """``changed`` plus every addon that depends on it, directly or transitively."""
    result = set(changed)
    grew = True
    while grew:
        grew = False
        for name, deps in depends.items():
            if name not in result and result & set(deps):
                result.add(name)
                grew = True
    return result


def template_name(odoo_commit, modules, addons_tree):
    digest = hashlib.sha256('|'.join([odoo_commit, ','.join(sorted(modules)), addons_tree]).encode()).hexdigest()
    return require_scratch('nasq_scratch_tpl_' + digest[:12])


def parse_result(log_text):
    """``(failed, errors, tests)`` from the last Odoo result line, or ``None``."""
    matches = RESULT_RE.findall(log_text)
    if not matches:
        return None
    failed, errors, tests = matches[-1]
    return int(failed), int(errors), int(tests)


def read_depends(addons_dir, module):
    manifest = Path(addons_dir) / module / '__manifest__.py'
    try:
        value = ast.literal_eval(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError, SyntaxError):
        raise OdooTestError('unreadable manifest for %s' % module) from None
    return [dep for dep in value.get('depends', []) if dep.startswith(OWNED_PREFIXES)]


def run(cmd, **kwargs):
    return subprocess.run(cmd, check=False, text=True, **kwargs)


def git(*args):
    result = run(['git', *args], cwd=REPO, capture_output=True)
    if result.returncode:
        raise OdooTestError('git %s failed: %s' % (' '.join(args), result.stderr.strip()))
    return result.stdout.strip()


def release_modules():
    result = run([sys.executable, '-B', 'tools/catalog_check.py', '--release-modules'], cwd=REPO, capture_output=True)
    if result.returncode:
        raise OdooTestError('catalog_check --release-modules failed: ' + result.stderr.strip())
    return result.stdout.strip().split(',')


def changed_paths(base):
    merge_base = git('merge-base', base, 'HEAD')
    tracked = git('diff', '--name-only', merge_base).splitlines()
    untracked = git('ls-files', '-o', '--exclude-standard').splitlines()
    return tracked + untracked


def free_port():
    for port in range(8170, 8200):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) != 0:
                return port
    message = 'no free HTTP port in 8170-8199'
    raise OdooTestError(message)


class Pg:
    def __init__(self):
        self.env = dict(os.environ)
        self.env.setdefault('PGHOST', '127.0.0.1')
        self.env.setdefault('PGPORT', '5432')
        self.env.setdefault('PGUSER', getpass.getuser())

    def _run(self, cmd):
        result = run(cmd, env=self.env, capture_output=True)
        if result.returncode:
            raise OdooTestError('%s failed: %s' % (cmd[0], result.stderr.strip()))
        return result.stdout.strip()

    def exists(self, name):
        sql = "select 1 from pg_database where datname = '%s'" % require_scratch(name)
        return self._run(['psql', '-d', 'postgres', '-t', '-A', '-c', sql]) == '1'

    def create_from(self, name, template):
        self._run(['createdb', '-T', require_scratch(template), require_scratch(name)])

    def create(self, name):
        self._run(['createdb', require_scratch(name)])

    def rename(self, old, new):
        sql = 'alter database %s rename to %s' % (require_scratch(old), require_scratch(new))
        self._run(['psql', '-d', 'postgres', '-c', sql])

    def drop(self, name):
        run(['dropdb', '--if-exists', require_scratch(name)], env=self.env, capture_output=True)

    def installed(self, name):
        sql = "select name from ir_module_module where state = 'installed'"
        out = self._run(['psql', '-d', require_scratch(name), '-t', '-A', '-c', sql])
        return set(out.split())


def odoo_command(addons_dirs, database, data_dir, logfile, port, extra):
    odoo = str(ODOO_ROOT)
    path = ','.join([odoo + '/odoo/addons', odoo + '/addons'] + [str(d) for d in addons_dirs])
    return [
        odoo + '/.venv/bin/python', odoo + '/odoo-bin',
        '--addons-path=' + path, '-d', database, '--db-filter=^%s$' % database,
        '--data-dir=' + data_dir, '--logfile=' + logfile,
        '--http-port=%d' % port, '--workers=0', '--max-cron-threads=0', '--stop-after-init',
        '--db_host=' + os.environ.get('PGHOST', '127.0.0.1'),
        '--db_port=' + os.environ.get('PGPORT', '5432'),
        '--db_user=' + os.environ.get('PGUSER', getpass.getuser()),
    ] + extra


def classification(database, output):
    require_scratch(database)
    result = run(
        [sys.executable, '-B', 'deploy/classification.py', 'fixture',
         '--database', database, '--mode', 'saas', '--output', str(output)],
        cwd=REPO, capture_output=True,
    )
    if result.returncode:
        raise OdooTestError('classification fixture failed: ' + result.stderr.strip())


def run_odoo(addons_dirs, database, scratch, extra, log_name):
    config = scratch / ('classification-%s.json' % database)
    classification(database, config)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', NASQ_COMMERCIAL_CONFIG=str(config))
    logfile = scratch / log_name
    cmd = odoo_command(addons_dirs, database, str(scratch / 'data'), str(logfile), free_port(), extra)
    result = run(cmd, cwd=str(ODOO_ROOT), env=env, capture_output=True)
    log_text = logfile.read_text(encoding='utf-8', errors='replace') if logfile.exists() else ''
    return result.returncode, log_text, result.stderr


def _check_template(code, log_text, err):
    if code:
        tail = '\n'.join(log_text.splitlines()[-15:]) or err
        message = 'template install failed (rc=%d):\n%s' % (code, tail)
        raise OdooTestError(message)


def build_template(pg, name, modules, base, scratch, log):
    """Install the release modules from the base tree into ``name`` (once, under a lock)."""
    lock_path = Path(tempfile.gettempdir()) / 'nasq-odoo-test-template.lock'
    with open(lock_path, 'w', encoding='utf-8') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if pg.exists(name):
            return
        log('building template %s from %s (one-time, about a minute)' % (name, base))
        export = scratch / 'base-tree'
        export.mkdir()
        archive = subprocess.Popen(['git', 'archive', base, 'odoo-addons'], cwd=REPO, stdout=subprocess.PIPE)
        extract = run(['tar', '-x', '-C', str(export)], stdin=archive.stdout, capture_output=True)
        archive.stdout.close()
        if archive.wait() or extract.returncode:
            raise OdooTestError('git archive of %s failed' % base)
        building = 'nasq_scratch_tplb_' + uuid.uuid4().hex[:10]
        pg.create(building)
        try:
            code, log_text, err = run_odoo(
                [export / 'odoo-addons'], building, scratch, ['-i', ','.join(modules)], 'template.log')
            _check_template(code, log_text, err)
            pg.rename(building, name)
        except BaseException:
            pg.drop(building)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--addons', help='comma list of addons to test (default: changed vs --base)')
    parser.add_argument('--base', default='main', help='base ref for the diff and the template (default: main)')
    parser.add_argument('--no-dependents', action='store_true', help='do not add addons that depend on the changed ones')
    parser.add_argument('--all', action='store_true', help='test every release module')
    parser.add_argument('--dry-run', action='store_true', help='print the plan and exit')
    parser.add_argument('--keep-db', action='store_true', help='keep the run database for inspection')
    args = parser.parse_args(argv)

    def log(message):
        sys.stderr.write('odoo_test: %s\n' % message)

    release = release_modules()
    addons_dir = REPO / 'odoo-addons'
    depends = {m: read_depends(addons_dir, m) for m in release}
    if args.all:
        selected = set(release)
    elif args.addons:
        selected = set(args.addons.split(','))
        unknown = selected - set(release)
        if unknown:
            raise OdooTestError('not release modules: %s' % ', '.join(sorted(unknown)))
    else:
        selected = changed_addons(changed_paths(args.base), set(release))
        if selected and not args.no_dependents:
            selected = with_dependents(selected, depends)
    if not selected:
        log('no release addon changed against %s; nothing to test (use --addons or --all)' % args.base)
        return 0
    odoo_commit = run(['git', '-C', str(ODOO_ROOT), 'rev-parse', 'HEAD'], capture_output=True).stdout.strip()
    tree = git('rev-parse', args.base + ':odoo-addons')
    template = template_name(odoo_commit, release, tree)
    log('addons: %s' % ','.join(sorted(selected)))
    log('template: %s (%s)' % (template, 'exists' if Pg().exists(template) else 'will be built'))
    if args.dry_run:
        return 0

    pg = Pg()
    scratch = Path(tempfile.mkdtemp(prefix='nasq-odoo-test-'))
    (scratch / 'data').mkdir()
    database = require_scratch('nasq_scratch_run_' + uuid.uuid4().hex[:10])
    created = False
    try:
        build_template(pg, template, release, args.base, scratch, log)
        pg.create_from(database, template)
        created = True
        installed = pg.installed(database)
        update = sorted(a for a in selected if a in installed)
        install = sorted(a for a in selected if a not in installed)
        extra = []
        if update:
            extra += ['-u', ','.join(update)]
        if install:
            extra += ['-i', ','.join(install)]
        extra += ['--test-tags', ','.join('/' + a for a in sorted(selected))]
        log('running tests on %s' % database)
        code, log_text, err = run_odoo([addons_dir], database, scratch, extra, 'run.log')
        result = parse_result(log_text)
        if result is None:
            tail = '\n'.join(log_text.splitlines()[-20:]) or err
            raise OdooTestError('no test result line found (rc=%d):\n%s' % (code, tail))
        failed, errors, tests = result
        sys.stdout.write('%d tests, %d failed, %d errors (%s)\n' % (tests, failed, errors, ','.join(sorted(selected))))
        if failed or errors or code:
            for line in log_text.splitlines():
                if ' ERROR ' in line or 'FAIL:' in line or 'ERROR:' in line:
                    sys.stdout.write(line + '\n')
            return 1
        return 0
    finally:
        if created and args.keep_db:
            log('kept database %s' % database)
        else:
            pg.drop(database)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except OdooTestError as exc:
        sys.stderr.write('odoo_test: %s\n' % exc)
        sys.exit(2)
