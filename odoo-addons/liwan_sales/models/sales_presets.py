# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sector presets of the Sales settings: named bundles of values that set several settings at once.

A preset is data, never logic: it names no customer and no customer type (R6), only a kind of selling. Applying one is an
ordinary settings write of its values, so the right to do it, the validation and the revision check are those of
``PATCH /api/v1/sales/settings``. A preset holds Sales' own keys, the payment choice among them; the CRM and finance
bridges add the keys they own through ``liwan.sales.settings._liwan_preset_extras``. A key the tenant's settings do not
carry (online payments or the bridge's application not in the plan) is left out of the preset the tenant sees.

The default terms are not in any preset: legal text belongs to the tenant.
"""

# Selling professional services (consulting, agencies, studios).
# - A proposal is a scope of work, so the customer signs it; the account lead checks capacity before it becomes an order,
#   so acceptance alone confirms nothing.
# - Each consultant answers for their own proposals; a small discount is a sales decision.
SERVICES = {
    'visibility': 'own',
    'validity_days': 30,
    'discount_limit_percent': 10,
    'customer_answer': 'accept_and_sign',
    'acceptance_confirms': False,
    'answered_resend': 'allow',
    'signature_methods': 'draw_or_type',
    'payment_to_confirm': 'off',
}

# Selling goods across a counter or a warehouse (trading, retail, wholesale).
# - Prices follow supplier costs, so a quotation is short-lived, and a price the customer accepts is final: acceptance
#   confirms the order by itself.
# - Whoever is at the counter serves a customer who rings back, so every seller reads every document of the company.
# - Goods are paid before the order, so the quotation asks for all of it online.
TRADING = {
    'visibility': 'all',
    'validity_days': 7,
    'discount_limit_percent': 5,
    'customer_answer': 'accept',
    'acceptance_confirms': True,
    'answered_resend': 'allow',
    'signature_methods': 'draw_or_type',
    'payment_to_confirm': 'full',
}

# Contracting and project work, where an order is a signed commitment.
# - A bid stays open for weeks and is worked by estimators and project managers together, so every document is shared.
# - The customer signs by hand, staff confirm after reviewing the contract terms, and a signed quotation is changed only
#   by reopening it, which leaves a trace.
CONTRACTING = {
    'visibility': 'all',
    'validity_days': 60,
    'discount_limit_percent': 3,
    'customer_answer': 'accept_and_sign',
    'acceptance_confirms': False,
    'answered_resend': 'refuse',
    'signature_methods': 'draw',
    'payment_to_confirm': 'off',
}

# The order of the list is the order of the cards.
SECTOR_PRESETS = {'services': SERVICES, 'trading': TRADING, 'contracting': CONTRACTING}


def preset_values(keys, own, extras):
    """The values of one preset for a tenant whose settings carry ``keys``: Sales' ``own`` values and the bridges' ``extras``,
    without the keys the tenant does not have."""
    return {key: value for key, value in {**own, **extras}.items() if key in keys}


def preset_matches(values, current):
    """Whether every value of a preset is what ``current`` (the settings wire shape) already holds."""
    return all(current.get(key) == value for key, value in values.items())
