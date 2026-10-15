# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_platform.models.entitlement_service import NasqEntitlementService

LEGACY_KEYS = frozenset({
    'nav.projects',
    'nav.allProjects',
    'nav.myProjects',
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
# The owning addon of each terminology key; the hook of an addon returns exactly its set.
OWNED_KEYS = {
    'nasq_pmo': frozenset({
        'nav.projects', 'nav.allProjects', 'nav.myProjects',
        'nav.projectTasks', 'nav.tasks', 'projects.title', 'tasks.title',
    }),
    'nasq_meetings': frozenset({'nav.meetings', 'nav.meetingCalendar', 'nav.meetingSeries'}),
    'nasq_hr': frozenset({
        'nav.organization', 'nav.employees', 'nav.departments', 'nav.documents',
        'hr.directory.title', 'hr.depts.title', 'hr.docs.title',
    }),
    'nasq_chat': frozenset({'nav.chat', 'chat.title'}),
}
APPLICATIONS = tuple(OWNED_KEYS)


def _without_own_keys(cls):
    """Replacement hook for `cls` that passes through to the next class and adds nothing."""
    def hook(self):
        return super(cls, self)._nasq_terminology_keys()
    return hook


@tagged('post_install', '-at_install', 'nasq')
class TestTerminologyKeys(TransactionCase):

    def _installed(self):
        return set(self.env['ir.module.module'].sudo().search([
            ('name', 'in', APPLICATIONS), ('state', '=', 'installed'),
        ]).mapped('name'))

    def _overrides(self):
        """Map addon name -> class defining its own `_nasq_terminology_keys` override."""
        found = {}
        for cls in type(self.env['nasq.entitlement.service']).__mro__:
            if cls is NasqEntitlementService or '_nasq_terminology_keys' not in cls.__dict__:
                continue
            parts = cls.__module__.split('.')
            found[parts[2] if parts[:2] == ['odoo', 'addons'] else cls.__module__] = cls
        return found

    def _own_keys(self, addon):
        """What the override of `addon` adds, with every other override stubbed out."""
        overrides = self._overrides()
        patches = [
            patch.object(cls, '_nasq_terminology_keys', _without_own_keys(cls))
            for name, cls in overrides.items() if name != addon
        ]
        for started in patches:
            started.start()
        try:
            return self.env['nasq.entitlement.service']._nasq_terminology_keys()
        finally:
            for started in patches:
                started.stop()

    def test_base_hook_returns_empty_set(self):
        service = self.env['nasq.entitlement.service']
        self.assertEqual(NasqEntitlementService._nasq_terminology_keys(service), frozenset())

    def test_each_app_registers_only_its_keys(self):
        overrides = self._overrides()
        self.assertEqual(set(overrides), self._installed())
        seen = set()
        for addon in overrides:
            own = self._own_keys(addon)
            self.assertEqual(own, OWNED_KEYS[addon], addon)
            self.assertFalse(seen & own, f'{addon} repeats a key owned by another application')
            seen |= own

    def test_union_covers_legacy_set_with_all_apps(self):
        self.assertEqual(self._installed(), set(APPLICATIONS))
        keys = self.env['nasq.entitlement.service']._nasq_terminology_keys()
        # A future application may add keys; none of the legacy ones may disappear.
        self.assertLessEqual(LEGACY_KEYS, keys)
        self.assertEqual(len(LEGACY_KEYS), 19)

    def test_unknown_key_still_rejected_422(self):
        service = self.env['nasq.entitlement.service']
        with self.assertRaises(ValidationError):
            service._nasq_validate_terminology({'ar': {'bogus.key': 'x'}})

    def test_registered_key_accepted(self):
        service = self.env['nasq.entitlement.service']
        for key in sorted(LEGACY_KEYS):
            self.assertEqual(
                service._nasq_validate_terminology({'ar': {key: 'x'}}), {'ar': {key: 'x'}}, key,
            )
