# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .campaign_common import CampaignCase
from odoo.addons.webvue_inbox.adapters import whatsapp

# code: (recipient state, failure, campaign pause reason, contact consent after)
TABLE = {
    131049: ('failed', 'frequency_capped', None, 'opted_in'),
    131050: ('failed', 'marketing_opt_out', None, 'opted_out'),
    131026: ('failed', 'not_on_whatsapp', None, 'opted_in'),
    132001: ('failed', 'template_unavailable', 'template_unavailable', 'opted_in'),
    132015: ('failed', 'template_unavailable', 'template_unavailable', 'opted_in'),
    132016: ('failed', 'template_unavailable', 'template_unavailable', 'opted_in'),
    132000: ('failed', 'invalid_params', None, 'opted_in'),
    132012: ('failed', 'invalid_params', None, 'opted_in'),
    132018: ('failed', 'invalid_params', None, 'opted_in'),
    131008: ('failed', 'invalid_params', None, 'opted_in'),
    131009: ('failed', 'invalid_params', None, 'opted_in'),
    130472: ('failed', 'experiment', None, 'opted_in'),
    131048: ('failed', 'account_restricted', 'account_restricted', 'opted_in'),
    131031: ('failed', 'account_restricted', 'account_restricted', 'opted_in'),
    368: ('failed', 'account_restricted', 'account_restricted', 'opted_in'),
    131042: ('pending', None, 'payment', 'opted_in'),
    190: ('pending', None, 'token', 'opted_in'),
    131063: ('pending', None, 'template_unavailable', 'opted_in'),
    999999: ('failed', 'other', None, 'opted_in'),
}


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignErrors(CampaignCase):

    def one_recipient(self, code):
        """A running campaign with one contact, sent (state `sent`); returns (campaign, contact, recipient)."""
        tag = self.env['webvue.inbox.tag'].create({'name': f'case{code}'})
        contact = self.make_contact(tags=[tag])
        audience = self.env['webvue.inbox.audience'].create({'name': f'case{code}', 'tag_ids': [(6, 0, tag.ids)]})
        campaign = self.launched(audience=audience)
        self.run_campaigns()
        return campaign, contact, self.recipient_of(campaign, contact)

    def assert_outcome(self, code, campaign, contact, recipient):
        state, failure, pause, consent = TABLE[code]
        self.assertEqual((recipient.state, recipient.failure), (state, failure or False), code)
        self.assertEqual(campaign.state, 'paused' if pause else 'running', code)
        self.assertEqual(campaign.pause_reason, pause or False, code)
        self.assertEqual(contact.marketing_consent, consent, code)
        if pause:
            self.assertEqual(campaign.pause_detail, 'Meta said no', code)

    def test_every_error_code_of_a_status_webhook_is_handled_as_the_table_says(self):
        for code in TABLE:
            with self.subTest(code=code):
                campaign, contact, recipient = self.one_recipient(code)
                self.run_outbox()
                self.assertEqual(recipient.state, 'sent')
                self.fail_status(recipient.message_id, code, 'Meta said no')
                self.assert_outcome(code, campaign, contact, recipient)
                if code == 131050:
                    event = contact.consent_ids.sorted('id')[-1]
                    self.assertEqual((event.source, event.campaign_id), ('delivery_error', campaign))
                    self.assertTrue(recipient.unsubscribed_at)

    def test_every_error_code_of_a_failed_send_is_handled_as_the_table_says(self):
        for code in TABLE:
            with self.subTest(code=code):
                campaign, contact, recipient = self.one_recipient(code)
                self.run_outbox(self.sending_meta(status=400, body={'error': {'message': 'Meta said no', 'code': code}}))
                self.assert_outcome(code, campaign, contact, recipient)

    def test_a_retryable_code_keeps_the_message_queued_with_its_code(self):
        campaign, _contact, recipient = self.one_recipient(130429)
        self.run_outbox(self.sending_meta(status=400, body={'error': {'message': 'slow down', 'code': 130429}}))
        message = recipient.message_id
        self.assertEqual((recipient.state, message.attempts, message.error_code, campaign.state), ('queued', 1, 130429, 'running'))

    def test_a_paused_campaign_resumes_and_sends_the_released_recipient_again(self):
        campaign, _contact, recipient = self.one_recipient(190)
        self.run_outbox(self.sending_meta(status=401, body={'error': {'message': 'expired', 'code': 190}}))
        self.assertEqual((campaign.state, campaign.pause_reason, recipient.state), ('paused', 'token', 'pending'))
        campaign.action_resume()
        self.run_campaigns()
        self.assertEqual((campaign.state, recipient.state, campaign.pause_reason), ('running', 'queued', False))

    def test_a_message_held_for_a_quality_check_is_marked_until_meta_lets_it_through(self):
        campaign, _contact, recipient = self.one_recipient(1)
        self.run_outbox(self.sending_meta(held=True))
        message = recipient.message_id
        self.assertEqual((message.held_for_quality, recipient.state), (True, 'sent'))
        self.assertEqual(self.env['webvue.inbox.campaign']._webvue_stats(campaign)[campaign.id]['held'], 1)
        update = whatsapp.StatusUpdate(message.provider_message_id, 'delivered', fields.Datetime.now(), None)
        self.env['webvue.inbox.message']._webvue_apply_status(update)
        self.assertEqual((message.held_for_quality, recipient.state), (False, 'delivered'))

    def test_a_dropped_held_message_fails_with_the_template_unavailable_code(self):
        campaign, _contact, recipient = self.one_recipient(132015)
        self.run_outbox(self.sending_meta(held=True))
        self.fail_status(recipient.message_id, 132015, 'dropped')
        self.assertEqual((recipient.failure, campaign.pause_reason), ('template_unavailable', 'template_unavailable'))

    def test_a_frequency_capped_recipient_can_be_retried_only_a_day_later(self):
        campaign, _contact, recipient = self.one_recipient(131049)
        self.run_outbox()
        self.fail_status(recipient.message_id, 131049)
        self.assertEqual(recipient.failure, 'frequency_capped')
        self.assertFalse(recipient._webvue_can_retry())
        with self.assertRaises(ValidationError):
            campaign.action_retry()
        self.age_message(recipient.message_id, 25)
        self.assertTrue(recipient._webvue_can_retry())
        self.assertEqual(campaign.action_retry(), 1)
        self.assertEqual(recipient.state, 'pending')
        self.run_campaigns()
        self.assertEqual(recipient.state, 'queued')

    def test_a_late_failure_never_pauses_a_finished_campaign(self):
        campaign, _contact, recipient = self.one_recipient(131042)
        self.run_outbox()
        recipient.message_id.delivery_state = 'delivered'
        self.run_campaigns()
        self.assertEqual(campaign.state, 'done')
        self.fail_status(recipient.message_id, 131042)
        self.assertEqual(campaign.state, 'done')
