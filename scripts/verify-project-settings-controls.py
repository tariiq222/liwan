# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Guarded scratch-only verification for project-settings-controls.

Database names must fully match ``liwan_psc_[a-z0-9_]+``. Comma-separated or
arbitrary names are rejected so a value cannot target ``odoo19``. Addons path
and worktree are constructed internally. Modes are explicit.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ALLOWED_DB = re.compile(r'^liwan_psc_scratch_[a-z0-9_]+$')
FORBIDDEN_DBS = {'odoo19', 'liwan_psc_test_20260906'}
FORBIDDEN_PORTS = {80, 443, 3000, 5432, 8069, 8072, 9589, 3589}
DEFAULT_TIMEOUT = 180
XMLRPC_TIMEOUT = 60
DIGEST_NOW = datetime(2099, 6, 15, 10, 0, 0)
DEPLOY_DIR = Path(__file__).resolve().parents[1] / 'deploy'
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))
import check_isolated  # noqa: E402

MODES = ('race', 'upgrade', 'guard', 'e2e-fixtures')

LEGACY_SEED = r'''
import json
from datetime import datetime, timedelta
from odoo.tests import new_test_user
company = env.company
mgr = new_test_user(env, login='lg_mgr', password='lg_mgr_pass_12345', name='LegacyMgr', groups='liwan_core.group_employee,project.group_project_manager')
emp = new_test_user(env, login='lg_emp', password='lg_emp_pass_12345', name='LegacyEmp', groups='liwan_core.group_employee')
P = env['project.project']; T = env['project.task']
p_nodates = P.with_user(mgr)._liwan_create_from_policy('Legacy no dates')
p_startonly = P.create({'name': 'Legacy start only', 'user_id': mgr.id, 'date_start': '2026-01-01'})
p_nomgr = P.create({'name': 'Legacy no manager', 'user_id': False})
p_both = P.create({'name': 'Legacy both', 'user_id': mgr.id, 'date_start': '2026-01-01', 'date': '2026-12-31'})
t_open = T.create({'name': 'open', 'project_id': p_nodates.id, 'user_ids': [(4, emp.id)], 'date_deadline': datetime.now() - timedelta(days=2)})
t_done = T.create({'name': 'done', 'project_id': p_nodates.id, 'user_ids': [(4, emp.id)], 'state': '1_done'})
t_cancel = T.create({'name': 'cancelled', 'project_id': p_both.id, 'state': '1_canceled'})
t_arch = T.create({'name': 'archived', 'project_id': p_both.id}); t_arch.write({'active': False})
env['liwan.pmo.settings'].set_values({'project_creators': 'employees', 'default_stages': [{'name': 'قديم', 'fold': False}, {'name': 'منجز', 'fold': True}]})
cron = env.ref('liwan_pmo.ir_cron_liwan_deadline_notifications')
snap = {
  'projects': {str(p.id): {'name': p.name, 'user_id': p.user_id.id, 'date_start': str(p.date_start or ''), 'date': str(p.date or ''), 'active': p.active, 'stage_ids': p.type_ids.ids} for p in (p_nodates, p_startonly, p_nomgr, p_both)},
  'tasks': {str(t.id): {'name': t.name, 'state': t.state, 'active': t.active, 'project_id': t.project_id.id} for t in (t_open, t_done, t_cancel, t_arch)},
  'settings': env['liwan.pmo.settings'].get(),
  'cron': {'id': cron.id, 'active': cron.active, 'interval': [cron.interval_number, cron.interval_type], 'code': cron.code},
  'counts': {'projects': P.sudo().with_context(active_test=False).search_count([]), 'tasks': T.sudo().with_context(active_test=False).search_count([]), 'params': env['ir.config_parameter'].sudo().search_count([('key','like','liwan_pmo.%')])},
  'users': {'mgr': mgr.id, 'emp': emp.id},
}
env.cr.commit()
print('SEED ' + json.dumps(snap))
'''

