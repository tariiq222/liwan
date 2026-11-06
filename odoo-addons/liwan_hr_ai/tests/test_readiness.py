# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestHrAiReadiness(TransactionCase):

    def test_the_application_declares_its_main_record_for_the_readiness_check(self):
        check = self.env['liwan.ai.readiness']._liwan_ai_check_map()['hr.employees']
        self.assertEqual((check['owner'], check['model']), ('liwan_hr', 'hr.employee'))

    def test_an_application_with_no_main_record_is_listed_as_not_yet_in_use(self):
        readiness = self.env['liwan.ai.readiness']
        check = readiness._liwan_ai_check_map()['hr.employees']
        # Narrow the check to no record at all: whatever the demo data holds, the application then looks unused.
        self.patch(type(readiness), '_liwan_ai_record_checks', lambda model: ({**check, 'domain': [('id', '=', 0)]},))
        # The tenant has the application and the reader (the test's superuser, who needs no ACL) holds the capability it asks.
        entitlement = type(self.env['liwan.entitlement.service'])
        feature_read = entitlement._liwan_feature_read
        self.patch(entitlement, '_liwan_feature_read', lambda model, key: key == check['feature_key'] or feature_read(model, key))
        access = type(self.env['liwan.access.service'])
        original = access._liwan_has_capability
        self.patch(access, '_liwan_has_capability', lambda model, user, key, record=None, company=None: (
            key == check['capability'] or original(model, user, key, record=record, company=company)))
        items = {item['key']: item for item in readiness._liwan_ai_record_items()}
        self.assertEqual(items['records.hr.employees']['page'], check['page'])
        self.assertEqual(items['records.hr.employees']['severity'], 'optional')
