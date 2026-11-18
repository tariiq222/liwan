# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from odoo.exceptions import AccessError, ConcurrencyError
from odoo.tests import new_test_user, tagged

from .automation_common import BASE, AutomationCase, all_day
from .common import PASSWORD
from odoo.addons.liwan_api.tests.common import cover_isolation_routes
from odoo.addons.liwan_inbox.models.agent import NOTE_RELEASED
from odoo.addons.liwan_inbox.models.automation import NOTE_ASSIGNEE_SKIPPED

AGENTS = f'{BASE}/agents'
AGENT_KEYS = {'id', 'name', 'available', 'in_shift', 'effective_available'}
# 2026-01-04 is a Sunday: 06:00 UTC is 09:00 in Riyadh (UTC+3), 14:00 UTC is 17:00.
SUNDAY_SHIFT = {'weekday': 6, 'from': '09:00', 'to': '17:00'}

cover_isolation_routes((f'{AGENTS}/<int:user_id>', f'{AGENTS}/<int:user_id>/shifts'), source='liwan_inbox/tests/test_agent_availability.py')


class AgentCase(AutomationCase):

    def set_available(self, user, available):
        self.env['liwan.inbox.agent']._liwan_set_available(user, self.env.company, available)

    def set_shifts(self, user, days):
        self.env['liwan.inbox.agent']._liwan_write_shifts(user, self.env.company, days)

    def state(self, user, at=None):
        return self.env['liwan.inbox.agent']._liwan_availability(user, self.env.company, at)[user.id]

    def new_conversation(self, number):
        message, _event = self.deliver('Hi', wa_id=f'96650003{number:04d}')
        return message.conversation_id

    def distribute(self, policy, members):
        self.settings.assignment_policy = policy
        self.department.member_ids = members
        self.channel.department_id = self.department

    def today_in_riyadh(self):
        return datetime.now(ZoneInfo('Asia/Riyadh')).weekday()


@tagged('post_install', '-at_install', 'liwan')
class TestAvailabilityEngine(AgentCase):

    def test_without_a_row_an_agent_is_available_and_in_shift(self):
        self.assertEqual(self.state(self.agent), (True, True))
        self.settings.agent_shifts_enabled = True
        self.assertEqual(self.state(self.agent), (True, True))

    def test_shifts_count_only_while_the_company_setting_is_on(self):
        self.set_shifts(self.agent, [{'weekday': (self.today_in_riyadh() + 1) % 7, 'from': '00:00', 'to': '24:00'}])
        self.assertEqual(self.state(self.agent), (True, True))
        self.settings.agent_shifts_enabled = True
        self.assertEqual(self.state(self.agent), (True, False))

    def test_the_shift_is_read_in_the_company_timezone(self):
        self.settings.agent_shifts_enabled = True
        self.set_shifts(self.agent, [SUNDAY_SHIFT])
        for moment, expected in (
            ('2026-01-04 05:59', False), ('2026-01-04 06:00', True), ('2026-01-04 13:59', True), ('2026-01-04 14:00', False),
            ('2026-01-05 07:00', False),
        ):
            self.assertEqual(self.state(self.agent, self.moment(moment))[1], expected, moment)

    def test_an_agent_without_ranges_is_always_in_shift_and_the_manual_status_still_counts(self):
        self.settings.agent_shifts_enabled = True
        self.set_available(self.agent, False)
        self.assertEqual(self.state(self.agent), (False, True))
        service = self.env['liwan.inbox.agent']
        self.assertFalse(service._liwan_available_agents(self.agent, self.env.company))
        self.assertEqual(service._liwan_available_agents(self.agent | self.agent2, self.env.company), self.agent2)

    def test_a_collision_with_a_concurrent_first_request_asks_for_a_replay(self):
        Agent = self.env['liwan.inbox.agent']
        first = Agent._liwan_row(self.agent, self.env.company)
        self.assertEqual(Agent._liwan_row(self.agent, self.env.company), first)
        with patch.object(type(Agent), 'search', return_value=Agent.browse()), self.assertRaises(ConcurrencyError):
            Agent._liwan_row(self.agent, self.env.company)
        self.assertEqual(Agent.search_count([('user_id', '=', self.agent.id)]), 1)

    def test_the_row_is_unique_per_agent_and_company(self):
        self.set_available(self.agent, False)
        self.set_available(self.agent, True)
        self.assertEqual(self.env['liwan.inbox.agent'].search_count([('user_id', '=', self.agent.id)]), 1)