LEGACY_VERIFY = r'''
import json, os
exp = json.load(open(os.environ['PSC_EXPECTED']))
P = env['project.project'].sudo().with_context(active_test=False); T = env['project.task'].sudo().with_context(active_test=False)
fails = []
for pid, e in exp['projects'].items():
    p = P.browse(int(pid))
    got = {'name': p.name, 'user_id': p.user_id.id, 'date_start': str(p.date_start or ''), 'date': str(p.date or ''), 'active': p.active, 'stage_ids': p.type_ids.ids}
    if got != e: fails.append(('project', pid, e, got))
    if p.liwan_completion_approval != 'none' or p.liwan_completion_approver_id: fails.append(('project approval not none', pid))
for tid, e in exp['tasks'].items():
    t = T.browse(int(tid))
    got = {'name': t.name, 'state': t.state, 'active': t.active, 'project_id': t.project_id.id}
    if got != e: fails.append(('task', tid, e, got))
    if t.liwan_completion_pending or t.liwan_completion_revision: fails.append(('task meta dirty', tid))
s = env['liwan.pmo.settings'].get()
if {k: s[k] for k in ('project_creators', 'default_stages')} != {k: exp['settings'][k] for k in ('project_creators', 'default_stages')}:
    fails.append(('settings', s))
new_defaults = {k: s[k] for k in ('require_manager_on_create','require_end_date_on_create','default_completion_approval','deadline_reminders_enabled','deadline_reminders_days_before','overdue_digest_enabled')}
if new_defaults != {'require_manager_on_create': True, 'require_end_date_on_create': True, 'default_completion_approval': 'none', 'deadline_reminders_enabled': True, 'deadline_reminders_days_before': 1, 'overdue_digest_enabled': True}: fails.append(('new defaults', new_defaults))
cron = env.ref('liwan_pmo.ir_cron_liwan_deadline_notifications')
if (cron.id, cron.active, [cron.interval_number, cron.interval_type], cron.code) != (exp['cron']['id'], exp['cron']['active'], exp['cron']['interval'], exp['cron']['code']): fails.append(('cron', cron.read(['active','interval_number','interval_type','code'])))
counts = {'projects': P.search_count([]), 'tasks': T.search_count([]), 'params': env['ir.config_parameter'].sudo().search_count([('key','like','liwan_pmo.%')])}
if counts['projects'] != exp['counts']['projects'] or counts['tasks'] != exp['counts']['tasks']: fails.append(('counts', exp['counts'], counts))
mgr = env['res.users'].browse(exp['users']['mgr'])
for pid, e in exp['projects'].items():
    p = env['project.project'].with_user(mgr).browse(int(pid))
    if not p.user_id or p.user_id.id != mgr.id: continue
    try:
        with env.cr.savepoint():
            p._liwan_write_as_manager({'name': p.name + ' edited'}); p._liwan_write_as_manager({'date': '2032-01-01'}); p.invalidate_recordset()
            if str(p.date) != '2032-01-01': fails.append(('legacy date edit not persisted', pid, str(p.date), str(p.date_start)))
            raise Exception('rollback-probe')
    except Exception as ex:
        if str(ex) != 'rollback-probe': fails.append(('legacy edit raised', pid, type(ex).__name__, str(ex)[:80]))
print('VERIFY_RESULT', 'OK' if not fails else 'FAIL', json.dumps(fails, default=str)[:1500])
'''


def _fail(message: str) -> int:
    sys.stderr.write(message + '\n')
    return 1


def _run(argv: list[str], cwd: Path | None = None, timeout: int = DEFAULT_TIMEOUT) -> int:
    sys.stderr.write('+ ' + ' '.join(argv) + '\n')
    try:
        completed = subprocess.run(argv, cwd=cwd, check=False, timeout=timeout)
    except subprocess.TimeoutExpired:
        sys.stderr.write(f'timed out after {timeout}s\n')
        return 124
    return completed.returncode


def _guard_database(database: str) -> str | None:
    if ',' in database or not ALLOWED_DB.fullmatch(database):
        return f'database {database!r} does not fully match liwan_psc_scratch_[a-z0-9_]+'
    if database in FORBIDDEN_DBS or 'odoo19' in database:
        return f'refusing database {database!r}'
    return None


def _guard_worktree(worktree: Path, addons_path: Path) -> str | None:
    resolved = worktree.resolve()
    addons = addons_path.resolve()
    if not resolved.is_dir():
        return f'worktree {resolved} is not an existing directory'
    if addons != (resolved / 'odoo-addons').resolve():
        return 'addons path must be <worktree>/odoo-addons'
    if not (addons / 'liwan_pmo' / '__manifest__.py').is_file():
        return 'worktree is missing liwan_pmo'
    return None


