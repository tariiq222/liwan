# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WebVue model scope declarations.

Every durable ``webvue.*`` table sets ``_webvue_scope`` to one of
``company``, ``tenant``, or ``global``. Inherited Odoo models are out of
scope. Mixins without tables do not declare it.
"""
WEBVUE_SCOPES = ('company', 'tenant', 'global')
