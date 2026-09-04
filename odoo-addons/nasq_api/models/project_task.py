# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ProjectTask(models.Model):
    _inherit = 'project.task'

    def _nasq_notify(self, event, extra_partners=None):
        # A single user action can re-enter write() (e.g. project.task's own
        # write() override does a plain `task.date_last_stage_update = now`
        # assignment when 'state' changes, which for a stored field triggers
        # a second, independent records.write() call that recurses through
        # the whole write() stack, including this override) and end up
        # calling _nasq_notify() more than once for what is really one
        # user action. Rather than emit immediately, accumulate
        # (partner_id, task_id, event) triples on the cursor's precommit
        # data and drain them once, right before commit, deduplicated by
        # set membership — the same idiom bus.bus._sendone()/_ensure_hooks()
        # itself uses (see addons/bus/models/bus.py) to batch its own
        # notifications until precommit time.
        precommit = self.env.cr.precommit
        key = 'nasq_api.task_notifications'
        if key not in precommit.data:
            precommit.data[key] = set()

            @precommit.add
            def _flush_nasq_notifications():
                pending = precommit.data.pop(key, ())
                if not pending:
                    return
                bus = self.env['bus.bus']
                for partner_id, task_id, evt in pending:
                    bus._sendone(
                        self.env['res.partner'].browse(partner_id),
                        'nasq/task',
                        {'id': task_id, 'event': evt},
                    )

        pending = precommit.data[key]
        for task in self:
            partners = task.user_ids.partner_id | self.env.user.partner_id
            if extra_partners:
                partners |= extra_partners.get(task.id, partners.browse())
            for partner in partners:
                pending.add((partner.id, task.id, event))

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
