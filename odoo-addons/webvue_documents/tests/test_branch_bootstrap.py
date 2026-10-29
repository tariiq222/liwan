# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestAdminBranchLibrary(TransactionCase):
    def test_admin_created_branch_gets_its_document_library(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile._webvue_initialize_legacy_policy(
            self.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        # Fixture-only conversion; production ORM conversion is deliberately forbidden.
        self.env.cr.execute(
            "UPDATE webvue_tenant_profile SET commercial_mode='non_saas', entitlement_source='local_policy', "
            'valid_until=NULL WHERE id=%s', [profile.id],
        )
        profile.invalidate_recordset()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**profile.features, 'branches.extra_limit': 2}},
        )
        root = profile.root_company_id
        admin = new_test_user(
            self.env, login='docs_branch_admin', groups='base.group_user',
            company_id=root.id, company_ids=[Command.set(root.ids)],
        )
        self.env['webvue.access.assignment'].create({
            'user_id': admin.id, 'role_id': self.env.ref('webvue_core.role_system_admin').id, 'company_id': root.id,
        })
        service = self.env['webvue.entitlement.service'].with_user(admin).with_company(root)
        branch = service._webvue_create_branch('Library branch')
        self.assertTrue(self.env['webvue.document.policy'].search_count([('company_id', '=', branch.id)]))
        self.assertTrue(self.env['dms.storage'].search_count([
            ('company_id', '=', branch.id), ('webvue_documents_managed', '=', True),
        ]))
