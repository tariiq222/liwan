# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .automation_common import BASE, RULE_BODY, RULE_KEYS, AutomationCase, hours
from .common import PASSWORD
from odoo.addons.webvue_api.tests.common import set_probe_feature

RULES = f'{BASE}/rules'
TEST = f'{RULES}/test'
BUTTONS = {
    'type': 'buttons', 'body': 'Which service?', 'header': None, 'footer': None,
    'buttons': [{'id': 'x', 'title': 'X'}, {'id': 'y', 'title': 'Y'}],
}


@tagged('post_install', '-at_install', 'webvue')
class TestRulesApi(AutomationCase):

    def setUp(self):
        super().setUp()
        self.login(self.automation_user)

    def create(self, **overrides):
        return self.api('POST', RULES, {**RULE_BODY, **overrides})

    def test_create_returns_201_with_the_contract_shape(self):
        tag = self.env['webvue.inbox.tag'].create({'name': 'Hot'})
        result = self.create(
            channel_id=self.channel.id, keywords=['Price', 'السعر'], department_id=self.department.id,
            assignee_id=self.agent.id, tag_ids=[tag.id], priority='high', resolve=True,
        )
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual(set(body), RULE_KEYS)
        self.assertEqual(body['channel'], {'id': self.channel.id, 'name': self.channel.name})
        self.assertEqual(body['keywords'], ['Price', 'السعر'])
        self.assertEqual(body['reply'], {'body': 'See our price list'})
        self.assertEqual((body['department']['id'], body['assignee']['id'], body['tags'], body['priority']), (
            self.department.id, self.agent.id, [{'id': tag.id, 'name': 'Hot'}], 'high'))
        self.assertEqual((body['hours'], body['stop'], body['active'], body['resolve'], body['option_id']), ('any', True, True, True, None))
        self.assertEqual(self.get(f'{RULES}/{body["id"]}').json(), body)

    def test_new_rules_go_last_and_the_list_keeps_inactive_ones(self):
        first = self.create(name='First').json()
        second = self.create(name='Second', active=False).json()
        self.assertGreater(second['sequence'], first['sequence'])
        listing = self.get(RULES).json()
        self.assertEqual((listing['total'], [item['name'] for item in listing['items']]), (2, ['First', 'Second']))
        self.assertFalse(listing['items'][1]['active'])

    def test_an_option_rule_with_an_interactive_reply(self):
        result = self.create(
            name='Menu', match_kind='option', keywords=[], option_id='x', reply={'interactive': BUTTONS},
        )
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual((result.json()['option_id'], result.json()['reply']), ('x', {'interactive': BUTTONS}))

    def test_patch_changes_only_what_it_names(self):
        rule = self.create(keywords=['price'], department_id=self.department.id).json()
        path = f'{RULES}/{rule["id"]}'
        patched = self.api('PATCH', path, {'name': 'Renamed', 'active': False, 'keywords': ['cost', 'fee']}).json()
        self.assertEqual((patched['name'], patched['active'], patched['keywords']), ('Renamed', False, ['cost', 'fee']))
        self.assertEqual((patched['department'], patched['reply']), (rule['department'], rule['reply']))
        self.assertEqual(self.api('PATCH', path, {'reply': None, 'priority': 'low'}).json()['reply'], None)
        self.assertEqual(self.api('PATCH', path, {'reply': {'body': 'Hi'}}).json()['reply'], {'body': 'Hi'})
        self.assertEqual(self.api('PATCH', path, {'department_id': None}).json()['department'], None)
        self.assertEqual(self.env['webvue.inbox.auto.message'].search_count([('rule_id', '=', rule['id'])]), 1)

    def test_delete_removes_the_rule_and_its_parts(self):
        rule = self.create(keywords=['price']).json()
        path = f'{RULES}/{rule["id"]}'
        self.assertEqual(self.api('DELETE', path).status_code, 204)
        self.assertError(self.get(path), 404, 'not_found')
        self.assertFalse(self.env['webvue.inbox.rule.keyword'].search([('rule_id', '=', rule['id'])]))
        self.assertFalse(self.env['webvue.inbox.auto.message'].search([('rule_id', '=', rule['id'])]))

    def test_invalid_rules_are_rejected(self):
        tag = self.env['webvue.inbox.tag'].create({'name': 'Hot'})
        for bad in (
            {'keywords': []}, {'match_kind': 'option'}, {'match_kind': 'option', 'keywords': [], 'option_id': ''},
            {'match_kind': 'any', 'keywords': ['x']}, {'match_kind': 'any', 'keywords': [], 'option_id': 'x'},
            {'option_id': 'x'}, {'match_kind': 'regex'}, {'hours': 'sometimes'}, {'priority': 'asap'},
            {'reply': None}, {'reply': {}}, {'reply': {'body': ''}}, {'reply': {'body': 'a', 'interactive': BUTTONS}},
            {'name': ''}, {'name': 'x' * 129}, {'active': 'yes'}, {'stop': None}, {'resolve': 1},
            {'keywords': ['']}, {'keywords': ['  ']}, {'keywords': ['x'] * 51}, {'keywords': ['x' * 129]},
            {'channel_id': 999999}, {'department_id': 999999}, {'assignee_id': 999999}, {'assignee_id': self.outsider.id},
            {'tag_ids': [999999]}, {'tag_ids': [tag.id] * 1 + list(range(900000, 900021))}, {'tag_ids': 'x'},
            {'extra': 1},
        ):
            self.assertError(self.create(**bad), 422, 'invalid')
        missing = {key: value for key, value in RULE_BODY.items() if key != 'priority'}
        self.assertError(self.api('POST', RULES, missing), 422, 'invalid')
        self.assertFalse(self.env['webvue.inbox.rule'].search([]))

    def test_a_patch_is_checked_against_the_stored_rule(self):
        rule = self.create(keywords=['price']).json()
        path = f'{RULES}/{rule["id"]}'
        for bad in ({'match_kind': 'option'}, {'keywords': []}, {'reply': None}, {}, {'option_id': 'x'}, {'channel_id': 999999}):
            self.assertError(self.api('PATCH', path, bad), 422, 'invalid')

    def test_reorder_sets_the_evaluation_order(self):
        ids = [self.create(name=name).json()['id'] for name in ('A', 'B', 'C')]
        result = self.api('POST', f'{RULES}/reorder', {'ids': [ids[2], ids[0], ids[1]]})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual([item['id'] for item in result.json()['items']], [ids[2], ids[0], ids[1]])
        self.assertEqual([item['id'] for item in self.get(RULES).json()['items']], [ids[2], ids[0], ids[1]])
        for bad in ({'ids': ids[:2]}, {'ids': ids + [ids[0]]}, {'ids': ids + [999999]}, {'ids': []}, {'ids': 'x'}, {}, {'ids': [0, 1, 2]}):
            self.assertError(self.api('POST', f'{RULES}/reorder', bad), 422, 'invalid')

    def test_the_list_returns_every_rule_up_to_the_reorder_cap(self):
        Rule = self.env['webvue.inbox.rule']
        for index in range(210):
            self.make_rule(name=f'Rule {index}', match_kind='any', sequence=index)
        default = self.get(RULES).json()
        self.assertEqual((len(default['items']), default['total']), (50, 210))
        whole = self.get(f'{RULES}?limit=500').json()
        self.assertEqual((len(whole['items']), whole['total']), (210, 210))
        reorder = self.api('POST', f'{RULES}/reorder', {'ids': [item['id'] for item in reversed(whole['items'])]})
        self.assertEqual(reorder.status_code, 200, reorder.text)
        self.assertEqual(Rule.search_count([]), 210)

    def test_the_dry_run_names_the_rules_without_writing_anything(self):
        self.create(name='Price', keywords=['السعر'], stop=False)
        self.create(name='Everything', match_kind='any', keywords=[], stop=True)
        self.create(name='Never reached', match_kind='any', keywords=[])
        before = self.env['webvue.inbox.message'].search_count([])
        body = {'channel_id': self.channel.id, 'text': 'كم السِّعر', 'option_id': None, 'flow_id': None, 'at': None}
        result = self.api('POST', TEST, body)
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        self.assertEqual(set(data), {'inside_hours', 'auto_message', 'rules'})
        self.assertEqual((data['inside_hours'], data['auto_message']), (True, None))
        self.assertEqual([rule['name'] for rule in data['rules']], ['Price', 'Everything'])
        self.assertEqual([rule['name'] for rule in self.api('POST', TEST, {**body, 'text': 'x'}).json()['rules']], ['Everything'])
        self.assertEqual(self.env['webvue.inbox.message'].search_count([]), before)

    def test_the_dry_run_matches_options_and_reports_hours_and_greetings(self):
        self.create(name='Menu', match_kind='option', keywords=[], option_id='x')
        self.channel._webvue_set_auto_message('welcome', {'body': 'Welcome'})
        self.channel._webvue_set_auto_message('away', {'body': 'Closed'})
        self.channel.write({'welcome_enabled': True, 'away_enabled': True})
        self.set_company_hours(hours([{'weekday': 6, 'from': '09:00', 'to': '17:00'}], timezone='Asia/Riyadh'))
        base = {'channel_id': self.channel.id, 'text': None, 'option_id': 'x', 'flow_id': None}
        inside = self.api('POST', TEST, {**base, 'at': '2026-01-04T10:00:00Z'}).json()
        self.assertEqual((inside['inside_hours'], inside['auto_message'], [rule['name'] for rule in inside['rules']]), (True, 'welcome', ['Menu']))
        outside = self.api('POST', TEST, {**base, 'option_id': 'z', 'at': '2026-01-04T03:00:00Z'}).json()
        self.assertEqual((outside['inside_hours'], outside['auto_message'], outside['rules']), (False, 'away', []))

    def test_invalid_dry_runs_are_rejected(self):
        ok = {'channel_id': self.channel.id, 'text': 'x', 'option_id': None, 'flow_id': None, 'at': None}
        for bad in (
            {**ok, 'channel_id': 999999}, {**ok, 'at': '2026-01-04'}, {**ok, 'text': 'x' * 4097}, {**ok, 'option_id': ''},
            {key: value for key, value in ok.items() if key != 'at'}, {**ok, 'extra': 1}, {},
        ):
            self.assertError(self.api('POST', TEST, bad), 422, 'invalid')


