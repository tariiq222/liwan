# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run the Odoo tests of the changed LiwanOS addons on a disposable scratch database.

The release modules are installed once into a template database built from the
merge-base with the base branch (keyed by Odoo commit, module list, the
``odoo-addons`` tree and the template format). The template's filestore is kept
beside it in the cache directory. Each run clones that template, copies its
filestore, updates only the changed addons and the addons that depend on them,
runs their tests and drops the clone. ``--shards N`` splits the tests of the selected
addons over N clones that run at the same time. Only ``liwan_scratch_*`` databases are
ever created, cloned or dropped; the dev ``odoo19`` database is never touched.
``npm test`` and CI stay the binding gate.
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
import signal
import socket
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import oca_addons
import test_slot

REPO = Path(__file__).resolve().parents[1]
ODOO_ROOT = Path(os.environ.get('ODOO_ROOT', '/Users/tariq/code/odoo'))
SCRATCH_DB = re.compile(r'liwan_scratch_[a-z0-9_]{1,42}')
GC_DB = re.compile(r'liwan_scratch_(tplb|run|tpl)_[a-z0-9_]{1,42}')
RESULT_RE = re.compile(r'(\d+) failed, (\d+) error\(s\) of (\d+) tests')
TEMPLATE_FORMAT = 3
PORTS = range(8170, 8200)
MAX_SHARDS = 4
FAILED_SHARD_LOG = 'last-failure-shard-%d.log'


class OdooTestError(Exception):
    """A refused or failed step; the message is shown to the user."""


def warn(message):
    sys.stderr.write('odoo_test: %s\n' % message)


def require_scratch(name):
    if not SCRATCH_DB.fullmatch(name):
        raise OdooTestError('refusing database %r: only liwan_scratch_* names are allowed' % name)
    return name


def cache_dir():
    root = os.environ.get('LIWAN_ODOO_TEST_CACHE')
    path = Path(root) if root else Path.home() / '.cache' / 'liwan-odoo-test'
    path.mkdir(parents=True, exist_ok=True)
    return path


def filestore_src(cache, template):
    """Where a template's filestore is kept inside the cache."""
    return Path(cache) / require_scratch(template) / 'filestore'


def filestore_dest(data_dir, database):
    """Where Odoo looks for the filestore of ``database`` under ``--data-dir``."""
    return Path(data_dir) / 'filestore' / require_scratch(database)


def copy_filestore(cache, template, data_dir, database):
    """Copy the template's filestore for a clone; returns the number of files copied."""
    src = filestore_src(cache, template)
    if not src.is_dir():
        raise OdooTestError('template %s has no filestore at %s; run --gc and retry' % (template, src))
    dest = filestore_dest(data_dir, database)
    shutil.copytree(src, dest)
    return sum(1 for item in dest.rglob('*') if item.is_file())


def acquire_port(cache, ports=PORTS):
    """Lock a free port (flock on ``port-<n>.lock``); keep the returned file open to hold it."""
    for port in ports:
        handle = (Path(cache) / ('port-%d.lock' % port)).open('w', encoding='utf-8')
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            continue
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                handle.close()
                continue
        return port, handle
    message = 'no free HTTP port in %d-%d' % (ports[0], ports[-1])
    raise OdooTestError(message)


def local_addons(addons_dir):
    """Names of every directory under ``addons_dir`` that holds a ``__manifest__.py``."""
    root = Path(addons_dir)
    return {d.name for d in root.iterdir() if (d / '__manifest__.py').is_file()}


def changed_addons(paths, known):
    """Addon names under ``odoo-addons/`` touched by ``paths`` that are in ``known``."""
    found = set()
    for path in paths:
        parts = path.split('/')
        if len(parts) > 2 and parts[0] == 'odoo-addons' and parts[1] in known:
            found.add(parts[1])
    return found


def unmanifested_dirs(paths, known):
    """Directories under ``odoo-addons/`` touched by ``paths`` that are not addons."""
    found = set()
    for path in paths:
        parts = path.split('/')
        if len(parts) > 2 and parts[0] == 'odoo-addons' and parts[1] not in known:
            found.add(parts[1])
    return found


