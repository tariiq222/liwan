# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

import requests

from odoo.tests import tagged

from .flows_common import (
    BASE,
    FLOW_KEYS,
    SUMMARY_KEYS,
    FlowCase,
    choice,
    form_body,
    text_input,
)
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_inbox.models.flow_starters import FLOW_STARTERS


@tagged('post_install', '-at_install', 'webvue')
class TestFlowsApi(FlowCase):

    def setUp(self):
        super().setUp()
        self.login(self.manager)

    @property
    def flows(self):
        return f'{BASE}/channels/{self.channel.id}/flows'

    def create(self, **overrides):
        return self.api('POST', self.flows, form_body(**overrides))

    def stored(self, flow_id):
        return self.env['webvue.inbox.flow'].browse(flow_id)

    # create and read

    def test_create_stores_the_form_and_uploads_the_generated_json(self):
        result = self.create()
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual(set(body), FLOW_KEYS)
        self.assertEqual(
            (body['status'], body['health'], body['supported'], body['editable'], body['sendable'], body['category'], body['replaces']),
            ('draft', 'unknown', True, True, False, 'appointment_booking', None),
        )
        self.assertEqual(body['channel'], {'id': self.channel.id, 'name': self.channel.name})
        self.assertEqual([screen['key'] for screen in body['screens']], ['SCREEN_A', 'SCREEN_B'])
        service = body['screens'][0]['fields'][2]
        self.assertEqual(service['options'], [
            {'key': 'o1', 'title': 'Checkup', 'description': None}, {'key': 'o2', 'title': 'Dental', 'description': None},
        ])
        self.assertNotIn('sensitive', body['screens'][1]['fields'][3])
        (payload,) = self.meta.bodies(f'{self.channel.business_account_id}/flows')
        self.assertEqual((payload['name'], payload['categories']), ('Appointment', ['APPOINTMENT_BOOKING']))
        self.assertEqual(json.loads(payload['flow_json'])['version'], '7.3')
        flow = self.stored(body['id'])
        self.assertEqual(flow.provider_flow_id, body['provider_flow_id'])
        self.assertTrue(flow.uploaded_hash)

    def test_meta_validation_errors_are_stored_and_block_publishing(self):
        self.meta.errors = [{'error': 'INVALID', 'message': 'Bad component', 'line_start': 4, 'column_start': 9, 'pointers': [{'path': 'screens[0]'}]}]
        body = self.create().json()
        self.assertEqual(body['validation_errors'], [{'message': 'Bad component', 'path': 'screens[0]', 'line': 4, 'column': 9}])
        self.assertEqual(body['error_count'], 1)
        refused = self.api('POST', self.flow_path(self.stored(body['id']), '/publish'))
        self.assertError(refused, 422, 'invalid')
        self.assertFalse(self.meta.paths('POST', '/publish'))

    def test_list_filters_and_the_single_read(self):
        draft = self.make_flow(status='draft', name='Alpha form')
        published = self.make_flow(name='Beta form')
        blocked = self.make_flow(name='Gamma form', health='blocked')
        names = lambda query: {row['name'] for row in self.get(f'{self.flows}?{query}').json()['items']}  # noqa: E731
        self.assertEqual(names('status=draft') & {'Alpha form', 'Beta form'}, {'Alpha form'})
        self.assertEqual(names('sendable=true') & {'Alpha form', 'Beta form', 'Gamma form'}, {'Beta form'})
        self.assertEqual(names('q=GAMMA'), {'Gamma form'})
        self.assertError(self.get(f'{self.flows}?status=nope'), 422, 'invalid')
        self.assertError(self.get(f'{self.flows}?sendable=false'), 422, 'invalid')
        row = next(row for row in self.get(self.flows).json()['items'] if row['id'] == published.id)
        self.assertEqual(set(row), SUMMARY_KEYS)
        self.assertTrue(row['sendable'])
        self.assertFalse(next(r for r in self.get(self.flows).json()['items'] if r['id'] == blocked.id)['sendable'])
        self.assertEqual(self.get(self.flow_path(draft)).json()['name'], 'Alpha form')

    # drafts only

    def test_patch_replaces_the_draft_and_an_identical_save_uploads_nothing(self):
        flow = self.stored(self.create().json()['id'])
        before = len(self.meta.paths('POST', '/assets'))
        same = self.api('PATCH', self.flow_path(flow), form_body())
        self.assertEqual(same.status_code, 200, same.text)
        self.assertEqual(len(self.meta.paths('POST', '/assets')), before)
        body = form_body(name='Renamed')
        body['screens'] = body['screens'][:1]
        changed = self.api('PATCH', self.flow_path(flow), body)
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((len(changed.json()['screens']), changed.json()['name']), (1, 'Renamed'))
        self.assertEqual(len(self.meta.paths('POST', '/assets')), before + 1)
        self.assertIn(flow.provider_flow_id, self.meta.paths('POST'))

    def test_published_and_unsupported_forms_cannot_be_changed(self):
        published, imported = self.make_flow(), self.make_flow(status='draft', supported=False)
        for flow in (published, imported):
            refused = self.api('PATCH', self.flow_path(flow), form_body())
            self.assertError(refused, 422, 'invalid')
        self.assertFalse(published.editable)
        self.assertFalse(imported.editable)

    def test_delete_is_for_unused_drafts_only(self):
        draft = self.make_flow(status='draft')
        published = self.make_flow()
        self.assertError(self.api('DELETE', self.flow_path(published)), 422, 'invalid')
        used = self.make_flow(status='draft')
        self.make_rule(name='uses', match_kind='flow', flow_id=used.id, keywords=[])
        self.assertError(self.api('DELETE', self.flow_path(used)), 422, 'invalid')
        provider_id = draft.provider_flow_id
        deleted = self.api('DELETE', self.flow_path(draft))
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(draft.exists())
        self.assertEqual(self.meta.paths('DELETE'), [provider_id])

    # lifecycle

    def test_publish_reads_the_state_back_and_deprecate_ends_it(self):
        flow = self.stored(self.create().json()['id'])
        published = self.api('POST', self.flow_path(flow, '/publish'))
        self.assertEqual(published.status_code, 200, published.text)
        body = published.json()
        self.assertEqual((body['status'], body['health'], body['json_version'], body['sendable']), ('published', 'available', '7.3', True))
        self.assertTrue(body['published_at'])
        self.assertError(self.api('POST', self.flow_path(flow, '/publish')), 422, 'invalid')
        deprecated = self.api('POST', self.flow_path(flow, '/deprecate'))
        self.assertEqual((deprecated.json()['status'], deprecated.json()['sendable']), ('deprecated', False))
        self.assertError(self.api('POST', self.flow_path(flow, '/deprecate')), 422, 'invalid')

    def test_copy_and_replace_moves_rules_and_automatic_messages_at_publish(self):
        original = self.make_flow(name='Intake')
        rule = self.make_rule(name='on intake', match_kind='flow', flow_id=original.id, keywords=[])
        self.channel._webvue_set_auto_message('welcome', {
            'body': 'Hello', 'interactive_type': 'flow', 'flow_id': original.id, 'flow_cta': 'Open',
        })
        copied = self.api('POST', self.flow_path(original, '/copy'), {'name': 'Intake v2', 'replace': True})
        self.assertEqual(copied.status_code, 201, copied.text)
        copy = self.stored(copied.json()['id'])
        self.assertEqual((copy.status, copied.json()['replaces']), ('draft', {'id': original.id, 'name': 'Intake'}))
        self.assertEqual([screen.title for screen in copy.screen_ids], ['Details', 'Consent'])
        self.assertEqual(rule.flow_id, original)
        self.api('POST', self.flow_path(copy, '/publish'))
        self.assertEqual((copy.status, original.status, copy.replaces_id), ('published', 'deprecated', self.env['webvue.inbox.flow']))
        self.assertEqual((rule.flow_id, self.channel._webvue_auto_message('welcome').flow_id), (copy, copy))

    def test_a_copy_without_replace_leaves_the_original_alone(self):
        original = self.make_flow(name='Keep')
        rule = self.make_rule(name='on keep', match_kind='flow', flow_id=original.id, keywords=[])
        copy = self.stored(self.api('POST', self.flow_path(original, '/copy'), {'name': 'Keep 2', 'replace': False}).json()['id'])
        self.api('POST', self.flow_path(copy, '/publish'))
        self.assertEqual((original.status, rule.flow_id), ('published', original))

    def test_copy_checks(self):
        draft, imported = self.make_flow(status='draft'), self.make_flow(supported=False)
        self.assertError(self.api('POST', self.flow_path(draft, '/copy'), {'name': 'X', 'replace': True}), 422, 'invalid')
        self.assertError(self.api('POST', self.flow_path(imported, '/copy'), {'name': 'X', 'replace': False}), 422, 'invalid')
        taken = self.api('POST', self.flow_path(draft, '/copy'), {'name': draft.name, 'replace': False})
        self.assertEqual((taken.status_code, taken.json().get('field')), (422, 'name'))
        self.assertError(self.api('POST', self.flow_path(draft, '/copy'), {'name': 'X'}), 422, 'invalid')

    def test_preview_returns_the_meta_link(self):
        flow = self.make_flow(status='draft')
        result = self.get(self.flow_path(flow, '/preview'))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {'url': 'https://business.facebook.com/wa/manage/flows/preview/abc', 'expires_at': '2026-11-28T10:00:00Z'})

    # synchronisation

    def test_sync_updates_imports_and_removes(self):
        known = self.make_flow(status='draft', name='Known')
        gone = self.make_flow(status='draft', name='Gone')
        self.meta.listing = [
            {'id': known.provider_flow_id, 'name': 'Known', 'status': 'PUBLISHED', 'categories': ['SURVEY'], 'validation_errors': []},
            {'id': '999000111', 'name': 'Known', 'status': 'DRAFT', 'categories': ['SIGN_UP'],
             'validation_errors': [{'message': 'Meta says no', 'pointers': [{'path': 'x'}]}]},
        ]
        result = self.api('POST', f'{self.flows}/sync')
        self.assertEqual(result.status_code, 200, result.text)
        by_provider = {row['provider_flow_id']: row for row in result.json()['items']}
        self.assertEqual(by_provider[known.provider_flow_id]['status'], 'published')
        self.assertEqual(by_provider[known.provider_flow_id]['health'], 'available')
        imported = by_provider['999000111']
        self.assertEqual((imported['supported'], imported['editable'], imported['category'], imported['name'], imported['error_count']),
                         (False, False, 'sign_up', 'Known (2)', 1))
        self.assertFalse(gone.exists())

    # Meta failures

    def test_a_meta_refusal_answers_422_and_stores_nothing(self):
        self.meta.failure = (400, {'error': {'message': 'Flow name is invalid'}})
        refused = self.create()
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'))
        self.assertIn('Flow name is invalid', refused.json()['message'])
        self.assertFalse(self.env['webvue.inbox.flow'].search([('name', '=', 'Appointment')]))

    def test_an_unreachable_meta_answers_502_and_rolls_back(self):
        self.meta.failure = requests.ConnectionError()
        refused = self.create()
        self.assertEqual((refused.status_code, refused.json()['code']), (502, 'provider_unavailable'))
        self.assertFalse(self.env['webvue.inbox.flow'].search([('name', '=', 'Appointment')]))
        self.meta.failure = (503, {})
        self.assertEqual(self.create().status_code, 502)

    # validation

    def test_the_body_is_checked_against_the_contract(self):
        def screens(*fields, **overrides):
            return {'screens': [{'title': 'T', 'footer_label': 'Go', 'fields': list(fields), **overrides}]}

        valid_input = text_input()
        cases = {
            'unknown top key': {'extra': 1},
            'no input': screens({'kind': 'heading', 'text': 'Only text'}),
            'duplicate keys': screens(valid_input, text_input()),
            'reserved key': screens(text_input('flow_token')),
            'key shape': screens(text_input('Bad-Key')),
            'label too long': screens(text_input(label='x' * 21)),
            'six opt-ins': screens(*({'kind': 'opt_in', 'key': f'k{i}', 'label': 'x', 'required': False} for i in range(6))),
            'opt-in with sensitive': screens({'kind': 'opt_in', 'key': 'k', 'label': 'x', 'required': False, 'sensitive': False}),
            'unknown field key': screens(text_input(extra=1)),
            'unknown kind': screens({'kind': 'image', 'src': 'x'}),
            'min above max': screens(text_input(min_chars=10, max_chars=5)),
            'checkbox limits': screens({**choice('checkbox', 'c', ['A', 'B']), 'min_selected': 3, 'max_selected': None}),
            'checkbox max above options': screens({**choice('checkbox', 'c', ['A']), 'min_selected': None, 'max_selected': 2}),
            'duplicate titles': screens(choice('radio', 'r', ['A', 'A'])),
            'no options': screens(choice('radio', 'r', [])),
            'too many radio options': screens(choice('radio', 'r', [f'o{i}' for i in range(21)])),
            'date order': screens({'kind': 'date', 'key': 'd', 'label': 'D', 'required': True, 'sensitive': False,
                                   'helper_text': None, 'min_date': '2026-12-01', 'max_date': '2026-11-01'}),
            'bad date': screens({'kind': 'date', 'key': 'd', 'label': 'D', 'required': True, 'sensitive': False,
                                 'helper_text': None, 'min_date': '01/12/2026', 'max_date': None}),
            'bad language': {'language': 'arabic'},
            'bad category': {'category': 'sales'},
            'no screens': {'screens': []},
            'eleven screens': {'screens': [form_body()['screens'][0]] * 11},
            'footer too long': screens(valid_input, footer_label='x' * 36),
            'heading too long': screens({'kind': 'heading', 'text': 'x' * 81}, valid_input),
        }
        for label, overrides in cases.items():
            result = self.create(**overrides)
            self.assertEqual((label, result.status_code), (label, 422), result.text)
        self.assertFalse(self.meta.bodies(f'{self.channel.business_account_id}/flows'))

    def test_too_many_choices_in_all_are_refused(self):
        screens = [{'title': 'T', 'footer_label': 'Go', 'fields': [
            choice('dropdown', f'd{i}', [f'option {n}' for n in range(200)]) for i in range(6)
        ]}]
        self.assertError(self.create(screens=screens), 422, 'invalid')

    def test_a_name_is_unique_per_channel(self):
        self.assertEqual(self.create().status_code, 201)
        taken = self.create()
        self.assertEqual((taken.status_code, taken.json().get('field')), (422, 'name'))
        other = self.make_channel(phone_id='100000000077')
        self.assertEqual(self.api('POST', f'{BASE}/channels/{other.id}/flows', form_body()).status_code, 201)

    # access

    def test_the_capability_works_alone_in_a_custom_role(self):
        self.login(self.flows_user)
        created = self.create()
        self.assertEqual(created.status_code, 201, created.text)
        flow = self.stored(created.json()['id'])
        self.assertEqual(self.api('POST', self.flow_path(flow, '/publish')).status_code, 200)
        self.assertEqual(self.get(self.flows).status_code, 200)
        self.assertEqual(self.get(self.flow_path(flow, '/preview')).status_code, 200)
        self.assertEqual(self.api('POST', f'{self.flows}/sync').status_code, 200)

    def test_pickers_read_and_only_flow_managers_write(self):
        flow = self.make_flow()
        for user in (self.agent, self.automation_user, self.templates_only):
            self.login(user)
            self.assertEqual(self.get(self.flows).status_code, 200, user.login)
            self.assertEqual(self.get(self.flow_path(flow)).json()['id'], flow.id)
            for method, path, body in (
                ('POST', self.flows, form_body()), ('PATCH', self.flow_path(flow), form_body()), ('DELETE', self.flow_path(flow), None),
                ('POST', self.flow_path(flow, '/publish'), None), ('POST', self.flow_path(flow, '/deprecate'), None),
                ('POST', self.flow_path(flow, '/copy'), {'name': 'n', 'replace': False}), ('GET', self.flow_path(flow, '/preview'), None),
                ('POST', f'{self.flows}/sync', None),
            ):
                self.assertError(self.api(method, path, body), 403, 'forbidden')
        self.login(self.outsider)
        self.assertError(self.get(self.flows), 403, 'forbidden')

    def test_the_sub_feature_closes_writes_and_retained_reads_stay_open(self):
        flow = self.make_flow()
        set_probe_feature(self, key='inbox.flows', enabled=False)
        for method, path, body in (('POST', self.flows, form_body()), ('POST', self.flow_path(flow, '/deprecate'), None)):
            self.assertEqual(self.api(method, path, body).status_code, 403)
        self.assertEqual(self.get(self.flows).status_code, 403)
        set_probe_feature(self, key='inbox.flows', enabled=False, retained=True)
        self.assertEqual(self.get(self.flows).status_code, 200)
        self.assertEqual(self.get(self.flow_path(flow)).status_code, 200)
        self.assertEqual(self.api('POST', self.flow_path(flow, '/deprecate')).status_code, 403)

    def test_the_inbox_feature_closes_every_route(self):
        flow = self.make_flow()
        set_probe_feature(self, key='inbox.enabled', enabled=False)
        self.assertEqual(self.get(self.flows).status_code, 403)
        self.assertEqual(self.get(self.flow_path(flow)).status_code, 403)

    def test_a_form_of_another_company_is_a_plain_404(self):
        company = self.env['res.company'].create({'name': 'Other company'})
        channel = self.make_channel(phone_id='100000000088', owner_company_id=company.id)
        foreign = self.make_flow(channel=channel)
        self.assertEqual(self.get(self.flow_path(foreign)).status_code, 404)
        self.assertEqual(self.get(f'{BASE}/channels/{channel.id}/flows').status_code, 404)
        self.assertEqual(self.api('POST', self.flow_path(foreign, '/publish')).status_code, 404)


