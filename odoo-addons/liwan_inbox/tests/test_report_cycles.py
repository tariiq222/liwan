# Part of Odoo. See LICENSE file for full copyright and licensing details.

from psycopg2 import IntegrityError

from odoo import fields
from odoo.tests import tagged
from odoo.tools import mute_logger

from .report_common import ReportCase


@tagged('post_install', '-at_install', 'liwan')
class TestReportCycles(ReportCase):

    def test_an_inbound_message_opens_one_cycle(self):
        conversation = self.inbound('wamid.C1')
        (cycle,) = self.cycles(conversation)
        message = conversation.message_ids
        self.assertEqual((cycle.opened_at, cycle.channel_id, cycle.ended_at), (message.date, self.channel, False))
        self.inbound('wamid.C2')
        self.assertEqual(len(self.cycles(conversation)), 1)

    def test_the_first_agent_reply_is_the_first_response(self):
        conversation = self.inbound('wamid.C3')
        cycle = self.cycles(conversation)
        self.env['liwan.inbox.message']._liwan_post_note(conversation, 'internal')
        self.reply(conversation, automated=True, author_id=False)
        self.assertFalse(cycle.first_response_at)
        reply = self.reply(conversation, kind='template', template_name='t')
        self.reply(conversation, author=self.agent2)
        self.assertEqual((cycle.first_response_at, cycle.responder_id), (reply.date, self.agent))
        self.assertGreater(cycle.first_response_seconds, 0)

    def test_resolving_closing_and_auto_closing_set_the_end_reason(self):
        for state, reason in (('resolved', 'resolved'), ('closed', 'closed')):
            conversation = self.inbound(f'wamid.E-{state}', wa_id=f'96650{len(state)}000000')
            conversation.assignee_id = self.agent
            conversation.write({'state': state})
            (cycle,) = self.cycles(conversation)
            self.assertEqual((cycle.end_reason, cycle.resolver_id, bool(cycle.ended_at)), (reason, self.agent, True))
        self.assertGreater(cycle.resolution_seconds + 1, 0)
        resolved = self.make_conversation(minutes_ago=80 * 60)
        self.settings.auto_close_hours = 72
        self.open_cycle(resolved, 80 * 60)
        self.env['liwan.inbox.conversation']._liwan_run_maintenance()
        (idle,) = self.cycles(resolved)
        self.assertEqual((idle.end_reason, resolved.state), ('auto_closed', 'closed'))
        self.assertEqual(idle.resolution_seconds, 0)

    def test_resolution_time_is_measured_for_resolved_cycles_only(self):
        conversation = self.make_conversation()
        cycle = self.open_cycle(conversation, 120)
        conversation.write({'state': 'resolved'})
        self.assertAlmostEqual(cycle.resolution_seconds, 120 * 60, delta=5)

    def test_a_later_inbound_message_starts_a_new_cycle(self):
        conversation = self.inbound('wamid.R1')
        conversation.write({'state': 'resolved'})
        self.assertEqual(self.inbound('wamid.R2'), conversation)
        first, second = self.cycles(conversation)
        self.assertEqual((first.end_reason, bool(second.ended_at), conversation.state), ('resolved', False, 'open'))

    def test_a_survey_answer_lands_on_the_ended_cycle_and_opens_nothing(self):
        conversation = self.inbound('wamid.S1')
        conversation.write({'state': 'resolved'})
        self.env['liwan.inbox.conversation.cycle']._liwan_record_csat(conversation, 'good', fields.Datetime.now())
        (cycle,) = self.cycles(conversation)
        self.assertEqual(cycle.csat_score, 'good')

    def test_the_department_follows_the_conversation_while_the_cycle_is_open(self):
        conversation = self.inbound('wamid.D1')
        conversation.department_id = self.other_department
        self.assertEqual(self.cycles(conversation).department_id, self.other_department)

    def test_only_one_cycle_is_open_per_conversation(self):
        conversation = self.make_conversation()
        self.open_cycle(conversation, 10)
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.env.cr.savepoint():
            self.open_cycle(conversation, 5)

    def test_deleting_the_conversation_deletes_its_cycles(self):
        conversation = self.make_conversation()
        cycle = self.open_cycle(conversation, 5)
        conversation.unlink()
        self.assertFalse(cycle.exists())
