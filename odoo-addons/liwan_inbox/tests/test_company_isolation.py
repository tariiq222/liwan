# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the Inbox GET record, list, export and attachment routes."""
import base64
import csv
import io
import json
import os
import time
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import new_test_user, tagged

from . import tiktok_payloads as tt
from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
    set_probe_feature,
)
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE
from odoo.addons.liwan_inbox.models.secret_box import KEY_ENV
from odoo.addons.liwan_inbox.tests.common import ACCESS_TOKEN, APP_SECRET, store_event

EXPECTED_GET_RECORD_ROUTES = 29
PASSWORD = 'iso_inbox_nocap_pass_123'
PROFILE = {'about': 'About', 'address': None, 'description': None, 'email': None, 'websites': [], 'vertical': None}
PREVIEW = {'url': 'https://business.facebook.com/wa/manage/flows/preview/abc', 'expires_at': fields.Datetime.now()}
# Visible and hidden company tags per session company. iso_user holds the inbox manager role in the parent
# and both branches, so a parent session reads its branches; a branch session never reads the parent or a
# sibling, and the independent company C is hidden from every other session.
MATRIX = (
    ('p', ('p', 'p1', 'p2'), ('c',)),
    ('p1', ('p1',), ('p', 'p2', 'c')),
    ('p2', ('p2',), ('p', 'p1', 'c')),
    ('c', ('c',), ('p', 'p1', 'p2')),
)


