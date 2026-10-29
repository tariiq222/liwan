# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import patch

import requests

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .campaign_common import CampaignCase
from .common import BUSINESS_ACCOUNT_ID
from .health_common import meta
from .media_samples import PNG
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignDispatch(CampaignCase):

    def setUp(self):
        super().setUp()
        self.set_policy('opted_in_only')

    def set_policy(self, policy):
        self.settings.consent_policy = policy

    def set_limit(self, key, value):
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, key: value}})

    # snapshot and skip reasons

    def test_the_snapshot_freezes_every_matching_contact_with_its_skip_reason(self):
        ok = self.make_contact()
        unknown = self.make_contact(consent=None)
        out = self.make_contact(consent='opted_out')
        no_number = self.make_contact(address='')
        bad_number = self.make_contact(address='abc')
        campaign = self.launched(audience=self.env['webvue.inbox.audience'].create({'name': 'Snap'}))
        self.run_campaigns()
        reasons = {row.contact_id: row.skip_reason for row in campaign.recipient_ids}
        self.assertEqual(reasons[ok], False)
        self.assertEqual(
            (reasons[unknown], reasons[out], reasons[no_number], reasons[bad_number]),
            ('no_consent', 'opted_out', 'invalid_number', 'invalid_number'),
        )
        self.assertTrue(campaign.snapshot_done)
        self.assertEqual(self.recipient_of(campaign, ok).state, 'queued')

    def test_the_not_opted_out_policy_reaches_contacts_without_a_decision(self):
        self.set_policy('not_opted_out')
        unknown = self.make_contact(consent=None)
        out = self.make_contact(consent='opted_out')
        campaign = self.launched()
        self.run_campaigns()
        self.assertEqual(self.recipient_of(campaign, unknown).state, 'queued')
        self.assertEqual(self.recipient_of(campaign, out).skip_reason, 'opted_out')

    def test_a_contact_without_a_value_for_a_placeholder_is_skipped(self):
        with_email = self.make_contact(email='sara@example.com')
        without = self.make_contact()
        campaign = self.launched(params=({'location': 'body', 'position': 1, 'source': 'contact_email', 'value': None},))
        self.run_campaigns()
        self.assertEqual(self.recipient_of(campaign, with_email).state, 'queued')
        self.assertEqual(self.recipient_of(campaign, without).skip_reason, 'missing_param')

    def test_a_number_already_in_the_batch_is_a_duplicate(self):
        campaign = self.make_campaign()
        seen = {'96655000001'}
        reason = campaign._webvue_skip_reason(self.make_contact(), '96655000001', 'opted_in_only', seen)
        self.assertEqual(reason, 'duplicate_number')

    def test_the_audience_decides_who_is_a_recipient(self):
        vip = self.make_contact(tags=[self.tag])
        plain = self.make_contact()
        audience = self.env['webvue.inbox.audience'].create({'name': 'VIP', 'tag_ids': [(6, 0, self.tag.ids)]})
        campaign = self.launched(audience=audience)
        self.run_campaigns()
        self.assertEqual(campaign.recipient_ids.contact_id, vip)
        self.assertNotIn(plain, campaign.recipient_ids.contact_id)

    def test_a_large_audience_is_frozen_in_chunks_and_waits_for_the_last_one(self):
        for _ in range(3):
            self.make_contact()
        audience = self.env['webvue.inbox.audience'].create({'name': 'Chunks'})
        campaign = self.launched(audience=audience)
        with patch('odoo.addons.webvue_inbox.models.campaign_dispatch.SNAPSHOT_CHUNK', 2):
            self.run_campaigns()
            self.assertEqual((len(campaign.recipient_ids), campaign.snapshot_done), (2, False))
            self.assertFalse(campaign.recipient_ids.message_id)
            self.run_campaigns()
        self.assertEqual((len(campaign.recipient_ids), campaign.snapshot_done), (campaign.audience_id.contact_count, True))

    # conversations

    def test_an_open_conversation_is_reused_and_a_new_one_starts_resolved(self):
        known = self.make_conversation(channel=self.channel)
        known.contact_id._webvue_record_consent('opted_in', 'agent', note='test')
        fresh = self.make_contact()
        campaign = self.launched(audience=self.env['webvue.inbox.audience'].create({'name': 'Convs'}))
        self.run_campaigns()
        reused = self.recipient_of(campaign, known.contact_id).message_id.conversation_id
        created = self.recipient_of(campaign, fresh).message_id.conversation_id
        self.assertEqual((reused, created.state), (known, 'resolved'))
        message = self.recipient_of(campaign, fresh).message_id
        self.assertEqual((message.automated, message.author_id.id, message.business_initiated), (True, False, True))
        self.assertFalse(created.waiting_since)

    def test_a_reply_reopens_the_campaign_conversation(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.run_campaigns()
        conversation = self.recipient_of(campaign, contact).message_id.conversation_id
        self.assertEqual(conversation.state, 'resolved')
        self.deliver_from(contact, 'I am interested')
        self.assertEqual(conversation.state, 'open')

    # budgets

    def test_the_messaging_limit_is_shared_by_the_channels_of_one_business_account(self):
        sibling = self.make_channel(phone_id='100000000077', messaging_limit='tier_50')
        self.channel.messaging_limit = 'tier_50'
        for _ in range(2):
            self.make_contact(tags=[self.tag])
        self.make_contact(tags=[self.other_tag])
        first_audience = self.env['webvue.inbox.audience'].create({'name': 'First', 'tag_ids': [(6, 0, self.tag.ids)]})
        second_audience = self.env['webvue.inbox.audience'].create({'name': 'Second', 'tag_ids': [(6, 0, self.other_tag.ids)]})
        with patch.dict('odoo.addons.webvue_inbox.models.campaign_constants.TIER_CAPS', {'tier_50': 2}):
            first = self.launched(audience=first_audience)
            template = self.make_template(channel=sibling, category='marketing', body='Hi {{1}}')
            second = self.launched(channel=sibling, template=template, audience=second_audience)
            self.run_campaigns()
            self.assertEqual(sibling.business_account_id, BUSINESS_ACCOUNT_ID)
            self.assertEqual(len(first.recipient_ids.filtered(lambda row: row.state == 'queued')), 2)
            self.assertEqual(len(second.recipient_ids.filtered(lambda row: row.state == 'queued')), 0)
            self.assertEqual((first.waiting, second.waiting), (False, 'messaging_limit'))

    def test_an_address_already_messaged_today_costs_no_new_budget(self):
        known = self.make_contact()
        other = self.make_contact()
        audience = self.env['webvue.inbox.audience'].create({'name': 'Two', 'tag_ids': []})
        with patch.dict('odoo.addons.webvue_inbox.models.campaign_constants.TIER_CAPS', {'tier_10k': 2}):
            first = self.launched(audience=audience)
            self.run_campaigns()
            self.assertEqual(len(first.recipient_ids.filtered(lambda row: row.state == 'queued')), 2)
            again = self.launched(audience=audience)
            self.run_campaigns()
        self.assertEqual({row.state for row in again.recipient_ids}, {'queued'})
        self.assertEqual({known.id, other.id} <= set(again.recipient_ids.contact_id.ids), True)

    def test_the_daily_cap_is_a_rolling_day(self):
        for _ in range(5):
            self.make_contact()
        campaign = self.launched(daily_cap=2)
        self.run_campaigns()
        self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state != 'pending')), 2)
        self.assertEqual(campaign.waiting, 'daily_cap')
        self.run_campaigns()
        self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state != 'pending')), 2)
        campaign.recipient_ids.filtered('dispatched_at').write({'dispatched_at': fields.Datetime.now() - timedelta(hours=25)})
        self.run_campaigns()
        self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state != 'pending')), 4)

    def test_sending_within_working_hours_waits_until_they_open(self):
        contact = self.make_contact()
        self.set_company_hours(self.closed_hours_now())
        campaign = self.launched(send_within_hours=True)
        self.run_campaigns()
        self.assertEqual((self.recipient_of(campaign, contact).state, campaign.waiting), ('pending', 'working_hours'))
        self.set_company_hours(self.open_hours_now())
        self.run_campaigns()
        self.assertEqual(self.recipient_of(campaign, contact).state, 'queued')

    def test_a_scheduled_campaign_waits_for_its_time(self):
        contact = self.make_contact()
        later = fields.Datetime.now() + timedelta(hours=2)
        campaign = self.make_campaign(scheduled_at=later)
        campaign.action_launch()
        self.run_campaigns()
        self.assertEqual((campaign.state, campaign.waiting), ('scheduled', 'schedule'))
        campaign.scheduled_at = fields.Datetime.now() - timedelta(minutes=1)
        self.run_campaigns()
        self.assertEqual((campaign.state, self.recipient_of(campaign, contact).state), ('running', 'queued'))

    def test_only_a_bounded_number_of_messages_is_in_flight(self):
        for _ in range(5):
            self.make_contact()
        campaign = self.launched()
        with patch('odoo.addons.webvue_inbox.models.campaign_dispatch.CAMPAIGN_IN_FLIGHT', 3):
            self.run_campaigns()
            self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state == 'queued')), 3)
            self.run_campaigns()
            self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state == 'queued')), 3)
            self.run_outbox()
            self.run_campaigns()
        self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state == 'pending')), 0)

    def test_the_campaign_is_done_when_nothing_is_pending_or_queued(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.dispatch_all(campaign)
        self.assertEqual(campaign.state, 'running')
        self.recipient_of(campaign, contact).message_id.delivery_state = 'delivered'
        self.run_campaigns()
        self.assertEqual((campaign.state, bool(campaign.completed_at)), ('done', True))

    # limits

    def test_the_monthly_outbound_limit_pauses_the_campaign_and_frees_its_queue(self):
        for _ in range(3):
            self.make_contact()
        used = self.env['webvue.inbox.message']._webvue_count_outbound_this_month()
        self.set_limit('inbox.messages_out', used + 1)
        campaign = self.launched()
        self.run_campaigns()
        self.assertEqual(len(campaign.recipient_ids.filtered(lambda row: row.state == 'queued')), 1)
        self.run_campaigns()
        self.assertEqual((campaign.state, campaign.pause_reason), ('paused', 'messages_limit'))
        self.assertFalse(campaign.recipient_ids.message_id)
        self.assertEqual(self.env['webvue.inbox.message']._webvue_count_outbound_this_month(), used)

    def test_the_recipients_limit_pauses_the_campaign(self):
        for _ in range(3):
            self.make_contact()
        used = self.env['webvue.inbox.campaign.recipient']._webvue_count_dispatched_this_month()
        self.set_limit('inbox.campaign_recipients', used + 2)
        campaign = self.launched()
        self.run_campaigns(2)
        self.assertEqual((campaign.state, campaign.pause_reason), ('paused', 'recipients_limit'))
        self.assertEqual(self.env['webvue.inbox.campaign.recipient']._webvue_count_dispatched_this_month(), used)
        self.assertEqual(self.env['webvue.entitlement.service']._webvue_count_usage('inbox.campaign_recipients'), used)

    def test_launch_is_refused_when_the_monthly_room_is_gone(self):
        self.make_contact()
        self.set_limit('inbox.campaign_recipients', self.env['webvue.inbox.campaign.recipient']._webvue_count_dispatched_this_month())
        with self.assertRaisesRegex(ValidationError, 'monthly limit'):
            self.make_campaign().action_launch()

    def test_a_paused_campaign_gives_its_queued_messages_back(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.run_campaigns()
        campaign.action_pause()
        self.run_campaigns()
        self.assertEqual((self.recipient_of(campaign, contact).state, campaign.pause_reason), ('pending', 'manual'))
        campaign.action_resume()
        self.run_campaigns()
        self.assertEqual(self.recipient_of(campaign, contact).state, 'queued')

    def test_cancel_skips_everyone_not_yet_sent(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.run_campaigns()
        campaign.action_cancel()
        self.run_campaigns()
        recipient = self.recipient_of(campaign, contact)
        self.assertEqual((campaign.state, recipient.skip_reason, recipient.state), ('cancelled', 'cancelled', 'skipped'))
        self.assertFalse(recipient.message_id)

    # guards

    def test_an_unapproved_template_pauses_the_campaign(self):
        self.make_contact()
        campaign = self.launched()
        self.template.write({'status': 'paused', 'status_reason': 'LOW_QUALITY'})
        self.run_campaigns()
        self.assertEqual((campaign.state, campaign.pause_reason, campaign.pause_detail), ('paused', 'template_unavailable', 'LOW_QUALITY'))
        self.template.write({'status': 'approved', 'status_reason': False})

    def test_a_disabled_channel_and_a_restricted_account_pause_the_campaign(self):
        self.make_contact()
        channel = self.make_channel(phone_id='100000000088', messaging_limit='tier_10k')
        template = self.make_template(channel=channel, category='marketing', body='Hi {{1}}')
        campaign = self.launched(channel=channel, template=template)
        channel.account_state = 'restricted'
        self.run_campaigns()
        self.assertEqual((campaign.state, campaign.pause_reason), ('paused', 'account_restricted'))
        campaign.action_resume()
        channel.write({'account_state': 'active', 'state': 'disabled'})
        self.run_campaigns()
        self.assertEqual((campaign.state, campaign.pause_reason), ('paused', 'channel_disabled'))

    def test_the_campaign_cron_does_nothing_when_the_feature_is_off(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.set_feature(False)
        self.run_campaigns()
        self.assertFalse(campaign.recipient_ids)
        self.set_feature(True)
        self.run_campaigns()
        self.assertEqual(self.recipient_of(campaign, contact).state, 'queued')

    def set_feature(self, enabled):
        self.set_limit('inbox.campaigns', enabled)

    # the outbox

    def test_agent_messages_leave_before_campaign_messages(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.run_campaigns()
        conversation = self.make_conversation()
        agent_message = self.env['webvue.inbox.message']._webvue_queue_free_form(conversation, {'body': 'agent reply'})
        mock = self.run_outbox()
        bodies = [call[2].get('text', {}).get('body') or call[2].get('template', {}).get('name') for call in mock.calls]
        self.assertEqual(bodies[0], 'agent reply')
        self.assertEqual(len(bodies), 2)
        self.assertEqual(agent_message.delivery_state, 'sent')
        self.assertEqual(self.recipient_of(campaign, contact).state, 'sent')
        payload = mock.calls[1][2]
        self.assertEqual(payload['template']['components'][0]['parameters'], [{'type': 'text', 'text': 'Sara'}])

    def test_a_full_batch_asks_for_another_outbox_run(self):
        for _ in range(3):
            self.make_contact()
        self.launched()
        self.run_campaigns()
        message = type(self.env['webvue.inbox.message'])
        with patch('odoo.addons.webvue_inbox.models.message_outbox.OUTBOX_BATCH', 2), \
                patch.object(message, '_webvue_wake_outbox') as wake:
            self.run_outbox()
        wake.assert_called_once()

    def test_the_marketing_messages_api_is_used_when_the_channel_chooses_it(self):
        self.make_contact()
        self.channel.marketing_api = 'marketing_messages'
        self.launched()
        self.run_campaigns()
        mock = self.run_outbox()
        self.assertTrue(mock.calls[0][1].endswith('/100000000001/marketing_messages'))
        self.assertEqual(mock.calls[0][2]['product_policy'], 'CLOUD_API_FALLBACK')
        self.channel.marketing_api = 'cloud_api'

    def test_the_header_file_is_uploaded_once_and_shared_by_every_message(self):
        for _ in range(2):
            self.make_contact()
        template = self.make_template(category='marketing', body='Hi {{1}}', header_type='image')
        attachment = self.env['ir.attachment'].create({
            'name': 'offer.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': 'webvue.inbox.campaign', 'res_id': 0,
        })
        campaign = self.launched(template=template, header_attachment_id=attachment.id)
        sends = self.sending_meta()

        def answer(method, url, **kwargs):
            return meta({'id': 'media-77'}) if url.endswith('/media') else sends(method, url, **kwargs)

        with patch.object(requests, 'request', side_effect=answer) as request:
            self.run_campaigns()
            self.env['webvue.inbox.message']._webvue_run_outbox()
        uploads = [call for call in request.call_args_list if call.args[1].endswith('/media')]
        self.assertEqual((len(uploads), campaign.header_media_id), (1, 'media-77'))
        self.assertEqual(attachment.res_id, 0)
        headers = [call[2]['template']['components'][0] for call in sends.calls]
        self.assertEqual(headers, [{'type': 'header', 'parameters': [{'type': 'image', 'image': {'id': 'media-77'}}]}] * 2)
