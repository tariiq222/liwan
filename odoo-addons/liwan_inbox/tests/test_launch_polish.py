# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo.tests import tagged

from .automation_common import AutomationCase
from odoo.addons.liwan_inbox.models.automation import NOTE_PRIORITY_LABELS
from odoo.addons.liwan_inbox.models.rule import PRIORITIES
from odoo.addons.liwan_inbox.serializers.settings import dump_template


@tagged('post_install', '-at_install', 'liwan')
class TestLaunchPolish(AutomationCase):

    def test_a_report_of_a_company_without_settings_does_not_create_the_row(self):
        settings = self.env['liwan.inbox.settings']
        settings.search([('company_id', '=', self.env.company.id)]).unlink()
        self.login(self.supervisor)
        today = self.env['liwan.inbox.report.build']._liwan_today(self.env.company)
        response = self.get(f'/api/v1/inbox/reports/overview?from={today - timedelta(days=6)}&to={today}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(settings.search([('company_id', '=', self.env.company.id)]))

    def test_the_export_writes_a_phone_as_text_a_spreadsheet_keeps(self):
        conversation = self.make_conversation()
        self.login(self.supervisor)
        export = self.get('/api/v1/inbox/conversations/export.csv')
        self.assertEqual(export.status_code, 200, export.text)
        self.assertIn(f'\t{conversation.contact_id.phone}', export.text)

    def test_a_rule_note_names_the_priority_by_its_label_not_its_key(self):
        self.make_rule(name='Urgent rule', keywords=['asap'], priority='urgent')
        message, _event = self.deliver('asap please')
        notes = [note for note in self.notes(message.conversation_id) if 'Urgent rule' in note and 'الأولوية' in note]
        self.assertEqual(len(notes), 1)
        self.assertIn(NOTE_PRIORITY_LABELS['urgent'], notes[0])
        self.assertNotIn('urgent', notes[0])

    def test_every_rule_priority_has_an_arabic_note_label(self):
        self.assertEqual(set(NOTE_PRIORITY_LABELS), {key for key, _label in PRIORITIES})

    def test_an_otp_button_without_text_serializes_null_not_false(self):
        template = self.make_template(
            category='authentication', body='{{1}} is your code.', code_expiration_minutes=5,
            button_ids=[{'kind': 'otp', 'text': 'Copy code'}],
        )
        self.env.cr.execute('UPDATE liwan_inbox_template_button SET text = NULL WHERE template_id = %s', [template.id])
        template.button_ids.invalidate_recordset()
        self.assertIsNone(dump_template(template)['otp_button_text'])

    def test_a_conversation_detail_says_whether_an_image_can_be_sent(self):
        conversation = self.make_conversation()
        self.login(self.supervisor)
        path = f'/api/v1/inbox/conversations/{conversation.id}'
        self.assertIs(self.get(path).json()['image_send_capable'], False)
        conversation.image_send_capable = True
        self.assertIs(self.get(path).json()['image_send_capable'], True)
