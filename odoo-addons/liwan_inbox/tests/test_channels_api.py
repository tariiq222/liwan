# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import MagicMock, patch

import requests

from odoo.exceptions import UserError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import (
    ACCESS_TOKEN,
    APP_SECRET,
    BUSINESS_ACCOUNT_ID,
    CHANNEL_KEYS,
    CONNECTION_KEYS,
    PASSWORD,
    LiwanInboxCase,
)
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, whatsapp
from odoo.addons.liwan_inbox.models.constants import WHATSAPP_FEATURE
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

NEW_CHANNEL = {'name': 'Branch line', 'kind': 'whatsapp', 'phone_number_id': '300000000001'}
CHANNELS = '/api/v1/inbox/channels'


@tagged('post_install', '-at_install', 'liwan')
class TestChannelsApi(LiwanInboxCase):

    def body(self, connection=None, **values):
        return {**NEW_CHANNEL, 'connection_id': (connection or self.channel.connection_id).id, **values}

    def test_a_channel_reports_its_connection_and_no_secret(self):
        self.login(self.manager)
        read = self.get(f'{CHANNELS}/{self.channel.id}')
        self.assertEqual(read.status_code, 200, read.text)
        body = read.json()
        self.assertEqual(set(body), CHANNEL_KEYS)
        connection = self.channel.connection_id
        self.assertEqual(body['connection'], {
            'id': connection.id, 'provider': 'meta', 'external_id': BUSINESS_ACCOUNT_ID, 'label': '',
            'app_id': None, 'state': 'connected', 'status_message': '',
        })
        self.assertEqual(set(body['connection']), CONNECTION_KEYS)
        self.assertFalse(body['needs_reconnect'])
        for secret in (ACCESS_TOKEN, APP_SECRET, connection._liwan_secret('verify_token')):
            self.assertNotIn(secret, read.text)

    def test_a_department_of_another_company_is_refused_for_a_channel(self):
        branch = self.env['res.company'].create({'name': 'Channel lists branch', 'parent_id': self.env.company.id})
        user = new_test_user(
            self.env, login='inbox_channel_two_companies', password=PASSWORD, name='Two companies', groups='liwan_core.group_employee',
            company_id=self.env.company.id, company_ids=[(6, 0, (self.env.company | branch).ids)],
        )
        role = self.env.ref('liwan_inbox.role_inbox_manager')
        for company in self.env.company | branch:
            self.env['liwan.access.assignment'].create({'user_id': user.id, 'company_id': company.id, 'role_id': role.id})
        foreign = self.env['liwan.inbox.department'].create({'name': 'Branch desk', 'company_id': branch.id})
        self.login(user)
        self.assertError(self.api('PATCH', f'{CHANNELS}/{self.channel.id}', {'department_id': foreign.id}), 422, 'invalid')
        self.assertError(self.api('POST', CHANNELS, self.body(department_id=foreign.id)), 422, 'invalid')
        own = self.api('PATCH', f'{CHANNELS}/{self.channel.id}', {'department_id': self.department.id})
        self.assertEqual(own.status_code, 200, own.text)
        with self.assertRaises(ValidationError):
            self.channel.write({'department_id': foreign.id})

    def test_create_returns_the_shape_of_a_channel_on_its_connection(self):
        self.login(self.manager)
        result = self.api('POST', CHANNELS, self.body(department_id=self.department.id))
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), CHANNEL_KEYS)
        self.assertEqual(
            (body['state'], body['phone_number_id'], body['connection']['id'], body['department']['id']),
            ('draft', '300000000001', self.channel.connection_id.id, self.department.id),
        )
        channel = self.env['liwan.inbox.channel'].browse(body['id'])
        self.assertEqual(channel._liwan_credentials().access_token, ACCESS_TOKEN)
        self.assertEqual(channel._liwan_credentials().business_account_id, BUSINESS_ACCOUNT_ID)

    def test_the_inbox_feature_alone_offers_tiktok_and_creates_its_channel(self):
        set_probe_feature(self, key=WHATSAPP_FEATURE, enabled=False)
        uses = {use['key'] for use in self.env['liwan.integration.registry']._liwan_open_uses()}
        self.assertLessEqual({'inbox.tiktok'}, uses)
        self.assertNotIn('inbox.whatsapp', uses)
        connection = self.make_tiktok_connection('business-open-id-alone')
        self.login(self.manager)
        result = self.api('POST', CHANNELS, {'name': 'TikTok alone', 'kind': 'tiktok', 'connection_id': connection.id})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['kind'], result.json()['state']), ('tiktok', 'connected'))
        self.assertError(self.api('POST', CHANNELS, self.body()), 403, 'feature_not_included')

    def test_a_channel_cannot_name_a_connection_that_does_not_fit(self):
        tiktok = self.make_tiktok_connection('business-open-id-create')
        other = self.env['res.company'].create({'name': 'Other company'})
        foreign = self.make_connection('400000000009', other)
        disabled = self.make_connection('400000000008')
        disabled.state = 'disabled'
        failing = self.make_connection('400000000007')
        failing.state = 'error'
        self.login(self.manager)
        for connection_id in (tiktok.id, foreign.id, disabled.id, failing.id, 999999999, 'x', None):
            result = self.api('POST', CHANNELS, {**self.body(), 'connection_id': connection_id})
            self.assertError(result, 422, 'invalid')
            self.assertEqual(result.json()['field'], 'connection_id', connection_id)
        self.assertFalse(self.env['liwan.inbox.channel'].search([('phone_number_id', '=', NEW_CHANNEL['phone_number_id'])]))

    def test_accounts_lists_the_open_connections_of_the_kind_in_the_current_company(self):
        tiktok = self.make_tiktok_connection('business-open-id-accounts')
        other = self.env['res.company'].create({'name': 'Accounts company'})
        self.make_connection('400000000006', other)
        disabled = self.make_connection('400000000005')
        disabled.state = 'disabled'
        self.channel.connection_id.app_id = '123456789'
        self.login(self.manager)
        result = self.get(f'{CHANNELS}/accounts?kind=whatsapp')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['total'], [item['id'] for item in body['items']]), (1, [self.channel.connection_id.id]))
        self.assertEqual(set(body['items'][0]), CONNECTION_KEYS)
        self.assertEqual(body['items'][0]['app_id'], '123456789')
        self.assertNotIn(ACCESS_TOKEN, result.text)
        accounts = self.get(f'{CHANNELS}/accounts?kind=tiktok').json()
        self.assertEqual([item['id'] for item in accounts['items']], [tiktok.id])

    def test_accounts_needs_a_kind_the_capability_and_the_kind_feature(self):
        self.login(self.manager)
        for query in ('', '?kind=telegram'):
            result = self.get(f'{CHANNELS}/accounts{query}')
            self.assertError(result, 422, 'invalid')
            self.assertEqual(result.json()['field'], 'kind')
        set_probe_feature(self, key=WHATSAPP_FEATURE, enabled=False)
        self.assertEqual(self.get(f'{CHANNELS}/accounts?kind=whatsapp').status_code, 403)
        self.assertEqual(self.get(f'{CHANNELS}/accounts?kind=tiktok').status_code, 200)
        for user in (self.agent, self.outsider):
            self.login(user)
            self.assertError(self.get(f'{CHANNELS}/accounts?kind=whatsapp'), 403, 'forbidden')

    def test_validation_errors(self):
        self.login(self.manager)
        for change in (
            {'phone_number_id': 'abc'}, {'kind': 'telegram'}, {'bogus': 1}, {'name': ''}, {'department_id': 999999},
            {'access_token': 'x' * 20}, {'business_account_id': '400000000001'},
        ):
            self.assertError(self.api('POST', CHANNELS, {**self.body(), **change}), 422, 'invalid')
        for key in ('name', 'kind', 'connection_id', 'phone_number_id'):
            self.assertError(self.api('POST', CHANNELS, {k: v for k, v in self.body().items() if k != key}), 422, 'invalid')

    def test_the_connect_callback_and_verify_token_routes_are_gone(self):
        self.login(self.manager)
        for method, path in (
            ('POST', f'{CHANNELS}/tiktok/connect'), ('GET', '/api/v1/inbox/tiktok/callback'),
            ('POST', f'{CHANNELS}/{self.channel.id}/verify-token'),
        ):
            self.assertEqual(self.api(method, path, {} if method == 'POST' else None).status_code, 404, path)

    def test_only_channel_managers_manage_channels(self):
        for user in (self.agent, self.supervisor, self.outsider):
            self.login(user)
            self.assertError(self.get('/api/v1/inbox/channels'), 403, 'forbidden')
            self.assertError(self.api('POST', CHANNELS, self.body()), 403, 'forbidden')

    def test_list_get_patch_delete(self):
        self.login(self.manager)
        listed = self.get('/api/v1/inbox/channels').json()
        self.assertIn(self.channel.id, [c['id'] for c in listed['items']])
        self.assertEqual(self.get(f'/api/v1/inbox/channels/{self.channel.id}').json()['phone_number_id'], self.channel.phone_number_id)
        path = f'/api/v1/inbox/channels/{self.channel.id}'
        patched = self.api('PATCH', path, {'name': 'Renamed', 'state': 'disabled'})
        self.assertEqual((patched.status_code, patched.json()['name'], patched.json()['state']), (200, 'Renamed', 'disabled'))
        for refused in ({'access_token': 'z' * 20}, {'connection_id': self.channel.connection_id.id}, {'phone_number_id': '300000000002'}):
            self.assertError(self.api('PATCH', path, refused), 422, 'invalid')
        self.assertError(self.api('PATCH', path, {'state': 'error'}), 422, 'invalid')
        self.assertError(self.api('PATCH', path, {'state': 'connected'}), 422, 'invalid')
        self.assertError(self.get('/api/v1/inbox/channels/999999999'), 404, 'not_found')

    def test_delete_refuses_a_channel_with_conversations(self):
        self.make_conversation()
        self.login(self.manager)
        result = self.api('DELETE', f'/api/v1/inbox/channels/{self.channel.id}')
        self.assertError(result, 422, 'invalid')
        self.assertEqual(result.json()['details'], {'reason': 'inbox_channel_has_conversations'})

    def test_a_passing_test_enables_a_disabled_channel_and_a_failing_one_does_not(self):
        self.login(self.manager)
        path = f'/api/v1/inbox/channels/{self.channel.id}/test'
        self.channel.state = 'disabled'
        failing = MagicMock(status_code=401)
        failing.json.return_value = {'error': {'message': 'Invalid OAuth access token'}}
        with patch.object(requests, 'request', MagicMock(return_value=failing)):
            self.assertEqual(self.api('POST', path).json()['state'], 'disabled')
        passing = MagicMock(status_code=200)
        passing.json.return_value = {}
        with patch.object(requests, 'request', MagicMock(return_value=passing)):
            self.assertEqual(self.api('POST', path).json()['state'], 'connected')

    def test_a_duplicate_phone_number_id_names_its_reason(self):
        self.login(self.manager)
        result = self.api('POST', CHANNELS, self.body(phone_number_id=self.channel.phone_number_id))
        self.assertEqual(result.json()['details'], {'reason': 'inbox_phone_number_taken'})
        empty = self.make_channel(phone_id='500000000001')
        self.assertEqual(self.api('DELETE', f'/api/v1/inbox/channels/{empty.id}').status_code, 204)
        self.assertFalse(empty.exists())

    def test_the_channel_limit_is_claimed_on_create(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        used = self.env['liwan.entitlement.service']._liwan_count_channels()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.channels': used}})
        self.login(self.manager)
        result = self.api('POST', CHANNELS, self.body())
        self.assertEqual(result.status_code, 403, result.text)
        self.assertEqual(result.json()['code'], 'feature_not_included')
        self.assertEqual(result.json()['details'], {'reason': 'limit', 'limit_key': 'inbox.channels'})
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.channels': used + 1}})
        self.assertEqual(self.api('POST', CHANNELS, self.body()).status_code, 200)

    def test_connection_test_sets_connected_or_error(self):
        self.login(self.manager)
        path = f'/api/v1/inbox/channels/{self.channel.id}/test'
        healthy = MagicMock(status_code=200)
        healthy.json.return_value = {'display_phone_number': '+966 50 111 2222', 'verified_name': 'Acme'}
        with patch.object(requests, 'request', MagicMock(return_value=healthy)) as mocked:
            result = self.api('POST', path)
        self.assertEqual((result.json()['state'], result.json()['last_error']), ('connected', None))
        self.assertEqual(mocked.call_args.kwargs['headers'], {'Authorization': f'Bearer {ACCESS_TOKEN}'})
        failing = MagicMock(status_code=401)
        failing.json.return_value = {'error': {'message': 'Invalid OAuth access token'}}
        with patch.object(requests, 'request', MagicMock(return_value=failing)):
            result = self.api('POST', path)
        self.assertEqual((result.json()['state'], result.json()['last_error']), ('error', 'Invalid OAuth access token'))
        self.assertNotIn(ACCESS_TOKEN, result.text)

    def test_template_sync_upserts_and_removes(self):
        stale = self.env['liwan.inbox.template'].create({
            'channel_id': self.channel.id, 'name': 'stale', 'language': 'ar', 'status': 'approved', 'body': 'x',
        })
        remote = [{
            'name': 'order_ready', 'language': 'ar', 'category': 'UTILITY', 'status': 'APPROVED',
            'components': [{'type': 'HEADER', 'text': 'ignored'}, {'type': 'BODY', 'text': 'Hi {{1}}, order {{2}} / {{1}}'}],
        }]
        self.login(self.manager)
        with patch.object(whatsapp, 'list_templates', return_value=remote):
            result = self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/templates/sync')
        items = result.json()['items']
        self.assertEqual([(t['name'], t['param_count'], t['body']) for t in items], [('order_ready', 2, 'Hi {{1}}, order {{2}} / {{1}}')])
        self.assertFalse(stale.exists())
        with patch.object(whatsapp, 'list_templates', side_effect=errors.ProviderError('rate limited', retryable=True)):
            self.assertError(self.api('POST', f'/api/v1/inbox/channels/{self.channel.id}/templates/sync'), 422, 'invalid')

    def test_the_whatsapp_sub_feature_gates_channel_creation(self):
        set_probe_feature(self, key='inbox.whatsapp', enabled=False)
        self.login(self.manager)
        self.assertEqual(self.api('POST', CHANNELS, self.body()).status_code, 403)

    def test_a_secret_stored_under_another_key_cannot_be_read(self):
        with patch.dict('os.environ', {'LIWAN_INBOX_SECRET_KEY': 'A' * 43 + '='}):
            with self.assertRaisesRegex(UserError, 'cannot be decrypted'):
                self.channel._liwan_credentials()

    def test_a_channels_only_role_reads_a_channel_that_has_a_department(self):
        self.channel.department_id = self.department
        self.login(self._capability_user('inbox_channels_dept_only', 'inbox.channels.manage'))
        listing = self.api('GET', '/api/v1/inbox/channels')
        self.assertEqual(listing.status_code, 200, listing.text)
        detail = self.api('GET', f'/api/v1/inbox/channels/{self.channel.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['department']['id'], self.department.id)
        # The channel form's department picker: readable, never writable, for the channel manager.
        departments = self.api('GET', '/api/v1/inbox/departments')
        self.assertEqual(departments.status_code, 200, departments.text)
        row = next(row for row in departments.json()['items'] if row['id'] == self.department.id)
        self.assertEqual(row['members'], [], 'a channel-only role reads the picker, not the staff list')
        self.assertError(self.api('POST', '/api/v1/inbox/departments', {'name': 'Z', 'member_ids': []}), 403, 'forbidden')
        self.assertError(
            self.api('PATCH', f'/api/v1/inbox/departments/{self.department.id}', {'name': 'Z'}), 403, 'forbidden',
        )
        self.assertError(self.api('DELETE', f'/api/v1/inbox/departments/{self.department.id}'), 403, 'forbidden')

    def test_a_failed_delivery_is_listed_and_reprocessed_from_the_channel(self):
        event = self.store_event(self.channel, '{"entry": "x"')
        for _ in range(5):
            self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual((event.state, event.attempts), ('failed', 5))
        self.login(self.manager)
        listing = self.api('GET', f'/api/v1/inbox/channels/{self.channel.id}/events')
        self.assertEqual(listing.status_code, 200, listing.text)
        item = listing.json()['items'][0]
        self.assertEqual(set(item), {'id', 'state', 'attempts', 'error', 'created_at'})
        self.assertEqual((item['id'], item['state'], item['attempts'], item['error']), (event.id, 'failed', 5, 'JSONDecodeError'))
        retried = self.api('POST', f'/api/v1/inbox/events/{event.id}/retry')
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual((retried.json()['state'], retried.json()['attempts'], retried.json()['error']), ('pending', 0, None))
        self.assertEqual(self.api('GET', f'/api/v1/inbox/channels/{self.channel.id}/events').json()['total'], 0)
        # A delivery that is not failed is refused, and a channel this role does not administer is not found.
        self.assertError(self.api('POST', f'/api/v1/inbox/events/{event.id}/retry'), 422, 'invalid')
        # The route's channel capability is checked before the record: a role without it is refused, never told an id.
        for user in (self.templates_only, self.agent, self.outsider):
            self.login(user)
            self.assertError(self.get(f'/api/v1/inbox/channels/{self.channel.id}/events'), 403, 'forbidden')
            self.assertError(self.api('POST', f'/api/v1/inbox/events/{event.id}/retry', {}), 403, 'forbidden')

    def test_the_work_channel_list_of_a_reader_holds_only_the_companies_where_the_capability_is_held(self):
        other = self.env['res.company'].create({'name': 'Work picker branch'})
        foreign = self.make_channel(phone_id='100000000077', business_account_id='400000000077', owner_company_id=other.id)
        self.login(self.reader_only)
        body = self.get('/api/v1/inbox/channels/work').json()
        self.assertEqual((body['total'], [row['id'] for row in body['items']]), (1, [self.channel.id]))
        self.assertNotIn(foreign.id, [row['id'] for row in body['items']])

    def test_the_work_channel_list_is_a_picker_of_the_work_capabilities_only(self):
        self.channel.department_id = self.department
        self.login(self.templates_only)
        listing = self.api('GET', '/api/v1/inbox/channels/work')
        self.assertEqual(listing.status_code, 200, listing.text)
        body = listing.json()
        self.assertEqual((body['total'], [row['id'] for row in body['items']]), (1, [self.channel.id]))
        self.assertEqual(body['items'][0], {
            'id': self.channel.id, 'name': self.channel.name, 'kind': 'whatsapp',
            'department': {'id': self.department.id, 'name': self.department.name},
        })
        self.login(self.outsider)
        self.assertError(self.get('/api/v1/inbox/channels/work'), 403, 'forbidden')
        # Reading conversations is the fourth work right: a reader picks a channel to filter by, and sees no more than the reference.
        for user in (self.agent, self.reader_only):
            self.login(user)
            reading = self.get('/api/v1/inbox/channels/work')
            self.assertEqual(reading.status_code, 200, reading.text)
            self.assertEqual([set(row) for row in reading.json()['items']], [{'id', 'name', 'kind', 'department'}])
            self.assertEqual([row['id'] for row in reading.json()['items']], [self.channel.id])
        # Automation is the third work right the picker serves: it sees the same channel without channel administration.
        self.login(self._capability_user('inbox_automation_only', 'inbox.automation.manage'))
        automation = self.get('/api/v1/inbox/channels/work')
        self.assertEqual(automation.status_code, 200, automation.text)
        self.assertEqual([row['id'] for row in automation.json()['items']], [self.channel.id])
