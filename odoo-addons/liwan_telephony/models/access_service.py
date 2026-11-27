# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, models

from .ir_http import EVENTS_USER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

# The four capabilities of design section 6. Listening to recordings is not implied by any other capability.
PERMISSIONS = frozenset({
    'telephony.use',
    'telephony.calls.read_all',
    'telephony.recordings.listen',
    'telephony.manage',
})
EMPLOYEE_PERMISSIONS = frozenset({'telephony.use'})
PERMISSION_DEPENDENCIES = {
    'telephony.calls.read_all': {'telephony.use'},
    'telephony.recordings.listen': {'telephony.use'},
    'telephony.manage': {'telephony.use'},
}
# Held by the events identity alone, in every company it belongs to; no role carries it.
EVENTS_APPLY = 'telephony.events.apply'


class LiwanTelephonyAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_telephony'} for key in sorted(PERMISSIONS | {EVENTS_APPLY})
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
            ('liwan_telephony.role_telephony_manager', PERMISSIONS),
            ('liwan_core.role_employee', EMPLOYEE_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_telephony.group_telephony_manager'):
            keys |= PERMISSIONS
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'telephony_manager']

    # ---- the events identity: the machine account the event route runs as ----

    @api.model
    def _liwan_events_user_id(self):
        return self.env['ir.model.data']._xmlid_to_res_id(EVENTS_USER, raise_if_not_found=False)

    @api.model
    def _liwan_sync_events_companies(self):
        """Make the events identity a member of every company, archived ones included.

        An event then stores its call under the company of the extension it names, whatever branch the extension
        belongs to. ``res.company.create`` calls this for each new company and the addon data for the existing ones.
        """
        account = self.env.ref(EVENTS_USER, raise_if_not_found=False)
        if not account:
            return
        companies = self.env['res.company'].with_context(active_test=False).search([])
        account.write({'company_ids': [Command.link(company_id) for company_id in companies.ids]})

    @api.model
    def _liwan_technical_user_ids(self):
        """The machine account of this addon: out of every administrator's reach and listed nowhere."""
        ids = super()._liwan_technical_user_ids()
        events_id = self._liwan_events_user_id()
        return ids | {events_id} if events_id else ids

    @api.model
    def _liwan_compute_capability_keys(self, user, company):
        """The events identity holds the one capability its group's ACL rows back, in every company it belongs to.

        It has no role and no assignment: nothing in the roles pages names it and no role can carry the capability.
        The company fence admits an identity's native groups in its home company only, so this is what lets an
        event write the call of a branch extension under that branch. It holds it only while it acts as itself.
        """
        keys = super()._liwan_compute_capability_keys(user, company)
        if user.id == self._liwan_events_user_id() and self.env.user == user:
            keys.add(EVENTS_APPLY)
        return keys

    @api.model
    def _liwan_assert_user_scope(self, user):
        """The events identity is out of every access administrator's reach: a request about one answers like a
        missing user."""
        if user and user.id == self._liwan_events_user_id():
            code, msg = 'not_found', 'user does not exist'
            raise LiwanAccessRule(code, msg, status=404)
        return super()._liwan_assert_user_scope(user)

    @api.model
    def _liwan_assert_account_reactivation(self, user):
        if user.id == self._liwan_events_user_id():
            code, msg = 'protected_user', 'this account cannot be reactivated'
            raise LiwanAccessRule(code, msg, status=403)
        return super()._liwan_assert_account_reactivation(user)

    @api.model
    def _liwan_account_user_domain(self, filters):
        domain = super()._liwan_account_user_domain(filters)
        events_id = self._liwan_events_user_id()
        return [*domain, ('id', '!=', events_id)] if events_id else domain
