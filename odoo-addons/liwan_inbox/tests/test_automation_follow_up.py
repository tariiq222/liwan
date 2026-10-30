# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo.tests import tagged

from .automation_common import AutomationCase
from odoo.addons.liwan_inbox.models.automation import NOTE_ASSIGNEE_SKIPPED
from odoo.addons.liwan_inbox.models.constants import FIRST_RESPONSE_CRON_BATCH
from odoo.addons.liwan_inbox.models.notification_types import FIRST_RESPONSE_KIND


@tagged('post_install', '-at_install', 'liwan')
class TestAssignmentPolicy(AutomationCase):

    def new_conversation(self, number):
        message, _event = self.deliver('Hi', wa_id=f'96650002{number:04d}')
        return message.conversation_id

    def test_manual_leaves_the_conversation_unassigned(self):
        self.assertFalse(self.new_conversation(1).assignee_id)

    def test_round_robin_cycles_through_the_department_members(self):
        self.settings.assignment_policy = 'round_robin'
        self.department.member_ids = self.agent | self.agent2
        self.channel.department_id = self.department
        order = [self.new_conversation(number).assignee_id for number in range(1, 5)]
        self.assertEqual(order, [self.agent, self.agent2, self.agent, self.agent2])
        self.assertEqual(self.department.round_robin_user_id, self.agent2)

    def test_round_robin_without_a_department_keeps_its_pointer_on_the_settings(self):
        self.settings.assignment_policy = 'round_robin'
        probe = self.new_conversation(1)
        agents = probe._liwan_agents().sorted('id')
        assigned = [probe.assignee_id] + [self.new_conversation(number).assignee_id for number in range(2, len(agents) + 2)]
        self.assertEqual(assigned, [agents[index % len(agents)] for index in range(len(agents) + 1)])
        self.assertEqual(self.settings.round_robin_user_id, assigned[-1])

    def test_least_open_picks_the_agent_with_the_fewest_open_conversations(self):
        self.settings.assignment_policy = 'least_open'
        self.department.member_ids = self.agent | self.agent2
        self.channel.department_id = self.department
        for _index in range(2):
            self.make_conversation(assignee_id=self.agent.id)
        picked = [self.new_conversation(number).assignee_id for number in range(1, 5)]
        self.assertEqual(picked, [self.agent2, self.agent2, self.agent, self.agent2])

    def test_a_conversation_assigned_by_a_rule_keeps_it_and_the_agent_is_notified(self):
        self.settings.assignment_policy = 'round_robin'
        self.make_rule(match_kind='any', reply=None, assignee_id=self.agent2.id)
        conversation = self.new_conversation(1)
        self.assertEqual(conversation.assignee_id, self.agent2)
        bell = self.env['mail.message'].search([('liwan_notification_kind', '=', 'inbox.assigned'), ('res_id', '=', conversation.id)])
        self.assertEqual(len(bell), 1)

    def test_a_rule_assignee_who_lost_the_reply_capability_is_skipped_and_auto_assignment_proceeds(self):
        self.settings.assignment_policy = 'round_robin'
        self.department.member_ids = self.agent
        self.channel.department_id = self.department
        self.make_rule(match_kind='any', reply=None, assignee_id=self.outsider.id)
        conversation = self.new_conversation(1)
        self.assertEqual(conversation.assignee_id, self.agent)
        self.assertIn(NOTE_ASSIGNEE_SKIPPED % ('rule', self.outsider.name), self.notes(conversation))

    def test_a_conversation_the_rules_resolved_is_not_auto_assigned(self):
        self.settings.assignment_policy = 'round_robin'
        self.make_rule(match_kind='any', reply=None, resolve=True)
        conversation = self.new_conversation(1)
        self.assertEqual((conversation.state, conversation.assignee_id.id), ('resolved', False))

    def test_a_department_with_members_who_cannot_reply_leaves_it_unassigned(self):
        self.settings.assignment_policy = 'least_open'
        self.department.member_ids = self.outsider
        self.channel.department_id = self.department
        self.assertEqual(self.new_conversation(1).assignee_id.id, False)


