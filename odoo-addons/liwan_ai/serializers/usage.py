# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso


def dump_usage(row):
    return {
        'id': row.id,
        'conversation_id': row.conversation_id,
        'kind': row.kind,
        'provider': row.provider,
        'model': row.model,
        'outcome': row.outcome,
        'input_tokens': row.input_tokens if row.tokens_reported else None,
        'output_tokens': row.output_tokens if row.tokens_reported else None,
        'called_at': iso(row.called_at),
    }