def with_dependencies(selected, addons_dir, known):
    """``selected`` plus every addon it declares as a dependency, local or not, directly or transitively.

    The template is built from the merge base, so an addon the branch changed may declare a dependency (an OCA addon
    such as ``payroll``) the template never installed. Installing the closure loads it, so the code under test is
    loaded the way the branch declares it. A dependency without a manifest in the local tree has no manifest to
    follow and ends the walk there.
    """
    result = set(selected)
    pending = list(selected)
    while pending:
        module = pending.pop()
        if module in known:
            deps = read_depends(addons_dir, module)
        else:
            deps = []
        for dep in deps:
            if dep not in result:
                result.add(dep)
                pending.append(dep)
    return result


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


def test_weight(addons_dir, addon):
    """Lines of test code under ``addon``'s ``tests/``: a cheap stand-in for how long its tests take."""
    tests = Path(addons_dir) / addon / 'tests'
    if not tests.is_dir():
        return 0
    return sum(len(f.read_text(encoding='utf-8', errors='replace').splitlines()) for f in tests.rglob('*.py'))


def split_shards(weights, count):
    """Split ``weights`` (addon -> test weight) into at most ``count`` balanced groups.

    Greedy longest-first packing, ties broken by name, so the same input always gives the same groups.
    There are never more groups than addons that have tests, so no group is left with nothing to run;
    addons without tests join the lightest group.
    """
    groups = max(1, min(count, sum(1 for w in weights.values() if w > 0)))
    bins = [[0, []] for _ in range(groups)]
    for name in sorted(weights, key=lambda n: (-weights[n], n)):
        lightest = min(bins, key=lambda b: b[0])
        lightest[0] += weights[name]
        lightest[1].append(name)
    return [sorted(members) for _, members in bins]


def check_shard_count(count):
    if not 1 <= count <= MAX_SHARDS:
        raise OdooTestError('--shards must be between 1 and %d, got %d' % (MAX_SHARDS, count))
    return count


def shard_outcome(code, result):
    """``(ok, reason)`` for one shard. The zero-test rule belongs to the whole run, see ``total_verdict``."""
    if result is None:
        return False, 'no test result line found (rc=%d)' % code
    failed, errors, _tests = result
    if failed or errors:
        return False, '%d failed, %d errors' % (failed, errors)
    if code:
        return False, 'odoo exited with rc=%d' % code
    return True, ''


def total_verdict(results):
    """Sum the ``(failed, errors, tests)`` triples of all shards and judge the total like a single run."""
    return verdict(tuple(sum(column) for column in zip(*results)))


def template_name(odoo_commit, modules, addons_tree, oca_pins):
    parts = [odoo_commit, ','.join(sorted(modules)), addons_tree, oca_pins, 'format%d' % TEMPLATE_FORMAT]
    digest = hashlib.sha256('|'.join(parts).encode()).hexdigest()
    return require_scratch('liwan_scratch_tpl_' + digest[:12])


def parse_result(log_text):
    """``(failed, errors, tests)`` from the last Odoo result line, or ``None``."""
    matches = RESULT_RE.findall(log_text)
    if not matches:
        return None
    failed, errors, tests = matches[-1]
    return int(failed), int(errors), int(tests)


def verdict(result):
    """``(ok, reason)`` for a parsed result; a run that executed no test never passes."""
    failed, errors, tests = result
    if tests == 0:
        return False, 'zero tests ran; the selected addons have no tests (a nonzero count is required)'
    if failed or errors:
        return False, '%d failed, %d errors' % (failed, errors)
    return True, ''


def read_depends(addons_dir, module):
    manifest = Path(addons_dir) / module / '__manifest__.py'
    try:
        value = ast.literal_eval(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError, SyntaxError):
        raise OdooTestError('unreadable manifest for %s' % module) from None
    return list(value.get('depends', []))


def local_depends(addons_dir, known):
    """Map each local addon to its dependencies that are themselves local addons."""
    return {m: [d for d in read_depends(addons_dir, m) if d in known] for m in sorted(known)}