@tagged('post_install', '-at_install', 'webvue')
class TestRulesAccess(AutomationCase):

    def setUp(self):
        super().setUp()
        self.rule = self.make_rule(name='Existing', keywords=['hi'])

    def routes(self):
        path = f'{RULES}/{self.rule.id}'
        return (
            ('GET', RULES, None), ('GET', path, None), ('PATCH', path, {'name': 'New'}),
            ('POST', f'{RULES}/reorder', {'ids': [self.rule.id]}),
            ('POST', TEST, {'channel_id': self.channel.id, 'text': 'x', 'option_id': None, 'flow_id': None, 'at': None}),
            ('POST', RULES, RULE_BODY), ('DELETE', path, None),
        )

    def test_only_the_automation_capability_opens_the_routes(self):
        for user in (self.agent, self.supervisor, self.reader_only, self.outsider, self.custom_user('settings_only', 'inbox.settings.manage')):
            self.login(user)
            for method, path, body in self.routes():
                self.assertError(self.api(method, path, body), 403, 'forbidden')
        self.assertTrue(self.rule.exists())
        self.login(self.automation_user)
        statuses = [self.api(method, path, body).status_code for method, path, body in self.routes()]
        self.assertEqual(statuses, [200, 200, 200, 200, 200, 201, 204])

    def test_the_feature_closes_the_routes(self):
        self.login(self.manager)
        set_probe_feature(self, key='inbox.automation', enabled=False)
        for method, path, body in self.routes():
            self.assertError(self.api(method, path, body), 403, 'feature_not_included')

    def test_a_settings_manager_still_manages_the_policy_without_automation(self):
        user = self.custom_user('settings_only_policy', 'inbox.settings.manage')
        self.login(user)
        result = self.api('PATCH', '/api/v1/settings/inbox', {'assignment_policy': 'round_robin', 'first_response_alert_minutes': 5})
        self.assertEqual((result.status_code, result.json()['assignment_policy']), (200, 'round_robin'))


