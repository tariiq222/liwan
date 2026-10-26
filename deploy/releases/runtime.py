"""Local operator adapter joining guard admission, PostgreSQL and stock Odoo.

Only explicit scratch bindings are accepted. Runtime containers are inspected;
source subprocess migrations are reported as local-source evidence, never image proof.
"""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import subprocess
import time
import re
from urllib.request import Request, HTTPRedirectHandler, build_opener
from urllib.parse import urlsplit

from .backup import Deadline, capture_tenant, capture_window, validate_window, _path
from .bounded_http import get_json
from .manifest import load_manifest, manifest_digest
from .migrate import migrate_tenant, verify_tenant
from .runtime_identity import inspect_odoo_runtime
from .source_gate import verify_sources, snapshot_digest
from .postgres import bounded_connection, fence_runtime, fence_writers, validate_runtime_role, identifier, writer_grants
from .state import ReleaseConflict, atomic_json, name, safe_directory


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


CONTAINER_ID = re.compile(r'[a-f0-9]{64}')


def _budget(deadline):
    """Keyword passed to Docker inspectors on backup paths only; release calls stay unchanged."""
    return {} if deadline is None else {'deadline': deadline}


def _docker(argv, deadline, cap, **options):
    """One Docker CLI call: ``cap`` seconds, or only what is left of ``deadline``,
    recomputed at dispatch; a spent budget refuses before the call and a timeout
    past it reports the overrun."""
    try:
        return subprocess.run(argv, check=True, capture_output=True,
                              timeout=cap if deadline is None else deadline.remaining(cap), **options)
    except subprocess.TimeoutExpired:
        if deadline is not None: deadline.remaining()
        raise