def gc_selection(names, current, active):
    """Scratch databases ``--gc`` may drop: build leftovers, runs and stale templates.

    Skips the current template and anything that still has a connection.
    """
    chosen = []
    for name in sorted(names):
        if not GC_DB.fullmatch(name) or name == current or name in active:
            continue
        chosen.append(require_scratch(name))
    return chosen


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


def odoo_commit():
    result = run(['git', '-C', str(ODOO_ROOT), 'rev-parse', 'HEAD'], capture_output=True)
    if result.returncode or not result.stdout.strip():
        raise OdooTestError('cannot read the Odoo commit in %s: %s' % (ODOO_ROOT, result.stderr.strip()))
    return result.stdout.strip()


def oca_dirs():
    """The pinned OCA repositories (``deploy/oca-addons.json``), verified to be fetched at their pins."""
    try:
        pins = oca_addons.load_pins(oca_addons.PINS)
        dest = oca_addons.default_dest()
        oca_addons.verify_all(pins, dest)
    except oca_addons.OcaError as exc:
        raise OdooTestError('%s' % exc) from None
    return [oca_addons.repo_dir(dest, entry['repo']) for entry in pins['repos']]


def changed_paths(merge_base):
    tracked = git('diff', '--name-only', merge_base).splitlines()
    untracked = git('ls-files', '-o', '--exclude-standard').splitlines()
    return tracked + untracked


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

    def _query(self, sql):
        return self._run(['psql', '-d', 'postgres', '-t', '-A', '-c', sql])

    def exists(self, name):
        sql = "select 1 from pg_database where datname = '%s'" % require_scratch(name)
        return self._query(sql) == '1'

    def column_exists(self, name, table, column):
        sql = "select 1 from information_schema.columns where table_name = '%s' and column_name = '%s'" % (table, column)
        out = self._run(['psql', '-d', require_scratch(name), '-t', '-A', '-c', sql])
        return out == '1'

    def execute(self, name, sql):
        self._run(['psql', '-d', require_scratch(name), '-c', sql])

    def create_from(self, name, template):
        self._run(['createdb', '-T', require_scratch(template), require_scratch(name)])

    def create(self, name):
        self._run(['createdb', require_scratch(name)])

    def rename(self, old, new):
        sql = 'alter database %s rename to %s' % (require_scratch(old), require_scratch(new))
        self._run(['psql', '-d', 'postgres', '-c', sql])

    def drop(self, name):
        result = run(['dropdb', '--if-exists', require_scratch(name)], env=self.env, capture_output=True)
        if result.returncode:
            warn('could not drop %s: %s' % (name, result.stderr.strip()))
            return False
        return True

    def installed(self, name):
        sql = "select name from ir_module_module where state = 'installed'"
        out = self._run(['psql', '-d', require_scratch(name), '-t', '-A', '-c', sql])
        return set(out.split())

    def scratch_databases(self):
        return set(self._query(r"select datname from pg_database where datname like 'liwan\_scratch\_%'").split())

    def active_databases(self):
        sql = r"select distinct datname from pg_stat_activity where datname like 'liwan\_scratch\_%'"
        return set(self._query(sql).split())


