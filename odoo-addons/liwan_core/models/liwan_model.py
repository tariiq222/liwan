# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""LiwanOS model scope declarations.

Every durable ``liwan.*`` table sets ``_liwan_scope`` to one of
``company``, ``tenant``, or ``global``. Inherited Odoo models are out of
scope. Mixins without tables do not declare it.
"""
LIWAN_SCOPES = ('company', 'tenant', 'global')
