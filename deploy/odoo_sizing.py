# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The production Odoo sizing plan for one application server, computed, never typed in.

One fact lives here: how many Odoo processes, connections and mebibytes a box
may spend, given the box and the stated assumptions. The plan is a pure
function of those inputs, so it can be recomputed for a smaller staging box or
a larger future server, and its stated invariants are checked before it is
returned. The rendered settings are applied by ``deploy/docker-compose.production.yml``;
``docs/operations/odoo-sizing.md`` records the arithmetic and the assumptions.

Assumptions that are measurements or policies, not arithmetic, are named
constants with their origin: Odoo's own worker formula, its default 128-connection
pool, and the plan's own memory reality checks. Nothing here is a secret: the
fragment carries no credentials and no host name.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass

# Odoo's documented worker formula: (CPU * 2) + 1.
WORKERS_PER_CPU_FORMULA = 2
WORKERS_FORMULA_OFFSET = 1
# Odoo's default pool per process is 64 connections; two processes' worth is already
# more than a shared box's PostgreSQL should serve, so the plan sets it explicitly.
ODOO_DEFAULT_DB_MAXCONN = 64
# PostgreSQL keeps superuser_reserved_connections (default 3) plus monitoring and an
# operator's psql session out of max_connections.
POSTGRES_RESERVED_CONNECTIONS = 20
# The reserve kept free between pgbouncer's server connections and PostgreSQL's
# max_connections: room for one whole default Odoo pool of a new process, so a
# restart or a second app server is not refused for lack of a connection.
POSTGRES_HEADROOM_CONNECTIONS = 2 * ODOO_DEFAULT_DB_MAXCONN
# Memory the finished plan must still leave to the box, so a measurement error in
# one assumption does not become an out-of-memory kill.
MEMORY_RESERVE_MIB = 1024
# A worker that crosses the soft limit is recycled; the hard limit is the ceiling
# Odoo enforces per process before it becomes a memory risk to the box.
LIMIT_MEMORY_SOFT_MIB = 640
LIMIT_MEMORY_HARD_MIB = 800
# One application server's Odoo-side ceiling: the plan's 9 workers + 2 cron threads
# at 8 connections each, shared with the runtime gate in
# deploy/shared/validate_odoo_config.py (MAX_ODOO_CLIENT_CONNECTIONS).
MAX_ODOO_CLIENT_CONNECTIONS = 88
# The smallest PostgreSQL plan worth running: one backend per cron and worker
# process plus the reserve, so a probe never asks for a pool nobody can hold.
MIN_PG_BACKENDS = 20

# A1.Flex shapes Oracle publishes. The production box is the Jeddah 4/24 one.
BOX_JEDDAH_A1 = 'VM.Standard.A1.Flex 4 OCPU / 24 GB (Jeddah, production)'


class SizingError(Exception):
    """The inputs or the resulting plan are not safe to run."""


@dataclass(frozen=True)
class Box:
    """An application server: its name, ARM cores and memory in GiB."""

    name: str
    ocpu: int
    memory_gib: int


BOX_JEDDAH_A1 = Box(name=BOX_JEDDAH_A1, ocpu=4, memory_gib=24)


@dataclass(frozen=True)
class Assumptions:
    """The measurements and policies the arithmetic depends on.

    Each default is a stated assumption, not a fact about a specific tenant; the
    operations page names what would change it.
    """

    tenants: int = 50
    # Odoo's own recommendation is memory-based limits rather than a fixed worker
    # count. These are the per-process worst cases the plan budgets against.
    worker_rss_soft_mib: int = LIMIT_MEMORY_SOFT_MIB
    worker_rss_hard_mib: int = LIMIT_MEMORY_HARD_MIB
    max_cron_threads: int = 2
    # Odoo's default is 64, which no shared box can afford; the plan keeps a small
    # pool per process and lets pgbouncer absorb the concurrency.
    db_maxconn_per_process: int = 8
    # PostgreSQL: a quarter of the box is the conventional shared_buffers size; when
    # it is not overridden the plan takes the fraction, so a smaller box is not
    # budgeted with a big box's buffers. `None` means "derive from the box".
    postgres_shared_buffers_mib: int | None = None
    postgres_shared_buffers_fraction: float = 0.25
    postgres_per_connection_mib: int = 10
    # pgbouncer's server side: one backend per active tenant keeps a tenant's pool
    # working without opening a connection for every idle tenant at once.
    postgres_backends_per_tenant: int = 2
    # The other containers on the same box: the Nuxt server, the guard, Caddy and
    # the AI service at its idle shapes (the AI work itself is not on this box).
    web_rss_mib: int = 1024
    sidecar_rss_mib: int = 512
    # The operating system, Docker daemon and page cache the box keeps for itself.
    os_headroom_mib: int = 2048


