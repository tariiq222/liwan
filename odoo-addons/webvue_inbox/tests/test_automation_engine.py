# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .automation_common import AutomationCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_inbox.models import automation as engine
from odoo.addons.webvue_inbox.models.constants import MAX_AUTOMATED_PER_HOUR
from odoo.addons.webvue_inbox.models.normalization import normalize_text
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestNormalization(AutomationCase):

    def test_arabic_forms_diacritics_and_tatweel_are_unified(self):
        for raw, expected in (
            ('السِّعْر', 'السعر'), ('الســـعر', 'السعر'), ('أسعار إسعاف آسر', 'اسعار اسعاف اسر'),
            ('على', 'علي'), ('الخدمة', 'الخدمه'), ('HELLO   World', 'hello world'), ('  ', ''), (None, ''),
            ('رقم ٠٥٠١٢٣', 'رقم 050123'), ('کد ۱۲۳۴', 'کد 1234'),
        ):
            self.assertEqual(normalize_text(raw), expected, raw)

    def test_contains_matches_whole_words_only(self):
        rule = self.make_rule(keywords=['لا', 'room 12'])
        for text, expected in (
            ('السلام عليكم', False), ('لا شكرا', True), ('قلت: لا!', True), ('hall', False), ('book room 12 please', True),
            ('room 123', False), ('غرفة ١٢', False), ('room ١٢', True),
        ):
            self.assertEqual(rule._webvue_matches(text, None, True), expected, text)

    def test_digits_of_every_script_match_one_another(self):
        rule = self.make_rule(keywords=['١٢٣'])
        self.assertTrue(rule._webvue_matches('code 123', None, True))
        self.assertTrue(rule._webvue_matches('كود ۱۲۳', None, True))

    def test_a_keyword_without_words_is_refused(self):
        with self.assertRaises(ValidationError):
            self.make_rule(keywords=['؟؟'])

    def test_keywords_are_stored_normalized(self):
        rule = self.make_rule(keywords=['أَسعار', 'Price'])
        self.assertEqual(rule.keyword_ids.mapped('normalized'), ['اسعار', 'price'])
        rule.keyword_ids[0].value = 'الخِدمة'
        self.assertEqual(rule.keyword_ids[0].normalized, 'الخدمه')


@tagged('post_install', '-at_install', 'webvue')
class TestWelcomeAndAway(AutomationCase):

    def test_welcome_goes_to_a_new_conversation_once(self):
        self.set_text('welcome', 'Welcome!')
        first, _event = self.deliver('Hi')
        conversation = first.conversation_id
        welcome = self.automated(conversation)
        self.assertEqual(len(welcome), 1)
        self.assertEqual(
            (welcome.direction, welcome.body, welcome.kind, welcome.author_id, welcome.delivery_state),
            ('out', 'Welcome!', 'text', self.env['res.users'], 'queued'),
        )
        self.assertIn(engine.NOTE_WELCOME, self.notes(conversation))
        self.deliver('Still there')
        self.assertEqual(len(self.automated(conversation)), 1)

    def test_welcome_greets_a_returning_customer_after_the_idle_days(self):
        self.set_text('welcome', 'Welcome!', welcome_idle_days=2)
        first, _event = self.deliver('Hi')
        conversation = first.conversation_id
        conversation.message_ids.write({'date': fields.Datetime.now() - timedelta(days=3)})
        self.deliver('I am back')
        self.assertEqual(len(self.automated(conversation)), 2)
        self.deliver('One more')
        self.assertEqual(len(self.automated(conversation)), 2)

    def test_nothing_is_sent_when_the_messages_are_off(self):
        self.channel._webvue_set_auto_message('welcome', {'body': 'Welcome!'})
        message, _event = self.deliver('Hi')
        self.assertFalse(self.automated(message.conversation_id))

    def test_interactive_welcome_menu_keeps_its_buttons(self):
        self.channel._webvue_set_auto_message('welcome', {
            'interactive_type': 'buttons', 'body': 'Pick one', 'interactive_footer': 'Menu',
            'option_ids': [
                (0, 0, {'sequence': 0, 'option_id': 'a', 'title': 'A'}), (0, 0, {'sequence': 1, 'option_id': 'b', 'title': 'B'}),
            ],
        })
        self.channel.welcome_enabled = True
        message, _event = self.deliver('Hi')
        sent = self.automated(message.conversation_id)
        self.assertEqual((sent.kind, sent.interactive_type), ('interactive', 'buttons'))
        self.assertEqual(sent._webvue_interactive(), {
            'type': 'buttons', 'body': 'Pick one', 'header': None, 'footer': 'Menu',
            'buttons': [{'id': 'a', 'title': 'A'}, {'id': 'b', 'title': 'B'}],
        })

    def test_away_is_sent_outside_hours_and_suppresses_welcome(self):
        self.set_company_hours(self.closed_hours_now())
        self.set_text('welcome', 'Welcome!')
        self.set_text('away', 'We are closed')
        message, _event = self.deliver('Hi')
        conversation = message.conversation_id
        self.assertEqual(self.automated(conversation).mapped('body'), ['We are closed'])
        self.assertEqual(conversation.away_sent_at, message.date)
        self.assertIn(engine.NOTE_AWAY, self.notes(conversation))

    def test_away_repeats_only_after_the_repeat_hours(self):
        self.set_company_hours(self.closed_hours_now())
        self.set_text('away', 'We are closed', away_repeat_hours=12)
        message, _event = self.deliver('Hi')
        conversation = message.conversation_id
        self.deliver('Anyone?')
        self.assertEqual(len(self.automated(conversation)), 1)
        conversation.away_sent_at = fields.Datetime.now() - timedelta(hours=13)
        self.deliver('Hello??')
        self.assertEqual(len(self.automated(conversation)), 2)

    def test_inside_hours_or_without_a_calendar_there_is_no_away(self):
        self.set_text('away', 'We are closed')
        message, _event = self.deliver('Hi')
        self.assertFalse(self.automated(message.conversation_id))
        self.set_company_hours(self.open_hours_now())
        other, _event = self.deliver('Hi again', wa_id='966500000099')
        self.assertFalse(self.automated(other.conversation_id))

    def test_a_department_hours_replace_the_company_ones(self):
        self.set_company_hours(self.open_hours_now())
        self.env['webvue.inbox.working.hours']._webvue_write(self.department, self.closed_hours_now())
        self.channel.department_id = self.department
        self.set_text('away', 'Support is closed')
        message, _event = self.deliver('Hi')
        self.assertEqual(self.automated(message.conversation_id).mapped('body'), ['Support is closed'])


