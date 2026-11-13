# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.liwan_core.models.setup_step import SETUP_OUTCOMES, SETUP_STEP_KEYS


@tagged('post_install', '-at_install', 'liwan')
class TestSetupStep(TransactionCase):
    """The first-run setup wizard's stored progress: generic keys, one outcome per company and step."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.other = cls.env['res.company'].create({'name': 'Setup other tenant'})
        cls.branch = cls.env['res.company'].create({'name': 'Setup branch', 'parent_id': cls.company.id})
        role = cls.env.ref('liwan_core.role_system_admin')
        cls.admin = new_test_user(
            cls.env, login='setup_admin', password='setup_admin_pass_123', groups='liwan_core.group_employee',
            company_id=cls.company.id, company_ids=[(6, 0, [cls.company.id, cls.other.id, cls.branch.id])],
        )
        cls.member = new_test_user(
            cls.env, login='setup_member', password='setup_member_pass_123', groups='liwan_core.group_employee',
        )
        for company in (cls.company, cls.other, cls.branch):
            cls.env['liwan.access.assignment'].create({'user_id': cls.admin.id, 'role_id': role.id, 'company_id': company.id})

    def steps(self, user, company):
        model = self.env['liwan.setup.step'].with_user(user).with_company(company)
        return model, model._liwan_progress()

    def test_five_generic_steps_and_two_outcomes(self):
        self.assertEqual(SETUP_STEP_KEYS, ('company', 'sector', 'channels', 'team', 'contacts'))
        self.assertEqual(SETUP_OUTCOMES, ('done', 'skipped'))
        fields = self.env['liwan.setup.step']._fields
        self.assertEqual([key for key, _label in fields['step_key'].selection], list(SETUP_STEP_KEYS))
        self.assertEqual([key for key, _label in fields['outcome'].selection], list(SETUP_OUTCOMES))

    def test_fresh_company_has_every_step_open_and_the_wizard_open(self):
        _model, (steps, closed_at) = self.steps(self.admin, self.company)
        self.assertEqual([key for key, _row in steps], list(SETUP_STEP_KEYS))
        self.assertFalse(any(row for _key, row in steps))
        self.assertFalse(closed_at)

    def test_outcome_is_recorded_replaced_and_cleared(self):
        model, _progress = self.steps(self.admin, self.company)
        model._liwan_set_outcome('sector', 'skipped')
        model._liwan_set_outcome('sector', 'done')
        rows = self.env['liwan.setup.step'].search([('company_id', '=', self.company.id)])
        self.assertEqual(rows.mapped('step_key'), ['sector'])
        self.assertEqual(rows.outcome, 'done')
        self.assertEqual(rows.user_id, self.admin)
        self.assertTrue(rows.recorded_at)
        model._liwan_set_outcome('sector', None)
        self.assertFalse(self.env['liwan.setup.step'].search([('company_id', '=', self.company.id)]))

    def test_unknown_step_or_outcome_is_refused(self):
        model, _progress = self.steps(self.admin, self.company)
        with self.assertRaises(ValidationError):
            model._liwan_set_outcome('payroll', 'done')
        with self.assertRaises(ValidationError):
            model._liwan_set_outcome('team', 'later')

    def test_one_row_per_company_and_step(self):
        Step = self.env['liwan.setup.step']
        Step.create({'company_id': self.company.id, 'step_key': 'team', 'outcome': 'done'})
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.cr.savepoint():
            Step.create({'company_id': self.company.id, 'step_key': 'team', 'outcome': 'skipped'})
        Step.create({'company_id': self.other.id, 'step_key': 'team', 'outcome': 'skipped'})

    def test_companies_see_only_their_own_progress(self):
        mine, _progress = self.steps(self.admin, self.company)
        mine._liwan_set_outcome('company', 'done')
        theirs, (steps, _closed_at) = self.steps(self.admin, self.other)
        self.assertFalse(any(row for _key, row in steps))
        theirs._liwan_set_outcome('company', 'skipped')
        _model, (steps, _closed_at) = self.steps(self.admin, self.company)
        self.assertEqual(dict(steps)['company'].outcome, 'done')
        visible = self.env['liwan.setup.step'].with_user(self.admin).with_company(self.company).search([])
        self.assertEqual(visible.company_id, self.company)

    def test_closing_and_reopening_the_wizard(self):
        company = self.company.with_user(self.admin)
        company._liwan_set_setup_closed(True)
        closed_at = self.company.liwan_setup_closed_at
        self.assertTrue(closed_at)
        company._liwan_set_setup_closed(True)
        self.assertEqual(self.company.liwan_setup_closed_at, closed_at)
        company._liwan_set_setup_closed(False)
        self.assertFalse(self.company.liwan_setup_closed_at)

    def test_member_without_the_capability_cannot_write(self):
        model = self.env['liwan.setup.step'].with_user(self.member)
        with self.assertRaises(AccessError):
            model._liwan_set_outcome('company', 'done')
        with self.assertRaises(AccessError):
            self.company.with_user(self.member)._liwan_set_setup_closed(True)

    def test_a_branch_has_no_wizard_of_its_own(self):
        branch_model = self.env['liwan.setup.step'].with_user(self.admin).with_company(self.branch)
        with self.assertRaises(AccessError):
            branch_model._liwan_progress()
        with self.assertRaises(AccessError):
            branch_model._liwan_set_outcome('company', 'done')
        with self.assertRaises(AccessError):
            self.branch.with_user(self.admin).with_company(self.branch)._liwan_set_setup_closed(True)
