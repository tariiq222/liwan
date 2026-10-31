# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_platform.models.base import MIRROR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestTranslationMirror(TransactionCase):
    """An edit made through the API is stored for every installed language."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['res.lang']._activate_lang('ar_001')
        cls.env['res.lang']._activate_lang('en_US')
        cls.Tag = cls.env['res.partner.category']

    def _names(self, tag):
        return tag.with_context(lang='ar_001').name, tag.with_context(lang='en_US').name

    def test_create_and_write_from_each_language_match_in_both(self):
        for lang in ('ar_001', 'en_US'):
            with self.subTest(lang=lang):
                tag = self.Tag.with_context(lang=lang, **{MIRROR_CONTEXT: ('First %s' % lang,)}).create({'name': 'First %s' % lang})
                self.assertEqual(self._names(tag), ('First %s' % lang,) * 2)
                other = 'en_US' if lang == 'ar_001' else 'ar_001'
                tag.with_context(lang=other, **{MIRROR_CONTEXT: ('Edited %s' % other,)}).write({'name': 'Edited %s' % other})
                self.assertEqual(self._names(tag), ('Edited %s' % other,) * 2)

    def test_without_the_api_flag_only_the_editing_language_changes(self):
        tag = self.Tag.with_context(lang='en_US').create({'name': 'Source'})
        tag.with_context(lang='ar_001').write({'name': 'مصدر'})
        self.assertEqual(self._names(tag), ('مصدر', 'Source'))

    def test_text_the_caller_did_not_send_and_untranslated_fields_are_left_alone(self):
        seeded = self.Tag.with_context(lang='en_US').create({'name': 'Seed source'})
        seeded.with_context(lang='ar_001', **{MIRROR_CONTEXT: ('Other text',)}).write({'name': 'بذرة'})
        self.assertEqual(self._names(seeded), ('بذرة', 'Seed source'))
        tag = self.Tag.with_context(lang='ar_001', **{MIRROR_CONTEXT: ('Kept',)}).create({'name': 'Kept', 'color': 3})
        self.assertEqual(tag.color, 3)
        tag.with_context(**{MIRROR_CONTEXT: ('Kept',)}).write({'color': 4})
        self.assertEqual((tag.color, self._names(tag)), (4, ('Kept', 'Kept')))
