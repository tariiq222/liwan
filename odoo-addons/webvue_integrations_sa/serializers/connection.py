# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.serializers.common import iso


def dump_connection(connection):
    """Whitelist the wire shape; never send a raw read() result."""
    return {
        'id': connection.id,
        'kind': connection.kind,
        'provider': connection.provider,
        'state': connection.state,
        'last_checked': iso(connection.last_checked),
        'status_message': connection.status_message or '',
    }


def dump_connections(connections):
    return [dump_connection(connection) for connection in connections]
