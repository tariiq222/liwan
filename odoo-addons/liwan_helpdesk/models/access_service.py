# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The capabilities of the Support Desk application and the built-in roles that hold them.

An agent answers the tickets their visibility policy shows, a supervisor also dispatches and closes
them, and a manager owns the settings. Every employee may open a request of their own and follow it
(``helpdesk.requests.create`` and ``helpdesk.requests.read``), which is the self-service half of an
internal helpdesk. The vendor support identity never reaches a tenant's tickets, exactly as it never
reaches CRM opportunities: the foundation role holds every catalog key, so the application subtracts
its own.

The catalog grows with the pull request that first uses a key; SLA, ratings, merging and reports add
theirs when their routes exist.
"""
from odoo import api, models

READ = 'helpdesk.tickets.read'
WRITE = 'helpdesk.tickets.write'
ASSIGN = 'helpdesk.tickets.assign'
CLOSE = 'helpdesk.tickets.close'
REQUESTS_READ = 'helpdesk.requests.read'
REQUESTS_CREATE = 'helpdesk.requests.create'
SETTINGS_READ = 'helpdesk.settings.read'
SETTINGS_MANAGE = 'helpdesk.settings.manage'

PERMISSIONS = frozenset({
    READ, WRITE, ASSIGN, CLOSE, REQUESTS_READ, REQUESTS_CREATE, SETTINGS_READ, SETTINGS_MANAGE,
})
AGENT_PERMISSIONS = frozenset({READ, WRITE, REQUESTS_READ, REQUESTS_CREATE})
SELF_SERVICE_PERMISSIONS = frozenset({REQUESTS_READ, REQUESTS_CREATE})
SUPERVISOR_PERMISSIONS = AGENT_PERMISSIONS | {ASSIGN, CLOSE, SETTINGS_READ}
# A transition is a write of the ticket, a request is read before it is created, and a setting is read
# before it is changed.
PERMISSION_DEPENDENCIES = {
    WRITE: {READ},
    ASSIGN: {READ},
    CLOSE: {READ, WRITE},
    REQUESTS_CREATE: {REQUESTS_READ},
    SETTINGS_MANAGE: {SETTINGS_READ},
}


class LiwanHelpdeskAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        return keys - PERMISSIONS if user.has_group('liwan_core.group_vendor_support') else keys

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_helpdesk'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid, keys in (
            ('liwan_helpdesk.role_helpdesk_agent', AGENT_PERMISSIONS),
            ('liwan_helpdesk.role_helpdesk_supervisor', SUPERVISOR_PERMISSIONS),
            ('liwan_helpdesk.role_helpdesk_manager', PERMISSIONS),
            ('liwan_core.role_employee', SELF_SERVICE_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants
