# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .res_company import PRICE_MODE_MARKER
from odoo.addons.liwan_core.models.access_service import VAT_PERMISSION, LiwanAccessRule
from odoo.addons.liwan_core.models.protected_write import marked

TAX_MODE_LOCKED = 'tax_mode_locked'


class LiwanCompanyTaxService(models.AbstractModel):
    """The establishment's one tax choice: whether it is registered and whether a typed price includes the tax.

    ``res.company.account_price_include`` (stock) is the stored fact, and this addon makes it a stock
    root-delegated field: base copies the root's value to its branches, refuses a branch that differs, and the
    root-only write reaches them in base's own elevated propagation. So the service writes the root alone and
    reads the session company's own row; nothing here elevates.

    The section is platform-owned: no entitlement key is registered or sold for it, so while this addon is
    installed its routes pass the registry-driven feature gate through ``_liwan_company_tax_platform_owned``,
    and only their capabilities decide who may read or change the choice.
    """

    _name = 'liwan.company.tax.service'
    _description = 'LiwanOS Establishment Tax Choice'

    @api.model
    def _liwan_company_tax_feature_keys(self):
        """The registered feature keys the gate would check: none."""
        return ()

    @api.model
    def _liwan_company_tax_platform_owned(self):
        """The gate's ``open_method``: always open."""
        return True

    @api.model
    def _liwan_establishment_values(self):
        """The establishment's three answers, from the session company's own row.

        The price mode is the session company's, which base keeps equal to its root's; the registration is the
        derived field ``liwan_establishment_vat_registered``, computed for every company of the establishment from
        its own parent chain. Only the lock walks to the root, and ``_existing_accounting`` reads no field of it:
        it searches journal items of every company below its ``id`` in its own elevated recordset.
        """
        session = self.env.company
        return {
            'registered': session._liwan_vat_registered(),
            'account_price_include': session.account_price_include,
            'locked': session.root_id._existing_accounting(),
        }

    @api.model
    def _liwan_can_change(self):
        """Whether this session may change the choice: the root company's session, with the VAT right there."""
        session = self.env.company
        return session == session.root_id and bool(
            self.env['liwan.access.service']._liwan_has_capability(
                self.env.user, VAT_PERMISSION, company=session,
            ),
        )

    @api.model
    def _liwan_write(self, registered=None, price_mode=None):
        """Change the establishment's tax choice and answer its values.

        Both legs need ``settings.company.vat.manage`` in the root company, checked in the caller's own
        environment before anything is written. The price mode is refused with ``409 tax_mode_locked`` while
        the establishment or any branch has a journal item, stock's own lock. Sending the values the
        establishment already has writes nothing.
        """
        service = self.env['liwan.access.service']
        session = self.env.company
        root = session.root_id
        if session != root:
            message = self.env._('The tax choice is changed from the root company only.')
            code = 'forbidden'
            raise LiwanAccessRule(code, message, status=403)
        # The session is the root here, so the ordinary current-company check is the root-company check.
        service._liwan_require_capability(VAT_PERMISSION)
        current = self._liwan_establishment_values()
        price_change = price_mode is not None and price_mode != current['account_price_include']
        if price_change and current['locked']:
            message = self.env._('The price mode cannot change once the establishment has a journal item.')
            raise LiwanAccessRule(TAX_MODE_LOCKED, message, status=409)
        if price_change:
            # The root alone: base's root-delegated propagation writes the active branches, and a reactivated branch
            # takes its parent's value in ``res.company.write``. ``marked`` is this addon's own guarded operation.
            with marked(self.env, {PRICE_MODE_MARKER: root.ids}):
                root.write({'account_price_include': price_mode})
        if registered is not None and bool(registered) != current['registered']:
            # The VAT leg stays unelevated: the core profile path keeps its number check and audit entry.
            root._liwan_write_company_profile({'liwan_vat_registered': bool(registered)})
        return self._liwan_establishment_values()
