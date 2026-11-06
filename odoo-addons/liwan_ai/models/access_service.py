# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_ai.models.knowledge_registry import INDEXER_USER
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

AI_USE = 'ai.use'
AI_SETTINGS_MANAGE = 'ai.settings.manage'
EMPLOYEE_PERMISSIONS = frozenset({AI_USE})
# The tenant administrator chooses the provider, signs the AI acknowledgement and reads the monitoring view.
ADMIN_PERMISSIONS = frozenset({AI_SETTINGS_MANAGE})


class LiwanAiAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_ai'} for key in (AI_USE, AI_SETTINGS_MANAGE)
        )

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid, keys in (
            ('liwan_core.role_employee', EMPLOYEE_PERMISSIONS),
            ('liwan_core.role_system_admin', ADMIN_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_indexer_id(self):
        return self.env['ir.model.data']._xmlid_to_res_id(INDEXER_USER, raise_if_not_found=False)

    @api.model
    def _liwan_compute_capability_keys(self, user, company):
        """The technical indexer user holds the capabilities the knowledge sources declare, in each company it belongs to.

        It has no role and no assignment: nothing in the roles pages names it and nobody can assign or remove its
        capabilities. What it may read is still bounded by the read-only ACL rows the bridges give its group. It holds
        them only while it acts as the inactive account it is: an administrator who reactivated it (which the guards
        below refuse) would gain nothing, and only its own session (the cron) is ever given them.
        """
        keys = super()._liwan_compute_capability_keys(user, company)
        acting = self.env.user
        if user.id == self._liwan_indexer_id() and acting == user and not acting.active:
            keys |= self.env['liwan.ai.knowledge.registry']._liwan_ai_indexer_capabilities()
        return keys

    @api.model
    def _liwan_membership_company_ids(self, user=None):
        """The indexer's own companies come from its session record: it holds no read access to users or companies."""
        acting = self.env.user
        if (user or acting) == acting and acting.id == self._liwan_indexer_id():
            return acting.company_ids.filtered('active').ids
        return super()._liwan_membership_company_ids(user)

    @api.model
    def _liwan_assert_user_scope(self, user):
        """The indexer is out of every access administrator's reach: a request about it answers like a missing user."""
        if user and user.id == self._liwan_indexer_id():
            msg = 'not_found'
            raise LiwanAccessRule(msg, 'user does not exist', status=404)
        return super()._liwan_assert_user_scope(user)

    @api.model
    def _liwan_assert_account_reactivation(self, user):
        if user.id == self._liwan_indexer_id():
            msg = 'protected_user'
            raise LiwanAccessRule(msg, 'this account cannot be reactivated', status=403)
        return super()._liwan_assert_account_reactivation(user)

    @api.model
    def _liwan_account_user_domain(self, filters):
        domain = super()._liwan_account_user_domain(filters)
        indexer_id = self._liwan_indexer_id()
        return [*domain, ('id', '!=', indexer_id)] if indexer_id else domain

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