def odoo_command(addons_dirs, database, config, data_dir, logfile, port, extra):
    odoo = str(ODOO_ROOT)
    path = ','.join([odoo + '/odoo/addons', odoo + '/addons'] + [str(d) for d in addons_dirs])
    return [
        odoo + '/.venv/bin/python', odoo + '/odoo-bin', '-c', str(config),
        '--addons-path=' + path, '-d', database, '--db-filter=^%s$' % database,
        '--data-dir=' + str(data_dir), '--logfile=' + str(logfile),
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


def start_odoo(addons_dirs, database, scratch, data_dir, port, extra, log_name):
    """Start one Odoo process; ``finish_odoo`` waits for it. Its log and stderr go to files in ``scratch``."""
    config = scratch / 'odoo.conf'  # empty, so ~/.odoorc and ODOO_RC cannot leak in
    config.write_text('', encoding='utf-8')
    classification_file = scratch / ('classification-%s.json' % database)
    classification(database, classification_file)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', LIWAN_COMMERCIAL_CONFIG=str(classification_file))
    logfile = scratch / log_name
    cmd = odoo_command(addons_dirs, database, config, data_dir, logfile, port, extra)
    with (scratch / (log_name + '.stderr')).open('w', encoding='utf-8') as errfile:
        proc = subprocess.Popen(cmd, cwd=str(ODOO_ROOT), env=env, stdout=subprocess.DEVNULL, stderr=errfile)
    return proc, logfile


def finish_odoo(proc, logfile):
    """``(returncode, log text, stderr text)`` once the process has exited."""
    code = proc.wait()
    log_text = logfile.read_text(encoding='utf-8', errors='replace') if logfile.exists() else ''
    err_file = logfile.with_name(logfile.name + '.stderr')
    return code, log_text, err_file.read_text(encoding='utf-8', errors='replace')


def run_odoo(addons_dirs, database, scratch, data_dir, port, extra, log_name):
    proc, logfile = start_odoo(addons_dirs, database, scratch, data_dir, port, extra, log_name)
    return finish_odoo(proc, logfile)


def stop_process(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def _check_template(code, log_text, err):
    if code:
        tail = '\n'.join(log_text.splitlines()[-15:]) or err
        message = 'template install failed (rc=%d):\n%s' % (code, tail)
        raise OdooTestError(message)


def build_template(pg, name, modules, merge_base, scratch, cache, port, log):
    """Install the release modules of ``merge_base`` into ``name`` (once, under a lock)."""
    with open(cache / 'template.lock', 'w', encoding='utf-8') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if pg.exists(name):
            if filestore_src(cache, name).is_dir():
                return
            log('template %s has no filestore; rebuilding it' % name)
            pg.drop(name)
        log('building template %s from %s (one-time, about a minute)' % (name, merge_base[:12]))
        export = scratch / 'base-tree'
        export.mkdir()
        archive = subprocess.Popen(['git', 'archive', merge_base, 'odoo-addons'], cwd=REPO, stdout=subprocess.PIPE)
        extract = run(['tar', '-x', '-C', str(export)], stdin=archive.stdout, capture_output=True)
        archive.stdout.close()
        if archive.wait() or extract.returncode:
            raise OdooTestError('git archive of %s failed' % merge_base)
        addons = export / 'odoo-addons'
        present = [m for m in modules if (addons / m / '__manifest__.py').is_file()]
        building = 'liwan_scratch_tplb_' + uuid.uuid4().hex[:10]
        build_dir = Path(tempfile.mkdtemp(prefix='build-', dir=str(cache)))
        pg.create(building)
        renamed = False
        try:
            code, log_text, err = run_odoo(
                [addons, *oca_dirs()], building, scratch, build_dir / 'data', port, ['-i', ','.join(present)], 'template.log')
            _check_template(code, log_text, err)
            # Odoo's upgrade run leaves calendar_default_privacy without a DB default, so settings inserts fail on null.
            if pg.column_exists(building, 'res_users_settings', 'calendar_default_privacy'):
                pg.execute(building, "ALTER TABLE res_users_settings ALTER COLUMN calendar_default_privacy SET DEFAULT 'public'")
                log('set the res_users_settings.calendar_default_privacy default on the template')
            pg.rename(building, name)
            renamed = True
            built = filestore_dest(build_dir / 'data', building)
            target = filestore_src(cache, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            if built.is_dir():
                shutil.move(str(built), str(target))
            else:
                target.mkdir()
        except BaseException:
            pg.drop(name if renamed else building)
            shutil.rmtree(str(filestore_src(cache, name).parent), ignore_errors=True)
            raise
        finally:
            shutil.rmtree(str(build_dir), ignore_errors=True)


def current_template(base, release):
    merge_base = git('merge-base', base, 'HEAD')
    tree = git('rev-parse', merge_base + ':odoo-addons')
    return merge_base, template_name(odoo_commit(), release, tree, oca_addons.pins_digest())


def collect_garbage(pg, cache, current):
    """Drop orphan scratch databases and stale templates that nobody is connected to."""
    dropped = []
    for name in gc_selection(pg.scratch_databases(), current, pg.active_databases()):
        if pg.drop(name):
            if name.startswith('liwan_scratch_tpl_'):
                shutil.rmtree(str(Path(cache) / name), ignore_errors=True)
            sys.stdout.write('dropped %s\n' % name)
            dropped.append(name)
    if not dropped:
        sys.stdout.write('nothing to drop\n')
    return dropped


def _on_sigterm(signum, frame):
    raise KeyboardInterrupt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--addons', help='comma list of addons to test (default: changed vs --base)')
    parser.add_argument('--base', default='main', help='base ref for the diff and the template (default: main)')
    parser.add_argument('--no-dependents', action='store_true', help='do not add addons that depend on the changed ones')
    parser.add_argument('--all', action='store_true', help='test every release module')
    parser.add_argument('--shards', type=int, default=1, metavar='N',
                        help='run the tests on N clones at the same time, 1 to %d (default: 1)' % MAX_SHARDS)
    parser.add_argument('--dry-run', action='store_true', help='print the plan and exit')
    parser.add_argument('--keep-db', action='store_true', help='keep the run databases for inspection')
    parser.add_argument('--gc', action='store_true', help='drop orphan scratch databases and stale templates, then exit')
    args = parser.parse_args(argv)
    check_shard_count(args.shards)

    release = release_modules()
    addons_dir = REPO / 'odoo-addons'
    cache = cache_dir()
    merge_base, template = current_template(args.base, release)
    if args.gc:
        collect_garbage(Pg(), cache, template)
        return 0

    known = local_addons(addons_dir)
    depends = local_depends(addons_dir, known)
    if args.all:
        selected = set(release)
    elif args.addons:
        selected = set(args.addons.split(','))
        unknown = selected - known
        if unknown:
            raise OdooTestError('not local addons: %s' % ', '.join(sorted(unknown)))
    else:
        paths = changed_paths(merge_base)
        for stray in sorted(unmanifested_dirs(paths, known)):
            warn('changed path under odoo-addons/%s/ which has no __manifest__.py; ignored' % stray)
        selected = changed_addons(paths, known)
        if selected and not args.no_dependents:
            selected = with_dependents(selected, depends)
    if not selected:
        warn('no addon changed against %s; nothing to test (use --addons or --all)' % args.base)
        return 0
    pg = Pg()
    weights = {a: test_weight(addons_dir, a) for a in selected}
    groups = split_shards(weights, args.shards)
    warn('addons: %s' % ','.join(sorted(selected)))
    warn('template: %s (%s)' % (template, 'exists' if pg.exists(template) else 'will be built'))
    for index, group in enumerate(groups, 1):
        warn('shard %d/%d: test weight %d: %s' % (index, len(groups), sum(weights[a] for a in group), ','.join(group)))
    if args.dry_run:
        return 0

    signal.signal(signal.SIGTERM, _on_sigterm)
    with test_slot.hold('odoo_test ' + ','.join(sorted(selected))):
        return run_tests(args, pg, cache, template, release, merge_base, addons_dir, known, selected, groups)


class Shard:
    """One clone of the template with its own filestore, port and Odoo process."""

    def __init__(self, index, count, addons, scratch):
        self.index = index
        self.label = 'shard %d/%d' % (index, count)
        self.addons = addons
        self.database = require_scratch('liwan_scratch_run_' + uuid.uuid4().hex[:10])
        self.workdir = scratch / ('shard-%d' % index)
        self.workdir.mkdir()
        (self.workdir / 'data').mkdir()
        self.created = False
        self.port_lock = None
        self.port = None
        self.proc = None
        self.logfile = None


def update_arguments(pg, database, addons_dir, known, selected):
    """``-u`` / ``-i`` arguments for the clone ``database``.

    Only the local addons are updated: re-updating an installed stock or OCA module would reload its data over what
    the LiwanOS addons configured on top of it. A dependency the template lacks is installed.
    """
    installed = pg.installed(database)
    closure = with_dependencies(selected, addons_dir, known)
    update = sorted(a for a in closure if a in installed and a in known)
    install = sorted(a for a in closure if a not in installed)
    extra = []
    if update:
        extra += ['-u', ','.join(update)]
    if install:
        extra += ['-i', ','.join(install)]
    return extra


def report_shards(shards, outcomes, cache):
    """Print one line per shard and a total; ``True`` when every shard passed. A failing shard's log is kept in ``cache``."""
    failing = False
    for shard, (code, log_text, err, result) in zip(shards, outcomes):
        ok, reason = shard_outcome(code, result)
        if result is None:
            sys.stdout.write('%s: no test result line (rc=%d):\n%s\n' % (
                shard.label, code, '\n'.join(log_text.splitlines()[-20:]) or err))
        else:
            failed, errors, tests = result
            sys.stdout.write('%s: %d tests, %d failed, %d errors (%s)\n' % (
                shard.label, tests, failed, errors, ','.join(shard.addons)))
        if ok:
            continue
        failing = True
        kept = Path(cache) / (FAILED_SHARD_LOG % shard.index)
        kept.write_text(log_text, encoding='utf-8')
        sys.stdout.write('FAILED %s: %s; full log: %s\n' % (shard.label, reason, kept))
        for line in log_text.splitlines():
            if ' ERROR ' in line or 'FAIL:' in line or 'ERROR:' in line:
                sys.stdout.write(line + '\n')
    results = [outcome[3] for outcome in outcomes]
    if None in results:
        return False
    failed, errors, tests = (sum(column) for column in zip(*results))
    sys.stdout.write('total: %d tests, %d failed, %d errors in %d shard(s)\n' % (tests, failed, errors, len(shards)))
    total_ok, total_reason = total_verdict(results)
    if not total_ok and not failing:
        sys.stdout.write('FAILED: %s\n' % total_reason)
    return total_ok and not failing


def run_tests(args, pg, cache, template, release, merge_base, addons_dir, known, selected, groups):
    """Clone the template once per shard, update ``selected`` and their closure in every clone, run the tests, drop the clones.

    Every shard updates the full closure and only the tests differ. Odoo upgrades the dependents of each module given
    to ``-u`` (``ir.module.module.button_upgrade``), and a module that runs against the template's older copy of one of
    its dependencies tests the wrong code, so a shard cannot update only its own group. ``--test-tags`` then picks the
    tests: ``/<addon>`` matches by module, among the modules that were updated or installed in that run (at_install
    tests while each module loads, post_install tests of ``registry.updated_modules``), so each selected addon's tests
    run in exactly one shard and in none of the others. The speed-up comes from the tests, which dominate the update.
    """
    scratch = Path(tempfile.mkdtemp(prefix='liwan-odoo-test-'))
    shards = [Shard(index, len(groups), group, scratch) for index, group in enumerate(groups, 1)]
    try:
        port, port_lock = acquire_port(cache)
        try:
            build_template(pg, template, release, merge_base, scratch, cache, port, warn)
        finally:
            port_lock.close()
        for shard in shards:
            shard.port, shard.port_lock = acquire_port(cache)
            pg.create_from(shard.database, template)
            shard.created = True
            copied = copy_filestore(cache, template, shard.workdir / 'data', shard.database)
            warn('%s: filestore copied from template %s (%d files)' % (shard.label, template, copied))
        extra = update_arguments(pg, shards[0].database, addons_dir, known, selected)
        for shard in shards:
            tags = ','.join('/' + a for a in shard.addons)
            warn('%s: running tests on %s (port %d)' % (shard.label, shard.database, shard.port))
            shard.proc, shard.logfile = start_odoo(
                [addons_dir, *oca_dirs()], shard.database, shard.workdir, shard.workdir / 'data', shard.port,
                extra + ['--test-tags', tags], 'run.log')
        outcomes = []
        for shard in shards:
            code, log_text, err = finish_odoo(shard.proc, shard.logfile)
            result = parse_result(log_text)
            outcomes.append((code, log_text, err, result))
        return 0 if report_shards(shards, outcomes, cache) else 1
    finally:
        for shard in shards:
            if shard.proc is not None:
                stop_process(shard.proc)
            if shard.created and args.keep_db:
                warn('kept database %s' % shard.database)
            elif shard.created:
                pg.drop(shard.database)
            if shard.port_lock is not None:
                shard.port_lock.close()
        shutil.rmtree(str(scratch), ignore_errors=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except OdooTestError as exc:
        warn(str(exc))
        sys.exit(2)
