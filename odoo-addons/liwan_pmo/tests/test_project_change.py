# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_pmo.models.project_project import LiwanChangeRequired

FEATURE = 'pmo.change_control'
# The actor who may take each action, by the login of the fixture user.
ACTOR = {
    'submit': 'api_emp', 'withdraw': 'api_emp',
    'approve': 'api_chg_sponsor', 'reject': 'api_chg_sponsor',
    'implement': 'api_mgr',
}
# Every move the state machine refuses, from the state a request can be in.
ILLEGAL = {
    'draft': ('approve', 'reject', 'implement'),
    'submitted': ('submit', 'implement'),
    'approved': ('submit', 'withdraw', 'approve', 'reject'),
    'rejected': ('submit', 'withdraw', 'approve', 'reject', 'implement'),
    'withdrawn': ('submit', 'withdraw', 'approve', 'reject', 'implement'),
    'implemented': ('submit', 'withdraw', 'approve', 'reject', 'implement'),
}


@tagged('post_install', '-at_install', 'liwan')
class TestProjectChange(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_chg_sponsor', password='api_chg_sponsor_pass_123', name='Sponsor',
            groups='liwan_core.group_employee',
        )
        cls.outsider = new_test_user(
            cls.env, login='api_chg_outsider', password='api_chg_outsider_pass_123', name='Outsider',
            groups='liwan_core.group_employee',
        )
        cls.admin = new_test_user(
            cls.env, login='api_chg_admin', password='api_chg_admin_pass_123', name='Admin',
            groups='base.group_system,liwan_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'liwan_sponsor_id': cls.sponsor.id})
        cls.base = f'/api/v1/projects/{cls.project.id}/changes'

    # --- helpers --------------------------------------------------------------
    def _call(self, login, method, path, body=None):
        password = {'api_emp': 'api_emp_pass_123', 'api_mgr': 'api_mgr_pass_123'}.get(login, f'{login}_pass_123')
        self.authenticate(login, password)
        return self.api(method, path, body)

    def _mode(self, mode):
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.change_control_mode.{self.env.company.id}', mode)

    def _create(self, **extra):
        response = self._call('api_emp', 'POST', self.base, {'title': 'Add a reporting module', **extra})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _act(self, change_id, action, login=None, body=None):
        return self._call(login or ACTOR[action], 'POST', f'{self.base}/{change_id}/{action}', body or {})

    def _in_state(self, state):
        change = self._create()
        path = {
            'draft': (),
            'submitted': ('submit',),
            'approved': ('submit', 'approve'),
            'rejected': ('submit', 'reject'),
            'withdrawn': ('withdraw',),
            'implemented': ('submit', 'approve', 'implement'),
        }[state]
        for action in path:
            response = self._act(change['id'], action, body={'note': 'Not now'} if action == 'reject' else None)
            self.assertEqual(response.status_code, 200, response.text)
        return change['id']

    def _executing(self):
        self.project.sudo().write({'liwan_phase': 'executing'})

    def _patch_scope(self, scope):
        self.project.invalidate_recordset()
        return self._call('api_mgr', 'PATCH', f'/api/v1/projects/{self.project.id}', {
            'expected_updated_at': self.project._liwan_updated_at(), 'charter': {'scope': scope},
        })

    # --- state machine -----------------------------------------------------------
    def test_full_path_to_implemented(self):
        change = self._create(impact_schedule_days=14, impact_cost=5000, impact_scope='One more report')
        self.assertEqual((change['state'], change['number']), ('draft', 1))
        self.assertEqual(change['requester']['id'], self.employee.id)
        submitted = self._act(change['id'], 'submit').json()
        self.assertEqual(submitted['state'], 'submitted')
        approved = self._act(change['id'], 'approve', body={'note': 'Fine'}).json()
        self.assertEqual((approved['state'], approved['decided_by']['id'], approved['decision_note']), ('approved', self.sponsor.id, 'Fine'))
        implemented = self._act(change['id'], 'implement').json()
        self.assertEqual(implemented['state'], 'implemented')
        self.assertTrue(implemented['implemented_at'])

    def test_every_illegal_move_is_refused(self):
        for state, actions in ILLEGAL.items():
            change_id = self._in_state(state)
            for action in actions:
                response = self._act(change_id, action, body={'note': 'x'} if action in ('approve', 'reject') else None)
                self.assertEqual((response.status_code, response.json()['code']), (409, 'change_state'), f'{state} -> {action}')

    def test_terminal_states_are_read_only(self):
        for state in ('rejected', 'withdrawn', 'implemented'):
            change = self._call('api_emp', 'GET', f'{self.base}/{self._in_state(state)}').json()
            patched = self._call('api_emp', 'PATCH', f'{self.base}/{change["id"]}', {
                'expected_updated_at': change['updated_at'], 'title': 'Edited',
            })
            self.assertEqual((patched.status_code, patched.json()['code']), (409, 'change_state'), state)

    def test_submitted_request_is_locked_for_edits(self):
        change = self._act(self._in_state('draft'), 'submit').json()
        patched = self._call('api_emp', 'PATCH', f'{self.base}/{change["id"]}', {
            'expected_updated_at': change['updated_at'], 'title': 'Edited',
        })
        self.assertEqual(patched.status_code, 409)

    def test_numbers_count_per_project(self):
        self.assertEqual([self._create()['number'] for _ in range(3)], [1, 2, 3])
        other = self.env['project.project'].create({'name': 'Other', 'company_id': self.env.company.id})
        other.write({'user_id': self.manager.id})
        created = self._call('api_mgr', 'POST', f'/api/v1/projects/{other.id}/changes', {'title': 'First of its own'})
        self.assertEqual(created.json()['number'], 1)

    def test_draft_edit_and_revision_conflict(self):
        change = self._create()
        edited = self._call('api_emp', 'PATCH', f'{self.base}/{change["id"]}', {
            'expected_updated_at': change['updated_at'], 'title': 'Better title', 'impact_cost': -250.5,
        })
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual((edited.json()['title'], edited.json()['impact_cost']), ('Better title', -250.5))
        self.assertNotEqual(edited.json()['updated_at'], change['updated_at'])
        stale = self._call('api_emp', 'PATCH', f'{self.base}/{change["id"]}', {
            'expected_updated_at': change['updated_at'], 'title': 'Lost update',
        })
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'stale_write'))
        missing = self._call('api_emp', 'PATCH', f'{self.base}/{change["id"]}', {'title': 'No token'})
        self.assertEqual(missing.status_code, 422)

    def test_validation(self):
        for body, field in (
            ({}, 'title'), ({'title': '  '}, 'title'),
            ({'title': 'x', 'impact_schedule_days': 1.5}, 'impact_schedule_days'),
            ({'title': 'x', 'impact_cost': 'lots'}, 'impact_cost'),
            ({'title': 'x', 'state': 'approved'}, 'state'),
        ):
            response = self._call('api_emp', 'POST', self.base, body)
            self.assertEqual((response.status_code, response.json().get('field')), (422, field), body)

    def test_only_the_requester_edits_submits_and_withdraws(self):
        change = self._create()
        for action in ('submit', 'withdraw'):
            self.assertEqual(self._act(change['id'], action, login='api_chg_sponsor').status_code, 403, action)
        patched = self._call('api_chg_sponsor', 'PATCH', f'{self.base}/{change["id"]}', {
            'expected_updated_at': change['updated_at'], 'title': 'Hijack',
        })
        self.assertEqual(patched.status_code, 403)

    def test_only_a_member_raises_a_request(self):
        response = self._call('api_chg_outsider', 'POST', self.base, {'title': 'Drive-by'})
        self.assertEqual(response.status_code, 403)
        listed = self._call('api_chg_outsider', 'GET', self.base).json()
        self.assertFalse(listed['can_create'])

    def test_submit_needs_a_reachable_sponsor(self):
        change = self._create()
        self.project.liwan_sponsor_id = False
        response = self._act(change['id'], 'submit')
        self.assertEqual(response.status_code, 422)

    # --- who decides ---------------------------------------------------------------
    def test_only_the_sponsor_decides(self):
        change_id = self._in_state('submitted')
        for login in ('api_emp', 'api_mgr', 'api_chg_admin', 'api_chg_outsider'):
            for action in ('approve', 'reject'):
                response = self._act(change_id, action, login=login, body={'note': 'x'})
                self.assertEqual(response.status_code, 403, f'{login} {action}')
        self.assertEqual(self.env['liwan.project.change'].browse(change_id).state, 'submitted')

    def test_admin_changes_the_sponsor_instead_of_deciding(self):
        change_id = self._in_state('submitted')
        self.project.liwan_sponsor_id = self.admin
        self.assertEqual(self._act(change_id, 'approve', login='api_chg_admin').status_code, 200)

    def test_manager_who_is_the_sponsor_decides_on_submit(self):
        self.project.liwan_sponsor_id = self.manager
        created = self._call('api_mgr', 'POST', self.base, {'title': 'My own call'}).json()
        decided = self._act(created['id'], 'submit', login='api_mgr').json()
        self.assertEqual((decided['state'], decided['decided_by']['id']), ('approved', self.manager.id))

    def test_reject_needs_a_note(self):
        change_id = self._in_state('submitted')
        for body in ({}, {'note': '   '}, {'note': 'x' * 2001}):
            self.assertEqual(self._act(change_id, 'reject', body=body).status_code, 422, body)
        rejected = self._act(change_id, 'reject', body={'note': 'Out of scope'}).json()
        self.assertEqual((rejected['state'], rejected['decision_note']), ('rejected', 'Out of scope'))

    def test_only_a_manager_implements(self):
        change_id = self._in_state('approved')
        self.assertEqual(self._act(change_id, 'implement', login='api_emp').status_code, 403)
        self.assertEqual(self._act(change_id, 'implement', login='api_chg_sponsor').status_code, 403)

    def test_decision_fields_only_move_through_the_actions(self):
        change = self.env['liwan.project.change'].browse(self._in_state('submitted'))
        sponsor_change = change.with_user(self.sponsor)
        for vals in ({'state': 'approved'}, {'decided_by_id': self.sponsor.id}, {'liwan_revision': 99}):
            with self.assertRaises(AccessError):
                sponsor_change.write(vals)
        with self.assertRaises(ValidationError):
            sponsor_change.write({'number': 7})
        with self.assertRaises(ValidationError):
            self.env['liwan.project.change'].with_user(self.employee).create({
                'project_id': self.project.id, 'title': 'Pre-approved', 'state': 'approved',
            })
        with self.assertRaises(AccessError):
            change.with_user(self.employee).unlink()

    # --- change control mode ------------------------------------------------------------
    def test_required_mode_blocks_a_scope_edit_while_executing(self):
        self._mode('required')
        self._executing()
        response = self._patch_scope('Everything and more')
        self.assertEqual((response.status_code, response.json()['code']), (409, 'change_required'))
        self.assertFalse(self.project.liwan_scope)
        with self.assertRaises(LiwanChangeRequired):
            self.project.with_user(self.manager).write({'liwan_budget_state': 'estimate', 'liwan_budget_amount': 100})

    def test_required_mode_allows_the_edit_with_an_approved_request(self):
        self._mode('required')
        self._executing()
        self._in_state('approved')
        response = self._patch_scope('Everything and more')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.project.liwan_scope, 'Everything and more')

    def test_required_mode_ignores_requests_that_are_not_approved_or_already_implemented(self):
        self._mode('required')
        self._executing()
        for state in ('draft', 'submitted', 'rejected', 'withdrawn', 'implemented'):
            self._in_state(state)
        self.assertEqual(self._patch_scope('Still blocked').status_code, 409)

    def test_required_mode_leaves_other_fields_and_other_phases_alone(self):
        self._mode('required')
        self.project.with_user(self.manager).write({'liwan_scope': 'Planned scope'})
        self.assertEqual(self.project.liwan_scope, 'Planned scope')
        self._executing()
        self.project.with_user(self.manager).write({'name': 'Renamed', 'liwan_scope': 'Planned scope'})
        self.assertEqual(self.project.name, 'Renamed')

    def test_optional_mode_blocks_nothing_and_keeps_an_approved_charter(self):
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.require_charter_approval.{self.env.company.id}', 'true')
        self.project.sudo()._liwan_write_charter_approval({'liwan_charter_state': 'approved'})
        self._executing()
        self._mode('optional')
        self.assertEqual(self._patch_scope('Changed freely').status_code, 200)
        self.assertEqual(self.project.liwan_charter_state, 'approved')

    def test_off_mode_keeps_the_charter_reopening(self):
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.require_charter_approval.{self.env.company.id}', 'true')
        self.project.sudo()._liwan_write_charter_approval({'liwan_charter_state': 'approved'})
        self._mode('off')
        self.assertEqual(self._patch_scope('Reopens the charter').status_code, 200)
        self.assertEqual(self.project.liwan_charter_state, 'draft')

    def test_off_mode_refuses_every_write_but_keeps_the_history(self):
        change_id = self._in_state('submitted')
        self._mode('off')
        created = self._call('api_emp', 'POST', self.base, {'title': 'Too late'})
        self.assertEqual((created.status_code, created.json()['code']), (409, 'change_control_off'))
        decided = self._act(change_id, 'approve')
        self.assertEqual((decided.status_code, decided.json()['code']), (409, 'change_control_off'))
        self.assertEqual(self._call('api_emp', 'GET', self.base).json()['total'], 1)

    def test_a_plan_without_the_feature_reads_as_off(self):
        self._mode('required')
        self._executing()
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, FEATURE: False}})
        self.assertEqual(self._patch_scope('No request possible').status_code, 200)
        response = self._call('api_emp', 'POST', self.base, {'title': 'Not in the plan'})
        self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))

    def test_mode_is_a_company_setting_managers_change(self):
        self.assertEqual(self.env['liwan.pmo.settings'].change_control_mode(), 'optional')
        denied = self._call('api_emp', 'PATCH', '/api/v1/settings/projects', {'change_control_mode': 'required'})
        self.assertEqual(denied.status_code, 403, denied.text)
        manager_saved = self._call('api_mgr', 'PATCH', '/api/v1/settings/projects', {'change_control_mode': 'required'})
        self.assertEqual(manager_saved.status_code, 200, manager_saved.text)
        self.assertEqual(manager_saved.json()['change_control_mode'], 'required')
        invalid = self._call('api_mgr', 'PATCH', '/api/v1/settings/projects', {'change_control_mode': 'sometimes'})
        self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'change_control_mode'))

    # --- notifications -----------------------------------------------------------------------
    def _bell(self, login):
        return [item for item in self._call(login, 'GET', '/api/v1/notifications').json()['items'] if item['kind'].startswith('change_')]

    def test_sponsor_is_asked_and_requester_is_told(self):
        change = self._create()
        self.assertEqual(self._bell('api_chg_sponsor'), [])
        self._act(change['id'], 'submit')
        asked = self._bell('api_chg_sponsor')
        self.assertEqual([(row['kind'], row['change_id'], row['project_id']) for row in asked], [('change_review', change['id'], self.project.id)])
        self.assertEqual(self._bell('api_emp'), [])
        self._act(change['id'], 'approve')
        self.assertEqual([row['kind'] for row in self._bell('api_emp')], ['change_approved'])
        self.assertEqual(self._bell('api_chg_sponsor'), [], 'the review row goes once the request is decided')
        self._in_state('rejected')
        self.assertEqual(sorted(row['kind'] for row in self._bell('api_emp')), ['change_approved', 'change_rejected'])
        self.assertEqual(self._bell('api_mgr'), [])

    def test_a_decision_by_the_requester_notifies_nobody(self):
        self.project.liwan_sponsor_id = self.manager
        created = self._call('api_mgr', 'POST', self.base, {'title': 'Self'}).json()
        self._act(created['id'], 'submit', login='api_mgr')
        self.assertEqual(self._bell('api_mgr'), [])

    # --- categories --------------------------------------------------------------------------
    def test_every_company_has_the_five_seeded_categories(self):
        listed = self._call('api_emp', 'GET', '/api/v1/pmo/change-categories').json()
        self.assertEqual([item['name'] for item in listed['items']], ['النطاق', 'الجدول الزمني', 'التكلفة', 'الجودة', 'أخرى'])
        self.env.company._liwan_seed_change_categories()
        self.assertEqual(self._call('api_emp', 'GET', '/api/v1/pmo/change-categories').json()['total'], 5)

    def test_settings_managers_shape_the_category_list(self):
        created = self._call('api_mgr', 'POST', '/api/v1/pmo/change-categories', {'name': 'Regulatory', 'sequence': 60})
        self.assertEqual(created.status_code, 201, created.text)
        category_id = created.json()['id']
        renamed = self._call('api_mgr', 'PATCH', f'/api/v1/pmo/change-categories/{category_id}', {'name': 'Legal'})
        self.assertEqual(renamed.json()['name'], 'Legal')
        self._call('api_mgr', 'PATCH', f'/api/v1/pmo/change-categories/{category_id}', {'active': False})
        names = [item['name'] for item in self._call('api_emp', 'GET', '/api/v1/pmo/change-categories').json()['items']]
        self.assertNotIn('Legal', names)
        every = [item['name'] for item in self._call('api_mgr', 'GET', '/api/v1/pmo/change-categories?active=all').json()['items']]
        self.assertIn('Legal', every)
        self.assertEqual(self._call('api_emp', 'GET', '/api/v1/pmo/change-categories?active=all').status_code, 403)
        self.assertEqual(self._call('api_emp', 'POST', '/api/v1/pmo/change-categories', {'name': 'Mine'}).status_code, 403)

    def test_a_request_carries_an_active_category_of_its_company(self):
        category = self.env['liwan.project.change.category'].search([('seed_key', '=', 'cost')], limit=1)
        change = self._create(category_id=category.id)
        self.assertEqual(change['category'], {'id': category.id, 'name': category.name})
        other = self.env['res.company'].create({'name': 'Elsewhere'})
        foreign = self.env['liwan.project.change.category'].search([('company_id', '=', other.id)], limit=1)
        self.assertTrue(foreign)
        response = self._call('api_emp', 'POST', self.base, {'title': 'Wrong list', 'category_id': foreign.id})
        self.assertEqual(response.status_code, 422)
        category.write({'active': False})
        response = self._call('api_emp', 'POST', self.base, {'title': 'Archived list', 'category_id': category.id})
        self.assertEqual(response.status_code, 422)

    def test_a_new_company_gets_its_own_categories(self):
        # Core res.company.create admits only a system administrator, who need not hold the employee ACL rows.
        sysadmin = new_test_user(self.env, login='chg_sysadmin', groups='base.group_system')
        company = self.env['res.company'].with_user(sysadmin).create({'name': 'Fresh company'})
        Category = self.env['liwan.project.change.category'].with_context(active_test=False)
        seeded = Category.search([('company_id', '=', company.id)])
        self.assertEqual(sorted(seeded.mapped('seed_key')), ['cost', 'other', 'quality', 'schedule', 'scope'])
        seeded[0].write({'active': False})
        company.with_user(sysadmin)._liwan_seed_change_categories()
        self.assertEqual(Category.search_count([('company_id', '=', company.id)]), 5)

    # --- listing and archived projects ---------------------------------------------------------
    def test_list_filters_by_state_and_category(self):
        self._in_state('draft')
        self._in_state('approved')
        approved = self._call('api_emp', 'GET', f'{self.base}?state=approved').json()
        self.assertEqual([item['state'] for item in approved['items']], ['approved'])
        self.assertEqual(self._call('api_emp', 'GET', f'{self.base}?state=bogus').status_code, 422)
        self.assertEqual(self._call('api_emp', 'GET', f'{self.base}?bogus=1').status_code, 400)
        everything = self._call('api_emp', 'GET', self.base).json()
        self.assertEqual((everything['total'], [item['number'] for item in everything['items']]), (2, [2, 1]))
        self.assertTrue(everything['can_create'])

    def test_an_archived_project_keeps_its_requests_out_of_reach(self):
        change_id = self._in_state('draft')
        self.project.active = False
        self.assertEqual(self._call('api_mgr', 'GET', f'{self.base}/{change_id}').status_code, 404)
        self.assertEqual(self._call('api_mgr', 'GET', self.base).status_code, 404)
        refused = self._call('api_mgr', 'POST', self.base, {'title': 'Archived'})
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'archived_project'))

    def test_existing_projects_start_without_requests(self):
        listed = self._call('api_emp', 'GET', self.base).json()
        self.assertEqual((listed['items'], listed['total']), ([], 0))
        self.assertEqual(self._call('api_mgr', 'GET', f'/api/v1/projects/{self.project.id}').json()['change_control_mode'], 'optional')

    def test_unknown_request_is_not_found(self):
        self.assertEqual(self._call('api_emp', 'GET', f'{self.base}/999999').status_code, 404)
        other = self.env['project.project'].create({'name': 'Other', 'company_id': self.env.company.id})
        change_id = self._in_state('draft')
        self.assertEqual(self._call('api_mgr', 'GET', f'/api/v1/projects/{other.id}/changes/{change_id}').status_code, 404)
