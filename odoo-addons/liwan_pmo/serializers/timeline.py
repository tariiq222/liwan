# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso


def _display(tracking, new):
    value = tracking._format_display_value(tracking.field_id.ttype, new=new)
    return value[0] if isinstance(value, (list, tuple)) else value


def dump_message(message):
    author = message.author_id
    base = {
        'id': message.id,
        'author': {'id': author.id, 'name': author.name} if author else None,
        'at': iso(message.date),
    }
    # tracking_value_ids is group_system-only on mail.message; read it sudo'd and then keep
    # only the trackings the requesting user actually has field-level read access to, same as
    # mail's own Store computation does (mail_message.py _to_store_defaults).
    tracking = message.sudo().tracking_value_ids._filter_has_field_access(message.env)
    if tracking:
        base['kind'] = 'tracking'
        base['changes'] = [{
            'field': t.field_id.name,
            'label': t.field_id.field_description,
            'old': _display(t, new=False),
            'new': _display(t, new=True),
        } for t in tracking]
        # No body_html on a tracking entry: Timeline.vue renders `changes` for
        # `kind === 'tracking'` and never reads body_html there, so emitting it
        # only shipped unrendered (and unsanitised-on-the-client) markup.
    else:
        base['kind'] = 'comment'
        base['body_html'] = message.body
        # Comments are shared by a task family; say which task each one was written on.
        task = message.env['project.task'].browse(message.res_id)
        base['task'] = {'id': task.id, 'name': task.name}
    return base
