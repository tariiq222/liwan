# Finance and HR performance baseline - 2026-10-19

> **Indicative only. Single run, loaded host (load average 27-33 on 14 cores, other agents' CI and Odoo runs
> shared the machine), scale 0.25, n=10 per route, so p95 equals max and is not reported.** Treat every number as
> an order of magnitude, not a benchmark. A re-measurement on a quiet host, after the general-ledger rewrite,
> is planned; the tools were hardened after this run (see "Tool changes since the run").

Measurement only: no product code, tuning or architecture file was changed. Tools in `tools/perf/`
(`odoo_launch.py`, `run_seed.py` + `seed_finance.py`, `measure.py`), tests in `tools/test_perf.py`.
Branch `codex/tools-perf-baseline` from `main` d6d4787b. The scratch database was dropped afterwards.

## Environment and scale

| Item | Value |
| --- | --- |
| Machine | Apple M4 Pro, 14 cores, 24 GiB; PostgreSQL 16.14 (Homebrew, local); Python 3.9 launcher, Odoo venv for Odoo |
| Odoo | 19.0 at commit 34eed49d88f0f4357e1f54fe82cb0ad280939572 |
| OCA pins | account-financial-reporting 0078bc03, account-financial-tools ddcabb93, account-reconcile 8fc48a4b, mis-builder 7d519f31, reporting-engine b9e8c6cd, server-ux 2e040168 (`deploy/oca-addons.json`) |
| Load during the run | 27-33 on 14 cores (shared host) |
| Seed scale | **0.25** of the full target, not 1.0 |
| Seeded data | 1 Saudi company (l10n_sa chart), 75 employees, 575 partners, 30,000 customer invoices + 5,000 vendor bills posted over 2025-11-01..2026-10-19, payments for 70% (24,500), 5 assets, one budget (~30 lines) |
| Resulting size | 59,500 posted moves, **189,000 move lines**, database 314 MB |
| Full scale | The full target (120,000 invoices + 20,000 bills) would be about 4x this: roughly **760k move lines** (an earlier estimate of "500k+" in the seed docstring was low and is corrected) |
| Odoo run shape | `--workers=2 --max-cron-threads=0`, no `-d` (like the shared http role: each worker loads the registry on its first request); also one `--workers=0` run |
| Sampling | 10 timed calls per route after one discarded call (old tool version) |
| User | seeded finance manager with finance-manager and HR-manager roles |

Why 0.25: a full-scale seed was started and abandoned. Customer invoices ran at 57/s falling to 41/s (120k would
take roughly an hour), and payments through `account.payment.register` dominate: at 0.25 they took 4,488 s for
24,500 payments (~5.5/s), so full scale would be around 5 h for payments alone (extrapolated, not measured).
Seed phases at 0.25: company 6 s, employees 32 s, partners <1 s, customer invoices 797 s (37.6/s), vendor bills
93 s (53.6/s), payments 4,488 s, assets and budget <1 s, total 5,417 s. A full-scale dataset would probably need a
SQL-level loader.

## Results (seconds, workers=2, n=10: p50 and max only)

Queries and SQL time come from Odoo's request log line. "Python" is the log's non-SQL remainder of the request.

