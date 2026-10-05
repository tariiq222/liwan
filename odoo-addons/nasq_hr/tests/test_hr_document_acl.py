# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger


@tagged('nasq')
class TestHrDocumentAcl(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.company_other = cls.env['res.company'].create({'name': 'Other Co'})
        cls.dept_a = cls.env['hr.department'].create({
            'name': 'Dept A',
            'company_id': cls.company.id,
        })
        cls.dept_b = cls.env['hr.department'].create({
            'name': 'Dept B',
            'company_id': cls.company.id,
        })
        cls.dept_other = cls.env['hr.department'].create({
            'name': 'Other Dept',
            'company_id': cls.company_other.id,
        })
        cls.employee = new_test_user(
            cls.env, login='hr_emp', groups='nasq_core.group_employee',
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.hr_manager = new_test_user(
            cls.env, login='hr_cadmin', groups='nasq_core.group_employee',
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.env['nasq.access.service']._nasq_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('nasq_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.doc_other = cls.env['nasq.hr.document'].create({
            'name': 'Other Co Policy',
            'department_id': cls.dept_other.id,
            'company_id': cls.company_other.id,
        })
        cls.env.flush_all()
        cls.env.invalidate_all()

    def test_missing_department_id_invalid(self):
        with mute_logger('odoo.sql_db'), self.assertRaises(IntegrityError):
            self.env['nasq.hr.document'].create({'name': 'No department'})
            self.env.flush_all()

    def test_employee_reads_other_department_cannot_create(self):
        doc = self.env['nasq.hr.document'].create({
            'name': 'Dept B Policy',
            'department_id': self.dept_b.id,
        })
        Document = self.env['nasq.hr.document'].with_user(self.employee)
        found = Document.search([('id', '=', doc.id)])
        self.assertEqual(found.ids, [doc.id])
        self.assertEqual(found.name, 'Dept B Policy')
        with self.assertRaises(AccessError):
            Document.create({
                'name': 'Employee Doc',
                'department_id': self.dept_a.id,
            })

    def test_hr_manager_creates_and_updates_but_cannot_hard_delete(self):
        Document = self.env['nasq.hr.document'].with_user(self.hr_manager)
        doc_a = Document.create({
            'name': 'Doc A',
            'department_id': self.dept_a.id,
        })
        doc_b = Document.create({
            'name': 'Doc B',
            'department_id': self.dept_b.id,
        })
        doc_a.write({'name': 'Doc A2', 'body': '<p>Hi</p>'})
        self.assertEqual(doc_a.name, 'Doc A2')
        with self.assertRaises(AccessError):
            doc_b.unlink()
        with self.assertRaises(AccessError):
            doc_a.unlink()

    def test_other_company_document_invisible(self):
        for user in (self.employee, self.hr_manager):
            found = self.env['nasq.hr.document'].with_user(user).search([
                ('id', '=', self.doc_other.id),
            ])
            self.assertFalse(found)
