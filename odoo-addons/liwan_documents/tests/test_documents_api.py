# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import DocumentHttpCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

SUMMARY_KEYS = {
    'id',
    'name',
    'visibility',
    'active',
    'expiry_date',
    'write_date',
    'revision',
    'file_count',
    'tags',
    'context',
    'allowed_actions',
}
DETAIL_KEYS = SUMMARY_KEYS | {'body'}


@tagged('post_install', '-at_install', 'liwan')
class TestDocumentsApi(DocumentHttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.secret = (
            cls.env['liwan.document']
            .with_user(cls.manager)
            .create({'name': 'Alpha secret', 'body': '<p>Private</p>'})
        )
        cls.visible = (
            cls.env['liwan.document']
            .with_user(cls.manager)
            .create({'name': 'Beta company'})
        )
        cls.visible._liwan_set_access(
            'company', [{'user_id': cls.manager.id, 'access': 'editor'}], 1,
        )

    def test_list_contains_only_visible_summaries(self):
        self.authenticate('docs_reader', 'docs_reader')
        response = self.api('GET', '/api/v1/documents')
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['total'], 1)
        self.assertEqual([item['id'] for item in data['items']], [self.visible.id])
        self.assertEqual(set(data['items'][0]), SUMMARY_KEYS)
        self.assertEqual(
            self.api('GET', f'/api/v1/documents/{self.secret.id}').status_code, 404,
        )
        self.assertEqual(self.api('GET', '/api/v1/documents?limit=0').status_code, 422)
        self.assertEqual(
            self.api('GET', '/api/v1/documents?offset=-1').status_code, 422,
        )

    def test_list_filters_by_visibility_and_expiry(self):
        today = fields.Date.context_today(self.manager)
        dated = {
            'Soon': today + timedelta(days=10),
            'Later': today + timedelta(days=100),
            'Past': today - timedelta(days=1),
        }
        ids = {}
        for name, expiry in dated.items():
            ids[name] = self.model().create({'name': name, 'expiry_date': expiry}).id
        archived = self.model().create(
            {'name': 'Gone', 'expiry_date': today - timedelta(days=5)},
        )
        archived._liwan_set_active(False, 1)
        self.authenticate('docs_manager', 'docs_manager')

        def listed(query):
            response = self.api('GET', f'/api/v1/documents?{query}')
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()
            self.assertEqual(data['total'], len(data['items']))
            return {item['id'] for item in data['items']}

        self.assertEqual(listed('visibility=company'), {self.visible.id})
        self.assertEqual(
            listed('visibility=restricted'), {self.secret.id, *ids.values()},
        )
        self.assertEqual(listed('expiring_within=30'), {ids['Soon']})
        self.assertEqual(
            listed('expiring_within=365'), {ids['Soon'], ids['Later']},
        )
        self.assertEqual(listed('expired=1'), {ids['Past']})
        self.assertEqual(listed('expired=0&expiring_within=30'), {ids['Soon']})
        for query in (
            'visibility=public',
            'expiring_within=0',
            'expiring_within=366',
            'expiring_within=abc',
            'expired=maybe',
        ):
            response = self.api('GET', f'/api/v1/documents?{query}')
            self.assertEqual(response.status_code, 422, query)
            self.assertEqual(response.json()['code'], 'invalid')

    def test_create_patch_and_conflict_return_full_current_detail(self):
        self.authenticate('docs_manager', 'docs_manager')
        response = self.api(
            'POST', '/api/v1/documents', {'name': 'Created', 'body': '<p>Text</p>'},
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(set(data), DETAIL_KEYS)
        self.assertEqual((data['visibility'], data['revision']), ('restricted', 1))
        document_id = data['id']
        response = self.api(
            'PATCH',
            f'/api/v1/documents/{document_id}',
            {'expected_revision': 1, 'name': 'Updated'},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), DETAIL_KEYS)
        self.assertEqual(
            (response.json()['name'], response.json()['revision']), ('Updated', 2),
        )
        response = self.api(
            'PATCH',
            f'/api/v1/documents/{document_id}',
            {'expected_revision': 1, 'body': 'Stale'},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['details'], {'current_revision': 2})
        self.assertEqual(
            self.api('GET', f'/api/v1/documents/{document_id}').json()['body'],
            '<p>Text</p>',
        )

    def test_unknown_internal_and_revision_inputs_are_rejected(self):
        self.authenticate('docs_manager', 'docs_manager')
        for key, value in (
            ('company_id', 1),
            ('directory_id', 1),
            ('visibility', 'company'),
            ('revision', 9),
            ('grants', []),
        ):
            with self.subTest(key=key):
                response = self.api(
                    'POST', '/api/v1/documents', {'name': 'Forged', key: value},
                )
                self.assertEqual(response.status_code, 422)
        for payload in (
            {'name': 'No revision'},
            {'expected_revision': 1},
            {'expected_revision': True, 'name': 'Bad'},
            {'expected_revision': 1, 'company_id': 1},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(
                    self.api(
                        'PATCH', f'/api/v1/documents/{self.secret.id}', payload,
                    ).status_code,
                    422,
                )

    def test_upload_and_file_actions_return_full_aggregate(self):
        self.authenticate('docs_manager', 'docs_manager')
        path = f'/api/v1/documents/{self.secret.id}'
        response = self.api(
            'POST',
            path + '/files',
            {
                'expected_revision': 1,
                'name': 'sample.txt',
                'data': base64.b64encode(b'hello').decode(),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(set(data), DETAIL_KEYS)
        self.assertEqual((data['file_count'], data['revision']), (1, 2))
        files = self.api('GET', path + '/files').json()['items']
        file_id = files[0]['id']
        self.assertNotIn('attachment_id', files[0])
        for action, revision in (
            ('lock', 2),
            ('unlock', 3),
            ('archive', 4),
            ('restore', 5),
        ):
            response = self.api(
                'POST',
                f'{path}/files/{file_id}/{action}',
                {'expected_revision': revision},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['revision'], revision + 1)
        response = self.api(
            'POST',
            f'/api/v1/documents/{self.visible.id}/files/{file_id}/archive',
            {'expected_revision': 2},
        )
        self.assertEqual(response.status_code, 404)

    def test_archive_restore_and_read_only_routes(self):
        self.authenticate('docs_manager', 'docs_manager')
        path = f'/api/v1/documents/{self.secret.id}'
        response = self.api('POST', path + '/archive', {'expected_revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['active'])
        archived = self.api('GET', '/api/v1/documents?archived=true').json()
        self.assertIn(self.secret.id, [item['id'] for item in archived['items']])
        self.assertEqual(
            self.api('POST', path + '/restore', {'expected_revision': 2}).status_code,
            200,
        )
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'valid_until': '2000-01-01'}
            if profile.commercial_mode == 'saas'
            else {'features': {**profile.features, 'documents.enabled': False}},
        )
        self.assertEqual(self.api('GET', path).status_code, 200)
        self.assertEqual(
            self.api(
                'PATCH', path, {'expected_revision': 3, 'body': 'Denied'},
            ).status_code,
            403,
        )

    def test_unregistered_context_cannot_be_used_as_a_model_name(self):
        self.authenticate('docs_manager', 'docs_manager')
        for context in (
            {'kind': 'ir.attachment', 'id': 1},
            {'kind': 'res.users', 'id': 1},
            {'kind': 'hr.department', 'id': 1, 'model': 'res.users'},
        ):
            with self.subTest(context=context):
                self.assertEqual(
                    self.api(
                        'POST',
                        '/api/v1/documents',
                        {'name': 'Bad link', 'context': context},
                    ).status_code,
                    422,
                )
        self.assertEqual(
            self.api(
                'GET', '/api/v1/documents?context_kind=hr.department&context_id=bad',
            ).status_code,
            422,
        )

    def test_tags_and_context_catalog_follow_read_and_library_permissions(self):
        self.authenticate('docs_manager', 'docs_manager')
        response = self.api('POST', '/api/v1/documents/tags', {'name': 'Policy'})
        self.assertEqual(response.status_code, 201, response.text)
        tag_id = response.json()['id']
        response = self.api(
            'POST', '/api/v1/documents', {'name': 'Tagged', 'tag_ids': [tag_id]},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['tags'], [{'id': tag_id, 'name': 'Policy'}])
        self.assertEqual(response.json()['revision'], 1)
        self.authenticate('docs_reader', 'docs_reader')
        self.assertIn(
            tag_id,
            [
                item['id']
                for item in self.api('GET', '/api/v1/documents/tags').json()['items']
            ],
        )
        self.assertEqual(
            self.api('POST', '/api/v1/documents/tags', {'name': 'Denied'}).status_code,
            403,
        )
        contexts = self.api('GET', '/api/v1/documents/contexts')
        self.assertEqual(contexts.status_code, 200, contexts.text)
        self.assertEqual(contexts.json()['total'], len(contexts.json()['items']))
        self.assertTrue(
            all(set(item) == {'kind', 'label'} for item in contexts.json()['items']),
        )
        self.assertEqual(
            self.api('GET', '/api/v1/documents/contexts/res.users/options').status_code,
            403,
        )

    def test_list_file_counts_exclude_hidden_documents_and_archived_files(self):
        self.env['liwan.document.files'].with_user(self.manager)._liwan_upload(self.visible,
            {'name': 'visible.txt', 'data': base64.b64encode(b'visible file').decode()}, 2)
        self.env['liwan.document.files'].with_user(self.manager)._liwan_upload(self.secret,
            {'name': 'hidden.txt', 'data': base64.b64encode(b'hidden file').decode()}, 1)
        self.authenticate('docs_reader', 'docs_reader')
        response = self.api('GET', '/api/v1/documents')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([(item['id'], item['file_count']) for item in response.json()['items']], [(self.visible.id, 1)])
        self.assertNotIn(self.secret.id, [item['id'] for item in response.json()['items']])

    def test_file_collection_is_bounded_searchable_and_uses_document_permissions(self):
        files = self.env['dms.file'].create([
            {'name': 'page-%03d.txt' % i, 'directory_id': self.secret.directory_id.id,
             'content': base64.b64encode(b'page fixture')}
            for i in range(205)
        ])
        self.authenticate('docs_manager', 'docs_manager')
        path = f'/api/v1/documents/{self.secret.id}'
        detail = self.api('GET', path).json()
        self.assertNotIn('files', detail, 'detail must remain bounded as file count grows')
        first = self.api('GET', path + '/files?limit=200').json()
        last = self.api('GET', path + '/files?limit=200&offset=200').json()
        self.assertEqual((first['total'], len(first['items']), len(last['items'])), (205, 200, 5))
        self.assertEqual([f['id'] for f in first['items'] + last['items']], files.ids)
        self.assertEqual(self.api('GET', path + '/files?q=page-204').json()['items'][0]['id'], files[-1].id)
        self.assertEqual(len(self.api('GET', path + '/files').json()['items']), 50)
        for args in ('limit=0', 'offset=-1', 'offset=2147483648'):
            self.assertEqual(self.api('GET', path + '/files?' + args).status_code, 422)
        self.authenticate('docs_reader', 'docs_reader')
        self.assertEqual(self.api('GET', path + '/files').status_code, 404)

    def test_file_pages_reject_a_revision_changed_by_a_concurrent_upload(self):
        self.env['dms.file'].create([{'name': 'page-%03d.txt' % i,
            'directory_id': self.secret.directory_id.id, 'content': base64.b64encode(b'page fixture')}
            for i in range(55)])
        self.authenticate('docs_manager', 'docs_manager')
        path = f'/api/v1/documents/{self.secret.id}'
        first = self.api('GET', path + '/files?revision=1').json()
        self.assertEqual(first.get('revision'), 1)
        self.assertEqual(len(first['items']), 50)
        response = self.api('POST', path + '/files', {'expected_revision': 1,
            'name': '000-before-old-page.txt', 'data': base64.b64encode(b'concurrent file').decode()})
        self.assertEqual(response.status_code, 200, response.text)
        stale = self.api('GET', path + '/files?revision=1&offset=50')
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['details'], {'current_revision': 2})
        current = self.api('GET', path + '/files?revision=2').json()
        self.assertEqual((current['revision'], current['total']), (2, 56))
        tail = self.api('GET', path + '/files?revision=2&offset=50').json()
        ids = [item['id'] for item in current['items'] + tail['items']]
        self.assertEqual((len(ids), len(set(ids))), (56, 56))
        self.assertEqual(current['items'][0]['name'], '000-before-old-page.txt')
        self.assertEqual(self.api('GET', path + '/files?revision=bad').status_code, 422)
