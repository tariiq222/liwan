# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Restore only a hashed synthetic document-migration backup into fresh scratch DBs."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from attachment_spike import ODOO, PYTHON
from migration_fixture import SNAPSHOT


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-evidence',type=Path,required=True)
    parser.add_argument('--database-prefix',required=True)
    parser.add_argument('--evidence-dir',type=Path,required=True)
    parser.add_argument('--worktree',type=Path,default=Path(__file__).resolve().parents[2])
    args=parser.parse_args()
    if not re.fullmatch(r'webvue_scratch_[a-z0-9_]{1,28}',args.database_prefix):
        parser.error('fresh scratch prefix required')
    try:
        import psycopg2
        from psycopg2 import sql
    except ModuleNotFoundError:
        os.execv(str(PYTHON),[str(PYTHON),'-B',__file__,*sys.argv[1:]])
    fixtures=sorted(args.fixture_evidence.glob('*-backup.json'))
    if len(fixtures) not in (2,4):
        raise ValueError('complete two-order fixture backup manifests are required')
    validated=[]
    for path in fixtures:
        manifest=json.loads(path.read_text())
        if manifest.get('kind')!='webvue-documents-synthetic-fixture-v1' or not re.fullmatch(r'webvue_scratch_[a-z0-9_]+',manifest.get('database','')):
            raise ValueError('unrecognized synthetic fixture backup')
        for key in ('dump','filestore','snapshot'):
            name=manifest.get(key,'')
            if not isinstance(name,str) or Path(name).name!=name or name in ('.','..'):
                raise ValueError('invalid fixture reference')
        for key in ('dump','filestore'):
            payload=args.fixture_evidence/manifest[key]
            if hashlib.sha256(payload.read_bytes()).hexdigest()!=manifest[key+'_sha256']:
                raise ValueError('fixture checksum mismatch')
        validated.append(manifest)
    connection=psycopg2.connect(host='127.0.0.1',user=os.environ.get('USER','tariq'),dbname='postgres')
    connection.autocommit=True
    names=[args.database_prefix+'_'+str(i) for i in range(len(validated))]
    with connection.cursor() as cursor:
        cursor.execute('SELECT datname FROM pg_database WHERE datname=ANY(%s)',[names])
        if cursor.fetchall():
            raise ValueError('refusing existing restore target')
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    runtime=Path(tempfile.mkdtemp(prefix='webvue-docs-restore-'))
    owned=[];results=[]
    try:
        baseline=validated[0]['baseline']
        source_archive=subprocess.check_output(['git','archive',baseline,'odoo-addons'],cwd=args.worktree)
        subprocess.run(['tar','-x','-C',str(runtime)],input=source_archive,check=True)
        pins=subprocess.check_output([sys.executable,'-B',str(args.worktree/'tools/oca_addons.py'),'path','--check'],text=True).strip()
        for index,(manifest,database) in enumerate(zip(validated,names)):
            with connection.cursor() as cursor:
                cursor.execute(sql.SQL('CREATE DATABASE {} TEMPLATE template0').format(sql.Identifier(database)))
            owned.append(database)
            console=args.evidence_dir/(str(index)+'-restore.console')
            with console.open('w') as output:
                subprocess.run(['pg_restore','-h','127.0.0.1','-U',os.environ.get('USER','tariq'),'-d',database,
                    '--no-owner','--no-privileges','--exit-on-error',str(args.fixture_evidence/manifest['dump'])],
                    stdout=output,stderr=subprocess.STDOUT,check=True)
            source=runtime/str(index);source.mkdir()
            with tarfile.open(args.fixture_evidence/manifest['filestore']) as archive:
                for member in archive.getmembers():
                    parts=Path(member.name).parts
                    if not parts or parts[0]!='filestore' or '..' in parts or Path(member.name).is_absolute() or not (member.isdir() or member.isfile()):
                        raise ValueError('unsafe synthetic archive entry')
                archive.extractall(source,filter='data')
            data=source/'data';(data/'filestore').mkdir(parents=True)
            shutil.move(str(source/'filestore'),str(data/'filestore'/database))
            classification=source/'classification.json'
            subprocess.run([sys.executable,'-B',str(args.worktree/'deploy/classification.py'),'fixture','--database',database,
                '--mode',manifest['mode'],'--output',str(classification)],check=True,stdout=subprocess.DEVNULL)
            conf=source/'odoo.conf';conf.write_text('[options]\nlist_db=False\n')
            restored=args.evidence_dir/(str(index)+'-restored.json')
            command=[str(PYTHON),'-B',str(ODOO/'odoo-bin'),'shell','-c',str(conf),
                '--addons-path='+','.join([str(ODOO/'odoo/addons'),str(ODOO/'addons'),str(runtime/'odoo-addons' if manifest.get('stage')=='before' else args.worktree/'odoo-addons'),pins]),
                '--db_host=127.0.0.1','--db_user='+os.environ.get('USER','tariq'),'-d',database,'--db-filter=^'+database+'$',
                '--data-dir='+str(data),'--no-http','--workers=0','--max-cron-threads=0',
                '--logfile='+str(args.evidence_dir/(str(index)+'-verify.log'))]
            with console.open('a') as output:
                subprocess.run(command,input='OUTPUT='+repr(str(restored))+'\n'+SNAPSHOT,text=True,
                    stdout=output,stderr=subprocess.STDOUT,check=True,timeout=120,
                    env=dict(os.environ,WEBVUE_COMMERCIAL_CONFIG=str(classification),PYTHONDONTWRITEBYTECODE='1'))
            expected=json.loads((args.fixture_evidence/manifest['snapshot']).read_text())
            actual=json.loads(restored.read_text())
            if expected!=actual:
                raise ValueError('restored document/attachment/role identity mismatch')
            restored.chmod(0o600)
            results.append({'passed':True,'source':manifest['database'],'database':database,
                'documents':len(actual['documents']),'attachments':len(actual['attachments']),
                'bytes_and_identity_equal':True})
    except Exception as exc:
        results.append({'passed':False,'error':str(exc)})
    finally:
        with connection.cursor() as cursor:
            for database in owned:
                cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()',[database])
                cursor.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(database)))
        connection.close();shutil.rmtree(runtime)
    report={'passed':len(results)==len(validated) and all(item['passed'] for item in results),'results':results,'cleaned_databases':owned}
    (args.evidence_dir/'restore_drill.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
    return 0 if report['passed'] else 1

if __name__=='__main__':
    sys.exit(main())
