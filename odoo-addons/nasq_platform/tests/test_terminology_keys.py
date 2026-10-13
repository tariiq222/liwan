# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_platform.models.entitlement_service import NasqEntitlementService

LEGACY_KEYS = frozenset({
    'nav.projects',
        'nav.allProjects',
        'nav.myProjects',
        'nav.projectTemplates',
        'nav.projectTasks',
        'nav.tasks',
        'projects.title',
        'tasks.title',
        'nav.meetings',
        'nav.meetingCalendar',
        'nav.meetingSeries',
        'nav.organization',
        'nav.employees',
        'nav.departments',
        'nav.documents',
        'hr.directory.title',
        'hr.depts.title',
        'hr.docs.title',
        'nav.chat',
        'chat.title',
})
APPLICATIONS = ('nasq_pmo', 'nasq_meetings', 'nasq_hr', 'nasq_chat')


@tagged('post_install', '-at_install', 'nasq')
class TestTerminologyKeys(TransactionCase):

    def test_base_hook_returns_empty_set(self):
        service = self.env['nasq.entitlement.service']
        self.assertEqual(NasqEntitlementService._nasq_terminology_keys(service), frozenset())

    def test_union_equals_legacy_set_with_all_apps(self):
        installed = self.env['ir.module.module'].sudo().search([
            ('name', 'in', APPLICATIONS), ('state', '=', 'installed'),
        ])
        if len(installed) != len(APPLICATIONS):
            self.skipTest('not every application is installed')
        keys = self.env['nasq.entitlement.service']._nasq_terminology_keys()
        self.assertEqual(keys, LEGACY_KEYS)
        self.assertEqual(len(keys), 20)

    def test_unknown_key_still_rejected_422(self):
        service = self.env['nasq.entitlement.service']
        with self.assertRaises(ValidationError):
            service._nasq_validate_terminology({'ar': {'bogus.key': 'x'}})

    def test_registered_key_accepted(self):
        service = self.env['nasq.entitlement.service']
        key = sorted(service._nasq_terminology_keys())[0] if service._nasq_terminology_keys() else None
        if key is None:
            self.skipTest('no application registers a key')
        self.assertEqual(
            service._nasq_validate_terminology({'ar': {key: 'x'}}), {'ar': {key: 'x'}},
        )
