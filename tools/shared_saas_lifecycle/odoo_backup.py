# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Opt-in real Odoo capture and isolated restore. No generic target commands."""
from __future__ import annotations
import hashlib
from contextlib import closing
import inspect
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from tools.shared_saas_lifecycle.odoo_effect import (
    Runner, EffectError, no_symlink, reserve, permit, emit, validate_database,
    require_new_target, verified_observation, MAX_OUTPUT, OBSERVE_CONTAINER, classify_error,
    install_termination_handler, block_termination_signals, TERMINATION_SIGNALS, STREAM_REFUSALS, release_routes_enabled, effect_operation, TENANT_DB_ROLE, AI_TENANT_SCHEMA,
)
from deploy.releases.postgres import POSTGRES_ADMIN_ROLE, identifier, tenant_bootstrap_sql, tenant_create_database_sql, tenant_isolation_sql
AI_ROLE = 'liwan_ai'
RESTART_TIMEOUT = 30  # the restart after a failure or a termination; with the 25 s cancel it fits the gate's 60 s grace
MAX_ARCHIVE = 2 * 1024 * 1024 * 1024
MAX_MEMBERS = 100000
MAX_MANIFEST = 16 * 1024 * 1024  # what read_artifact accepts; the inventory is written whole into the manifest
MANIFEST_OVERHEAD = 64 * 1024  # the manifest's other fields (hashes, ids, binding, business key)
MAX_INVENTORY = MAX_MANIFEST - MANIFEST_OVERHEAD
RESTORE_HOST = '-h restore-db'


def create_database_script(database):
    """Stage `restore-create`: the admin creates the empty target, in database postgres only.

    A separate stage so that restore() drops the name only after THIS operation created it: a failed CREATE
    (the name already exists, made by someone else) must never lead to a drop of that other database.
    """
    create = shlex.quote(tenant_create_database_sql(database))
    return ('set -eu\nexport PGPASSWORD="$POSTGRES_PASSWORD"\n'
            'exec psql ' + RESTORE_HOST + ' -U ' + POSTGRES_ADMIN_ROLE + ' -v ON_ERROR_STOP=1 -q -d postgres -c ' + create)


def restore_database_script(database):
    """Stage `restore-db`: the admin prepares the created target, then the runtime role restores schema `public`.

    No tenant-controlled code runs in a superuser session. The admin only closes the database to
    PUBLIC, runs the fixed bootstrap (extension, CREATE on public) and the fixed AI schema skeleton, all catalog
    statements pinned to pg_catalog. The archive is then restored while logged in as the runtime role, which
    cannot get back to a superuser. `-n public` leaves out entries without a schema (extensions and their comments,
    schema entries and their ACLs) because the skeleton owns them; `--no-owner` gives every object to the login role.
    Nothing is atomic across the stages: restore() drops the fresh target when one fails after its creation.
    """
    isolation = shlex.quote(tenant_isolation_sql(database, TENANT_DB_ROLE))
    bootstrap = shlex.quote(tenant_bootstrap_sql(TENANT_DB_ROLE))
    admin = 'psql ' + RESTORE_HOST + ' -U ' + POSTGRES_ADMIN_ROLE + ' -v ON_ERROR_STOP=1 -q '
    schema = AI_TENANT_SCHEMA.read_text()
    delimiter = 'LIWAN_TENANT_SCHEMA'
    if delimiter in schema:
        raise EffectError('restore_script_invalid')
    return ('set -eu\nexport PGPASSWORD="$POSTGRES_PASSWORD"\n'
            + admin + '-d postgres -c ' + isolation + '\n'
            + admin + '-d "$1" -c ' + bootstrap + '\n'
            + admin + '-d postgres -v tenant_db="$1" -f - <<\'' + delimiter + "'\n" + schema.rstrip('\n') + '\n' + delimiter + '\n'
            + 'export PGPASSWORD="$ODOO_DB_PASSWORD"\n'
            + 'exec pg_restore ' + RESTORE_HOST + ' -U ' + TENANT_DB_ROLE + ' --no-owner -n public --exit-on-error --single-transaction -d "$1"')