@tagged('post_install', '-at_install', 'liwan')
class TestInboxCompanyIsolation(CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {KEY_ENV: base64.urlsafe_b64encode(os.urandom(32)).decode()})
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)
        # The two routes that read Meta live answer from these stubs; a hidden record must never reach them.
        for name, value in (('get_business_profile', PROFILE), ('flow_preview', PREVIEW)):
            meta_patch = patch.object(whatsapp, name, return_value=value)
            setattr(cls, f'meta_{name}', meta_patch.start())
            cls.addClassCleanup(meta_patch.stop)
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['liwan.access.assignment'].sudo()
        manager = cls.env.ref('liwan_inbox.role_inbox_manager')
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': manager.id, 'company_id': company.id})
        cls.no_cap = new_test_user(
            cls.env, login='iso_inbox_nocap', password=PASSWORD, name='No inbox',
            groups='liwan_core.group_employee', company_id=cls.company_p.id,
        )
        cls.no_cap.company_ids = [(6, 0, [cls.company_p.id])]
        Assignment.create({
            'user_id': cls.no_cap.id, 'role_id': cls.env.ref('liwan_core.role_employee').id,
            'company_id': cls.company_p.id,
        })
        Channel = cls.env['liwan.inbox.channel']
        cls.recs = {}
        for i, (tag, company) in enumerate(cls.by_tag.items(), start=1):
            channel = Channel.create({
                'name': f'Channel {tag}', 'phone_number_id': f'90000000{i:04d}', 'business_account_id': '200000000001',
                'state': 'connected', 'owner_company_id': company.id,
                **Channel._liwan_secret_values(access_token=ACCESS_TOKEN, app_secret=APP_SECRET),
            })
            contact = cls.env['liwan.inbox.contact'].create({
                'name': f'Customer {tag.upper()}', 'phone': f'+96650000{i:04d}', 'company_id': company.id,
            })
            identity = cls.env['liwan.inbox.contact.identity'].create({
                'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': f'96650000{i:04d}',
                'company_id': company.id,
            })
            conversation = cls.env['liwan.inbox.conversation'].create({
                'channel_id': channel.id, 'contact_id': contact.id, 'identity_id': identity.id,
                'company_id': company.id,
            })
            message = cls.env['liwan.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': company.id, 'direction': 'in',
                'body': f'Hello {tag}', 'delivery_state': 'received',
            })
            attachment = cls.env['ir.attachment'].create({
                'name': f'file-{tag}.txt', 'datas': base64.b64encode(b'x'), 'res_model': message._name,
                'res_id': message.id,
            })
            template = cls.env['liwan.inbox.template'].create({
                'channel_id': channel.id, 'company_id': company.id, 'name': f'tpl_{tag}', 'language': 'ar', 'status': 'approved', 'body': 'x',
            })
            flow = cls.env['liwan.inbox.flow'].create({
                'channel_id': channel.id, 'name': f'Form {tag}', 'status': 'published', 'health': 'available',
                'provider_flow_id': f'80000000{i:04d}',
            })
            answer = cls.env['liwan.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': company.id, 'direction': 'in', 'kind': 'flow_response',
                'body': f'Form answer {tag}', 'delivery_state': 'received',
            })
            cls.env['liwan.inbox.flow.submission'].create({
                'conversation_id': conversation.id, 'flow_id': flow.id, 'message_id': answer.id, 'submitted_at': answer.date,
            })
            audience = cls.env['liwan.inbox.audience'].create({'name': f'Audience {tag}', 'company_id': company.id})
            campaign = cls.env['liwan.inbox.campaign'].create({
                'name': f'Campaign {tag}', 'company_id': company.id, 'channel_id': channel.id, 'template_id': template.id,
                'audience_id': audience.id,
            })
            cls.env['liwan.inbox.campaign.recipient'].create({
                'campaign_id': campaign.id, 'contact_id': contact.id, 'address': identity.address,
            })
            cls.env['liwan.inbox.channel.alert'].create({
                'owner_company_id': company.id, 'channel_id': channel.id, 'kind': 'quality_changed', 'severity': 'info',
            })
            cls.env['liwan.inbox.report.day'].create({
                'company_id': company.id, 'day': fields.Date.today(), 'channel_id': channel.id, 'messages_in': 1,
                'computed_at': fields.Datetime.now(),
            })
            cls.recs[tag] = {
                'template': template, 'channel': channel, 'contact': contact, 'conversation': conversation, 'message': message,
                'attachment': attachment, 'flow': flow, 'audience': audience, 'campaign': campaign,
                'rule': cls.env['liwan.inbox.rule'].create({'name': f'Rule {tag}', 'company_id': company.id}),
                'department': cls.env['liwan.inbox.department'].create({'name': f'Department {tag}', 'company_id': company.id}),
            }

    @staticmethod
    def paths(rec):
        return {
            'channel': f'/api/v1/inbox/channels/{rec["channel"].id}',
            'ref': f'/api/v1/inbox/channels/{rec["channel"].id}/ref',
            'templates': f'/api/v1/inbox/channels/{rec["channel"].id}/templates',
            'template': f'/api/v1/inbox/templates/{rec["template"].id}',
            'conversation': f'/api/v1/inbox/conversations/{rec["conversation"].id}',
            'messages': f'/api/v1/inbox/conversations/{rec["conversation"].id}/messages',
            'contact': f'/api/v1/inbox/contacts/{rec["contact"].id}',
            'download': f'/api/v1/inbox/messages/{rec["message"].id}/attachments/{rec["attachment"].id}/download',
            'audience': f'/api/v1/inbox/audiences/{rec["audience"].id}',
            'members': f'/api/v1/inbox/audiences/{rec["audience"].id}/members',
            'department_hours': f'/api/v1/inbox/departments/{rec["department"].id}/working-hours',
            'automation': f'/api/v1/inbox/channels/{rec["channel"].id}/automation',
            'rule': f'/api/v1/inbox/rules/{rec["rule"].id}',
            'campaign': f'/api/v1/inbox/campaigns/{rec["campaign"].id}',
            'recipients': f'/api/v1/inbox/campaigns/{rec["campaign"].id}/recipients',
            'alerts': f'/api/v1/inbox/channels/{rec["channel"].id}/alerts',
            'profile': f'/api/v1/inbox/channels/{rec["channel"].id}/profile',
            'sending': f'/api/v1/inbox/channels/{rec["channel"].id}/sending',
            'marketing': f'/api/v1/inbox/contacts/{rec["contact"].id}/marketing',
            'flows': f'/api/v1/inbox/channels/{rec["channel"].id}/flows',
            'flow': f'/api/v1/inbox/flows/{rec["flow"].id}',
            'flow_preview': f'/api/v1/inbox/flows/{rec["flow"].id}/preview',
            'flow_submissions': f'/api/v1/inbox/flows/{rec["flow"].id}/submissions',
            'conversation_submissions': f'/api/v1/inbox/conversations/{rec["conversation"].id}/flow-submissions',
        }

    @staticmethod
    def report_paths(rec):
        """The report routes: they read the session's own company only, never its branches."""
        today = fields.Date.today()
        window = f'from={today - timedelta(days=6)}&to={today}'
        return {
            'report_template': f'/api/v1/inbox/reports/templates/{rec["template"].id}?{window}',
            'report_export': f'/api/v1/inbox/reports/export?by=channel&{window}',
        }

    def hidden_ids(self, kind, rec):
        return {
            'channel': rec['channel'], 'ref': rec['channel'], 'templates': rec['channel'], 'template': rec['template'], 'conversation': rec['conversation'],
            'messages': rec['conversation'], 'contact': rec['contact'], 'download': rec['message'],
            'audience': rec['audience'], 'members': rec['audience'], 'department_hours': rec['department'], 'automation': rec['channel'],
            'rule': rec['rule'], 'campaign': rec['campaign'], 'recipients': rec['campaign'], 'alerts': rec['channel'],
            'profile': rec['channel'], 'sending': rec['channel'], 'marketing': rec['contact'], 'flows': rec['channel'],
            'flow': rec['flow'], 'flow_preview': rec['flow'], 'flow_submissions': rec['flow'],
            'conversation_submissions': rec['conversation'], 'report_template': rec['template'],
        }[kind].id

    def test_record_matrix(self):
        """Visible companies answer 200 on every record route; every other company answers the not-found."""
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag in visible:
                for kind, path in self.paths(self.recs[tag]).items():
                    with self.subTest(current=current, visible=tag, route=kind):
                        self.assertVisible(path)
            for tag in hidden:
                rec = self.recs[tag]
                for kind, path in self.paths(rec).items():
                    with self.subTest(current=current, hidden=tag, route=kind):
                        self.assertHiddenEveryWay('GET', path, self.hidden_ids(kind, rec))

    def assertHiddenWithStrictQuery(self, path, hidden_id):
        """Like assertHiddenEveryWay for a route that refuses unknown query parameters: the forged `cids` query is a 422."""
        plain, by_query, by_body = self.api_forged('GET', path, hidden_id)
        self.assertEqual((plain.status_code, by_query.status_code, by_body.status_code), (404, 422, 404), path)
        self.assertHidden(path)

    def test_report_routes_read_the_current_company_only(self):
        """A report is the session company's own: a parent never reads a branch's template detail or export, and vice versa."""
        for current, _visible, _hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for tag, rec in self.recs.items():
                for kind, path in self.report_paths(rec).items():
                    if kind == 'report_export':
                        continue
                    with self.subTest(current=current, record=tag, route=kind):
                        if tag == current:
                            self.assertVisible(path)
                        else:
                            self.assertHiddenWithStrictQuery(path, self.hidden_ids(kind, rec))
            text = self.assertVisible(self.report_paths(self.recs[current])['report_export']).content.decode('utf-8-sig')
            subjects = {row[0] for row in csv.reader(io.StringIO(text))}
            self.assertIn(f'Channel {current}', subjects)
            for tag in self.by_tag:
                if tag != current:
                    self.assertNotIn(f'Channel {tag}', subjects, f'{tag} leaked into the {current} report export')

    def test_hidden_records_never_reach_meta(self):
        for current, _visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            self.meta_get_business_profile.reset_mock()
            self.meta_flow_preview.reset_mock()
            for tag in hidden:
                paths = self.paths(self.recs[tag])
                self.assertHidden(paths['profile'])
                self.assertHidden(paths['flow_preview'])
            self.assertFalse(self.meta_get_business_profile.called or self.meta_flow_preview.called, f'a hidden record reached Meta from {current}')

    def test_lists_never_show_another_company(self):
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            for path, key in (('/api/v1/inbox/conversations', 'conversation'), ('/api/v1/inbox/channels', 'channel')):
                ids = {item['id'] for item in self.assertVisible(path).json()['items']}
                for tag in visible:
                    self.assertIn(self.recs[tag][key].id, ids, f'{path}: {tag} missing from {current}')
                for tag in hidden:
                    self.assertNotIn(self.recs[tag][key].id, ids, f'{path}: {tag} leaked into {current}')

    def test_export_never_includes_another_company(self):
        for current, visible, hidden in MATRIX:
            self.env_in(self.by_tag[current])
            response = self.assertVisible('/api/v1/inbox/conversations/export.csv')
            text = response.content.decode('utf-8-sig')
            names = {row[0] for row in csv.reader(io.StringIO(text))} | {cell for row in csv.reader(io.StringIO(text)) for cell in row}
            for tag in visible:
                self.assertIn(f'Customer {tag.upper()}', names)
            for tag in hidden:
                self.assertNotIn(f'Customer {tag.upper()}', names, f'{tag} leaked into {current}')

    def test_missing_capability_in_the_same_company_stays_forbidden(self):
        self.authenticate('iso_inbox_nocap', PASSWORD)
        rec = self.recs['p']
        for path in (*self.paths(rec).values(), *self.report_paths(rec).values(), '/api/v1/inbox/conversations/export.csv'):
            self.assertEqual(self.api('GET', path).status_code, 403, path)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_inbox', EXPECTED_GET_RECORD_ROUTES)


