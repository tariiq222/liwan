# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

URL = '/api/v1/settings/storage'
FIELDS = {'id', 'name', 'size_bytes', 'created_at', 'blocked', 'record'}


@tagged('post_install', '-at_install', 'liwan')
class TestStorageInventory(LiwanApiCase):

    def _actor(self, login, company):
        return new_test_user(
            self.env, login=login, password='storage_inventory_pass_123',
            groups='liwan_core.group_access_admin', company_id=company.id,
            company_ids=[Command.set(company.ids)],
        )

    def test_list_exposes_only_current_company_and_authorized_parent_metadata(self):
        profile = self.env.ref('liwan_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT: True})
        root = profile.root_company_id
        hq_admin = self._actor('storage_hq_admin', root)
        foreign_id = profile._liwan_apply_branches(
            'storage-inventory', 'test', [{'branch_id': 'storage-branch', 'name': 'Storage branch'}],
        )[0]['odoo_company_id']
        branch = self.env['res.company'].browse(foreign_id)
        branch_admin = self._actor('storage_branch_admin', branch)
        Attachment = self.env['ir.attachment']
        first, second = Attachment.with_user(hq_admin).create([
            {'name': 'visible-one.txt', 'raw': b'alpha', 'company_id': root.id},
            {'name': 'visible-two.txt', 'raw': b'beta', 'company_id': root.id},
        ])
        branch_file = Attachment.with_user(branch_admin).with_company(branch).create({
            'name': 'branch-owned.txt', 'raw': b'branch', 'company_id': branch.id,
        })
        foreign = self.env['res.partner'].create({'name': 'Branch owner', 'company_id': branch.id})
        Attachment.create({
            'name': 'other-company-parent.txt', 'raw': b'private name',
            'company_id': root.id, 'res_model': foreign._name, 'res_id': foreign.id, 'public': True,
        })
        Attachment.create({'name': 'unowned-by-actor.txt', 'raw': b'private staging', 'company_id': root.id})
        profile.write({'features': {**profile.features, 'storage.limit_mb': 0}})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', URL).status_code, 403)
        self.authenticate('storage_hq_admin', 'storage_inventory_pass_123')
        result = self.api('GET', URL + '?blocked=true')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), {'items', 'total', 'summary'})
        self.assertEqual(set(body['items'][0]), FIELDS)
        ids = [row['id'] for row in body['items']]
        self.assertEqual(ids[:2], [second.id, first.id])
        self.assertNotIn(branch_file.id, ids)
        self.assertNotIn('other-company-parent.txt', result.text)
        self.assertNotIn('unowned-by-actor.txt', result.text)
        self.assertIsNone(body['items'][0]['record'])
        self.assertEqual(body['summary']['limit_mb'], 0)
        self.assertGreaterEqual(body['summary']['used_bytes'], body['summary']['blocked_bytes'])
        page = self.api('GET', URL + '?blocked=true&offset=1&limit=1').json()
        self.assertEqual((page['items'][0]['id'], page['total']), (first.id, body['total']))
        self.assertEqual(self.api('GET', URL + '?blocked=maybe').status_code, 422)

        self.authenticate('storage_branch_admin', 'storage_inventory_pass_123')
        result = self.api('GET', URL)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIsNone(result.json()['summary'])
        self.assertIn(branch_file.id, [row['id'] for row in result.json()['items']])
        self.assertNotIn('visible-two.txt', result.text)

    def test_company_settings_grant_does_not_expose_payroll_attachment_names(self):
        if 'hr.payslip' not in self.env:
            self.skipTest('requires the payroll engine')
        company = self.env.ref('liwan_platform.tenant_profile').root_company_id
        actor = self._actor('storage_without_payroll', company)
        employee = self.env['hr.employee'].create({'name': 'Private Payroll Employee', 'company_id': company.id})
        slip = self.env['hr.payslip'].create({
            'employee_id': employee.id, 'date_from': '2026-10-01', 'date_to': '2026-10-31',
        })
        self.assertFalse(slip.with_user(actor).has_access('read'))
        attachment = self.env['ir.attachment'].create({
            'name': 'payroll-private.txt', 'raw': b'sensitive fixture', 'public': True,
            'company_id': company.id, 'res_model': slip._name, 'res_id': slip.id,
        })
        self.authenticate('storage_without_payroll', 'storage_inventory_pass_123')
        response = self.api('GET', URL)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(attachment.id, [row['id'] for row in response.json()['items']])
        self.assertNotIn('payroll-private.txt', response.text)
