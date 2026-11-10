# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso


def dump_usage(row):
    return {
        'id': row.id,
        'conversation_id': row.conversation_id,
        'call_id': row.call_id,
        'kind': row.kind,
        'capability': row.capability,
        'billing': row.billing,
        'provider': row.provider,
        'model': row.model,
        'outcome': row.outcome,
        'input_tokens': row.input_tokens if row.tokens_reported else None,
        'output_tokens': row.output_tokens if row.tokens_reported else None,
        'cost': row.cost if row.cost_reported else None,
        'charge': row.charge if row.charge_reported else None,
        'charge_paid': row.charge_paid,
        'called_at': iso(row.called_at),
    }
