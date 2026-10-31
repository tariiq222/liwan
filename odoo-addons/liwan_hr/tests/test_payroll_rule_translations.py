# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from pathlib import Path

from odoo.tests import TransactionCase, tagged

ADDON = Path(__file__).resolve().parent.parent
TRANSLATED_MODELS = ('hr.salary.rule', 'hr.salary.rule.category')


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollRuleTranslations(TransactionCase):
    """A payslip line carries its salary rule's name, so every shipped rule and category has an Arabic name."""

    def test_every_shipped_rule_and_category_has_an_arabic_name(self):
        data = (ADDON / 'data/hr_payroll_structure_data.xml').read_text(encoding='utf-8')
        shipped = re.findall(
            r'<record id="(\w+)" model="(hr\.salary\.rule(?:\.category)?)">\s*<field name="name">([^<]+)</field>', data,
        )
        self.assertTrue(shipped)
        catalog = (ADDON / 'i18n/ar.po').read_text(encoding='utf-8')
        for xml_id, model, name in shipped:
            self.assertIn(model, TRANSLATED_MODELS)
            entry = re.search(
                rf'#: model:{re.escape(model)},name:liwan_hr\.{xml_id}\nmsgid "{re.escape(name)}"\nmsgstr "([^"]+)"', catalog,
            )
            self.assertTrue(entry, f'{xml_id} has no Arabic name')
            self.assertFalse(re.search(r'[A-Za-z]{3}', entry.group(1).replace('GOSI', '')), f'{xml_id} is still English')
