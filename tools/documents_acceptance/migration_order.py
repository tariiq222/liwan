"""Prove metadata adoption BEFORE target registry loading, in disposable databases only."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

from attachment_spike import ODOO, PYTHON

# These statements concern Odoo's model registry, not native business records. They
# are a characterization of the required pre-registry adoption, not a release tool.
ADOPT = '''
def preflight():
    for name in ('dms.storage', 'dms.directory', 'dms.file', 'dms.tag', 'dms.category', 'dms.access.group'):
        if env[name].with_context(active_test=False).search_count([]):
            raise RuntimeError('unowned DMS resources require a separate adoption plan: ' + name)
preflight()
old = 'liwan.hr.document'
new = 'liwan.document'
models = env['ir.model'].search([('model', '=', old)])
if models:
    if env['ir.model'].search_count([('model', '=', new)]):
        raise RuntimeError('ambiguous old and new model metadata')
    cr = env.cr
    env['ir.attachment'].search([('res_model', '=', old)]).write({'res_model': new})
    env['ir.model.data'].search([('model', '=', old)]).write({'model': new})
    fields = models.field_id
    model_xid = env['ir.model.data'].search([('model', '=', 'ir.model'), ('res_id', '=', models.id)])
    model_xid.write({'module': 'docs_adoption', 'name': 'model_liwan_document'})
    for field in fields:
        xid = env['ir.model.data'].search([('model', '=', 'ir.model.fields'), ('res_id', '=', field.id)])
        if xid:
            xid.write({'module': 'docs_adoption', 'name': 'field_liwan_document__' + field.name})
    cr.execute("UPDATE ir_model SET model=%s WHERE id=%s", [new, models.id])
    cr.execute("UPDATE ir_model_fields SET model=%s WHERE model_id=%s", [new, models.id])
    cr.execute("UPDATE ir_model_fields SET relation=%s WHERE relation=%s", [new, old])
    cr.execute('ALTER TABLE liwan_hr_document RENAME TO liwan_document')
    env.invalidate_all()
env.cr.commit()
'''
SEED = '''
import base64, json
from pathlib import Path
from odoo import Command
company = env.company
department = env['hr.department'].create({'name': 'Adoption department', 'company_id': company.id})
record = env['liwan.hr.document'].create({'name': 'Original document', 'body': '<p>Original body</p>', 'expiry_date': '2030-01-01', 'department_id': department.id})
attachment = env['ir.attachment'].create({'name': 'original.txt', 'datas': base64.b64encode(b'original adoption bytes'), 'res_model': record._name, 'res_id': record.id})
record.write({'attachment_ids': [Command.link(attachment.id)]})
permission = env.ref('liwan_hr.permission_hr_documents_read')
role = env['liwan.access.role'].create({'key':'docs_adoption_fixture', 'name_ar':'دور اختبار', 'company_id':company.id, 'permission_ids':[Command.set(permission.ids)]})
assignment = env['liwan.access.assignment'].create({'user_id':env.ref('base.user_admin').id, 'role_id':role.id, 'company_id':company.id})
env['ir.model.data'].create({'module':'docs_adoption_fixture', 'name':'document', 'model':record._name, 'res_id':record.id, 'noupdate':True})
Path(EVIDENCE).write_text(json.dumps({'id':record.id, 'attachment_id':attachment.id, 'checksum':attachment.checksum, 'store_fname':attachment.store_fname, 'model_id':env['ir.model']._get(record._name).id, 'role_id':role.id, 'permission_id':permission.id, 'assignment_id':assignment.id}))
env.cr.commit()
'''
VERIFY = '''
import json
from pathlib import Path
expected = json.loads(Path(EVIDENCE).read_text())
record = env['liwan.document'].browse(expected['id']).exists()
assert record and record.name == 'Original document'
assert record.body == '<p>Original body</p>'
assert str(record.expiry_date) == '2030-01-01'
assert record.attachment_ids.ids == [expected['attachment_id']]
attachment = record.attachment_ids
assert attachment.checksum == expected['checksum'] and attachment.store_fname == expected['store_fname']
assert attachment.res_model == 'liwan.document' and attachment.res_id == record.id
assert env.ref('docs_adoption_fixture.document') == record
assert env['ir.model']._get('liwan.document').id == expected['model_id']
role = env['liwan.access.role'].browse(expected['role_id'])
assert role.permission_ids.ids == [expected['permission_id']]
assert env['liwan.access.assignment'].browse(expected['assignment_id']).role_id == role
assert not env['ir.model'].search_count([('model', '=', 'liwan.hr.document')])
env.cr.execute("SELECT to_regclass('liwan_hr_document')")
assert env.cr.fetchone()[0] is None
'''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--worktree', type=Path, required=True)
    parser.add_argument('--database-prefix', required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args()
    import re
    if not re.fullmatch(r'liwan_scratch_[a-z0-9_]{1,38}', args.database_prefix):
        parser.error('scratch database prefix required')
    try:
        import psycopg2
    except ModuleNotFoundError:
        os.execv(str(PYTHON), [str(PYTHON), '-B', __file__, *sys.argv[1:]])
    from psycopg2 import sql
    connection = psycopg2.connect(host='127.0.0.1', user=os.environ.get('USER','tariq'), dbname='postgres')
    connection.autocommit = True
    databases = [args.database_prefix + '_before', args.database_prefix + '_after']
    with connection.cursor() as cursor:
        cursor.execute('SELECT datname FROM pg_database WHERE datname=ANY(%s)', [databases])
        if cursor.fetchall():
            parser.error('refusing existing database')
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    runtime = Path(tempfile.mkdtemp(prefix='liwan-docs-order-'))
    owned = []
    results = []
    try:
        archive = subprocess.run(['git','archive',args.baseline,'odoo-addons'],cwd=args.worktree,check=True,capture_output=True)
        subprocess.run(['tar','-x','-C',str(runtime)],input=archive.stdout,check=True)
        pins = subprocess.check_output([sys.executable,'-B',str(args.worktree/'tools/oca_addons.py'),'path','--check'],text=True).strip()
        for order, database in zip(('dms_before_hr','dms_after_hr'), databases):
            # Each order has its own baseline addon copy because the target removes the old model.
            source = runtime/order
            shutil.copytree(runtime/'odoo-addons', source/'odoo-addons')
            target = source/'odoo-addons/docs_adoption'
            target.mkdir()
            conf = source/'odoo.conf'; conf.write_text('[options]\nlist_db=False\n')
            classification = source/'classification.json'
            subprocess.run([sys.executable,'-B',str(args.worktree/'deploy/classification.py'),'fixture','--database',database,'--mode','saas','--output',str(classification)],check=True,stdout=subprocess.DEVNULL)
            env_vars = dict(os.environ,LIWAN_COMMERCIAL_CONFIG=str(classification),PYTHONDONTWRITEBYTECODE='1')
            port = 8295
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',port))
            base = [str(PYTHON),'-B',str(ODOO/'odoo-bin'),'-c',str(conf),'--addons-path='+','.join([str(ODOO/'odoo/addons'),str(ODOO/'addons'),str(source/'odoo-addons'),pins]),'--db_host=127.0.0.1','--db_user='+os.environ.get('USER','tariq'),'-d',database,'--db-filter=^'+database+'$','--data-dir='+str(source/'data'),'--http-interface=127.0.0.1','--http-port='+str(port),'--workers=0','--max-cron-threads=0']
            def run(stage, extra, script=None):
                logfile = args.evidence_dir/(order+'-'+stage+'.log')
                command = [*base] if script is None else [*base[:3],'shell',*base[3:],'--no-http']
                command += ['--logfile='+str(logfile), *extra]
                (args.evidence_dir/(order+'-'+stage+'-command.json')).write_text(json.dumps(command,indent=2))
                with logfile.with_suffix('.console').open('w') as output:
                    result = subprocess.run(command,input=script,text=True,stdout=output,stderr=subprocess.STDOUT,env=env_vars,timeout=240)
                if result.returncode or ('ERROR' in logfile.read_text()):
                    raise RuntimeError('stage failed: '+str(logfile))
            # Claim only the names we verified absent; never drop a pre-existing database.
            owned.append(database)
            first, second = ('dms','liwan_hr') if order == 'dms_before_hr' else ('liwan_hr','dms')
            run('first',['-i',first,'--without-demo=all','--stop-after-init'])
            run('second',['-i',second,'--without-demo=all','--stop-after-init'])
            evidence = str(args.evidence_dir/(order+'-seed.json'))
            run('seed',[], 'EVIDENCE='+repr(evidence)+'\n'+SEED)
            # A pre-registry metadata step is deliberate. Running adoption from HR post-migrate
            # is too late when a new dependent application is installed first.
            negative = ADOPT[:ADOPT.index("old = ")]
            run('unowned-preflight', [], "env['dms.storage'].create({'name': 'Unowned storage'})\n" + "try:\n" + ''.join('    ' + line + '\n' for line in negative.splitlines()) + "except RuntimeError:\n    env.cr.rollback()\nelse:\n    raise AssertionError('unowned DMS storage was accepted')\n")
            run('adopt',[], ADOPT)
            hr = source/'odoo-addons/liwan_hr'
            p = hr/'models/__init__.py'; p.write_text(p.read_text().replace('    hr_document,\n',''))
            p = hr/'controllers/__init__.py'; p.write_text(p.read_text().replace('    hr_documents,\n',''))
            p = hr/'__manifest__.py'; p.write_text(p.read_text().replace("        'security/hr_document_rules.xml',\n",'').replace('19.0.1.3.0','19.0.1.4.0'))
            p = hr/'security/ir.model.access.csv'; p.write_text('\n'.join(line for line in p.read_text().splitlines() if 'model_liwan_hr_document' not in line)+'\n')
            (target/'__init__.py').write_text('from . import model\n')
            (target/'__manifest__.py').write_text(repr({'name':'Disposable adoption fixture','author':'LiwanOS test fixture','version':'19.0.1.0.0','license':'LGPL-3','depends':['liwan_api','dms'],'installable':True}))
            (target/'model.py').write_text('''from odoo import fields, models
class Document(models.Model):
    _name = 'liwan.document'
    _description = 'Adoption fixture'
    name = fields.Char(required=True)
    body = fields.Html()
    expiry_date = fields.Date()
    company_id = fields.Many2one('res.company', required=True)
    department_id = fields.Many2one('hr.department', ondelete='restrict')
    attachment_ids = fields.Many2many('ir.attachment', relation='ir_attachment_liwan_hr_document_rel', column1='liwan_hr_document_id', column2='ir_attachment_id')
''')
            run('upgrade',['-i','docs_adoption','-u','liwan_hr','--without-demo=all','--stop-after-init'])
            run('verify',[], 'EVIDENCE='+repr(evidence)+'\n'+VERIFY)
            run('repeat-adopt',[], ADOPT)
            run('repeat-verify',[], 'EVIDENCE='+repr(evidence)+'\n'+VERIFY)
            results.append({'order':order,'passed':True,'id_and_table_adopted':True,'model_metadata_id_preserved':True,'attachment_bytes_reused':True,'xml_reference_preserved':True,'idempotent':True,'old_role_and_assignment_preserved':True,'unowned_preflight_rejected':True})
    except Exception as exc:
        results.append({'passed':False,'error':str(exc)})
    finally:
        with connection.cursor() as cursor:
            for database in owned:
                cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()',[database])
                cursor.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(database)))
        connection.close()
        shutil.rmtree(runtime)
    report = {'passed':len(results)==2 and all(x['passed'] for x in results),'results':results,'cleaned_databases':owned,'baseline':args.baseline}
    (args.evidence_dir/'migration_order.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
    return 0 if report['passed'] else 1

if __name__ == '__main__':
    sys.exit(main())
