# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

SHARING_MODES = ('establishment', 'branch')


class LiwanCustomersSettings(models.Model):
    """The tenant's customer policy: whether a customer is shared by every branch, and how a phone is read.

    One record per tenant database, changed only by a holder of ``customers.settings.manage`` in the root company.
    ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.customers.settings'
    _description = 'LiwanOS customers settings'
    # Every branch reads the same policy.
    _liwan_scope = 'tenant'

    # establishment: a new customer has no company and every branch finds it; branch: it belongs to the company the
    # session works in.
    sharing = fields.Selection([(mode, mode) for mode in SHARING_MODES], required=True, default='establishment')
    # The country a number without a prefix is read in; unset means the root company's country.
    phone_country_id = fields.Many2one('res.country', ondelete='restrict')
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'the revision is a positive number')

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/customers_settings.xml``."""
        return self.env.ref('liwan_customers.customers_settings')

    def _liwan_apply(self, values, revision):
        """Write ``values`` read at ``revision``: 409 ``conflict`` on a stale read, 409 ``sharing_transfer_required``
        when the sharing changes while any customer exists (archived ones and contacts counted)."""
        self.ensure_one()
        if self.revision != revision:
            code = 'conflict'
            raise LiwanAccessRule(code, 'the customer settings changed since they were read', status=409)
        if values.get('sharing', self.sharing) != self.sharing and self._liwan_party_exists():
            code = 'sharing_transfer_required'
            raise LiwanAccessRule(
                code, 'customers exist: changing the sharing needs a transfer',
                field='sharing', status=409,
            )
        self.write({**values, 'revision': revision + 1})

    @api.model
    def _liwan_party_exists(self):
        """Whether the tenant holds any party, archived ones and contacts included (a boolean only).

        Elevated: the company fence hides the parties of branches the root settings manager cannot read. The sharing
        transfer replaces this refusal and this read.
        """
        partners = self.env['res.partner'].sudo().with_context(active_test=False)
        return bool(partners.search_count([('liwan_party', '=', True)], limit=1))