@tagged('post_install', '-at_install', 'liwan')
class TestFirstResponseAlert(AutomationCase):

    def alerts(self, conversation):
        return self.env['mail.message'].search([
            ('liwan_notification_kind', '=', FIRST_RESPONSE_KIND), ('res_id', '=', conversation.id),
        ])

    def run_cron(self):
        self.env['liwan.inbox.conversation']._liwan_run_first_response_alerts()

    def test_the_assignee_is_alerted_once_per_waiting_period(self):
        self.settings.first_response_alert_minutes = 10
        conversation = self.make_conversation(minutes_ago=15, assignee_id=self.agent.id)
        self.run_cron()
        self.assertEqual(len(self.alerts(conversation)), 1)
        self.assertTrue(conversation.first_response_alerted)
        before = self.alerts(conversation)
        self.run_cron()
        self.assertEqual(self.alerts(conversation), before)

    def test_a_new_waiting_period_is_alerted_again(self):
        self.settings.first_response_alert_minutes = 10
        conversation = self.make_conversation(minutes_ago=60, assignee_id=self.agent.id)
        self.run_cron()
        self.assertTrue(conversation.first_response_alerted)
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out', 'body': 'Hi',
            'author_id': self.agent.id, 'delivery_state': 'sent', 'date': self.minutes_ago(40),
        })
        self.assertFalse(conversation.first_response_alerted)
        self.assertFalse(conversation.waiting_since)
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'in', 'body': 'And?',
            'delivery_state': 'received', 'date': self.minutes_ago(20),
        })
        self.assertEqual(conversation.waiting_since, self.reload(conversation).waiting_since)
        self.run_cron()
        self.assertTrue(conversation.first_response_alerted)
        self.assertEqual(len(self.alerts(conversation)), 1)

    def test_no_alert_when_off_when_recent_or_when_an_agent_replied(self):
        waiting = self.make_conversation(minutes_ago=15, assignee_id=self.agent.id)
        self.run_cron()
        self.assertFalse(self.alerts(waiting))
        self.settings.first_response_alert_minutes = 30
        self.run_cron()
        self.assertFalse(self.alerts(waiting))
        self.settings.first_response_alert_minutes = 10
        answered = self.make_conversation(minutes_ago=20, assignee_id=self.agent.id)
        self.env['liwan.inbox.message'].create({
            'conversation_id': answered.id, 'company_id': answered.company_id.id, 'direction': 'out', 'body': 'Hi',
            'author_id': self.agent.id, 'delivery_state': 'sent', 'date': self.minutes_ago(5),
        })
        self.run_cron()
        self.assertFalse(self.alerts(answered))
        self.assertTrue(self.alerts(waiting))

    def test_an_unassigned_conversation_alerts_its_department_members(self):
        self.settings.first_response_alert_minutes = 10
        self.department.member_ids = self.agent | self.agent2
        conversation = self.make_conversation(minutes_ago=15, department_id=self.department.id)
        self.run_cron()
        self.assertEqual(
            set(self.alerts(conversation).mapped('liwan_notification_key')),
            {f'{FIRST_RESPONSE_KIND}:{conversation.id}:{user.partner_id.id}' for user in self.agent | self.agent2},
        )

    def test_resolved_conversations_and_a_closed_sub_feature_do_not_alert(self):
        self.settings.first_response_alert_minutes = 10
        resolved = self.make_conversation(minutes_ago=15, assignee_id=self.agent.id, state='resolved')
        self.run_cron()
        self.assertFalse(self.alerts(resolved))

    def test_many_recent_conversations_do_not_hide_a_waiting_one(self):
        self.settings.first_response_alert_minutes = 10
        for _index in range(FIRST_RESPONSE_CRON_BATCH + 5):
            self.make_conversation(minutes_ago=2, assignee_id=self.agent.id)
        waiting = self.make_conversation(minutes_ago=15, assignee_id=self.agent.id)
        self.run_cron()
        self.assertEqual(len(self.alerts(waiting)), 1)

    def test_waiting_since_is_the_first_unanswered_message(self):
        conversation = self.make_conversation(minutes_ago=30)
        second = self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'in', 'body': 'again',
            'delivery_state': 'received', 'date': self.minutes_ago(10),
        })
        self.assertEqual(conversation.waiting_since, conversation.message_ids.filtered(lambda m: m.direction == 'in').sorted('date')[0].date)
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out', 'body': 'hi',
            'author_id': self.agent.id, 'delivery_state': 'sent', 'date': self.minutes_ago(5),
        })
        self.assertFalse(conversation.waiting_since)
        self.assertTrue(second.exists())

    def add_message(self, conversation, direction, minutes, **values):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': direction, 'body': 'x',
            'delivery_state': 'received' if direction == 'in' else 'sent', 'date': self.minutes_ago(minutes), **values,
        })

    def test_a_survey_answer_never_starts_or_backdates_a_wait(self):
        self.settings.first_response_alert_minutes = 10
        conversation = self.make_conversation(minutes_ago=60, assignee_id=self.agent.id)
        self.add_message(conversation, 'out', 50, author_id=self.agent.id)
        self.add_message(conversation, 'in', 15, selected_option_id='csat_good')
        self.assertFalse(conversation.waiting_since)
        self.run_cron()
        self.assertFalse(self.alerts(conversation))
        question = self.add_message(conversation, 'in', 5)
        self.assertEqual(conversation.waiting_since, question.date)

    def test_the_alert_shows_in_the_bell(self):
        self.settings.first_response_alert_minutes = 10
        conversation = self.make_conversation(minutes_ago=15, assignee_id=self.agent.id)
        self.run_cron()
        self.login(self.agent)
        items = self.get('/api/v1/notifications').json()['items']
        self.assertIn((FIRST_RESPONSE_KIND, conversation.id), {(item['kind'], item.get('conversation_id')) for item in items})


