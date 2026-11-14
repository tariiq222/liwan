# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one elevated environment of this addon (plan D24, tools/arch_documented_sudo.json)."""


def elevated_env(env):
    """The superuser environment the establishment's taxes are read, resolved and activated in.

    Only after the caller's capability check, and only tax ids, names, rates and computed amounts leave it.
    """
    return env['account.tax'].sudo().env
