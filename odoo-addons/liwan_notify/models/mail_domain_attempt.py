# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models

from .mail_domain import MailDomainInputError


class LiwanMailDomainAttempt(models.Model):
    """The pending clock of one domain this tenant started and has not verified yet (spec 6.3).

    One row per (tenant root, domain), never overwritten by switching to another domain, so neither removing nor
    alternating domains restarts a clock. A domain that reaches ``verified`` loses its row and starts fresh later.
    """
    _name = 'liwan.mail.domain.attempt'
    _description = 'LiwanOS tenant mail domain attempt'
    _liwan_scope = 'tenant'

    company_id = fields.Many2one('res.company', required=True, ondelete='cascade', index=True)
    domain = fields.Char(required=True)
    first_started_at = fields.Datetime(required=True)
    expired_at = fields.Datetime()

    _company_domain_unique = models.Constraint('UNIQUE(company_id, domain)', 'one attempt per tenant and domain')

    @api.model
    def _liwan_store(self):
        """The attempts, writable: domain managers may only read them, so a route cannot reset its own clock."""
        return self.sudo()

    @api.model
    def _liwan_for(self, domain):
        root = self.env['liwan.mail.domain']._liwan_root()
        return self.search([('company_id', '=', root.id), ('domain', '=', domain)], limit=1)

    @api.model
    def _liwan_check_cooldown(self, domain, days):
        """Refuse a domain that expired unverified less than ``days`` ago (field ``domain``)."""
        expired_at = self._liwan_for(domain).expired_at
        if expired_at and fields.Datetime.now() < expired_at + timedelta(days=days):
            raise MailDomainInputError(self.env._(
                'This domain expired unverified; it can be started again %(days)s days after it expired.', days=days,
            ), 'domain')

    @api.model
    def _liwan_begin(self, domain):
        """Start the clock of ``domain`` unless it is already running; an expired one past its cooldown starts fresh."""
        attempt = self._liwan_store()._liwan_for(domain)
        if not attempt:
            attempt.create({
                'company_id': self.env['liwan.mail.domain']._liwan_root().id, 'domain': domain,
                'first_started_at': fields.Datetime.now(),
            })
        elif attempt.expired_at:
            attempt.write({'first_started_at': fields.Datetime.now(), 'expired_at': False})

    @api.model
    def _liwan_expire(self, domain):
        attempt = self._liwan_store()._liwan_for(domain)
        now = fields.Datetime.now()
        if attempt:
            attempt.expired_at = now
        else:
            attempt.create({
                'company_id': self.env['liwan.mail.domain']._liwan_root().id, 'domain': domain,
                'first_started_at': now, 'expired_at': now,
            })

    @api.model
    def _liwan_clear(self, domain):
        """A domain that reached ``verified`` has no clock any more; it starts fresh if it is started again."""
        self._liwan_store()._liwan_for(domain).unlink()