@tagged('post_install', '-at_install', 'liwan')
class TestAutoAssignSkipsUnavailable(AgentCase):

    def test_round_robin_skips_an_unavailable_agent_and_keeps_the_turn_order(self):
        self.distribute('round_robin', self.agent | self.agent2 | self.supervisor)
        members = (self.agent | self.agent2 | self.supervisor).sorted('id')
        self.set_available(members[1], False)
        order = [self.new_conversation(number).assignee_id for number in range(1, 5)]
        self.assertEqual(order, [members[0], members[2], members[0], members[2]])
        self.set_available(members[1], True)
        self.assertEqual(self.new_conversation(5).assignee_id, members[0])
        self.assertEqual(self.new_conversation(6).assignee_id, members[1])

    def test_least_open_skips_an_unavailable_agent(self):
        self.distribute('least_open', self.agent | self.agent2)
        self.set_available(self.agent, False)
        picked = [self.new_conversation(number).assignee_id for number in range(1, 4)]
        self.assertEqual(picked, [self.agent2] * 3)

    def test_nobody_available_leaves_the_conversation_unassigned(self):
        for policy in ('round_robin', 'least_open'):
            self.distribute(policy, self.agent | self.agent2)
            self.set_available(self.agent, False)
            self.set_available(self.agent2, False)
            self.assertFalse(self.new_conversation(1 if policy == 'round_robin' else 2).assignee_id)

    def test_an_agent_outside_the_shift_is_skipped_only_while_shifts_are_on(self):
        self.distribute('round_robin', self.agent | self.agent2)
        self.set_shifts(self.agent, [all_day((self.today_in_riyadh() + 1) % 7)])
        first = self.new_conversation(1).assignee_id
        self.settings.agent_shifts_enabled = True
        later = [self.new_conversation(number).assignee_id for number in range(2, 4)]
        self.assertEqual(later, [self.agent2, self.agent2])
        self.assertIn(first, (self.agent, self.agent2))

    def test_an_agent_inside_the_shift_is_assigned(self):
        self.distribute('least_open', self.agent | self.agent2)
        self.settings.agent_shifts_enabled = True
        self.set_shifts(self.agent, [all_day(self.today_in_riyadh())])
        self.set_shifts(self.agent2, [all_day((self.today_in_riyadh() + 1) % 7)])
        self.assertEqual(self.new_conversation(1).assignee_id, self.agent)

    def test_a_rule_assignee_who_is_unavailable_is_skipped_with_a_note_and_distribution_proceeds(self):
        self.distribute('round_robin', self.agent)
        self.set_available(self.agent2, False)
        self.make_rule(match_kind='any', reply=None, assignee_id=self.agent2.id)
        conversation = self.new_conversation(1)
        self.assertEqual(conversation.assignee_id, self.agent)
        self.assertIn(NOTE_ASSIGNEE_SKIPPED % ('rule', self.agent2.name), self.notes(conversation))

    def test_a_rule_assignee_outside_the_shift_is_skipped(self):
        self.distribute('round_robin', self.agent)
        self.settings.agent_shifts_enabled = True
        self.set_shifts(self.agent2, [all_day((self.today_in_riyadh() + 1) % 7)])
        self.make_rule(match_kind='any', reply=None, assignee_id=self.agent2.id)
        conversation = self.new_conversation(1)
        self.assertEqual(conversation.assignee_id, self.agent)
        self.assertIn(NOTE_ASSIGNEE_SKIPPED % ('rule', self.agent2.name), self.notes(conversation))


