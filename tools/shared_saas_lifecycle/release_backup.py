"""Bind the existing shared queue backup format to tenant-only release quiescence."""
import hashlib
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from deploy.releases.cli import document
from deploy.releases.state import ReleaseState
from deploy.releases.runtime import LocalRuntime
from deploy.releases.backup_operation import backup_current
from .odoo_backup import read_inventory, sha256_file
from .odoo_effect import EffectError, permit, reserve


def capture_release_backup(runner):
    operator=document(runner.config['releaseBackupConfig'])
    state=ReleaseState(operator['stateDir'])
    runtime=LocalRuntime(state,operator['runtime'])
    binding=runner.request['job']['binding']
    # A matching DB name is insufficient: the queued registry identity must match.
    if state.binding(binding['tenantId']) != binding:raise EffectError('release_binding_mismatch')
    # Prove the native dump connector and the legacy restore service describe the
    # same physical PostgreSQL cluster before producing a mixed-format manifest.
    with runtime.connector('postgres') as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT system_identifier::text FROM pg_control_system()')
            cluster=cursor.fetchone()[0]
    connection.close()
    observed=runner.command(runner.base+['exec','-T','db','psql','-U','odoo','-d','postgres','-tAc','SELECT system_identifier::text FROM pg_control_system()']).strip()
    if observed != cluster:raise EffectError('release_database_binding_mismatch')
    permit('reserve')
    def finalize(result):
        permit('capture')
        inventory=read_inventory(runtime.connector,binding['database'])
        store=Path(runtime.config['tenants'][binding['tenantId']]['filestorePath'])
        for _,name,checksum,size in inventory['attachments']:
            if not name:continue
            path=store/name
            if not path.resolve().is_relative_to(store) or path.is_symlink() or not path.is_file() or path.stat().st_size!=size:
                raise EffectError('attachment_bytes')
            value=hashlib.sha1()
            with path.open('rb') as source:
                for block in iter(lambda:source.read(1048576),b''):value.update(block)
            if value.hexdigest()!=checksum:raise EffectError('attachment_bytes')
        image=runtime.config['backup']['image']
        image_id=subprocess.run(['docker','image','inspect','--format','{{.Id}}',image],check=True,capture_output=True,text=True,timeout=10).stdout.strip()
        manifest={'schemaVersion':1,'format':'odoo-pg-filestore-v1','backupId':runner.backup_id,'controlTenantId':runner.authority['controlTenantId'],
            'binding':binding,'businessKey':runner.request['businessKey'],'payloadDigest':runner.request['payloadDigest'],
            'databaseSha256':sha256_file(runner.artifact/'database.dump'),'filestoreSha256':sha256_file(runner.artifact/'filestore.tar'),
            'sourceImageId':image_id,'postgresImageId':runner.inspect_service('db')['Image'],
            'capturedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'inventory':inventory}
        permit('complete');reserve(runner.artifact/'manifest.json',manifest)
        runner.read_artifact()
        permit('resume')
    return backup_current(state,runtime,binding,'backup_'+runner.backup_id.replace('-',''),runner.artifact,finalize)