@tagged('post_install', '-at_install', 'liwan')
class TestSatisfactionSurvey(AutomationCase):

    def setUp(self):
        super().setUp()
        self.channel.csat_enabled = True
        self.conversation = self.make_conversation(minutes_ago=30, assignee_id=self.agent.id)
        self.login(self.agent)

    def resolve(self):
        return self.api('PATCH', f'/api/v1/inbox/conversations/{self.conversation.id}', {'state': 'resolved'})

    def survey(self):
        return self.automated(self.conversation)

    def test_resolving_queues_three_reply_buttons(self):
        self.assertEqual(self.resolve().status_code, 200)
        survey = self.survey()
        self.assertEqual(len(survey), 1)
        self.assertEqual((survey.kind, survey.author_id.id, survey.delivery_state), ('interactive', False, 'queued'))
        self.assertEqual(survey._liwan_interactive(), {
            'type': 'buttons', 'body': self.channel.csat_question, 'header': None, 'footer': None,
            'buttons': [
                {'id': 'csat_good', 'title': self.channel.csat_good}, {'id': 'csat_neutral', 'title': self.channel.csat_neutral},
                {'id': 'csat_bad', 'title': self.channel.csat_bad},
            ],
        })

    def test_the_answer_is_stored_and_neither_reopens_nor_triggers_rules(self):
        self.make_rule(match_kind='any', reply={'body': 'rule reply'}, stop=False)
        self.resolve()
        wa_id = self.conversation.identity_id.address
        answer, _event = self.deliver('', option=('csat_good', 'Great'), wa_id=wa_id)
        self.assertEqual(answer.conversation_id, self.conversation)
        self.assertEqual((self.conversation.state, self.conversation.csat_score), ('resolved', 'good'))
        self.assertEqual(self.conversation.csat_at, answer.date)
        self.assertEqual(len(self.survey()), 1)
        self.assertFalse(self.conversation.unread)
        detail = self.get(f'/api/v1/inbox/conversations/{self.conversation.id}').json()
        self.assertEqual(detail['csat'], {'score': 'good', 'at': answer.date.strftime('%Y-%m-%dT%H:%M:%SZ')})

    def test_the_list_filters_by_score(self):
        self.resolve()
        self.deliver('', option=('csat_bad', 'Bad'), wa_id=self.conversation.identity_id.address)
        other = self.make_conversation(assignee_id=self.agent.id)
        for score, expected in (('bad', [self.conversation.id]), ('good', []), ('neutral', [])):
            items = self.get(f'/api/v1/inbox/conversations?csat={score}').json()['items']
            self.assertEqual([item['id'] for item in items], expected, score)
        self.assertEqual(other.csat_score, False)
        self.assertError(self.get('/api/v1/inbox/conversations?csat=meh'), 422, 'invalid')

    def test_no_survey_when_off_or_outside_the_window_or_for_a_rule_resolution(self):
        self.channel.csat_enabled = False
        self.resolve()
        self.assertFalse(self.survey())
        self.channel.csat_enabled = True
        old = self.make_conversation(minutes_ago=25 * 60, assignee_id=self.agent.id)
        self.assertEqual(self.api('PATCH', f'/api/v1/inbox/conversations/{old.id}', {'state': 'resolved'}).status_code, 200)
        self.assertFalse(self.automated(old))
        self.make_rule(match_kind='any', reply=None, resolve=True)
        message, _event = self.deliver('done', wa_id='966500003001')
        self.assertFalse(self.automated(message.conversation_id))

    def test_a_second_tap_replaces_the_answer_and_never_reopens_or_runs_rules(self):
        self.make_rule(match_kind='any', reply={'body': 'rule reply'}, stop=False)
        self.resolve()
        wa_id = self.conversation.identity_id.address
        self.deliver('', option=('csat_good', 'Great'), wa_id=wa_id)
        later, _event = self.deliver('', option=('csat_bad', 'Bad'), wa_id=wa_id)
        self.assertEqual((self.conversation.state, self.conversation.csat_score, self.conversation.csat_at), ('resolved', 'bad', later.date))
        self.conversation.state = 'open'
        self.deliver('', option=('csat_neutral', 'Meh'), wa_id=wa_id)
        self.assertEqual((self.conversation.state, self.conversation.csat_score), ('open', 'neutral'))
        self.assertEqual(len(self.survey()), 1)

    def test_a_csat_button_without_a_survey_is_an_ordinary_reply(self):
        self.conversation.state = 'resolved'
        self.deliver('', option=('csat_good', 'Great'), wa_id=self.conversation.identity_id.address)
        self.assertEqual((self.conversation.state, self.conversation.csat_score), ('open', False))
