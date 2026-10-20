# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_platform.models.entitlement_service import (
    WebVueEntitlementService,
)

CURRENT_KEYS = frozenset({
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
    'hr.directory.title',
    'hr.depts.title',
    'nav.chat',
    'chat.title',
})
# The owning addon of each terminology key; the hook of an addon returns exactly its set.
OWNED_KEYS = {
    'webvue_pmo': frozenset({
        'nav.projects', 'nav.allProjects', 'nav.myProjects',
        'nav.projectTasks', 'nav.tasks', 'projects.title', 'tasks.title',
    }),
    'webvue_meetings': frozenset({'nav.meetings', 'nav.meetingCalendar', 'nav.meetingSeries'}),
    'webvue_hr': frozenset({
        'nav.organization', 'nav.employees', 'nav.departments',
        'hr.directory.title', 'hr.depts.title',
    }),
    'webvue_chat': frozenset({'nav.chat', 'chat.title'}),
}
APPLICATIONS = tuple(OWNED_KEYS)


def _without_own_keys(cls):
    """Replacement hook for `cls` that passes through to the next class and adds nothing."""
    def hook(self):
        return super(cls, self)._webvue_terminology_keys()
    return hook


@tagged('post_install', '-at_install', 'webvue')
class TestTerminologyKeys(TransactionCase):

    def _installed(self):
        return set(self.env['ir.module.module'].sudo().search([
            ('name', 'in', APPLICATIONS), ('state', '=', 'installed'),
        ]).mapped('name'))

    def _overrides(self):
        """Map addon name -> class defining its own `_webvue_terminology_keys` override."""
        found = {}
        for cls in type(self.env['webvue.entitlement.service']).__mro__:
            if cls is WebVueEntitlementService or '_webvue_terminology_keys' not in cls.__dict__:
                continue
            parts = cls.__module__.split('.')
            found[parts[2] if parts[:2] == ['odoo', 'addons'] else cls.__module__] = cls
        return found

    def _own_keys(self, addon):
        """What the override of `addon` adds, with every other override stubbed out."""
        overrides = self._overrides()
        patches = [
            patch.object(cls, '_webvue_terminology_keys', _without_own_keys(cls))
            for name, cls in overrides.items() if name != addon
        ]
        for started in patches:
            started.start()
        try:
            return self.env['webvue.entitlement.service']._webvue_terminology_keys()
        finally:
            for started in patches:
                started.stop()

    def test_base_hook_returns_empty_set(self):
        service = self.env['webvue.entitlement.service']
        self.assertEqual(WebVueEntitlementService._webvue_terminology_keys(service), frozenset())

    def test_each_app_registers_only_its_keys(self):
        overrides = self._overrides()
        self.assertEqual(set(overrides), self._installed())
        seen = set()
        for addon in overrides:
            own = self._own_keys(addon)
            self.assertEqual(own, OWNED_KEYS[addon], addon)
            self.assertFalse(seen & own, f'{addon} repeats a key owned by another application')
            seen |= own

    def _installed_keys(self):
        return frozenset().union(*(OWNED_KEYS[addon] for addon in self._installed()))

    def test_union_covers_the_keys_of_the_installed_apps(self):
        # Each application stands alone: the union holds exactly what the installed ones register,
        # down to none on the foundation alone; with every application it is the full current set.
        keys = self.env['webvue.entitlement.service']._webvue_terminology_keys()
        self.assertLessEqual(self._installed_keys(), keys)
        self.assertFalse(keys & (CURRENT_KEYS - self._installed_keys()))
        # Fixed current release keys; the removed HR document surface owns no keys.
        self.assertEqual(len(CURRENT_KEYS), 17)
        if self._installed() == set(APPLICATIONS):
            self.assertLessEqual(CURRENT_KEYS, keys)

    def test_unknown_key_still_rejected_422(self):
        service = self.env['webvue.entitlement.service']
        with self.assertRaises(ValidationError):
            service._webvue_validate_terminology({'ar': {'bogus.key': 'x'}})

    def test_registered_key_accepted_and_absent_app_key_rejected(self):
        service = self.env['webvue.entitlement.service']
        for key in sorted(self._installed_keys()):
            self.assertEqual(
                service._webvue_validate_terminology({'ar': {key: 'x'}}), {'ar': {key: 'x'}}, key,
            )
        # A term of an application that is not installed is not a contract of this database.
        for key in sorted(CURRENT_KEYS - self._installed_keys()):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                service._webvue_validate_terminology({'ar': {key: 'x'}})

    def test_removed_hr_document_terms_are_not_a_parallel_contract(self):
        service = self.env['webvue.entitlement.service']
        for key in ('hr.docs.title', 'nav.documents'):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                service._webvue_validate_terminology({'ar': {key: 'retired'}})