def restore_ai_script():
    """Stage `restore-ai`: schema liwan_ai restored while logged in as its owner.

    Without an AI password the stage only skips a cluster that has no `liwan_ai` role at all and an archive that holds
    no `liwan_ai` object beyond the empty schema; a cluster that has the role but no password to log in with, or an
    archive that carries AI data the cluster cannot restore, fails with an explicit code instead of silently losing it.
    """
    role = shlex.quote("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '" + AI_ROLE + "'")
    return ('set -eu\nif [ -z "${AI_DB_PASSWORD:-}" ]; then\n'
            '  export PGPASSWORD="$POSTGRES_PASSWORD"\n'
            '  present=$(psql ' + RESTORE_HOST + ' -U ' + POSTGRES_ADMIN_ROLE + ' -v ON_ERROR_STOP=1 -q -At -d postgres -c ' + role + ')\n'
            '  if [ -n "$present" ]; then echo ai_password_missing >&2; exit 1; fi\n'
            '  listing=$(pg_restore -l -n ' + AI_ROLE + ') || { echo ai_archive_unreadable >&2; exit 1; }\n'
            '  if printf \'%s\\n\' "$listing" | grep -Ev \'^;|^[0-9]+; [0-9]+ [0-9]+ (SCHEMA|ACL|COMMENT) \' | grep -q .; then echo ai_data_without_role >&2; exit 1; fi\n'
            '  exit 0\nfi\n'
            'export PGPASSWORD="$AI_DB_PASSWORD"\n'
            'exec pg_restore ' + RESTORE_HOST + ' -U ' + AI_ROLE + ' --no-owner -n liwan_ai --exit-on-error --single-transaction -d "$1"')


def drop_target_script(database):
    """Stage `restore-drop`: removes the fresh target after a failed restore; the admin runs it in database postgres only."""
    drop = shlex.quote('DROP DATABASE IF EXISTS ' + identifier(database) + ' WITH (FORCE)')
    return ('set -eu\nexport PGPASSWORD="$POSTGRES_PASSWORD"\n'
            'exec psql ' + RESTORE_HOST + ' -U ' + POSTGRES_ADMIN_ROLE + ' -v ON_ERROR_STOP=1 -q -d postgres -c ' + drop)


def sha256_file(path):
    no_symlink(Path(path))
    if not Path(path).is_file() or Path(path).stat().st_size > MAX_ARCHIVE:
        raise EffectError('artifact_invalid')
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def require_hash(path, expected):
    if not isinstance(expected, str) or not re.fullmatch('[a-f0-9]{64}', expected) or sha256_file(path) != expected:
        raise EffectError('artifact_hash_mismatch')


def safe_members(archive):
    seen, files, directories, size, result = set(), set(), set(), 0, []
    for member in archive:
        name = member.name
        path = PurePosixPath(name)
        if (not name or len(name) > 1024 or name.startswith('/') or '\\' in name or '..' in path.parts
                or str(path) != name.rstrip('/') or path.is_absolute()
                or name in seen or not (member.isfile() or member.isdir())):
            raise EffectError('archive_invalid')
        normalized = str(path)
        if normalized in seen or member.size < 0:
            raise EffectError('archive_invalid')
        parents = [str(parent) for parent in path.parents if str(parent) != '.']
        if any(parent in files for parent in parents) or (member.isfile() and normalized in directories):
            raise EffectError('archive_invalid')
        directories.update(parents)
        if member.isfile(): files.add(normalized)
        else: directories.add(normalized)
        seen.add(normalized)
        size += member.size
        if size > MAX_ARCHIVE or len(seen) > MAX_MEMBERS:
            raise EffectError('archive_limit')
        result.append(member)
    return result


def validate_archive(path):
    no_symlink(Path(path))
    if Path(path).stat().st_size > MAX_ARCHIVE:
        raise EffectError('archive_limit')
    try:
        with tarfile.open(path, 'r:') as archive:
            return len(safe_members(archive))
    except (tarfile.TarError, OSError):
        raise EffectError('archive_invalid') from None


MAX_DATABASE_ATTACHMENT = 64 * 1024 * 1024


def database_attachment_digest(kind, checksum, file_size, actual_size, read_chunk):
    """Bounded DB binary validation; the return value contains digests only."""
    if kind == 'url':
        return None
    if kind != 'binary' or type(file_size) is not int or file_size < 0:
        raise EffectError('attachment_metadata_invalid')
    size = 0 if actual_size is None else actual_size
    if type(size) is not int or size != file_size or size < 0 or size > MAX_DATABASE_ATTACHMENT:
        raise EffectError('attachment_size_invalid')
    sha1, sha256 = hashlib.sha1(), hashlib.sha256()
    offset = 0
    while offset < size:
        length = min(1024 * 1024, size - offset)
        value = read_chunk(offset, length)
        if not isinstance(value, (bytes, bytearray, memoryview)) or len(value) != length:
            raise EffectError('attachment_bytes_invalid')
        sha1.update(value); sha256.update(value); offset += length
    # Newly empty records may have no checksum; explicit empty binaries have
    # SHA1(empty), following stock ir.attachment._compute_checksum.
    if checksum != sha1.hexdigest() and not (size == 0 and checksum is None):
        raise EffectError('attachment_checksum_invalid')
    return {'sha256': sha256.hexdigest(), 'size': size}


