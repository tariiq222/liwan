# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from unittest import TestCase

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import DocumentCase


@tagged('post_install', '-at_install', 'webvue')
class TestDmsBoundaries(DocumentCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.document = (
            cls.env['webvue.document']
            .with_user(cls.manager)
            .create({'name': 'Secret document'})
        )
        cls.file = cls.env['dms.file'].create(
            {
                'name': 'secret.txt',
                'directory_id': cls.document.directory_id.id,
                'content': base64.b64encode(b'secret document bytes'),
            },
        )
        cls.attachment = cls.file.attachment_id
        cls.other.write(
            {'group_ids': [Command.link(cls.env.ref('base.group_allow_export').id)]},
        )

    def test_cached_raw_dms_read_cannot_reveal_ungranted_metadata(self):
        self.assertEqual(self.file.name, 'secret.txt')
        with TestCase.assertRaises(self, AccessError):
            self.file.with_user(self.other).read(['name'])
        with TestCase.assertRaises(self, AccessError):
            self.document.directory_id.with_user(self.other).read(['name'])
        with TestCase.assertRaises(self, AccessError):
            self.file.with_user(self.other).export_data(['name'])

    def test_raw_attachment_read_and_export_follow_archived_file_policy(self):
        self.document._webvue_set_access(
            'restricted',
            [{'user_id': self.manager.id, 'access': 'editor'},
             {'user_id': self.reader.id, 'access': 'reader'}],
            1,
        )
        self.reader.write({'group_ids': [Command.link(self.env.ref('base.group_allow_export').id)]})
        actor = self.attachment.with_user(self.reader)
        self.assertEqual(base64.b64decode(actor.read(['datas'])[0]['datas']), b'secret document bytes')
        self.file.write({'active': False})
        # Keep warmed values: no Odoo assertRaises cache reset hides the bypass.
        with TestCase.assertRaises(self, AccessError):
            actor.read(['datas'])
        with TestCase.assertRaises(self, AccessError):
            actor.export_data(['datas'])
        self.assertEqual(base64.b64decode(self.attachment.with_user(self.manager).read(['datas'])[0]['datas']), b'secret document bytes')

    def test_unmanaged_file_and_directory_cannot_enter_managed_scope(self):
        storage = self.env['dms.storage'].create({'name': 'Ingress fixture', 'save_type': 'database', 'company_id': self.env.company.id, 'inherit_access_from_parent_record': False})
        group = self.env['dms.access.group'].create({'name': 'Ingress editors', 'explicit_user_ids': [Command.set(self.manager.ids)], 'perm_create': True, 'perm_write': True})
        directory = self.env['dms.directory'].create({'name': 'Unmanaged ingress', 'storage_id': storage.id, 'is_root_directory': True, 'group_ids': [Command.set(group.ids)]})
        file = self.env['dms.file'].create({'name': 'injected.txt', 'directory_id': directory.id, 'content': base64.b64encode(b'unmanaged bytes')})
        self.env.flush_all()
        # Fixture itself is writable; denial must come from the receiving boundary.
        file.with_user(self.manager).write({'name': 'still-unmanaged.txt'})
        directory.with_user(self.manager).write({'name': 'Still unmanaged'})
        for values in (
            {'directory_id': self.document.directory_id.id, 'attachment_id': self.attachment.id},
            {'attachment_id': self.attachment.id},
        ):
            with self.subTest(values=values), TestCase.assertRaises(self, AccessError), self.env.cr.savepoint():
                file.with_user(self.manager).write(values)
        for values in (
            {'storage_id': self.document.directory_id.storage_id.id},
            {'parent_id': self.document.directory_id.parent_id.id, 'is_root_directory': False},
            {'res_model': 'webvue.document', 'res_id': self.document.id},
        ):
            with self.subTest(values=values), TestCase.assertRaises(self, AccessError), self.env.cr.savepoint():
                directory.with_user(self.manager).write(values)
        self.assertEqual(self.document.revision, 1)

    def test_native_attachment_aggregates_hide_archived_content(self):
        self.document._webvue_set_access(
            'restricted', [{'user_id': self.manager.id, 'access': 'editor'},
                           {'user_id': self.reader.id, 'access': 'reader'}], 1,
        )
        self.attachment.write({'index_content': 'private searchable text'})
        actor = self.env['ir.attachment'].with_user(self.reader)
        domain = [('id', '=', self.attachment.id)]
        self.assertTrue(actor.read_group(domain, ['index_content:array_agg'], []))
        self.file.write({'active': False})
        self.assertEqual(actor.read_group(domain, ['index_content:array_agg'], [])[0]['__count'], 0)
        self.assertFalse(actor.search(domain))

    def test_raw_file_and_directory_write_cannot_bypass_revision(self):
        with self.assertRaises(AccessError):
            self.file.with_user(self.manager).write({'name': 'Renamed.txt'})
        with self.assertRaises(AccessError):
            self.document.directory_id.with_user(self.manager).write(
                {'name': 'Other directory'},
            )

    def test_customer_cannot_detach_publish_or_tokenize_attachment(self):
        for values in (
            {'public': True},
            {'access_token': 'forged'},
            {'res_model': 'res.partner'},
            {'res_id': self.env.user.partner_id.id},
        ):
            with self.subTest(values=values), self.assertRaises(AccessError):
                self.attachment.with_user(self.manager).write(values)
        with self.assertRaises(AccessError):
            self.attachment.with_user(self.manager).generate_access_token()

    def test_customer_cannot_unlink_owned_resources(self):
        for record in (self.file, self.attachment, self.document.directory_id):
            with self.subTest(model=record._name), self.assertRaises(AccessError):
                record.with_user(self.manager).unlink()

    def test_library_manager_cannot_reconfigure_managed_storage(self):
        configurator = new_test_user(
            self.env,
            login='docs_config',
            groups='dms.group_dms_manager,webvue_documents.group_cap_documents_library_manage',
        )
        storage = self.document.directory_id.storage_id.with_user(configurator)
        for values in (
            {'save_type': 'file'},
            {'company_id': False},
            {'inherit_access_from_parent_record': False},
            {'model_ids': [Command.clear()]},
        ):
            with self.subTest(values=values), self.assertRaises(AccessError):
                storage.write(values)

    def test_metadata_has_current_company_scope(self):
        for name in ('dms.tag', 'dms.category', 'dms.access.group'):
            self.assertIn(
                'company_id',
                self.env[name]._fields,
                'DMS metadata must belong to one company',
            )
        other_company = self.env['res.company'].create({'name': 'Metadata B'})
        self.manager.write({'company_ids': [Command.link(other_company.id)]})
        for name in ('dms.tag', 'dms.category', 'dms.access.group'):
            self.env[name].create(
                {'name': 'Same name', 'company_id': self.env.company.id},
            )
            foreign = self.env[name].create(
                {'name': 'Same name', 'company_id': other_company.id},
            )
            actor = (
                self.env[name]
                .with_user(self.manager)
                .with_context(
                    allowed_company_ids=[self.env.company.id, other_company.id],
                )
            )
            self.assertNotIn(foreign.id, actor.search([]).ids)
            with self.assertRaises(AccessError):
                foreign.with_user(self.manager).read(['name'])

    def test_metadata_write_requires_library_capability(self):
        reader = new_test_user(
            self.env,
            login='docs_metadata_reader',
            groups='webvue_documents.group_cap_documents_items_read',
        )
        with self.assertRaises(AccessError):
            self.env['dms.tag'].with_user(reader).create({'name': 'Not allowed'})

    def test_groups_cannot_become_a_parallel_document_acl(self):
        with self.assertRaises(AccessError):
            self.env['dms.access.group'].with_user(self.manager).create(
                {
                    'name': 'Parallel ACL',
                    'explicit_user_ids': [Command.set(self.manager.ids)],
                },
            )

    def test_grant_changes_refresh_native_dms_search_results(self):
        actor = self.env['dms.file'].with_user(self.other)
        self.assertFalse(actor.search([('id', '=', self.file.id)]))
        self.document._webvue_set_access(
            'restricted',
            [
                {'user_id': self.manager.id, 'access': 'editor'},
                {'user_id': self.other.id, 'access': 'reader'},
            ],
            1,
        )
        self.assertEqual(actor.search([('id', '=', self.file.id)]).ids, [self.file.id])
        self.document._webvue_set_access(
            'restricted', [{'user_id': self.manager.id, 'access': 'editor'}], 2,
        )
        self.assertFalse(actor.search([('id', '=', self.file.id)]))

    def test_raw_create_and_forged_context_cannot_create_managed_resources(self):
        forged = {
            'webvue_documents.mutations': {self.document.id: 'write'},
            'dms_file': True,
        }
        for model, values in (
            (
                'dms.file',
                {
                    'name': 'raw.txt',
                    'directory_id': self.document.directory_id.id,
                    'content': base64.b64encode(b'raw'),
                },
            ),
            (
                'dms.directory',
                {
                    'name': 'raw',
                    'parent_id': self.document.directory_id.parent_id.id,
                    'res_model': 'webvue.document',
                    'res_id': self.document.id,
                },
            ),
            (
                'ir.attachment',
                {
                    'name': 'raw.txt',
                    'res_model': 'webvue.document',
                    'res_id': self.document.id,
                    'datas': base64.b64encode(b'raw'),
                },
            ),
        ):
            with self.subTest(model=model), self.assertRaises(AccessError):
                self.env[model].with_user(self.manager).with_context(**forged).create(
                    values,
                )

    def test_non_document_attachment_keeps_its_native_behavior(self):
        attachment = (
            self.env['ir.attachment']
            .with_user(self.manager)
            .create(
                {
                    'name': 'ordinary.txt',
                    'res_model': 'res.users',
                    'res_id': self.manager.id,
                    'datas': base64.b64encode(b'ordinary bytes'),
                },
            )
        )
        attachment.write({'name': 'renamed.txt'})
        self.assertEqual(base64.b64decode(attachment.datas), b'ordinary bytes')
        attachment.unlink()

    def test_managed_storage_identity_does_not_depend_on_its_label(self):
        storage = self.env['dms.storage'].browse(
            self.document.directory_id.storage_id.id,
        )
        storage.write({'name': 'Operator library label'})
        document = self.create_document('After label change')
        self.assertEqual(document.directory_id.storage_id, storage)

    def test_native_resources_follow_switched_company_not_default_company(self):
        company = self.env['res.company'].create({'name': 'DMS selected company'})
        self.manager.write({'company_ids': [Command.link(company.id)]})
        role = self.env.ref('webvue_documents.role_documents_manager')
        self.service._webvue_replace_assignments(self.manager, [
            {'role_id': self.env.ref('webvue_core.role_employee').id, 'company_id': self.env.company.id},
        ])
        self.env['webvue.access.assignment']._webvue_access_create(
            {'user_id': self.manager.id, 'role_id': role.id, 'company_id': company.id},
        )
        document = self.env['webvue.document'].create({'name': 'Second company document', 'company_id': company.id, 'visibility': 'company'})
        file = self.env['dms.file'].create({'name': 'second-company.txt', 'directory_id': document.directory_id.id, 'content': base64.b64encode(b'second company bytes')})
        self.assertEqual(self.manager.company_id, self.env.company)
        actor = self.env['webvue.document'].with_user(self.manager).with_context(allowed_company_ids=[company.id, self.env.company.id])
        self.assertFalse(self.service._webvue_has_capability(self.manager, 'documents.items.archive'))
        self.assertTrue(actor.env['webvue.access.service']._webvue_has_capability(self.manager, 'documents.items.archive'))
        self.assertTrue(actor.browse(document.id)._webvue_can('read'))
        self.assertEqual(actor.env['dms.directory'].search([('id', '=', document.directory_id.id)]).ids, document.directory_id.ids)
        self.assertEqual(actor.env['dms.file'].search([('id', '=', file.id)]).ids, file.ids)
        file.write({'active': False})
        self.assertEqual(actor.env['dms.file'].with_context(active_test=False).search([('id', '=', file.id)]).ids, file.ids)
        attachment = actor.env['ir.attachment'].browse(file.attachment_id.id)
        self.assertEqual(base64.b64decode(attachment.read(['datas'])[0]['datas']), b'second company bytes')
        # The same actor returns to its default company with warmed native rules.
        default = actor.with_context(allowed_company_ids=[self.env.company.id, company.id])
        self.assertFalse(default.env['dms.file'].search([('id', '=', file.id)]))
        with TestCase.assertRaises(self, AccessError):
            attachment.with_context(allowed_company_ids=[self.env.company.id, company.id]).read(['datas'])

    def test_inherited_policy_filter_batches_candidates_without_query_growth(self):
        documents = self.env['webvue.document'].create([
            {'name': 'Batch policy %s' % index, 'visibility': 'company'} for index in range(30)
        ])
        actor = documents.with_user(self.reader)
        self.env.flush_all()
        actor[:1]._filtered_access('read')
        before = self.env.cr.sql_log_count
        self.assertEqual(actor[:1]._filtered_access('read').ids, actor[:1].ids)
        small = self.env.cr.sql_log_count - before
        before = self.env.cr.sql_log_count
        self.assertEqual(actor._filtered_access('read').ids, actor.ids)
        large = self.env.cr.sql_log_count - before
        self.assertLessEqual(large, small + 1, 'native inheritance must not issue one policy query per document')

    def test_document_read_guard_batches_candidates_without_query_growth(self):
        documents = self.env['webvue.document'].create([
            {'name': 'Batch read %s' % index, 'visibility': 'company'} for index in range(30)
        ])
        actor = documents.with_user(self.reader)
        self.env.flush_all()
        actor[:1]._webvue_require('read')
        before = self.env.cr.sql_log_count
        actor[:1]._webvue_require('read')
        small = self.env.cr.sql_log_count - before
        before = self.env.cr.sql_log_count
        actor._webvue_require('read')
        large = self.env.cr.sql_log_count - before
        self.assertLessEqual(large, small + 1, 'a prefetched document read must not query policy per row')