# The TikTok app configuration read by the webhook and the connect route; its secret also signs the deliveries.
TIKTOK_APP_ENV = {
    'LIWAN_TIKTOK_CLIENT_KEY': tt.CLIENT_KEY,
    'LIWAN_TIKTOK_CLIENT_SECRET': tt.CLIENT_SECRET,
    'LIWAN_TIKTOK_REDIRECT_URI': 'https://liwan.test/api/v1/inbox/tiktok/callback',
}
TIKTOK_HOOK = '/api/v1/inbox/hooks/tiktok'
# Company B's account is the fixture business account itself, so `tiktok_payloads` signs its deliveries as they are.
BUSINESS_A = 'business-open-id-iso-a'
BUSINESS_B = tt.BUSINESS_ID


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokCompanyIsolation(CompanyIsolationCase):
    """Company B's TikTok records never reach company A's channel manager.

    The manager role is granted per company: A's manager holds it in A alone, and the per-request company pin
    is exercised separately by a manager who holds it in both companies. The control is B's own manager reading
    the very records the A searches miss, so the hiding is the company fence and not a missing fixture.
    """

    RECORD_MODELS = {
        'channel': 'liwan.inbox.channel',
        'conversation': 'liwan.inbox.conversation',
        'message': 'liwan.inbox.message',
        'shortcut': 'liwan.inbox.tiktok.shortcut',
        'sync': 'liwan.inbox.tiktok.sync',
        'event': 'liwan.inbox.event',
    }

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, TIKTOK_APP_ENV)
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)
        set_probe_feature(cls, key=TIKTOK_FEATURE, enabled=True)
        cls.manager_a = cls._company_manager('iso_tiktok_manager_a', cls.company_p)
        cls.manager_b = cls._company_manager('iso_tiktok_manager_b', cls.company_c)
        # iso_user manages both companies: an A request made by it must still hide B, so the pin is what keeps
        # B out, not a missing assignment.
        Assignment = cls.env['liwan.access.assignment'].sudo()
        manager = cls.env.ref('liwan_inbox.role_inbox_manager')
        for company in (cls.company_p, cls.company_c):
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': manager.id, 'company_id': company.id})
        cls.records = {
            'a': cls._tiktok_records(cls.company_p, BUSINESS_A),
            'b': cls._tiktok_records(cls.company_c, BUSINESS_B),
        }

    @classmethod
    def _company_manager(cls, login, company):
        """An inbox manager of `company` alone."""
        user = new_test_user(
            cls.env, login=login, password=PASSWORD, name=login,
            groups='liwan_core.group_employee', company_id=company.id,
        )
        cls.env['liwan.access.assignment'].sudo().create({
            'user_id': user.id, 'role_id': cls.env.ref('liwan_inbox.role_inbox_manager').id,
            'company_id': company.id,
        })
        return user

    @classmethod
    def _tiktok_records(cls, company, business_id):
        """One connected TikTok account of `company` with the records the isolation covers."""
        env = cls.env
        channel = env['liwan.inbox.channel'].create({
            'name': f'TikTok {company.name}', 'kind': 'tiktok', 'tiktok_business_id': business_id,
            'state': 'connected', 'owner_company_id': company.id,
        })
        contact = env['liwan.inbox.contact'].create({'name': f'Customer {company.name}', 'company_id': company.id})
        identity = env['liwan.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'tiktok', 'address': f'sender-{business_id}',
            'company_id': company.id,
        })
        conversation = env['liwan.inbox.conversation'].create({
            'channel_id': channel.id, 'contact_id': contact.id, 'identity_id': identity.id,
            'company_id': company.id, 'provider_conversation_id': f'conversation-{business_id}',
        })
        message = env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': company.id, 'direction': 'in', 'kind': 'text',
            'body': f'Hello from {company.name}', 'delivery_state': 'received',
            'provider_message_id': f'message-{business_id}',
        })
        shortcut = env['liwan.inbox.tiktok.shortcut'].create({
            'channel_id': channel.id, 'kind': 'question',
            'question': 'Do you deliver?', 'answer': 'Yes, city-wide.',
        })
        return {
            'channel': channel, 'conversation': conversation, 'message': message, 'shortcut': shortcut,
            'sync': channel._liwan_tiktok_queue_sync(),
            'event': store_event(env, channel, tt.receive_text(message_id=f'msg-iso-{business_id}')),
        }

    def test_tiktok_records_isolated(self):
        """B's TikTok channel, conversation, messages, shortcuts, sync job and raw event stay in B.

        The records are proved through the ORM search of each company's own manager; the routes that serve
        them answer the other company's manager with the not-found; and the raw event has no API route of its
        own, so it is proved through the ORM and through the webhook that creates it for B alone.
        """
        self.assert_orm_hidden()
        self.assert_routes_hidden()
        self.assert_webhook_lands_on_b_only()

    def assert_orm_hidden(self):
        """A's own manager reads A's record of every kind and never B's, which B's own manager does read."""
        records_a, records_b = self.records['a'], self.records['b']
        company_a = self.env(user=self.manager_a)
        company_b = self.env(user=self.manager_b)
        for key, model in self.RECORD_MODELS.items():
            with self.subTest(record=key):
                self.assertFalse(
                    company_a[model].search([('id', '=', records_b[key].id)]),
                    f'{model} {records_b[key].id} of company B is visible to company A\'s manager',
                )
                self.assertEqual(
                    company_a[model].search_count([('id', 'in', (records_a[key].id, records_b[key].id))]), 1,
                    f'{model}: the A manager must read exactly its own record',
                )
                # Control: the same record is readable by B's own manager, so the A search missed it because of
                # the company fence, not because it does not exist.
                self.assertEqual(
                    company_b[model].search([('id', '=', records_b[key].id)]), records_b[key],
                    f'{model} {records_b[key].id} of company B is not readable by company B\'s manager',
                )
        self.assertEqual(company_a['liwan.inbox.channel'].search([]).owner_company_id, self.company_p)
        self.assertEqual(company_b['liwan.inbox.channel'].search([]).owner_company_id, self.company_c)

    def assert_routes_hidden(self):
        """Every route serving a B TikTok record answers A's manager with the not-found; A's own answers 200, and
        B's own answers 200 to the very same manager with B as its current company."""
        self.env_in(self.company_p)
        hidden, own = self.records['b'], self.records['a']
        for name, path in self._get_paths(hidden).items():
            with self.subTest(route=name, channel='B'):
                self.assertHiddenEveryWay('GET', path, hidden['channel'].id)
        for name, path in self._get_paths(own).items():
            with self.subTest(route=name, channel='A'):
                self.assertVisible(path)
        for method, path, body in self._hidden_writes(hidden):
            with self.subTest(method=method, route=path):
                response = self.api(method, path, body)
                self.assertEqual(response.status_code, 404, response.text[:300])
                self.assertEqual(response.json().get('code'), 'not_found', response.text[:300])
        self.assertEqual(
            self.api('POST', '/api/v1/inbox/channels/tiktok/connect', {'channel_id': own['channel'].id}).status_code,
            200, "the A manager must still be able to (re)connect its own TikTok channel",
        )
        # Control: the same manager reads B's records on the same routes once B is its current company, so the
        # 404s above are the request pin and not a missing capability or an absent record.
        self.iso_user.company_id = self.company_c.id
        self.authenticate('iso_emp', 'iso_emp_pass_123')
        for name, path in self._get_paths(hidden).items():
            with self.subTest(route=name, channel='B current'):
                self.assertVisible(path)
        self.assertEqual(
            self.api('POST', '/api/v1/inbox/channels/tiktok/connect', {'channel_id': hidden['channel'].id}).status_code,
            200, "the manager must be able to reconnect B's channel when B is its current company",
        )

    def _get_paths(self, record):
        """The GET routes that serve one TikTok account's channel, conversation and settings."""
        channel, conversation = record['channel'].id, record['conversation'].id
        return {
            'channel': f'/api/v1/inbox/channels/{channel}',
            'conversation': f'/api/v1/inbox/conversations/{conversation}',
            'messages': f'/api/v1/inbox/conversations/{conversation}/messages',
            'shortcuts': f'/api/v1/inbox/channels/{channel}/tiktok/shortcuts',
            'sync': f'/api/v1/inbox/channels/{channel}/tiktok/sync',
        }

    def _hidden_writes(self, record):
        """The writes that would reach or change another company's TikTok account."""
        base = f'/api/v1/inbox/channels/{record["channel"].id}/tiktok'
        shortcut = f'{base}/shortcuts/{record["shortcut"].id}'
        return (
            ('POST', f'{base}/shortcuts', {'kind': 'question', 'question': 'Stolen?', 'answer': 'Yes'}),
            ('PATCH', shortcut, {'question': 'Stolen?'}),
            ('DELETE', shortcut, None),
            ('POST', f'{base}/shortcuts/enable', {'kind': 'question', 'enabled': True}),
            ('POST', f'{base}/sync', None),
            ('POST', '/api/v1/inbox/channels/tiktok/connect', {'channel_id': record['channel'].id, 'name': 'Stolen'}),
        )

    def assert_webhook_lands_on_b_only(self):
        """A signed delivery for B's business account creates its event on B's channel and company only."""
        marker = 'msg-iso-event-b'
        response = self.deliver(json.dumps(tt.receive_text(body='Isolation delivery for B', message_id=marker)).encode())
        self.assertEqual((response.status_code, response.text), (200, 'ok'))
        event = self.env['liwan.inbox.event'].search([('payload', 'like', marker)])
        self.assertEqual(len(event), 1)
        self.assertEqual((event.channel_id, event.owner_company_id), (self.records['b']['channel'], self.company_c))
        self.assertFalse(self.env['liwan.inbox.event'].search([
            ('owner_company_id', '=', self.company_p.id), ('payload', 'like', marker),
        ]))
        self.assertFalse(
            self.env(user=self.manager_a)['liwan.inbox.event'].search([('payload', 'like', marker)]),
            "company A's manager reads the event of a delivery for company B",
        )
        # A delivery for an account no channel owns is refused exactly like a bad signature and stores nothing.
        unknown = 'msg-iso-unknown-account'
        refused = self.deliver(json.dumps(tt.envelope(
            'im_receive_msg',
            tt.message('text', {'body': 'Unknown account'}, message_id=unknown),
            business_id='unknown-business-open-id',
        )).encode())
        bad_signature = self.deliver(
            json.dumps(tt.receive_text(message_id='msg-iso-bad-signature')).encode(), secret='another-secret',
        )
        for answer in (refused, bad_signature):
            self.assertEqual(answer.status_code, 403, answer.text)
            self.assertEqual(answer.json().get('code'), 'forbidden')
        self.assertEqual(refused.content, bad_signature.content)
        self.assertFalse(self.env['liwan.inbox.event'].search([('payload', 'like', unknown)]))

    def deliver(self, raw, secret=tt.CLIENT_SECRET, now=None):
        """One signed TikTok webhook POST, as TikTok delivers it."""
        return self.url_open(TIKTOK_HOOK, data=raw, headers={
            'Content-Type': 'application/json',
            'Tiktok-Signature': tt.signed(raw, secret, int(time.time()) if now is None else now),
        }, method='POST')