# Helper scripts execute only inside the fixed, project-labelled Odoo services.
CONNECTION = '''import configparser, json, os, psycopg2
c=configparser.ConfigParser(interpolation=None);c.read('/etc/odoo/odoo.conf'); c=c['options']
def connect(name):
 return psycopg2.connect(host=c['db_host'],port=c.get('db_port','5432'),user=c['db_user'],password=c['db_password'],dbname=name)
'''
def read_inventory(connect, database):
    with closing(connect(database)) as conn, conn:
     conn.set_session(readonly=True)
     with conn.cursor() as cr:
      cr.execute('SELECT id,store_fname,checksum,COALESCE(file_size,0) FROM ir_attachment ORDER BY id'); attachments=cr.fetchall()
      cr.execute('SELECT id,type,checksum,COALESCE(file_size,0),octet_length(db_datas) FROM ir_attachment WHERE store_fname IS NULL ORDER BY id')
      database_rows=cr.fetchall()
      if len(database_rows)>MAX_MEMBERS or sum(row[4] or 0 for row in database_rows)>MAX_ARCHIVE: raise EffectError('attachment_limit')
      database_attachments=[]
      for attachment_id,kind,checksum,size,actual_size in database_rows:
       def read_chunk(offset,length):
        cr.execute('SELECT substring(db_datas from %s for %s) FROM ir_attachment WHERE id=%s',(offset+1,length,attachment_id))
        return cr.fetchone()[0]
       digest=database_attachment_digest(kind,checksum,size,actual_size,read_chunk)
       if digest is not None: database_attachments.append([attachment_id,digest['sha256'],digest['size']])
      cr.execute('SELECT count(*) FROM project_project'); projects=cr.fetchone()[0]
      cr.execute('SELECT count(*) FROM project_task'); tasks=cr.fetchone()[0]
      cr.execute("SELECT name,latest_version,state FROM ir_module_module WHERE state IN ('installed','to install','to upgrade','to remove') ORDER BY name"); modules=cr.fetchall()
      if any(row[2]!='installed' for row in modules): raise Exception('module_state')
      cr.execute('SELECT row_to_json(p) FROM liwan_tenant_profile p ORDER BY id'); profile=[r[0] for r in cr.fetchall()]
      if len(profile)!=1 or profile[0].get('policy_revision',0)<1: raise Exception('profile')
    return {'attachments':attachments,'databaseAttachments':database_attachments,'projects':projects,'tasks':tasks,'modules':modules,'profile':profile}



def read_odoo_readiness(config, database, *, restore):
    """Use the running worker's tenant-bound public route with no session."""
    from http.client import HTTPConnection

    if (config.get('dbfilter') != '^%h$'
            or config.get('db_host') != ('restore-db' if restore else 'db')):
        raise ValueError('odoo_route_unverified')
    client = HTTPConnection('127.0.0.1', 8069, timeout=25)
    try:
        client.request('GET', '/api/v1/branding', headers={'Host': database})
        response = client.getresponse()
        if response.status != 200:
            raise ValueError('odoo_route_unverified')
        payload = json.loads(response.read(MAX_OUTPUT + 1))
        if (not isinstance(payload, dict) or not isinstance(payload.get('name'), str)
                or not isinstance(payload.get('primary_color'), str)):
            raise ValueError('odoo_route_unverified')
    finally:
        client.close()
    return {'database': database}


def restore_inventory_matches(original, current, commercial=None):
    if commercial is None:
        return current == original
    before, after = original['profile'][0], current['profile'][0]
    if (after.get('commercial_revision_id') != commercial['revisionId']
            or after.get('commercial_digest') != commercial['digest']):
        return False
    changed = {'commercial_revision_id', 'commercial_digest', 'commercial_applied_at',
               'features', 'retained_read_features', 'policy_revision', 'write_uid', 'write_date'}
    if ({k: v for k, v in before.items() if k not in changed}
            != {k: v for k, v in after.items() if k not in changed}):
        return False
    if after['policy_revision'] < before['policy_revision']:
        return False
    if any(current[key] != original[key] for key in ('projects', 'tasks')):
        return False
    # Subscription installation can add module and attachment rows. Every
    # backed-up module and attachment must still match its original entry.
    return all(set(map(tuple, original[key])) <= set(map(tuple, current[key]))
               for key in ('modules', 'attachments', 'databaseAttachments'))


