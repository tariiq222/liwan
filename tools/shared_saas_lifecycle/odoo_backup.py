# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Opt-in real Odoo capture and isolated restore. No generic target commands."""
from __future__ import annotations
import hashlib
import inspect
import json
import os
from pathlib import Path, PurePosixPath
import re
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
    release_routes_enabled, effect_operation,
)
MAX_ARCHIVE = 2 * 1024 * 1024 * 1024
MAX_MEMBERS = 100000


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
INVENTORY = '''
with connect(database) as conn:
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
  cr.execute('SELECT row_to_json(p) FROM webvue_tenant_profile p ORDER BY id'); profile=[r[0] for r in cr.fetchall()]
  if len(profile)!=1 or profile[0].get('policy_revision',0)<1: raise Exception('profile')
print(json.dumps({'attachments':attachments,'databaseAttachments':database_attachments,'projects':projects,'tasks':tasks,'modules':modules,'profile':profile},default=str,separators=(',',':')))
'''


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

    def helper(self, service, stage, script):
        try:
            return self.command(self.helper_args(service, stage, script), timeout=180)
        finally:
            self.current_container = None

    def stream(self, args, *, destination=None, source=None):
        # Binary artifacts bypass JSON/log buffers. Docker descendant is tracked.
        incoming = open(source, 'rb') if source else subprocess.DEVNULL
        outgoing = open(destination, 'xb') if destination else subprocess.DEVNULL
        try:
            if destination:
                os.chmod(destination, 0o600)
            self.child = subprocess.Popen(args, stdin=incoming, stdout=outgoing, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 600
            while self.child.poll() is None:
                if time.monotonic() >= deadline or (destination and Path(destination).stat().st_size > MAX_ARCHIVE):
                    self.cancel()
                    raise EffectError('artifact_limit')
                time.sleep(0.1)
            if self.child.returncode:
                raise EffectError('artifact_command_failed')
            if destination:
                outgoing.flush(); os.fsync(outgoing.fileno())
                if Path(destination).stat().st_size > MAX_ARCHIVE:
                    raise EffectError('archive_limit')
        except subprocess.TimeoutExpired:
            self.cancel()
            raise EffectError('artifact_timeout') from None
        finally:
            if source: incoming.close()
            if destination: outgoing.close()
            self.child = None
            self.current_container = None

    def pg_stream(self, service, stage, script, database, *, destination=None, source=None):
        name = self.config['projectName'] + '-effect-' + self.request['attemptId'][:8] + '-' + stage
        self.current_container = name
        # Fixed script, validated positional DB argument. Password stays in service env.
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', name,
            '--entrypoint', '/bin/sh', service, '-c', script, 'webvue-backup', database]
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
        script = CONNECTION + validation + '\ndatabase=' + repr(database) + '\n' + INVENTORY
        # Bounded inventory: selected fixture is intentionally small, fail on overflow.
        output = self.helper(service, 'inventory', script)
        if len(output) >= MAX_OUTPUT:
            raise EffectError('inventory_limit')
        return json.loads(output)

    def files_exist(self, service, database):
        script = 'import json;from pathlib import Path;p=Path(' + repr('/var/lib/odoo/filestore/' + database) + ');print(json.dumps(p.exists() or p.is_symlink()))'
        return json.loads(self.helper(service, 'exists-files', script))

    def database_exists(self, service, database):
        script = CONNECTION + '\nwith connect("postgres") as c:\n with c.cursor() as cr:\n  cr.execute("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=%s)",(' + repr(database) + ',));print(json.dumps(cr.fetchone()[0]))\n'
        return json.loads(self.helper(service, 'exists-db', script))

    def check_files(self, service, database, inventory):
        # Every referenced file gets SHA1, size and containment checks. DB-backed
        # attachments are independently streamed and hashed by inventory().
        script = '''import hashlib,json,re
from pathlib import Path
root=Path('/var/lib/odoo/filestore/') / database
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
        self.helper(service, 'check-files', 'database=' + repr(database) + '\nattachments=' + repr(inventory['attachments']) + '\n' + script)

    def authenticate(self, service, database, credential):
        no_symlink(credential)
        credentials = json.loads(credential.read_text())
        payload = {'jsonrpc':'2.0','method':'call','params':{'db':database,'login':credentials['login'],'password':credentials['password']},'id':1}
        script = 'import json,urllib.request\npayload=' + repr(json.dumps(payload)) + '\n'
        script += 'req=urllib.request.Request("http://127.0.0.1:8069/web/session/authenticate",data=payload.encode(),headers={"Content-Type":"application/json","Host":' + repr(database) + '})\n'
        script += 'r=json.load(urllib.request.urlopen(req,timeout=25));assert isinstance(r.get("result",{}).get("uid"),int) and r["result"]["uid"]>1;print("{}")\n'
        self.command(self.base + ['exec','-T',service,'/opt/venv/bin/python','-'],stdin=script,timeout=40)

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
                database = validate_database(target['database'])
                self.authenticate('odoo',database,self.root/'credentials'/(database+'.json'))

    def read_artifact(self):
        no_symlink(self.artifact / 'manifest.json')
        if (self.artifact/'manifest.json').stat().st_size > 16*1024*1024:
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

    def capture(self):
        if release_routes_enabled():
            # Existing capture stops the whole service; only the new quiescent adapter may capture pools.
            raise EffectError('release_backup_requires_quiescence')
        # Refuse a busy project before anything is reserved or stopped (a usage observation opens
        # DB sessions); the check after the stop below still closes the race with a late starter.
        self.assert_no_effect_containers()
        permit('reserve')
        backups=self.root/'backups';backups.mkdir(mode=0o700,exist_ok=True);no_symlink(backups)
        self.artifact.mkdir(mode=0o700)
        reserve(self.artifact/'reservation.json',{'digest':self.request['payloadDigest'],'attemptId':self.request['attemptId']})
        source_image=self.inspect_service('odoo')['Image'];postgres_image=self.inspect_service('db')['Image']
        permit('drain')
        self.command(self.base+['stop','--timeout','30','odoo'],timeout=45)
        if self.inspect_service('odoo')['State']['Running']:
            raise EffectError('writers_not_stopped')
        self.drain_observers()
        self.assert_no_effect_containers(code='runtime_writer_after_effect')
        # No ordinary application session may remain in any source tenant DB.
        script=CONNECTION+'''\nwith connect('postgres') as c:
 with c.cursor() as cr:
  cr.execute("SELECT count(*) FROM pg_stat_activity WHERE datname LIKE 'webvue_scratch_%' AND backend_type='client backend'")
  assert cr.fetchone()[0]==0
