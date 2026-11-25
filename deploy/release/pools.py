"""The pools one host serves: their ids and order, the directory each one keeps its state in, and the tenant capacity.

A pool is the unit a release upgrades and rolls back on its own (owner decisions 2026-11-25): pools upgrade in
sequence with the owner's own pool first, a failing pool stops the remaining ones and rolls back only itself, and a
pool that already committed keeps the new release. One host serves one pool today (``pools_per_host_unsupported``):
a second pool needs its own rendered stack, its own ports and its own subnet in ``deploy/stack/compose.yml``, so a
config that declares two is refused rather than run against one host-wide stack. The list, the owner, the order and
one state directory per pool are already the shape a second pool needs, and the tests drive ``Plan`` directly with
three pools, so that day is a renderer and a ports allocation, not a rewrite.

The state of one pool lives in ``<pool root>/<id>/state/``, together with that pool's own ``current`` symlink under
``<pool root>/<id>/``. ``/opt/liwan/current`` stays the host-wide path the job command is run from and keeps pointing
at the owner pool's checkout.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from deploy.odoo_sizing import DEFAULT_TENANT_CAPACITY, TENANT_CAPACITY_CEILING
from deploy.release.common import EXIT_REFUSED, ReleaseError

POOL_ID = re.compile(r'^[a-z][a-z0-9]{0,15}$')
# The three release config keys (`/etc/liwan-release/<env>.env`); the capacity is a shared env file key.
POOLS_KEY, OWNER_POOL_KEY, POOL_ROOT_KEY = 'LIWAN_RELEASE_POOLS', 'LIWAN_RELEASE_OWNER_POOL', 'LIWAN_RELEASE_POOL_ROOT'
CAPACITY_KEY = 'LIWAN_TENANT_CAPACITY'
DEFAULT_POOL = 'default'
# The legacy state of a host that predates pools is moved into its one pool's state directory, except these two entries
# of the environment directory: the one run-per-environment lock and the pool root that now holds the state.
RESERVED_STATE = ('lock', 'pools')


@dataclass(frozen=True)
class PoolPaths:
    """One pool's directory: its state files, the maintenance directory its own render mounts, and its ``current`` link."""

    id: str
    root: Path

    @property
    def state(self) -> Path:
        return self.root / 'state'

    @property
    def release_env(self) -> Path:
        return self.state / 'release.env'

    @property
    def maintenance(self) -> Path:
        """The directory ``LIWAN_MAINTENANCE_DIR`` of this pool's compose invocation names."""
        return self.state / 'maintenance'

    @property
    def marker(self) -> Path:
        """While this file exists, only this pool's edge shows the maintenance page."""
        return self.maintenance / 'active'

    @property
    def current(self) -> Path:
        return self.root / 'current'


@dataclass(frozen=True)
class Plan:
    """The pools of one environment: the ids in config order, the owner upgraded first, and the order that follows."""

    ids: tuple[str, ...]
    owner: str
    order: tuple[str, ...]
    root: Path

    def paths(self, pool_id: str) -> PoolPaths:
        if pool_id not in self.ids:
            raise ReleaseError('unknown_pool', EXIT_REFUSED,
                               f'{pool_id!r} is not one of the pools of this environment: {", ".join(self.ids)}')
        return PoolPaths(pool_id, self.root / pool_id)

    def ordered_paths(self) -> list[PoolPaths]:
        return [self.paths(pool_id) for pool_id in self.order]

    @property
    def owner_paths(self) -> PoolPaths:
        return self.paths(self.owner)


def _ids(value: str | None) -> tuple[str, ...]:
    """The configured pool ids; no key at all is the one pool every host serves today."""
    raw = (value or '').strip()
    if not raw:
        return (DEFAULT_POOL,)
    ids = [item.strip() for item in raw.split(',')]
    if any(not POOL_ID.fullmatch(item) for item in ids) or len(set(ids)) != len(ids):
        raise ReleaseError('invalid_pools', EXIT_REFUSED,
                           f'{POOLS_KEY} is a comma-separated list of distinct pool ids ({POOL_ID.pattern})')
    return tuple(ids)


def _inside_environment(path: Path, environment_dir: Path, default_root: Path) -> bool:
    """Whether ``path`` lies inside ``environment_dir`` under any shape other than ``default_root``."""
    return path.is_relative_to(environment_dir) and path != default_root