@tagged('post_install', '-at_install', 'webvue')
class TestStarterForms(FlowCase):
    """The sector presets add starter forms as drafts that reach Meta only when their owner first saves them."""

    def apply(self, key, user):
        self.login(user)
        result = self.api('POST', f'/api/v1/settings/inbox/presets/{key}')
        self.assertEqual(result.status_code, 200, result.text)

    def starters(self, key):
        return self.env['webvue.inbox.flow'].search([('channel_id', '=', self.channel.id), ('name', 'in', [f['name'] for f in FLOW_STARTERS[key]])])

    def test_every_sector_adds_its_starters_as_unpublished_drafts_once(self):
        for key in FLOW_STARTERS:
            self.apply(key, self.manager)
            flows = self.starters(key)
            self.assertEqual(len(flows), len(FLOW_STARTERS[key]), key)
            for flow in flows:
                self.assertEqual((flow.status, flow.provider_flow_id, flow.supported, flow.editable), ('draft', False, True, True))
                self.assertFalse(flow.error_ids)
            self.apply(key, self.manager)
            self.assertEqual(self.starters(key), flows, key)
        self.assertFalse(self.meta.calls)

    def test_only_a_flows_manager_gets_the_starters(self):
        settings_only = self.custom_user('settings_only', 'inbox.settings.manage')
        self.apply('clinic', settings_only)
        self.assertFalse(self.starters('clinic'))
        self.apply('clinic', self.manager)
        self.assertTrue(self.starters('clinic'))

    def test_every_starter_is_a_valid_write_body(self):
        self.login(self.manager)
        for key, starters in FLOW_STARTERS.items():
            for starter in starters:
                result = self.api('POST', f'{BASE}/channels/{self.channel.id}/flows', {**starter, 'name': f'{starter["name"]} ({key})'})
                self.assertEqual(result.status_code, 201, result.text)

    def test_saving_a_starter_creates_the_meta_draft_and_publishing_pushes_first(self):
        self.apply('store', self.manager)
        flow = self.starters('store')[0]
        body = FLOW_STARTERS['store'][0]
        result = self.api('PATCH', f'{BASE}/flows/{flow.id}', body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(flow.provider_flow_id)
        self.assertEqual(len(self.meta.paths('POST', '/flows')), 1)
        other = self.make_flow(status='draft', provider_flow_id=False)
        self.assertEqual(self.api('POST', f'{BASE}/flows/{other.id}/publish').status_code, 200)
        self.assertTrue(other.provider_flow_id)
        self.assertEqual(other.status, 'published')

    def test_sync_keeps_a_draft_that_never_reached_meta(self):
        self.apply('store', self.manager)
        self.api('POST', f'{BASE}/channels/{self.channel.id}/flows/sync')
        self.assertTrue(self.starters('store'))