print('{}')
'''
        self.helper('odoo','drain-check',script)
        permit('capture')
        self.pg_stream('db','dump','set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -h db -U odoo --format=custom --no-owner "$1"',self.database,destination=self.artifact/'database.dump')
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
        permit('resume')
        self.command(self.base+['start','odoo'],timeout=60)
        self.wait_healthy('odoo');self.verify_originals()
        permit('complete')
        reserve(self.artifact/'manifest.json',manifest)
        self.read_artifact()

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
        # The inherited source password is preserved. Target classification is new.
        classification=self.root/'classifications'/(self.target+'.json')
        reserve(classification,{'schema_version':1,'database':self.target,'commercial_mode':'saas','entitlement_source':'control_plane','expected_valid_until':None,'valid_until_action':'preserve'})
        classification.chmod(0o644)
        permit('restore-database')
        self.pg_stream('restore-db','restore-db','set -eu; export PGPASSWORD="$POSTGRES_PASSWORD"; createdb -h restore-db -U odoo "$1"; exec pg_restore -h restore-db -U odoo --no-owner --exit-on-error --single-transaction -d "$1"',self.target,source=self.artifact/'database.dump')
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

    def verify_restore(self,manifest):
        inventory=self.inventory('restore-odoo',self.target)
        if inventory!=manifest['inventory']:
            raise EffectError('restore_readback_mismatch')
        self.check_files('restore-odoo',self.target,inventory)
        self.authenticate('restore-odoo',self.target,self.credential)

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
        manifest=self.read_artifact();self.verify_restore(manifest)
        return verified_observation(self.request,True)


def main():
    runner=None
    try:
        raw=sys.stdin.readline(MAX_OUTPUT+1)
        if len(raw)>MAX_OUTPUT:raise EffectError('input_invalid')
        request=json.loads(raw);runner=BackupRunner(request)
        def terminate(_signum,_frame):
            runner.cancel();raise EffectError('authority_lost')
        signal.signal(signal.SIGTERM,terminate);signal.signal(signal.SIGINT,terminate)
        if request['action']=='observe':emit({'result':runner.observe()})
        elif request['action']=='apply':runner.apply_owned()
        else:raise EffectError('operation_unavailable')
        return 0
    except Exception as exc:
        emit({'error_code':classify_error(exc)});return 1

if __name__=='__main__':
    sys.exit(main())
