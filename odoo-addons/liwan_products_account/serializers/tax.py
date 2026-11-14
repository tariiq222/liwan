# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_tax_choices(choices):
    """The tax choices (plain ``{id, name, amount, active}`` dicts; ``active`` false means picking it activates it)."""
    return {
        'items': [{key: choice[key] for key in ('id', 'name', 'amount', 'active')} for choice in choices],
        'total': len(choices),
    }
