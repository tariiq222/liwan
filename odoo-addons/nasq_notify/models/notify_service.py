# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import api, models
from odoo.exceptions import AccessError, MissingError
from odoo.fields import Domain
from odoo.tools import plaintext2html

from odoo.addons.nasq_core.models.access_service import NasqAccessRule

SCAN_BATCH = 200
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
    actor, owns the row; reads are elevated because a user cannot read other
    partners' ``mail.notification`` rows, so every elevated search carries
    ``res_partner_id = current partner`` in its domain, and the owning
    application's branch decides, in the caller's environment, which sources
    the caller may still read.
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
    def _nasq_deliver(self, model, res_id, kind, partners, body, key=None, values=None, replace=False):
        """Create one bell row per partner on ``model``/``res_id`` and return the new messages.

        ``key`` makes delivery idempotent. It is stored verbatim, so it names
        its single recipient: a key with several partners is refused. A key
        that exists, or that a concurrent worker inserts first, creates nothing,
        unless ``replace`` is set: the existing row of that key is then deleted and a
        fresh, unread one is created (new date, author and body).
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
        if key and replace:
            Message.search([('nasq_notification_key', '=', key)]).unlink()
        elif key and self._nasq_key_taken(key):
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

    @api.model
    def _nasq_domain(self):
        """The caller's inbox bell rows whose source an owning application still lets them read."""
        if self.env.su:
            # Under sudo the owners' record rules stop applying and ``env.user``
            # may be the superuser, so visibility would not be the caller's.
            msg = 'notification visibility must be computed for a real user'
            raise AccessError(msg)
        branches = list(self.env['nasq.notify.registry']._nasq_notify_visible_domain())
        if any(not branch for branch in branches):
            # Domain([]) matches everything; an empty branch would leak rows.
            msg = 'nasq_notify: a visibility branch must not be empty'
            raise ValueError(msg)
        visible = Domain.OR(Domain(branch) for branch in branches) if branches else Domain.FALSE
        return Domain([
            ('res_partner_id', '=', self.env.user.partner_id.id),
            ('mail_message_id.nasq_notification', '=', True),
            ('notification_type', '=', 'inbox'),
        ]) & visible

    @api.model
    def _nasq_recipient_domain(self):
        """Elevated scans never leave the caller's own rows, whatever domain they were handed."""
        return Domain('res_partner_id', '=', self.env.user.partner_id.id)

    @api.model
    def _nasq_visible_rows(self, domain, limit=None, offset=0):
        """``(row, extra)`` pairs, newest first, after the owners' row checks."""
        registry = self.env['nasq.notify.registry']
        Notification = self.env['mail.notification'].sudo()
        domain = Domain(domain) & self._nasq_recipient_domain()
        last_id = None
        collected = []
        needed = (offset or 0) + (limit if limit is not None else 10 ** 9)
        while len(collected) < needed:
            batch_domain = domain if last_id is None else domain & Domain('id', '<', last_id)
            batch = Notification.search(batch_domain, order='id desc', limit=SCAN_BATCH)
            if not batch:
                break
            last_id = batch.ids[-1]
            for row in batch:
                visible, extra = registry._nasq_notify_row_visible(row)
                if not visible:
                    continue
                collected.append((row, extra))
                if len(collected) >= needed:
                    break
        start = offset or 0
        if limit is None:
            return collected[start:]
        return collected[start:start + limit]

    @api.model
    def _nasq_visible_count(self, domain):
        """Counted in SQL, except the rows of ``live`` kinds, which are re-checked one by one."""
        registry = self.env['nasq.notify.registry']
        Notification = self.env['mail.notification'].sudo()
        domain = Domain(domain) & self._nasq_recipient_domain()
        live_kinds = list(registry._nasq_notify_live_kinds())
        if not live_kinds:
            return Notification.search_count(domain)
        total = Notification.search_count(
            domain & Domain('mail_message_id.nasq_notification_kind', 'not in', live_kinds),
        )
        live_domain = domain & Domain('mail_message_id.nasq_notification_kind', 'in', live_kinds)
        last_id = None
        while True:
            batch_domain = live_domain if last_id is None else live_domain & Domain('id', '<', last_id)
            batch = Notification.search(batch_domain, order='id desc', limit=SCAN_BATCH)
            if not batch:
                break
            last_id = batch.ids[-1]
            total += sum(1 for row in batch if registry._nasq_notify_row_visible(row)[0])
        return total

    @api.model
    def _nasq_list(self, limit, offset=0, unread=None):
        """One page of the caller's bell with its total and unread count."""
        base = self._nasq_domain()
        domain = base if unread is None else base & Domain('is_read', '=', not unread)
        registry = self.env['nasq.notify.registry']
        rows = self._nasq_visible_rows(domain, limit=limit, offset=offset)
        return {
            'items': [registry._nasq_notify_dump(row, extra) for row, extra in rows],
            'total': self._nasq_visible_count(domain),
            'unread_count': self._nasq_visible_count(base & Domain('is_read', '=', False)),
        }

    @api.model
    def _nasq_find(self, notification_id):
        """The caller's visible row and its row-check extra; MissingError otherwise."""
        rows = self.env['mail.notification'].sudo().search(
            self._nasq_domain() & Domain('id', '=', notification_id), limit=1,
        )
        if not rows:
            raise MissingError(self.env._('Notification does not exist'))
        visible, extra = self.env['nasq.notify.registry']._nasq_notify_row_visible(rows)
        if not visible:
            raise MissingError(self.env._('Notification does not exist'))
        return rows, extra

    @api.model
    def _nasq_mark_read(self, notification_id):
        """Mark one visible row read once its owner's feature allows writes; return 0 or 1."""
        row, _extra = self._nasq_find(notification_id)
        if row.is_read:
            return 0
        self.env['nasq.entitlement.service'].require(
            self.env['nasq.notify.registry']._nasq_notify_feature_key(row),
        )
        row.write({'is_read': True})
        return 1

    @api.model
    def _nasq_mark_all_read(self):
        """Mark every visible unread row read whose owner's feature allows writes; return the count."""
        registry = self.env['nasq.notify.registry']
        entitlement = self.env['nasq.entitlement.service']
        writable = []
        for row, _extra in self._nasq_visible_rows(self._nasq_domain() & Domain('is_read', '=', False)):
            try:
                entitlement.require(registry._nasq_notify_feature_key(row))
            except NasqAccessRule:
                continue
            writable.append(row.id)
        if writable:
            self.env['mail.notification'].sudo().browse(writable).write({'is_read': True})
        return len(writable)
