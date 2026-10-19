"""Reproducible, scratch-only attachment-storage characterization (no product adapter)."""
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

ODOO = Path(os.environ.get('ODOO_ROOT', '/Users/tariq/code/odoo'))
PYTHON = ODOO / '.venv/bin/python'

MODEL = '''from odoo import api, fields, models
class FitDocument(models.Model):
    _name = 'webvue.docs.fit'
    _description = 'Disposable DMS fit fixture'
    name = fields.Char(required=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company)
    user_id = fields.Many2one('res.users', required=True, default=lambda s: s.env.user)
    directory_id = fields.Many2one('dms.directory')
'''
ADAPTER = '''
    @api.model_create_multi
    def create(self, values):
        records = super().create(values)
        for record in records:
            storage = self.env['dms.storage'].search([('name', '=', 'fit-storage')], limit=1)
            root = self.env['dms.directory'].search([('storage_id', '=', storage.id), ('is_root_directory', '=', True)], limit=1)
            directory = self.env['dms.directory'].create({'name': 'invalid/name' if record.name == 'bad-directory' else 'document-%s' % record.id, 'parent_id': root.id, 'res_model': self._name, 'res_id': record.id})
            record.directory_id = directory
        return records
'''
TESTS = '''import base64
from odoo import Command
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

@tagged('post_install', '-at_install')
class AttachmentFit(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='fit-manager', groups='base.group_user,dms.group_dms_user')
        cls.reader = new_test_user(cls.env, login='fit-reader', groups='base.group_user,dms.group_dms_user')
        cls.outsider = new_test_user(cls.env, login='fit-outsider', groups='base.group_user,dms.group_dms_user')
        model = cls.env['ir.model']._get('webvue.docs.fit')
        cls.storage = cls.env['dms.storage'].create({'name': 'fit-storage', 'save_type': 'attachment', 'company_id': cls.env.company.id, 'model_ids': [Command.set(model.ids)], 'inherit_access_from_parent_record': True})
        cls.root = cls.env['dms.directory'].create({'name': 'fit-root', 'storage_id': cls.storage.id, 'is_root_directory': True, 'res_model': 'webvue.docs.fit'})

    def test_ordinary_atomic_record_directory(self):
        doc = self.env['webvue.docs.fit'].with_user(self.manager).create({'name': 'ordinary'})
        self.assertTrue(doc.directory_id, 'ordinary create must complete the linked directory')
        self.assertEqual(doc.directory_id.res_id, doc.id)
        self.assertEqual(doc.directory_id.res_model, 'webvue.docs.fit')
        self.assertFalse(doc.env.su)

    def test_existing_attachment_identity_and_two_files(self):
        model = self.env['webvue.docs.fit'].with_user(self.manager)
        # Create the original record before linking storage, as an old HR record would exist.
        self.storage.write({'model_ids': [Command.clear()]})
        doc = model.create({'name': 'two files'})
        attachment = self.env['ir.attachment'].with_user(self.manager).create({'name': 'first.txt', 'datas': base64.b64encode(b'original bytes'), 'res_model': doc._name, 'res_id': doc.id})
        original = (attachment.id, attachment.checksum, attachment.store_fname)
        self.storage.write({'model_ids': [Command.set(self.env['ir.model']._get(doc._name).ids)]})
        first = self.env['dms.file'].with_user(self.manager).create({'name': 'first.txt', 'directory_id': doc.directory_id.id, 'attachment_id': attachment.id})
        second = self.env['dms.file'].with_user(self.manager).create({'name': 'second.txt', 'directory_id': doc.directory_id.id, 'content': base64.b64encode(b'second bytes')})
        self.assertEqual((first.attachment_id.id, first.attachment_id.checksum, first.attachment_id.store_fname), original)
        self.assertEqual(base64.b64decode(first.content), b'original bytes')
        self.assertEqual(first.directory_id, second.directory_id)
        self.assertEqual(len(doc.directory_id.file_ids), 2)
        self.assertTrue(first.with_user(self.reader).has_access('read'))
        self.assertFalse(doc.with_user(self.outsider).has_access('read'), 'fixture itself must deny outsider')
        # Exercise the actual public ORM payload, including a warm cache.
        with self.assertRaises(AccessError, msg='ungranted user must not receive original file bytes'):
            leaked = first.with_user(self.outsider).read(['content'])
            self.assertEqual(base64.b64decode(leaked[0]['content']), b'original bytes')
        with self.assertRaises(AccessError):
            first.with_user(self.reader).write({'name': 'changed.txt'})

    def test_directory_failure_rolls_back_record_and_bytes(self):
        model = self.env['webvue.docs.fit'].with_user(self.manager)
        before = (model.search_count([]), self.env['dms.directory'].search_count([]), self.env['ir.attachment'].search_count([]))
        # A real directory constraint fails after the business row has been inserted.
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            model.create({'name': 'bad-directory'})
        self.assertEqual((model.search_count([]), self.env['dms.directory'].search_count([]), self.env['ir.attachment'].search_count([])), before)
'''
DATA = '''<odoo>
<record id="access_fit" model="ir.model.access"><field name="name">Fit model</field><field name="model_id" ref="model_webvue_docs_fit"/><field name="group_id" ref="base.group_user"/><field name="perm_read" eval="True"/><field name="perm_write" eval="True"/><field name="perm_create" eval="True"/><field name="perm_unlink" eval="True"/></record>
<record id="fit_read" model="ir.rule"><field name="name">Fit linked record readers</field><field name="model_id" ref="model_webvue_docs_fit"/><field name="domain_force">[('company_id', '=', company_id), '|', ('user_id', '=', user.id), ('name', '=', 'two files')]</field><field name="perm_write" eval="False"/><field name="perm_create" eval="False"/><field name="perm_unlink" eval="False"/></record>
<record id="fit_write" model="ir.rule"><field name="name">Fit owner mutations</field><field name="model_id" ref="model_webvue_docs_fit"/><field name="domain_force">[('user_id', '=', user.id)]</field><field name="perm_read" eval="False"/></record>
</odoo>'''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worktree', type=Path, required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--http-port', type=int, default=8294)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--application', action='store_true', help='run standalone webvue_documents application tests')
    parser.add_argument('--mode', choices=('saas','non_saas'), default='saas')
    parser.add_argument('--upstream', action='store_true', help='run the pinned upstream DMS suite instead of fit assertions')
    parser.add_argument('--red', action='store_true', help='omit the fixture integration, prove assertions fail')
    args = parser.parse_args()
    if not args.database.startswith('webvue_scratch_'):
        parser.error('scratch database name required')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', args.http_port))
    # Database access is intentionally confined to an explicit scratch name.
    try:
        import psycopg2
    except ModuleNotFoundError:
        if Path(sys.executable).resolve() == PYTHON.resolve():
            raise
        os.execv(str(PYTHON), [str(PYTHON), '-B', __file__, *sys.argv[1:]])
    connection = psycopg2.connect(host='127.0.0.1', user=os.environ.get('USER', 'tariq'), dbname='postgres')
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM pg_database WHERE datname=%s', [args.database])
        if cursor.fetchone():
            parser.error('refusing existing database: ' + args.database)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    runtime = Path(tempfile.mkdtemp(prefix='webvue-docs-fit-'))
    addon = runtime / 'addons/docs_fit'
    (addon / 'tests').mkdir(parents=True)
    (addon / '__init__.py').write_text('from . import model, tests\n')
    (addon / '__manifest__.py').write_text(repr({'name':'Disposable DMS fit', 'author':'WebVue test fixture', 'license':'LGPL-3', 'depends':['dms'], 'data':['access.xml']}))
    (addon / 'model.py').write_text(MODEL + ('' if args.red else ADAPTER))
    data = DATA.replace("('name', '=', 'two files')", "('id', '!=', 0) if user.login == 'fit-reader' else ('id', '=', 0)")
    (addon / 'access.xml').write_text(data)
    (addon / 'tests/__init__.py').write_text('from . import test_fit\n')
    (addon / 'tests/test_fit.py').write_text(TESTS)
    pins = subprocess.check_output([sys.executable, '-B', str(args.worktree/'tools/oca_addons.py'), 'path', '--check'], text=True).strip()
    conf = runtime/'odoo.conf'
    conf.write_text('[options]\nlist_db=False\n')
    target = 'webvue_documents' if args.application else 'docs_fit'
    env_vars = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    if args.application:
        classification = runtime/'classification.json'
        subprocess.run([sys.executable,'-B',str(args.worktree/'deploy/classification.py'),'fixture', '--database',args.database,'--mode',args.mode,'--output',str(classification)],check=True,stdout=subprocess.DEVNULL)
        env_vars['WEBVUE_COMMERCIAL_CONFIG'] = str(classification)
    command = [str(PYTHON), '-B', str(ODOO/'odoo-bin'), '-c', str(conf), '--addons-path=' + ','.join([str(ODOO/'odoo/addons'),str(ODOO/'addons'),str(args.worktree/'odoo-addons'),str(runtime/'addons'), pins]), '--db_host=127.0.0.1', '--db_user='+os.environ.get('USER','tariq'), '-d', args.database, '--db-filter=^'+args.database+'$', '--data-dir='+str(runtime/'data'), '--logfile='+str(args.evidence_dir/'odoo.log'), '-i', target, '--test-enable', '--test-tags=' + ('/dms,-benchmark,-/dms:TestDmsPortal.test_tour' if args.upstream else '/' + target), '--without-demo=all','--stop-after-init','--http-interface=127.0.0.1','--http-port='+str(args.http_port),'--workers=0','--max-cron-threads=0']
    (args.evidence_dir/'command.json').write_text(json.dumps(command, indent=2))
    try:
        with (args.evidence_dir/'console.log').open('w') as output:
            result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, timeout=240, env=env_vars)
        log = (args.evidence_dir/'odoo.log').read_text()
        import re
        summary = re.findall(r'(\d+) failed, (\d+) error\(s\) of (\d+) tests', log)
        passed = result.returncode == 0 and bool(summary) and all(a=='0' and b=='0' and int(n)>0 for a,b,n in summary)
        report = {'passed':passed, 'database':args.database,'summary':summary,'exit_code':result.returncode,'red':args.red,'upstream':args.upstream,'application':args.application,'commercial_mode':args.mode if args.application else None,'cases':re.findall(r'Starting (\S+) \.\.\.', log),'cleaned':False}
    finally:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()', [args.database])
            from psycopg2 import sql
            cursor.execute(sql.SQL('DROP DATABASE IF EXISTS {}').format(sql.Identifier(args.database)))
        connection.close()
        shutil.rmtree(runtime)
    report['cleaned'] = True
    (args.evidence_dir/'attachment_spike.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
    return 0 if passed else 1

if __name__ == '__main__':
    sys.exit(main())