@tagged('post_install', '-at_install', 'webvue')
class TestRulesCompanyScope(AutomationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.child = cls.env['res.company'].create({'name': 'Rules child company', 'parent_id': cls.env.company.id})
        cls.child_channel = cls.make_channel(phone_id='830000000001', owner_company_id=cls.child.id)
        cls.child_rule = cls.make_rule(name='Child rule', company_id=cls.child.id, keywords=['hi'])
        cls.parent_rule = cls.make_rule(name='Parent rule', keywords=['hi'])
        cls.child_manager = new_test_user(
            cls.env, login='rules_child_manager', password=PASSWORD, name='Child manager', groups='base.group_user',
            company_id=cls.env.company.id, company_ids=[Command.set((cls.env.company | cls.child).ids)],
        )
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.child_manager.id, 'company_id': cls.child.id,
            'role_id': cls.env.ref('webvue_inbox.role_inbox_manager').id,
        })

    def test_another_company_rule_is_not_found_for_every_route(self):
        self.login(self.manager)
        path = f'{RULES}/{self.child_rule.id}'
        for method, body in (('GET', None), ('PATCH', {'name': 'x'}), ('DELETE', None)):
            self.assertError(self.api(method, path, body), 404, 'not_found')
        self.assertTrue(self.child_rule.exists())
        self.assertEqual([item['name'] for item in self.get(RULES).json()['items']], ['Parent rule'])

    def test_a_rule_cannot_name_another_company_channel_department_or_tag(self):
        self.login(self.manager)
        child_department = self.env['webvue.inbox.department'].create({'name': 'Child dept', 'company_id': self.child.id})
        child_tag = self.env['webvue.inbox.tag'].create({'name': 'Child tag', 'company_id': self.child.id})
        for bad in ({'channel_id': self.child_channel.id}, {'department_id': child_department.id}, {'tag_ids': [child_tag.id]}):
            self.assertError(self.api('POST', RULES, {**RULE_BODY, **bad}), 422, 'invalid')
        body = {'channel_id': self.child_channel.id, 'text': 'x', 'option_id': None, 'flow_id': None, 'at': None}
        self.assertError(self.api('POST', TEST, body), 422, 'invalid')
        self.assertError(self.api('PATCH', f'{RULES}/{self.parent_rule.id}', {'channel_id': self.child_channel.id}), 422, 'invalid')
        self.assertError(self.api('POST', f'{RULES}/reorder', {'ids': [self.parent_rule.id, self.child_rule.id]}), 422, 'invalid')

    def test_the_child_manager_cannot_put_a_rule_on_a_company_it_is_not_working_in(self):
        self.login(self.child_manager)
        for bad in ({'channel_id': self.child_channel.id}, {}):
            result = self.api('POST', RULES, {**RULE_BODY, **bad})
            self.assertIn(result.status_code, (403, 422), result.text)
        self.assertEqual(self.env['webvue.inbox.rule'].search_count([('name', '=', RULE_BODY['name'])]), 0)
        self.assertNotIn(self.parent_rule.id, [item['id'] for item in self.get(RULES).json()['items']])