| Route | p50 | max | SQL queries | SQL time p50 | Remainder p50 |
| --- | --- | --- | --- | --- | --- |
| invoices list page 1 | 0.07 | 0.93 | 22 | 0.05 | 0.02 |
| invoices list page 50 (offset 2450) | 0.35 | 1.47 | 22 | 0.21 | 0.05 |
| invoices list q search | 0.17 | 0.60 | not joined (URL encoding mismatch in the old tool) | | |
| invoices list state=posted | 0.10 | 0.92 | 22 | 0.07 | 0.03 |
| invoice detail | 0.05 | 0.12 | 31 | 0.03 | 0.02 |
| payments list | 0.06 | 0.08 | 22 | 0.04 | 0.02 |
| entries list | 0.08 | 0.10 | 17 | 0.07 | 0.01 |
| partners list / q search | 0.03 / 0.03 | 0.05 / 0.09 | 21 | 0.01 | 0.01 |
| report vat (12 months / 1 month) | 0.21 / 0.09 | 0.32 / 0.20 | 28 | 0.18 / 0.07 | 0.02 |
| report trial-balance | 1.26 | 1.94 | 36 | 1.23 | 0.03 |
| report general-ledger, busy account, page 1 | 9.58 | 36.57 | 102 | 1.98 | 7.70 |
| report general-ledger, busy account, offset 4950 | 8.14 | 9.85 | 102 | 2.14 | 6.12 |
| report aged-partner-balance | 2.15 | 5.50 | 38 | 0.74 | 1.21 |
| report profit-loss | 0.16 | 0.42 | 43 | 0.13 | 0.03 |
| report balance-sheet | 0.27 | 0.61 | 110 | 0.20 | 0.07 |
| report zakat-base | 0.28 | 0.39 | 77 | 0.22 | 0.05 |
| report budget-vs-actual | 0.12 | 0.19 | 27 | 0.10 | 0.02 |
| report analytic (no analytic lines seeded) | 0.05 | 0.08 | 24 | 0.03 | 0.02 |
| fiscal-years | 0.29 | 0.76 | 22 | 0.27 | 0.02 |
| assets list | 0.05 | 0.16 | 20 | 0.03 | 0.02 |
| hr employees list (50 of 75) | 0.18 | 0.33 | 237 | 0.15 | 0.03 |
| hr expiring | 0.04 | 0.06 | 30 | 0.01 | 0.02 |
| hr saudization | 0.04 | 0.07 | 32 | 0.02 | 0.02 |

The `workers=0` run shows the same ordering with different noise: general-ledger p50 6.75 s (page 1) and 16.5 s
(offset 4950), aged-partner-balance 2.76 s, trial-balance 0.60 s, invoices list page 1 max 1.28 s. Query counts
matched the workers=2 run.

## Routes that exceeded 1 s (max of 10 samples)

| Route | p50 | max | Hypothesis (not verified by profiling) |
| --- | --- | --- | --- |
| general-ledger (page 1 and deep page) | 8-10 s | 9.9-36.6 s | The log attributes most of the time to non-SQL work (5-8 s of 8-10 s). If that holds, cost is per account rather than per page, since a deep page was not cheaper. A profiler run would confirm |
| aged-partner-balance | 2.15 s | 5.5 s | Unpaged response of 78 KB; SQL 0.7 s and remainder 1.2 s |
| trial-balance | 1.26 s | 1.94 s | Mostly SQL (1.2 s); probably linear in move lines |
| invoices list (page 50, page 1 and state filter) | 0.07-0.35 s | 0.9-1.5 s | p50 is low; the max values may be host-load outliers or count/sort cost over 59k moves. Not distinguishable from 10 samples |

Within a factor of 2-3 of 1 s at max, and possibly slower at 4x data if they scale with lines: balance-sheet,
profit-loss, fiscal-years, invoices q search. `hr employees list` runs 237 queries for 50 rows, which looks like
an N+1 pattern; it is cheap at 75 employees.

## Registry and memory (single run, hypotheses about attribution)

| Measure | workers=2 | workers=0 |
| --- | --- | --- |
| Process start to port open | 2.2 s | 1.5 s |
| First request (login) incl. registry cold load, 105 modules | 10.5 s | 4.9 s |
| First API call afterwards | 0.68 s | 0.48 s |
| Idle RSS after start (before any request) | master 20-28 MiB, gevent ~89 MiB | 99 MiB |
| RSS at the end of the run | workers ~66-68 MiB | 77 MiB |
| Peak RSS during the run | workers 390 and 409 MiB, master/gevent 89-97 MiB | 443 MiB |