def _guard_port(port: int) -> str | None:
    if port in FORBIDDEN_PORTS:
        return f'http port {port} is reserved for other runtimes'
    if port < 1024:
        return f'http port {port} is not a scratch port'
    return None


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def _foreign_db_sessions(database: str) -> list[tuple[int, str, str]]:
    completed = subprocess.run(
        [
            'psql', '-d', 'postgres', '-At', '-F', '\t', '-c',
            (
                "SELECT pid, COALESCE(application_name, ''), COALESCE(state, '') "
                f"FROM pg_stat_activity WHERE datname = '{database}' AND pid <> pg_backend_pid()"
            ),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode:
        message = completed.stderr.strip() or 'psql pg_stat_activity failed'
        raise RuntimeError(message)
    rows = []
    for line in completed.stdout.splitlines():
        if not line.strip():
            continue
        pid, name, state = line.split('\t', 2)
        rows.append((int(pid), name, state))
    return rows


def _runtime_cmd(ctx: dict, database: str, port: int) -> list[str]:
    return check_isolated.build_runtime_argv(
        python=ctx['python'],
        odoo_bin=ctx['odoo_bin'],
        odoo_conf=ctx['odoo_conf'],
        stock_addons=ctx['stock_addons'],
        worktree_addons=ctx['addons_path'],
        scratch_db=database,
        scratch_lifecycle=ctx['scratch_lifecycle'],
        http_port=port,
    )


def _shell_cmd_for(ctx: dict, database: str, worktree_addons: str) -> list[str]:
    return check_isolated.build_shell_argv(
        python=ctx['python'],
        odoo_bin=ctx['odoo_bin'],
        odoo_conf=ctx['odoo_conf'],
        stock_addons=ctx['stock_addons'],
        worktree_addons=worktree_addons,
        scratch_db=database,
        scratch_lifecycle=ctx['scratch_lifecycle'],
    )


KW_RUNNER = (
    'import json, os\n'
    'from odoo.service.model import call_kw\n'
    'model, method, args, kwargs = json.loads(os.environ["LIWAN_KW"])\n'
    'result = call_kw(env(user=env.ref("base.user_admin").id)[model], method, args, kwargs)\n'
    'env.cr.commit()\n'
    'print("KW_RESULT=" + json.dumps(result, default=str))\n'
)


class ShellModels:
    """Admin ORM calls through ``odoo shell``: Odoo's generic RPC endpoints are closed."""

    def __init__(self, ctx: dict, database: str):
        self.cmd = _shell_cmd_for(ctx, database, ctx['addons_path'])
        self.cwd = str(Path(ctx['odoo_bin']).resolve().parent)

    def call(self, model: str, method: str, args: list, kwargs: dict | None = None):
        env = {**os.environ, 'LIWAN_KW': json.dumps([model, method, args, kwargs or {}])}
        ran = subprocess.run(self.cmd, cwd=self.cwd, input=KW_RUNNER, env=env, check=False,
                             timeout=120, capture_output=True, text=True)
        line = next((row for row in (ran.stdout or '').splitlines() if row.startswith('KW_RESULT=')), None)
        if ran.returncode or line is None:
            message = f'{model}.{method} failed: {(ran.stderr or ran.stdout or "")[-500:]}'
            raise RuntimeError(message)
        return json.loads(line.removeprefix('KW_RESULT='))


def _shell_models(ctx: dict, database: str):
    models = ShellModels(ctx, database)
    return models.call('res.users', 'search', [[['login', '=', 'admin']]], {'limit': 1})[0], models


def _kw(models, model, method, args, kwargs=None):
    return models.call(model, method, args, kwargs)


class JsonSession:
    def __init__(self, url: str, database: str, login: str, password: str):
        self.url = url
        self.database = database
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
        )
        status, body = self.call('POST', '/web/session/authenticate', {
            'jsonrpc': '2.0',
            'method': 'call',
            'params': {'db': database, 'login': login, 'password': password},
        })
        result = body.get('result') or {}
        if status >= 400 or not result.get('uid'):
            message = f'session authenticate failed: {status} {body}'
            raise RuntimeError(message)
        session_db = result.get('db')
        if session_db and session_db != database:
            message = f'http port is serving {session_db!r}, not {database!r}'
            raise RuntimeError(message)

    def call(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode()
        headers = {'Content-Type': 'application/json'} if data is not None else {}
        request = urllib.request.Request(
            self.url + path,
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read()
                return response.status, json.loads(raw.decode()) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                parsed = json.loads(raw.decode()) if raw else {}
            except json.JSONDecodeError:
                parsed = {'message': raw.decode(errors='replace')[:200]}
            return error.code, parsed


def _wait_http(url: str, database: str, timeout: int = 90) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            JsonSession(url, database, 'admin', 'admin')
            return True
        except (OSError, urllib.error.URLError, RuntimeError, json.JSONDecodeError):
            time.sleep(0.4)
    return False


def _require_pending(models, task_id: int) -> str | None:
    row = _kw(models, 'project.task', 'read', [[task_id], [
        'liwan_completion_pending', 'liwan_completion_revision', 'state',
    ]])[0]
    if not row['liwan_completion_pending'] or row['state'] in ('1_done', '1_canceled'):
        return f'task {task_id} is not pending: {row!r}'
    return None


def _join_threads(threads: list[threading.Thread]) -> str | None:
    for thread in threads:
        thread.join(XMLRPC_TIMEOUT)
        if thread.is_alive():
            return f'thread {thread.name} did not finish'
    return None


def _start_owned_http(ctx: dict, database: str, port: int, run_dir: Path) -> subprocess.Popen | str:
    if _port_in_use(port):
        return f'port {port} is already in use'
    foreign = _foreign_db_sessions(database)
    if foreign:
        return f'database {database} has foreign sessions {foreign!r}'
    log = run_dir / 'odoo-http.log'
    argv = _runtime_cmd(ctx, database, port) + [f'--logfile={log}']
    server = subprocess.Popen(
        argv,
        cwd=str(Path(ctx['odoo_bin']).resolve().parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f'http://127.0.0.1:{port}'
    if not _wait_http(url, database, 90):
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        return f'owned http on {port} did not authenticate against {database}'
    return server


def _stop(server: subprocess.Popen) -> None:
    server.terminate()
    try:
        server.wait(timeout=20)
    except subprocess.TimeoutExpired:
        server.kill()


def _race(ctx: dict, database: str, port: int, run_dir: Path) -> int:
    url = f'http://127.0.0.1:{port}'
    started = _start_owned_http(ctx, database, port, run_dir)
    if isinstance(started, str):
        return _fail(started)
    server = started
    try:
        uid, models = _shell_models(ctx, database)
        password = 'admin'
        company = _kw(models, 'res.company', 'search', [[]], {'limit': 1})[0]
        admin_id = uid
        api = JsonSession(url, database, 'admin', password)
        project = _kw(models, 'project.project', 'create', [{
            'name': f'Race project {run_dir.name}', 'user_id': admin_id,
            'liwan_completion_approval': 'project_manager',
            'date': '2035-12-31', 'company_id': company,
        }])

        def new_pending(name: str) -> tuple[int, int] | str:
            patch = api.call('PATCH', f'/api/v1/projects/{project}', {
                'liwan_completion_approval': 'project_manager', 'user_id': admin_id,
            })
            if patch[0] >= 400:
                return f'reset policy failed: {patch}'
            task_id = _kw(models, 'project.task', 'create', [{
                'name': name, 'project_id': project, 'user_ids': [(4, admin_id)],
            }])
            status, body = api.call('POST', f'/api/v1/tasks/{task_id}/completion/request', {})
            if status >= 400:
                return f'request failed for {name}: {status} {body}'
            err = _require_pending(models, task_id)
            if err:
                return err
            revision = body.get('completion_revision') or _kw(models, 'project.task', 'read',
                [[task_id], ['liwan_completion_revision']],
            )[0]['liwan_completion_revision']
            return task_id, int(revision)

        created = new_pending('Race accept')
        if isinstance(created, str):
            return _fail(created)
        task, revision = created
        results: list[tuple[str, str]] = []
        barrier = threading.Barrier(2, timeout=15)

        def accept_worker(label: str, task_id: int, rev: int, bucket: list[tuple[str, str]]):
            session = JsonSession(url, database, 'admin', password)
            barrier.wait()
            code, body = session.call('POST', f'/api/v1/tasks/{task_id}/completion/accept', {'revision': rev})
            if code >= 500:
                bucket.append((label, f'server-{code}:{body}'))
                return
            bucket.append((label, 'ok' if code < 400 else f'{code}:{body}'))

        t1 = threading.Thread(target=accept_worker, args=('a', task, revision, results), name='accept-a')
        t2 = threading.Thread(target=accept_worker, args=('b', task, revision, results), name='accept-b')
        t1.start()
        t2.start()
        hung = _join_threads([t1, t2])
        if hung:
            return _fail(hung)
        if len(results) != 2:
            return _fail(f'accept workers incomplete: {results!r}')
        if any(row[1].startswith('server-') for row in results):
            return _fail(f'accept worker 5xx: {results!r}')
        oks = [row for row in results if row[1] == 'ok']
        fails = [row for row in results if row[1] != 'ok']
        if len(oks) != 1 or len(fails) != 1:
            return _fail(f'competing accept expected 1 ok + 1 domain rejection, got {results!r}')
        if not any(token in fails[0][1] for token in ('422', '403', 'invalid')):
            return _fail(f'losing accept was not a domain rejection: {fails[0]!r}')
        state = _kw(models, 'project.task', 'read', [[task], ['state', 'liwan_completion_pending']])[0]
        if state['state'] != '1_done' or state['liwan_completion_pending']:
            return _fail(f'final accept state unexpected: {state!r}')

        created = new_pending('Race policy')
        if isinstance(created, str):
            return _fail(created)
        task2, rev2 = created
        policy_results: list[str] = []
        barrier2 = threading.Barrier(2, timeout=15)

        def policy_worker():
            barrier2.wait()
            code, body = api.call('PATCH', f'/api/v1/projects/{project}', {'liwan_completion_approval': 'none'})
            if code >= 500:
                policy_results.append(f'policy-server-{code}')
                return
            policy_results.append('policy-ok' if code < 400 else f'policy-{code}:{body}')

        def accept_during_policy():
            session = JsonSession(url, database, 'admin', password)
            barrier2.wait()
            code, _body = session.call('POST', f'/api/v1/tasks/{task2}/completion/accept', {'revision': rev2})
            if code >= 500:
                policy_results.append(f'accept-server-{code}')
                return
            policy_results.append('accept-ok' if code < 400 else f'accept-{code}')

        pt1 = threading.Thread(target=policy_worker, name='policy')
        pt2 = threading.Thread(target=accept_during_policy, name='policy-accept')
        pt1.start()
        pt2.start()
        hung = _join_threads([pt1, pt2])
        if hung:
            return _fail(hung)
        if len(policy_results) != 2 or any('server-' in item for item in policy_results):
            return _fail(f'policy race incomplete or 5xx: {policy_results!r}')
        row = _kw(models, 'project.task', 'read', [[task2], ['state', 'liwan_completion_pending', 'id']])[0]
        if row['id'] != task2:
            return _fail('policy/accept race crossed task ids')
        legal = (
            ('policy-ok' in policy_results and 'accept-ok' in policy_results and row['state'] == '1_done' and not row['liwan_completion_pending'])
            or ('policy-ok' in policy_results and any(item.startswith('accept-') and item != 'accept-ok' for item in policy_results) and row['state'] != '1_done')
            or (any(item.startswith('policy-') and item != 'policy-ok' for item in policy_results) and 'accept-ok' in policy_results and row['state'] == '1_done')
        )
        if not legal:
            return _fail(f'illegal policy/accept outcome {policy_results!r} {row!r}')

        created = new_pending('Race cancel')
        if isinstance(created, str):
            return _fail(created)
        task3, rev3 = created
        cancel_status, cancel_body = api.call('POST', f'/api/v1/tasks/{task3}/transition', {'state': 'cancelled'})
        if cancel_status >= 400:
            return _fail(f'cancel failed: {cancel_status} {cancel_body}')
        stale_status, stale_body = api.call('POST', f'/api/v1/tasks/{task3}/completion/accept', {'revision': rev3})
        if stale_status < 400:
            return _fail(f'stale accept after cancel succeeded: {stale_body}')

        created = new_pending('Race archive')
        if isinstance(created, str):
            return _fail(created)
        task4, rev4 = created
        archive_status, archive_body = api.call('POST', f'/api/v1/tasks/{task4}/archive', {})
        if archive_status >= 400:
            return _fail(f'archive failed: {archive_status} {archive_body}')
        archived_accept, archived_body = api.call('POST', f'/api/v1/tasks/{task4}/completion/accept', {'revision': rev4})
        if archived_accept < 400:
            return _fail(f'stale accept after archive succeeded: {archived_body}')

        api.call('PATCH', '/api/v1/settings/projects', {
            'deadline_reminders_enabled': False, 'overdue_digest_enabled': True,
        })
        _kw(models, 'project.task', 'create', [{
            'name': f'Race overdue {run_dir.name}', 'project_id': project, 'user_ids': [(4, admin_id)],
            'date_deadline': '2099-01-01 10:00:00',
        }])
        partner = _kw(models, 'res.users', 'read', [[admin_id], ['partner_id']])[0]['partner_id'][0]
        expected_key = f'overdue_digest:{company}:{partner}:{DIGEST_NOW.date().isoformat()}'
        existing = _kw(models, 'mail.message', 'search_count', [[
            ['liwan_notification_key', '=', expected_key],
        ]])
        if existing:
            return _fail(f'digest key {expected_key} already existed')
        ready_a = run_dir / 'digest-ready-a'
        ready_b = run_dir / 'digest-ready-b'
        go = run_dir / 'digest-go'
        worker = run_dir / 'digest-worker.py'
        worker.write_text(
            'from datetime import datetime\n'
            'from pathlib import Path\n'
            f'ready = Path({str(run_dir / "digest-ready-PLACEHOLDER")!r})\n'
            f'go = Path({str(go)!r})\n'
            'ready.write_text("1", encoding="utf-8")\n'
            'while not go.exists():\n'
            '    pass\n'
            f'env["project.task"]._liwan_run_deadline_notifications(now=datetime(2099, 6, 15, 10, 0, 0))\n'
            'env.cr.commit()\n'
            'print("DIGEST_WORKER_OK")\n',
            encoding='utf-8',
        )
        shell = _shell_cmd_for(ctx, database, ctx['addons_path'])
        procs = []
        odoo_root = str(Path(ctx['odoo_bin']).resolve().parent)
        for label, ready in (('a', ready_a), ('b', ready_b)):
            text = worker.read_text(encoding='utf-8').replace('digest-ready-PLACEHOLDER', ready.name)
            path = run_dir / f'digest-worker-{label}.py'
            path.write_text(text, encoding='utf-8')
            handle = path.open(encoding='utf-8')
            procs.append(subprocess.Popen(shell, cwd=odoo_root, stdin=handle, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        deadline = time.time() + 60
        while time.time() < deadline and not (ready_a.exists() and ready_b.exists()):
            time.sleep(0.1)
        if not (ready_a.exists() and ready_b.exists()):
            return _fail('digest workers never became ready')
        go.write_text('go', encoding='utf-8')
        digest_out = []
        for proc in procs:
            stdout, stderr = proc.communicate(timeout=60)
            digest_out.append(f'{proc.returncode}:{(stdout or b"").decode()[-80:]}')
            if proc.returncode:
                sys.stderr.write((stderr or b'').decode()[-400:] + '\n')
                return _fail(f'digest worker failed {digest_out!r}')
        if any('DIGEST_WORKER_OK' not in item for item in digest_out):
            return _fail(f'digest workers missing OK {digest_out!r}')
        messages = _kw(models, 'mail.message', 'search_read', [[
            ['liwan_notification_key', '=', expected_key],
        ]], {'fields': ['liwan_notification_key', 'partner_ids', 'liwan_digest_count']})
        if len(messages) != 1:
            return _fail(f'expected one digest message for {expected_key}, got {messages!r}')
        if partner not in (messages[0]['partner_ids'] or []):
            return _fail(f'digest recipient mismatch {messages[0]!r}')

        integrity = run_dir / 'integrity.py'
        integrity.write_text(
            'from datetime import date\n'
            'from psycopg2 import IntegrityError\n'
            f'key = {expected_key!r}\n'
            'partner = env.user.partner_id\n'
            'first = env["project.task"]._liwan_create_digest_notification('
            'company=env.company, partner=partner, body="dup", key=key, '
            'overdue_count=1, local_date=date(2099, 6, 15))\n'
            'second = env["project.task"]._liwan_create_digest_notification('
            'company=env.company, partner=partner, body="dup", key=key, '
            'overdue_count=1, local_date=date(2099, 6, 15))\n'
            'assert second is False, second\n'
            'raised = False\n'
            'try:\n'
            '    with env.cr.savepoint():\n'
            '        env["res.users"].create({"login": env.user.login})\n'
            'except IntegrityError:\n'
            '    raised = True\n'
            'except Exception as error:\n'
            '    name = type(error).__name__\n'
            '    raised = "Integrity" in name or "Unique" in name or "Validation" in name\n'
            'assert raised, "unrelated integrity/unique failure was swallowed"\n'
            'print("INTEGRITY_OK")\n',
            encoding='utf-8',
        )
        with integrity.open(encoding='utf-8') as handle:
            probed = subprocess.run(_shell_cmd_for(ctx, database, ctx['addons_path']), cwd=str(Path(ctx['odoo_bin']).resolve().parent), stdin=handle, check=False, timeout=120, capture_output=True, text=True)
        if probed.returncode or 'INTEGRITY_OK' not in (probed.stdout or ''):
            sys.stderr.write((probed.stderr or '')[-500:] + '\n')
            return _fail('integrity probe failed')
        sys.stderr.write(json.dumps({
            'accept_race': results,
            'policy_race': policy_results,
            'digest_runs': digest_out,
            'digest_key': expected_key,
            'run_dir': str(run_dir),
        }) + '\n')
        return 0
    finally:
        _stop(server)


def _e2e_fixtures(ctx: dict, database: str, port: int, run_dir: Path) -> int:
    url = f'http://127.0.0.1:{port}'
    if not _port_in_use(port):
        return _fail(f'e2e-fixtures requires an owned running Odoo on {port} for {database}')
    try:
        api = JsonSession(url, database, 'admin', 'admin')
    except RuntimeError as error:
        return _fail(str(error))
    uid, models = _shell_models(ctx, database)
    me_status, me = api.call('GET', '/api/v1/me', None)
    if me_status >= 400:
        return _fail(f'me failed {me_status} {me}')
    roles_status, roles = api.call('GET', '/api/v1/admin/roles', None)
    if roles_status >= 400:
        return _fail(f'roles failed {roles_status}')
    role = next(item for item in roles['items'] if item['key'] == 'pmo_manager')
    emp_role = next(item for item in roles['items'] if item['key'] == 'employee')
    stamp = run_dir.name
    password = 'LiwanPsc-E2E-123!'
    mgr_login = f'psc-digest-{stamp}@example.test'
    emp_login = f'psc-digest-emp-{stamp}@example.test'
    mgr_emp = api.call('POST', '/api/v1/hr/employees', {'name': 'PSC digest mgr', 'work_email': mgr_login})
    emp_emp = api.call('POST', '/api/v1/hr/employees', {'name': 'PSC digest emp', 'work_email': emp_login})
    if mgr_emp[0] >= 400 or emp_emp[0] >= 400:
        return _fail(f'employee create failed {mgr_emp} {emp_emp}')
    company_id = me['company']['id']
    mgr_user = api.call('POST', '/api/v1/admin/employee-accounts', {
        'employee_id': mgr_emp[1]['id'], 'password': password,
        'assignments': [{'role_id': role['id'], 'scope': {'kind': 'company', 'id': company_id}}],
    })
    emp_user = api.call('POST', '/api/v1/admin/employee-accounts', {
        'employee_id': emp_emp[1]['id'], 'password': password,
        'assignments': [{'role_id': emp_role['id'], 'scope': {'kind': 'company', 'id': company_id}}],
    })
    if mgr_user[0] >= 400 or emp_user[0] >= 400:
        return _fail(f'user grant failed {mgr_user} {emp_user}')
    mgr_id = mgr_user[1]['id']
    emp_id = emp_user[1]['id']
    project_a = _kw(models, 'project.project', 'create', [{
        'name': f'PSC digest A {stamp}', 'user_id': mgr_id, 'privacy_visibility': 'employees',
        'date': '2035-12-31', 'company_id': me['company']['id'],
    }])
    project_b = _kw(models, 'project.project', 'create', [{
        'name': f'PSC digest B {stamp}', 'user_id': mgr_id, 'privacy_visibility': 'employees',
        'date': '2035-12-31', 'company_id': me['company']['id'],
    }])
    task_ids = []
    for index in range(52):
        project_id = project_a if index < 26 else project_b
        task_ids.append(_kw(models, 'project.task', 'create', [{
            'name': f'PSC digest task {stamp} {index}',
            'project_id': project_id,
            'user_ids': [(4, emp_id)],
            'date_deadline': '2099-01-01 10:00:00',
        }]))
    clear_id = task_ids[0]
    partner = _kw(models, 'res.users', 'read', [[mgr_id], ['partner_id']])[0]['partner_id'][0]
    _kw(models, 'project.project', 'message_subscribe', [[project_b]], {'partner_ids': [partner]})
    api.call('PATCH', '/api/v1/settings/projects', {
        'deadline_reminders_enabled': False, 'overdue_digest_enabled': True,
    })
    cron = run_dir / 'run-cron.py'
    cron.write_text(
        'from datetime import datetime\n'
        'env["project.task"]._liwan_run_deadline_notifications(now=datetime(2099, 6, 15, 10, 0, 0))\n'
        'env.cr.commit()\n'
        'print("CRON_OK")\n',
        encoding='utf-8',
    )
    with cron.open(encoding='utf-8') as handle:
        ran = subprocess.run(_shell_cmd_for(ctx, database, ctx['addons_path']), cwd=str(Path(ctx['odoo_bin']).resolve().parent), stdin=handle, check=False, timeout=120, capture_output=True, text=True)
    if ran.returncode or 'CRON_OK' not in (ran.stdout or ''):
        sys.stderr.write((ran.stderr or '')[-500:] + '\n')
        return _fail('digest cron seed failed')
    company = me['company']['id']
    key = f'overdue_digest:{company}:{partner}:2099-06-15'
    messages = _kw(models, 'mail.message', 'search_read', [[
        ['liwan_notification_key', '=', key],
    ]], {'fields': ['id']})
    if not messages:
        return _fail(f'no digest message for {key}')
    notifs = _kw(models, 'mail.notification', 'search_read', [[
        ['mail_message_id', '=', messages[0]['id']],
        ['res_partner_id', '=', partner],
    ]], {'fields': ['id']})
    if not notifs:
        return _fail('no inbox row for digest recipient')
    payload = {
        'digest_notification_id': notifs[0]['id'],
        'digest_message_id': messages[0]['id'],
        'manager_login': mgr_login,
        'manager_password': password,
        'manager_id': mgr_id,
        'employee_id': emp_id,
        'project_a_id': project_a,
        'project_b_id': project_b,
        'clear_task_id': clear_id,
        'task_count': len(task_ids),
        'admin_id': uid,
    }
    out = run_dir / 'e2e-fixtures.json'
    out.write_text(json.dumps(payload), encoding='utf-8')
    sys.stderr.write(f'E2E_FIXTURE {out}\n')
    sys.stdout.write(str(out) + '\n')
    return 0


def _upgrade(ctx: dict, database: str, port: int, base_addons: Path, run_dir: Path) -> int:
    if not base_addons.is_dir():
        return _fail('base addons snapshot missing')
    if _port_in_use(port):
        return _fail(f'upgrade port {port} is in use')
    base_addons_path = str((base_addons / 'odoo-addons').resolve())
    odoo_root = str(Path(ctx['odoo_bin']).resolve().parent)
    init = check_isolated.build_install_argv(
        python=ctx['python'],
        odoo_bin=ctx['odoo_bin'],
        odoo_conf=ctx['odoo_conf'],
        stock_addons=ctx['stock_addons'],
        worktree_addons=base_addons_path,
        scratch_db=database,
        scratch_lifecycle=ctx['scratch_lifecycle'],
        http_port=port,
        modules='liwan_core,liwan_api,liwan_pmo,liwan_hr',
    )
    code = _run(init, cwd=Path(odoo_root), timeout=300)
    if code:
        return code
    seed_path = run_dir / 'legacy-seed.py'
    seed_path.write_text(LEGACY_SEED, encoding='utf-8')
    seed_shell = _shell_cmd_for({**ctx, 'addons_path': base_addons_path}, database, base_addons_path)
    with seed_path.open(encoding='utf-8') as handle:
        seeded = subprocess.run(seed_shell, cwd=odoo_root, stdin=handle, check=False, timeout=120, capture_output=True, text=True)
    if seeded.returncode:
        sys.stderr.write((seeded.stderr or '')[-500:] + '\n')
        return seeded.returncode
    seed_line = next((line for line in (seeded.stdout or '').splitlines() if line.startswith('SEED ')), '')
    if not seed_line:
        return _fail('legacy seed did not print a snapshot')
    expected_path = run_dir / 'legacy-expected.json'
    expected_path.write_text(seed_line[len('SEED '):], encoding='utf-8')
    upgrade = check_isolated.build_upgrade_argv(
        python=ctx['python'],
        odoo_bin=ctx['odoo_bin'],
        odoo_conf=ctx['odoo_conf'],
        stock_addons=ctx['stock_addons'],
        worktree_addons=ctx['addons_path'],
        scratch_db=database,
        scratch_lifecycle=ctx['scratch_lifecycle'],
        http_port=port,
        modules='liwan_core,liwan_api,liwan_pmo,liwan_hr',
        test_tags='/liwan_pmo',
    )
    tag_at = upgrade.index('--test-tags')
    del upgrade[tag_at:tag_at + 2]
    code = _run(upgrade, cwd=Path(odoo_root), timeout=300)
    if code:
        return code
    verify_path = run_dir / 'legacy-verify.py'
    verify_path.write_text(LEGACY_VERIFY, encoding='utf-8')
    env = dict(os.environ)
    env['PSC_EXPECTED'] = str(expected_path)
    verify_shell = _shell_cmd_for(ctx, database, ctx['addons_path'])
    with verify_path.open(encoding='utf-8') as handle:
        verified = subprocess.run(verify_shell, cwd=odoo_root, stdin=handle, check=False, timeout=120, env=env, capture_output=True, text=True)
    if verified.returncode or 'VERIFY_RESULT OK' not in (verified.stdout or ''):
        sys.stderr.write((verified.stdout or '')[-500:] + '\n' + (verified.stderr or '')[-500:] + '\n')
        return verified.returncode or 1
    code = _run(upgrade, cwd=Path(odoo_root), timeout=300)
    if code:
        return code
    with verify_path.open(encoding='utf-8') as handle:
        repeated = subprocess.run(verify_shell, cwd=odoo_root, stdin=handle, check=False, timeout=120, env=env, capture_output=True, text=True)
    if repeated.returncode or 'VERIFY_RESULT OK' not in (repeated.stdout or ''):
        sys.stderr.write((repeated.stdout or '')[-500:] + '\n')
        return repeated.returncode or 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', required=True, choices=MODES)
    parser.add_argument('--scratch-db', required=True)
    parser.add_argument('--scratch-lifecycle', required=True)
    parser.add_argument('--worktree', required=True)
    parser.add_argument('--addons-path', required=True)
    parser.add_argument('--python', required=True)
    parser.add_argument('--odoo-bin', required=True)
    parser.add_argument('--odoo-conf', required=True)
    parser.add_argument('--stock-addons', required=True)
    parser.add_argument('--http-port', required=True, type=int)
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--base-addons', default='')
    args = parser.parse_args()
    err = _guard_database(args.scratch_db)
    if err:
        return _fail(err)
    try:
        check_isolated.validate_scratch_db(args.scratch_db, lifecycle=args.scratch_lifecycle)
        check_isolated.validate_port(args.http_port)
    except check_isolated.IsolationError as error:
        return _fail(str(error))
    worktree = Path(args.worktree)
    addons_path = Path(args.addons_path)
    err = _guard_worktree(worktree, addons_path)
    if err:
        return _fail(err)
    run_dir = Path(args.run_dir)
    if not run_dir.is_absolute() or not run_dir.is_dir():
        return _fail('run-dir must be an existing absolute directory')
    ctx = {
        'python': args.python,
        'odoo_bin': args.odoo_bin,
        'odoo_conf': args.odoo_conf,
        'stock_addons': args.stock_addons,
        'addons_path': str(addons_path.resolve()),
        'scratch_lifecycle': args.scratch_lifecycle,
    }
    if args.mode == 'guard':
        sys.stderr.write(f'guard ok run_dir={run_dir}\n')
        return 0
    if args.mode == 'race':
        return _race(ctx, args.scratch_db, args.http_port, run_dir)
    if args.mode == 'e2e-fixtures':
        return _e2e_fixtures(ctx, args.scratch_db, args.http_port, run_dir)
    if not args.base_addons:
        return _fail('upgrade mode requires --base-addons')
    return _upgrade(ctx, args.scratch_db, args.http_port, Path(args.base_addons), run_dir)


if __name__ == '__main__':
    raise SystemExit(main())
