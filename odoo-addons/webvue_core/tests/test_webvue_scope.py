# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_core.models.webvue_model import WEBVUE_SCOPES

# webvue.chat.service and webvue.pmo.settings are asserted by the owning apps.
EXPLICIT_ABSTRACT = {
    'webvue.access.service': 'global',
    'webvue.entitlement.service': 'global',
    'webvue.feature.registry': 'global',
}


@tagged('post_install', '-at_install', 'webvue')
class TestWebVueScope(TransactionCase):

    def test_webvue_tables_declare_scope(self):
        missing = []
        invalid = []
        company_without_field = []
        for name, cls in self.env.registry.items():
            if not name.startswith('webvue.'):
                continue
            model = self.env[name]
            is_table = bool(getattr(cls, '_auto', True)) and not bool(
                getattr(cls, '_abstract', False),
            )
            if not is_table:
                if name in EXPLICIT_ABSTRACT:
                    scope = getattr(model, '_webvue_scope', None)
                    if scope != EXPLICIT_ABSTRACT[name]:
                        invalid.append(f'{name}={scope}')
                continue
            scope = getattr(model, '_webvue_scope', None)
            if scope not in WEBVUE_SCOPES:
                missing.append(name)
                continue
            if scope == 'company' and 'company_id' not in model._fields:
                company_without_field.append(name)
        self.assertFalse(missing, f'webvue tables missing _webvue_scope: {missing}')
        self.assertFalse(invalid, f'invalid abstract scopes: {invalid}')
        self.assertFalse(
            company_without_field,
            f'company scope without company_id: {company_without_field}',
        )

    def test_explicit_services_are_global(self):
        for name, scope in EXPLICIT_ABSTRACT.items():
            self.assertEqual(self.env[name]._webvue_scope, scope)
