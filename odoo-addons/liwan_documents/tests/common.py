# Part of Odoo. See LICENSE file for full copyright and licensing details.
from uuid import uuid4

from odoo import SUPERUSER_ID, api
from odoo.tests import TransactionCase, new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


class DocumentFixtures:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile._liwan_initialize_legacy_policy(
            cls.env['liwan.feature.registry']._liwan_installed_module_ids(),
        )
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**(profile.features or {}), 'documents.enabled': True}},
        )
        cls.manager = new_test_user(
            cls.env,
            login='docs_manager',
            groups='liwan_documents.group_documents_manager',
        )
        cls.reader = new_test_user(
            cls.env, login='docs_reader', groups='liwan_core.group_employee',
        )
        cls.other = new_test_user(
            cls.env,
            login='docs_other',
            groups='liwan_documents.group_documents_manager',
        )
        cls.system_admin = new_test_user(
            cls.env, login='docs_system', groups='base.group_user,base.group_system',
        )

    def model(self, user=None):
        self.assertIn(
            'liwan.document',
            self.env,
            'the independent document aggregate must own content and access',
        )
        return self.env['liwan.document'].with_user(user or self.manager)

    def create_document(self, name='Restricted document'):
        return self.model().create({'name': name})


class DocumentCase(DocumentFixtures, TransactionCase):
    pass


class DocumentHttpCase(DocumentFixtures, LiwanApiCase):
    pass


class CommittedDocumentFixtures:
    def fixture(self):
        self.assertTrue(
            self.env.cr.dbname.startswith('liwan_scratch_'),
            'committed fixtures require scratch DB',
        )
        with self.registry.cursor() as cursor:
            env = api.Environment(
                cursor,
                SUPERUSER_ID,
                {OPERATOR_CONTEXT: True, 'no_reset_password': True},
            )
            profile = env.ref('liwan_platform.tenant_profile')
            profile._liwan_initialize_legacy_policy(
                env['liwan.feature.registry']._liwan_installed_module_ids(),
            )
            features = dict(profile.features or {})
            profile.write({'features': {**features, 'documents.enabled': True}})
            company_id = env.company.id
            user = new_test_user(
                env,
                login='docs_race_' + uuid4().hex,
                groups='liwan_core.group_employee',
            )
            env['liwan.access.service']._liwan_replace_assignments(
                user,
                [
                    {
                        'role_id': env.ref(
                            'liwan_documents.role_documents_manager',
                        ).id,
                        'company_id': company_id,
                    },
                ],
            )
            other = new_test_user(
                env,
                login='docs_editor_' + uuid4().hex,
                groups='liwan_documents.group_documents_manager',
            )
            document = (
                env['liwan.document'].with_user(user).create({'name': 'Before race'})
            )
            env['liwan.document.grant'].create(
                {'document_id': document.id, 'user_id': other.id, 'access': 'editor'},
            )
            result = document.id, user.id, company_id, features, other.id
            cursor.commit()
            return result

    def cleanup(self, fixture):
        document_id, user_id, _, features, other_id = fixture
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            env['liwan.document'].browse(document_id).unlink()
            env['res.users'].browse([user_id, other_id]).unlink()
            env.ref('liwan_platform.tenant_profile').write({'features': features})
            cursor.commit()

    def actor(self, cursor, fixture):
        return api.Environment(
            cursor, fixture[1], {'allowed_company_ids': [fixture[2]]},
        )
