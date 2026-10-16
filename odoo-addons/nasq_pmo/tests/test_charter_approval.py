# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase
from odoo.addons.nasq_pmo.models.project_project import NasqCharterState


@tagged('post_install', '-at_install', 'nasq')
class TestCharterApproval(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_sponsor', password='api_sponsor_pass_123', name='Sara',
            groups='nasq_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'nasq_sponsor_id': cls.sponsor.id})

    def _policy(self, required):
        key = f'nasq_pmo.require_charter_approval.{self.env.company.id}'
        self.env['ir.config_parameter'].sudo().set_param(key, 'true' if required else 'false')

    def _as(self, user):
        return self.project.with_user(user)

    def test_submit_without_policy_approves_directly(self):
        self._policy(False)
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'approved')
        self.assertEqual(self.project.nasq_charter_approved_by_id, self.manager)

    def test_submit_with_policy_waits_for_sponsor(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'submitted')
        self.assertEqual(self.project.nasq_charter_submitted_by_id, self.manager)
        self.assertTrue(self._as(self.sponsor)._nasq_can_review_charter())
        self.assertFalse(self._as(self.manager)._nasq_can_review_charter())
        with self.assertRaises(AccessError):
            self._as(self.manager)._nasq_charter_approve()
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(self.project.nasq_charter_state, 'approved')
        self.assertEqual(self.project.nasq_charter_approved_by_id, self.sponsor)

    def test_manager_who_is_sponsor_approves_directly(self):
        self._policy(True)
        self.project.nasq_sponsor_id = self.manager
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def test_submit_requires_sponsor_under_policy(self):
        self._policy(True)
        self.project.nasq_sponsor_id = False
        with self.assertRaises(ValidationError):
            self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'draft')

    def test_submit_requires_readable_sponsor(self):
        self._policy(True)
        outsider = new_test_user(self.env, login='api_portal_like', name='No PMO', groups='base.group_user')
        self.project.nasq_sponsor_id = outsider
        with self.assertRaises(ValidationError):
            self._as(self.manager)._nasq_charter_submit()

    def test_submit_subscribes_sponsor_on_private_project(self):
        self._policy(True)
        self.project.privacy_visibility = 'followers'
        self._as(self.manager)._nasq_charter_submit()
        self.assertIn(self.sponsor, self.project._nasq_followers())

    def test_return_needs_note_and_goes_back_to_draft(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        with self.assertRaises(ValidationError):
            self._as(self.sponsor)._nasq_charter_return('   ')
        self._as(self.sponsor)._nasq_charter_return('Scope is unclear')
        self.assertEqual(self.project.nasq_charter_state, 'draft')
        self.assertEqual(self.project.nasq_charter_return_note, 'Scope is unclear')
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_return_note, '')

    def test_withdraw_by_manager_only(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        with self.assertRaises(AccessError):
            self._as(self.sponsor)._nasq_charter_withdraw()
        self._as(self.manager)._nasq_charter_withdraw()
        self.assertEqual(self.project.nasq_charter_state, 'draft')
        self.assertFalse(self.project.nasq_charter_submitted_by_id)

    def test_wrong_state_transitions_raise(self):
        self._policy(True)
        with self.assertRaises(NasqCharterState):
            self._as(self.sponsor)._nasq_charter_approve()
        with self.assertRaises(NasqCharterState):
            self._as(self.manager)._nasq_charter_withdraw()
        self._policy(False)
        self._as(self.manager)._nasq_charter_submit()
        with self.assertRaises(NasqCharterState):
            self._as(self.manager)._nasq_charter_submit()

    def test_submitted_charter_is_locked(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        with self.assertRaises(NasqCharterState):
            self._as(self.manager)._nasq_write_as_manager({'nasq_scope': 'Changed'})
        # Non-charter fields stay editable while waiting.
        self._as(self.manager)._nasq_write_as_manager({'tag_ids': [(6, 0, [])]})

    def test_change_reopens_approved_charter_under_policy(self):
        self._policy(True)
        self.project.nasq_sponsor_id = self.manager
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.manager)._nasq_write_as_manager({'nasq_scope': 'Bigger scope'})
        self.assertEqual(self.project.nasq_charter_state, 'draft')
        self.assertFalse(self.project.nasq_charter_approved_by_id)

    def test_change_keeps_approval_without_policy(self):
        self._policy(False)
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.manager)._nasq_write_as_manager({'nasq_scope': 'Bigger scope'})
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def test_unchanged_save_keeps_approval(self):
        self._policy(True)
        self.project.write({'nasq_sponsor_id': self.manager.id, 'nasq_scope': 'Same', 'nasq_objectives': [{'goal': 'G', 'metric': '', 'target': ''}]})
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.manager)._nasq_write_as_manager({
            'nasq_scope': 'Same',
            'nasq_objectives': [{'goal': 'G', 'metric': '', 'target': ''}],
            'nasq_sponsor_id': self.manager.id,
            'name': self.project.name,
        })
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def test_new_sponsor_reviews_after_change(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        other = new_test_user(self.env, login='api_sponsor2', name='Huda', groups='nasq_core.group_employee')
        with self.assertRaises(NasqCharterState):
            self._as(self.manager)._nasq_write_as_manager({'nasq_sponsor_id': other.id})
        self._as(self.manager)._nasq_charter_withdraw()
        self._as(self.manager)._nasq_write_as_manager({'nasq_sponsor_id': other.id})
        self._as(self.manager)._nasq_charter_submit()
        self.assertFalse(self._as(self.sponsor)._nasq_can_review_charter())
        self._as(other)._nasq_charter_approve()
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def test_sponsor_change_reopens_approved_charter(self):
        self._policy(True)
        self.project.nasq_sponsor_id = self.manager
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'approved')
        self._as(self.manager)._nasq_write_as_manager({'nasq_sponsor_id': self.sponsor.id})
        self.assertEqual(self.project.nasq_charter_state, 'draft')

    def test_private_switch_while_submitted_subscribes_sponsor(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        self.assertNotIn(self.sponsor, self.project._nasq_followers())
        self._as(self.manager)._nasq_write_as_manager({'privacy_visibility': 'followers'})
        self.assertIn(self.sponsor, self.project._nasq_followers())
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def test_submitted_survives_policy_off(self):
        self._policy(True)
        self._as(self.manager)._nasq_charter_submit()
        self._policy(False)
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(self.project.nasq_charter_state, 'approved')

    def test_state_is_not_manager_writable(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.manager).write({'nasq_charter_state': 'approved'})

    def test_copy_starts_as_draft(self):
        self._policy(False)
        self._as(self.manager)._nasq_charter_submit()
        copy = self.project.copy()
        self.assertEqual(copy.nasq_charter_state, 'draft')
        self.assertFalse(copy.nasq_charter_approved_by_id)

    def test_submit_rejects_sponsor_outside_the_company(self):
        self._policy(True)
        other = self.env['res.company'].create({'name': 'Elsewhere'})
        stranger = new_test_user(
            self.env, login='api_stranger', name='Stranger', groups='nasq_core.group_employee',
            company_id=other.id, company_ids=[(6, 0, [other.id])],
        )
        # Writes refuse such a sponsor; this simulates a sponsor who left the company later.
        self.env.cr.execute('UPDATE project_project SET nasq_sponsor_id = %s WHERE id = %s', [stranger.id, self.project.id])
        self.project.invalidate_recordset()
        with self.assertRaises(ValidationError):
            self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'draft')

    def test_submit_rejects_sponsor_who_cannot_see_the_project(self):
        self._policy(True)
        service = self.env['nasq.access.service']
        # The sponsor keeps pmo.projects.read in this company but loses access to it,
        # so only the visibility check (not the capability check) can refuse them.
        self.env.cr.execute(
            'DELETE FROM res_company_users_rel WHERE user_id = %s AND cid = %s',
            [self.sponsor.id, self.project.company_id.id],
        )
        self.env.invalidate_all()
        self.env.registry.clear_cache()
        self.assertTrue(service._nasq_has_capability(self.sponsor, 'pmo.projects.read', company=self.project.company_id))
        with self.assertRaises(ValidationError):
            self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'draft')

    def test_cannot_unsubscribe_waiting_sponsor_on_private_project(self):
        self._policy(True)
        self.project.privacy_visibility = 'followers'
        self._as(self.manager)._nasq_charter_submit()
        with self.assertRaises(NasqCharterState):
            self._as(self.manager)._nasq_remove_follower(self.sponsor)
        self.assertIn(self.sponsor, self.project._nasq_followers())
        self._as(self.manager)._nasq_charter_withdraw()
        self._as(self.manager)._nasq_remove_follower(self.sponsor)
        self.assertNotIn(self.sponsor, self.project._nasq_followers())


