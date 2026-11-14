# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import DOCUMENTS_ASSIGN, READ
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

NOTHING = [('id', 'in', [])]


class LiwanSalesVisibility(models.AbstractModel):
    """Who reads and writes which quotation or order.

    The record rules (the stock salesman and all-documents rules, and security/sales_rules.xml) enforce the policy on
    every ORM path; ``_liwan_domain`` is its Python mirror for the working company, used by the routes.
    """

    _name = 'liwan.sales.visibility'
    _description = 'LiwanOS Sales visibility policy'

    @api.model
    def _liwan_keys(self, user, company):
        return self.env['liwan.access.service']._liwan_capability_keys(user, company=company)

    @api.model
    def _liwan_can_assign(self, user, company=None):
        """Whether ``user`` holds ``sales.documents.assign`` in ``company`` (default: the working company)."""
        return DOCUMENTS_ASSIGN in self._liwan_keys(user, company or self.env.company)

    @api.model
    def _liwan_domain(self, user):
        """The orders ``user`` reads in the working company under the visibility setting.

        Nothing without ``sales.read`` in the working company. The whole company for an assign holder or under `all`;
        otherwise the orders the user owns and the unassigned ones, which are the online orders.
        """
        company = self.env.company
        keys = self._liwan_keys(user, company)
        if READ not in keys:
            return NOTHING
        scope = [('company_id', '=', company.id)]
        if DOCUMENTS_ASSIGN in keys or self.env['liwan.sales.settings']._liwan_current().visibility == 'all':
            return scope
        return [*scope, '|', ('user_id', '=', user.id), ('user_id', '=', False)]

    @api.model
    def _liwan_check_write(self, orders, user):
        """403 ``forbidden`` unless every order is a staff document that ``user`` owns or may assign."""
        for order in orders:
            owns = order.user_id == user or self._liwan_can_assign(user, order.company_id)
            if not (order.liwan_staff_document and owns):
                code = 'forbidden'
                raise LiwanAccessRule(code, 'only the salesperson of a staff document may change it', status=403)
