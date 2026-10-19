# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Time the key finance and HR routes against a seeded scratch database.

    python3 -B tools/perf/measure.py --database webvue_scratch_x --port 8196 --workers 2 --runs 30 --output out.json
    python3 -B tools/perf/measure.py --database webvue_scratch_x --port 8196 --workers 0 --runs 30

Starts its own Odoo on a port nothing listens on (``--workers=2`` mirrors
``deploy/shared/validate_odoo_config.py``; ``0`` is the profiling shape), times the first request after the
start (registry cold load), logs in as the seeded finance manager, warms every worker, then times every route
``--runs`` times. The SQL query count and query time of each request come from Odoo's own request log line.
The resident memory of the Odoo process tree is sampled with ``ps``. Odoo is stopped at the end, also on
SIGTERM. Nothing is tuned and no data is written. p95 is reported only from ``MIN_SAMPLES_P95`` samples.
"""
import argparse
import http.cookiejar
import json
import math
import os
import re
import signal
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from odoo_launch import (
    LOGIN,
    PASSWORD,
    OdooTestError,
    default_database,
    default_port,
    free_gevent_port,
    odoo_command,
    odoo_environment,
    require_free_port,
    require_scratch,
    scratch_root,
)

COMPANY_NAME = 'Perf Co'
PERIOD = {'date_from': '2025-11-01', 'date_to': '2026-10-19'}
MONTH = {'date_from': '2026-09-01', 'date_to': '2026-09-30'}
ROUTE_BUDGET_SECONDS = 90.0
MIN_SAMPLES_P95 = 30
REQUEST_LOG = re.compile(r'"(?:GET|POST) (\S+) HTTP/[\d.]+" (\d+) - (\d+) ([\d.]+) ([\d.]+)')


def percentile(values, fraction):
    """Nearest-rank percentile."""
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def query(path, **params):
    pairs = urllib.parse.urlencode(params)
    return path + ('?' + pairs if pairs else '')


def normalise(target):
    """A request target as a comparable key: percent-decoding undone, parameters sorted."""
    parts = urllib.parse.urlsplit(target)
    return parts.path + '?' + urllib.parse.urlencode(sorted(urllib.parse.parse_qsl(parts.query)))


def parse_request_log(text):
    """``{key: [(status, queries, sql_seconds, other_seconds), ...]}`` in log order from Odoo's request log lines."""
    found = {}
    for line in text.splitlines():
        match = REQUEST_LOG.search(line)
        if match:
            target, status, count, sql, other = match.groups()
            found.setdefault(normalise(target), []).append((int(status), int(count), float(sql), float(other)))
    return found


def positive_int(value):
    number = int(value)
    if number < 1:
        message = 'must be at least 1'
        raise argparse.ArgumentTypeError(message)
    return number


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, payload=None):
        """``(seconds, status, body_bytes, parsed_json_or_None)`` of one request."""
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.base + path, data=data, headers={'Content-Type': 'application/json'})
        begin = time.perf_counter()
        try:
            with self.opener.open(request, timeout=300) as response:
                body, status = response.read(), response.status
        except urllib.error.HTTPError as error:
            body, status = error.read(), error.code
        seconds = time.perf_counter() - begin
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = None
        return seconds, status, len(body), parsed

    def login(self, database):
        payload = {'jsonrpc': '2.0', 'method': 'call', 'params': {'db': database, 'login': LOGIN, 'password': PASSWORD}}
        seconds, status, _, parsed = self.call('/web/session/authenticate', payload)
        if status != 200 or not (parsed or {}).get('result', {}).get('uid'):
            raise SystemExit('login failed (%s): %s' % (status, parsed))
        return seconds


def parse_ps(rows):
    """``{pid: (ppid, rss_kib, command)}`` from ``ps -axo pid=,ppid=,rss=,command=`` lines."""
    table = {}
    for row in rows:
        parts = row.split(None, 3)
        if len(parts) == 4:
            table[int(parts[0])] = (int(parts[1]), int(parts[2]), parts[3])
    return table


def descendants(table, root):
    """``table`` restricted to ``root`` and every process below it."""
    members, frontier = {}, {root}
    while frontier:
        members.update({pid: table[pid] for pid in frontier if pid in table})
        frontier = {pid for pid, (parent, _, _) in table.items() if parent in frontier and pid not in members}
    return members


class Memory:
    """Samples the resident set of the Odoo process tree (KiB from ``ps``) in a thread."""

    def __init__(self, root_pid):
        self.root = root_pid
        self.peaks = {}
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def tree(self):
        rows = subprocess.run(
            ['ps', '-axo', 'pid=,ppid=,rss=,command='], capture_output=True, text=True, check=False,
        ).stdout.splitlines()
        return descendants(parse_ps(rows), self.root)

    def snapshot(self):
        return {pid: rss for pid, (_, rss, _) in self.tree().items()}

    def _loop(self):
        while self.running:
            for pid, rss in self.snapshot().items():
                self.peaks[pid] = max(self.peaks.get(pid, 0), rss)
            time.sleep(0.5)

    def start(self):
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread.is_alive():
            self.thread.join()


