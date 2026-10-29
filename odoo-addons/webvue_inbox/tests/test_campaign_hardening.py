# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from datetime import timedelta
from unittest.mock import patch

import requests

from odoo import Command, fields
from odoo.exceptions import ValidationError
from odoo.tests import new_test_user, tagged

from .campaign_common import BASE, FIRST_NAME, CampaignCase
from .common import PASSWORD
from .health_common import meta
from .media_samples import PNG
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule

Message = 'webvue.inbox.message'


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignSendClaim(CampaignCase):
    """A queued campaign message is claimed before it is sent, and the release of a paused campaign never deletes a claimed one."""

    def queued(self, count=1):
        contacts = [self.make_contact() for _ in range(count)]
        campaign = self.launched()
        self.run_campaigns()
        return campaign, [self.recipient_of(campaign, contact) for contact in contacts]

    def test_a_message_the_outbox_cannot_lock_is_not_sent_and_a_locked_one_is_not_released(self):
        campaign, (recipient,) = self.queued()
        message = recipient.message_id
        nothing = lambda records: records.browse()  # noqa: E731
        with patch.object(type(self.env[Message]), '_webvue_lock_available', nothing):
            mock = self.run_outbox()
        self.assertEqual((len(mock.calls), message.delivery_state), (0, 'queued'))
        campaign.action_pause()
        with patch.object(type(self.env[Message]), '_webvue_lock_available', nothing):
            self.run_campaigns()
        self.assertTrue(message.exists())
        self.run_campaigns()
        self.assertFalse(message.exists())
        self.assertEqual((recipient.state, recipient.dispatched_at), ('pending', False))

    def test_the_send_rechecks_that_the_campaign_is_still_running(self):
        campaign, (recipient,) = self.queued()
        campaign.action_pause()
        with patch.object(requests, 'request') as request:
            recipient.message_id._webvue_deliver()
        self.assertEqual((request.call_count, recipient.message_id.delivery_state), (0, 'queued'))

    def test_a_message_deleted_while_the_batch_runs_does_not_abort_it(self):
        _campaign, (first, second) = self.queued(2)
        first_message, second_message = first.message_id, second.message_id
        original = type(self.env[Message])._webvue_deliver

        def deliver(message):
            if message == first_message:
                second_message.unlink()
            return original(message)

        with patch.object(type(self.env[Message]), '_webvue_deliver', deliver):
            mock = self.run_outbox()
        self.assertEqual((len(mock.calls), first.state), (1, 'sent'))
        self.env[Message]._webvue_unexpected_failure(second_message, RuntimeError())

    def test_a_pause_right_after_the_selection_sends_nothing_more(self):
        campaign, (first, second) = self.queued(2)
        original = type(self.env[Message])._webvue_deliver

        def deliver(message):
            original(message)
            if message == first.message_id:
                campaign.action_pause()

        with patch.object(type(self.env[Message]), '_webvue_deliver', deliver):
            mock = self.run_outbox()
        self.assertEqual(len(mock.calls), 1)
        self.assertEqual(second.state, 'queued')


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignCompanies(CampaignCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({'name': 'Branch', 'parent_id': cls.env.company.id})
        cls.foreign_tag = cls.env['webvue.inbox.tag'].create({'name': 'foreign', 'company_id': cls.branch.id})
        cls.foreign_audience = cls.env['webvue.inbox.audience'].create({'name': 'Foreign', 'company_id': cls.branch.id})
        cls.branch_user = new_test_user(
            cls.env, login='inbox_branch_campaigns', password=PASSWORD, name='branch', groups='webvue_core.group_employee',
        )
        cls.branch_user.company_ids = [Command.link(cls.branch.id)]
        role = cls.env['webvue.access.role'].create({
            'key': 'inbox_branch_campaigns', 'name_ar': 'x', 'name_en': 'x', 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', '=', 'inbox.campaigns.manage')]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.branch_user, [{'role_id': role.id, 'company_id': cls.env.company.id}])

    def test_the_models_refuse_records_of_another_company(self):
        branch_channel = self.make_channel(phone_id='100000000099', owner_company_id=self.branch.id)
        branch_template = self.make_template(channel=branch_channel, category='marketing', body='Hi {{1}}', company_id=self.branch.id)
        for values in (
            {'audience': self.foreign_audience},
            {'channel': branch_channel, 'template': self.make_template(channel=branch_channel, category='marketing', body='Hi {{1}}', company_id=self.env.company.id)},
            {'template': branch_template, 'channel': self.channel},
        ):
            with self.subTest(values=list(values)), self.assertRaises(ValidationError), self.env.cr.savepoint():
                self.make_campaign(**values)
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.env['webvue.inbox.audience'].create({'name': 'Mixed', 'tag_ids': [Command.set(self.foreign_tag.ids)]})
        with self.assertRaises(ValidationError), self.env.cr.savepoint():
            self.make_contact(tags=[self.foreign_tag])

    def test_a_branch_user_cannot_mix_companies_through_the_api(self):
        self.authenticate(self.branch_user.login, PASSWORD)
        body = {
            'name': 'x', 'channel_id': self.channel.id, 'template_id': self.template.id, 'audience_id': self.foreign_audience.id,
            'params': [FIRST_NAME], 'header_attachment_id': None, 'scheduled_at': None, 'send_within_hours': False, 'daily_cap': 0,
        }
        self.assertError(self.api('POST', f'{BASE}/campaigns', body), 422, 'invalid')
        self.assertError(self.api('POST', f'{BASE}/audiences', {
            'name': 'mixed', 'tag_ids': [self.foreign_tag.id], 'tag_match': 'any', 'exclude_tag_ids': [], 'active_within_days': 0,
        }), 422, 'invalid')
        contact = self.make_contact()
        self.assertError(self.api('PATCH', f'{BASE}/contacts/{contact.id}/marketing', {'tag_ids': [self.foreign_tag.id]}), 422, 'invalid')
        data = base64.b64encode(b'phone\n+966501119999\n').decode()
        self.assertError(self.api('POST', f'{BASE}/contacts/import', {
            'name': 'a.csv', 'data': data, 'tag_ids': [self.foreign_tag.id], 'consent': 'unknown'}), 422, 'invalid')

    def test_the_import_and_the_test_send_stay_inside_the_current_company(self):
        foreign = self.env['webvue.inbox.contact'].create({'name': 'Foreign', 'phone': '+966501118888', 'company_id': self.branch.id})
        self.env['webvue.inbox.contact.identity'].create({
            'contact_id': foreign.id, 'company_id': self.branch.id, 'channel_kind': 'whatsapp', 'address': '966501118888',
        })
        self.authenticate(self.branch_user.login, PASSWORD)
        data = base64.b64encode(b'phone,tags\n+966501118888,foreign\n+966501118888x,\n').decode()
        result = self.api('POST', f'{BASE}/contacts/import', {'name': 'a.csv', 'data': data, 'tag_ids': [], 'consent': 'unknown'}).json()
        self.assertEqual((result['created'], result['updated']), (0, 0))
        self.assertIn('unknown tag', result['errors'][0]['message'])
        plain = base64.b64encode(b'phone\n+966501118888\n').decode()
        result = self.api('POST', f'{BASE}/contacts/import', {'name': 'a.csv', 'data': plain, 'tag_ids': [], 'consent': 'unknown'}).json()
        self.assertEqual((result['created'], result['updated']), (1, 0))
        self.assertFalse(foreign.tag_ids)
        campaign = self.make_campaign()
        self.assertError(self.api('POST', f'{BASE}/campaigns/{campaign.id}/test', {'contact_id': foreign.id}), 422, 'invalid')


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignMedia(CampaignCase):

    def media_campaign(self):
        template = self.make_template(category='marketing', body='Hi {{1}}', header_type='image')
        attachment = self.env['ir.attachment'].create({
            'name': 'offer.png', 'raw': PNG, 'mimetype': 'image/png', 'res_model': 'webvue.inbox.campaign', 'res_id': 0,
        })
        return self.launched(template=template, header_attachment_id=attachment.id)

    def meta_with_media(self, uploads):
        sends = self.sending_meta()

        def answer(method, url, **kwargs):
            if url.endswith('/media'):
                uploads.append(url)
                return meta({'id': f'media-{len(uploads)}'})
            return sends(method, url, **kwargs)

        return answer

    def test_the_media_id_is_uploaded_again_after_25_days(self):
        self.make_contact()
        campaign = self.media_campaign()
        uploads = []
        with patch.object(requests, 'request', side_effect=self.meta_with_media(uploads)):
            self.run_campaigns()
            self.assertEqual((campaign.header_media_id, len(uploads)), ('media-1', 1))
            campaign.header_media_uploaded_at = fields.Datetime.now() - timedelta(days=24)
            campaign._webvue_header_media()
            self.assertEqual(len(uploads), 1)
            campaign.header_media_uploaded_at = fields.Datetime.now() - timedelta(days=26)
            campaign._webvue_header_media()
        self.assertEqual((campaign.header_media_id, len(uploads)), ('media-2', 2))
        self.assertGreater(campaign.header_media_uploaded_at, fields.Datetime.now() - timedelta(minutes=5))

    def test_media_error_codes_release_the_recipient_and_upload_the_file_again(self):
        contact = self.make_contact()
        campaign = self.media_campaign()
        uploads = []
        with patch.object(requests, 'request', side_effect=self.meta_with_media(uploads)):
            self.run_campaigns()
            self.env[Message]._webvue_run_outbox()
            recipient = self.recipient_of(campaign, contact)
            self.assertEqual(recipient.state, 'sent')
            for code in (131052, 131053):
                self.fail_status(recipient.message_id, code, 'media')
                self.assertEqual((recipient.state, recipient.failure, campaign.state, campaign.header_media_id), ('pending', False, 'running', False), code)
                self.run_campaigns()
                self.env[Message]._webvue_run_outbox()
                self.assertEqual(recipient.state, 'sent', code)
        self.assertEqual(len(uploads), 3)


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignRetention(CampaignCase):

    def setUp(self):
        super().setUp()
        self.cutoff = fields.Datetime.now() + timedelta(minutes=1)
        self.purge = lambda cutoff=None: self.env['webvue.inbox.campaign']._webvue_purge_marketing(self.env.company, cutoff or self.cutoff)

    def finished(self, contacts=1):
        for _ in range(contacts):
            self.make_contact()
        campaign = self.launched()
        self.dispatch_all(campaign)
        for recipient in campaign.recipient_ids:
            recipient.message_id.delivery_state = 'read'
        self.deliver_from(campaign.recipient_ids[0].contact_id, 'thanks')
        self.run_campaigns()
        self.assertEqual(campaign.state, 'done')
        return campaign

    def test_the_outcome_of_a_recipient_outlives_its_message(self):
        campaign = self.finished()
        recipient = campaign.recipient_ids
        recipient.message_id.unlink()
        self.assertEqual((recipient.state, recipient.outcome, bool(recipient.sent_at), bool(recipient.replied_at)), ('read', 'read', True, True))
        self.run_campaigns()
        self.assertEqual(campaign.state, 'done')
        self.assertEqual(self.env['webvue.inbox.campaign']._webvue_stats(campaign)[campaign.id]['read'], 1)

    def test_a_failure_is_frozen_with_its_code_and_text(self):
        self.make_contact()
        campaign = self.launched()
        self.dispatch_all(campaign)
        recipient = campaign.recipient_ids
        self.fail_status(recipient.message_id, 131049, 'Per-user limit')
        recipient.message_id.unlink()
        self.assertEqual((recipient.state, recipient.failure, recipient.error_code, recipient.error), ('failed', 'frequency_capped', 131049, 'Per-user limit'))

    def test_a_finished_campaign_loses_its_recipients_but_keeps_its_statistics(self):
        campaign = self.finished(2)
        live = self.env['webvue.inbox.campaign']._webvue_stats(campaign)[campaign.id]
        campaign.completed_at = fields.Datetime.now() - timedelta(days=800)
        self.purge(fields.Datetime.now() - timedelta(days=700))
        self.assertEqual((campaign.stats_frozen, len(campaign.recipient_ids)), (True, 0))
        self.assertEqual(self.env['webvue.inbox.campaign']._webvue_stats(campaign)[campaign.id], live)
        self.assertEqual(live['read'] + live['skipped'], live['total'])
        self.purge(fields.Datetime.now() - timedelta(days=700))
        self.assertEqual(self.env['webvue.inbox.campaign']._webvue_stats(campaign)[campaign.id], live)

    def test_a_running_campaign_is_never_purged(self):
        self.make_contact()
        campaign = self.launched()
        self.run_campaigns()
        self.purge()
        self.assertEqual((campaign.stats_frozen, len(campaign.recipient_ids)), (False, 1))
        self.assertTrue(campaign.recipient_ids.contact_id.exists())

    def test_contacts_past_the_window_are_deleted_and_an_opted_out_one_is_reduced_to_a_suppression_record(self):
        plain = self.make_contact(name='Plain Contact')
        recent = self.make_contact(name='Recent Contact')
        out = self.make_contact(name='Opted Out', email='out@example.com', tags=[self.tag])
        out._webvue_record_consent('opted_out', 'keyword', note='stop')
        address = out.identity_ids.address
        old = fields.Datetime.now() - timedelta(days=90)
        (plain | out).write({'last_activity_at': old})
        (plain | out).consent_ids.write({'date': old})
        recent.last_activity_at = fields.Datetime.now()
        self.purge(fields.Datetime.now() - timedelta(days=30))
        self.assertFalse(plain.exists())
        self.assertTrue(recent.exists())
        self.assertEqual((out.name, out.phone, out.email, out.tag_ids.ids, out.identity_ids.address), (out.phone, f'+{address}', False, [], address))
        self.assertEqual((out.marketing_consent, len(out.consent_ids), out.consent_ids.note), ('opted_out', 1, False))
        self.purge(fields.Datetime.now() - timedelta(days=30))
        self.assertEqual(len(out.consent_ids), 1)

    def test_a_recent_consent_decision_or_a_live_recipient_keeps_a_contact(self):
        decided = self.make_contact()
        decided.last_activity_at = fields.Datetime.now() - timedelta(days=90)
        targeted = self.make_contact(consent=None)
        targeted.last_activity_at = fields.Datetime.now() - timedelta(days=90)
        self.launched()
        self.run_campaigns()
        self.purge(fields.Datetime.now() - timedelta(days=30))
        self.assertTrue(decided.exists() and targeted.exists())

    def test_the_maintenance_cron_applies_the_company_retention_window(self):
        old = self.make_contact(consent=None)
        old.last_activity_at = fields.Datetime.now() - timedelta(days=60)
        fresh = self.make_contact(consent=None)
        self.settings.retention_months = 1
        self.env['webvue.inbox.conversation']._webvue_run_maintenance()
        self.assertEqual((old.exists().id, fresh.exists().id), (False, fresh.id))
        self.settings.retention_months = 24

    def test_an_import_counts_as_activity(self):
        contact = self.make_contact(consent=None, address='966501117777')
        contact.last_activity_at = fields.Datetime.now() - timedelta(days=90)
        self.login(self.campaigns_only)
        data = base64.b64encode(b'phone\n+966501117777\n').decode()
        self.api('POST', f'{BASE}/contacts/import', {'name': 'a.csv', 'data': data, 'tag_ids': [], 'consent': 'unknown'})
        self.purge(fields.Datetime.now() - timedelta(days=30))
        self.assertTrue(contact.exists())


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignRobustness(CampaignCase):

    def test_an_unknown_dispatch_error_is_retried_then_the_recipient_is_skipped(self):
        contact = self.make_contact()
        campaign = self.launched()
        with patch.object(type(campaign), '_webvue_queue', side_effect=RuntimeError('boom')):
            self.run_campaigns()
            recipient = self.recipient_of(campaign, contact)
            self.assertEqual((recipient.state, recipient.dispatch_attempts), ('pending', 1))
            self.run_campaigns(2)
        self.assertEqual((recipient.state, recipient.skip_reason, recipient.dispatch_attempts), ('skipped', 'invalid_number', 3))

    def test_a_known_refusal_skips_the_recipient_at_once(self):
        contact = self.make_contact()
        campaign = self.launched()
        with patch.object(type(campaign), '_webvue_queue', side_effect=ValidationError('closed')):
            self.run_campaigns()
        self.assertEqual(self.recipient_of(campaign, contact).skip_reason, 'invalid_number')

    def test_a_limit_reached_mid_batch_leaves_the_recipient_pending(self):
        contact = self.make_contact()
        campaign = self.launched()
        with patch.object(type(campaign), '_webvue_queue', side_effect=WebVueAccessRule('feature_not_included', 'limit', status=403)):
            self.run_campaigns()
        recipient = self.recipient_of(campaign, contact)
        self.assertEqual((recipient.state, recipient.dispatch_attempts), ('pending', 0))

    def test_a_campaign_that_keeps_failing_pauses_instead_of_failing_forever(self):
        self.make_contact()
        campaign = self.launched()
        with patch.object(type(campaign), '_webvue_prepare', side_effect=RuntimeError('boom')):
            self.run_campaigns(2)
            self.assertEqual((campaign.state, campaign.prepare_failures), ('running', 2))
            self.run_campaigns()
        self.assertEqual((campaign.state, campaign.pause_reason, campaign.prepare_failures), ('paused', 'token', 0))
        self.assertIn('RuntimeError', campaign.pause_detail)

    def test_a_successful_step_resets_the_failure_count(self):
        self.make_contact()
        campaign = self.launched()
        with patch.object(type(campaign), '_webvue_prepare', side_effect=RuntimeError('boom')):
            self.run_campaigns()
        self.assertEqual(campaign.prepare_failures, 1)
        self.run_campaigns()
        self.assertEqual(campaign.prepare_failures, 0)

    def test_an_unreadable_csv_and_a_long_name_are_handled(self):
        self.login(self.campaigns_only)
        broken = base64.b64encode(b'phone\n"+9665').decode()
        response = self.api('POST', f'{BASE}/contacts/import', {'name': 'a.csv', 'data': broken, 'tag_ids': [], 'consent': 'unknown'})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json().get('field'), 'data')
        long_name = base64.b64encode(('phone,name\n+966501116666,' + 'n' * 400 + '\n').encode()).decode()
        self.api('POST', f'{BASE}/contacts/import', {'name': 'a.csv', 'data': long_name, 'tag_ids': [], 'consent': 'unknown'})
        contact = self.env['webvue.inbox.contact.identity'].search([('address', '=', '966501116666')]).contact_id
        self.assertEqual(len(contact.name), 255)

    def test_the_channel_references_pair_each_capability_with_its_feature(self):
        path = f'{BASE}/automation/channels'

        def ids(user):
            self.login(user)
            return [item['id'] for item in self.get(path).json()['items']]

        self.assertIn(self.channel.id, ids(self.automation_user))
        self.assertIn(self.channel.id, ids(self.campaigns_only))
        set_probe_feature(self, key='inbox.campaigns', enabled=False)
        self.assertIn(self.channel.id, ids(self.automation_user))
        self.assertEqual(ids(self.campaigns_only), [])
        set_probe_feature(self, key='inbox.campaigns', enabled=True)
        set_probe_feature(self, key='inbox.automation', enabled=False)
        self.assertEqual(ids(self.automation_user), [])
        self.assertIn(self.channel.id, ids(self.campaigns_only))

    def test_a_campaigns_only_role_cannot_reply_note_assign_or_read_conversations(self):
        conversation = self.make_conversation()
        self.login(self.campaigns_only)
        base = f'{BASE}/conversations/{conversation.id}'
        for method, path, body in (
            ('GET', base, None), ('GET', f'{base}/messages', None), ('POST', f'{base}/messages', {'body': 'hi'}),
            ('POST', f'{base}/notes', {'body': 'note'}), ('PATCH', base, {'priority': 'high'}), ('POST', f'{base}/read', None),
            ('GET', f'{BASE}/conversations', None), ('GET', f'{BASE}/channels', None),
        ):
            with self.subTest(method=method, path=path):
                self.assertError(self.api(method, path, body), 403, 'forbidden')
