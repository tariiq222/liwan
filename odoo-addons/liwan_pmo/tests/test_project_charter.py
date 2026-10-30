# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import LiwanPmoCase
from .test_projects import DETAIL_KEYS

CHARTER_KEYS = {
    'code', 'type', 'owning_unit', 'sponsor', 'authority', 'rationale', 'objectives',
    'benefits', 'scope', 'exclusions', 'high_level_requirements', 'deliverables',
    'success', 'budget_state', 'amount', 'currency', 'priority', 'assumptions',
    'constraints', 'closure', 'state', 'approval_required', 'can_review',
    'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'return_note',
}


@tagged('post_install', '-at_install', 'liwan')
class TestProjectCharterApi(LiwanPmoCase):

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('liwan_pmo.project_creators', 'managers')
        params.set_param('liwan_pmo.default_stages', False)
        params.set_param(f'liwan_pmo.require_manager_on_create.{self.env.company.id}', 'false')
        params.set_param(f'liwan_pmo.require_end_date_on_create.{self.env.company.id}', 'false')
        self.type_tech = self.env['liwan.project.type'].search([
            ('company_id', '=', self.env.company.id),
            ('seed_key', '=', 'technical'),
        ], limit=1)
        self.unit = self.env['liwan.project.owning.unit'].create({
            'name': 'PMO Office', 'company_id': self.env.company.id,
        })

    def test_name_only_create_roundtrip(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', '/api/v1/projects', {'name': 'Charter only name'})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual(set(body['charter']), CHARTER_KEYS)
        self.assertTrue(body['charter']['code'].startswith('PRJ-'))
        self.assertEqual(len(body['charter']['code']), 10)
        self.assertEqual(body['updated_at'], 'v1')
        self.assertEqual(body['charter']['budget_state'], 'unknown')
        self.assertIsNone(body['charter']['amount'])
        self.assertEqual(body['charter']['authority'], '')
        self.assertEqual(body['charter']['objectives'], [])
        self.assertEqual(body['charter']['state'], 'draft')
        self.assertEqual(self.api('POST', '/api/v1/projects', {'name': 'Nope', 'secret': 1}).status_code, 422)

    def test_full_charter_roundtrip_and_partial_rows(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', '/api/v1/projects', {
            'name': 'Full charter',
            'description': '<p>d</p>',
            'user_id': self.manager.id,
            'date_start': '2030-01-01',
            'date': '2030-12-31',
            'charter': {
                'type_id': self.type_tech.id,
                'owning_unit_id': self.unit.id,
                'sponsor_id': self.employee.id,
                'authority': 'Board note',
                'rationale': 'Need it',
                'objectives': [{'goal': 'Ship', 'metric': '', 'target': ''}],
                'benefits': 'Faster',
                'scope': 'In',
                'exclusions': 'Out',
                'high_level_requirements': 'Req',
                'deliverables': [{'name': 'Doc', 'description': '', 'acceptance': 'Signed'}],
                'success': 'Done',
                'budget_state': 'estimate',
                'amount': 0,
                'priority': 'high',
                'assumptions': 'A',
                'constraints': 'C',
                'closure': 'Close when signed',
            },
        })
        self.assertEqual(res.status_code, 201, res.text)
        charter = res.json()['charter']
        self.assertEqual(charter['type']['id'], self.type_tech.id)
        self.assertEqual(set(charter['type']), {'id', 'name', 'charter_steps'})
        self.assertEqual(charter['type']['charter_steps'], ['justification', 'scope', 'schedule', 'budget', 'risks'])
        self.assertEqual(set(charter['owning_unit']), {'id', 'name'})
        self.assertEqual(charter['state'], 'draft')
        self.assertEqual(charter['owning_unit']['id'], self.unit.id)
        self.assertEqual(charter['sponsor']['id'], self.employee.id)
        self.assertEqual(charter['amount'], 0)
        self.assertEqual(charter['budget_state'], 'estimate')
        self.assertEqual(charter['priority'], 'high')
        token = res.json()['updated_at']
        project_id = res.json()['id']
        patched = self.api('PATCH', f'/api/v1/projects/{project_id}', {
            'expected_updated_at': token,
            'charter': {'rationale': 'Updated'},
        })
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()['charter']['authority'], 'Board note')
        self.assertEqual(patched.json()['charter']['rationale'], 'Updated')
        self.assertEqual(patched.json()['charter']['state'], 'draft')
        self.assertNotEqual(patched.json()['updated_at'], token)

    def test_charter_state_is_not_writable(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {
            'name': 'Draft charter',
            'charter': {'rationale': 'Partial', 'state': 'draft'},
        })
        self.assertEqual((created.status_code, created.json()['field']), (422, 'state'))
        created = self.api('POST', '/api/v1/projects', {
            'name': 'Draft charter', 'charter': {'rationale': 'Partial'},
        })
        self.assertEqual(created.status_code, 201, created.text)
        body = created.json()
        self.assertEqual(body['charter']['state'], 'draft')
        path = f"/api/v1/projects/{body['id']}"
        for state in ('approved', 'draft'):
            res = self.api('PATCH', path, {
                'expected_updated_at': body['updated_at'],
                'charter': {'state': state},
            })
            self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'unknown_field', 'state'))

    def test_bad_nested_and_readonly_charter_fields(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {'name': 'Nested'}).json()
        token = created['updated_at']
        path = f"/api/v1/projects/{created['id']}"
        empty_row = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'objectives': [{'goal': '', 'metric': '', 'target': ''}]},
        })
        self.assertEqual((empty_row.status_code, empty_row.json()['field']), (422, 'objectives'))
        extra_key = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'deliverables': [{'name': 'A', 'description': '', 'acceptance': '', 'extra': 'x'}]},
        })
        self.assertEqual(extra_key.status_code, 422)
        readonly = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'code': 'PRJ-9'},
        })
        self.assertEqual(readonly.status_code, 422)
        currency = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'currency': {'id': 1, 'name': 'SAR', 'symbol': 'ر.س', 'decimal_places': 2}},
        })
        self.assertEqual(currency.status_code, 422)

    def test_budget_zero_unknown_and_inconsistent(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {
            'name': 'Budget',
            'charter': {'budget_state': 'estimate', 'amount': 0},
        }).json()
        self.assertEqual(created['charter']['amount'], 0)
        token = created['updated_at']
        path = f"/api/v1/projects/{created['id']}"
        unknown = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'budget_state': 'unknown'},
        })
        self.assertEqual(unknown.status_code, 200)
        self.assertIsNone(unknown.json()['charter']['amount'])
        token = unknown.json()['updated_at']
        for bad in (True, '10', -1):
            res = self.api('PATCH', path, {
                'expected_updated_at': token,
                'charter': {'budget_state': 'estimate', 'amount': bad},
            })
            self.assertEqual(res.status_code, 422, bad)
        # Python json2 accepts the NaN token; requests.json cannot send it.
        # The amount parser must still reject the non-finite value.
        malformed = self.url_open(
            path,
            data=(
                '{"expected_updated_at":"%s","charter":{"budget_state":"estimate","amount":NaN}}'
                % token
            ),
            headers={'Content-Type': 'application/json'},
            method='PATCH',
        )
        self.assertEqual((malformed.status_code, malformed.json()['field']), (422, 'amount'))
        missing_amount = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'budget_state': 'estimate'},
        })
        self.assertEqual(missing_amount.status_code, 422)
        from_unknown = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'amount': 5},
        })
        self.assertEqual(from_unknown.status_code, 422)

    def test_stale_concurrency_and_legacy_write_invalidation(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {'name': 'Stale'}).json()
        token = created['updated_at']
        path = f"/api/v1/projects/{created['id']}"
        first = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'authority': 'one'},
        })
        self.assertEqual(first.status_code, 200)
        second = self.api('PATCH', path, {
            'expected_updated_at': token,
            'charter': {'authority': 'two'},
        })
        self.assertEqual((second.status_code, second.json()['code'], second.json()['field']), (409, 'stale_write', 'expected_updated_at'))
        self.assertNotIn('charter', second.json())
        self.assertNotIn('id', second.json())
        missing = self.api('PATCH', path, {'charter': {}})
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'expected_updated_at'))
        legacy = self.api('PATCH', path, {'name': 'Renamed legacy'})
        self.assertEqual(legacy.status_code, 200)
        stale_after_legacy = self.api('PATCH', path, {
            'expected_updated_at': first.json()['updated_at'],
            'charter': {'authority': 'three'},
        })
        self.assertEqual(stale_after_legacy.status_code, 409)
        current = self.api('GET', path).json()['updated_at']
        stale_native = self.api('PATCH', path, {
            'name': 'stale native',
            'expected_updated_at': first.json()['updated_at'],
        })
        self.assertEqual((stale_native.status_code, stale_native.json()['code']), (409, 'stale_write'))
        ok_native = self.api('PATCH', path, {
            'name': 'fresh native',
            'expected_updated_at': current,
        })
        self.assertEqual(ok_native.status_code, 200)

    def test_native_dates_follow_stock_pair_semantics(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {
            'name': 'Dates',
            'date_start': '2030-01-01',
            'date': '2030-12-31',
        }).json()
        self.assertEqual((created['date_start'], created['date_end']), ('2030-01-01', '2030-12-31'))
        path = f"/api/v1/projects/{created['id']}"
        inverted = self.api('PATCH', path, {
            'date_start': '2031-01-01',
            'date': '2030-01-01',
        })
        self.assertEqual(inverted.status_code, 422)
        cleared = self.api('PATCH', path, {
            'date_start': '2030-06-01',
            'date': None,
        })
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual((cleared.json()['date_start'], cleared.json()['date_end']), (None, None))
        restored = self.api('PATCH', path, {
            'date_start': '2030-01-01',
            'date': '2030-12-31',
        }).json()
        renamed = self.api('PATCH', path, {'name': 'Dates stay'})
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual((renamed.json()['date_start'], renamed.json()['date_end']), (restored['date_start'], restored['date_end']))

    def test_sequence_unique_and_legacy_null(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        first = self.api('POST', '/api/v1/projects', {'name': 'Code A'}).json()
        second = self.api('POST', '/api/v1/projects', {'name': 'Code B'}).json()
        self.assertNotEqual(first['charter']['code'], second['charter']['code'])
        self.assertIsNone(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['charter']['code'])
        native = self.env['project.project'].create({'name': 'Vendor create'})
        self.assertFalse(native.liwan_code)

    def test_inactive_ref_unchanged_and_foreign_company_rejected(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {
            'name': 'Refs',
            'charter': {'type_id': self.type_tech.id, 'owning_unit_id': self.unit.id},
        }).json()
        self.type_tech.active = False
        self.unit.active = False
        token = created['updated_at']
        keep = self.api('PATCH', f"/api/v1/projects/{created['id']}", {
            'expected_updated_at': token,
            'charter': {'type_id': self.type_tech.id, 'authority': 'still'},
        })
        self.assertEqual(keep.status_code, 200)
        other = self.env['res.company'].create({'name': 'Other Co'})
        foreign = self.env['liwan.project.type'].search([
            ('company_id', '=', other.id), ('seed_key', '=', 'technical'),
        ], limit=1)
        bad = self.api('PATCH', f"/api/v1/projects/{created['id']}", {
            'expected_updated_at': keep.json()['updated_at'],
            'charter': {'type_id': foreign.id},
        })
        self.assertEqual((bad.status_code, bad.json()['code'], bad.json().get('field')), (422, 'invalid', 'type_id'))
        self.assertNotIn(str(foreign.id), bad.json()['message'])
        self.assertNotIn(other.name, bad.json()['message'])
        unchanged = self.api('GET', f"/api/v1/projects/{created['id']}").json()
        self.assertEqual(unchanged['charter']['type']['id'], self.type_tech.id)


@tagged('liwan')
class TestProjectCharterModel(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(
            cls.env, login='charter_mgr',
            groups='liwan_core.group_employee,project.group_project_manager',
        )
        cls.other = new_test_user(cls.env, login='charter_other', groups='liwan_core.group_employee')

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param(f'liwan_pmo.require_manager_on_create.{self.env.company.id}', 'false')
        params.set_param(f'liwan_pmo.require_end_date_on_create.{self.env.company.id}', 'false')

    def test_manager_policy_create_uses_revision_default(self):
        project = self.env['project.project'].with_user(self.manager)._liwan_create_from_policy('Mgr create')
        self.assertTrue(project.liwan_code)
        self.assertEqual(project.liwan_revision, 1)
        self.assertNotIn('liwan_revision', self.env['project.project']._liwan_create_vals('X'))

    def test_orm_rows_budget_and_protected_fields(self):
        project = self.env['project.project'].with_user(self.manager)._liwan_create_from_policy('ORM')
        self.assertTrue(project.liwan_code)
        self.assertEqual(project.liwan_revision, 1)
        with self.assertRaises(ValidationError):
            project._liwan_write_as_manager({'liwan_objectives': [{'goal': '', 'metric': '', 'target': ''}]})
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_objectives': 0})
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_deliverables': 0.0})
        with self.assertRaises(AccessError):
            project.with_user(self.manager).write({'liwan_code': 'PRJ-999999'})
        with self.assertRaises(AccessError):
            project.with_user(self.manager).write({'liwan_revision': 99})
        project._liwan_write_as_manager({'liwan_budget_state': 'unknown', 'liwan_budget_amount': 0})
        self.assertEqual(project.liwan_budget_amount, 0)
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_budget_state': 'unknown', 'liwan_budget_amount': 5})
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_budget_amount': True})
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_budget_amount': '10'})
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_budget_amount': float('nan')})
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_budget_amount': float('inf')})
        with self.assertRaises(AccessError):
            project.with_user(self.other)._liwan_write_as_manager({'liwan_authority': 'no'})

    def test_company_less_project_cannot_take_catalog(self):
        project = self.env['project.project'].create({'name': 'No company', 'company_id': False})
        seeded = self.env['liwan.project.type'].search([
            ('company_id', '=', self.env.company.id),
        ], limit=1)
        with self.assertRaises(ValidationError):
            project.write({'liwan_type_id': seeded.id})

    def test_new_inactive_catalog_assignment_rejected(self):
        project = self.env['project.project'].with_user(self.manager)._liwan_create_from_policy('Cat')
        seeded = self.env['liwan.project.type'].search([
            ('company_id', '=', self.env.company.id),
        ], limit=1)
        seeded.active = False
        with self.assertRaises(ValidationError):
            project.with_user(self.manager).write({'liwan_type_id': seeded.id})