@tagged('post_install', '-at_install', 'webvue')
class TestRules(AutomationCase):

    def test_a_keyword_rule_matches_arabic_text_without_diacritics(self):
        self.make_rule(name='Prices', keywords=['الأسعار'], reply={'body': 'قائمة الأسعار'})
        message, _event = self.deliver('كم الاسـعار؟')
        sent = self.automated(message.conversation_id)
        self.assertEqual(sent.mapped('body'), ['قائمة الأسعار'])
        self.assertIn(engine.NOTE_RULE_REPLY % 'Prices', self.notes(message.conversation_id))
        other, _event = self.deliver('مرحبا', wa_id='966500000098')
        self.assertFalse(self.automated(other.conversation_id))

    def test_exact_and_starts_with(self):
        self.make_rule(name='Exact', match_kind='exact', keywords=['hours'], reply={'body': 'exact'})
        self.make_rule(name='Starts', match_kind='starts_with', keywords=['book'], reply={'body': 'starts'})
        cases = (('Hours', ['exact']), ('hours please', []), ('Book a visit', ['starts']), ('please book', []))
        for index, (text, expected) in enumerate(cases):
            message, _event = self.deliver(text, wa_id=f'96650001{index:04d}')
            self.assertEqual(self.automated(message.conversation_id).mapped('body'), expected, text)

    def test_an_option_rule_answers_the_chosen_button_and_acts(self):
        tag = self.env['webvue.inbox.tag'].create({'name': 'Booking'})
        self.make_rule(
            name='Menu book', match_kind='option', option_id='menu_book', reply={'body': 'Send your name'},
            department_id=self.department.id, tag_ids=[(6, 0, tag.ids)], priority='high',
        )
        message, _event = self.deliver('', option=('menu_book', 'Book'))
        conversation = message.conversation_id
        self.assertEqual(self.automated(conversation).mapped('body'), ['Send your name'])
        self.assertEqual((conversation.department_id, conversation.tag_ids, conversation.priority), (self.department, tag, 'high'))
        self.assertEqual(len(self.notes(conversation)), 4)
        other, _event = self.deliver('', option=('other', 'Other'), wa_id='966500000097')
        self.assertFalse(self.automated(other.conversation_id))

    def test_a_rule_can_assign_and_resolve(self):
        self.make_rule(name='Done', keywords=['thanks'], reply=None, assignee_id=self.agent.id, resolve=True)
        message, _event = self.deliver('thanks a lot')
        conversation = message.conversation_id
        self.assertEqual((conversation.assignee_id, conversation.state), (self.agent, 'resolved'))
        bell = self.env['mail.message'].search([('webvue_notification_kind', '=', 'inbox.assigned'), ('res_id', '=', conversation.id)])
        self.assertEqual(len(bell), 1)

    def test_stop_ends_the_evaluation_and_continue_runs_the_next_rule(self):
        self.make_rule(name='First', keywords=['hi'], reply={'body': 'first'}, stop=True)
        self.make_rule(name='Second', keywords=['hi'], reply={'body': 'second'})
        message, _event = self.deliver('hi')
        self.assertEqual(self.automated(message.conversation_id).mapped('body'), ['first'])
        self.env['webvue.inbox.rule'].search([('name', '=', 'First')]).stop = False
        other, _event = self.deliver('hi', wa_id='966500000096')
        self.assertEqual(self.automated(other.conversation_id).mapped('body'), ['first', 'second'])

    def test_rules_run_in_sequence_order(self):
        self.make_rule(name='Late', sequence=20, match_kind='any', reply={'body': 'late'}, stop=False)
        self.make_rule(name='Early', sequence=5, match_kind='any', reply={'body': 'early'}, stop=False)
        message, _event = self.deliver('x')
        self.assertEqual(self.automated(message.conversation_id).mapped('body'), ['early', 'late'])

    def test_a_rule_can_be_limited_to_one_channel_and_to_hours(self):
        other_channel = self.make_channel(phone_id='100000000077')
        self.make_rule(name='Other channel', match_kind='any', channel_id=other_channel.id, reply={'body': 'other'})
        self.make_rule(name='Outside only', match_kind='any', hours_condition='outside', reply={'body': 'outside'}, stop=False)
        self.make_rule(name='Inside only', match_kind='any', hours_condition='inside', reply={'body': 'inside'}, stop=False)
        message, _event = self.deliver('x')
        self.assertEqual(self.automated(message.conversation_id).mapped('body'), ['inside'])
        self.set_company_hours(self.closed_hours_now())
        later, _event = self.deliver('x', wa_id='966500000095')
        self.assertEqual(self.automated(later.conversation_id).mapped('body'), ['outside'])

    def test_an_inactive_rule_never_fires(self):
        self.make_rule(keywords=['hi'], active=False)
        message, _event = self.deliver('hi')
        self.assertFalse(self.automated(message.conversation_id))

    def test_rule_replies_are_quiet_while_an_agent_handles_the_conversation(self):
        tag = self.env['webvue.inbox.tag'].create({'name': 'Seen'})
        self.make_rule(keywords=['hi'], reply={'body': 'auto'}, tag_ids=[(6, 0, tag.ids)])
        first, _event = self.deliver('hello there', provider_id='wamid.A1')
        conversation = first.conversation_id
        self.env['webvue.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'body': 'On it', 'author_id': self.agent.id, 'delivery_state': 'sent',
        })
        self.deliver('hi again')
        self.assertFalse(self.automated(conversation))
        self.assertEqual(conversation.tag_ids, tag)

    def test_at_most_five_automated_replies_per_conversation_per_hour(self):
        self.make_rule(match_kind='any', reply={'body': 'auto'})
        message, _event = self.deliver('one')
        conversation = message.conversation_id
        for index in range(2, 9):
            self.deliver(f'm{index}')
        self.assertEqual(len(self.automated(conversation)), MAX_AUTOMATED_PER_HOUR)

    def test_a_message_is_evaluated_once_even_when_replayed(self):
        self.make_rule(match_kind='any', reply={'body': 'auto'})
        message, _event = self.deliver('hi', provider_id='wamid.REPLAY')
        conversation = message.conversation_id
        self.deliver('hi', provider_id='wamid.REPLAY')
        self.env['webvue.inbox.automation']._webvue_run(conversation, message)
        self.assertEqual((len(self.automated(conversation)), message.automation_done), (1, True))

    def test_old_messages_are_not_answered(self):
        self.make_rule(match_kind='any', reply={'body': 'auto'})
        message, _event = self.deliver('late', at=fields.Datetime.now() - timedelta(days=2))
        self.assertFalse(self.automated(message.conversation_id))
        self.assertTrue(message.automation_done)

    def test_the_sub_feature_switches_the_engine_off(self):
        self.make_rule(match_kind='any', reply={'body': 'auto'})
        set_probe_feature(self, key='inbox.automation', enabled=False)
        message, _event = self.deliver('hi')
        self.assertFalse(self.automated(message.conversation_id))

    def test_the_outbound_limit_skips_the_reply_and_leaves_a_note(self):
        self.set_text('welcome', 'Welcome!')
        profile = self.env.ref('webvue_platform.tenant_profile')
        used = self.env['webvue.inbox.message']._webvue_count_outbound_this_month()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.messages_out': used}})
        message, event = self.deliver('Hi')
        conversation = message.conversation_id
        self.assertEqual(event.state, 'done')
        self.assertFalse(self.automated(conversation))
        self.assertIn(engine.NOTE_LIMIT, self.notes(conversation))

    def test_automated_replies_wait_in_the_outbox_without_an_author(self):
        self.make_rule(match_kind='any', reply={'body': 'auto'})
        message, _event = self.deliver('hi')
        sent = self.automated(message.conversation_id)
        self.assertEqual((sent.delivery_state, bool(sent.next_attempt_at), sent.author_id.id), ('queued', True, False))
