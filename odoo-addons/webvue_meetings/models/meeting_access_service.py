# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The meetings application's capabilities, grants and legacy keys (spec R2), composed through super()."""
from odoo import api, models

MEETINGS_PERMISSIONS = frozenset({
    'meetings.read', 'meetings.create', 'meetings.manage', 'meetings.settings.manage',
})
EMPLOYEE_MEETINGS_PERMISSIONS = frozenset({'meetings.read'})
# The built-in meeting organizer role: it is who may schedule when the company limits scheduling to organizers.
ORGANIZER_MEETINGS_PERMISSIONS = frozenset({'meetings.read', 'meetings.create'})
MEETINGS_PERMISSION_DEPENDENCIES = {
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
    'meetings.settings.manage': {'meetings.read'},
}


class WebVueMeetingsAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_meetings'}
            for key in sorted(MEETINGS_PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in MEETINGS_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in (
            ('webvue_core.role_employee', EMPLOYEE_MEETINGS_PERMISSIONS),
            ('webvue_meetings.role_meetings_organizer', ORGANIZER_MEETINGS_PERMISSIONS),
            ('webvue_core.role_system_admin', MEETINGS_PERMISSIONS),
            ('webvue_core.role_vendor_support', MEETINGS_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_compute_capability_keys(self, user, company):
        keys = super()._webvue_compute_capability_keys(user, company)
        # Scheduling is a company setting: when every employee may schedule, whoever reads meetings in
        # that company holds meetings.create for it. Every create path checks that one capability.
        if (
            'meetings.read' in keys and 'meetings.create' not in keys
            and self.env['webvue.meeting.settings']._webvue_schedule_policy(company) == 'all_employees'
        ):
            keys.add('meetings.create')
        return keys

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if (
            user.has_group('webvue_core.group_access_admin')
            or user.has_group('webvue_core.group_customer_admin')
        ):
            keys |= MEETINGS_PERMISSIONS
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_MEETINGS_PERMISSIONS
        return keys
