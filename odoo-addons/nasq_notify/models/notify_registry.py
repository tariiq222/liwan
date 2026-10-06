# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

TYPE_FIELDS = ('owner', 'model', 'feature_key')


class NasqNotifyRegistry(models.AbstractModel):
    """Notification types, composed through ``super()`` like ``nasq.feature.registry``.

    nasq_notify knows no application. Each application that sends bell rows
    extends this model: it registers its kinds, says which of its rows the
    caller may still see, and serializes them.
    """
    _name = 'nasq.notify.registry'
    _description = 'Nasq notification type registry'
    _nasq_scope = 'global'

    @api.model
    def _nasq_notification_types(self):
        """Pure descriptors ``{'kind', 'owner', 'model', 'feature_key'}``; never a process-global set.

        ``'live': True`` marks a kind whose rows ``_nasq_notify_row_visible``
        re-checks one by one. The kind is a value its owner added to
        ``mail.message.nasq_notification_kind`` with ``selection_add``.
        """
        return ()

    @api.model
    def _nasq_notification_type_map(self):
        values = set(self.env['mail.message']._fields['nasq_notification_kind'].get_values(self.env))
        types = {}
        for item in self._nasq_notification_types():
            kind = item.get('kind')
            if not kind or not isinstance(kind, str):
                raise ValidationError(self.env._('nasq_notify: a notification type is missing a kind'))
            if kind in types:
                raise ValidationError(self.env._(
                    'nasq_notify: duplicate notification kind %(kind)s', kind=kind,
                ))
            for name in TYPE_FIELDS:
                if not item.get(name) or not isinstance(item[name], str):
                    raise ValidationError(self.env._(
                        'nasq_notify: notification kind %(kind)s is missing %(name)s', kind=kind, name=name,
                    ))
            if kind not in values:
                raise ValidationError(self.env._(
                    'nasq_notify: notification kind %(kind)s is not a mail.message selection value', kind=kind,
                ))
            types[kind] = item
        return types

    @api.model
    def _nasq_notify_feature_keys(self):
        """Feature keys of the registered types, in registration order, each once."""
        keys = []
        for item in self._nasq_notification_type_map().values():
            if item['feature_key'] not in keys:
                keys.append(item['feature_key'])
        return tuple(keys)

    @api.model
    def _nasq_notify_live_kinds(self):
        return tuple(kind for kind, item in self._nasq_notification_type_map().items() if item.get('live'))

    @api.model
    def _nasq_notify_visible_domain(self):
        """One ``mail.notification`` domain per readable source; the service ORs them.

        An owner appends a non-empty branch for its own rows, built from ids
        the caller can still read in the caller's environment. A row outside
        every branch is never listed, counted or marked read.
        """
        return []

    @api.model
    def _nasq_notify_row_visible(self, row):
        """``(visible, extra)`` for one row of a ``live`` kind; ``extra`` reaches the dump."""
        return True, None

    @api.model
    def _nasq_notify_dump(self, row, extra):
        """The wire shape of one row; its owner overrides this for its kinds."""
        kind = row.mail_message_id.nasq_notification_kind
        msg = f'nasq_notify: no owner serializes notification kind {kind!r}'
        raise ValueError(msg)

    @api.model
    def _nasq_notify_feature_key(self, row):
        """The feature that must allow writes before ``row`` is marked read."""
        types = self._nasq_notification_type_map()
        message = row.mail_message_id
        item = types.get(message.nasq_notification_kind) or next(
            (item for item in types.values() if item['model'] == message.model), None,
        )
        return item['feature_key'] if item else None