@tagged('post_install', '-at_install', 'liwan')
class TestAgentsApi(AgentCase):

    def patch_status(self, user, body):
        return self.api('PATCH', f'{AGENTS}/{user.id}', body)

    def other_company_agent(self):
        company = self.env['res.company'].create({'name': 'Other company'})
        user = new_test_user(self.env, login='inbox_far_agent', password=PASSWORD, name='far', groups='liwan_core.group_employee')
        user.company_ids = [(4, company.id)]
        self.env['liwan.access.assignment'].sudo().create({
            'user_id': user.id, 'role_id': self.env.ref('liwan_inbox.role_inbox_agent').id, 'company_id': company.id,
        })
        return user

    def test_the_list_carries_each_agents_availability(self):
        self.set_available(self.agent2, False)
        self.login(self.agent)
        items = {row['name']: row for row in self.get(f'{AGENTS}').json()['items']}
        self.assertEqual(set(items['inbox_agent']), AGENT_KEYS)
        self.assertEqual(
            {key: items['inbox_agent'][key] for key in ('available', 'in_shift', 'effective_available')},
            {'available': True, 'in_shift': True, 'effective_available': True},
        )
        self.assertEqual(
            {key: items['inbox_agent2'][key] for key in ('available', 'in_shift', 'effective_available')},
            {'available': False, 'in_shift': True, 'effective_available': False},
        )
        self.settings.agent_shifts_enabled = True
        self.set_shifts(self.agent, [all_day((self.today_in_riyadh() + 1) % 7)])
        items = {row['name']: row for row in self.get(f'{AGENTS}').json()['items']}
        self.assertEqual(
            {key: items['inbox_agent'][key] for key in ('available', 'in_shift', 'effective_available')},
            {'available': True, 'in_shift': False, 'effective_available': False},
        )

    def test_settings_managers_and_reply_only_agents_can_list_the_agents(self):
        for login, permissions in (
            ('list_settings_only', ('inbox.settings.manage',)),
            ('list_reply_only', ('inbox.conversations.read', 'inbox.conversations.reply')),
        ):
            user = self.custom_user(login, *permissions)
            self.login(user)
            response = self.get(AGENTS)
            self.assertEqual(response.status_code, 200, f'{permissions}: {response.text}')
            self.assertEqual(set(response.json()['items'][0]), AGENT_KEYS)
        self.login(self.outsider)
        self.assertError(self.get(AGENTS), 403, 'forbidden')

    def test_one_agent_is_read_by_id(self):
        self.set_available(self.agent2, False)
        self.login(self.agent)
        response = self.get(f'{AGENTS}/{self.agent2.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            'id': self.agent2.id, 'name': 'inbox_agent2', 'available': False, 'in_shift': True, 'effective_available': False,
        })
        self.assertEqual(self.get(f'{AGENTS}/{self.agent.id}').json()['available'], True)
        self.login(self.manager)
        self.assertEqual(self.get(f'{AGENTS}/{self.agent2.id}').status_code, 200)

    def test_reading_one_agent_needs_a_capability_and_an_agent_of_the_company(self):
        self.login(self.outsider)
        self.assertError(self.get(f'{AGENTS}/{self.agent.id}'), 403, 'forbidden')
        far = self.other_company_agent()
        self.login(self.supervisor)
        self.assertError(self.get(f'{AGENTS}/{far.id}'), 404, 'not_found')
        self.assertError(self.get(f'{AGENTS}/{self.outsider.id}'), 404, 'not_found')
        self.assertError(self.get(f'{AGENTS}/999999999'), 404, 'not_found')

    def test_an_agent_toggles_their_own_status(self):
        self.login(self.agent)
        response = self.patch_status(self.agent, {'available': False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()), AGENT_KEYS)
        self.assertEqual((response.json()['id'], response.json()['available'], response.json()['effective_available']),
                         (self.agent.id, False, False))
        back = self.patch_status(self.agent, {'available': True})
        self.assertEqual((back.status_code, back.json()['available']), (200, True))

    def test_a_supervisor_toggles_anyones_status(self):
        self.login(self.supervisor)
        response = self.patch_status(self.agent2, {'available': False})
        self.assertEqual((response.status_code, response.json()['available']), (200, False))
        self.assertEqual(self.state(self.agent2), (False, True))

    def test_an_agent_cannot_toggle_another_agent_and_a_reader_cannot_toggle_anyone(self):
        self.login(self.agent)
        self.assertError(self.patch_status(self.agent2, {'available': False}), 403, 'forbidden')
        self.login(self.reader_only)
        self.assertError(self.patch_status(self.reader_only, {'available': False}), 403, 'forbidden')
        self.login(self.outsider)
        self.assertError(self.patch_status(self.agent, {'available': False}), 403, 'forbidden')
        self.assertEqual(self.state(self.agent2), (True, True))

    def test_a_user_who_is_not_an_agent_of_the_company_is_not_found(self):
        far = self.other_company_agent()
        self.login(self.supervisor)
        self.assertError(self.patch_status(far, {'available': False}), 404, 'not_found')
        self.assertError(self.patch_status(self.outsider, {'available': False}), 404, 'not_found')
        self.assertError(self.api('PATCH', f'{AGENTS}/999999999', {'available': False}), 404, 'not_found')

    def test_a_bad_status_body_is_invalid(self):
        self.login(self.agent)
        for bad in ({}, {'available': 'no'}, {'available': 0}, {'available': None}, {'available': True, 'extra': 1}, {'name': 'x'}):
            self.assertError(self.patch_status(self.agent, bad), 422, 'invalid')

    def test_manual_assignment_stays_allowed_for_an_unavailable_agent(self):
        self.set_available(self.agent, False)
        conversation = self.make_conversation(state='open')
        self.login(self.supervisor)
        assigned = self.patch_conversation(conversation, {'assignee_id': self.agent.id})
        self.assertEqual((assigned.status_code, assigned.json()['assignee']['id']), (200, self.agent.id))

    def test_the_status_row_is_writable_by_its_agent_and_not_by_another_agent(self):
        self.set_available(self.agent2, False)
        Agent = self.env['liwan.inbox.agent']
        other = Agent.search([('user_id', '=', self.agent2.id)])
        with self.assertRaises(AccessError):
            other.with_user(self.agent).write({'available': True})
        other.with_user(self.supervisor).write({'available': True})
        self.assertTrue(other.available)


