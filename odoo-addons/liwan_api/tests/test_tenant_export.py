# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime
import hashlib
import io
import json
import zipfile
from unittest.mock import patch

import openpyxl

from odoo import SUPERUSER_ID, Command, fields
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import LiwanApiCase, exempt_isolation_route
from .tenant_export_columns import COLUMNS
from .tenant_export_support import assert_columns_pinned
from odoo.addons.liwan_api.models import tenant_export as export_module
from odoo.addons.liwan_api.models import tenant_export_archive as archive_module
from odoo.addons.liwan_api.models.tenant_export_hooks import (
    SENSITIVE_NAME,
    model_dataset,
)
from odoo.addons.liwan_api.models.tenant_export_stream import iter_zip
from odoo.addons.liwan_api.serializers.tenant_export import dump_export
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

PASSWORD = 'tenant_export_pass_123'
URL = '/api/v1/admin/tenant-export'
HOOKS = 'liwan.tenant.export.hooks'


class ExportFixture:
    """A tenant root with one branch and an administrator who holds the system administrator role in the root only."""

    @classmethod
    def _fixture(cls):
        cls.profile = cls.env.ref('liwan_platform.tenant_profile')
        cls.profile._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())
        cls.root = cls.profile.root_company_id
        cls.branch = cls.env['res.company'].browse(
            cls.profile.with_context(**{OPERATOR_CONTEXT: True})._liwan_apply_branches(
                'tenant-export', 'test', [{'branch_id': 'export-branch', 'name': 'Export branch'}],
            )[0]['odoo_company_id'],
        )
        cls.access = cls.env['liwan.access.service']
        cls.admin_role = cls.env.ref('liwan_core.role_system_admin')
        cls.admin = cls._user('export_admin', [cls.root.id, cls.branch.id])
        cls.other_admin = cls._user('export_other_admin', [cls.root.id, cls.branch.id])
        cls.employee = new_test_user(
            cls.env, login='export_employee', password=PASSWORD, name='Export employee', groups='liwan_core.group_employee',
        )
        cls.access._liwan_replace_assignments(
            cls.employee, [{'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': cls.root.id}],
        )

    @classmethod
    def _user(cls, login, companies):
        """An administrator with the role in the root company only, whatever companies the account belongs to."""
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee',
            company_id=cls.root.id, company_ids=[Command.set(companies)],
        )
        cls.access._liwan_replace_assignments(user, [{'role_id': cls.admin_role.id, 'company_id': cls.root.id}])
        return user

    def exports(self, user=None, companies=None):
        env = self.env(user=(user or self.admin).id, context={'allowed_company_ids': companies or [self.root.id]})
        return env['liwan.tenant.export']

    def run_cron(self, times=1):
        for _ in range(times):
            self.env['liwan.tenant.export']._liwan_cron_build()

    def build(self, user=None, runs=60):
        job = self.exports(user)._liwan_request()
        for _ in range(runs):
            self.run_cron()
            job.invalidate_recordset()
            if job.state not in ('requested', 'running'):
                break
        return job

    def tree(self, job):
        return job._liwan_path()

    def archive(self, job):
        return zipfile.ZipFile(io.BytesIO(b''.join(iter_zip(self.tree(job)))))

    def age(self, job, delta):
        """Move the request of ``job`` back in time (the creation time is not writable through the ORM)."""
        self.env.cr.execute('UPDATE liwan_tenant_export SET create_date = create_date - %s WHERE id = %s', [delta, job.id])
        job.invalidate_recordset()

    def reset_cooldown(self):
        self.env['liwan.tenant.export'].search([]).with_user(SUPERUSER_ID).unlink()

    def sample(self, partner, **kwargs):
        """Register a one-dataset hook over ``partner`` so a test controls exactly what is exported."""
        env = self.env

        def datasets(_model):
            return [model_dataset(
                env, 'sample', 'sample_partners', 'Sample partners', 'res.partner', fields=('id', 'name', 'comment'),
                domain=[('id', '=', partner.id)], scope='Only the sample partner.', **kwargs,
            )]

        return patch.object(type(self.env[HOOKS]), '_liwan_export_datasets', datasets)


