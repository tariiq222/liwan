# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestProjectWriteGuard(TransactionCase):
    """The whitelist of the sudo'd *do* step refuses a field instead of raising an uncaught error (#538).

    ``_liwan_write_sudo`` is the write half of ``_liwan_write_as_manager`` and of the
    charter/status *do* steps, so a caller that skipped its own field check must fail
    closed with an access refusal the API contract maps to 403, not with a
    ``ValueError`` that escapes ``api_handler`` as a 500.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = cls.env['project.project'].create({
            'name': 'Guarded', 'company_id': cls.env.company.id,
        })

    def test_disallowed_field_is_an_access_refusal(self):
        with self.assertRaises(AccessError) as raised:
            self.project._liwan_write_sudo({'liwan_code': 'GUARDED-CODE'})
        # The refusal is the msgid project_project.write already uses and ar.po already
        # translates, not an untranslated developer f-string: the API shows this text.
        self.assertEqual(str(raised.exception), "Project fields are not allowed.")
        self.assertFalse(self.project.liwan_code)

    def test_the_refusal_message_is_the_translated_msgid(self):
        """The reused msgid already carries its Arabic term, so the 403 text needs no new translation."""
        self.env['res.lang']._activate_lang('ar_001')
        with self.assertRaises(AccessError) as raised:
            self.project.with_context(lang='ar_001')._liwan_write_sudo({'liwan_code': 'GUARDED-CODE'})
        self.assertEqual(str(raised.exception), "حقول المشروع غير مسموحة.")

    def test_disallowed_field_stops_the_whole_write(self):
        """One refused field rejects the call before an allowed field of the same payload is written."""
        self.project.write({'description': 'Original description'})
        before = self.project.description
        with self.assertRaises(AccessError):
            self.project._liwan_write_sudo({
                'name': 'Should not apply', 'liwan_code': 'GUARDED-CODE',
                'description': 'Should not apply',
            })
        self.assertEqual(self.project.name, 'Guarded')
        self.assertEqual(self.project.description, before)

    def test_allowed_field_still_writes(self):
        self.project._liwan_write_sudo({'name': 'Renamed'})
        self.assertEqual(self.project.name, 'Renamed')
