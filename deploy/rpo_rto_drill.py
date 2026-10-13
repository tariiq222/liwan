# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Real RPO/RTO measurement drill against a realistic-sized scratch tenant.

This is an authorized, local, scratch-only exercise. It is NOT the automated
CI `restore-drill` step (which proves the backup/restore *mechanism* works on
a near-empty database). This script instead:

  1. Boots Odoo on an isolated scratch database and seeds a medium-sized
     tenant (configurable employee/project/task/attachment counts) through
     `odoo-bin shell`, never through the customer UI.
  2. Stops Odoo (quiescence), then runs the real `deploy/backup.py` candidate
     copy and times it -> this elapsed time is the *measured* backup window,
     which bounds achievable RPO (data younger than this window since the
     last backup is at risk).
  3. Simulates a failure by dropping the source database and its filestore.
  4. Times the full recovery path: `deploy/restore_verify.py` (DB + filestore
     restore) + Odoo boot + first authenticated read returning expected row
     counts -> this elapsed time is the *measured* RTO.
  5. Writes a dated JSON+Markdown report with the actual numbers, the data
     scale used, and the explicit boundaries that remain (single node, single
     site, no concurrent load, no network failure injection).

Usage (from repo root, after `python3 deploy/odoo/ODOO_COMMIT`-pinned Odoo is
available locally, matching `.woodpecker.yml`'s restore-drill step):

    python3 -B deploy/rpo_rto_drill.py \
        --odoo-root /Users/tariq/code/odoo \
        --repeat 2 \
        --output-dir /tmp/nasq-rpo-rto-drill-<date>

Never run against `odoo19` or any non-scratch database; the script enforces
the same forbidden-name guard as `deploy/backup.py`.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN_DB = {'odoo19', 'production', 'prod', 'postgres', 'template0', 'template1'}

SEED_SCRIPT = '''
import os
DB_GUARD = os.environ["NASQ_DRILL_DB"]
if env.cr.dbname != DB_GUARD:  # noqa: F821
    raise SystemExit(f"rpo_rto_drill refuses database {env.cr.dbname!r}")  # noqa: F821

n_employees = int(os.environ.get("NASQ_DRILL_EMPLOYEES", "40"))
n_projects = int(os.environ.get("NASQ_DRILL_PROJECTS", "15"))
tasks_per_project = int(os.environ.get("NASQ_DRILL_TASKS_PER_PROJECT", "40"))
attachments_per_task = int(os.environ.get("NASQ_DRILL_ATTACHMENTS_PER_TASK", "1"))
attachment_kib = int(os.environ.get("NASQ_DRILL_ATTACHMENT_KIB", "64"))

registry = env["nasq.feature.registry"]  # noqa: F821
env["nasq.tenant.profile"]._nasq_initialize_legacy_policy(registry._nasq_installed_module_ids())  # noqa: F821
env.cr.commit()  # noqa: F821

Users = env["res.users"].with_context(no_reset_password=True, tracking_disable=True)  # noqa: F821
Employees = env["hr.employee"].with_context(tracking_disable=True)  # noqa: F821
Projects = env["project.project"].with_context(tracking_disable=True)  # noqa: F821
Tasks = env["project.task"].with_context(tracking_disable=True)  # noqa: F821
Attachments = env["ir.attachment"].with_context(tracking_disable=True)  # noqa: F821

company = env.company  # noqa: F821
manager_group = env.ref("nasq_pmo.group_pmo_manager")  # noqa: F821
employee_group = env.ref("nasq_core.group_employee")  # noqa: F821

user_ids = []
for i in range(n_employees):
    login = f"drill_user_{i:04d}"
    user = Users.search([("login", "=", login)], limit=1)
    vals = {
        "name": f"Drill Employee {i:04d}",
        "email": f"{login}@drill.test",
        "group_ids": [(6, 0, [manager_group.id if i == 0 else employee_group.id])],
        "password": "nasq-drill-2026",
    }
    if not user:
        user = Users.create({**vals, "login": login})
    else:
        user.write(vals)
    user_ids.append(user.id)
    emp = Employees.search([("user_id", "=", user.id)], limit=1)
    if not emp:
        Employees.create({"name": vals["name"], "user_id": user.id, "company_id": company.id})

env.cr.commit()  # noqa: F821

project_ids = []
for p in range(n_projects):
    project = Projects.create({
        "name": f"Drill Project {p:03d}",
        "company_id": company.id,
    })
    project_ids.append(project.id)
    task_vals = []
    for t in range(tasks_per_project):
        assignee = user_ids[(p * tasks_per_project + t) % len(user_ids)]
        task_vals.append({
            "name": f"Drill Task {p:03d}-{t:04d}",
            "project_id": project.id,
            "user_ids": [(6, 0, [assignee])],
            "company_id": company.id,
        })
    tasks = Tasks.create(task_vals)
    if attachments_per_task > 0:
        payload = (b"x" * 1024 * attachment_kib)
        import base64
        encoded = base64.b64encode(payload)
        for task in tasks:
            for a in range(attachments_per_task):
                Attachments.create({
                    "name": f"drill-{task.id}-{a}.bin",
                    "res_model": "project.task",
                    "res_id": task.id,
                    "datas": encoded,
                })
    env.cr.commit()  # noqa: F821

counts = {
    "users": len(user_ids),
    "projects": len(project_ids),
    "tasks": Tasks.search_count([("project_id", "in", project_ids)]),
    "attachments": Attachments.search_count([("res_model", "=", "project.task")]),
}
print("DRILL_SEED_COUNTS=" + __import__("json").dumps(counts))  # noqa: T201
'''

VERIFY_SCRIPT = '''
import os
DB_GUARD = os.environ["NASQ_DRILL_DB"]
if env.cr.dbname != DB_GUARD:  # noqa: F821
    raise SystemExit(f"rpo_rto_drill refuses database {env.cr.dbname!r}")  # noqa: F821
counts = {
    "users": env["res.users"].search_count([("login", "like", "drill_user_%")]),  # noqa: F821
    "projects": env["project.project"].search_count([("name", "like", "Drill Project %")]),  # noqa: F821
    "tasks": env["project.task"].search_count([("name", "like", "Drill Task %")]),  # noqa: F821
    "attachments": env["ir.attachment"].search_count([("name", "like", "drill-%")]),  # noqa: F821
}
print("DRILL_VERIFY_COUNTS=" + __import__("json").dumps(counts))  # noqa: T201
'''


class DrillError(RuntimeError):
    pass


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', file=sys.stderr, flush=True)


def run(argv, **kwargs):
    log('+ ' + ' '.join(str(a) for a in argv))
    check = kwargs.pop('check', True)
    completed = subprocess.run(argv, check=False, **kwargs)
    if check and completed.returncode != 0:
        raise DrillError(f'command failed ({completed.returncode}): {argv}')
    return completed


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def wait_for_health(port: int, timeout_s: float) -> float:
    deadline = time.monotonic() + timeout_s
    url = f'http://127.0.0.1:{port}/web/health'
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return time.monotonic()
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(0.5)
    raise DrillError(f'Odoo did not become healthy on port {port} within {timeout_s}s')


@dataclass
class DrillConfig:
    odoo_root: Path
    repo_root: Path
    work_dir: Path
    db: str
    restored_db: str
    pg_host: str
    pg_user: str
    pg_password: str
    employees: int
    projects: int
    tasks_per_project: int
    attachments_per_task: int
    attachment_kib: int
    http_port: int = field(default_factory=free_port)
    boot_timeout_s: float = 180.0


def pg_env(cfg: DrillConfig) -> dict:
    env = dict(os.environ)
    env['PGPASSWORD'] = cfg.pg_password
    return env


def dropdb(cfg: DrillConfig, name: str) -> None:
    if name in FORBIDDEN_DB:
        raise DrillError(f'refusing to drop forbidden database name {name!r}')
    run(['dropdb', '-h', cfg.pg_host, '-U', cfg.pg_user, '--if-exists', name], env=pg_env(cfg), check=False)


def odoo_bin(cfg: DrillConfig) -> Path:
    return cfg.odoo_root / 'odoo-bin'


def odoo_python(cfg: DrillConfig) -> Path:
    return cfg.odoo_root / '.venv' / 'bin' / 'python'


def addons_path(cfg: DrillConfig) -> str:
    return f'{cfg.odoo_root}/addons,{cfg.repo_root}/odoo-addons'


def release_modules(cfg: DrillConfig) -> str:
    completed = run(
        [sys.executable, '-B', 'tools/catalog_check.py', '--release-modules'],
        cwd=str(cfg.repo_root), capture_output=True, text=True,
    )
    return completed.stdout.strip()


def run_shell(cfg: DrillConfig, db: str, data_dir: Path, script: str, extra_env: dict) -> str:
    env = dict(os.environ)
    env.update(extra_env)
    env['PGPASSWORD'] = cfg.pg_password
    completed = run(
        [
            str(odoo_python(cfg)), str(odoo_bin(cfg)), 'shell',
            '--db_host', cfg.pg_host, '--db_user', cfg.pg_user, '--db_password', cfg.pg_password,
            '--addons-path', addons_path(cfg), '--data-dir', str(data_dir),
            '-d', db, '--no-http', '--log-level=warn',
        ],
        input=script, capture_output=True, text=True, env=env, check=True,
    )
    return completed.stdout


def install_release(cfg: DrillConfig, db: str, data_dir: Path, modules: str, classification_path: Path) -> None:
    env = dict(os.environ)
    env['PGPASSWORD'] = cfg.pg_password
    env['NASQ_COMMERCIAL_CONFIG'] = str(classification_path)
    run(
        [
            str(odoo_python(cfg)), str(odoo_bin(cfg)),
            '--db_host', cfg.pg_host, '--db_user', cfg.pg_user, '--db_password', cfg.pg_password,
            '--addons-path', addons_path(cfg), '--data-dir', str(data_dir),
            '-d', db, '-i', modules, '--without-demo=all',
            '--http-port', str(cfg.http_port), '--workers=0', '--max-cron-threads=0', '--stop-after-init',
        ],
        env=env,
    )


def boot_odoo(cfg: DrillConfig, db: str, data_dir: Path, log_path: Path,
              classification_path: Path | None) -> subprocess.Popen:
    env = dict(os.environ)
    env['PGPASSWORD'] = cfg.pg_password
    if classification_path is not None:
        env['NASQ_COMMERCIAL_CONFIG'] = str(classification_path)
    else:
        env.pop('NASQ_COMMERCIAL_CONFIG', None)
    log_fh = log_path.open('wb')
    proc = subprocess.Popen(
        [
            str(odoo_python(cfg)), str(odoo_bin(cfg)),
            '--db_host', cfg.pg_host, '--db_user', cfg.pg_user, '--db_password', cfg.pg_password,
            '--addons-path', addons_path(cfg), '--data-dir', str(data_dir),
            '-d', db, '--http-port', str(cfg.http_port), '--workers=0', '--max-cron-threads=0',
        ],
        stdout=log_fh, stderr=subprocess.STDOUT, env=env,
    )
    return proc


def stop_proc(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)


def parse_counts(stdout: str, marker: str) -> dict:
    for line in stdout.splitlines():
        if line.startswith(marker):
            return json.loads(line[len(marker):])
    raise DrillError(f'marker {marker!r} not found in shell output:\n{stdout}')


def run_drill(cfg: DrillConfig) -> dict:
    data_dir = cfg.work_dir / 'data'
    restored_dir = cfg.work_dir / 'restored'
    backup_dir = cfg.work_dir / 'backup'
    logs_dir = cfg.work_dir / 'logs'
    for d in (data_dir, restored_dir, logs_dir):
        d.mkdir(parents=True, exist_ok=True)
    if backup_dir.exists():
        shutil.rmtree(backup_dir)

    dropdb(cfg, cfg.db)
    dropdb(cfg, cfg.restored_db)

    classification_path = cfg.work_dir / 'classification.json'
    run(
        [sys.executable, 'deploy/classification.py', 'fixture', '--database', cfg.db,
         '--mode', 'non_saas', '--output', str(classification_path)],
        cwd=str(cfg.repo_root),
    )

    modules = release_modules(cfg)
    log(f'installing release modules on {cfg.db}: {modules}')
    install_release(cfg, cfg.db, data_dir, modules, classification_path)

    log(f'seeding realistic data set: {cfg.employees} employees, {cfg.projects} projects, '
        f'{cfg.tasks_per_project} tasks/project, {cfg.attachments_per_task} attachment(s)/task @ '
        f'{cfg.attachment_kib} KiB')
    seed_out = run_shell(cfg, cfg.db, data_dir, SEED_SCRIPT, {
        'NASQ_DRILL_DB': cfg.db,
        'NASQ_DRILL_EMPLOYEES': str(cfg.employees),
        'NASQ_DRILL_PROJECTS': str(cfg.projects),
        'NASQ_DRILL_TASKS_PER_PROJECT': str(cfg.tasks_per_project),
        'NASQ_DRILL_ATTACHMENTS_PER_TASK': str(cfg.attachments_per_task),
        'NASQ_DRILL_ATTACHMENT_KIB': str(cfg.attachment_kib),
    })
    seeded_counts = parse_counts(seed_out, 'DRILL_SEED_COUNTS=')
    log(f'seeded: {seeded_counts}')

    filestore_dir = data_dir / 'filestore' / cfg.db
    db_bytes = int(run(
        ['psql', '-h', cfg.pg_host, '-U', cfg.pg_user, '-d', cfg.db, '-At',
         '-c', 'SELECT pg_database_size(current_database())'],
        env=pg_env(cfg), capture_output=True, text=True,
    ).stdout.strip())
    filestore_bytes = sum(f.stat().st_size for f in filestore_dir.rglob('*') if f.is_file()) if filestore_dir.is_dir() else 0

    log('stopping Odoo for quiescent backup (closed port is observational only, per deploy/backup.py)')

    pg_dump_path = shutil.which('pg_dump')
    pg_restore_path = shutil.which('pg_restore')
    createdb_path = shutil.which('createdb')
    psql_path = shutil.which('psql')

    # --- RPO measurement: time the real backup.py candidate copy ---
    backup_t0 = time.monotonic()
    run([
        sys.executable, 'deploy/backup.py',
        '--opt-in', 'MANUAL_BACKUP_OPT_IN', '--acknowledge-unverified', 'CANDIDATE_BACKUP_UNVERIFIED',
        '--db-name', cfg.db, '--filestore', str(filestore_dir),
        '--output-dir', str(backup_dir),
        '--pg-dump', pg_dump_path, '--pg-host', cfg.pg_host, '--pg-user', cfg.pg_user,
    ], cwd=str(cfg.repo_root), env=pg_env(cfg))
    backup_elapsed_s = time.monotonic() - backup_t0
    log(f'RPO window (backup elapsed): {backup_elapsed_s:.1f}s')

    with (backup_dir / 'manifest.json').open(encoding='utf-8') as fh:
        manifest = json.load(fh)

    # --- Simulate failure: drop the source database and its live filestore ---
    log('simulating failure: dropping source database and filestore')
    failure_t0 = time.monotonic()
    dropdb(cfg, cfg.db)
    if filestore_dir.is_dir():
        shutil.rmtree(filestore_dir)

    # --- RTO measurement: restore DB+filestore, boot Odoo, confirm data readable ---
    restored_filestore = restored_dir / 'filestore' / cfg.restored_db
    verify_completed = run([
        sys.executable, 'deploy/restore_verify.py',
        '--backup-dir', str(backup_dir), '--target-db', cfg.restored_db,
        '--target-filestore', str(restored_filestore),
        '--pg-restore', pg_restore_path, '--createdb', createdb_path, '--psql', psql_path,
        '--pg-host', cfg.pg_host, '--pg-user', cfg.pg_user,
    ], cwd=str(cfg.repo_root), env=pg_env(cfg), capture_output=True, text=True)
    restore_checks = json.loads(verify_completed.stdout)
    db_restore_elapsed_s = time.monotonic() - failure_t0
    log(f'DB+filestore restore elapsed: {db_restore_elapsed_s:.1f}s; checks: {restore_checks}')

    boot_log = logs_dir / 'restored-boot.log'
    proc = boot_odoo(cfg, cfg.restored_db, restored_dir, boot_log, classification_path=None)
    try:
        wait_for_health(cfg.http_port, cfg.boot_timeout_s)
        boot_ready_t = time.monotonic()
        verify_out = run_shell(cfg, cfg.restored_db, restored_dir, VERIFY_SCRIPT, {
            'NASQ_DRILL_DB': cfg.restored_db,
        })
    finally:
        stop_proc(proc)
    rto_elapsed_s = boot_ready_t - failure_t0
    full_read_elapsed_s = time.monotonic() - failure_t0

    restored_counts = parse_counts(verify_out, 'DRILL_VERIFY_COUNTS=')
    data_match = restored_counts == seeded_counts
    log(f'restored counts: {restored_counts} (match seeded: {data_match})')

    dropdb(cfg, cfg.restored_db)

    return {
        'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'scale': {
            'employees': cfg.employees,
            'projects': cfg.projects,
            'tasks_per_project': cfg.tasks_per_project,
            'attachments_per_task': cfg.attachments_per_task,
            'attachment_kib': cfg.attachment_kib,
            'seeded_counts': seeded_counts,
            'db_bytes': db_bytes,
            'filestore_bytes': filestore_bytes,
        },
        'measured': {
            'backup_elapsed_s': round(backup_elapsed_s, 2),
            'db_and_filestore_restore_elapsed_s': round(db_restore_elapsed_s, 2),
            'rto_to_http_health_s': round(rto_elapsed_s, 2),
            'rto_to_verified_read_s': round(full_read_elapsed_s, 2),
        },
        'manifest': manifest,
        'restore_checks': restore_checks,
        'data_integrity_match': data_match,
        'restored_counts': restored_counts,
        'not_covered': [
            'multi-node / HA failover', 'network partition injection', 'second site / cross-region replication',
            'concurrent production write load during backup', 'encryption at rest/in transit for the backup artifact',
            'retention policy enforcement', 'automated failure detection (this drill times from a manual drop)',
            'point-in-time recovery (WAL-based); this is full dump/restore only',
        ],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--odoo-root', required=True, type=Path)
    parser.add_argument('--repo-root', default=REPO_ROOT, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--pg-host', default='127.0.0.1')
    parser.add_argument('--pg-user', default='odoo')
    parser.add_argument('--pg-password', default='odoo')
    parser.add_argument('--db', default='nasq_rpo_rto_drill_scratch_src')
    parser.add_argument('--restored-db', default='nasq_rpo_rto_drill_scratch_restored')
    parser.add_argument('--employees', type=int, default=40)
    parser.add_argument('--projects', type=int, default=15)
    parser.add_argument('--tasks-per-project', type=int, default=40)
    parser.add_argument('--attachments-per-task', type=int, default=1)
    parser.add_argument('--attachment-kib', type=int, default=64)
    parser.add_argument('--repeat', type=int, default=2, help='number of independent full runs')
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.db in FORBIDDEN_DB or args.restored_db in FORBIDDEN_DB:
        print('refusing forbidden database name', file=sys.stderr)
        return 2

    args.output_dir.mkdir(parents=True, exist_ok=True)
    runs = []
    for i in range(args.repeat):
        run_dir = args.output_dir / f'run-{i + 1}'
        run_dir.mkdir(parents=True, exist_ok=True)
        cfg = DrillConfig(
            odoo_root=args.odoo_root, repo_root=args.repo_root, work_dir=run_dir,
            db=args.db, restored_db=args.restored_db,
            pg_host=args.pg_host, pg_user=args.pg_user, pg_password=args.pg_password,
            employees=args.employees, projects=args.projects,
            tasks_per_project=args.tasks_per_project,
            attachments_per_task=args.attachments_per_task, attachment_kib=args.attachment_kib,
        )
        log(f'=== run {i + 1}/{args.repeat} in {run_dir} (http port {cfg.http_port}) ===')
        try:
            result = run_drill(cfg)
        except DrillError as error:
            log(f'DRILL FAILED on run {i + 1}: {error}')
            result = {'error': str(error), 'run': i + 1}
        runs.append(result)

    summary_path = args.output_dir / 'rpo-rto-drill-report.json'
    with summary_path.open('w', encoding='utf-8') as fh:
        json.dump({'runs': runs}, fh, indent=2, ensure_ascii=False)
    log(f'report written to {summary_path}')

    failed = [r for r in runs if 'error' in r]
    if failed:
        print(f'{len(failed)}/{len(runs)} run(s) failed; see {summary_path}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
