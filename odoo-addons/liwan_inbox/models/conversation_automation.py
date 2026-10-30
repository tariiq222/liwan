# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The conversation side of the automation: who can take it, the first-response alert and the satisfaction survey."""
import logging

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .access_service import REPLY
from .batch import process_each
from .constants import AUTOMATION_FEATURE, CSAT_OPTIONS, FIRST_RESPONSE_CRON_BATCH
from .notification_types import FIRST_RESPONSE_KIND, KIND

_logger = logging.getLogger(__name__)


class LiwanInboxConversationAutomation(models.Model):
    _inherit = 'liwan.inbox.conversation'

    def _liwan_agents(self):
        """Active users who can reply in the conversation's company: its department's members, else every agent."""
        self.ensure_one()
        service = self.env['liwan.access.service']
        users = self.department_id.member_ids or self.env.ref('liwan_inbox.group_cap_inbox_conversations_reply').all_user_ids
        return users.filtered(lambda user: user.active and service._liwan_has_capability(user, REPLY, company=self.company_id))

    def _liwan_notify_assigned(self, actor=None):
        """Bell row for the assignee: the actor's assignment, or (without an actor) an automatic one."""
        assignee = self.assignee_id
        if not assignee or assignee == actor:
            return
        env = self.env
        body = (
            env._('%(actor)s assigned you a conversation with %(customer)s', actor=actor.name, customer=self.contact_id.name)
            if actor else env._('A conversation with %(customer)s was assigned to you automatically', customer=self.contact_id.name)
        )
        env['liwan.notify.service']._liwan_deliver(
            self._name, self.id, KIND, assignee.partner_id, body,
            key=f'{KIND}:{self.id}:{assignee.partner_id.id}',
            values={'liwan_inbox_conversation_id': self.id, 'liwan_inbox_contact_name': self.contact_id.name},
            replace=True,
        )

    # first-response alert (cron)

    @api.model
    def _liwan_run_first_response_alerts(self):
        """Bell the agents of every conversation whose customer has waited too long for a first reply, once per wait."""
        if not self.env['liwan.entitlement.service']._liwan_feature_write(AUTOMATION_FEATURE):
            return
        now = fields.Datetime.now()
        for company in self.env['res.company'].search([]):
            minutes = self.env['liwan.inbox.settings']._get_for_company(company).first_response_alert_minutes
            if not minutes:
                continue
            waiting = self.search([
                ('company_id', '=', company.id), ('state', 'in', ('open', 'pending')), ('first_response_alerted', '=', False),
                ('waiting_since', '!=', False), ('waiting_since', '<=', now - relativedelta(minutes=minutes)),
            ], order='waiting_since', limit=FIRST_RESPONSE_CRON_BATCH)
            process_each(waiting, lambda conversation: conversation._liwan_alert(minutes), self._liwan_alert_failed)

    @api.model
    def _liwan_alert_failed(self, conversation, error):
        _logger.warning('first response alert of conversation %s failed: %s', conversation.id, type(error).__name__)

    def _liwan_alert(self, minutes):
        self.ensure_one()
        for user in self.assignee_id or self._liwan_agents():
            self.env['liwan.notify.service']._liwan_deliver(
                self._name, self.id, FIRST_RESPONSE_KIND, user.partner_id,
                self.env._('%(customer)s has waited %(minutes)s minutes for a reply', customer=self.contact_id.name, minutes=minutes),
                key=f'{FIRST_RESPONSE_KIND}:{self.id}:{user.partner_id.id}',
                values={'liwan_inbox_conversation_id': self.id, 'liwan_inbox_contact_name': self.contact_id.name},
                replace=True,
            )
        self.first_response_alerted = True

    # satisfaction survey

    def _liwan_send_csat_survey(self):
        """Ask the customer to rate the service (three reply buttons) after an agent resolved the conversation."""
        self.ensure_one()
        channel = self.channel_id
        if not channel.csat_enabled or not self.env['liwan.entitlement.service']._liwan_feature_write(AUTOMATION_FEATURE):
            return
        values = {
            'kind': 'interactive', 'interactive_type': 'buttons', 'body': channel.csat_question,
            'option_ids': [
                (0, 0, {'sequence': index, 'option_id': option_id, 'title': channel[label_field]})
                for index, (option_id, label_field, _score) in enumerate(CSAT_OPTIONS)
            ],
        }
        try:
            with self.env.cr.savepoint():
                self.env['liwan.inbox.message']._liwan_queue_automated(self, values)
        except ValidationError:
            return  # the window closed, the channel is disabled or the monthly message limit is reached: no survey
        self.write({'csat_score': False, 'csat_at': False})
