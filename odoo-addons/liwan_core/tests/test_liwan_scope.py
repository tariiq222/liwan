# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_core.models.liwan_model import LIWAN_SCOPES

# liwan.chat.service and liwan.pmo.settings are asserted by the owning apps.
EXPLICIT_ABSTRACT = {
    'liwan.access.service': 'global',
    'liwan.entitlement.service': 'global',
    'liwan.feature.registry': 'global',
}


@tagged('post_install', '-at_install', 'liwan')
class TestLiwanScope(TransactionCase):

    def test_liwan_tables_declare_scope(self):
        missing = []
        invalid = []
        company_without_field = []
        for name, cls in self.env.registry.items():
            if not name.startswith('liwan.'):
                continue
            model = self.env[name]
            is_table = bool(getattr(cls, '_auto', True)) and not bool(
                getattr(cls, '_abstract', False),
            )
            if not is_table:
                if name in EXPLICIT_ABSTRACT:
                    scope = getattr(model, '_liwan_scope', None)
                    if scope != EXPLICIT_ABSTRACT[name]:
                        invalid.append(f'{name}={scope}')
                continue
            scope = getattr(model, '_liwan_scope', None)
            if scope not in LIWAN_SCOPES:
                missing.append(name)
                continue
            if scope == 'company' and 'company_id' not in model._fields:
                company_without_field.append(name)
        self.assertFalse(missing, f'liwan tables missing _liwan_scope: {missing}')
        self.assertFalse(invalid, f'invalid abstract scopes: {invalid}')
        self.assertFalse(
            company_without_field,
            f'company scope without company_id: {company_without_field}',
        )

    def test_explicit_services_are_global(self):
        for name, scope in EXPLICIT_ABSTRACT.items():
            self.assertEqual(self.env[name]._liwan_scope, scope)
