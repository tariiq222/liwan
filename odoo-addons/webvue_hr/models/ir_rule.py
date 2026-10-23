# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

from .leave_cancellation import PENDING_PROBE_MARKER


class IrRule(models.Model):
    _inherit = 'ir.rule'

    def _compute_domain_context_values(self):
        yield from super()._compute_domain_context_values()
        # Record-rule domains are cached beyond a cursor marker's lifetime.
        # Keep the private exact-leave boolean probe out of ordinary rule keys;
        # client context cannot create or reuse this cursor-only marker.
        yield tuple(sorted(self.env.cr.precommit.data.get(PENDING_PROBE_MARKER, ())))