class BackupRunner(Runner):
    def __init__(self, request):
        super().__init__(request)
        self.base += ['--profile', 'restore']
        self.authority = request['authority']
        self.backup_id = self.authority['backupId']
        if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', self.backup_id):
            raise EffectError('artifact_identity_invalid')
        self.artifact = self.root / 'backups' / self.backup_id
        self.operation = request['job']['operation']
        self.target = validate_database(self.authority['targetDatabase']) if self.operation == 'restore' else None
        if self.target == self.database:
            raise EffectError('existing_target_refused')
        self.complete_path = self.root / 'restore-effects' / (request['job']['requestId'] + '.complete')

    def helper_args(self, service, stage, script):
        attempt = self.request.get('attemptId') or self.request['job']['requestId']
        name = self.config['projectName'] + '-effect-' + attempt[:8] + '-' + stage
        self.current_container = name
        return self.base + ['run', '--rm', '--no-deps', '-T', '--name', name,
                            '--entrypoint', '/opt/venv/bin/python', service, '-c', script]

    def helper(self, service, stage, script, *, stdin=''):
        try:
            # Compose emits progress on stderr independently of the helper's JSON.
            return self.command(self.helper_args(service, stage, script), stdin=stdin, timeout=180, stdout_only=True)
        finally:
            self.current_container = None

    def stream(self, args, *, destination=None, source=None, limit=MAX_ARCHIVE):
        # Binary artifacts bypass JSON/log buffers. Docker descendant is tracked.
        incoming = open(source, 'rb') if source else subprocess.DEVNULL
        # Created 0600 from the first moment: the artifact directory is readable by the worker's group.
        outgoing = os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') if destination else subprocess.DEVNULL
        # The stage's own refusal word goes to a private file, never to the log the group can read.
        reason = tempfile.TemporaryFile()
        try:
            self.child = subprocess.Popen(args, stdin=incoming, stdout=outgoing, stderr=reason)
            deadline = time.monotonic() + 600
            while self.child.poll() is None:
                if time.monotonic() >= deadline or (destination and Path(destination).stat().st_size > limit):
                    self.cancel()
                    raise EffectError('artifact_limit')
                time.sleep(0.1)
            if self.child.returncode:
                reason.seek(0)
                refusal = reason.read(4096).decode('utf-8', 'replace')
                raise EffectError(next((code for code in STREAM_REFUSALS if code in refusal), 'artifact_command_failed'))
            if destination:
                outgoing.flush(); os.fsync(outgoing.fileno())
                if Path(destination).stat().st_size > limit:
                    raise EffectError('archive_limit')
        except subprocess.TimeoutExpired:
            self.cancel()
            raise EffectError('artifact_timeout') from None
        finally:
            reason.close()
            if source: incoming.close()
            if destination: outgoing.close()
            self.child = None
            self.current_container = None

    def pg_stream(self, service, stage, script, database, *, destination=None, source=None):
        name = self.config['projectName'] + '-effect-' + self.request['attemptId'][:8] + '-' + stage
        self.current_container = name
        # Fixed script, validated positional DB argument. Password stays in service env.
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', name,
            '--entrypoint', '/bin/sh', service, '-c', script, 'liwan-backup', database]
        self.stream(args, destination=destination, source=source)

    def inspect_service(self, service):
        ids = self.command(self.base + ['ps', '-a', '-q', service]).strip().splitlines()
        if len(ids) != 1:
            raise EffectError('service_unavailable')
        value = json.loads(self.command(['docker', 'inspect', ids[0]]))[0]
        labels = value['Config'].get('Labels', {})
        if labels.get('com.docker.compose.project') != self.config['projectName'] or labels.get('com.docker.compose.service') != service:
            raise EffectError('foreign_project')
        return value

    def inventory(self, service, database):
        validation='import hashlib\nclass EffectError(Exception): pass\nMAX_DATABASE_ATTACHMENT='+str(MAX_DATABASE_ATTACHMENT)+'\nMAX_MEMBERS='+str(MAX_MEMBERS)+'\nMAX_ARCHIVE='+str(MAX_ARCHIVE)+'\n'+inspect.getsource(database_attachment_digest)
        script = CONNECTION + validation + '\nfrom contextlib import closing\n' + inspect.getsource(read_inventory) + '\nprint(json.dumps(read_inventory(connect,' + repr(database) + '),default=str,separators=(\",\",\":\")))'
        # Streamed to a file: the helper's JSON grows with the attachment count and must not pass
        # through the 64 KiB command buffer. A runaway ends in the stream's artifact_limit or archive_limit error.
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'inventory.json'
            try:
                self.stream(self.helper_args(service, 'inventory', script), destination=destination, limit=MAX_INVENTORY)
            except EffectError as error:
                # A stream stopped at the limit is an inventory that cannot fit a valid manifest.
                if str(error) in ('artifact_limit', 'archive_limit') and destination.exists() and destination.stat().st_size > MAX_INVENTORY:
                    raise EffectError('inventory_too_large') from None
                raise
            return json.loads(destination.read_text())

    def files_exist(self, service, database):
        script = 'import json;from pathlib import Path;p=Path(' + repr('/var/lib/odoo/filestore/' + database) + ');print(json.dumps(p.exists() or p.is_symlink()))'
        return json.loads(self.helper(service, 'exists-files', script))

    def database_exists(self, service, database):
        script = CONNECTION + '\nwith connect("postgres") as c:\n with c.cursor() as cr:\n  cr.execute("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=%s)",(' + repr(database) + ',));print(json.dumps(cr.fetchone()[0]))\n'
        return json.loads(self.helper(service, 'exists-db', script))

    def check_files(self, service, database, inventory):
        # Every referenced file gets SHA1, size and containment checks. DB-backed
        # attachments are independently streamed and hashed by inventory().
        # The rows travel on stdin: one argv string is capped at 128 KiB (MAX_ARG_STRLEN) and the list grows with the tenant.
        script = '''import hashlib,json,re,sys
from pathlib import Path
root=Path('/var/lib/odoo/filestore/') / database
attachments=json.load(sys.stdin)
for _,name,checksum,size in attachments:
 if name is None: continue
 if not re.fullmatch(r'[a-f0-9]{2}/[a-f0-9]{40}',name): raise Exception('attachment_path')
 p=root / name
 if p.is_symlink() or p.parent.is_symlink() or p.resolve()!=p or not p.is_file(): raise Exception('attachment_missing')
 value=hashlib.sha1();total=0
 with p.open('rb') as f:
  while chunk:=f.read(1048576): value.update(chunk);total+=len(chunk)
 if total!=size or value.hexdigest()!=checksum: raise Exception('attachment_bytes')
print('{}')
'''
        self.helper(service, 'check-files', 'database=' + repr(database) + '\n' + script, stdin=json.dumps(inventory['attachments'], separators=(',', ':')))

    def verify_odoo_readiness(self, service, database):
        database = validate_database(database)
        if service not in ('odoo', 'restore-odoo'):
            raise EffectError('service_unavailable')
        # The exact Host dbfilter selects the intended registry. Branding reads
        # its tenant profile and root company on the running Odoo process.
        script = ('import configparser,json\nMAX_OUTPUT='+str(MAX_OUTPUT)+'\n'
                  + inspect.getsource(read_odoo_readiness)
                  + "\nconfig=configparser.ConfigParser(interpolation=None)\n"
                    "config.read('/etc/odoo/odoo.conf')\n"
                  + f"print(json.dumps(read_odoo_readiness(config['options'], {database!r}, restore={service == 'restore-odoo'})))\n")
        response = self.command(self.base + ['exec', '-T', service, '/opt/venv/bin/python', '-'],
                                stdin=script, timeout=40, stdout_only=True)
        if json.loads(response) != {'database': database}:
            raise EffectError('restore_readback_mismatch')

    def wait_healthy(self, service):
        for _ in range(60):
            state = self.inspect_service(service)['State']
            if state.get('Running') and state.get('Health',{}).get('Status') == 'healthy':
                return
            time.sleep(1)
        raise EffectError('service_unhealthy')

    def verify_originals(self):
        registry = self.root / 'registry' / 'registry.json'
        no_symlink(registry)
        for target in json.loads(registry.read_text())['targets']:
            if target['enabled']:
                self.verify_odoo_readiness('odoo', target['database'])

    def read_artifact(self):
        no_symlink(self.artifact / 'manifest.json')
        if (self.artifact/'manifest.json').stat().st_size > MAX_MANIFEST:
            raise EffectError('manifest_invalid')
        if self.authority.get('manifestSha256'):
            require_hash(self.artifact/'manifest.json',self.authority['manifestSha256'])
        manifest = json.loads((self.artifact/'manifest.json').read_text())
        if (manifest.get('schemaVersion')!=1 or manifest.get('format')!='odoo-pg-filestore-v1'
                or manifest.get('backupId')!=self.backup_id
                or manifest.get('controlTenantId')!=self.authority['controlTenantId']
                or manifest.get('binding')!=self.request['job']['binding']):
            raise EffectError('artifact_identity_invalid')
        for field,file in [('databaseSha256','database.dump'),('filestoreSha256','filestore.tar')]:
            require_hash(self.artifact/file,manifest[field])
            if self.operation=='restore' and manifest[field]!=self.authority[field]:
                raise EffectError('artifact_hash_mismatch')
        validate_archive(self.artifact/'filestore.tar')
        return manifest

    def drain_observers(self, wait=35, sleep=None, clock=None):
        # A usage observation that started before odoo stopped is a one-off container that
        # `compose stop` does not touch. Give it longer than the collector's 30 s per-tenant
        # deadline, then kill it: these are transactional reads.
        sleep = sleep or time.sleep
        clock = clock or time.monotonic
        def running():
            rows = self.command(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + self.config['projectName'], '--format', '{{.Names}}']).splitlines()
            return [name for name in rows if '-effect-' in name and OBSERVE_CONTAINER.search(name)]
        deadline = clock() + wait
        while running() and clock() < deadline:
            sleep(1)
        for name in running():
            # The observer may exit between the listing and the kill; the writer check decides.
            subprocess.run(['docker', 'kill', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False)

    def apply_owned(self):
        if self.operation == 'backup' and release_routes_enabled() and self.config.get('releaseBackupConfig'):
            # This operation owns the admission barrier and must not count itself
            # as an admitted application writer while draining that same barrier.
            return self._apply_owned()
        return super().apply_owned()

    def capture(self):
        if release_routes_enabled():
            if not self.config.get('releaseBackupConfig'):
                raise EffectError('release_backup_requires_quiescence')
            from .release_backup import capture_release_backup
            return capture_release_backup(self)
        # Refuse a busy project before anything is reserved or stopped (a usage observation opens
        # DB sessions); the check after the stop below still closes the race with a late starter.
        self.assert_no_effect_containers()
        permit('reserve')
        backups=self.root/'backups';backups.mkdir(mode=0o700,exist_ok=True);no_symlink(backups)
        self.artifact.mkdir(mode=0o700);self.artifact.chmod(0o750)  # explicit: UMask=0077 masks mkdir's mode; the worker's group reads the manifest, the dump and the archive stay 0600
        reserve(self.artifact/'reservation.json',{'digest':self.request['payloadDigest'],'attemptId':self.request['attemptId']})
        source_image=self.inspect_service('odoo')['Image'];postgres_image=self.inspect_service('db')['Image']
        permit('drain')
        try:
            self.command(self.base+['stop','--timeout','30','odoo'],timeout=45)
            manifest=self.capture_while_stopped(source_image,postgres_image)
            permit('resume')
        except BaseException:
            # Odoo is shared by every tenant: whatever failed, never leave it stopped. No permit here;
            # the authority may be gone and the restart must not wait for it. A termination signal landing
            # in this cleanup path is held pending until the restart is done, then aborts the run.
            with block_termination_signals():
                self.restart_after_failure()
            raise
        try:
            self.command(self.base+['start','odoo'],timeout=60)
        except BaseException:
            # A termination during the normal start must not leave odoo stopped either.
            with block_termination_signals():
                self.restart_after_failure()
            raise
        self.wait_healthy('odoo');self.verify_originals()
        permit('complete')
        reserve(self.artifact/'manifest.json',manifest);(self.artifact/'manifest.json').chmod(0o640)
        self.read_artifact()

    def restart_after_failure(self):
        # Runs under the caller's `block_termination_signals`: a signal that landed between entering the cleanup and
        # this call is pending now and must not abort the restart. Release the other termination signals so a signal
        # that arrives while the restart itself runs still reaches the handler's `restarting` guard, which ignores it;
        # that handler ignores every termination signal for the rest of the process, so a held signal is then
        # discarded when the caller restores the mask and the original error stands. Otherwise the held signal is
        # delivered on restore and aborts the run with `authority_lost` only after odoo is back up.
        pending = signal.sigpending()
        self.restarting = True
        signal.pthread_sigmask(signal.SIG_UNBLOCK, set(TERMINATION_SIGNALS) - pending)
        try:
            self.command(self.base+['start','odoo'],timeout=RESTART_TIMEOUT,detached=True)
        except Exception as restart_error:
            raise EffectError('odoo_restart_failed') from restart_error
        finally:
            self.restarting = False

    def capture_while_stopped(self,source_image,postgres_image):
        if self.inspect_service('odoo')['State']['Running']:
            raise EffectError('writers_not_stopped')
        self.drain_observers()
        self.assert_no_effect_containers(code='runtime_writer_after_effect')
        # No ordinary application session may remain in any source tenant DB.
        # Run as the admin role: a non-superuser sees no backend_type for other roles' sessions.
        sessions=self.command(self.base+['exec','-T','db','psql','-U',POSTGRES_ADMIN_ROLE,'-d','postgres','-At','-c',
            "SELECT count(*) FROM pg_stat_activity WHERE datname LIKE 'liwan_scratch_%' AND backend_type='client backend'"]).strip()
        if sessions!='0':raise EffectError('writers_not_stopped')
        permit('capture')
        self.pg_stream('db','dump','set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -h db -U '+POSTGRES_ADMIN_ROLE+' --format=custom "$1"',self.database,destination=self.artifact/'database.dump')
        pack='''import os,sys,tarfile
from pathlib import Path
root=Path('/var/lib/odoo/filestore') / database
if root.is_symlink() or not root.is_dir(): raise Exception('filestore_missing')
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as out:
 for p in sorted(root.rglob('*')):
  if p.is_symlink() or not(p.is_file() or p.is_dir()) or p.resolve()!=p: raise Exception('filestore_link')
  out.add(p,arcname=p.relative_to(root).as_posix(),recursive=False)
'''
        self.stream(self.helper_args('odoo','pack','database='+repr(self.database)+'\n'+pack),destination=self.artifact/'filestore.tar')
        inventory=self.inventory('odoo',self.database)
        self.check_files('odoo',self.database,inventory)
        validate_archive(self.artifact/'filestore.tar')
        manifest={'schemaVersion':1,'format':'odoo-pg-filestore-v1','backupId':self.backup_id,'controlTenantId':self.authority['controlTenantId'],
            'binding':self.request['job']['binding'],'businessKey':self.request['businessKey'],'payloadDigest':self.request['payloadDigest'],
            'databaseSha256':sha256_file(self.artifact/'database.dump'),'filestoreSha256':sha256_file(self.artifact/'filestore.tar'),
            'sourceImageId':source_image,'postgresImageId':postgres_image,'capturedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'inventory':inventory}
        # reserve() writes json.dump (ASCII escapes can outgrow the raw inventory): refuse here, not after the manifest is unverifiable.
        if len(json.dumps(manifest).encode()) > MAX_MANIFEST:
            raise EffectError('inventory_too_large')
        return manifest

    def restore(self):
        with effect_operation(self.request, 'restore'):
            return self._restore_operation()

    def _restore_operation(self):
        manifest=self.read_artifact()  # ALL archive/hash checks precede mutations.
        if self.inspect_service('restore-odoo')['Image']!=manifest['sourceImageId'] or self.inspect_service('restore-db')['Image']!=manifest['postgresImageId']:
            raise EffectError('restore_image_mismatch')
        for service in ('odoo','restore-odoo'):
            require_new_target(self.database_exists(service,self.target),self.files_exist(service,self.target))
        permit('reserve')
        reservations=self.root/'restore-effects';reservations.mkdir(mode=0o700,exist_ok=True);no_symlink(reservations)
        reserve(reservations/(self.target+'.json'),{'approvalId':self.authority['approvalId'],'backupId':self.backup_id,'digest':self.request['payloadDigest'],'attemptId':self.request['attemptId'],'fence':self.request['fence']})
        # The archive restores account state unchanged. The target classification is new.
        classification=self.root/'classifications'/(self.target+'.json')
        reserve(classification,{'schema_version':1,'database':self.target,'commercial_mode':'saas','entitlement_source':'control_plane','expected_valid_until':None,'valid_until_action':'preserve'})
        classification.chmod(0o644)
        permit('restore-database')
        self.pg_stream('restore-db','restore-create',create_database_script(self.target),self.target)
        try:
            self.pg_stream('restore-db','restore-db',restore_database_script(self.target),self.target,source=self.artifact/'database.dump')
            self.pg_stream('restore-db','restore-ai',restore_ai_script(),self.target,source=self.artifact/'database.dump')
        except BaseException:
            # The stages are not one transaction: this operation created the target, so a failed phase drops it whole.
            self.pg_stream('restore-db','restore-drop',drop_target_script(self.target),self.target)
            raise
        permit('restore-filestore')
        # Validation is repeated INSIDE the destination before writing its first file.
        unpack='import os,sys,tarfile,tempfile,shutil\nfrom pathlib import Path,PurePosixPath\nclass EffectError(Exception): pass\nMAX_ARCHIVE='+str(MAX_ARCHIVE)+'\nMAX_MEMBERS='+str(MAX_MEMBERS)+'\n'+inspect.getsource(safe_members)+'''
root=Path('/var/lib/odoo/filestore') / database
if root.exists() or root.is_symlink() or root.parent.is_symlink(): raise Exception('target_exists')
with tempfile.TemporaryFile() as source:
 total=0
 while chunk:=sys.stdin.buffer.read(1048576):
  total+=len(chunk)
  if total>MAX_ARCHIVE: raise Exception('archive_limit')
  source.write(chunk)
 source.seek(0)
 with tarfile.open(fileobj=source,mode='r:') as archive:
  members=safe_members(archive)
  root.mkdir(parents=True)
  for member in members:
   dest=root/member.name
   if dest.resolve()!=dest: raise Exception('path_invalid')
   if member.isdir(): dest.mkdir(parents=True,exist_ok=True);continue
   dest.parent.mkdir(parents=True,exist_ok=True)
   with dest.open('xb') as output, archive.extractfile(member) as content: shutil.copyfileobj(content,output)
'''
        self.stream(self.helper_args('restore-odoo','unpack','database='+repr(self.target)+'\n'+unpack),source=self.artifact/'filestore.tar')
        permit('verify')
        self.verify_restore(manifest)
        permit('complete')
        reserve(self.complete_path,{'approvalId':self.authority['approvalId'],'backupId':self.backup_id,'targetDatabase':self.target,'digest':self.request['payloadDigest'],'attemptId':self.request['attemptId'],'fence':self.request['fence'],'manifestSha256':self.authority['manifestSha256']})

    def verify_restore(self,manifest,commercial=None):
        inventory=self.inventory('restore-odoo',self.target)
        if not restore_inventory_matches(manifest['inventory'],inventory,commercial):
            raise EffectError('restore_readback_mismatch')
        self.check_files('restore-odoo',self.target,inventory)
        self.verify_odoo_readiness('restore-odoo', self.target)

    def apply(self):
        self.preflight()
        if self.operation=='backup': self.capture()
        elif self.operation=='restore': self.restore()
        else: raise EffectError('operation_unavailable')
        emit({'result':{'applied':True}})

    def observe(self):
        with effect_operation(self.request, 'backup_observe'):
            return self._observe_operation()

    def _observe_operation(self):
        self.preflight()
        if (self.root/'runtime-gate').exists(): return {'state':'unknown'}
        if self.operation=='backup':
            if not self.artifact.exists(): return {'state':'absent'}
            if not self.authority.get('manifestSha256'): return {'state':'unknown'}
            self.read_artifact()
            return verified_observation(self.request,True)
        if not self.complete_path.exists():
            reserved=self.root/'restore-effects'/(self.target+'.json')
            if reserved.exists() or self.database_exists('restore-odoo',self.target) or self.files_exist('restore-odoo',self.target):return {'state':'partial'}
            return {'state':'absent'}
        no_symlink(self.complete_path)
        completion=json.loads(self.complete_path.read_text())
        expected={'approvalId':self.authority['approvalId'],'backupId':self.backup_id,'targetDatabase':self.target,'digest':self.request['payloadDigest'],'manifestSha256':self.authority['manifestSha256']}
        if any(completion.get(k)!=v for k,v in expected.items()):return {'state':'partial'}
        # Effects ran by now: a writer here is not a retryable pre-gate refusal.
        self.assert_no_effect_containers(code='runtime_writer_after_effect')
        manifest=self.read_artifact();self.verify_restore(manifest,self.request.get('commercial'))
        return verified_observation(self.request,True)


def main():
    runner=None
    try:
        raw=sys.stdin.readline(MAX_OUTPUT+1)
        if len(raw)>MAX_OUTPUT:raise EffectError('input_invalid')
        request=json.loads(raw);runner=BackupRunner(request)
        install_termination_handler(runner)
        if request['action']=='observe':emit({'result':runner.observe()})
        elif request['action']=='apply':runner.apply_owned()
        else:raise EffectError('operation_unavailable')
        return 0
    except Exception as exc:
        emit({'error_code':classify_error(exc)});return 1

if __name__=='__main__':
    sys.exit(main())
