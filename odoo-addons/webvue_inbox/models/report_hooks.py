# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Where the conversation cycles open, answer and end: the conversation write and the agent's outbound message."""
from odoo import api, models


class WebVueInboxConversationCycleHook(models.Model):
    _inherit = 'webvue.inbox.conversation'

    def write(self, vals):
        ending = self.filtered(lambda conversation: conversation.state != vals['state']) if vals.get('state') in ('resolved', 'closed') else self.browse()
        result = super().write(vals)
        Cycle = self.env['webvue.inbox.conversation.cycle']
        if ending:
            Cycle._webvue_end_for(ending, vals['state'])
        if 'department_id' in vals:
            Cycle.search([('conversation_id', 'in', self.ids), ('ended_at', '=', False)]).department_id = vals['department_id']
        return result


class WebVueInboxMessageCycleHook(models.Model):
    _inherit = 'webvue.inbox.message'

    @api.model_create_multi
    def create(self, vals_list):
        messages = super().create(vals_list)
        answers = messages.filtered(lambda message: message.direction == 'out' and message.author_id and not message.automated)
        if answers:
            self.env['webvue.inbox.conversation.cycle']._webvue_stamp_response(answers)
        return messages
