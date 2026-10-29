# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .campaign_common import CampaignCase
from .health_common import process


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignOptOut(CampaignCase):

    def sent_campaign(self, contact=None):
        contact = contact or self.make_contact()
        campaign = self.launched()
        self.dispatch_all(campaign)
        return campaign, contact, self.recipient_of(campaign, contact)

    def replies(self, conversation):
        return conversation.message_ids.filtered(lambda message: message.automated and message.direction == 'out' and not message.campaign_recipient_ids)

    def test_a_stop_keyword_opts_the_contact_out_and_is_attributed_to_the_campaign(self):
        campaign, contact, recipient = self.sent_campaign()
        message, _event = self.deliver_from(contact, 'إيقاف')
        self.assertEqual((contact.marketing_consent, contact.marketing_consent_source), ('opted_out', 'keyword'))
        event = contact.consent_ids.sorted('id')[-1]
        self.assertEqual((event.campaign_id, event.note), (campaign, 'إيقاف'))
        self.assertTrue(recipient.unsubscribed_at)
        self.assertTrue(recipient.replied_at)
        self.assertIn('إيقاف', ' '.join(self.notes(message.conversation_id)))

    def test_keywords_match_after_arabic_normalization_and_in_either_language(self):
        for index, text in enumerate(('إيقاف', 'ايقاف', 'إِيقَاف', 'STOP', ' Stop  ', 'إلغاء الاشتراك')):
            with self.subTest(text=text):
                contact = self.make_contact()
                self.deliver(text, wa_id=contact.identity_ids.address, provider_id=f'wamid.KW{index}')
                self.assertEqual(contact.marketing_consent, 'opted_out')

    def test_only_an_exact_keyword_counts(self):
        contact = self.make_contact()
        for index, text in enumerate(('إلغاء', 'please stop sending', 'stop it now', 'ايقاف العمل')):
            self.deliver(text, wa_id=contact.identity_ids.address, provider_id=f'wamid.NO{index}')
        self.assertEqual(contact.marketing_consent, 'opted_in')

    def test_a_button_title_counts_as_a_keyword(self):
        contact = self.make_contact()
        self.deliver(option=('stop_btn', 'إيقاف'), wa_id=contact.identity_ids.address)
        self.assertEqual(contact.marketing_consent, 'opted_out')

    def test_the_keyword_handling_can_be_turned_off(self):
        self.settings.keyword_opt_out = False
        contact = self.make_contact()
        self.deliver('stop', wa_id=contact.identity_ids.address)
        self.assertEqual(contact.marketing_consent, 'opted_in')
        self.settings.keyword_opt_out = True

    def test_the_confirmation_is_an_automated_reply_inside_the_window_and_the_rules_stay_quiet(self):
        self.make_rule(match_kind='any', reply={'body': 'rule reply'})
        contact = self.make_contact()
        message, _event = self.deliver('stop', wa_id=contact.identity_ids.address)
        conversation = message.conversation_id
        confirmation = self.automated(conversation)
        self.assertEqual(confirmation.mapped('body'), [self.settings.stop_reply])
        self.assertEqual((confirmation.direction, confirmation.delivery_state, confirmation.author_id.id), ('out', 'queued', False))
        self.assertTrue(message.automation_done)

    def test_no_confirmation_is_sent_when_the_reply_is_empty(self):
        self.settings.stop_reply = False
        contact = self.make_contact()
        message, _event = self.deliver('stop', wa_id=contact.identity_ids.address)
        self.assertFalse(self.automated(message.conversation_id))
        self.settings.stop_reply = 'تم'

    def test_a_start_keyword_opts_the_contact_back_in(self):
        contact = self.make_contact(consent='opted_out')
        message, _event = self.deliver('اشتراك', wa_id=contact.identity_ids.address)
        self.assertEqual((contact.marketing_consent, contact.marketing_consent_source), ('opted_in', 'keyword'))
        self.assertEqual(self.automated(message.conversation_id).mapped('body'), [self.settings.start_reply])

    def test_a_reply_is_attributed_once_and_only_within_three_days(self):
        _campaign, contact, recipient = self.sent_campaign()
        self.age_message(recipient.message_id, 80)
        self.deliver_from(contact, 'late')
        self.assertFalse(recipient.replied_at)
        _campaign2, contact2, recipient2 = self.sent_campaign()
        first, _ = self.deliver_from(contact2, 'one')
        replied = recipient2.replied_at
        self.assertEqual(replied, first.date)
        self.deliver_from(contact2, 'two')
        self.assertEqual(recipient2.replied_at, replied)

    # WhatsApp preferences

    def test_the_whatsapp_stop_and_resume_preference(self):
        contact = self.make_contact()
        address = contact.identity_ids.address
        process(self, self.channel, self.keyword_event(address, 'stop'))
        self.assertEqual((contact.marketing_consent, contact.marketing_consent_source), ('opted_out', 'whatsapp'))
        process(self, self.channel, self.keyword_event(address, 'resume'))
        self.assertEqual(contact.marketing_consent, 'opted_in')

    def test_a_resume_restores_an_unknown_state_and_never_overrides_a_later_decision(self):
        unknown = self.make_contact(consent=None)
        process(self, self.channel, self.keyword_event(unknown.identity_ids.address, 'stop'))
        process(self, self.channel, self.keyword_event(unknown.identity_ids.address, 'resume'))
        self.assertEqual(unknown.marketing_consent, 'unknown')
        agent_out = self.make_contact(consent=None)
        process(self, self.channel, self.keyword_event(agent_out.identity_ids.address, 'stop'))
        agent_out._webvue_record_consent('opted_out', 'agent')
        process(self, self.channel, self.keyword_event(agent_out.identity_ids.address, 'resume'))
        self.assertEqual(agent_out.marketing_consent, 'opted_out')

    def test_a_preference_of_an_unknown_number_is_ignored(self):
        process(self, self.channel, self.keyword_event('966500000999', 'stop'))
        self.assertFalse(self.env['webvue.inbox.contact.consent'].search([('source', '=', 'whatsapp')]))

    def test_the_whatsapp_stop_marks_the_recipient_of_a_recent_campaign(self):
        _campaign, contact, recipient = self.sent_campaign()
        process(self, self.channel, self.keyword_event(contact.identity_ids.address, 'stop'))
        self.assertTrue(recipient.unsubscribed_at)

    # imports and agents

    def test_an_import_never_overrides_an_opt_out_but_an_agent_can(self):
        contact = self.make_contact(consent='opted_out')
        self.assertFalse(contact._webvue_record_consent('opted_in', 'import', note='csv'))
        self.assertEqual(contact.marketing_consent, 'opted_out')
        contact._webvue_record_consent('opted_in', 'agent', note='website form')
        self.assertEqual(contact.marketing_consent, 'opted_in')

    def test_the_newest_decision_wins_and_the_history_is_newest_first(self):
        contact = self.make_contact(consent=None)
        contact._webvue_record_consent('opted_in', 'agent', note='form')
        contact._webvue_record_consent('opted_out', 'keyword')
        history = contact._webvue_history()
        self.assertEqual([event.state for event in history], ['opted_out', 'opted_in'])
        self.assertEqual(contact.marketing_consent, 'opted_out')
