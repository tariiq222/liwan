# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only tools for webvue_ai's own tests.

webvue_ai knows no application, so its tests register probe tools for the length
of one test (``self.patch`` on the registry), gated by the platform probe
feature and by capability keys the test grants through a patched
``_webvue_has_capability``. The tests behave the same with or without an
application installed.
"""
from odoo.fields import Command

from odoo.addons.webvue_api.tests.common import (
    PROBE_FEATURE,
    register_probe_feature,
    set_probe_feature,
)

READ_CAP = 'probe.things.read'
WRITE_CAP = 'probe.things.write'
CREATE_CAP = 'probe.things.create'

PROBE_TOOLS = (
    {
        'name': 'probe.list_things',
        'owner': 'webvue_probe',
        'kind': 'read',
        'capability': READ_CAP,
        'feature_key': PROBE_FEATURE,
        'route': {'method': 'GET', 'path': '/api/v1/probe/things'},
        'input_schema': {
            'type': 'object',
            'properties': {'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}},
            'additionalProperties': False,
        },
        'input_map': {'query': {'limit': '$limit', 'filter': 'mine'}},
        'description_ar': 'يعرض الأشياء',
        'description_en': 'List things',
        'result_summary': ['items[].id', 'items[].name', 'total'],
    },
    {
        'name': 'probe.rename_thing',
        'owner': 'webvue_probe',
        'kind': 'write_light',
        'capability': WRITE_CAP,
        'feature_key': PROBE_FEATURE,
        'route': {'method': 'PATCH', 'path': '/api/v1/probe/things/{thing_id}'},
        'input_schema': {
            'type': 'object',
            'properties': {'thing_id': {'type': 'integer'}, 'name': {'type': 'string'}},
            'required': ['thing_id', 'name'],
            'additionalProperties': False,
        },
        'input_map': {'path': {'thing_id': '$thing_id'}, 'body': {'name': '$name'}},
        'description_ar': 'يعيد تسمية شيء',
        'description_en': 'Rename a thing',
        'result_summary': ['id', 'name'],
    },
    {
        'name': 'probe.draft_thing',
        'owner': 'webvue_probe',
        'kind': 'draft',
        'capability': CREATE_CAP,
        'feature_key': PROBE_FEATURE,
        'draft_target': '/things/new',
        'input_schema': {
            'type': 'object',
            'properties': {'name': {'type': 'string'}},
            'required': ['name'],
            'additionalProperties': False,
        },
        'description_ar': 'يجهّز مسودة شيء',
        'description_en': 'Draft a thing',
    },
)


class AiProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``.

    ``self.granted`` is the set of capability keys the patched access service
    grants to every user; tests add and remove keys to shape what a user sees.
    """

    def _grant_ai_use(self, user):
        """Give ``user`` the capability group that the ACL and record rule of ``webvue.ai.audit`` follow."""
        user.write({'group_ids': [Command.link(self.env.ref('webvue_ai.group_cap_ai_use').id)]})

    def _install_probe(self, tools=PROBE_TOOLS):
        self.granted = set()
        registry = type(self.env['webvue.ai.tool.registry'])
        self.patch(registry, '_webvue_ai_tool_definitions', lambda model: tools)
        access = type(self.env['webvue.access.service'])
        original = access._webvue_has_capability

        def has_capability(model, user, key, record=None, company=None):
            if key in {READ_CAP, WRITE_CAP, CREATE_CAP}:
                return key in self.granted
            return original(model, user, key, record=record, company=company)

        self.patch(access, '_webvue_has_capability', has_capability)
        register_probe_feature(self)
        set_probe_feature(self)