@tagged('post_install', '-at_install', 'liwan')
class TestTenantExport(ExportFixture, TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._fixture()

    # ---- authorization ----

    def test_the_capability_is_the_system_administrator_only(self):
        permission = self.env.ref('liwan_api.permission_tenant_export')
        self.assertFalse(permission.custom_role_allowed)
        with self.assertRaises(ValidationError):
            self.env['liwan.access.role'].create({'key': 'export_custom', 'name_ar': 'x', 'permission_ids': [Command.link(permission.id)]})
        self.assertTrue(self.access._liwan_has_capability(self.admin, 'tenant.export'))
        self.assertFalse(self.access._liwan_has_capability(self.employee, 'tenant.export'))

    def test_vendor_support_never_holds_the_capability(self):
        support = new_test_user(self.env, login='export_vendor', groups='liwan_core.group_vendor_support')
        self.assertNotIn('tenant.export', self.access._liwan_capability_keys(support))

    def test_an_administrator_without_a_branch_role_exports_in_every_branch_mode(self):
        for mode in ('delegated', 'isolated', 'inherited'):
            with self.subTest(mode=mode):
                self.root.write({'liwan_branch_access_mode': mode})
                self.reset_cooldown()
                job = self.exports()._liwan_request()
                self.assertEqual(job.state, 'requested')

    def test_only_the_root_session_may_export(self):
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports(companies=[self.branch.id])._liwan_request()
        self.assertEqual((caught.exception.code, caught.exception.status), ('forbidden', 403))
        self.assertFalse(self.env['liwan.tenant.export'].search_count([]))
        with self.assertRaises(LiwanAccessRule):
            self.exports(user=self.employee)._liwan_request()

    # ---- the data ----

    def test_a_dataset_declares_columns_that_exist_and_none_is_sensitive(self):
        datasets = {item['key']: item for item in self.env[HOOKS]._liwan_export_datasets()}
        for key, dataset in datasets.items():
            for column in dataset['header']:
                self.assertFalse(SENSITIVE_NAME.search(column), f'{key} exports {column}')
        self.assertEqual(
            datasets['users']['header'],
            ['id', 'login', 'name', 'email', 'active', 'company_id', 'company_ids', 'lang', 'tz', 'create_date', 'login_date'],
        )
        for name in ('login', 'name', 'email', 'active', 'company_id', 'company_ids', 'lang', 'tz', 'login_date'):
            self.assertIn(name, self.env['res.users']._fields)
        self.assertIn('latest_version', self.env['ir.module.module']._fields)

    def test_the_base_datasets_cover_both_companies_and_the_roles(self):
        job = self.build()
        self.assertEqual(job.state, 'done', job.failure)
        with self.archive(job) as zipped:
            names = set(zipped.namelist())
            self.assertTrue({'base/users.xlsx', 'base/companies.xlsx', 'base/roles.xlsx', 'manifest.json', 'manifest.xlsx'} <= names)
            manifest = json.loads(zipped.read('manifest.json'))
            companies = openpyxl.load_workbook(io.BytesIO(zipped.read('base/companies.xlsx')), read_only=True)['Companies']
            users = openpyxl.load_workbook(io.BytesIO(zipped.read('base/users.xlsx')), read_only=True)['Users']
        rows = {item['key']: item['rows'] for item in manifest['datasets']}
        self.assertGreaterEqual(rows['companies'], 2)
        rows_of = list(companies.iter_rows(values_only=True))
        self.assertIn('Export branch', {row[rows_of[0].index('name')] for row in rows_of[1:]})
        people = list(users.iter_rows(values_only=True))
        self.assertIn('export_admin', {row[people[0].index('login')] for row in people[1:]})
        self.assertEqual(job.counts['rows'], rows)

    def test_role_assignments_of_vendor_support_are_hidden_like_the_users(self):
        support = new_test_user(self.env, login='export_hidden_vendor', groups='liwan_core.group_vendor_support')
        self.env['liwan.access.assignment'].create({'user_id': support.id, 'role_id': self.admin_role.id, 'company_id': support.company_id.id})
        datasets = {item['key']: item for item in self.env[HOOKS]._liwan_export_datasets()}
        rows, _last, _done = datasets['role_assignments']['rows'](0, 10_000)
        header = datasets['role_assignments']['header']
        self.assertNotIn(support.id, [row[header.index('user_id')] for row in rows])
        self.assertIn(self.admin.id, [row[header.index('user_id')] for row in rows])
        self.assertTrue(datasets['role_assignments']['filter']['scope'])

    def test_the_exported_columns_are_pinned(self):
        assert_columns_pinned(self, COLUMNS)

    # ---- the job ----

    def test_the_job_lifecycle_and_one_at_a_time(self):
        job = self.exports()._liwan_request()
        self.assertEqual(job.state, 'requested')
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports()._liwan_request()
        self.assertEqual((caught.exception.code, caught.exception.status), ('export_in_progress', 409))
        for _ in range(60):
            self.run_cron()
            job.invalidate_recordset()
            if job.state == 'done':
                break
        self.assertEqual(job.state, 'done', job.failure)
        self.assertTrue(job._liwan_path().is_dir())
        self.assertEqual(job.steps_done, job.steps_total)
        self.assertEqual(job.expires_at - job.finished_at, export_module.RETENTION)
        self.assertGreater(job.size_bytes, 0)

    def test_the_cooldown_blocks_a_new_request_for_a_day_and_a_failure_does_not_use_it(self):
        job = self.build()
        self.assertEqual(job.state, 'done')
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports()._liwan_request()
        self.assertEqual((caught.exception.code, caught.exception.status), ('export_cooldown', 429))
        self.assertIn('next_request_at', caught.exception.details)
        listing = self.exports()._liwan_listing()
        self.assertEqual(listing[2], job.create_date + export_module.COOLDOWN)
        job.with_user(SUPERUSER_ID).write({'state': 'failed', 'failure': 'build_failed'})
        self.assertIsNone(self.exports()._liwan_listing()[2])
        self.assertTrue(self.exports()._liwan_request())

    def test_a_finished_export_replaces_the_previous_archive(self):
        first = self.build()
        first_path = first._liwan_path()
        self.age(first, export_module.COOLDOWN * 2)
        second = self.build()
        self.assertEqual(second.state, 'done')
        first.invalidate_recordset()
        self.assertEqual(first.state, 'expired')
        self.assertFalse(first_path.exists())
        self.assertTrue(second._liwan_path().is_dir())

    def test_a_build_that_takes_several_runs_completes(self):
        job = self.exports()._liwan_request()
        with patch.object(type(job), '_liwan_checkpoint', lambda _self: 0):
            self.run_cron()
            job.invalidate_recordset()
            self.assertEqual(job.state, 'running')
            self.assertEqual(job.steps_done, 1)
            self.assertLess(job.steps_done, job.steps_total)
            for _ in range(80):
                self.run_cron()
                job.invalidate_recordset()
                if job.state == 'done':
                    break
        self.assertEqual(job.state, 'done', job.failure)
        self.assertEqual(job.steps_done, job.steps_total)

    def test_a_killed_step_resumes_without_duplicating_or_losing_rows_or_files(self):
        parent = self.env['res.partner'].create({'name': 'Export resume owner'})
        for index in range(5):
            self.env['ir.attachment'].create({'name': f'doc{index}.txt', 'raw': f'doc {index}'.encode(), 'res_model': 'res.partner', 'res_id': parent.id})
        with self.sample(parent, attachments=True), patch.object(archive_module, 'CHUNK_ROWS', 1), patch.object(archive_module, 'FILE_RECORDS', 1):
            job = self.exports()._liwan_request()
            real = archive_module._files_step
            calls = []

            def killed_once(root, progress, dataset):
                calls.append(1)
                real(root, progress, dataset)
                if len(calls) == 1:
                    msg = 'killed after the copy, before the progress was kept'
                    raise RuntimeError(msg)

            with patch.object(archive_module, '_files_step', killed_once):
                for _ in range(40):
                    self.run_cron()
                    job.invalidate_recordset()
                    if job.state == 'done':
                        break
        self.assertEqual(job.state, 'done', job.failure)
        with self.archive(job) as zipped:
            files = sorted(name for name in zipped.namelist() if name.startswith('files/sample/'))
            manifest = json.loads(zipped.read('manifest.json'))
        self.assertEqual(len(files), 5)
        entry = manifest['datasets'][0]
        self.assertEqual((entry['rows'], entry['files']), (1, 5))

    def test_a_step_that_keeps_failing_fails_the_job_with_a_fixed_code(self):
        job = self.exports()._liwan_request()
        with patch.object(archive_module, 'run_step', side_effect=ValueError('secret detail /srv/path')):
            for _ in range(export_module.MAX_ATTEMPTS):
                self.run_cron()
        job.invalidate_recordset()
        self.assertEqual((job.state, job.failure), ('failed', 'build_failed'))
        self.assertNotIn('secret', job.failure)
        self.assertFalse(job.archive_name)
        self.assertFalse(any(self.env['liwan.tenant.export']._liwan_dir().glob(f'{job.id}-*')))
        self.assertTrue(self.exports()._liwan_request())

    def test_an_export_that_cannot_finish_in_time_fails(self):
        job = self.exports()._liwan_request()
        self.age(job, export_module.MAX_AGE * 2)
        self.run_cron()
        job.invalidate_recordset()
        self.assertEqual((job.state, job.failure), ('failed', 'timeout'))

    def test_a_build_without_enough_free_disk_fails_before_writing_and_tells_the_requester(self):
        job = self.exports()._liwan_request()
        with patch.object(type(job), '_liwan_free_bytes', lambda _self, _directory: 0):
            self.run_cron()
        job.invalidate_recordset()
        self.assertEqual((job.state, job.failure), ('failed', 'insufficient_disk'))
        self.assertFalse(job.archive_name)

    def test_a_requester_demoted_or_deactivated_before_the_build_fails_the_job(self):
        job = self.env['liwan.tenant.export'].browse(self.exports()._liwan_request().id)
        self.access._liwan_replace_assignments(self.admin, [{'role_id': self.env.ref('liwan_core.role_employee').id, 'company_id': self.root.id}])
        self.run_cron()
        job.invalidate_recordset()
        self.assertEqual((job.state, job.failure), ('failed', 'requester_not_authorized'))
        self.access._liwan_replace_assignments(self.admin, [{'role_id': self.admin_role.id, 'company_id': self.root.id}])
        self.reset_cooldown()
        job = self.env['liwan.tenant.export'].browse(self.exports()._liwan_request().id)
        self.admin.with_user(SUPERUSER_ID).write({'active': False})
        self.run_cron()
        job.invalidate_recordset()
        self.assertEqual(job.failure, 'requester_not_authorized')

    def test_a_requester_demoted_after_the_build_cannot_download_but_another_administrator_can(self):
        job = self.build()
        self.assertEqual(job.state, 'done')
        path, _name = self.exports(user=self.other_admin)._liwan_download(job.id)
        self.assertTrue(path.is_dir())
        self.access._liwan_replace_assignments(self.admin, [{'role_id': self.env.ref('liwan_core.role_employee').id, 'company_id': self.root.id}])
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports(user=self.admin)._liwan_download(job.id)
        self.assertEqual(caught.exception.status, 403)

    def test_a_download_past_the_expiry_is_refused_before_the_cron_runs(self):
        job = self.build()
        job.with_user(SUPERUSER_ID).write({'expires_at': fields.Datetime.now() - datetime.timedelta(minutes=1)})
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports()._liwan_download(job.id)
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual((dump_export(job)['state'], dump_export(job)['downloadable']), ('expired', False))

    def test_the_expiry_cron_deletes_the_archive_and_leftovers_independently_of_the_build(self):
        job = self.build()
        path = job._liwan_path()
        leftover = self.env['liwan.tenant.export']._liwan_dir() / '999-0123456789abcdef'
        leftover.mkdir()
        job.with_user(SUPERUSER_ID).write({'expires_at': fields.Datetime.now() - datetime.timedelta(minutes=1)})
        self.env['liwan.tenant.export']._liwan_cron_expire()
        job.invalidate_recordset()
        self.assertEqual(job.state, 'expired')
        self.assertFalse(path.exists())
        self.assertFalse(leftover.exists())

    def test_the_requester_is_an_id_so_removing_the_account_is_not_blocked(self):
        job = self.build()
        user = new_test_user(self.env, login='export_removed', groups='liwan_core.group_employee')
        job.with_user(SUPERUSER_ID).write({'requester_id': user.id})
        self.env['liwan.tenant.export.log'].search([('export_id', '=', job.id)]).with_user(SUPERUSER_ID).write({'actor_id': user.id})
        user.unlink()
        self.assertTrue(job.exists())

    def test_a_failing_notification_does_not_undo_a_finished_build(self):
        with patch.object(type(self.env['liwan.tenant.export']), '_liwan_notify_outcome', side_effect=RuntimeError('bell down')):
            job = self.build()
        self.assertEqual(job.state, 'done')
        self.assertTrue(job._liwan_path().is_dir())

    def test_the_log_holds_ids_and_counts_only(self):
        job = self.build()
        self.exports()._liwan_download(job.id)
        log = self.env['liwan.tenant.export.log'].search([('export_id', '=', job.id)], order='id')
        self.assertEqual(log.mapped('kind'), ['request', 'built', 'download'])
        self.assertEqual(log[0].actor_id, self.admin.id)
        self.assertEqual(log[1].counts, job.counts)
        self.assertNotIn('Export branch', json.dumps(log.mapped('counts')))
        with self.assertRaises(Exception):  # noqa: B017 - AccessError for a non superuser
            log.with_user(self.admin).write({'kind': 'request'})
        with self.assertRaises(Exception):  # noqa: B017
            log.with_user(self.admin).unlink()

    def test_the_archive_is_no_attachment_and_never_counts_as_storage(self):
        attachments = self.env['ir.attachment'].search_count([])
        used = self.profile.storage_used_bytes
        self.build()
        self.assertEqual(self.env['ir.attachment'].search_count([]), attachments)
        self.assertEqual(self.profile.storage_used_bytes, used)

    # ---- the content ----

    def test_files_are_included_with_a_checksum_and_listed_in_the_manifest(self):
        partner = self.env['res.partner'].create({'name': 'Export file owner'})
        content = b'tenant export file'
        attachment = self.env['ir.attachment'].create({'name': 'proof.txt', 'raw': content, 'res_model': 'res.partner', 'res_id': partner.id})
        with self.sample(partner, attachments=True):
            job = self.build()
        self.assertEqual(job.state, 'done', job.failure)
        path = f'files/sample/sample_partners/{partner.id}/{attachment.id}_proof.txt'
        with self.archive(job) as zipped:
            self.assertEqual(zipped.read(path), content)
            sheet = openpyxl.load_workbook(io.BytesIO(zipped.read('sample/sample_partners_files.xlsx')), read_only=True)['File manifest']
            manifest = json.loads(zipped.read('manifest.json'))
        rows = list(sheet.iter_rows(values_only=True))
        self.assertEqual(rows[0], ('dataset', 'record_id', 'file', 'name', 'size_bytes', 'sha256'))
        self.assertEqual(rows[1], ('sample_partners', partner.id, path, 'proof.txt', len(content), hashlib.sha256(content).hexdigest()))
        self.assertEqual(manifest['datasets'][0]['files'], 1)
        self.assertEqual(job.counts['files'], 1)

    def test_an_attachment_with_an_absolute_or_odd_name_stays_inside_the_tree(self):
        partner = self.env['res.partner'].create({'name': 'Export odd names'})
        for name in ('/etc/passwd', '../../escape.txt', '..', 'a\\b\\c.txt', 'x' * 300 + '.pdf', ''):
            self.env['ir.attachment'].create({'name': name or 'unnamed', 'raw': b'x', 'res_model': 'res.partner', 'res_id': partner.id})
        with self.sample(partner, attachments=True):
            job = self.build()
        root = job._liwan_path().resolve()
        written = [path for path in root.rglob('*') if path.is_file()]
        self.assertTrue(all(root in path.resolve().parents for path in written))
        names = [path.name for path in written if 'files' in path.parts]
        self.assertEqual(len(names), 6)
        self.assertTrue(all(len(name) <= 140 and '/' not in name for name in names))
        self.assertTrue(any(name.endswith('.pdf') for name in names), 'a long name keeps its extension')
        with self.archive(job) as zipped:
            self.assertFalse([name for name in zipped.namelist() if '..' in name.split('/') or name.startswith('/')])

    def test_zip_entries_have_a_normal_file_mode(self):
        job = self.build()
        with self.archive(job) as zipped:
            for info in zipped.infolist():
                self.assertEqual(info.external_attr >> 16, 0o644, info.filename)

    def test_a_formula_looking_value_is_neutralised_through_the_real_export(self):
        partner = self.env['res.partner'].create({'name': '=HYPERLINK("http://x","y")', 'comment': '+1+1'})
        with self.sample(partner):
            job = self.build()
        with self.archive(job) as zipped:
            sheet = openpyxl.load_workbook(io.BytesIO(zipped.read('sample/sample_partners.xlsx')))['Sample partners']
        for cell in (sheet['B2'], sheet['C2']):
            self.assertEqual(cell.data_type, 's')
            self.assertFalse(str(cell.value).startswith(('=', '+')), cell.value)

    def test_a_text_too_long_for_a_cell_goes_to_a_side_file_with_a_marker_and_a_count(self):
        long_text = 'long ' * 10_000
        partner = self.env['res.partner'].create({'name': 'Export long note', 'comment': f'<p>{long_text}</p>'})
        with self.sample(partner):
            job = self.build()
        self.assertEqual(job.state, 'done', job.failure)
        side = f'overflow/sample/sample_partners/{partner.id}_comment.txt'
        with self.archive(job) as zipped:
            self.assertEqual(zipped.read(side).decode().strip(), long_text.strip())
            sheet = openpyxl.load_workbook(io.BytesIO(zipped.read('sample/sample_partners.xlsx')))['Sample partners']
            manifest = json.loads(zipped.read('manifest.json'))
        self.assertIn(side, sheet['C2'].value)
        self.assertEqual(manifest['datasets'][0]['overflow_cells'], 1)
        self.assertEqual(job.counts['overflow_cells'], 1)

    def test_a_dataset_over_the_chunk_size_is_split_into_numbered_workbooks(self):
        for index in range(3):
            self.env['res.partner'].create({'name': f'Export chunk {index}'})
        env = self.env

        def datasets(_model):
            return [model_dataset(env, 'sample', 'chunks', 'Chunks', 'res.partner', fields=('id', 'name'),
                                  domain=[('name', 'like', 'Export chunk')], scope='Only the chunk partners.')]

        with patch.object(type(self.env[HOOKS]), '_liwan_export_datasets', datasets), patch.object(archive_module, 'CHUNK_ROWS', 2):
            job = self.build()
        with self.archive(job) as zipped:
            names = set(zipped.namelist())
            manifest = json.loads(zipped.read('manifest.json'))
        self.assertTrue({'sample/chunks.xlsx', 'sample/chunks_0002.xlsx'} <= names)
        self.assertEqual(manifest['datasets'][0]['rows'], 3)

    def test_the_manifest_states_filters_and_lists_every_model_that_holds_rows(self):
        stray = self.env['res.partner'].create({'name': 'Export stray partner'})
        job = self.build()
        with self.archive(job) as zipped:
            manifest = json.loads(zipped.read('manifest.json'))
        users = next(item for item in manifest['datasets'] if item['key'] == 'users')
        self.assertTrue(users['filter']['scope'])
        self.assertLessEqual(users['filter']['rows_exported'], users['filter']['rows_in_model'])
        flat = {item['model']: item for group in manifest['not_included'] for item in group['models']}
        # A stock model with rows and no dataset is listed with its row count, a LiwanOS technical one with its reason.
        self.assertEqual(flat['liwan.account.token']['reason'], 'credentials')
        self.assertTrue(all(item['rows'] > 0 for model, item in flat.items() if not model.startswith('liwan.')))
        self.assertNotIn('ir.model', flat)
        self.assertEqual(manifest['not_included'], sorted(manifest['not_included'], key=lambda group: group['owner']))
        for model, item in flat.items():
            if 'payroll' in model or 'payslip' in model:
                self.assertEqual(item['reason'], 'compensation', model)
        self.assertTrue(manifest['also_not_included'])
        self.assertTrue(stray.exists())

    def test_an_attachment_of_a_model_that_is_not_exported_is_counted_not_dropped(self):
        partner = self.env['res.partner'].create({'name': 'Export unexported owner'})
        self.env['ir.attachment'].create({'name': 'left.txt', 'raw': b'12345', 'res_model': 'res.partner', 'res_id': partner.id})
        self.env['ir.attachment'].create({'name': 'loose.txt', 'raw': b'123'})
        with self.sample(self.env['res.partner']):
            job = self.build()
        with self.archive(job) as zipped:
            manifest = json.loads(zipped.read('manifest.json'))
        left = {item['model']: item for item in manifest['attachments_not_exported']}
        self.assertGreaterEqual(left['res.partner']['files'], 1)
        self.assertGreaterEqual(left['res.partner']['bytes'], 5)
        self.assertGreaterEqual(left['']['files'], 1)
        self.assertNotIn('ir.ui.view', left)

    def test_a_dataset_with_a_filter_must_state_its_scope(self):
        with self.assertRaises(ValueError):
            model_dataset(self.env, 'x', 'y', 'Y', 'res.partner', fields=('id',), domain=[('id', '=', 1)])

    def test_the_ready_progress_is_in_the_job_view(self):
        job = self.build()
        shown = dump_export(job)
        self.assertEqual((shown['steps_done'], shown['steps_total']), (job.steps_total, job.steps_total))
        self.assertIsNone(shown['failure'])


@tagged('post_install', '-at_install', 'liwan')
class TestTenantExportRoutes(ExportFixture, LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._fixture()

    def _operator(self):
        return self.profile.with_context(**{OPERATOR_CONTEXT: True})

    def _walk(self):
        self.authenticate('export_admin', PASSWORD)
        self.env['liwan.tenant.export'].search([]).unlink()
        listed = self.api('GET', URL)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()['total'], 0)
        requested = self.api('POST', URL, {})
        self.assertEqual(requested.status_code, 200, requested.text)
        body = requested.json()
        self.assertEqual((body['state'], body['steps_done']), ('requested', 0))
        for _ in range(60):
            self.run_cron()
            if self.env['liwan.tenant.export'].browse(body['id']).state == 'done':
                break
        download = self.api('GET', f'{URL}/{body["id"]}/download')
        self.assertEqual(download.status_code, 200, download.text[:200])
        self.assertEqual(download.headers['Content-Type'], 'application/zip')
        self.assertIn('manifest.json', zipfile.ZipFile(io.BytesIO(download.content)).namelist())
        again = self.api('POST', URL, {})
        self.assertEqual((again.status_code, again.json()['code']), (429, 'export_cooldown'))
        self.assertIn('next_request_at', again.json()['details'])
        self.assertEqual(self.api('GET', URL).json()['total'], 1)
        return body

    def test_an_employee_is_refused_and_an_administrator_exports(self):
        self.authenticate('export_employee', PASSWORD)
        self.assertEqual(self.api('GET', URL).status_code, 403)
        self.assertEqual(self.api('POST', URL, {}).status_code, 403)
        self._walk()

    def test_the_routes_work_while_the_tenant_is_unpaid(self):
        self._operator().write({'status': 'suspended', 'suspension_reason': 'non_payment'})
        self._walk()

    def test_the_routes_work_while_the_tenant_is_expired(self):
        self._operator().write({'valid_until': datetime.datetime.now(datetime.UTC).date() - datetime.timedelta(days=1)})
        self.assertEqual(self.env['liwan.entitlement.service']._liwan_effective_state(), 'expired')
        self._walk()

    def test_the_routes_are_a_lockout_for_a_vendor_suspension(self):
        self.authenticate('export_admin', PASSWORD)
        self._operator().write({'status': 'suspended'})
        refused = self.api('GET', URL)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'tenant_suspended'))
        self.assertIn(self.api('POST', URL, {}).status_code, (401, 403))

    def test_the_request_takes_no_fields_and_a_missing_download_is_a_404(self):
        self.authenticate('export_admin', PASSWORD)
        self.assertEqual(self.api('POST', URL, {'user': 1}).status_code, 422)
        self.assertEqual(self.api('GET', f'{URL}/999999/download').status_code, 404)

    def test_the_total_is_the_real_count_and_a_failure_shows_only_a_fixed_message(self):
        self.authenticate('export_admin', PASSWORD)
        Export = self.env['liwan.tenant.export']
        for _ in range(12):
            Export.create({'requester_id': self.admin.id, 'state': 'failed', 'failure': 'build_failed'})
        body = self.api('GET', URL).json()
        self.assertEqual((len(body['items']), body['total']), (10, 12))
        self.assertEqual(body['items'][0]['failure'], {'code': 'build_failed', 'message': export_module.FAILURE_MESSAGES['build_failed']})
        self.assertNotIn('Traceback', json.dumps(body))
        self.assertEqual(body['cooldown_hours'], 24)


exempt_isolation_route(
    '/api/v1/admin/tenant-export/<int:export_id>/download',
    'the archive of the whole tenant, not a company record: it needs the root session of the system administrator (test_tenant_export)',
)