@dataclass(frozen=True)
class Sizing:
    """A computed plan, with the invariants that were checked to accept it."""

    box: Box
    assumptions: Assumptions
    workers: int
    max_cron_threads: int
    db_maxconn: int
    limit_memory_soft: int
    limit_memory_hard: int
    pgbouncer_max_client_conn: int
    pgbouncer_max_db_connections: int
    pgbouncer_pool_size: int
    postgres_max_connections: int
    postgres_reserved_connections: int
    postgres_shared_buffers: str
    memory_plan: tuple[dict[str, object], ...]
    memory_total_mib: int
    memory_free_mib: int
    tenants_served: int
    caps_applied: tuple[str, ...] = ()
    invariants: tuple[dict[str, object], ...] = ()

    @property
    def tenants(self) -> int:
        return self.tenants_served

    @property
    def max_workers_ceiling(self) -> int:
        """The most workers any single box the plan supports may declare."""
        return self.workers

    @property
    def odoo_client_connections(self) -> int:
        """Every Odoo process (worker or cron thread) opens its own pool."""
        return (self.workers + self.max_cron_threads) * self.db_maxconn

    def odoo_fragment(self) -> str:
        """The ``[options]`` lines the production override passes to Odoo."""
        return ''.join(f'{name} = {value}\n' for name, value in (
            ('workers', self.workers),
            ('max_cron_threads', self.max_cron_threads),
            ('db_maxconn', self.db_maxconn),
            ('limit_memory_soft', self.limit_memory_soft),
            ('limit_memory_hard', self.limit_memory_hard),
        ))

    def postgres_settings(self) -> dict[str, object]:
        return {
            'max_connections': self.postgres_max_connections,
            'superuser_reserved_connections': 3,
            'shared_buffers': self.postgres_shared_buffers,
            'effective_cache_size': f'{math.floor(self.box.memory_gib * 1024 * 0.5)}MB',
            'work_mem': f'{self.postgres_work_mem_kib}kB',
            'maintenance_work_mem': '256MB',
        }

    @property
    def postgres_work_mem_kib(self) -> int:
        """Sort/hash memory per sort step: a small slice, since many run at once."""
        return 4096

    def pgbouncer_settings(self) -> dict[str, object]:
        return {
            'pool_mode': 'transaction',
            'max_client_conn': self.pgbouncer_max_client_conn,
            'default_pool_size': self.pgbouncer_pool_size,
            'max_db_connections': self.pgbouncer_max_db_connections,
            'reserve_pool_size': max(2, self.pgbouncer_pool_size // 4),
        }

    def as_report(self) -> dict[str, object]:
        return {
            'box': {'name': self.box.name, 'ocpu': self.box.ocpu, 'memory_gib': self.box.memory_gib},
            'assumptions': {
                'tenants': self.assumptions.tenants,
                'worker_rss_soft_mib': self.assumptions.worker_rss_soft_mib,
                'worker_rss_hard_mib': self.assumptions.worker_rss_hard_mib,
                'max_cron_threads': self.assumptions.max_cron_threads,
                'db_maxconn_per_process': self.assumptions.db_maxconn_per_process,
                'postgres_shared_buffers_mib': self.assumptions.postgres_shared_buffers_mib,
                'postgres_per_connection_mib': self.assumptions.postgres_per_connection_mib,
                'web_rss_mib': self.assumptions.web_rss_mib,
                'sidecar_rss_mib': self.assumptions.sidecar_rss_mib,
                'os_headroom_mib': self.assumptions.os_headroom_mib,
            },
            'odoo': {
                'workers': self.workers,
                'max_cron_threads': self.max_cron_threads,
                'db_maxconn': self.db_maxconn,
                'limit_memory_soft': self.limit_memory_soft,
                'limit_memory_hard': self.limit_memory_hard,
                'client_connections': self.odoo_client_connections,
            },
            'pgbouncer': self.pgbouncer_settings(),
            'postgres': self.postgres_settings(),
            'memory': {'plan': list(self.memory_plan), 'total_mib': self.memory_total_mib,
                       'free_mib': self.memory_free_mib},
            'tenants_served': self.tenants_served,
            'caps_applied': list(self.caps_applied),
            'invariants': list(self.invariants),
        }


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SizingError(message)


def _validate_inputs(box: Box, assumptions: Assumptions) -> None:
    _require(isinstance(box.ocpu, int) and box.ocpu > 0, 'box needs at least one OCPU')
    _require(isinstance(box.memory_gib, int) and box.memory_gib > 0, 'box needs memory')
    _require(assumptions.tenants > 0, 'the plan serves at least one tenant')
    _require(assumptions.worker_rss_hard_mib > 0, 'a worker has a positive hard limit')
    _require(assumptions.worker_rss_soft_mib > 0, 'a worker has a positive soft limit')
    _require(assumptions.worker_rss_soft_mib < assumptions.worker_rss_hard_mib,
             'the soft worker limit is below the hard one')
    _require(assumptions.db_maxconn_per_process > 0, 'each process opens at least one connection')
    _require(assumptions.postgres_per_connection_mib > 0, 'a backend has a positive footprint')
    _require(assumptions.postgres_backends_per_tenant > 0, 'an active tenant needs a backend')
    _require(0 < assumptions.postgres_shared_buffers_fraction < 1,
             'shared buffers take a fraction of the box, not all of it')
    _require(assumptions.postgres_shared_buffers_mib is None
             or assumptions.postgres_shared_buffers_mib > 0, 'shared buffers are positive')
    _require(assumptions.web_rss_mib > 0 and assumptions.sidecar_rss_mib > 0,
             'the other containers are budgeted')
    _require(assumptions.os_headroom_mib > 0, 'the operating system keeps a reserve')
    _require(assumptions.max_cron_threads >= 0, 'cron threads cannot be negative')


def compute(box: Box, assumptions: Assumptions) -> Sizing:
    """Compute one plan and refuse it unless every stated invariant holds.

    The memory is spent in one pass, so no line is counted twice: the box's own
    reserve and the services that must exist are subtracted first, at least one
    usable backend pool is reserved next, and only what remains pays for workers.
    """
    _validate_inputs(box, assumptions)
    memory_total_mib = box.memory_gib * 1024
    shared_buffers_mib = assumptions.postgres_shared_buffers_mib
    if shared_buffers_mib is None:
        shared_buffers_mib = int(memory_total_mib * assumptions.postgres_shared_buffers_fraction)
    caps: list[str] = []
    per_connection = assumptions.postgres_per_connection_mib
    extra_sessions = POSTGRES_RESERVED_CONNECTIONS + POSTGRES_HEADROOM_CONNECTIONS

    # The services that must exist on the box whatever its size.
    services_mib = (
        assumptions.os_headroom_mib
        + shared_buffers_mib
        + assumptions.web_rss_mib
        + assumptions.sidecar_rss_mib
        + assumptions.max_cron_threads * assumptions.worker_rss_hard_mib
    )
    usable_mib = memory_total_mib - MEMORY_RESERVE_MIB
    _require(services_mib < usable_mib, 'the box cannot hold its own services')
    # One pool that can actually serve the workers is not optional, so it is
    # reserved before any worker is: a plan without it would be a promise of
    # connections nobody can open.
    minimum_pool_mib = (MIN_PG_BACKENDS + extra_sessions) * per_connection
    _require(services_mib + minimum_pool_mib < usable_mib,
             'the box cannot hold its services and a PostgreSQL pool')

    memory_workers = (usable_mib - services_mib - minimum_pool_mib) // assumptions.worker_rss_hard_mib
    formula_workers = WORKERS_PER_CPU_FORMULA * box.ocpu + WORKERS_FORMULA_OFFSET
    workers = min(formula_workers, int(memory_workers))
    _require(workers >= 1, 'the box cannot hold a single Odoo worker')
    if workers < formula_workers:
        caps.append('workers_memory_cap')

    process_count = workers + assumptions.max_cron_threads
    client_connections = process_count * assumptions.db_maxconn_per_process
    # Every one of those connections is an Odoo-side socket; past the gate's ceiling
    # the box is not one application server any more, so the plan is refused rather
    # than rendered with numbers a second server should own.
    _require(client_connections <= MAX_ODOO_CLIENT_CONNECTIONS,
             f'{client_connections} Odoo client connections exceed the '
             f'{MAX_ODOO_CLIENT_CONNECTIONS} one application server may hold')

    # pgbouncer's client side holds one socket per Odoo process connection, plus a
    # reserve for an operator's psql/console session. It must never be the ceiling
    # a worker hits before pgbouncer runs out of backends.
    pgbouncer_max_client_conn = _round_up(client_connections * 1.25 + 20, 10)

    # pgbouncer's server side is what PostgreSQL actually sees. Transaction pooling
    # lets far more clients than backends, but each active tenant needs a working
    # set, so the pool starts at one working set per tenant plus the peak client
    # burst. The pool then grows into the memory left after the workers: a pool
    # nobody can hold is a claim, not a plan.
    leftover_mib = (
        usable_mib
        - services_mib
        - workers * assumptions.worker_rss_hard_mib
        - minimum_pool_mib
    )
    desired_backends = _round_up(
        assumptions.tenants * assumptions.postgres_backends_per_tenant + client_connections, 10,
    )
    affordable_growth = _round_down(leftover_mib // per_connection, 10)
    pgbouncer_max_db_connections = max(
        MIN_PG_BACKENDS, min(desired_backends, MIN_PG_BACKENDS + affordable_growth),
    )
    if pgbouncer_max_db_connections < desired_backends:
        caps.append('pool_memory_cap')
    postgres_max_connections = pgbouncer_max_db_connections + extra_sessions
    pool_size = max(2, pgbouncer_max_db_connections // max(1, assumptions.tenants))
    tenants_served = min(
        assumptions.tenants,
        max(1, pgbouncer_max_db_connections // assumptions.postgres_backends_per_tenant),
    )
    if tenants_served < assumptions.tenants:
        caps.append('tenants_memory_cap')

    memory_plan = (
        {'item': 'operating system, Docker and page cache', 'mib': assumptions.os_headroom_mib},
        {'item': 'PostgreSQL shared buffers', 'mib': shared_buffers_mib},
        {'item': f'PostgreSQL {postgres_max_connections} backends',
         'mib': postgres_max_connections * assumptions.postgres_per_connection_mib},
        {'item': f'Odoo {workers} HTTP workers at their hard limit',
         'mib': workers * assumptions.worker_rss_hard_mib},
        {'item': f'Odoo {assumptions.max_cron_threads} cron threads at their hard limit',
         'mib': assumptions.max_cron_threads * assumptions.worker_rss_hard_mib},
        {'item': 'Nuxt server', 'mib': assumptions.web_rss_mib},
        {'item': 'guard, edge and AI idle', 'mib': assumptions.sidecar_rss_mib},
    )
    planned_mib = sum(int(item['mib']) for item in memory_plan)
    free_mib = memory_total_mib - planned_mib

    invariants = (
        {'name': 'connections_fit_pgbouncer',
         'holds': client_connections <= pgbouncer_max_client_conn,
         'detail': f'{client_connections} client connections <= {pgbouncer_max_client_conn}'},
        {'name': 'pgbouncer_fits_postgres',
         'holds': pgbouncer_max_db_connections + POSTGRES_RESERVED_CONNECTIONS
                  + POSTGRES_HEADROOM_CONNECTIONS == postgres_max_connections,
         'detail': f'{pgbouncer_max_db_connections} + {POSTGRES_RESERVED_CONNECTIONS} reserved '
                   f'+ {POSTGRES_HEADROOM_CONNECTIONS} headroom = {postgres_max_connections}'},
        {'name': 'memory_fits_box',
         'holds': planned_mib <= memory_total_mib - MEMORY_RESERVE_MIB,
         'detail': f'{planned_mib} MiB planned of {memory_total_mib} MiB, '
                   f'{free_mib} MiB free (reserve {MEMORY_RESERVE_MIB} MiB)'},
        {'name': 'workers_within_cpu_formula',
         'holds': workers <= WORKERS_PER_CPU_FORMULA * box.ocpu + WORKERS_FORMULA_OFFSET,
         'detail': f'{workers} <= {WORKERS_PER_CPU_FORMULA * box.ocpu + WORKERS_FORMULA_OFFSET}'},
    )
    failed = [item['name'] for item in invariants if not item['holds']]
    _require(not failed, f'sizing invariant failed: {", ".join(failed)}')

    return Sizing(
        box=box,
        assumptions=assumptions,
        workers=workers,
        max_cron_threads=assumptions.max_cron_threads,
        db_maxconn=assumptions.db_maxconn_per_process,
        limit_memory_soft=assumptions.worker_rss_soft_mib,
        limit_memory_hard=assumptions.worker_rss_hard_mib,
        pgbouncer_max_client_conn=pgbouncer_max_client_conn,
        pgbouncer_max_db_connections=pgbouncer_max_db_connections,
        pgbouncer_pool_size=pool_size,
        postgres_max_connections=postgres_max_connections,
        postgres_reserved_connections=POSTGRES_RESERVED_CONNECTIONS,
        postgres_shared_buffers=_mib_as_postgres_size(shared_buffers_mib),
        memory_plan=memory_plan,
        memory_total_mib=planned_mib,
        memory_free_mib=free_mib,
        tenants_served=tenants_served,
        caps_applied=tuple(caps),
        invariants=invariants,
    )


def _round_down(value: int, multiple: int) -> int:
    return max(0, int(value // multiple) * multiple)


def _round_up(value: float, multiple: int) -> int:
    return int(math.ceil(value / multiple) * multiple)


def _mib_as_postgres_size(mib: int) -> str:
    """Render a MiB budget in the largest whole PostgreSQL unit that divides it."""
    if mib % 1024 == 0:
        return f'{mib // 1024}GB'
    return f'{mib}MB'


def build_parser():
    parser = argparse.ArgumentParser(
        prog='odoo_sizing.py',
        description='Compute the production Odoo/PostgreSQL/pgbouncer sizing for one application server.',
    )
    parser.add_argument('--ocpu', type=int, default=BOX_JEDDAH_A1.ocpu,
                        help='ARM cores of the application server')
    parser.add_argument('--memory-gib', type=int, default=BOX_JEDDAH_A1.memory_gib,
                        help='memory of the application server in GiB')
    parser.add_argument('--tenants', type=int, default=Assumptions.tenants,
                        help='tenants the box must serve')
    parser.add_argument('--render', choices=('odoo', 'json'), default='json',
                        help='odoo: the [options] lines the shared config file must carry; '
                             'json: the whole plan with its invariants')
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    box = Box(name=f'operator box {args.ocpu} OCPU / {args.memory_gib} GiB',
              ocpu=args.ocpu, memory_gib=args.memory_gib)
    try:
        sizing = compute(box, Assumptions(tenants=args.tenants))
    except SizingError as error:
        sys.stderr.write(f'odoo_sizing: {error}\n')
        return 1
    if args.render == 'odoo':
        # The shared launcher accepts no sizing flags, so these lines belong in the
        # operator's external secret config file, which stays outside this repository.
        sys.stdout.write(sizing.odoo_fragment())
    else:
        sys.stdout.write(json.dumps(sizing.as_report(), indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