class LocalRuntime:
    def __init__(self, state, config, *, connector=None, inspector=None, role_inspector=None, classifier=None, inventory_inspector=None):
        if config.get('mode') != 'local':
            raise ValueError('local_runtime_required')
        if config.get('postgres',{}).get('host') not in {'127.0.0.1','localhost','::1'}:
            raise ValueError('local_postgres_required')
        self.state, self.config = state, config
        self.connector = connector or self._connect
        self.inspector = inspector or self._inspect
        self.role_inspector = role_inspector or inspect_odoo_runtime
        self.classifier = classifier or self._classify
        self.inventory_inspector = inventory_inspector or self._inspect_inventory
        self.proofs = {}
        self.classifications = {}

    def _connect(self, database, **options):
        import psycopg2
        pg = self.config['postgres']
        return psycopg2.connect(dbname=database, host=pg['host'], port=pg['port'], user=pg['adminUser'],
                               **({'passfile': pg['passfile']} if pg.get('passfile') else {}), **options)

    def _tenant(self, binding):
        if not binding['database'].startswith('webvue_scratch_'):
            raise ValueError('protected_database_rejected')
        config = self.config['tenants'][binding['tenantId']]
        if config['database'] != binding['database'] or config['filestore'] != binding['filestore']:
            raise ReleaseConflict('runtime_binding_mismatch')
        return config

    def _role(self, binding, pool):
        return self._tenant(binding)['roles'][name(pool)]

    def _inspect_inventory(self, pool, deadline=None):
        config = self.config['pools'][pool]
        declared = [*config['containers'].values(), *(job['container'] for job in config['cronRuntimes'])]
        if len(declared) != len(set(declared)): raise ReleaseConflict('duplicate_runtime_ownership')
        observed = _docker(['docker','ps','--all','--filter','label=webvue.pool='+name(pool),'--format','{{.Names}}'],
                           deadline, 10, text=True).stdout.splitlines()
        if set(observed) != set(declared): raise ReleaseConflict('runtime_inventory_mismatch')

    def _bind_role(self,binding,pool,*,candidate=False,deadline=None):
        """With ``deadline`` (backup window only) every Docker call it makes gets only
        what is left; release callers pass none and keep the fixed per-call bounds."""
        config=self.config['pools'][pool]
        budget=_budget(deadline)
        self.inventory_inspector(pool,**budget)
        matches=[job for job in config['cronRuntimes'] if job['databases']==[binding['database']]]
        if self.config.get('jobsRequired',True) and len(matches)!=1:
            raise ReleaseConflict('tenant_cron_ownership_missing')
        expected={**config['odooRuntime'],'poolId':pool,'dbUser':self._role(binding,pool)}
        proof=self.role_inspector(config['containers']['odoo'],expected,**budget)
        if proof.get('ready') is not True or proof.get('dbUser')!=expected['dbUser']:
            raise ReleaseConflict('runtime_role_binding_unverified')
        # Every declared cron is bound separately; a stopped cron is allowed only
        # through the explicit operator topology, never inferred from HTTP proof.
        for cron in config['cronRuntimes']:
            cron_expected={**cron['identity'],'poolId':pool,'dbUser':expected['dbUser']}
            if cron['databases'] != [binding['database']]:
                continue
            observed=self.role_inspector(cron['container'],cron_expected,cron_databases=cron['databases'],allow_stopped=True,**budget)
            if observed.get('ready') is not True or observed.get('dbUser')!=expected['dbUser']:
                raise ReleaseConflict('cron_role_binding_unverified')
            if candidate and observed.get('running') is True:
                raise ReleaseConflict('candidate_cron_must_be_stopped')
        return proof

    def _guard_request(self, binding):
        """The release-status URL and headers of the tenant's guard."""
        config = self._tenant(binding)
        url = self.config['guardUrl']
        parsed = urlsplit(url)
        if parsed.scheme != 'http' or parsed.username or parsed.password or parsed.path not in ('', '/'):
            raise ValueError('guard_endpoint_rejected')
        token = Path(self.config['proxyTokenFile']).read_text().strip()
        if len(token) < 32: raise ValueError('guard_token_rejected')
        headers = {'Host': config['host'], 'X-WebVue-Proxy-Token': token,
                   'X-WebVue-Tenant-Revision': str(binding['registryRevision'])}
        return url.rstrip('/') + '/_webvue/release-status', headers

    def _guard(self, binding):
        url, headers = self._guard_request(binding)
        with build_opener(NoRedirect()).open(Request(url, headers=headers), timeout=10) as response:
            return json.load(response)

    def _guard_within(self, binding, deadline):
        """Backup guard read: connect, request, status, headers and body all end by ``deadline``."""
        url, headers = self._guard_request(binding)
        return get_json(url, headers, deadline)

    def acknowledge(self, binding, route, maintenance=False):
        observed = self._guard(binding)
        return {**observed, 'ready': all(observed.get(k) == route[k] for k in ('routeRevision','fence','poolId','releaseId'))
                and observed.get('maintenance') is maintenance}

    def acknowledge_within(self, binding, route, maintenance, deadline):
        """Backup guard acknowledgement on ``deadline``: the whole HTTP exchange gets
        only what is left (each socket operation at most the usual 10 s), so a
        trickled or endless answer cannot outlive it, and an answer obtained past
        it is refused."""
        observed = self._guard_within(binding, deadline)
        deadline.remaining()
        return {**observed, 'ready': all(observed.get(k) == route[k] for k in ('routeRevision','fence','poolId','releaseId'))
                and observed.get('maintenance') is maintenance}

    def _leases(self, binding, old=None):
        directory = self.state.routes / 'leases' / name(binding['tenantId'])
        if not directory.exists(): return []
        safe_directory(directory)
        leases = []
        for path in directory.iterdir():
            if not path.is_file() or path.is_symlink(): raise ReleaseConflict('release_lease_invalid')
            if not path.name.endswith('.json'): continue
            item = json.loads(path.read_text())
            if item.get('tenantId') != binding['tenantId']: raise ReleaseConflict('release_lease_invalid')
            if old is None or item.get('poolId') in (None,'pending',old['poolId']): leases.append(item)
        return leases

    def _owned_cron_jobs(self,binding,pool):
        jobs=[job for job in self.config['pools'][pool]['cronRuntimes'] if job['databases']==[binding['database']]]
        if self.config.get('jobsRequired',True) and len(jobs)!=1:
            raise ReleaseConflict('tenant_cron_ownership_missing')
        return jobs

    def _cron_expected(self,binding,pool,job):
        return {**job['identity'],'poolId':pool,'dbUser':self._role(binding,pool)}

    def _owned_cron_state(self,binding,pool):
        """Observe the inspected container id and running/stopped of every owned cron
        before the backup touches it."""
        observed={}
        for job in self._owned_cron_jobs(binding,pool):
            if job['container'] in observed: raise ReleaseConflict('duplicate_runtime_ownership')
            proof=self._inspect_cron(binding,pool,job)
            observed[job['container']]={'containerId':proof['containerId'],'running':proof['running']}
        return observed

    def _inspect_cron(self,binding,pool,job,container_id=None,deadline=None):
        """One owned cron's identity; with ``container_id`` it must be that exact container.

        A same-name replacement passes image/config/role checks but is not the
        container whose state was recorded, so it refuses instead of being started
        or stopped. With ``deadline`` every Docker inspect/exec gets only what is left.
        """
        expected=self._cron_expected(binding,pool,job)
        proof=self.role_inspector(job['container'],expected,cron_databases=job['databases'],allow_stopped=True,**_budget(deadline))
        if (proof.get('ready') is not True or proof.get('dbUser')!=expected['dbUser'] or type(proof.get('running')) is not bool
                or not isinstance(proof.get('containerId'),str) or not CONTAINER_ID.fullmatch(proof['containerId'])):
            raise ReleaseConflict('cron_role_binding_unverified')
        if container_id is not None and proof['containerId']!=container_id:
            raise ReleaseConflict('cron_container_replaced')
        return proof

    def _set_cron(self,binding,pool,job,container_id,running,deadline):
        """Start or stop exactly the recorded container id, then prove the result on it.

        Every inspect and the start/stop take what is left of ``deadline`` at their
        own dispatch, so nothing starts once the budget is spent.
        """
        if self._inspect_cron(binding,pool,job,container_id,deadline)['running'] is not running:
            _docker(['docker','start' if running else 'stop',container_id],deadline,30)
        if self._inspect_cron(binding,pool,job,container_id,deadline)['running'] is not running:
            raise ReleaseConflict('tenant_cron_start_unverified' if running else 'old_cron_stop_unverified')
        deadline.remaining()

    def _stop_owned_cron(self,binding,pool,previous,deadline):
        """Backup window: stop only the recorded owned crons, by their recorded ids,
        each Docker call capped by what is left of ``deadline``."""
        jobs=self._recorded_cron_jobs(binding,pool,previous)
        for container,job in jobs.items():
            self._set_cron(binding,pool,job,previous[container]['containerId'],False,deadline)
        deadline.remaining()

    def _recorded_cron_jobs(self,binding,pool,previous):
        jobs={job['container']:job for job in self._owned_cron_jobs(binding,pool)}
        # An empty owned set is valid only when the operator topology owns no cron
        # (jobsRequired=False); _owned_cron_jobs already refuses a missing required one.
        if (not isinstance(previous,dict) or set(jobs)!=set(previous)
                or any(not isinstance(item,dict) or set(item)!={'containerId','running'} or type(item['running']) is not bool
                       or not isinstance(item['containerId'],str) or not CONTAINER_ID.fullmatch(item['containerId'])
                       for item in previous.values())):
            raise ReleaseConflict('cron_identity_changed')
        return jobs

    def _writer_roles(self, binding):
        """Every role the tenant's pools may write with, from the operator config.

        A writer the operator did not declare cannot be fenced, so the window
        refuses instead of protecting a subset of the real writers.
        """
        roles = self._tenant(binding).get('roles')
        if not isinstance(roles, dict) or not roles: raise ReleaseConflict('runtime_writer_roles_missing')
        try:
            names = [identifier(role) for role in roles.values()]
        except ValueError:
            raise ReleaseConflict('runtime_writer_roles_invalid') from None
        if len(set(names)) != len(names): raise ReleaseConflict('runtime_writer_roles_duplicate')
        return tuple(sorted(roles.values()))

    def _allowed_principals(self):
        """Closed operator allowance: only the isolation admin and configured principals."""
        allowed = [*(self.config.get('backup', {}).get('allowedPrincipals') or [])]
        admin = self.config.get('postgres', {}).get('adminUser')
        if admin: allowed.append(admin)
        return tuple(allowed)

    def _drain_backup_leases(self, binding, deadline):
        # The lease wait is capped by drainSeconds and by what is left of the budget.
        drain_end = deadline.clock() + deadline.remaining(min(30, self.config.get('drainSeconds', 30)))
        while self._leases(binding):
            if deadline.clock() >= drain_end:
                deadline.remaining()  # an overrun reports the overrun, not an undrained lease
                raise ReleaseConflict('release_writers_not_drained')
            time.sleep(min(0.05, max(0, drain_end - deadline.clock())))

    def _fence_backup_writers(self, binding, route, previous, deadline):
        self._drain_backup_leases(binding, deadline)
        roles = self._writer_roles(binding)
        self._bind_role(binding, route['poolId'], deadline=deadline)
        deadline.remaining()
        if self._role(binding, route['poolId']) not in roles:
            raise ReleaseConflict('runtime_writer_roles_incomplete')
        result = fence_writers({**binding,'fence':route['fence'],'gateClosed':True,'admittedWriters':0,'transactionScope':'tenant'},
            roles, self.connector, deadline=deadline, allowed_principals=self._allowed_principals(),
            drain_seconds=self.config.get('drainSeconds',30))
        if result.get('fenced') is not True: raise ReleaseConflict(result.get('reason','fence_failed'))
        self._stop_owned_cron(binding,route['poolId'],previous['cron'],deadline)
        return {**binding,**result,'gateClosed':True,'admittedWriters':0}

    def _fence(self, binding, route, *, gate_closed):
        deadline=time.monotonic()+min(30,self.config.get('drainSeconds',30))
        while self._leases(binding, None if gate_closed else route):
            if not gate_closed or time.monotonic()>=deadline:
                raise ReleaseConflict('release_writers_not_drained')
            time.sleep(0.05)
        target = self.config['targetPool']
        self._bind_role(binding,route['poolId'])
        self._bind_role(binding,target)
        old_role, new_role = self._role(binding, route['poolId']), self._role(binding, target)
        if old_role == new_role: raise ReleaseConflict('generation_roles_must_differ')
        result = fence_runtime({**binding, 'fence': route['fence'], 'gateClosed': True, 'admittedWriters': 0,'transactionScope':'tenant' if gate_closed else 'old_role'},
            old_role,new_role,self.connector,deadline_seconds=self.config.get('drainSeconds',30))
        if result.get('fenced') is not True: raise ReleaseConflict(result.get('reason','fence_failed'))
        self._stop_old_jobs(binding,route['poolId'])
        return {**binding,**result,'gateClosed':True,'admittedWriters':0}

    def _stop_old_jobs(self,binding,pool):
        # Only after PG has proved zero old connections/transactions. Never kill
        # an active business cron, and never stop a shared multi-tenant process.
        for job in self.config['pools'][pool]['cronRuntimes']:
            if job['databases'] != [binding['database']]: continue
            expected={**job['identity'],'poolId':pool,'dbUser':self._role(binding,pool)}
            observed=self.role_inspector(job['container'],expected,cron_databases=job['databases'],allow_stopped=True)
            if observed.get('running') is True:
                subprocess.run(['docker','stop',name(job['container'])],check=True,capture_output=True,timeout=30)
            stopped=self.role_inspector(job['container'],expected,cron_databases=job['databases'],allow_stopped=True)
            if stopped.get('running') is not False: raise ReleaseConflict('old_cron_stop_unverified')

    def quiesce(self, binding, route):
        if not self.state.routes.joinpath(binding['tenantId'] + '.maintenance').is_file():
            raise ReleaseConflict('maintenance_barrier_missing')
        if not self.acknowledge(binding,route,True)['ready']: raise ReleaseConflict('release_guard_ack_missing')
        proof = self._fence(binding,route,gate_closed=True)
        self.proofs[binding['tenantId']] = proof
        return proof

    def fence_backup(self, binding, route, previous, deadline):
        """Backup-only writer window; release and migrate keep ``quiesce``.

        ``previous`` is the durable intent: the owned crons it recorded are stopped
        by their recorded container ids only. ``deadline`` is the caller's budget,
        never renewed: the guard ACK, lease drain, admin connection, every fence
        statement and the cron stop get only what is left of it.
        """
        if not self.state.routes.joinpath(binding['tenantId'] + '.maintenance').is_file():
            raise ReleaseConflict('maintenance_barrier_missing')
        if not self.acknowledge_within(binding,route,True,deadline)['ready']: raise ReleaseConflict('release_guard_ack_missing')
        previous = self._previous_state(binding, route, previous)
        return self._fence_backup_writers(binding,route,previous,deadline)

    def _recheck(self, binding):
        route = self.state.route(binding['tenantId'])
        if not self.state.routes.joinpath(binding['tenantId'] + '.maintenance').is_file() or self._leases(binding):
            raise ReleaseConflict('maintenance_gate_changed')
        with self.connector(binding['database']) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid() AND (usename=%s OR state<>'idle' OR xact_start IS NOT NULL)) + (SELECT count(*) FROM pg_prepared_xacts WHERE database=%s)",
                    (binding['database'],self._role(binding,route['poolId']),binding['database']))
                if cursor.fetchone()[0]: raise ReleaseConflict('old_connections_remain')
        return self.proofs[binding['tenantId']]

    @contextmanager
    def _window_connection(self, database, deadline):
        """Admin transaction on ``bounded_connection``: connect and every statement get
        only what is left of ``deadline``; always closed, including after an overrun
        while connecting (a driver connection's own context manager only ends the
        transaction)."""
        with bounded_connection(self.connector, database, deadline) as connection, connection:
            yield connection

    def _recheck_window(self, binding, deadline):
        """Window evidence: gate closed, every declared writer denied, nothing running.

        Each connection and statement gets only the time left on ``deadline``.
        """
        route = self.state.route(binding['tenantId'])
        if not self.state.routes.joinpath(binding['tenantId'] + '.maintenance').is_file() or self._leases(binding):
            raise ReleaseConflict('maintenance_gate_changed')
        roles = self._writer_roles(binding)
        with self._window_connection(binding['database'], deadline) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid() AND (usename = ANY(%s) OR state<>'idle' OR xact_start IS NOT NULL)) + (SELECT count(*) FROM pg_prepared_xacts WHERE database=%s)",
                    (binding['database'],list(roles),binding['database']))
                if cursor.fetchone()[0]: raise ReleaseConflict('writer_reconnect_observed')
            try:
                grants = writer_grants(connection, roles, binding['database'])
            except ValueError:
                deadline.remaining()  # an overrun is reported as the overrun
                raise ReleaseConflict('writer_admission_unverified') from None
        deadline.remaining()
        if any(grants[role] is not False for role in roles):
            raise ReleaseConflict('writer_admission_open')
        return {**binding,'fence':route['fence'],'gateClosed':True,'admittedWriters':0,
                'activeTransactions':0,'oldConnections':0,'transactionScope':'tenant',
                'writerConnections':0,'deniedWriters':list(roles)}

    def prepare_backup(self, binding, route):
        """Inspect every declared writer and return the previous state to persist.

        Read-only: the caller stores the result durably before the first effect so
        an interruption restores exactly the previous admission and cron state.
        """
        if self.config['targetPool'] == route['poolId']:
            raise ReleaseConflict('backup_fence_role_missing')
        self._bind_role(binding, route['poolId'])
        self._bind_role(binding, self.config['targetPool'], candidate=True)
        if self.config['backup']['image'] != self.config['pools'][route['poolId']]['odooRuntime']['image']:
            raise ReleaseConflict('backup_source_image_mismatch')
        roles = self._writer_roles(binding)
        if any(self._role(binding,pool) not in roles for pool in (route['poolId'], self.config['targetPool'])):
            raise ReleaseConflict('runtime_writer_roles_incomplete')
        try:
            with self.connector(binding['database']) as connection:
                grants = writer_grants(connection, roles, binding['database'])
        except ValueError:
            raise ReleaseConflict('backup_writer_grants_unverified') from None
        return {'version':2,'tenantId':binding['tenantId'],'database':binding['database'],
            'filestore':binding.get('filestore'),'registryRevision':binding['registryRevision'],
            'releaseId':route['releaseId'],'poolId':route['poolId'],'routeRevision':route['routeRevision'],
            'fence':route['fence'],'image':self.config['backup']['image'],
            'roles':list(roles),'grants':grants,'cron':self._owned_cron_state(binding,route['poolId'])}

    def _previous_state(self, binding, route, previous):
        if not isinstance(previous, dict) or previous.get('version') != 2:
            raise ReleaseConflict('backup_previous_state_invalid')
        roles = list(self._writer_roles(binding))
        if (previous.get('tenantId') != binding['tenantId'] or previous.get('database') != binding['database']
                or previous.get('fence') != route['fence'] or previous.get('routeRevision') != route['routeRevision']
                or previous.get('releaseId') != route['releaseId'] or previous.get('poolId') != route['poolId']
                or previous.get('roles') != roles or set(previous.get('grants') or {}) != set(roles)):
            raise ReleaseConflict('backup_previous_state_mismatch')
        self._recorded_cron_jobs(binding, route['poolId'], previous.get('cron'))
        return previous

    def backup_deadline(self):
        """The one absolute budget of a backup-current operation, from its first effect
        through the guard ACK, writer fence, capture, final validation, finalize,
        resume and final ACK; never renewed."""
        return Deadline(self.config['backup'].get('totalDeadlineSeconds', 600))

    def recovery_deadline(self):
        """A separate bounded budget for one recovery step: a later same-id
        reconciliation, or the fail-closed re-fence after a failure. A fresh one per
        step, so an exhausted capture budget never skips the fail-closed cleanup."""
        return Deadline(self.config['backup'].get('timeoutSeconds', 120))

    def resume_backup(self, binding, route, previous, deadline):
        """Reopen the previous state after a finished window on what is left of the
        operation budget; the window must still be intact."""
        if self.state.route(binding['tenantId']) != route:
            raise ReleaseConflict('backup_route_changed')
        previous = self._previous_state(binding, route, previous)
        self._recheck_window(binding, deadline)
        return self._restore_previous(binding, route, previous, deadline)

    def _restore_previous(self, binding, route, previous, deadline):
        # Every recorded cron must still be the recorded container before any writer reopens.
        pool = route['poolId']
        for container, job in self._recorded_cron_jobs(binding, pool, previous['cron']).items():
            self._inspect_cron(binding, pool, job, previous['cron'][container]['containerId'], deadline)
        restored = [role for role in previous['roles'] if previous['grants'][role] is True]
        with self._window_connection(binding['database'], deadline) as connection:
            with connection.cursor() as cursor:
                for role in restored:
                    cursor.execute(f'GRANT CONNECT ON DATABASE {identifier(binding["database"])} TO {identifier(role)}')
            connection.commit()
        jobs = self._restore_previous_cron(binding, route['poolId'], previous['cron'], deadline)
        return {'ready':True,'restoredWriters':restored,'cron':jobs}

    def _restore_previous_cron(self, binding, pool, previous, deadline):
        jobs = self._recorded_cron_jobs(binding, pool, previous)
        for container, job in jobs.items():
            recorded = previous[container]
            if recorded['running']:
                self._set_cron(binding, pool, job, recorded['containerId'], True, deadline)
            elif self._inspect_cron(binding, pool, job, recorded['containerId'], deadline)['running'] is not False:
                # A cron the operator had stopped stays stopped; a backup never starts one.
                raise ReleaseConflict('previous_cron_state_unverified')
        deadline.remaining()
        return previous

    def reconcile_backup(self, binding, route, previous, deadline):
        """Finish an interrupted backup by restoring the previous state only.

        Valid from any stage, including a crash before the fence took effect.
        Never captures again and never opens a principal that was closed before:
        a writer admitted now that was not admitted before means the fence was
        lost and the window stays closed for the operator. ``deadline`` is the
        caller's reconciliation budget, which also bounds the barrier removal and
        the final guard ACK after this returns.
        """
        if self.state.route(binding['tenantId']) != route:
            raise ReleaseConflict('backup_route_changed')
        previous = self._previous_state(binding, route, previous)
        try:
            with self._window_connection(binding['database'], deadline) as connection:
                grants = writer_grants(connection, previous['roles'], binding['database'])
        except ValueError as error:
            if str(error) == 'backup_deadline_exceeded': raise
            deadline.remaining()  # writer_grants hides an overrun behind its own refusal
            raise ReleaseConflict('backup_fence_unverified') from None
        if any(grants[role] is True for role in previous['roles'] if previous['grants'][role] is not True):
            raise ReleaseConflict('backup_fence_lost')
        return self._restore_previous(binding, route, previous, deadline)

    def capture_into(self, binding, proof, output):
        tenant = self._tenant(binding)
        config = {**self.config['backup'], 'mode':'local','outputDir':str(output),
                  'filestorePath':tenant['filestorePath'],'recheck':self._recheck}
        receipt = capture_tenant({**binding,'fence':proof['fence']},proof,config)
        return {**receipt,'digest':digest(receipt),'path':str(output)}

    def capture_backup(self, binding, proof, output, deadline):
        """Backup-current capture inside the writer window on the operation budget."""
        tenant = self._tenant(binding)
        config = {**self.config['backup'], 'mode':'local','outputDir':str(output),
                  'filestorePath':tenant['filestorePath'],'recheck':self._recheck_window}
        receipt = capture_window({**binding,'fence':proof['fence']},proof,config,deadline)
        return {**receipt,'digest':digest(receipt),'path':str(output)}

    @staticmethod
    def validate_capture(result, deadline):
        """Final artifact validation, bounded by the operation budget, of exactly this capture."""
        receipt = validate_window(result['path'], deadline)
        if digest(receipt) != result['digest']: raise ValueError('backup_validation_failed')
        return receipt

    def capture(self, binding, proof):
        output = self.state.root/'backups'/binding['tenantId']/str(proof['fence'])
        return self.capture_into(binding,proof,output)

    def migration_config(self, binding, proof=None):
        config = {**self.config['migration'],**self._tenant(binding)['migration'], 'mode':'local'}
        if proof: config.update(quiescence=proof,recheck=self._recheck)
        return config

    def gateway_context(self, binding):
        # Before migration, ORM code must match the serving generation's schema.
        if (self.state.routes/(binding['tenantId']+'.maintenance')).exists():
            raise ReleaseConflict('booking_gateway_requires_migration_reconciliation')
        route=self.state.route(binding['tenantId'])
        operator=self.config['pools'][route['poolId']]['operator']
        manifest=load_manifest(operator['manifest'])
        if manifest['releaseId'] != route['releaseId']:
            raise ReleaseConflict('gateway_release_mismatch')
        config={**operator['migration'],**self._tenant(binding)['gateway'][route['poolId']], 'mode':'local'}
        return manifest,config

    def migrate(self, binding, manifest, proof):
        observed = migrate_tenant({**binding,'fence':proof['fence']},manifest,self.migration_config(binding,proof),proof['fence'])
        self._grant_runtime_tables(binding,self.config['targetPool'])
        return {**observed,'digest':digest(observed)}

    def _grant_runtime_tables(self,binding,pool):
        # Schema ownership stays with the upgrade principal. Runtime receives
        # data/sequence rights only on newly installed schema objects.
        role=identifier(self._role(binding,pool))
        with self.connector(binding['database']) as connection:
            with connection.cursor() as cursor:
                cursor.execute(f'GRANT USAGE ON SCHEMA public TO {role}')
                cursor.execute(f'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {role}')
                cursor.execute(f'GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO {role}')
            connection.commit()

    def _inspect(self, pool, manifest):
        """Inspect actual image content/labels of all configured services, never liveness alone."""
        services = self.config['pools'][pool]['containers']
        if not {'odoo','web'} <= services.keys() or set(services) != set(manifest['images']):
            raise ReleaseConflict('runtime_containers_incomplete')
        for service, container in services.items():
            raw = subprocess.run(['docker','inspect',name(container)],check=True,capture_output=True,text=True,timeout=10)
            items = json.loads(raw.stdout)
            if len(items)!=1: raise ReleaseConflict('runtime_identity_missing')
            item=items[0];labels=item['Config']['Labels'] or {}
            if not item['State']['Running'] or labels.get('webvue.pool')!=pool or labels.get('webvue.release')!=manifest['releaseId']:
                raise ReleaseConflict('runtime_identity_mismatch')
            image=json.loads(subprocess.run(['docker','image','inspect',item['Image']],check=True,capture_output=True,text=True,timeout=10).stdout)[0]
            if manifest['images'][service] not in (image.get('RepoDigests') or []): raise ReleaseConflict('runtime_image_mismatch')
        return {'ready':True,'runtimeMode':'docker','releaseId':manifest['releaseId'],'poolId':pool}

    def prepare(self, binding, manifest, pool):
        if pool != self.config['targetPool']: raise ReleaseConflict('target_pool_mismatch')
        classified = self.classifier(binding, manifest)
        if classified.get('ready') is not True: raise ReleaseConflict('release_classification_refused')
        self._ai_ready(binding,manifest,pool)
        self._bind_role(binding,pool,candidate=True)
        with self.connector(binding['database']) as connection:
            evidence=validate_runtime_role(connection,self._role(binding,pool),binding['database'])
        if not evidence['valid']: raise ReleaseConflict('runtime_role_rejected')
        return self.inspector(pool,manifest)

    def _ai_ready(self,binding,manifest,pool):
        path=self.state.routes/'pools.json'
        pools=json.loads(path.read_text())['pools'] if path.is_file() else {}
        target=self.config['pools'][pool]
        old_pool=self.state.route(binding['tenantId'])['poolId']
        serving=self.config['pools'][old_pool]
        if ('ai' not in manifest['images'] and 'aiRuntime' not in target
                and not pools.get(pool,{}).get('aiUrl') and 'aiRuntime' not in serving
                and not pools.get(old_pool,{}).get('aiUrl')):
            return
        from .ai_maintenance import _service, _observe, _token
        candidate=target.get('aiRuntime',{})
        old=self.config['pools'][old_pool].get('aiRuntime',{})
        state_id=old.get('sharedStateId')
        if not state_id or candidate.get('sharedStateId')!=state_id:
            raise ReleaseConflict('ai_shared_state_unverified')
        token=_token(self.config['aiTokenFile'])
        for pool_id,service in [(old_pool,old),(pool,candidate)]:
            service=_service(service,state_id)
            metadata=pools[pool_id]
            if (metadata.get('aiUrl','').rstrip('/')!=service['url']
                    or metadata.get('aiStateVersion')!=manifest['aiStateVersion']
                    or service['aiStateVersion']!=manifest['aiStateVersion']):
                raise ReleaseConflict('ai_route_identity_mismatch')
            observed=_observe(service,'GET',token,10)
            if pool_id==pool and observed['accepting'] is not True:
                raise ReleaseConflict('candidate_ai_not_accepting')

    def _classify(self, binding, manifest):
        key = (binding['tenantId'], manifest_digest(manifest))
        gate = self.config.get('sourceGate')
        if not isinstance(gate, dict): raise ReleaseConflict('release_classification_required')
        if (self.state.routes/(binding['tenantId']+'.maintenance')).exists():
            cached = self.classifications.get(key)
            if not cached or any(manifest['compatibilityEvidence'].get(field) != snapshot_digest(gate[root])
                                 for field, root in [('baseSourceDigest','baseRoot'),('targetSourceDigest','targetRoot')]):
                raise ReleaseConflict('release_classification_reconciliation_required')
            return cached
        serving_manifest, serving_config = self.gateway_context(binding)
        result = verify_sources(binding, manifest, gate,
                                serving_manifest, serving_config, self.migration_config(binding))
        self.classifications[key] = result
        return result

    def _http_ready(self, binding, manifest, pool):
        config=self.config['pools'][pool]
        token=Path(self.config['probeTokenFile']).read_text().strip()
        if len(token)<32: raise ReleaseConflict('probe_token_invalid')
        def get(url,headers):
            parsed=urlsplit(url)
            if parsed.scheme!='http' or parsed.username or parsed.password:raise ReleaseConflict('probe_url_invalid')
            with build_opener(NoRedirect()).open(Request(url,headers=headers),timeout=10) as response:
                if response.status!=200: raise ReleaseConflict('runtime_http_not_ready')
                return response.read(1048576)
        result=json.loads(get(config['webUrl'].rstrip('/')+'/_webvue/release-readiness',{'X-WebVue-Release-Probe':token}))
        if any(result.get(key)!=value for key,value in {'releaseId':manifest['releaseId'],'poolId':pool,'assetsId':manifest['assetsId'],'aiStateVersion':manifest['aiStateVersion']}.items()):
            raise ReleaseConflict('runtime_http_identity_mismatch')
        if not result.get('assets'):raise ReleaseConflict('runtime_assets_missing')
        for locale in ('ar','en'):
            if not any(isinstance(asset,str) and re.fullmatch(r'/_i18n/[a-f0-9]{8,64}/'+locale+r'/messages\.json',asset) for asset in result['assets']):
                raise ReleaseConflict('runtime_messages_missing')
        for asset in result['assets']:
            if not isinstance(asset,str) or not re.fullmatch(r'/(?:_nuxt/[A-Za-z0-9_.-]+\.js|_i18n/[a-f0-9]{8,64}/(?:ar|en)/messages\.json)',asset):raise ReleaseConflict('runtime_asset_invalid')
            get(config['webUrl'].rstrip('/')+asset,{'X-WebVue-Release-Probe':token})
        tenant=self._tenant(binding)
        sid=Path(tenant['probeSessionFile']).read_text().strip()
        if not sid or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in sid):
            raise ReleaseConflict('probe_session_invalid')
        me=json.loads(get(config['odooUrl'].rstrip('/')+'/api/v1/me',{'Host':binding['database'],'Cookie':'session_id='+sid}))
        # This read goes through the ACTUAL target runtime role and existing session.
        if not isinstance(me,dict) or not isinstance(me.get('id'),int) or me['id']<1:
            raise ReleaseConflict('runtime_session_unreadable')
        probe=tenant.get('attachmentProbe',{})
        if (set(probe) != {'httpPath','relativePath','sha256'} or not re.fullmatch(r'/api/v1/[a-z0-9-]+(?:/[a-z0-9-]+)*/[1-9][0-9]*/attachments/[1-9][0-9]*/download',probe['httpPath'])
                or not re.fullmatch(r'[a-f0-9]{64}',probe['sha256'])):
            raise ReleaseConflict('attachment_probe_required')
        attachment=get(config['odooUrl'].rstrip('/')+probe['httpPath'],{'Host':binding['database'],'Cookie':'session_id='+sid})
        if hashlib.sha256(attachment).hexdigest()!=probe['sha256']:raise ReleaseConflict('runtime_attachment_unreadable')
        store=_path(tenant['filestorePath'],exists=True,directory=True)
        relative=Path(probe['relativePath'])
        if relative.is_absolute() or '..' in relative.parts:raise ReleaseConflict('attachment_probe_invalid')
        file=_path(store/relative,exists=True)
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=probe['sha256']:
            raise ReleaseConflict('runtime_attachment_unreadable')

    def verify(self, binding, manifest, pool):
        self.prepare(binding,manifest,pool)
        observed=verify_tenant(binding,manifest,self.migration_config(binding))
        self._http_ready(binding,manifest,pool)
        # Existing persistent data must be readable before route publication.
        tenant=self._tenant(binding)
        for key in ('filestorePath','sessionPath'):
            path=_path(tenant[key],exists=True,directory=True)
            list(path.iterdir())
        return {'ready':True,'verification':observed}

    def activate_jobs(self,binding,current):
        pool=current['poolId']
        jobs=self._owned_cron_jobs(binding,pool)
        for job in jobs:
            expected=self._cron_expected(binding,pool,job)
            before=self.role_inspector(job['container'],expected,cron_databases=job['databases'],allow_stopped=True)
            if before.get('running') is not True:
                subprocess.run(['docker','start',name(job['container'])],capture_output=True,check=True,timeout=30)
            after=self.role_inspector(job['container'],expected,cron_databases=job['databases'])
            if after.get('running') is not True or after.get('dbUser')!=expected['dbUser']:
                raise ReleaseConflict('tenant_cron_start_unverified')
        return {'ready':True,'jobs':len(jobs)}

    def block_generation(self,binding,old):
        # Permanent generation tombstone closes new admission before DB-role revocation.
        marker=self.state.routes/f"{binding['tenantId']}.{old['poolId']}.{old['routeRevision']}.retired"
        atomic_json(marker,{'tenantId':binding['tenantId'],'poolId':old['poolId'],'routeRevision':old['routeRevision'],'fence':old['fence']})

    def retire(self, binding, old, new):
        self.block_generation(binding,old)
        if self._leases(binding,old): return {'drained':False}
        try:
            self._fence(binding,old,gate_closed=False)
        except ReleaseConflict as error:
            if str(error) in {'active_transactions','old_connections_remain','release_writers_not_drained'}:
                return {'drained':False}
            raise
        return {'drained':True}
