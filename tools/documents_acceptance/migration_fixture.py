# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Old-release -> actual target upgrade, failure rollback and byte-identity proof.

Only creates fresh webvue_scratch_* databases and its own filestores. Never edits
an existing database or source checkout; logs contain synthetic fixture data.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
from attachment_spike import ODOO, PYTHON

SEED = r'''
from odoo import Command
from pathlib import Path
import base64,json
profile=env.ref('webvue_platform.tenant_profile')
profile._webvue_initialize_legacy_policy(env['webvue.feature.registry']._webvue_installed_module_ids())
companies=[env.company,env['res.company'].create({'name':'Migration company B'})]
env.ref('base.user_admin').write({'company_ids':[Command.link(companies[1].id)]})
read=env.ref('webvue_hr.permission_hr_documents_read')
manage=env.ref('webvue_hr.permission_hr_documents_manage')
for index,company in enumerate(companies):
    department=env['hr.department'].create({'name':'Migration department '+str(index),'company_id':company.id})
    document=env['webvue.hr.document'].create({'name':'Original '+str(index),'body':'<p>Original Arabic نص '+str(index)+'</p>' if index==0 else False,
        'department_id':department.id,'company_id':company.id,'expiry_date':'2030-01-01' if index==0 else False})
    for number in range(2):
        attachment=env['ir.attachment'].create({'name':str(number)+'.txt','raw':('original bytes '+str(index)+str(number)).encode(),
            'res_model':document._name,'res_id':document.id,'company_id':company.id})
        document.write({'attachment_ids':[Command.link(attachment.id)]})
    permissions=read|manage if index==0 else read
    role=env['webvue.access.role'].with_company(company).create({'key':'docs_migration_'+str(index),'name_ar':'دور الترحيل','company_id':company.id,
        'permission_ids':[Command.set(permissions.ids)]})
    env['webvue.access.assignment'].create({'user_id':env.ref('base.user_admin').id,'role_id':role.id,'company_id':company.id})
    env['ir.model.data'].create({'module':'docs_migration_fixture','name':'document_'+str(index),'model':document._name,'res_id':document.id,'noupdate':True})
env.cr.commit()
'''
SNAPSHOT = r'''
from pathlib import Path
import json,hashlib,base64
old='webvue.hr.document' in env
model=env['webvue.hr.document' if old else 'webvue.document']
documents=model.with_context(active_test=False).search([],order='id')
attachments=env['ir.attachment'].search([('res_model','=',model._name)],order='id')
roles=env['webvue.access.role'].search([('key','=like','docs_migration_%')],order='id')
result={'documents':[{'id':d.id,'company_id':d.company_id.id,'department_id':d.department_id.id,
    'name':d.name,'body_sha256':hashlib.sha256((d.body or '').encode()).hexdigest(),
    'expiry_date':str(d.expiry_date) if d.expiry_date else None} for d in documents],
    'attachments':[{'id':a.id,'document_id':a.res_id,'name':a.name,'bytes_sha256':hashlib.sha256(a.raw or b'').hexdigest(),
    'size':a.file_size,'checksum':a.checksum,'store_fname':a.store_fname} for a in attachments],
    'role_grants':[{'role_id':role.id,'company_id':role.company_id.id,'keys':sorted(role.permission_ids.mapped('key')),
      'assignment_ids':sorted(role.assignment_ids.ids)} for role in roles],
    'model_id':env['ir.model']._get(model._name).id,
    'xmlids':[env.ref('docs_migration_fixture.document_'+str(i)).id for i in range(2)]}
if not old:
    assert all(d.visibility=='company' for d in documents)
    assert all(d.directory_id for d in documents)
    files=env['dms.file'].with_context(active_test=False).search([])
    assert len(files)==len(attachments)
    assert sorted(files.mapped('attachment_id').ids)==attachments.ids
    assert all(f.directory_id.res_id==f.attachment_id.res_id for f in files)
    assert not env['webvue.access.assignment'].search_count([('role_id','=',env.ref('webvue_documents.role_documents_manager').id)])
    assert env.ref('webvue_platform.tenant_profile').features['documents.enabled'] is True
    assert not env['ir.model'].search_count([('model','=','webvue.hr.document')])
    env.cr.execute("SELECT to_regclass('webvue_hr_document')")
    assert not env.cr.fetchone()[0]
Path(OUTPUT).write_text(json.dumps(result,indent=2))
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',required=True)
    parser.add_argument('--worktree',type=Path,required=True)
    parser.add_argument('--database-prefix',required=True)
    parser.add_argument('--evidence-dir',type=Path,required=True)
    parser.add_argument('--mode',choices=('saas','non_saas'),default='saas')
    args=parser.parse_args()
    if not re.fullmatch(r'webvue_scratch_[a-z0-9_]{1,30}',args.database_prefix):
        parser.error('fresh scratch prefix required')
    try:
        import psycopg2
        from psycopg2 import sql
    except ModuleNotFoundError:
        os.execv(str(PYTHON),[str(PYTHON),'-B',__file__,*sys.argv[1:]])
    connection=psycopg2.connect(host='127.0.0.1',user=os.environ.get('USER','tariq'),dbname='postgres')
    connection.autocommit=True
    names=[args.database_prefix+'_'+suffix for suffix in ('before','after')]
    with connection.cursor() as cursor:
        cursor.execute('SELECT datname FROM pg_database WHERE datname=ANY(%s)',[names])
        if cursor.fetchall():
            raise RuntimeError('refusing existing scratch target')
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    runtime=Path(tempfile.mkdtemp(prefix='webvue-docs-migration-'))
    owned=[];results=[]
    target_addons=runtime/'target-addons'
    shutil.copytree(args.worktree/'odoo-addons',target_addons,ignore=shutil.ignore_patterns('__pycache__'))
    print('Target source frozen for this fixture',flush=True)
    pins=subprocess.check_output([sys.executable,'-B',str(args.worktree/'tools/oca_addons.py'),'path','--check'],text=True).strip()
    try:
        archive=subprocess.check_output(['git','archive',args.baseline,'odoo-addons'],cwd=args.worktree)
        subprocess.run(['tar','-x','-C',str(runtime)],input=archive,check=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',8295))
        for order,database in zip(('dms_before_hr','dms_after_hr'),names):
            source=runtime/order;source.mkdir()
            conf=source/'odoo.conf';conf.write_text('[options]\nlist_db=False\n')
            classification=source/'classification.json'
            subprocess.run([sys.executable,'-B',str(args.worktree/'deploy/classification.py'),'fixture','--database',database,
                '--mode',args.mode,'--output',str(classification)],check=True,stdout=subprocess.DEVNULL)
            environment=dict(os.environ,WEBVUE_COMMERCIAL_CONFIG=str(classification),PYTHONDONTWRITEBYTECODE='1')
            def run(stage,extra=(),script=None,target=False,expect_failure=False):
                addons=target_addons if target else runtime/'odoo-addons'
                command=[str(PYTHON),'-B',str(ODOO/'odoo-bin')]
                if script is not None:
                    command+=['shell']
                logfile=args.evidence_dir/(order+'-'+stage+'.log')
                command+=['-c',str(conf),'--addons-path='+','.join([str(ODOO/'odoo/addons'),str(ODOO/'addons'),str(addons),pins]),
                    '--db_host=127.0.0.1','--db_user='+os.environ.get('USER','tariq'),'-d',database,'--db-filter=^'+database+'$',
                    '--data-dir='+str(source/'data'),'--http-interface=127.0.0.1','--http-port=8295','--workers=0','--max-cron-threads=0',
                    '--logfile='+str(logfile),*extra]
                if script is not None:
                    command+=['--no-http']
                (args.evidence_dir/(order+'-'+stage+'-command.json')).write_text(json.dumps(command,indent=2))
                with logfile.with_suffix('.console').open('w') as output:
                    result=subprocess.run(command,input=script,text=True,stdout=output,stderr=subprocess.STDOUT,env=environment,timeout=300)
                failed=result.returncode!=0 or (logfile.exists() and ' ERROR ' in logfile.read_text())
                if failed!=expect_failure:
                    raise RuntimeError('unexpected stage outcome: '+str(logfile))
            owned.append(database)
            first,second=('dms','webvue_hr') if order=='dms_before_hr' else ('webvue_hr','dms')
            run('install-first',['-i',first,'--without-demo=all','--stop-after-init'])
            run('install-second',['-i',second,'--without-demo=all','--stop-after-init'])
            run('seed',script=SEED)
            before=args.evidence_dir/(order+'-before.json')
            run('before',script='OUTPUT='+repr(str(before))+'\n'+SNAPSHOT)
            import tarfile
            before_dump=args.evidence_dir/(order+'-before.dump')
            with before_dump.open('wb') as output:
                subprocess.run(['pg_dump','-h','127.0.0.1','-U',os.environ.get('USER','tariq'),'-Fc',database],stdout=output,check=True)
            before_store=args.evidence_dir/(order+'-before-filestore.tar')
            with tarfile.open(before_store,'w') as archive:
                archive.add(source/'data/filestore'/database,arcname='filestore')
            before_manifest={'kind':'webvue-documents-synthetic-fixture-v1','stage':'before','database':database,'mode':args.mode,'baseline':args.baseline,
                'snapshot':before.name,'dump':before_dump.name,'dump_sha256':hashlib.sha256(before_dump.read_bytes()).hexdigest(),
                'filestore':before_store.name,'filestore_sha256':hashlib.sha256(before_store.read_bytes()).hexdigest()}
            (args.evidence_dir/(order+'-before-backup.json')).write_text(json.dumps(before_manifest,indent=2))
            before_dump.chmod(0o600);before_store.chmod(0o600)
            # Preflight is read-only in the old registry; every unsupported case
            # is rejected inside a savepoint without touching model identity.
            helper=args.worktree/'odoo-addons/webvue_documents/migrations/19.0.1.0.0/pre-adopt_hr.py'
            negative="from odoo.modules.module import load_script\nscript=load_script("+repr(str(helper))+",'odoo.upgrade.docs_fixture')\n"
            negative+="assert not script.preflight(env.cr)['issues']\n"
            negative+="a=env['ir.attachment'].search([('res_model','=','webvue.hr.document')],limit=1)\n"
            negative+="original=(a.name,a.type,a.url,a.res_id)\n"
            negative+="a.write({'type':'url','url':'https://example.invalid/private'})\nenv.flush_all()\nassert any(i['code']=='external_attachment' for i in script.preflight(env.cr)['issues'])\nenv.cr.rollback()\n"
            negative+="a=env['ir.attachment'].search([('res_model','=','webvue.hr.document')],limit=1)\nother=a.copy({'res_model':a.res_model,'res_id':a.res_id})\nenv['webvue.hr.document'].browse(a.res_id).write({'attachment_ids':[(4,other.id)]})\nenv.flush_all()\nassert any(i['code']=='duplicate_filename' for i in script.preflight(env.cr)['issues'])\nenv.cr.rollback()\n"
            negative+="a=env['ir.attachment'].search([('res_model','=','webvue.hr.document')],limit=1)\nother=env['webvue.hr.document'].search([('id','!=',a.res_id)],limit=1)\nother.write({'attachment_ids':[(4,a.id)]})\nenv.flush_all()\nassert any(i['code']=='shared_attachment' for i in script.preflight(env.cr)['issues'])\nenv.cr.rollback()\n"
            negative+="a=env['ir.attachment'].search([('res_model','=','webvue.hr.document')],limit=1)\na.write({'res_id':0})\nenv.flush_all()\nassert any(i['code']=='unexpected_attachment_parent' for i in script.preflight(env.cr)['issues'])\nenv.cr.rollback()\n"
            negative+="env['dms.storage'].create({'name':'Unowned fixture storage'})\nenv.flush_all()\nassert any(i['code']=='unowned_dms' for i in script.preflight(env.cr)['issues'])\nenv.cr.rollback()\n"
            negative+="from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT\np=env.ref('webvue_platform.tenant_profile')\np.with_context(**{OPERATOR_CONTEXT:True}).write({'commercial_revision_id':'synthetic-existing-revision','commercial_digest':'a'*64})\nenv.flush_all()\nassert any(i['code']=='trusted_entitlement_transition_required' for i in script.preflight(env.cr)['requirements'])\nenv.cr.rollback()\n"
            run('negative-preflight',script=negative)
            # Fail three real upgrade boundaries on the frozen candidate. HR
            # may have committed before a receiving addon fails: retain data,
            # require maintenance, and verify retry completes the durable marker.
            hook=target_addons/'webvue_documents/hooks.py'
            adoption=target_addons/'webvue_documents/migrations/19.0.1.0.0/pre-adopt_hr.py'
            original_hook=hook.read_text();original_adoption=adoption.read_text()
            for phase in ('metadata','before_reparent','after_dms'):
                try:
                    if phase=='after_dms':
                        # Insert within post_init, before its completion hook.
                        hook.write_text(original_hook.replace('    complete_legacy_adoption(env)',
                            "    raise RuntimeError('synthetic failure after DMS')\n    complete_legacy_adoption(env)",1))
                    else:
                        needle=("    model_xids.write(" if phase=='metadata' else "    env['ir.attachment'].search(")
                        # Source formatting does not change this semantic point.
                        lines=original_adoption.splitlines(True)
                        index=next(i for i,line in enumerate(lines) if line.startswith(needle))
                        if phase=='metadata':
                            while ')' not in lines[index]:
                                index+=1
                            index+=1
                        lines.insert(index,"    raise RuntimeError('synthetic failure at "+phase+"')\n")
                        adoption.write_text(''.join(lines))
                    run('injected-'+phase,['-i','webvue_documents,webvue_documents_hr','-u','webvue_hr','--without-demo=all','--stop-after-init'],target=True,expect_failure=True)
                    rolled=psycopg2.connect(host='127.0.0.1',user=os.environ.get('USER','tariq'),dbname=database)
                    try:
                        with rolled.cursor() as cursor:
                            cursor.execute('SELECT model FROM ir_model WHERE id=%s',[json.loads(before.read_text())['model_id']])
                            actual_model=cursor.fetchone()[0]
                            assert actual_model in ('webvue.hr.document','webvue.document')
                            cursor.execute('SELECT id,res_id,name,checksum,store_fname FROM ir_attachment WHERE res_model=%s ORDER BY id',[actual_model])
                            expected=json.loads(before.read_text())['attachments']
                            assert cursor.fetchall()==[(a['id'],a['document_id'],a['name'],a['checksum'],a['store_fname']) for a in expected]
                            for attachment in expected:
                                payload=(source/'data/filestore'/database/attachment['store_fname']).read_bytes()
                                assert hashlib.sha256(payload).hexdigest()==attachment['bytes_sha256']
                    finally:
                        rolled.close()
                finally:
                    hook.write_text(original_hook);adoption.write_text(original_adoption)
            run('upgrade',['-i','webvue_documents,webvue_documents_hr','-u','webvue_hr','--without-demo=all','--stop-after-init'],target=True)
            after=args.evidence_dir/(order+'-after.json')
            run('after',script='OUTPUT='+repr(str(after))+'\n'+SNAPSHOT,target=True)
            subprocess.run([sys.executable,'-B',str(args.worktree/'tools/documents_acceptance/compare.py'),
                '--before',str(before),'--after',str(after)],check=True)
            run('repeat-upgrade',['-u','webvue_hr,webvue_documents,webvue_documents_hr','--without-demo=all','--stop-after-init'],target=True)
            repeated=args.evidence_dir/(order+'-repeated.json')
            run('repeated',script='OUTPUT='+repr(str(repeated))+'\n'+SNAPSHOT,target=True)
            assert json.loads(after.read_text())==json.loads(repeated.read_text())
            # Retain synthetic after-upgrade snapshots for a separate restore
            # rehearsal. Each dump and filestore tar is bound by its SHA256.
            import tarfile
            dump=args.evidence_dir/(order+'-after.dump')
            with dump.open('wb') as output:
                subprocess.run(['pg_dump','-h','127.0.0.1','-U',os.environ.get('USER','tariq'),'-Fc',database],stdout=output,check=True)
            store=args.evidence_dir/(order+'-filestore.tar')
            with tarfile.open(store,'w') as archive:
                archive.add(source/'data/filestore'/database,arcname='filestore')
            manifest={'kind':'webvue-documents-synthetic-fixture-v1','database':database,'mode':args.mode,'baseline':args.baseline,
                'snapshot':after.name,'dump':dump.name,'dump_sha256':hashlib.sha256(dump.read_bytes()).hexdigest(),
                'filestore':store.name,'filestore_sha256':hashlib.sha256(store.read_bytes()).hexdigest()}
            (args.evidence_dir/(order+'-backup.json')).write_text(json.dumps(manifest,indent=2))
            for item in (dump,store,before,after,repeated):
                item.chmod(0o600)
            results.append({'order':order,'passed':True,'stable_identity_and_bytes':True,'narrow_roles':True,'idempotent':True,'negative_preflight':6,'failure_points':3,'actual_upgrade_resume':True})
    except Exception as exc:
        import traceback
        traceback.print_exc()
        results.append({'passed':False,'error':type(exc).__name__+': '+str(exc)})
    finally:
        with connection.cursor() as cursor:
            for database in owned:
                cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()',[database])
                cursor.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(database)))
        connection.close();shutil.rmtree(runtime)
    report={'passed':len(results)==2 and all(x['passed'] for x in results),'baseline':args.baseline,'mode':args.mode,
        'results':results,'cleaned_databases':owned}
    (args.evidence_dir/'migration_fixture.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
    return 0 if report['passed'] else 1

if __name__=='__main__':
    sys.exit(main())
