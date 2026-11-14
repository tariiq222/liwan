# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo import Command
from odoo.tests import TransactionCase, new_test_user, tagged

KIND = 'tenant.export_result'


@tagged('post_install', '-at_install', 'liwan')
class TestTenantExportNotification(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile._liwan_initialize_legacy_policy(cls.env['liwan.feature.registry']._liwan_installed_module_ids())
        cls.root = profile.root_company_id
        cls.admin = new_test_user(
            cls.env, login='export_bell_admin', name='Export bell admin', groups='liwan_core.group_employee',
            company_id=cls.root.id, company_ids=[Command.set(cls.root.ids)],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.admin, [{'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.root.id}],
        )
        cls.other = new_test_user(cls.env, login='export_bell_other', name='Other', groups='liwan_core.group_employee')

    def test_the_requester_gets_one_bell_row_when_the_archive_is_ready(self):
        companies = self.root.ids
        admin_env = self.env(user=self.admin.id, context={'allowed_company_ids': companies})
        job = admin_env['liwan.tenant.export']._liwan_request()
        for _ in range(20):
            self.env['liwan.tenant.export']._liwan_cron_build()
            job.invalidate_recordset()
            if job.state == 'done':
                break
        self.assertEqual(job.state, 'done', job.failure)
        rows = self.env['mail.message'].search([('liwan_notification_kind', '=', KIND), ('res_id', '=', job.id)])
        self.assertEqual(rows.partner_ids, self.admin.partner_id)
        self.assertEqual(len(rows), 1)
        # A second delivery for the same export is a no-op.
        job._liwan_notify_outcome()
        self.assertEqual(self.env['mail.message'].search_count([('liwan_notification_kind', '=', KIND), ('res_id', '=', job.id)]), 1)
        self.assertEqual(
            self.env['liwan.notify.registry']._liwan_notification_type_map()[KIND]['model'], 'liwan.tenant.export',
        )

    def test_a_failed_export_tells_the_requester_once(self):
        admin_env = self.env(user=self.admin.id, context={'allowed_company_ids': self.root.ids})
        job = admin_env['liwan.tenant.export']._liwan_request()
        with patch.object(type(job), '_liwan_free_bytes', lambda _self, _directory: 0):
            self.env['liwan.tenant.export']._liwan_cron_build()
        job.invalidate_recordset()
        self.assertEqual(job.failure, 'insufficient_disk')
        rows = self.env['mail.message'].search([('liwan_notification_kind', '=', KIND), ('res_id', '=', job.id)])
        self.assertEqual(rows.partner_ids, self.admin.partner_id)
        self.assertEqual(len(rows), 1)
