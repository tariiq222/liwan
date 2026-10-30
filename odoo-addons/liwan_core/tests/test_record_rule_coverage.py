# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestRecordRuleCoverage(TransactionCase):

    def test_company_scoped_tables_have_company_rules(self):
        rules = self.env['ir.rule'].sudo().search([])
        by_model = {}
        for rule in rules:
            by_model.setdefault(rule.model_id.model, []).append(rule.domain_force or '')
        missing = []
        for name, cls in self.env.registry.items():
            if not name.startswith('liwan.'):
                continue
            if not bool(getattr(cls, '_auto', True)) or bool(getattr(cls, '_abstract', False)):
                continue
            model = self.env[name]
            if getattr(model, '_liwan_scope', None) != 'company':
                continue
            domains = by_model.get(name, [])
            if not any('company_id' in domain for domain in domains):
                missing.append(name)
        self.assertFalse(missing, f'company-scoped models missing company ir.rule: {missing}')
