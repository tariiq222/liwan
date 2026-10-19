# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import DocumentHttpCase


@tagged('post_install', '-at_install', 'webvue')
class TestDocumentAccessApi(DocumentHttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.document = (
            cls.env['webvue.document']
            .with_user(cls.manager)
            .create({'name': 'Access policy'})
        )

    def test_access_is_separate_from_detail_and_revoke_keeps_session_but_denies_content(
        self,
    ):
        path = f'/api/v1/documents/{self.document.id}'
        self.authenticate('docs_manager', 'docs_manager')
        detail = self.api('GET', path)
        self.assertEqual(detail.status_code, 200)
        self.assertNotIn('grants', detail.json())
        response = self.api('GET', path + '/access')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), {'visibility', 'grants', 'revision'})
        response = self.api(
            'PUT',
            path + '/access',
            {
                'expected_revision': 1,
                'visibility': 'restricted',
                'grants': [{'user_id': self.other.id, 'access': 'editor'}],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['revision'], 2)
        self.assertEqual(response.json()['grants'][0]['user']['id'], self.other.id)
        self.assertEqual(self.api('GET', path).status_code, 404)
        self.assertEqual(self.api('GET', '/api/v1/me').status_code, 200)
        self.authenticate('docs_other', 'docs_other')
        self.assertEqual(self.api('GET', path).status_code, 200)

    def test_reader_cannot_see_access_list(self):
        self.document._webvue_set_access(
            'company', [{'user_id': self.manager.id, 'access': 'editor'}], 1,
        )
        self.authenticate('docs_reader', 'docs_reader')
        self.assertEqual(
            self.api('GET', f'/api/v1/documents/{self.document.id}/access').status_code,
            403,
        )

    def test_archived_access_requires_archive_and_access_capabilities(self):
        self.document._webvue_set_active(False, 1)
        self.authenticate('docs_manager', 'docs_manager')
        response = self.api('GET', f'/api/v1/documents/{self.document.id}/access')
        self.assertEqual(response.status_code, 200, response.text)
        response = self.api(
            'PUT',
            f'/api/v1/documents/{self.document.id}/access',
            {
                'expected_revision': 2,
                'visibility': 'company',
                'grants': [{'user_id': self.manager.id, 'access': 'editor'}],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['revision'], 3)
