# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from .protected_write import marked

SETUP_CLOSED_MARKER = 'liwan_core.setup_closed_company_ids'
SETUP_CLOSED_FIELDS = frozenset({'liwan_setup_closed_at'})


class ResCompanySetup(models.Model):
    _inherit = 'res.company'

    # When the first-run setup wizard was dismissed for good; empty while it is open. Reopening clears it.
    liwan_setup_closed_at = fields.Datetime(copy=False, readonly=True)

    @api.model
    def _liwan_marked_write_fields(self):
        return {**super()._liwan_marked_write_fields(), SETUP_CLOSED_MARKER: SETUP_CLOSED_FIELDS}

    def _liwan_set_setup_closed(self, closed):
        """Close or reopen the setup wizard of the current company."""
        self.ensure_one()
        self.env['liwan.access.service']._liwan_require_capability('settings.company.manage')
        self.env['liwan.setup.step']._liwan_require_root_company()
        if self != self.env.company:
            msg = 'forbidden'
            raise AccessError(msg)
        if closed == bool(self.liwan_setup_closed_at):
            return True
        with marked(self.env, {SETUP_CLOSED_MARKER: {self.id}}):
            return self.write({'liwan_setup_closed_at': fields.Datetime.now() if closed else False})
