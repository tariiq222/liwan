# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

FOUNDATION = {'webvue_core', 'webvue_platform', 'webvue_api'}
# A context kind simulated without an addon: the foundation names no kind, so the
# probe registers one through the same super() hooks an application extends.
PROBE_KEYS = ('region.sites.read', 'region.sites.manage')
PROBE_KIND = {
    'owner': 'webvue_region_probe',
    'permissions': frozenset({'region.sites.manage'}),
    'roles': {
        'site_lead': {'name': {'ar': 'مسؤول موقع', 'en': 'Site lead'}, 'grants': frozenset({'region.sites.manage'})},
    },
}


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestAccessScopeKinds(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.employee = new_test_user(cls.env, login='scope_kind_employee', groups='webvue_core.group_employee')
        cls.record = cls.env['res.partner'].create({'name': 'Probe site', 'company_id': cls.env.company.id})

    def setUp(self):
        super().setUp()
        service = type(self.service)
        definitions = service._webvue_capability_definitions
        self.patch(service, '_webvue_capability_definitions', lambda model: (
            *definitions(model), *({'key': key, 'owner': 'webvue_region_probe'} for key in PROBE_KEYS),
        ))

    def _register(self, kinds):
        self.patch(type(self.service), '_webvue_scope_kinds', lambda model: kinds)

    def test_the_foundation_stores_and_names_no_context_kind(self):
        fields = self.env['webvue.access.permission']._fields
        self.assertNotIn('project_contextual', fields)
        self.assertFalse([name for name in fields if 'project' in name])
        installed = set(self.env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))
        kinds = self.service._webvue_scope_kind_map()
        self.assertTrue({spec['owner'] for spec in kinds.values()} <= installed)
        if {name for name in installed if name.startswith('webvue_')} <= FOUNDATION:
            self.assertEqual(kinds, {})
            self.assertEqual(self.service._webvue_contextual_keys(), set())

    def test_a_registered_kind_grants_only_its_permissions_on_a_record(self):
        self._register({'region': PROBE_KIND})
        self.patch(type(self.service), '_webvue_contextual_capability', lambda model, user, key, record: True)
        self.assertEqual(self.service._webvue_contextual_keys(), {'region.sites.manage'})
        has = self.service._webvue_has_capability
        self.assertTrue(has(self.employee, 'region.sites.manage', record=self.record))
        self.assertFalse(has(self.employee, 'region.sites.manage'))
        self.assertFalse(has(self.employee, 'region.sites.read', record=self.record))
        self.assertFalse(has(self.employee, 'access.users.grant', record=self.record))

    def test_contextual_roles_join_the_identity_with_their_grants(self):
        self._register({'region': PROBE_KIND})
        identity = self.service._webvue_identity(self.employee)
        self.assertNotIn('site_lead', {role['key'] for role in identity['roles']})
        self.patch(
            type(self.service), '_webvue_contextual_role_held',
            lambda model, kind, role_key, user, capabilities: (kind, role_key) == ('region', 'site_lead'),
        )
        identity = self.service._webvue_identity(self.employee)
        self.assertIn({
            'id': None, 'key': 'site_lead', 'name': {'ar': 'مسؤول موقع', 'en': 'Site lead'},
            'type': 'contextual', 'protected': True, 'source': 'contextual',
        }, identity['roles'])
        self.assertIn('region.sites.manage', identity['capabilities'])

    def test_malformed_registrations_are_rejected(self):
        role = PROBE_KIND['roles']['site_lead']
        for code, kinds in (
            ('scope_kind_invalid', {'company': PROBE_KIND}),
            ('scope_kind_invalid', {'Region': PROBE_KIND}),
            ('scope_kind_invalid', {'region': {**PROBE_KIND, 'assignable': True}}),
            ('scope_kind_invalid', {'region': {**PROBE_KIND, 'owner': ''}}),
            ('scope_kind_invalid', {'region': {**PROBE_KIND, 'permissions': frozenset()}}),
            ('scope_kind_invalid', {'region': {**PROBE_KIND, 'permissions': frozenset({'region.unknown.manage'})}}),
            ('scope_kind_invalid', {'region': {**PROBE_KIND, 'permissions': frozenset({'access.users.grant'})}}),
            ('scope_role_invalid', {'region': {**PROBE_KIND, 'roles': {'Site lead': role}}}),
            ('scope_role_invalid', {'region': {**PROBE_KIND, 'roles': {'site_lead': {**role, 'name': {'en': 'Site'}}}}}),
            ('scope_role_invalid', {'region': {**PROBE_KIND, 'roles': {'site_lead': {**role, 'grants': frozenset({'access.roles.manage'})}}}}),
            ('scope_role_invalid', {'region': PROBE_KIND, 'zone': PROBE_KIND}),
        ):
            self._register(kinds)
            with self.subTest(kinds=kinds), self.assertRaisesRegex(ValidationError, code):
                self.service._webvue_scope_kind_map()

    def test_a_context_kind_is_never_assignable(self):
        self._register({'region': PROBE_KIND})
        role = self.env.ref('webvue_core.role_employee')
        with self.assertRaisesRegex(ValidationError, 'unsupported_scope'):
            self.service._webvue_replace_assignments(self.employee, [
                {'role_id': role.id, 'scope': {'kind': 'region', 'id': self.employee.company_id.id}},
            ])