def start_odoo(database, port, workers, log_path):
    extra = ['--http-port=%d' % port, '--workers=%d' % workers, '--max-cron-threads=0', '--http-interface=127.0.0.1',
             '--log-level=info', '--logfile=' + str(log_path)]
    if workers:
        extra.append('--gevent-port=%d' % free_gevent_port())
    return subprocess.Popen(odoo_command('', database, extra, preload=False), env=odoo_environment(database),
                            start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop_odoo(process):
    """Stop the Odoo tree this run started (its own process group only)."""
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def log_tail(log_path, lines=20):
    if not Path(log_path).is_file():
        return '(no log)'
    return '\n'.join(Path(log_path).read_text(encoding='utf-8', errors='replace').splitlines()[-lines:])


def workers_ready(log_path, workers):
    """True once ``workers`` distinct ``WorkerHTTP`` processes have logged that they are alive."""
    if not Path(log_path).is_file():
        return False
    text = Path(log_path).read_text(encoding='utf-8', errors='replace')
    return len(set(re.findall(r'Worker WorkerHTTP \((\d+)\)', text))) >= workers


def wait_for_port(port, process, log_path, workers, timeout=120):
    """Wait until the port accepts connections and every worker is up (no request is sent: the registry stays cold)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise SystemExit('odoo exited early (%s); log tail:\n%s' % (process.returncode, log_tail(log_path)))
        try:
            socket.create_connection(('127.0.0.1', port), timeout=1).close()
            if workers == 0 or workers_ready(log_path, workers):
                if process.poll() is not None:
                    raise SystemExit('odoo exited right after opening the port; log tail:\n%s' % log_tail(log_path))
                return
            time.sleep(0.3)
        except OSError:
            time.sleep(0.3)
    raise SystemExit('odoo did not open its port in %ss; log tail:\n%s' % (timeout, log_tail(log_path)))


def psql(database, sql):
    return subprocess.run(
        ['psql', '-h', os.environ.get('PGHOST', '127.0.0.1'), '-d', database, '-Atc', sql],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def busiest_account(database):
    """Id of the account with the most move lines in the seeded company (a busy general ledger page)."""
    row = psql(database, "SELECT l.account_id FROM account_move_line l JOIN res_company c ON c.id=l.company_id "
                         "WHERE c.name='%s' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1" % COMPANY_NAME)
    if not row:
        raise SystemExit('no move lines for %s in %s: seed the database first' % (COMPANY_NAME, database))
    return int(row)


def routes(client, database):
    """``(name, path)`` pairs; ids come from list responses so no id is guessed."""
    account = busiest_account(database)
    invoices = client.call(query('/api/v1/finance/invoices', limit=50))[3]['items']
    deep = client.call(query('/api/v1/finance/invoices', limit=50, offset=2450))[3]['items'] or invoices  # a small database has no page 50
    budgets = client.call('/api/v1/finance/budgets')[3]['items']
    result = [
        ('invoices list page 1', query('/api/v1/finance/invoices', limit=50)),
        ('invoices list page 50', query('/api/v1/finance/invoices', limit=50, offset=2450)),
        ('invoices list q search', query('/api/v1/finance/invoices', limit=50, q='INV/2026/0')),
        ('invoices list state=posted', query('/api/v1/finance/invoices', limit=50, state='posted')),
        ('invoice detail', '/api/v1/finance/invoices/%d' % invoices[0]['id']),
        ('invoice detail (page 50)', '/api/v1/finance/invoices/%d' % deep[0]['id']),
        ('payments list page 1', query('/api/v1/finance/payments', limit=50)),
        ('entries list page 1', query('/api/v1/finance/entries', limit=50)),
        ('partners list', query('/api/v1/finance/partners', limit=50)),
        ('partners list q search', query('/api/v1/finance/partners', limit=50, q='Customer 001')),
        ('report vat (12 months)', query('/api/v1/finance/reports/vat', **PERIOD)),
        ('report vat (1 month)', query('/api/v1/finance/reports/vat', **MONTH)),
        ('report trial-balance', query('/api/v1/finance/reports/trial-balance', **PERIOD)),
        ('report general-ledger (busy account p1)', query(
            '/api/v1/finance/reports/general-ledger', account_id=account, limit=50, **PERIOD)),
        ('report general-ledger (busy account p100)', query(
            '/api/v1/finance/reports/general-ledger', account_id=account, limit=50, offset=4950, **PERIOD)),
        ('report aged-partner-balance', query('/api/v1/finance/reports/aged-partner-balance', date_to=PERIOD['date_to'])),
        ('report profit-loss', query('/api/v1/finance/reports/profit-loss', **PERIOD)),
        ('report balance-sheet', query('/api/v1/finance/reports/balance-sheet', date_to=PERIOD['date_to'])),
        ('report zakat-base', query('/api/v1/finance/reports/zakat-base', date_to=PERIOD['date_to'])),
        ('report analytic', query('/api/v1/finance/reports/analytic', **PERIOD)),
        ('fiscal-years', '/api/v1/finance/fiscal-years'),
        ('assets list', query('/api/v1/finance/assets', limit=50)),
        ('hr employees list', query('/api/v1/hr/employees', limit=50)),
        ('hr expiring', '/api/v1/hr/expiring'),
        ('hr saudization', '/api/v1/hr/saudization'),
    ]
    if budgets:
        result.append(('report budget-vs-actual', query('/api/v1/finance/reports/budget-vs-actual', budget_id=budgets[0]['id'])))
    return result


def summarise(times):
    """p50 and max always; p95 only from ``MIN_SAMPLES_P95`` samples (else None)."""
    if not times:
        return {'p50_s': None, 'p95_s': None, 'max_s': None}
    return {
        'p50_s': round(statistics.median(times), 4),
        'p95_s': round(percentile(times, 0.95), 4) if len(times) >= MIN_SAMPLES_P95 else None,
        'max_s': round(max(times), 4),
    }


def measure_route(client, name, path, runs, workers):
    """Cold first call, ``max(2, 2 * workers)`` discarded warm-ups, then ``runs`` timed calls (200 only count as timings)."""
    first = client.call(path)
    warmups = max(2, 2 * workers)
    for _ in range(warmups):
        client.call(path)
    times, errors, size, spent = [], 0, first[2], 0.0
    for attempted in range(1, runs + 1):
        seconds, status, size, _ = client.call(path)
        spent += seconds
        if status == 200:
            times.append(seconds)
        else:
            errors += 1
        if spent > ROUTE_BUDGET_SECONDS and attempted >= 3:
            break
    return {
        'route': name, 'path': path, 'first_status': first[1], 'first_s': round(first[0], 4), 'warmups': warmups,
        'samples': len(times), 'errors': errors, 'bytes': size, **summarise(times),
    }


def attach_queries(rows, log_text):
    """Add the median SQL figures of each route's timed requests; fail when a route has no log sample."""
    log = parse_request_log(log_text)
    for row in rows:
        entries = [entry for entry in log.get(normalise(row['path']), []) if entry[0] == 200]
        samples = entries[-row['samples']:] if row['samples'] else []
        if not samples:
            raise SystemExit('no request log sample for %s (%s)' % (row['route'], row['path']))
        row['queries_p50'] = int(statistics.median(entry[1] for entry in samples))
        row['sql_p50_s'] = round(statistics.median(entry[2] for entry in samples), 4)
        row['python_p50_s'] = round(statistics.median(entry[3] for entry in samples), 4)


def mib(snapshot):
    return sorted(round(value / 1024) for value in snapshot.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--database', default=None, help='scratch database (default: NUXT_ODOO_DB of .env.worktree)')
    parser.add_argument('--port', type=int, default=None, help='HTTP port (default: ODOO_HTTP_PORT of .env.worktree)')
    parser.add_argument('--workers', type=int, default=2, choices=(0, 2))
    parser.add_argument('--runs', type=positive_int, default=MIN_SAMPLES_P95,
                        help='timed calls per route; p95 is only reported from %d' % MIN_SAMPLES_P95)
    parser.add_argument('--output', default=None, help='write the results as JSON')
    args = parser.parse_args()
    database = require_scratch(args.database) if args.database else default_database()
    port = args.port or default_port()
    try:
        require_free_port(port)
    except OdooTestError as error:
        raise SystemExit(str(error)) from None
    log_path = scratch_root() / 'logs' / ('measure-w%d.log' % args.workers)
    log_path.unlink(missing_ok=True)

    def on_sigterm(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_sigterm)
    process = start_odoo(database, port, args.workers, log_path)
    client = Client('http://127.0.0.1:%d' % port)
    memory = Memory(process.pid)
    try:
        started = time.perf_counter()
        wait_for_port(port, process, log_path, args.workers)
        boot_s = time.perf_counter() - started
        memory.start()
        after_boot = memory.snapshot()
        cold_login_s = client.login(database)  # first request that needs the registry: cold load + authentication
        after_cold = memory.snapshot()
        cold_first_api_s = client.call(query('/api/v1/finance/invoices', limit=50))[0]
        rows = [measure_route(client, name, path, args.runs, args.workers) for name, path in routes(client, database)]
        for row in rows:
            sys.stderr.write('%-45s p50 %s max %s n=%d errors=%d\n' % (
                row['route'], row['p50_s'], row['max_s'], row['samples'], row['errors']))
        after_run = memory.snapshot()
    finally:
        memory.stop()
        stop_odoo(process)
    attach_queries(rows, log_path.read_text(encoding='utf-8', errors='replace'))
    result = {
        'database': database, 'workers': args.workers, 'runs': args.runs, 'boot_s': round(boot_s, 2),
        'cold_login_s': round(cold_login_s, 3), 'cold_first_api_s': round(cold_first_api_s, 3),
        'rss_mib_after_boot': mib(after_boot), 'rss_mib_after_cold': mib(after_cold),
        'rss_mib_after_run': mib(after_run), 'rss_mib_peak': mib(memory.peaks), 'routes': rows,
    }
    text = json.dumps(result, indent=2)
    if args.output:
        Path(args.output).write_text(text + '\n', encoding='utf-8')
    sys.stdout.write(text + '\n')


if __name__ == '__main__':
    main()
