# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_core.models.nasq_model import NASQ_SCOPES

# nasq.chat.service and nasq.pmo.settings are asserted by the owning apps.
EXPLICIT_ABSTRACT = {
    'nasq.access.service': 'global',
    'nasq.entitlement.service': 'global',
    'nasq.feature.registry': 'global',
}


@tagged('post_install', '-at_install', 'nasq')
class TestNasqScope(TransactionCase):

    def test_nasq_tables_declare_scope(self):
        missing = []
        invalid = []
        company_without_field = []
        for name, cls in self.env.registry.items():
            if not name.startswith('nasq.'):
                continue
            model = self.env[name]
            is_table = bool(getattr(cls, '_auto', True)) and not bool(
                getattr(cls, '_abstract', False),
            )
            if not is_table:
                if name in EXPLICIT_ABSTRACT:
                    scope = getattr(model, '_nasq_scope', None)
                    if scope != EXPLICIT_ABSTRACT[name]:
                        invalid.append(f'{name}={scope}')
                continue
            scope = getattr(model, '_nasq_scope', None)
            if scope not in NASQ_SCOPES:
                missing.append(name)
                continue
            if scope == 'company' and 'company_id' not in model._fields:
                company_without_field.append(name)
        self.assertFalse(missing, f'nasq tables missing _nasq_scope: {missing}')
        self.assertFalse(invalid, f'invalid abstract scopes: {invalid}')
        self.assertFalse(
            company_without_field,
            f'company scope without company_id: {company_without_field}',
        )

    def test_explicit_services_are_global(self):
        for name, scope in EXPLICIT_ABSTRACT.items():
            self.assertEqual(self.env[name]._nasq_scope, scope)
