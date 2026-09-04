# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _nasq_notify(self, event, extra_partners=None):
        bus = self.env['bus.bus']
        for task in self:
            partners = task.user_ids.partner_id | self.env.user.partner_id
            if extra_partners:
                partners |= extra_partners.get(task.id, partners.browse())
            for partner in partners:
                bus._sendone(partner, 'nasq/task', {'id': task.id, 'event': event})

    @api.model_create_multi
    def create(self, vals_list):
        tasks = super().create(vals_list)
        tasks._nasq_notify('created')
        return tasks

    def write(self, vals):
        before = {task.id: task.user_ids.partner_id for task in self}
        res = super().write(vals)
        self._nasq_notify('updated', extra_partners=before)
        return res

    def _message_post_after_hook(self, message, msg_values):
        # message_post() (used for comments, e.g. by
        # nasq_api/controllers/timeline.py's post_comment) doesn't go through
        # write(), so it wouldn't otherwise emit a `nasq/task` bus
        # notification and a second tab watching the task would never learn
        # a comment was added. Reuse the same partner-targeting logic as
        # write()/create() so a live comment refreshes the activity timeline
        # the same way any other task change does.
        #
        # _message_post_after_hook() is called unconditionally from
        # message_post() (mail_thread.py) for every message it creates, not
        # just manual comments. MailThread.write() defers tracking messages
        # via _track_finalize() -> _message_track(), which itself calls
        # record.message_post(...) whenever a tracked field resolves a
        # subtype (e.g. this module's stage_id/state transitions). Without
        # the guard below, a routine write() that changes such a field would
        # notify twice for the same user action: once from write() above,
        # once here for the tracking message write() triggered internally.
        # Restrict this hook to genuine user comments.
        #
        # message.message_type (not msg_values.get('message_type')) is used
        # here: the created `message` record is authoritative, and
        # mail_thread.py itself doesn't fully trust msg_values to carry the
        # key in every call context (see its own fallback, e.g.
        # `msg_vals.get('message_type') or message.sudo().message_type` in
        # _notify_thread_by_inbox).
        res = super()._message_post_after_hook(message, msg_values)
        if message.message_type == 'comment':
            self._nasq_notify('updated')
        return res