@tagged('post_install', '-at_install', 'liwan')
class TestAgentShiftsApi(AgentCase):

    def shifts(self, user):
        return f'{AGENTS}/{user.id}/shifts'

    def test_shifts_start_empty_and_put_replaces_them(self):
        self.login(self.manager)
        empty = self.get(self.shifts(self.agent))
        self.assertEqual((empty.status_code, empty.json()), (200, {'ranges': []}))
        ranges = [SUNDAY_SHIFT, {'weekday': 0, 'from': '08:30', 'to': '12:00'}, {'weekday': 0, 'from': '12:00', 'to': '16:00'}]
        saved = self.api('PUT', self.shifts(self.agent), {'ranges': ranges})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(set(saved.json()), {'ranges'})
        self.assertEqual(sorted(saved.json()['ranges'], key=lambda row: (row['weekday'], row['from'])), [ranges[1], ranges[2], ranges[0]])
        replaced = self.api('PUT', self.shifts(self.agent), {'ranges': [SUNDAY_SHIFT]})
        self.assertEqual(replaced.json(), {'ranges': [SUNDAY_SHIFT]})
        self.assertEqual(self.get(self.shifts(self.agent)).json(), {'ranges': [SUNDAY_SHIFT]})
        self.assertEqual(self.get(self.shifts(self.agent2)).json(), {'ranges': []})
        cleared = self.api('PUT', self.shifts(self.agent), {'ranges': []})
        self.assertEqual(cleared.json(), {'ranges': []})

    def test_a_saved_shift_decides_who_is_in_shift(self):
        self.login(self.manager)
        self.api('PATCH', '/api/v1/settings/inbox', {'agent_shifts_enabled': True})
        self.api('PUT', self.shifts(self.agent), {'ranges': [all_day((self.today_in_riyadh() + 1) % 7)]})
        self.assertEqual(self.state(self.agent), (True, False))
        self.api('PUT', self.shifts(self.agent), {'ranges': [all_day(self.today_in_riyadh())]})
        self.assertEqual(self.state(self.agent), (True, True))

    def test_the_shift_routes_need_the_settings_capability(self):
        for user in (self.agent, self.supervisor, self.outsider):
            self.login(user)
            self.assertError(self.get(self.shifts(self.agent)), 403, 'forbidden')
            self.assertError(self.api('PUT', self.shifts(self.agent), {'ranges': []}), 403, 'forbidden')

    def test_a_bad_shift_body_is_invalid(self):
        self.login(self.manager)
        for bad in (
            {}, {'ranges': None}, {'ranges': {}}, {'ranges': [], 'extra': 1},
            {'ranges': [{'weekday': 7, 'from': '09:00', 'to': '10:00'}]},
            {'ranges': [{'weekday': 0, 'from': '10:00', 'to': '09:00'}]},
            {'ranges': [{'weekday': 0, 'from': '09:00', 'to': '09:00'}]},
            {'ranges': [{'weekday': 0, 'from': '9:00', 'to': '10:00'}]},
            {'ranges': [{'weekday': 0, 'from': '09:00'}]},
            {'ranges': [{'weekday': 0, 'from': '09:00', 'to': '10:00', 'x': 1}]},
            {'ranges': [{'weekday': 0, 'from': '09:00', 'to': '11:00'}, {'weekday': 0, 'from': '10:00', 'to': '12:00'}]},
            {'ranges': [{'weekday': day % 7, 'from': f'{day // 7:02d}:00', 'to': f'{day // 7:02d}:30'} for day in range(43)]},
        ):
            self.assertError(self.api('PUT', self.shifts(self.agent), bad), 422, 'invalid')
        self.assertEqual(self.get(self.shifts(self.agent)).json(), {'ranges': []})

    def test_a_user_who_is_not_an_agent_of_the_company_has_no_shifts(self):
        self.login(self.manager)
        self.assertError(self.get(self.shifts(self.outsider)), 404, 'not_found')
        self.assertError(self.api('PUT', self.shifts(self.outsider), {'ranges': []}), 404, 'not_found')
        self.assertError(self.get(f'{AGENTS}/999999999/shifts'), 404, 'not_found')

    def test_a_settings_manager_writes_agent_shifts_but_not_the_company_hours(self):
        Range = self.env['liwan.inbox.hours.range']
        self.set_shifts(self.agent, [SUNDAY_SHIFT])
        shift = Range.search([('agent_id.user_id', '=', self.agent.id)])
        company_hours = Range.create({'settings_id': self.settings.id, 'weekday': 1, 'start_minute': 60, 'end_minute': 120})
        settings_only = self.custom_user('settings_only', 'inbox.settings.manage')
        shift.with_user(settings_only).write({'end_minute': 1000})
        with self.assertRaises(AccessError):
            company_hours.with_user(settings_only).write({'end_minute': 1000})
        automation = self.automation_user
        company_hours.with_user(automation).write({'end_minute': 130})
        self.assertEqual(company_hours.end_minute, 130)

    def test_a_range_has_exactly_one_owner(self):
        Range = self.env['liwan.inbox.hours.range']
        row = self.env['liwan.inbox.agent']._liwan_row(self.agent, self.env.company)
        with self.assertRaises(Exception), self.cr.savepoint():  # noqa: B017
            Range.create({'agent_id': row.id, 'settings_id': self.settings.id, 'weekday': 1, 'start_minute': 0, 'end_minute': 60})
            self.env.flush_all()


