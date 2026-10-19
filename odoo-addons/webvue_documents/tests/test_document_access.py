# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import DocumentCase
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestDocumentAccess(DocumentCase):
    def test_new_document_is_restricted_and_creator_can_edit(self):
        document = self.create_document()
        self.assertEqual((document.visibility, document.revision), ('restricted', 1))
        self.assertTrue(document.directory_id)
        self.assertTrue(document._webvue_can('write'))
        document._webvue_update_document({'name': 'Changed'}, 1)
        self.assertEqual((document.name, document.revision), ('Changed', 2))

    def test_manage_capability_does_not_open_an_ungranted_document(self):
        document = self.create_document()
        with self.assertRaises(AccessError):
            document.with_user(self.other).read(['name'])
        self.assertNotIn(document.id, self.model(self.other).search([]).ids)

    def test_company_visibility_preserves_employee_read_only_access(self):
        document = self.create_document()
        document._webvue_set_access(
            'company', [{'user_id': self.manager.id, 'access': 'editor'}], 1,
        )
        self.assertEqual(
            document.with_user(self.reader).read(['name'])[0]['name'],
            'Restricted document',
        )
        with self.assertRaises(AccessError):
            document.with_user(self.reader)._webvue_update_document(
                {'name': 'Forbidden'}, 2,
            )

    def test_reader_grant_needs_manage_capability_to_edit(self):
        document = self.create_document()
        document._webvue_set_access(
            'restricted',
            [
                {'user_id': self.manager.id, 'access': 'editor'},
                {'user_id': self.reader.id, 'access': 'editor'},
            ],
            1,
        )
        self.assertTrue(document.with_user(self.reader)._webvue_can('read'))
        self.assertFalse(document.with_user(self.reader)._webvue_can('write'))

    def test_system_admin_is_not_a_content_grant(self):
        document = self.create_document()
        with self.assertRaises(AccessError):
            document.with_user(self.system_admin).read(['name'])

    def test_client_cannot_set_company_or_internal_fields(self):
        model = self.model()
        for values in (
            {'company_id': self.env.company.id},
            {'revision': 90},
            {'visibility': 'company'},
            {'directory_id': 1},
        ):
            with (
                self.subTest(values=values),
                self.assertRaises(AccessError),
                self.env.cr.savepoint(),
            ):
                model.create({'name': 'Forged', **values})

    def test_access_cannot_remove_last_active_capable_editor(self):
        document = self.create_document()
        with self.assertRaises(ValidationError):
            document._webvue_set_access(
                'restricted', [{'user_id': self.reader.id, 'access': 'reader'}], 1,
            )
        self.assertEqual(document.revision, 1)

    def test_portal_and_inactive_grantees_are_rejected(self):
        document = self.create_document()
        portal = new_test_user(
            self.env, login='docs_portal', groups='base.group_portal',
        )
        inactive = new_test_user(
            self.env, login='docs_inactive', groups='base.group_user',
        )
        inactive.write({'active': False})
        for user in (portal, inactive):
            with self.subTest(user=user.login), self.assertRaises(ValidationError):
                document._webvue_set_access(
                    'restricted',
                    [
                        {'user_id': self.manager.id, 'access': 'editor'},
                        {'user_id': user.id, 'access': 'reader'},
                    ],
                    1,
                )

    def test_foreign_company_is_hidden_even_when_both_are_allowed(self):
        model = self.model()
        company_b = self.env['res.company'].create({'name': 'Documents B'})
        self.manager.with_user(self.env.ref('base.user_root')).write(
            {'company_ids': [Command.link(company_b.id)]},
        )
        document = self.env['webvue.document'].create(
            {
                'name': 'Other company',
                'company_id': company_b.id,
                'visibility': 'company',
            },
        )
        actor = document.with_user(self.manager).with_context(
            allowed_company_ids=[self.env.company.id, company_b.id],
        )
        with self.assertRaises(AccessError):
            actor.read(['name'])
        self.assertNotIn(
            document.id,
            model.with_context(allowed_company_ids=[self.env.company.id, company_b.id])
            .search([])
            .ids,
        )

    def test_raw_write_and_grant_operations_cannot_bypass_revision_or_access(self):
        document = self.create_document()
        with self.assertRaises(AccessError):
            document.write({'visibility': 'company'})
        with self.assertRaises(AccessError):
            document.write({'name': 'No revision'})
        with self.assertRaises(AccessError):
            self.env['webvue.document.grant'].with_user(self.other).create(
                {
                    'document_id': document.id,
                    'user_id': self.other.id,
                    'access': 'editor',
                },
            )
        with self.assertRaises(AccessError):
            document.unlink()

    def test_stale_revision_preserves_first_writer(self):
        document = self.create_document()
        document._webvue_update_document({'name': 'First'}, 1)
        with self.assertRaises(ValidationError) as caught:
            document._webvue_update_document({'name': 'Stale'}, 1)
        self.assertEqual(caught.exception.code, 'conflict')
        self.assertEqual(caught.exception.details, {'current_revision': 2})
        self.assertEqual(document.name, 'First')

    def test_archived_content_needs_archive_capability(self):
        document = self.create_document()
        document._webvue_set_access(
            'company', [{'user_id': self.manager.id, 'access': 'editor'}], 1,
        )
        document._webvue_set_active(False, 2)
        self.assertFalse(document.active)
        with self.assertRaises(AccessError):
            document.with_user(self.reader).read(['name'])
        self.assertNotIn(document.id, self.model().search([]).ids)
        document._webvue_set_active(True, 3)
        self.assertTrue(document.active)
        self.assertEqual(document.revision, 4)

    def test_grant_membership_is_not_exposed_to_a_document_reader(self):
        document = self.create_document()
        grant_ids = document.with_user(self.env.ref('base.user_root')).grant_ids.ids
        direct_reader = new_test_user(
            self.env,
            login='docs_raw_reader',
            groups='webvue_documents.group_cap_documents_items_read',
        )
        with self.assertRaises(AccessError):
            self.env['webvue.document.grant'].with_user(direct_reader).browse(
                grant_ids,
            ).read(['user_id', 'access'])

    def test_elevated_environment_retains_original_actor_policy(self):
        document = self.create_document()
        with self.assertRaises(AccessError):
            document.with_user(self.other).sudo().read(['name'])
        self.assertFalse(document.with_user(self.other).sudo()._filtered_access('read'))

    def test_untrusted_context_cannot_change_creation_policy(self):
        document = (
            self.model()
            .with_context(
                default_visibility='company', default_revision=99, default_active=False,
            )
            .create({'name': 'Forged defaults'})
        )
        self.assertEqual(
            (document.visibility, document.revision, document.active),
            ('restricted', 1, True),
        )
        self.assertFalse(document.with_user(self.other)._webvue_can('read'))

    def test_creator_without_access_management_gets_editor_but_cannot_change_grants(
        self,
    ):
        creator = new_test_user(
            self.env,
            login='docs_creator',
            groups='webvue_documents.group_cap_documents_items_manage',
        )
        document = self.model(creator).create({'name': 'Creator only'})
        self.assertTrue(document._webvue_can('write'))
        with self.assertRaises(AccessError):
            document._webvue_set_access(
                'company', [{'user_id': creator.id, 'access': 'editor'}], 1,
            )

    def test_library_manager_cannot_open_ungranted_content(self):
        librarian = new_test_user(
            self.env,
            login='docs_librarian',
            groups='webvue_documents.group_cap_documents_library_manage',
        )
        document = self.create_document()
        self.assertNotIn(document.id, self.model(librarian).search([]).ids)
        with self.assertRaises(AccessError):
            document.with_user(librarian).read(['body'])

    def test_read_only_tenant_preserves_archive_reads_but_blocks_mutation(self):

        document = self.create_document()
        document._webvue_set_active(False, 1)
        profile = self.env.ref('webvue_platform.tenant_profile')
        values = (
            {'valid_until': '2000-01-01'}
            if profile.commercial_mode == 'saas'
            else {
                'features': {**profile.features, 'documents.enabled': False},
                'retained_read_features': [
                    *profile.retained_read_features,
                    'documents.enabled',
                ],
            }
        )
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(values)
        self.assertTrue(
            document._webvue_can('read'),
            'archive reads remain available to an authorized reader',
        )
        self.assertEqual(document.read(['name'])[0]['name'], 'Restricted document')
        with self.assertRaises(AccessError):
            document._webvue_set_active(True, 2)

    def test_new_company_gets_an_operator_owned_library_and_policy_fence(self):
        company = self.env['res.company'].create({'name': 'New document branch'})
        self.manager.write({'company_ids': [(4, company.id)]})
        self.assertEqual(self.env['dms.storage'].search_count([('company_id', '=', company.id), ('webvue_documents_managed', '=', True)]), 1)
        self.env['webvue.access.assignment'].create({'user_id': self.manager.id,
            'role_id': self.env.ref('webvue_documents.role_documents_manager').id, 'company_id': company.id})
        document = self.model().with_company(company).create({'name': 'First branch document'})
        self.assertEqual(document.company_id, company)
        self.assertEqual(document.directory_id.storage_id.company_id, company)
        self.assertEqual(self.env['webvue.document.policy'].search_count([('company_id', '=', company.id)]), 1)

    def test_batch_permissions_match_canonical_policy_for_mixed_records(self):
        company = self.create_document('Company batch')
        company._webvue_set_access('company', [{'user_id': self.manager.id, 'access': 'editor'}], 1)
        secret = self.create_document('Restricted batch')
        secret._webvue_set_access('restricted', [
            {'user_id': self.manager.id, 'access': 'editor'},
            {'user_id': self.reader.id, 'access': 'reader'},
        ], 1)
        archived = self.create_document('Archived batch')
        archived._webvue_set_active(False, 1)
        other_company = self.env['res.company'].create({'name': 'Batch foreign'})
        foreign = self.env['webvue.document'].create({'name': 'Foreign batch', 'company_id': other_company.id, 'visibility': 'company'})
        records = self.env['webvue.document'].browse([company.id, secret.id, archived.id, foreign.id])
        self.assertTrue(callable(getattr(records, '_webvue_permissions', None)), 'a bounded policy batch must be available')
        for user in (self.manager, self.reader, self.other):
            actor = records.with_user(user)
            expected = {document.id: {operation: document._webvue_can(operation)
                for operation in ('read', 'write', 'archive', 'access')} for document in actor}
            self.assertEqual(actor._webvue_permissions(), expected)
