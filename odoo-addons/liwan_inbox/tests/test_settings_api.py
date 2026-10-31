# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanInboxCase
from odoo.addons.liwan_inbox import hooks
from odoo.addons.liwan_inbox.models.presets import PRESETS


@tagged('post_install', '-at_install', 'liwan')
class TestSettingsApi(LiwanInboxCase):

    def test_settings_read_and_patch(self):
        self.login(self.manager)
        body = self.get('/api/v1/settings/inbox').json()
        self.assertEqual(set(body), {
            'visibility_policy', 'auto_close_hours', 'retention_months', 'assignment_policy', 'first_response_alert_minutes',
        })
        self.assertEqual(body, {
            'visibility_policy': 'department', 'auto_close_hours': 72, 'retention_months': 24,
            'assignment_policy': 'manual', 'first_response_alert_minutes': 0,
        })
        patched = self.api('PATCH', '/api/v1/settings/inbox', {'visibility_policy': 'all', 'auto_close_hours': 0})
        self.assertEqual((patched.status_code, patched.json()['visibility_policy'], patched.json()['auto_close_hours']), (200, 'all', 0))
        both = self.api('PATCH', '/api/v1/settings/inbox', {'assignment_policy': 'least_open', 'first_response_alert_minutes': 15})
        self.assertEqual((both.json()['assignment_policy'], both.json()['first_response_alert_minutes']), ('least_open', 15))
        for bad in (
            {'visibility_policy': 'nobody'}, {'auto_close_hours': 721}, {'retention_months': 0}, {'retention_months': True}, {'x': 1}, {},
            {'assignment_policy': 'random'}, {'first_response_alert_minutes': 1441}, {'first_response_alert_minutes': -1},
            {'first_response_alert_minutes': True},
        ):
            self.assertError(self.api('PATCH', '/api/v1/settings/inbox', bad), 422, 'invalid')

    def test_settings_need_the_settings_capability(self):
        for user in (self.agent, self.supervisor, self.outsider):
            self.login(user)
            self.assertError(self.get('/api/v1/settings/inbox'), 403, 'forbidden')
            self.assertError(self.api('PATCH', '/api/v1/settings/inbox', {'auto_close_hours': 1}), 403, 'forbidden')
            self.assertError(self.api('POST', '/api/v1/settings/inbox/presets/clinic'), 403, 'forbidden')

    def test_a_preset_applied_before_does_not_bring_back_renamed_items(self):
        self.login(self.manager)
        self.assertEqual(self.api('POST', '/api/v1/settings/inbox/presets/clinic').status_code, 200)
        department = self.env['liwan.inbox.department'].search([('name', 'in', PRESETS['clinic']['departments'])], limit=1)
        original = department.name
        department.name = 'Renamed department'
        self.assertEqual(self.api('POST', '/api/v1/settings/inbox/presets/clinic').status_code, 200)
        self.assertFalse(self.env['liwan.inbox.department'].search([('name', '=', original)]))
        self.assertEqual(self.env['liwan.inbox.settings']._get_for_company().applied_preset_ids.mapped('key'), ['clinic'])
        self.assertEqual(self.api('POST', '/api/v1/settings/inbox/presets/store').status_code, 200)
        self.assertEqual(self.env['liwan.inbox.settings']._get_for_company().applied_preset_ids.mapped('key'), ['clinic', 'store'])

    def test_presets_are_idempotent(self):
        self.login(self.manager)
        counts = []
        for _ in range(2):
            result = self.api('POST', '/api/v1/settings/inbox/presets/public_service')
            self.assertEqual(result.status_code, 200, result.text)
            counts.append(tuple(self.env[model].search_count([]) for model in (
                'liwan.inbox.department', 'liwan.inbox.tag', 'liwan.inbox.canned.reply')))
        self.assertEqual(counts[0], counts[1])
        self.assertEqual(result.json(), {
            'visibility_policy': 'assigned_only', 'auto_close_hours': 72, 'retention_months': 60,
            'assignment_policy': 'manual', 'first_response_alert_minutes': 0,
        })
        names = set(self.env['liwan.inbox.department'].search([]).mapped('name'))
        self.assertTrue(set(PRESETS['public_service']['departments']) <= names)
        for key in ('clinic', 'store'):
            self.assertEqual(self.api('POST', f'/api/v1/settings/inbox/presets/{key}').status_code, 200)
        self.assertError(self.api('POST', '/api/v1/settings/inbox/presets/bogus'), 404, 'not_found')

    def test_departments_crud(self):
        self.login(self.manager)
        created = self.api('POST', '/api/v1/inbox/departments', {'name': 'Billing', 'member_ids': [self.agent.id]})
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual((body['name'], body['members']), ('Billing', [{'id': self.agent.id, 'name': self.agent.name}]))
        self.assertError(self.api('POST', '/api/v1/inbox/departments', {'name': 'Billing', 'member_ids': []}), 422, 'invalid')
        self.assertError(self.api('POST', '/api/v1/inbox/departments', {'name': 'X', 'member_ids': [999999]}), 422, 'invalid')
        path = f'/api/v1/inbox/departments/{body["id"]}'
        self.assertEqual(self.api('PATCH', path, {'name': 'Finance'}).json()['name'], 'Finance')
        self.assertEqual(self.api('DELETE', path).status_code, 204)
        self.assertError(self.api('PATCH', path, {'name': 'Gone'}), 404, 'not_found')

    def test_departments_and_tags_can_be_read_by_agents_but_not_written(self):
        self.login(self.agent)
        self.assertEqual(self.get('/api/v1/inbox/departments').status_code, 200)
        self.assertEqual(self.get('/api/v1/inbox/tags').status_code, 200)
        self.assertError(self.api('POST', '/api/v1/inbox/departments', {'name': 'Z', 'member_ids': []}), 403, 'forbidden')
        self.assertError(self.api('POST', '/api/v1/inbox/tags', {'name': 'Z'}), 403, 'forbidden')
        self.login(self.outsider)
        self.assertError(self.get('/api/v1/inbox/tags'), 403, 'forbidden')

    def test_tags_and_canned_replies_crud(self):
        self.login(self.manager)
        tag = self.api('POST', '/api/v1/inbox/tags', {'name': 'Urgent'}).json()
        self.assertEqual(tag['name'], 'Urgent')
        self.assertError(self.api('POST', '/api/v1/inbox/tags', {'name': 'Urgent'}), 422, 'invalid')
        self.assertEqual(self.api('PATCH', f'/api/v1/inbox/tags/{tag["id"]}', {'name': 'Hot'}).json()['name'], 'Hot')
        self.assertEqual(self.api('DELETE', f'/api/v1/inbox/tags/{tag["id"]}').status_code, 204)
        reply = self.api('POST', '/api/v1/inbox/canned-replies', {'shortcut': 'thanks', 'body': 'Thank you!'}).json()
        self.assertEqual((reply['shortcut'], reply['body']), ('thanks', 'Thank you!'))
        self.assertError(self.api('POST', '/api/v1/inbox/canned-replies', {'shortcut': 'thanks', 'body': 'dup'}), 422, 'invalid')
        self.assertError(self.api('POST', '/api/v1/inbox/canned-replies', {'shortcut': 'x'}), 422, 'invalid')
        path = f'/api/v1/inbox/canned-replies/{reply["id"]}'
        self.assertEqual(self.api('PATCH', path, {'body': 'Cheers'}).json()['body'], 'Cheers')
        self.assertEqual(self.api('DELETE', path).status_code, 204)

    def test_every_company_starts_with_its_settings_row(self):
        """INB-201: the install creates the rows at the stated defaults, so a read finds one."""
        Settings = self.env['liwan.inbox.settings']
        Settings.search([]).unlink()
        hooks.post_init_hook(self.env)
        companies = self.env['res.company'].search([])
        self.assertEqual(Settings.search([]).company_id, companies)
        self.assertEqual({row.visibility_policy for row in Settings.search([])}, {'department'})

    def test_reading_the_settings_of_a_company_without_a_row_writes_nothing(self):
        Settings = self.env['liwan.inbox.settings']
        Settings.search([('company_id', '=', self.env.company.id)]).unlink()
        read = Settings._liwan_read_for_company(self.env.company)
        self.assertFalse(read.id)
        self.assertEqual((read.visibility_policy, read.auto_close_hours), ('department', 72))
        self.assertFalse(Settings.search_count([('company_id', '=', self.env.company.id)]))
