# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class LiwanLoginCodeAlert(models.Model):
    """The alert the daily send cap raises instead of sending: the operator reads it, no code goes out.

    One row per calendar day keeps the record readable while still counting every refused send. Core
    owns the row and the log line; a tenant-facing surface for it is a later package's item, and a
    rank-0 addon may not call a shared service to warn about itself.
    """
    _name = 'liwan.login.code.alert'
    _description = 'LiwanOS Sign-in Code Daily Cap Alert'
    _liwan_scope = 'tenant'
    _order = 'id desc'

    day = fields.Date(required=True, index=True)
    attempts = fields.Integer(default=0, required=True)

    _day_unique = models.Constraint('UNIQUE(day)', 'One alert per day.')

    @api.model
    def _liwan_raise(self):
        """Record one refused send today; the issuing request commits it with its own refusal."""
        today = fields.Date.context_today(self)
        alert = self.search([('day', '=', today)], limit=1)
        if alert:
            alert.attempts += 1
            return alert
        alert = self.create({'day': today, 'attempts': 1})
        _logger.warning('liwan sign-in codes: the daily send cap was reached on %s', today)
        return alert
