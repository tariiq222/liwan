# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .campaign_common import (
    AUDIENCE_KEYS,
    BASE,
    CAMPAIGN_KEYS,
    FIRST_NAME,
    RECIPIENT_KEYS,
    STATS_KEYS,
    CampaignCase,
)
from .media_samples import PDF, PNG
from odoo.addons.webvue_api.tests.common import set_probe_feature

UTC = '%Y-%m-%dT%H:%M:%SZ'


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignsApi(CampaignCase):

    def setUp(self):
        super().setUp()
        self.login(self.campaigns_only)

    def body(self, **overrides):
        return {
            'name': 'Spring offer', 'channel_id': self.channel.id, 'template_id': self.template.id, 'audience_id': self.audience.id,
            'params': [FIRST_NAME], 'header_attachment_id': None, 'scheduled_at': None, 'send_within_hours': False,
            'daily_cap': 0, **overrides,
        }

    def create(self, **overrides):
        response = self.api('POST', f'{BASE}/campaigns', self.body(**overrides))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def invalid(self, response, field=None):
        self.assertError(response, 422, 'invalid')
        if field:
            self.assertEqual(response.json().get('field'), field)

    # reading and writing

    def test_create_read_list_and_filter(self):
        created = self.create()
        self.assertEqual(set(created), CAMPAIGN_KEYS)
        self.assertEqual(set(created['stats']), STATS_KEYS)
        self.assertEqual(
            (created['state'], created['params'], created['can_edit'], created['can_delete'], created['template']['category']),
            ('draft', [FIRST_NAME], True, True, 'marketing'),
        )
        self.assertEqual(self.get(f'{BASE}/campaigns/{created["id"]}').json(), created)
        listing = self.get(f'{BASE}/campaigns?state=draft&q=spring&channel_id={self.channel.id}').json()
        self.assertEqual((listing['total'], [item['id'] for item in listing['items']]), (1, [created['id']]))
        self.assertEqual(self.get(f'{BASE}/campaigns?state=done').json(), {'items': [], 'total': 0})
        self.invalid(self.get(f'{BASE}/campaigns?state=bogus'), 'state')

    def test_patch_a_draft(self):
        created = self.create()
        patched = self.api('PATCH', f'{BASE}/campaigns/{created["id"]}', {'name': 'Renamed', 'daily_cap': 50}).json()
        self.assertEqual((patched['name'], patched['daily_cap']), ('Renamed', 50))
        self.invalid(self.api('PATCH', f'{BASE}/campaigns/{created["id"]}', {}))
        self.invalid(self.api('PATCH', f'{BASE}/campaigns/{created["id"]}', {'state': 'running'}), 'state')

    def test_every_invalid_write_answers_422_naming_the_field(self):
        authentication = self.make_template(category='authentication', body='Code {{1}}')
        location = self.make_template(category='marketing', body='Hi', header_type='location')
        elsewhere = self.make_template(channel=self.make_channel(phone_id='100000000055'), category='marketing', body='Hi {{1}}')
        past = (fields.Datetime.now() - timedelta(hours=1)).strftime(UTC)
        cases = [
            ({'params': []}, 'params'),
            ({'params': [FIRST_NAME, {**FIRST_NAME, 'position': 2}]}, 'params'),
            ({'params': [{**FIRST_NAME, 'source': 'static', 'value': None}]}, 'params'),
            ({'params': [{**FIRST_NAME, 'location': 'footer'}]}, 'location'),
            ({'template_id': authentication.id, 'params': [FIRST_NAME]}, 'template_id'),
            ({'template_id': location.id, 'params': []}, 'template_id'),
            ({'template_id': elsewhere.id}, 'template_id'),
            ({'template_id': 999999999}, 'template_id'),
            ({'channel_id': 999999999}, 'channel_id'),
            ({'audience_id': 999999999}, 'audience_id'),
            ({'scheduled_at': past}, 'scheduled_at'),
            ({'scheduled_at': '2030-01-01 10:00'}, 'scheduled_at'),
            ({'daily_cap': -1}, 'daily_cap'),
            ({'send_within_hours': 'yes'}, 'send_within_hours'),
            ({'name': ''}, 'name'),
            ({'header_attachment_id': 999999999}, 'header_attachment_id'),
        ]
        for overrides, field in cases:
            with self.subTest(overrides=overrides):
                self.invalid(self.api('POST', f'{BASE}/campaigns', self.body(**overrides)), field)
        missing = self.body()
        del missing['audience_id']
        self.invalid(self.api('POST', f'{BASE}/campaigns', missing), 'audience_id')

    def test_a_new_template_needs_its_own_params(self):
        created = self.create()
        other = self.make_template(category='marketing', body='{{1}} and {{2}}')
        self.invalid(self.api('PATCH', f'{BASE}/campaigns/{created["id"]}', {'template_id': other.id}), 'params')
        patched = self.api('PATCH', f'{BASE}/campaigns/{created["id"]}', {
            'template_id': other.id, 'params': [FIRST_NAME, {**FIRST_NAME, 'position': 2}],
        })
        self.assertEqual(patched.json()['template']['id'], other.id)

    def test_what_can_change_depends_on_the_state(self):
        campaign = self.make_campaign()
        path = f'{BASE}/campaigns/{campaign.id}'
        self.make_contact()
        campaign.action_launch()
        self.invalid(self.api('PATCH', path, {'name': 'x'}))
        campaign.action_pause()
        self.invalid(self.api('PATCH', path, {'channel_id': self.channel.id}), 'channel_id')
        done = self.api('PATCH', path, {'name': 'Paused rename', 'daily_cap': 5, 'send_within_hours': True})
        self.assertEqual((done.status_code, done.json()['name'], done.json()['can_edit']), (200, 'Paused rename', True))

    def test_delete_only_while_nothing_was_dispatched(self):
        self.make_contact()
        campaign = self.make_campaign()
        self.assertEqual(self.api('DELETE', f'{BASE}/campaigns/{self.create()["id"]}').status_code, 204)
        campaign.action_launch()
        self.run_campaigns()
        self.invalid(self.api('DELETE', f'{BASE}/campaigns/{campaign.id}'))
        self.assertFalse(self.get(f'{BASE}/campaigns/{campaign.id}').json()['can_delete'])

    # launch and the lifecycle

    def test_launch_preflight_names_each_problem(self):
        self.make_contact()
        path = lambda campaign: f'{BASE}/campaigns/{campaign.id}/launch'  # noqa: E731
        paused = self.make_template(category='marketing', status='paused', body='Hi {{1}}')
        for label, campaign in (
            ('template not approved', self.make_campaign(template=paused)),
            ('empty audience', self.make_campaign(audience=self.env['webvue.inbox.audience'].create({
                'name': 'Nobody', 'tag_ids': [(6, 0, self.tag.ids)]}))),
            ('no params', self.make_campaign(params=())),
            ('past schedule', self.make_campaign(scheduled_at=fields.Datetime.now() - timedelta(minutes=5))),
            ('no header file', self.make_campaign(template=self.make_template(category='marketing', body='Hi {{1}}', header_type='image'))),
        ):
            with self.subTest(label):
                self.invalid(self.api('POST', path(campaign), {}))
        self.channel.state = 'error'
        self.invalid(self.api('POST', path(self.make_campaign()), {}))
        self.channel.state = 'connected'

    def test_launch_pause_resume_cancel_over_the_api(self):
        self.make_contact()
        campaign = self.make_campaign()
        path = f'{BASE}/campaigns/{campaign.id}'
        self.invalid(self.api('POST', f'{path}/pause', {}))
        self.assertEqual(self.api('POST', f'{path}/launch', {}).json()['state'], 'running')
        self.invalid(self.api('POST', f'{path}/launch', {}))
        self.assertEqual(self.api('POST', f'{path}/pause', {}).json()['pause_reason'], 'manual')
        self.assertEqual(self.api('POST', f'{path}/resume', {}).json()['state'], 'running')
        self.invalid(self.api('POST', f'{path}/retry', {}))
        self.invalid(self.api('POST', f'{path}/cancel', {'x': 1}))
        cancelled = self.api('POST', f'{path}/cancel', {}).json()
        self.assertEqual((cancelled['state'], cancelled['completed_at'] is not None, cancelled['can_edit']), ('cancelled', True, False))

    def test_a_scheduled_launch_waits(self):
        self.make_contact()
        later = (fields.Datetime.now() + timedelta(hours=3)).strftime(UTC)
        campaign = self.api('POST', f'{BASE}/campaigns', self.body(scheduled_at=later)).json()
        launched = self.api('POST', f'{BASE}/campaigns/{campaign["id"]}/launch', {}).json()
        self.assertEqual((launched['state'], launched['waiting'], launched['scheduled_at']), ('scheduled', 'schedule', later))

    def test_recipients_are_listed_with_their_state_and_filters(self):
        sent = self.make_contact(name='Sara Sent')
        self.make_contact(consent=None, name='Omar Unknown')
        campaign = self.launched()
        self.run_campaigns()
        listing = self.get(f'{BASE}/campaigns/{campaign.id}/recipients').json()
        self.assertEqual(listing['total'], 2)
        self.assertEqual(set(listing['items'][0]), RECIPIENT_KEYS)
        queued = self.get(f'{BASE}/campaigns/{campaign.id}/recipients?state=queued').json()['items']
        self.assertEqual([item['contact']['id'] for item in queued], [sent.id])
        self.assertEqual(queued[0]['conversation_id'], self.recipient_of(campaign, sent).message_id.conversation_id.id)
        skipped = self.get(f'{BASE}/campaigns/{campaign.id}/recipients?state=skipped&q=omar').json()['items']
        self.assertEqual([item['skip_reason'] for item in skipped], ['no_consent'])
        self.invalid(self.get(f'{BASE}/campaigns/{campaign.id}/recipients?failure=bogus'), 'failure')
        stats = self.get(f'{BASE}/campaigns/{campaign.id}').json()['stats']
        self.assertEqual((stats['total'], stats['queued'], stats['skipped']), (2, 1, 1))

    def test_the_test_send_goes_to_one_contact_and_is_not_a_recipient(self):
        contact = self.make_contact()
        campaign = self.make_campaign()
        result = self.api('POST', f'{BASE}/campaigns/{campaign.id}/test', {'contact_id': contact.id})
        self.assertEqual(result.status_code, 200, result.text)
        message = self.env['webvue.inbox.message'].browse(result.json()['message_id'])
        self.assertEqual((message.body, message.conversation_id.id, message.conversation_id.state), (
            'Hello Sara', result.json()['conversation_id'], 'resolved'))
        self.assertFalse(campaign.recipient_ids)
        unknown = self.make_contact(consent=None)
        self.invalid(self.api('POST', f'{BASE}/campaigns/{campaign.id}/test', {'contact_id': unknown.id}))
        self.invalid(self.api('POST', f'{BASE}/campaigns/{campaign.id}/test', {}), 'contact_id')

    def test_the_preview_renders_a_sample_contact_and_lists_missing_values(self):
        contact = self.make_contact(name='Layla Hassan')
        template = self.make_template(
            category='marketing', header_type='text', header_text='Hi {{1}}', body='Dear {{1}}, code {{2}}', footer='Bye',
            button_ids=[{'kind': 'quick_reply', 'text': 'Yes'}, {'kind': 'url', 'text': 'Open', 'url': 'https://x.example/{{1}}', 'example': 'https://x.example/a'}],
        )
        params = [
            {'location': 'header', 'position': 1, 'source': 'contact_first_name', 'value': None},
            {'location': 'body', 'position': 1, 'source': 'contact_name', 'value': None},
            {'location': 'body', 'position': 2, 'source': 'contact_email', 'value': None},
            {'location': 'button', 'position': 1, 'source': 'static', 'value': 'abc'},
        ]
        preview = self.api('POST', f'{BASE}/campaigns/preview', {'template_id': template.id, 'params': params, 'contact_id': contact.id}).json()
        self.assertEqual(preview['contact'], {'id': contact.id, 'name': 'Layla Hassan'})
        self.assertEqual((preview['header_text'], preview['body'], preview['footer']), ('Hi Layla', 'Dear Layla Hassan, code {{2}}', 'Bye'))
        self.assertEqual(preview['missing'], [{'location': 'body', 'position': 2}])
        self.assertEqual(preview['buttons'], [{'type': 'quick_reply', 'text': 'Yes'}, {'type': 'url', 'text': 'Open'}])
        anonymous = self.api('POST', f'{BASE}/campaigns/preview', {'template_id': template.id, 'params': params}).json()
        self.assertEqual(anonymous['contact'], None)

    def test_the_header_upload_and_a_campaign_with_a_media_template(self):
        template = self.make_template(category='marketing', body='Hi {{1}}', header_type='image')
        upload = self.api('POST', f'{BASE}/campaigns/uploads', {
            'name': 'offer.png', 'mimetype': 'image/png', 'data': base64.b64encode(PNG).decode()})
        self.assertEqual(upload.status_code, 201, upload.text)
        attachment_id = upload.json()['id']
        created = self.create(template_id=template.id, header_attachment_id=attachment_id)
        self.assertEqual(created['header_attachment']['id'], attachment_id)
        attachment = self.env['ir.attachment'].browse(attachment_id)
        self.assertEqual((attachment.res_model, attachment.res_id), ('webvue.inbox.campaign', created['id']))
        pdf = self.api('POST', f'{BASE}/campaigns/uploads', {'name': 'a.pdf', 'mimetype': 'application/pdf', 'data': base64.b64encode(PDF).decode()})
        self.invalid(self.api('POST', f'{BASE}/campaigns', self.body(
            template_id=template.id, header_attachment_id=pdf.json()['id'])), 'header_attachment_id')
        self.invalid(self.api('POST', f'{BASE}/campaigns', self.body(header_attachment_id=attachment_id)), 'header_attachment_id')
        text = self.api('POST', f'{BASE}/campaigns/uploads', {'name': 'a.txt', 'mimetype': 'text/plain', 'data': base64.b64encode(b'hello').decode()})
        self.invalid(text, 'data')

    # audiences

    def test_audience_crud_counts_and_members(self):
        vip = self.make_contact(tags=[self.tag])
        self.make_contact(tags=[self.tag, self.other_tag])
        self.make_contact(consent=None)
        body = {'name': 'VIP only', 'tag_ids': [self.tag.id], 'tag_match': 'all', 'exclude_tag_ids': [self.other_tag.id], 'active_within_days': 0}
        created = self.api('POST', f'{BASE}/audiences', body)
        self.assertEqual(created.status_code, 201, created.text)
        audience = created.json()
        self.assertEqual(set(audience), AUDIENCE_KEYS)
        self.assertEqual((audience['contact_count'], audience['reachable_count']), (1, 1))
        everyone = self.get(f'{BASE}/audiences/{self.audience.id}').json()
        self.assertEqual((everyone['contact_count'], everyone['reachable_count']), (3, 2))
        members = self.get(f'{BASE}/audiences/{audience["id"]}/members').json()
        self.assertEqual([member['id'] for member in members['items']], [vip.id])
        unknown = self.get(f'{BASE}/audiences/{self.audience.id}/members?consent=unknown').json()
        self.assertEqual(unknown['total'], 1)
        self.assertEqual(self.api('PATCH', f'{BASE}/audiences/{audience["id"]}', {'tag_match': 'any'}).json()['tag_match'], 'any')
        self.invalid(self.api('POST', f'{BASE}/audiences', body), 'name')
        self.invalid(self.api('POST', f'{BASE}/audiences', {**body, 'name': 'x', 'tag_match': 'some'}), 'tag_match')
        self.invalid(self.api('POST', f'{BASE}/audiences', {**body, 'name': 'y', 'active_within_days': 9999}), 'active_within_days')
        self.invalid(self.api('POST', f'{BASE}/audiences', {**body, 'name': 'z', 'tag_ids': [999999999]}), 'tag_ids')

    def test_activity_window_and_deleting_a_used_audience(self):
        active = self.make_conversation(channel=self.channel, minutes_ago=60)
        old = self.make_conversation(channel=self.channel, minutes_ago=60 * 24 * 40)
        audience = self.env['webvue.inbox.audience'].create({'name': 'Active', 'active_within_days': 7})
        self.assertEqual(self.env['webvue.inbox.contact'].search(audience._webvue_contact_domain()), active.contact_id)
        self.assertNotIn(old.contact_id, self.env['webvue.inbox.contact'].search(audience._webvue_contact_domain()))
        self.make_campaign(audience=audience)
        self.invalid(self.api('DELETE', f'{BASE}/audiences/{audience.id}'))
        free = self.env['webvue.inbox.audience'].create({'name': 'Free'})
        self.assertEqual(self.api('DELETE', f'{BASE}/audiences/{free.id}').status_code, 204)

    # access

    def test_the_capability_alone_reaches_the_campaign_pages_and_their_lookups(self):
        for path in (
            f'{BASE}/campaigns', f'{BASE}/audiences', f'{BASE}/channels/{self.channel.id}/ref',
            f'{BASE}/channels/{self.channel.id}/templates', f'{BASE}/templates/{self.template.id}', f'{BASE}/tags',
            f'{BASE}/channels/{self.channel.id}/sending', '/api/v1/settings/inbox/campaigns',
        ):
            with self.subTest(path=path):
                self.assertEqual(self.get(path).status_code, 200, path)
        self.assertEqual(self.get(f'{BASE}/conversations').status_code, 403)
        self.assertEqual(self.get(f'{BASE}/channels').status_code, 403)

    def test_a_campaigns_only_role_lists_its_channels_as_references(self):
        listing = self.get(f'{BASE}/automation/channels')
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertIn({'id': self.channel.id, 'name': self.channel.name}, listing.json()['items'])
        self.login(self.agent)
        self.assertError(self.get(f'{BASE}/automation/channels'), 403, 'forbidden')

    def test_an_agent_without_the_capability_is_refused(self):
        self.login(self.agent)
        campaign = self.make_campaign()
        for path in (f'{BASE}/campaigns', f'{BASE}/audiences', f'{BASE}/campaigns/{campaign.id}', '/api/v1/settings/inbox/campaigns'):
            self.assertError(self.get(path), 403, 'forbidden')
        self.assertError(self.api('POST', f'{BASE}/campaigns', self.body()), 403, 'forbidden')
        self.assertError(self.api('POST', f'{BASE}/contacts/import', {}), 403, 'forbidden')
        self.assertEqual(self.get(f'{BASE}/tags').status_code, 200)

    def test_the_sub_feature_gates_every_route(self):
        set_probe_feature(self, key='inbox.campaigns', enabled=False)
        for path in (f'{BASE}/campaigns', f'{BASE}/audiences', '/api/v1/settings/inbox/campaigns'):
            response = self.get(path)
            self.assertError(response, 403, 'feature_not_included')
        self.assertEqual(self.get(f'{BASE}/tags').status_code, 200)

    def test_a_campaign_of_another_company_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other company'})
        foreign = self.env['webvue.inbox.campaign'].create({
            'name': 'Foreign', 'company_id': other.id, 'channel_id': self.channel.id, 'template_id': self.template.id,
            'audience_id': self.audience.id,
        })
        self.assertError(self.get(f'{BASE}/campaigns/{foreign.id}'), 404, 'not_found')
        self.assertError(self.api('POST', f'{BASE}/campaigns/{foreign.id}/launch', {}), 404, 'not_found')
        self.assertNotIn(foreign.id, [item['id'] for item in self.get(f'{BASE}/campaigns').json()['items']])

    def test_a_message_of_a_campaign_carries_its_label_in_the_thread(self):
        contact = self.make_contact()
        campaign = self.launched()
        self.run_campaigns()
        conversation = self.recipient_of(campaign, contact).message_id.conversation_id
        self.login(self.agent)
        conversation.assignee_id = self.agent
        messages = self.get(f'{BASE}/conversations/{conversation.id}/messages').json()['items']
        self.assertEqual(messages[-1]['campaign'], {'id': campaign.id, 'name': campaign.name})
        self.assertEqual(messages[-1]['template']['name'], self.template.name)