A loaded registry appears to cost roughly 45-70 MiB per worker (difference between a fresh and an idle-after-use
worker, rough). The ~400 MiB peaks coincided with the general-ledger and aged-partner requests, which suggests
recordset-heavy report code rather than the registry, but the sampler (0.5 s `ps`) does not attribute memory to
requests. Odoo's default limits apply (soft 2 GiB, hard 2.5 GiB per worker, CPU 60 s, real time 120 s). A request
lasting up to 36 s occupies one of the two workers for that time.

## Suggestions for the next round (not applied, to be validated)

1. Re-measure on a quiet host with `--runs 30` or more (p95 needs >= 30 samples) and the hardened tools.
2. Profile the general ledger (Odoo profiler or `--log-sql`) to confirm whether the running balance / opening
   balance is computed in Python over all lines; if so, compute it in SQL for the requested page.
3. Consider SQL aggregation and paging for aged-partner-balance and trial-balance, and caching per company and
   date if re-measurement still shows seconds.
4. For shared SaaS sizing, decide whether long reports share the two workers or use a separate pool or a queue.
5. `registry_lru_size`: if each tenant registry costs about 50-70 MiB per worker, size it as (tenants a worker
   keeps) x that cost; a cold load took 5-10 s here, so warming registries at deploy is worth testing.
6. Check offset paging depth on the invoices list and the N+1 on the HR employees list at larger sizes.

## Tool changes since the run

The numbers above were produced by an earlier version of `measure.py`. After review the tools now: use the
per-database classification fixture and the helpers of `tools/odoo_test.py`; refuse ports that already accept
connections and the dev ports 8069/8072/3000, pass an explicit free `--gevent-port` with workers, and check the
process is still alive when the port opens; report p95 only from 30 samples; warm every worker
(`max(2, 2*workers)` discarded calls per route); time only HTTP 200 samples and count errors; join the request log
on a normalised target and fail when a route has no log sample; refuse to seed a non-scratch database or a
database that already has `Perf Co`; stop Odoo on SIGTERM and show the log tail on early exit; validate `--runs`.
These changes were smoke-tested (scale 0.01 seed, `--runs 3`, workers=2: 26 routes, no errors, every route joined
to log samples). They were not used to re-measure.

## Reproduce

```sh
cd /Users/tariq/code/webvue/.worktrees/tools-perf-baseline   # any checkout with tools/perf
export PERF_ROOT=$(mktemp -d)                                # scratch config, data dir, logs, fixture
export PGHOST=127.0.0.1
DB=webvue_scratch_tools_perf_baseline PORT=8196              # webvue_scratch_* only; PORT must be free (not 8069/8072/3000)
createdb -h 127.0.0.1 $DB
python3 -B tools/oca_addons.py fetch                         # pinned OCA clones (see Environment)
python3 - <<'PY'
import subprocess, sys
sys.path.insert(0, 'tools/perf')
import odoo_launch as o
modules = subprocess.run([sys.executable, '-B', 'tools/catalog_check.py', '--release-modules'],
                         capture_output=True, text=True, check=True).stdout.strip()
cmd = o.odoo_command('', o.require_scratch('webvue_scratch_tools_perf_baseline'),
                     ['-i', modules, '--without-demo=all', '--http-port=8196', '--workers=0',
                      '--max-cron-threads=0', '--stop-after-init'])
subprocess.run(cmd, env=o.odoo_environment('webvue_scratch_tools_perf_baseline'), cwd=str(o.ODOO_ROOT), check=True)
PY
python3 -B tools/perf/run_seed.py --database $DB --scale 0.25      # about 90 min, dominated by payments
python3 -B tools/perf/measure.py --database $DB --port $PORT --workers 2 --runs 30 --output $PERF_ROOT/w2.json
python3 -B tools/perf/measure.py --database $DB --port $PORT --workers 0 --runs 30 --output $PERF_ROOT/w0.json
dropdb -h 127.0.0.1 $DB
```

`run_seed.py` refuses a database without all release modules installed. `measure.py` starts and stops its own
Odoo, takes query counts from Odoo's request log line, and samples RSS of the process tree with `ps` every 0.5 s.