@tagged('post_install', '-at_install', 'liwan')
class TestUnavailableRelease(AgentCase):

    def assigned(self, state='open'):
        return self.make_conversation(state=state, assignee_id=self.agent.id)

    def test_keep_leaves_the_conversations_with_the_agent(self):
        conversation = self.assigned()
        self.login(self.agent)
        self.assertEqual(self.api('PATCH', f'{AGENTS}/{self.agent.id}', {'available': False}).status_code, 200)
        self.assertEqual(self.reload(conversation).assignee_id, self.agent)

    def test_release_takes_open_and_pending_conversations_off_the_agent_with_a_note(self):
        self.settings.unavailable_release = 'release'
        opened, pending, resolved = self.assigned(), self.assigned('pending'), self.assigned('resolved')
        mine_elsewhere = self.make_conversation(state='open', assignee_id=self.agent2.id)
        self.login(self.agent)
        self.assertEqual(self.api('PATCH', f'{AGENTS}/{self.agent.id}', {'available': False}).status_code, 200)
        self.assertEqual([self.reload(opened).assignee_id.id, self.reload(pending).assignee_id.id], [False, False])
        self.assertEqual(self.reload(resolved).assignee_id, self.agent)
        self.assertEqual(self.reload(mine_elsewhere).assignee_id, self.agent2)
        self.assertIn(NOTE_RELEASED % self.agent.name, self.notes(opened))
        self.assertIn(NOTE_RELEASED % self.agent.name, self.notes(pending))
        self.assertNotIn(NOTE_RELEASED % self.agent.name, self.notes(resolved))

    def test_an_assign_only_user_releases_another_agents_conversations_and_the_bus_is_told(self):
        self.settings.unavailable_release = 'release'
        conversation = self.assigned()
        assigner = self.custom_user('assign_only', 'inbox.conversations.read', 'inbox.conversations.assign')
        self.login(assigner)
        model = type(self.env['liwan.inbox.conversation'])
        with patch.object(model, '_liwan_notify_bus', autospec=True) as notify:
            response = self.api('PATCH', f'{AGENTS}/{self.agent.id}', {'available': False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(self.reload(conversation).assignee_id)
        self.assertIn(NOTE_RELEASED % self.agent.name, self.notes(conversation))
        self.assertIn(conversation.id, {record.id for call in notify.call_args_list for record in call.args[0]})

    def test_an_assigner_creates_internal_notes_but_no_customer_messages(self):
        assigner = self.custom_user('note_only', 'inbox.conversations.read', 'inbox.conversations.assign')
        conversation = self.assigned()
        Message = self.env['liwan.inbox.message'].with_user(assigner)
        values = {'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'body': 'x', 'delivery_state': 'sent'}
        self.assertTrue(Message.create({**values, 'direction': 'note'}))
        with self.assertRaises(AccessError):
            Message.create({**values, 'direction': 'out'})

    def test_release_runs_only_when_the_agent_goes_from_available_to_unavailable(self):
        self.settings.unavailable_release = 'release'
        self.set_available(self.agent, False)
        conversation = self.assigned()
        self.set_available(self.agent, False)
        self.assertEqual(self.reload(conversation).assignee_id, self.agent)
        self.set_available(self.agent, True)
        self.assertEqual(self.reload(conversation).assignee_id, self.agent)

    def test_a_supervisor_switching_an_agent_off_releases_too(self):
        self.settings.unavailable_release = 'release'
        conversation = self.assigned()
        self.login(self.supervisor)
        self.assertEqual(self.api('PATCH', f'{AGENTS}/{self.agent.id}', {'available': False}).status_code, 200)
        self.assertFalse(self.reload(conversation).assignee_id)

    def test_the_customers_next_message_assigns_a_released_conversation_to_an_available_agent(self):
        self.distribute('round_robin', self.agent | self.agent2)
        self.settings.unavailable_release = 'release'
        conversation = self.new_conversation(1)
        self.assertEqual(conversation.assignee_id, self.agent)
        self.set_available(self.agent, False)
        self.assertFalse(self.reload(conversation).assignee_id)
        message, _event = self.deliver('Still there?', wa_id='966500030001')
        self.assertEqual(message.conversation_id, conversation)
        self.assertEqual(self.reload(conversation).assignee_id, self.agent2)

    def test_the_end_of_a_shift_releases_nothing(self):
        self.settings.unavailable_release = 'release'
        self.settings.agent_shifts_enabled = True
        conversation = self.assigned()
        self.set_shifts(self.agent, [all_day((self.today_in_riyadh() + 1) % 7)])
        self.assertEqual(self.state(self.agent), (True, False))
        self.assertEqual(self.reload(conversation).assignee_id, self.agent)