cover_isolation_routes((
    '/api/v1/inbox/channels/<int:channel_id>',
    '/api/v1/inbox/channels/<int:channel_id>/ref',
    '/api/v1/inbox/channels/<int:channel_id>/templates',
    '/api/v1/inbox/templates/<int:template_id>',
    '/api/v1/inbox/conversations/<int:conversation_id>',
    '/api/v1/inbox/conversations/<int:conversation_id>/messages',
    '/api/v1/inbox/contacts/<int:contact_id>',
    '/api/v1/inbox/messages/<int:message_id>/attachments/<int:attachment_id>/download',
    '/api/v1/inbox/conversations/export.csv',
    '/api/v1/inbox/audiences/<int:audience_id>',
    '/api/v1/inbox/audiences/<int:audience_id>/members',
    '/api/v1/inbox/departments/<int:department_id>/working-hours',
    '/api/v1/inbox/channels/<int:channel_id>/automation',
    '/api/v1/inbox/rules/<int:rule_id>',
    '/api/v1/inbox/campaigns/<int:campaign_id>',
    '/api/v1/inbox/campaigns/<int:campaign_id>/recipients',
    '/api/v1/inbox/channels/<int:channel_id>/alerts',
    '/api/v1/inbox/channels/<int:channel_id>/profile',
    '/api/v1/inbox/channels/<int:channel_id>/sending',
    '/api/v1/inbox/contacts/<int:contact_id>/marketing',
    '/api/v1/inbox/channels/<int:channel_id>/flows',
    '/api/v1/inbox/flows/<int:flow_id>',
    '/api/v1/inbox/flows/<int:flow_id>/preview',
    '/api/v1/inbox/flows/<int:flow_id>/submissions',
    '/api/v1/inbox/conversations/<int:conversation_id>/flow-submissions',
    '/api/v1/inbox/reports/templates/<int:template_id>',
    '/api/v1/inbox/reports/export',
), source='liwan_inbox/tests/test_company_isolation.py')