@tagged('post_install', '-at_install', 'nasq')
class TestCharterApprovalApi(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_sponsor', password='api_sponsor_pass_123', name='Sara',
            groups='nasq_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'nasq_sponsor_id': cls.sponsor.id})
        key = f'nasq_pmo.require_charter_approval.{cls.env.company.id}'
        cls.env['ir.config_parameter'].sudo().set_param(key, 'true')

    def _post(self, action, body):
        return self.api('POST', f'/api/v1/projects/{self.project.id}/charter/{action}', body)

    def _token(self):
        return self.api('GET', f'/api/v1/projects/{self.project.id}').json()['updated_at']

    def test_full_flow_over_http(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self._post('submit', {'expected_updated_at': self._token()})
        self.assertEqual(res.status_code, 200, res.text)
        charter = res.json()['charter']
        self.assertEqual((charter['state'], charter['approval_required'], charter['can_review']), ('submitted', True, False))
        self.assertEqual(charter['submitted_by']['id'], self.manager.id)
        locked = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {
            'expected_updated_at': res.json()['updated_at'], 'charter': {'scope': 'x'},
        })
        self.assertEqual((locked.status_code, locked.json()['code']), (409, 'charter_state'))

        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        waiting = self.api('GET', '/api/v1/projects?charter_review=1').json()
        self.assertEqual([item['id'] for item in waiting['items']], [self.project.id])
        self.assertEqual(waiting['items'][0]['charter_state'], 'submitted')
        detail = self.api('GET', f'/api/v1/projects/{self.project.id}').json()
        self.assertTrue(detail['charter']['can_review'])
        res = self._post('approve', {'expected_updated_at': detail['updated_at']})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['charter']['state'], 'approved')
        self.assertEqual(res.json()['charter']['approved_by']['id'], self.sponsor.id)
        self.assertTrue(res.json()['charter']['approved_at'])

    def test_return_requires_note(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._post('submit', {'expected_updated_at': self._token()})
        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        token = self._token()
        missing = self._post('return', {'expected_updated_at': token})
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'note'))
        res = self._post('return', {'expected_updated_at': token, 'note': 'Add the budget'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['charter']['state'], res.json()['charter']['return_note']), ('draft', 'Add the budget'))

    def test_approve_with_stale_token(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        submitted = self._post('submit', {'expected_updated_at': self._token()}).json()
        self.project.with_user(self.manager)._nasq_write_as_manager({'tag_ids': [(6, 0, [])]})
        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        res = self._post('approve', {'expected_updated_at': submitted['updated_at']})
        self.assertEqual((res.status_code, res.json()['code']), (409, 'stale_write'))

    def test_manager_cannot_self_swap_sponsor_while_submitted(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        submitted = self._post('submit', {'expected_updated_at': self._token()}).json()
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {
            'expected_updated_at': submitted['updated_at'], 'charter': {'sponsor_id': self.manager.id},
        })
        self.assertEqual((res.status_code, res.json()['code']), (409, 'charter_state'))

    def test_unchanged_wizard_save_keeps_state_with_blank_fields(self):
        self.env.cr.execute('UPDATE project_project SET description = NULL WHERE id = %s', [self.project.id])
        self.project.invalidate_recordset()
        self.assertFalse(self.project.description)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        project = self.project
        charter = {
            'sponsor_id': self.sponsor.id, 'authority': '', 'rationale': '', 'objectives': [],
            'benefits': '', 'scope': '', 'exclusions': '', 'high_level_requirements': '',
            'deliverables': [], 'success': '', 'budget_state': 'unknown', 'amount': None,
            'priority': None, 'assumptions': '', 'constraints': '', 'closure': '',
        }

        def wizard_body(token):
            return {
                'expected_updated_at': token, 'name': project.name, 'description': '',
                'user_id': self.manager.id, 'date_start': None, 'date': None, 'charter': dict(charter),
            }

        path = f'/api/v1/projects/{project.id}'
        submitted = self._post('submit', {'expected_updated_at': self._token()}).json()
        res = self.api('PATCH', path, wizard_body(submitted['updated_at']))
        self.assertEqual((res.status_code, res.json()['charter']['state']), (200, 'submitted'), res.text)
        project.with_user(self.manager)._nasq_charter_withdraw()
        project.nasq_sponsor_id = self.manager
        project.with_user(self.manager)._nasq_charter_submit()
        self.assertEqual(project.nasq_charter_state, 'approved')
        body = wizard_body(self._token())
        body['charter']['sponsor_id'] = self.manager.id
        res = self.api('PATCH', path, body)
        self.assertEqual((res.status_code, res.json()['charter']['state']), (200, 'approved'), res.text)

    def test_errors(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        token = self._token()
        self.assertEqual(self._post('approve', {'expected_updated_at': token}).status_code, 403)
        self.assertEqual(self._post('withdraw', {'expected_updated_at': token}).json()['code'], 'charter_state')
        self.assertEqual(self._post('submit', {}).status_code, 422)
        self.assertEqual(self._post('submit', {'expected_updated_at': token, 'x': 1}).status_code, 422)
        self.assertEqual(self.api('POST', '/api/v1/projects/999999/charter/submit', {'expected_updated_at': 'v1'}).status_code, 404)

    def test_charter_review_filter(self):
        other = self.env['project.project'].create({'name': 'Other', 'user_id': self.manager.id, 'nasq_sponsor_id': self.sponsor.id})
        second_sponsor = new_test_user(self.env, login='api_sponsor_two', name='Huda', groups='nasq_core.group_employee')
        foreign = self.env['project.project'].create({
            'name': 'Foreign', 'user_id': self.manager.id, 'nasq_sponsor_id': second_sponsor.id,
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._post('submit', {'expected_updated_at': self._token()})
        foreign_token = self.api('GET', f'/api/v1/projects/{foreign.id}').json()['updated_at']
        res = self.api('POST', f'/api/v1/projects/{foreign.id}/charter/submit', {'expected_updated_at': foreign_token})
        self.assertEqual(res.json()['charter']['state'], 'submitted', res.text)
        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        res = self.api('GET', '/api/v1/projects?charter_review=1').json()
        self.assertEqual([i['id'] for i in res['items']], [self.project.id])
        self.assertNotIn(other.id, [i['id'] for i in res['items']])
        self.assertNotIn(foreign.id, [i['id'] for i in res['items']])
        mine = self.api('GET', '/api/v1/projects?charter_review=1&mine=1').json()
        self.assertEqual(mine['items'], [])
        bad = self.api('GET', '/api/v1/projects?charter_review=maybe')
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'charter_review'))

    def test_non_manager_cannot_submit_or_withdraw(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._post('submit', {'expected_updated_at': self._token()})
        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        token = self._token()
        self.assertEqual(self._post('withdraw', {'expected_updated_at': token}).status_code, 403)
        self.assertEqual(self._post('submit', {'expected_updated_at': token}).status_code, 403)

    def test_remove_sponsor_follower_while_submitted_is_409(self):
        self.project.privacy_visibility = 'followers'
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._post('submit', {'expected_updated_at': self._token()})
        res = self.api('DELETE', f'/api/v1/projects/{self.project.id}/followers/{self.sponsor.id}')
        self.assertEqual((res.status_code, res.json()['code']), (409, 'charter_state'))
