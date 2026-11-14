# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime
import hashlib
import io
import json
import zipfile
from unittest.mock import patch

import openpyxl

from odoo import SUPERUSER_ID, Command, fields
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import LiwanApiCase, exempt_isolation_route
from odoo.addons.liwan_api.models import tenant_export as export_module
from odoo.addons.liwan_api.models.tenant_export_hooks import (
    SENSITIVE_NAME,
    model_dataset,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

PASSWORD = 'tenant_export_pass_123'
URL = '/api/v1/admin/tenant-export'


class ExportFixture:
    """A tenant root with one branch and an administrator who holds the system administrator role in both."""

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
        role = cls.env.ref('liwan_core.role_system_admin')
        cls.admin = new_test_user(
            cls.env, login='export_admin', password=PASSWORD, name='Export admin', groups='liwan_core.group_employee',
            company_id=cls.root.id, company_ids=[Command.set([cls.root.id, cls.branch.id])],
        )
        cls.access._liwan_replace_assignments(cls.admin, [{'role_id': role.id, 'company_id': cls.root.id}])
        cls.env['liwan.access.assignment'].create({'user_id': cls.admin.id, 'role_id': role.id, 'company_id': cls.branch.id})
        cls.employee = new_test_user(
            cls.env, login='export_employee', password=PASSWORD, name='Export employee', groups='liwan_core.group_employee',
        )
        cls.access._liwan_replace_assignments(
            cls.employee, [{'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': cls.root.id}],
        )

    def exports(self, user=None, companies=None):
        env = self.env(user=user or self.admin.id, context={'allowed_company_ids': companies or [self.root.id, self.branch.id]})
        return env['liwan.tenant.export']

    def build(self, user=None):
        job = self.exports(user)._liwan_request()
        self.env['liwan.tenant.export']._liwan_cron_run()
        job.invalidate_recordset()
        return job

    def archive(self, job):
        return zipfile.ZipFile(job._liwan_path())


@tagged('post_install', '-at_install', 'liwan')
class TestTenantExport(ExportFixture, TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._fixture()

    def test_the_capability_is_the_system_administrator_only(self):
        permission = self.env.ref('liwan_api.permission_tenant_export')
        self.assertFalse(permission.custom_role_allowed)
        service = self.env['liwan.access.service']
        self.assertTrue(service._liwan_has_capability(self.admin, 'tenant.export'))
        self.assertFalse(service._liwan_has_capability(self.employee, 'tenant.export'))

    def test_a_dataset_declares_columns_that_exist_and_none_is_sensitive(self):
        datasets = self.env['liwan.tenant.export.hooks']._liwan_export_datasets()
        self.assertTrue(datasets)
        for dataset in datasets:
            for column in dataset['header']:
                self.assertFalse(SENSITIVE_NAME.search(column), f'{dataset["key"]} exports {column}')
        users = next(dataset for dataset in datasets if dataset['key'] == 'users')
        self.assertEqual(
            users['header'],
            ['id', 'login', 'name', 'email', 'active', 'company_id', 'company_ids', 'lang', 'tz', 'create_date', 'login_date'],
        )
        # The stock fields the export reads stay on the models; this fails when one disappears.
        for name in ('login', 'name', 'email', 'active', 'company_id', 'company_ids', 'lang', 'tz', 'login_date'):
            self.assertIn(name, self.env['res.users']._fields)
        self.assertIn('latest_version', self.env['ir.module.module']._fields)
        self.assertTrue(self.env['liwan.tenant.export']._liwan_software_version()['liwan'])

    def test_the_base_datasets_cover_both_companies_and_the_roles(self):
        job = self.build()
        self.assertEqual(job.state, 'done', job.failure)
        with self.archive(job) as archive:
            names = set(archive.namelist())
            self.assertTrue({'base.xlsx', 'manifest.json', 'manifest.xlsx'} <= names)
            manifest = json.loads(archive.read('manifest.json'))
            workbook = openpyxl.load_workbook(io.BytesIO(archive.read('base.xlsx')), read_only=True)
        rows = {item['key']: item['rows'] for item in manifest['datasets']}
        self.assertGreaterEqual(rows['companies'], 2)
        self.assertGreaterEqual(rows['roles'], 1)
        companies = list(workbook['Companies'].iter_rows(values_only=True))
        self.assertIn('Export branch', {row[companies[0].index('name')] for row in companies[1:]})
        users = list(workbook['Users'].iter_rows(values_only=True))
        self.assertIn('export_admin', {row[users[0].index('login')] for row in users[1:]})
        self.assertNotIn('password', ' '.join(str(cell) for cell in users[0]))
        self.assertEqual(job.counts['rows'], rows)

    def test_a_branch_session_or_a_partial_session_is_refused(self):
        for companies in ([self.branch.id], [self.root.id]):
            with self.subTest(companies=companies), self.assertRaises(LiwanAccessRule) as caught:
                self.exports(companies=companies)._liwan_request()
            self.assertEqual(caught.exception.status, 403)
        self.assertEqual(self.exports(companies=[self.root.id]).env.company, self.root)
        self.assertEqual(
            self.env['liwan.tenant.export'].search_count([]), 0, 'a refused request leaves no job',
        )

    def test_a_user_without_the_capability_cannot_ask_for_the_list(self):
        self.assertFalse(self.env['liwan.access.service']._liwan_has_capability(self.employee, 'tenant.export'))

    def test_the_job_lifecycle_and_one_at_a_time(self):
        job = self.exports()._liwan_request()
        self.assertEqual(job.state, 'requested')
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports()._liwan_request()
        self.assertEqual((caught.exception.code, caught.exception.status), ('export_in_progress', 409))
        self.env['liwan.tenant.export']._liwan_cron_run()
        job.invalidate_recordset()
        self.assertEqual(job.state, 'done', job.failure)
        self.assertTrue(job._liwan_path().is_file())
        self.assertEqual(job.size_bytes, job._liwan_path().stat().st_size)
        self.assertEqual(job.expires_at - job.finished_at, export_module.RETENTION)
        # A finished export frees the slot.
        second = self.exports()._liwan_request()
        self.assertEqual(second.state, 'requested')
        # Expiry deletes the archive and keeps the row.
        path = job._liwan_path()
        job.with_user(SUPERUSER_ID).write({'expires_at': fields.Datetime.now() - datetime.timedelta(minutes=1)})
        self.env['liwan.tenant.export']._liwan_cron_run()
        job.invalidate_recordset()
        self.assertEqual(job.state, 'expired')
        self.assertFalse(path.exists())
        second.with_user(SUPERUSER_ID).unlink()

    def test_a_failed_build_records_its_reason_and_leaves_no_file(self):
        job = self.exports()._liwan_request()
        with patch.object(export_module, 'build_archive', side_effect=ValueError('too many rows in sheet')):
            self.env['liwan.tenant.export']._liwan_cron_run()
        job.invalidate_recordset()
        self.assertEqual(job.state, 'failed')
        self.assertIn('too many rows in sheet', job.failure)
        self.assertFalse(job.archive_name)
        self.assertFalse(any(self.env['liwan.tenant.export']._liwan_dir().glob(f'{job.id}-*')))
        self.assertTrue(self.exports()._liwan_request())

    def test_a_dead_worker_is_failed_and_frees_the_slot(self):
        job = self.exports()._liwan_request()
        job.with_user(SUPERUSER_ID).write({'state': 'running', 'started_at': fields.Datetime.now() - export_module.STALE_AFTER * 2})
        self.env['liwan.tenant.export']._liwan_cron_run()
        job.invalidate_recordset()
        self.assertEqual(job.state, 'failed')
        self.assertIn('interrupted', job.failure)

    def test_the_log_holds_ids_and_counts_only(self):
        job = self.build()
        path, _name = self.exports()._liwan_download(job.id)
        self.assertTrue(path.is_file())
        log = self.env['liwan.tenant.export.log'].search([('export_id', '=', job.id)], order='id')
        self.assertEqual(log.mapped('kind'), ['request', 'built', 'download'])
        self.assertEqual(log[0].user_id, self.admin)
        self.assertEqual(log[1].counts, job.counts)
        self.assertNotIn('Export branch', json.dumps(log.mapped('counts')))
        with self.assertRaises(Exception):  # noqa: B017 - AccessError for a non superuser
            log.with_user(self.admin).write({'kind': 'request'})
        with self.assertRaises(Exception):  # noqa: B017
            log.with_user(self.admin).unlink()

    def test_a_download_needs_a_finished_export_and_a_covering_session(self):
        job = self.exports()._liwan_request()
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports()._liwan_download(job.id)
        self.assertEqual(caught.exception.status, 404)
        self.env['liwan.tenant.export']._liwan_cron_run()
        with self.assertRaises(LiwanAccessRule) as caught:
            self.exports(companies=[self.root.id])._liwan_download(job.id)
        self.assertEqual(caught.exception.status, 403)

    def test_the_archive_is_no_attachment_and_never_counts_as_storage(self):
        attachments = self.env['ir.attachment'].search_count([])
        used = self.profile.storage_used_bytes
        first = self.build()
        self.assertEqual(self.env['ir.attachment'].search_count([]), attachments)
        self.assertEqual(self.profile.storage_used_bytes, used)
        self.env['liwan.tenant.export'].search([('state', '=', 'done')]).with_user(SUPERUSER_ID).write({'state': 'expired'})
        second = self.build()
        with self.archive(second) as archive:
            self.assertFalse([name for name in archive.namelist() if name.startswith('files/') and '.zip' in name])
        self.assertNotEqual(first.archive_name, second.archive_name)

    def test_files_are_included_with_a_checksum_and_listed_in_the_manifest(self):
        partner = self.env['res.partner'].create({'name': 'Export file owner'})
        content = b'tenant export file'
        attachment = self.env['ir.attachment'].create({
            'name': 'proof.txt', 'raw': content, 'res_model': 'res.partner', 'res_id': partner.id,
        })
        env = self.env

        def datasets(model):
            return [model_dataset(
                env, 'sample', 'sample_partners', 'Sample partners', 'res.partner', fields=('id', 'name'),
                domain=[('id', '=', partner.id)], attachments=True,
            )]

        with patch.object(type(self.env['liwan.tenant.export.hooks']), '_liwan_export_datasets', datasets):
            job = self.build()
        self.assertEqual(job.state, 'done', job.failure)
        path = f'files/sample/sample_partners/{partner.id}/{attachment.id}_proof.txt'
        with self.archive(job) as archive:
            self.assertEqual(archive.read(path), content)
            workbook = openpyxl.load_workbook(io.BytesIO(archive.read('sample.xlsx')), read_only=True)
            manifest = json.loads(archive.read('manifest.json'))
        rows = list(workbook['File manifest'].iter_rows(values_only=True))
        self.assertEqual(rows[0], ('dataset', 'record_id', 'file', 'name', 'size_bytes', 'sha256'))
        self.assertEqual(rows[1], ('sample_partners', partner.id, path, 'proof.txt', len(content), hashlib.sha256(content).hexdigest()))
        self.assertEqual(manifest['datasets'][0]['files'], 1)
        self.assertEqual(job.counts['files'], 1)

    def test_the_manifest_names_what_is_not_included(self):
        def no_datasets(model):
            return []

        with patch.object(type(self.env['liwan.tenant.export.hooks']), '_liwan_export_datasets', no_datasets):
            job = self.build()
        with self.archive(job) as archive:
            manifest = json.loads(archive.read('manifest.json'))
        listed = {item['model']: item for item in manifest['not_included']}
        self.assertEqual(listed['liwan.access.role']['reason'], 'not_covered')
        self.assertEqual(listed['liwan.account.token']['reason'], 'credentials')
        for model, item in listed.items():
            if 'payroll' in model or 'payslip' in model:
                self.assertEqual(item['reason'], 'compensation', model)
        self.assertEqual(job.counts['not_included'], len(listed))
        self.assertTrue(manifest['also_not_included'])

    def test_a_covered_model_is_not_listed_as_missing(self):
        job = self.build()
        with self.archive(job) as archive:
            listed = {item['model'] for item in json.loads(archive.read('manifest.json'))['not_included']}
        self.assertNotIn('liwan.access.role', listed)
        self.assertNotIn('res.company', listed)


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
        requested = self.api('POST', URL, {})
        self.assertEqual(requested.status_code, 200, requested.text)
        body = requested.json()
        self.assertEqual(body['state'], 'requested')
        self.env['liwan.tenant.export']._liwan_cron_run()
        download = self.api('GET', f'{URL}/{body["id"]}/download')
        self.assertEqual(download.status_code, 200, download.text[:200])
        self.assertEqual(download.headers['Content-Type'], 'application/zip')
        self.assertTrue(zipfile.ZipFile(io.BytesIO(download.content)).namelist())
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
        # The lockout ends the session, so the next call is no longer signed in.
        self.assertIn(self.api('POST', URL, {}).status_code, (401, 403))

    def test_the_request_takes_no_fields_and_a_missing_download_is_a_404(self):
        self.authenticate('export_admin', PASSWORD)
        self.assertEqual(self.api('POST', URL, {'user': 1}).status_code, 422)
        self.assertEqual(self.api('GET', f'{URL}/999999/download').status_code, 404)


exempt_isolation_route(
    '/api/v1/admin/tenant-export/<int:export_id>/download',
    'the archive of the whole tenant, not a company record: it needs the root session that covers every company (test_tenant_export)',
)
