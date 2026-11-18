# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of an agent's availability."""
from odoo.addons.liwan_inbox.serializers.refs import dump_ref


def dump_agent(user, availability):
    """`{id, name, available, in_shift, effective_available}`; `availability` is the user's `(available, in_shift)` pair."""
    available, in_shift = availability
    return {**dump_ref(user), 'available': available, 'in_shift': in_shift, 'effective_available': available and in_shift}
