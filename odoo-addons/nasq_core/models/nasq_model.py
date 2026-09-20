# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Nasq model scope declarations.

Every durable ``nasq.*`` table sets ``_nasq_scope`` to one of
``company``, ``tenant``, or ``global``. Inherited Odoo models are out of
scope. Mixins without tables do not declare it.
"""
NASQ_SCOPES = ('company', 'tenant', 'global')
