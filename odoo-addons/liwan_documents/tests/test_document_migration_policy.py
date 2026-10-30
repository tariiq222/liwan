# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import DocumentCase
from odoo.addons.liwan_documents.hooks import complete_legacy_adoption
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestDocumentMigrationPolicy(DocumentCase):
    def test_commercial_adoption_stays_closed_until_trusted_policy_is_applied(self):
        document = self.create_document()
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'documents.enabled': False},
            'retained_read_features': [key for key in profile.retained_read_features if key != 'documents.enabled'],
            'commercial_revision_id': 'synthetic-existing-authority', 'commercial_digest': 'e' * 64,
        })
        marker = self.env['ir.model.data'].create({'module': 'liwan_documents', 'name': 'legacy_hr_adoption_pending',
            'model': 'ir.model', 'res_id': self.env['ir.model']._get('liwan.document').id, 'noupdate': True})
        complete_legacy_adoption(self.env)
        self.assertFalse(profile.features['documents.enabled'])
        self.assertEqual(profile.commercial_revision_id, 'synthetic-existing-authority')
        self.assertEqual(profile.commercial_digest, 'e' * 64)
        self.assertEqual(marker.name, 'legacy_hr_adoption_pending')
        self.assertFalse(document._liwan_can('read'))
