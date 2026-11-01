# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

HR_AREA_FEATURES = (
    'hr.recruitment', 'hr.shifts', 'hr.onboarding', 'hr.offboarding', 'hr.assets', 'hr.warnings', 'hr.insurance',
)
# The stock employee plans this release labels, and the purpose each one gets.
STOCK_EMPLOYEE_PLANS = {
    'hr.onboarding_plan': 'onboarding',
    'hr.offboarding_plan': 'offboarding',
}
# The engine groups the recruitment and assets manage capabilities link. They grant the
# engines' own records and must never open hr.group_hr_user or a payroll group.
STOCK_ENGINE_GROUPS = (
    'hr_recruitment.group_hr_recruitment_user',
    'maintenance.group_equipment_manager',
)
DEPARTURE_DATE = date(2026, 11, 30)


@tagged('liwan', 'liwan_access')
class TestHrEngineGroups(TransactionCase):
    """The engine-facing foundation of the five HR areas: the plan purpose field, the
    plan run model with its company and purpose rules, the departure field groups and the
    stock groups the area capabilities link."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.employee = cls.env['hr.employee'].create({
            'name': 'Engine Groups Employee',
            'company_id': cls.company.id,
        })

    def _user_with(self, login, capability_keys):
        """A managed user holding exactly CAPABILITY_KEYS through a custom role."""
        user = new_test_user(
            self.env, login=login, password=f'{login}_pass_123', name=login,
            groups='liwan_core.group_employee',
        )
        role = self.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', list(capability_keys)),
            ]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])
        return user

    def _plan_run(self, plan_xmlid, plan_date=date(2026, 11, 1)):
        return self.env['liwan.hr.plan.run'].create({
            'employee_id': self.employee.id,
            'plan_id': self.env.ref(plan_xmlid).id,
            'plan_date': plan_date,
        })

    def test_hr_purpose_is_limited_to_employee_plans(self):
        plan = self.env['mail.activity.plan'].create({
            'name': 'Employee onboarding',
            'res_model': 'hr.employee',
            'hr_purpose': 'onboarding',
        })
        self.assertEqual(plan.hr_purpose, 'onboarding')
        # The purpose belongs to employee plans only; any other res_model is refused.
        with self.assertRaises(ValidationError):
            self.env['mail.activity.plan'].create({
                'name': 'Partner plan',
                'res_model': 'res.partner',
                'hr_purpose': 'onboarding',
            })
        # An unknown purpose is refused by the Selection itself, before any constraint
        # runs: the ORM raises ValueError, not ValidationError.
        with self.assertRaises(ValueError):
            self.env['mail.activity.plan'].create({
                'name': 'Unknown purpose',
                'res_model': 'hr.employee',
                'hr_purpose': 'clearance',
            })

    def test_stock_employee_plans_carry_their_purpose(self):
        for xmlid, purpose in STOCK_EMPLOYEE_PLANS.items():
            plan = self.env.ref(xmlid)
            self.assertEqual(plan.res_model, 'hr.employee', xmlid)
            self.assertEqual(plan.hr_purpose, purpose, xmlid)

    def test_plan_run_keeps_the_launch_and_its_company(self):
        run = self._plan_run('hr.onboarding_plan')
        self.assertEqual(run.launched_by_id, self.env.user)
        self.assertEqual(run.company_id, self.employee.company_id)
        self.assertEqual(run.plan_date, date(2026, 11, 1))
        self.assertFalse(run.activity_ids)
        rule = self.env.ref('liwan_hr.rule_hr_plan_run_company')
        # A rule without groups is global: it applies to every reader of the model.
        self.assertFalse(rule.groups)
        self.assertIn('company_ids', rule.domain_force)
        self.assertEqual(rule.model_id.model, 'liwan.hr.plan.run')

    def test_plan_run_reads_follow_their_purpose(self):
        onboarding = self._plan_run('hr.onboarding_plan')
        offboarding = self._plan_run('hr.offboarding_plan', date(2026, 12, 1))
        onboarding_reader = self._user_with('hr_engine_onboarding', {'hr.employees.read', 'hr.onboarding.read'})
        offboarding_reader = self._user_with('hr_engine_offboarding', {'hr.employees.read', 'hr.offboarding.read'})
        Run = self.env['liwan.hr.plan.run']
        self.assertEqual(Run.with_user(onboarding_reader).search([]).ids, [onboarding.id])
        self.assertEqual(Run.with_user(offboarding_reader).search([]).ids, [offboarding.id])

    def test_departure_fields_open_for_the_offboarding_read_pair_only(self):
        self.employee.write({
            'departure_reason_id': self.env.ref('hr.departure_resigned').id,
            'departure_date': DEPARTURE_DATE,
            'departure_description': 'Resigned',
        })
        employee_reader = self._user_with('hr_engine_employee_reader', {'hr.employees.read'})
        offboarding_reader = self._user_with(
            'hr_engine_offboarding_reader', {'hr.employees.read', 'hr.offboarding.read'},
        )
        self.assertEqual(
            self.employee.with_user(offboarding_reader).departure_date, DEPARTURE_DATE,
        )
        with self.assertRaises(AccessError):
            self.employee.with_user(employee_reader).departure_date
        # The offboarding read pair opens the departure block, never the contract block.
        with self.assertRaises(AccessError):
            self.employee.with_user(offboarding_reader).contract_date_end

    def test_stock_engine_groups_imply_no_privileged_hr_group(self):
        hr_user = self.env.ref('hr.group_hr_user')
        for xmlid in STOCK_ENGINE_GROUPS:
            group = self.env.ref(xmlid)
            implied = group.all_implied_ids
            self.assertIn(self.env.ref('base.group_user'), implied, xmlid)
            self.assertNotIn(hr_user, implied, xmlid)
            self.assertFalse(implied.filtered(lambda item: 'payroll' in item.name.lower()), xmlid)

    def test_hr_area_features_are_boolean_keys_of_an_installed_owner(self):
        registry = self.env['liwan.feature.registry']
        self.assertLessEqual(set(HR_AREA_FEATURES), set(registry._liwan_boolean_keys()))
        self.assertIn('liwan_hr', registry._liwan_installed_module_ids())
