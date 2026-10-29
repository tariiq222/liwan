# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import tagged

from .common import WebVueInboxCase

MIGRATION = Path(__file__).resolve().parents[1] / 'migrations' / '19.0.1.2.0' / 'pre-template-selections.py'


def load_migrate():
    spec = importlib.util.spec_from_file_location('inbox_template_selections', MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.migrate


@tagged('post_install', '-at_install', 'webvue')
class TestTemplateSelectionsMigration(WebVueInboxCase):

    def raw(self, template, category, status):
        self.env.cr.execute(
            'UPDATE webvue_inbox_template SET category = %s, status = %s WHERE id = %s', [category, status, template.id],
        )

    def values(self, template):
        self.env.cr.execute('SELECT category, status FROM webvue_inbox_template WHERE id = %s', [template.id])
        return self.env.cr.fetchone()

    def test_meta_words_become_the_selection_values_and_unknown_ones_are_safe_defaults(self):
        cases = {
            ('MARKETING', 'APPROVED'): ('marketing', 'approved'), ('Utility', 'PENDING'): ('utility', 'pending'),
            ('AUTHENTICATION', 'REJECTED'): ('authentication', 'rejected'), ('UTILITY', 'REINSTATED'): ('utility', 'approved'),
            ('UTILITY', 'PENDING_DELETION'): ('utility', 'pending_deletion'), ('SERVICE', 'LIMIT_EXCEEDED'): ('utility', 'disabled'),
            (None, None): ('utility', 'disabled'), ('', ''): ('utility', 'disabled'),
        }
        templates = {key: self.make_template() for key in cases}
        # The old schema: nullable free-text columns and the stored count.
        self.env.cr.execute('ALTER TABLE webvue_inbox_template ALTER COLUMN category DROP NOT NULL, ALTER COLUMN status DROP NOT NULL')
        self.env.cr.execute('ALTER TABLE webvue_inbox_template ADD COLUMN param_count integer')
        for (category, status), template in templates.items():
            self.raw(template, category, status)
        migrate = load_migrate()
        migrate(self.env.cr, '19.0.1.1.0')
        for key, expected in cases.items():
            self.assertEqual(self.values(templates[key]), expected, key)
        migrate(self.env.cr, '19.0.1.1.0')
        self.assertEqual(self.values(templates['MARKETING', 'APPROVED']), ('marketing', 'approved'))
        self.env.cr.execute("SELECT 1 FROM information_schema.columns WHERE table_name = 'webvue_inbox_template' AND column_name = 'param_count'")
        self.assertFalse(self.env.cr.fetchone())

    def test_a_fresh_install_is_left_alone(self):
        template = self.make_template()
        self.raw(template, 'MARKETING', 'APPROVED')
        load_migrate()(self.env.cr, False)
        self.assertEqual(self.values(template), ('MARKETING', 'APPROVED'))

    def test_migrated_templates_are_unsupported_until_the_next_sync(self):
        template = self.make_template()
        self.assertTrue(template.supported)
        spec = importlib.util.spec_from_file_location('inbox_template_unsynced', MIGRATION.with_name('post-template-unsynced.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.migrate(self.env.cr, False)
        template.invalidate_recordset()
        self.assertTrue(template.supported)
        module.migrate(self.env.cr, '19.0.1.1.0')
        template.invalidate_recordset()
        self.assertEqual((template.supported, template.editable), (False, False))
