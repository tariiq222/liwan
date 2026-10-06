# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import api, models
from odoo.tools import plaintext2html

# The columns this service writes itself. ``values`` carries only the
# producing application's own mail.message columns.
GENERIC_VALUES = frozenset({
    'model', 'res_id', 'nasq_notification', 'nasq_notification_kind', 'nasq_notification_key',
    'message_type', 'is_internal', 'author_id', 'subtype_id', 'body', 'partner_ids',
})


class NasqNotifyService(models.AbstractModel):
    """Bell rows: a ``mail.message`` flagged ``nasq_notification`` plus one inbox
    ``mail.notification`` per recipient.

    Documented elevated operations (CLAUDE.md, R7): delivery creates the
    message and its inbox row as superuser, because the recipient, not the
    actor, owns the row.
    """
    _name = 'nasq.notify.service'
    _description = 'Nasq notification service'
    _nasq_scope = 'global'

    @api.model
    def _nasq_key_taken(self, key):
        return bool(self.env['mail.message'].sudo().search_count(
            [('nasq_notification_key', '=', key)], limit=1,
        ))

    @api.model
    def _nasq_deliver(self, model, res_id, kind, partners, body, key=None, values=None):
        """Create one bell row per partner on ``model``/``res_id`` and return the new messages.

        ``key`` makes delivery idempotent. It is stored verbatim, so it names
        its single recipient: a key with several partners is refused. A key
        that exists, or that a concurrent worker inserts first, creates nothing.
        """
        if kind not in self.env['nasq.notify.registry']._nasq_notification_type_map():
            msg = f'nasq_notify: notification kind {kind!r} is not registered'
            raise ValueError(msg)
        extra = dict(values or {})
        clash = sorted(GENERIC_VALUES & set(extra))
        if clash:
            msg = f'nasq_notify: values may not set {clash}'
            raise ValueError(msg)
        if key and len(partners) > 1:
            msg = 'nasq_notify: a delivery key names one recipient'
            raise ValueError(msg)
        Message = self.env['mail.message'].sudo()
        created = Message.browse()
        if key and self._nasq_key_taken(key):
            return created
        for partner in partners:
            try:
                # A flushing savepoint executes and clears every precommit
                # callback and policy marker of the caller. Keep notification
                # uniqueness isolated without flushing unrelated operations.
                with self.env.cr.savepoint(flush=False):
                    message = Message.create({
                        **extra,
                        'model': model,
                        'res_id': res_id,
                        'nasq_notification': True,
                        'nasq_notification_kind': kind,
                        'nasq_notification_key': key or False,
                        'message_type': 'notification',
                        'is_internal': True,
                        'author_id': self.env.user.partner_id.id,
                        'subtype_id': self.env.ref('mail.mt_note').id,
                        'body': plaintext2html(body),
                        'partner_ids': [(4, partner.id)],
                    })
                    self.env['mail.notification'].sudo().create({
                        'author_id': message.author_id.id,
                        'mail_message_id': message.id,
                        'notification_status': 'sent',
                        'notification_type': 'inbox',
                        'res_partner_id': partner.id,
                    })
            except IntegrityError as error:
                # Concurrent workers may race on the deterministic key. The
                # unique index makes the loser a harmless retry; any other
                # integrity failure still reaches the caller.
                constraint = getattr(getattr(error, 'diag', None), 'constraint_name', '') or ''
                if key and 'nasq_notification_key' in constraint:
                    continue
                raise
            created |= message
        return created