def plan(config: dict, environment: str, state_root: Path) -> Plan:
    """The pools of one environment, or a refusal before anything stops: a malformed list, an owner outside it, a pool
    root inside the environment directory under a name other than ``pools``, or a second pool this host cannot render yet."""
    ids = _ids(config.get(POOLS_KEY))
    owner = (config.get(OWNER_POOL_KEY) or '').strip() or ids[0]
    if owner not in ids:
        raise ReleaseError('owner_pool_missing', EXIT_REFUSED,
                           f'{OWNER_POOL_KEY}={owner!r} is not one of {POOLS_KEY}={",".join(ids)}')
    if len(ids) > 1:
        raise ReleaseError('pools_per_host_unsupported', EXIT_REFUSED,
                           f'{POOLS_KEY} declares {len(ids)} pools; one host renders one stack, so it serves one pool '
                           f'until the stack it renders has a service set and ports per pool')
    configured = (config.get(POOL_ROOT_KEY) or '').strip()
    environment_dir = state_root / environment
    default_root = environment_dir / 'pools'
    root = Path(configured) if configured else default_root
    if not root.is_absolute():
        raise ReleaseError('invalid_pools', EXIT_REFUSED, f'{POOL_ROOT_KEY} must be an absolute directory, not {configured!r}')
    root_norm = Path(os.path.normpath(root))
    env_norm = Path(os.path.normpath(environment_dir))
    if (_inside_environment(root_norm, env_norm, env_norm / 'pools')
            or _inside_environment(root.resolve(), environment_dir.resolve(), default_root.resolve())):
        raise ReleaseError('invalid_pools', EXIT_REFUSED,
                           f'{POOL_ROOT_KEY} inside {environment_dir} may only be the default {default_root}, '
                           f'not {configured!r}')
    return Plan(ids=ids, owner=owner, order=(owner, *[pool_id for pool_id in ids if pool_id != owner]), root=root_norm)


def legacy_clash_error(environment_dir: Path, pool_state: Path, clashes: list[str]) -> ReleaseError:
    """The one refusal wording when both the pre-pool directory and the pool state hold the same entry."""
    return ReleaseError('legacy_state_ambiguous', EXIT_REFUSED,
                        f'{environment_dir} and {pool_state} both hold {", ".join(clashes)}: keep one set')


def capacity(config: dict) -> int:
    """The tenants one pool may serve: ``LIWAN_TENANT_CAPACITY`` of the shared env file, or the plan's default.

    The ceiling is the registry LRU bound at ``limit_memory_soft`` 640 MiB (``odoo/service/server.py:1556-1562``): past
    it a pool evicts a registry it will have to load again. The number itself lives in ``deploy/odoo_sizing.py``.
    """
    raw = (config.get(CAPACITY_KEY) or '').strip()
    if not raw:
        return DEFAULT_TENANT_CAPACITY
    if not re.fullmatch(r'[0-9]+', raw) or not 1 <= int(raw) <= TENANT_CAPACITY_CEILING:
        raise ReleaseError('invalid_tenant_capacity', EXIT_REFUSED,
                           f'{CAPACITY_KEY} is a whole number from 1 to {TENANT_CAPACITY_CEILING}')
    return int(raw)


def migrate(environment_dir: Path, plan: Plan, log, *, current: Path, resume_unfinished: bool = False) -> list[tuple[Path, Path]]:
    """Move the state of a host that predates pools into its one pool's state directory, before anything stops.

    The host serves one pool today, so its environment directory is the legacy state of that pool: the migration moves
    every entry (``served.json``, ``release.env``, ``failed.json``, ``halted.json``, the release records, the docker
    config, the source repository) into ``<pool>/state/`` and seeds the pool's ``current`` link from the host's, so the
    served release is read as served and never as a first deploy. The link is seeded whether or not anything moved, so a
    run that died between the last move and the link is repaired by the next one, which has nothing to move and only
    links. Anything ambiguous is refused instead: a second pool in the config, a pool state that already exists beside
    the legacy one, an entry that would overwrite a pool state file, or an unfinished legacy run that only ``rollback``
    may finish (it migrates with ``resume_unfinished``).
    """
    if not environment_dir.is_dir():
        return []  # a fresh host: the first release creates the pool's state directory
    pool = plan.owner_paths
    entries = sorted(entry for entry in environment_dir.iterdir() if entry.name not in RESERVED_STATE)
    # Seed when missing or dangling; leave a working link or a non-symlink alone (require_symlink refuses a non-symlink).
    seed = current.is_symlink() and current.exists() and not pool.current.exists()
    if not entries and not seed:
        return []  # already migrated, or nothing was ever written
    if entries and len(plan.ids) != 1:
        raise ReleaseError('legacy_state_ambiguous', EXIT_REFUSED,
                           f'{environment_dir} holds the state of a host that predates pools and the config declares '
                           f'{len(plan.ids)} pools ({", ".join(plan.ids)}); leave one pool for this release')
    clashes = [entry.name for entry in entries if os.path.lexists(pool.state / entry.name)]
    if clashes:
        raise legacy_clash_error(environment_dir, pool.state, clashes)
    if any(entry.name == 'run.json' for entry in entries) and not resume_unfinished:
        raise ReleaseError('legacy_state_ambiguous', EXIT_REFUSED,
                           f'{environment_dir / "run.json"} is an unfinished run that predates the pool state; '
                           'run "rollback" to finish it first')
    moved = []
    if entries:
        pool.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        pool.state.chmod(0o700)
        for entry in entries:
            target = pool.state / entry.name
            os.replace(entry, target)
            moved.append((entry, target))
    if seed:
        target = current.resolve(strict=True)
        pool.current.parent.mkdir(parents=True, exist_ok=True)
        if pool.current.is_symlink():
            temp = pool.current.with_name(f'.{pool.current.name}.{os.getpid()}.tmp')
            temp.unlink(missing_ok=True)
            temp.symlink_to(target)
            try:
                os.replace(temp, pool.current)
            except BaseException:
                temp.unlink(missing_ok=True)
                raise
        else:
            pool.current.symlink_to(target)
    for source, target in moved:
        log(f'migrated {source.name} -> {target}')
    return moved
