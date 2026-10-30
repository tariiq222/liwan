# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue', 'webvue_maintenance')
class TestMaintenanceAccessLog(TransactionCase):

    def test_a_tenant_users_maintenance_change_is_in_the_access_log(self):
        company = self.env['webvue.entitlement.service']._webvue_profile().root_company_id
        manager = new_test_user(
            self.env, login='log_maintenance_mgr', company_id=company.id,
            groups='webvue_core.group_customer_admin,webvue_platform.group_maintenance_manager',
        )
        Preference = self.env['webvue.maintenance.preference'].with_user(manager).with_company(company)
        Preference._webvue_update({'timezone': 'Asia/Riyadh', 'weekday': 4, 'start_minute': 120, 'duration_minutes': 60}, 0)
        event = self.env['webvue.access.audit'].search([('action', '=', 'company.maintenance_changed')])
        self.assertEqual((event.target_type, event.target_id, event.actor_id), ('company', company.id, manager))
        self.assertEqual(event.reason, 'preference_saved')
        self.assertEqual(event.after['timezone'], 'Asia/Riyadh')
        self.env['webvue.maintenance.release'].with_context(**{OPERATOR_CONTEXT: True}).create({
            'company_id': company.id, 'release_id': 'log-release', 'scope': 'tenant', 'policy': 'p',
            'deadline_at': fields.Datetime.now() + timedelta(days=30), 'estimated_seconds': 60,
        })
        self.assertEqual(len(self.env['webvue.access.audit'].search([('action', '=', 'company.maintenance_changed')])), 1)
