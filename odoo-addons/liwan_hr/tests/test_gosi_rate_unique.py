# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

RATE = {
    'branch': 'hazards', 'nationality_class': 'gcc', 'date_from': '2031-01-01',
    'employee_rate': 0, 'employer_rate': 2, 'wage_min': 1500, 'wage_max': 45000,
}


@tagged('post_install', '-at_install', 'liwan')
class TestGosiRateUnique(TransactionCase):

    def _create(self, **extra):
        return self.env['liwan.hr.gosi.rate'].create({**RATE, **extra})

    def test_two_shared_rows_cannot_start_on_the_same_day(self):
        self._create()
        with self.assertRaises(IntegrityError), self.cr.savepoint(), mute_logger('odoo.sql_db'):
            self._create()

    def test_two_company_rows_cannot_start_on_the_same_day(self):
        self._create(company_id=self.env.company.id)
        with self.assertRaises(IntegrityError), self.cr.savepoint(), mute_logger('odoo.sql_db'):
            self._create(company_id=self.env.company.id)

    def test_a_company_row_and_a_shared_row_may_share_a_day(self):
        shared = self._create()
        own = self._create(company_id=self.env.company.id)
        self.assertNotEqual(shared, own)
