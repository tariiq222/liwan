# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_extension(extension):
    return {
        'id': extension.id,
        'number': extension.number,
        'user': {'id': extension.user_id.id, 'name': extension.user_id.name} if extension.user_id else None,
        'active': extension.active,
    }


def dump_extensions(extensions):
    return [dump_extension(extension) for extension in extensions]
