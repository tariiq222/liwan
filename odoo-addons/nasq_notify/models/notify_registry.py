# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

TYPE_FIELDS = ('owner', 'model', 'feature_key')


class NasqNotifyRegistry(models.AbstractModel):
    """Notification types, composed through ``super()`` like ``nasq.feature.registry``.

    nasq_notify knows no application: each application that sends bell rows
    extends this model with its kinds.
    """
    _name = 'nasq.notify.registry'
    _description = 'Nasq notification type registry'
    _nasq_scope = 'global'

    @api.model
    def _nasq_notification_types(self):
        """Pure descriptors ``{'kind', 'owner', 'model', 'feature_key'}``; never a process-global set.

        ``'live': True`` marks a kind whose rows are re-checked one by one.
        The kind is a value its owner added to
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
