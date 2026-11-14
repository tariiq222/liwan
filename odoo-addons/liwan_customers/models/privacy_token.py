# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import secrets

from odoo import fields, models

TOKEN_BYTES = 32


def token_hash(token):
    """What is stored of a token: its SHA-256, so a read of the table yields no usable token."""
    return hashlib.sha256(token.encode()).hexdigest()


class LiwanCustomersPrivacyToken(models.Model):
    """The single-use token of one erase preview: bound to a customer, its caller, the company and the state the preview
    saw. The erase deletes it; an expired one is deleted by the next preview of the same caller. Holds ids only."""
    _name = 'liwan.customers.privacy.token'
    _description = 'LiwanOS customer erase token'
    _liwan_scope = 'company'

    token_hash = fields.Char(required=True, index=True, readonly=True)
    partner_id = fields.Integer(required=True, readonly=True)
    user_id = fields.Many2one('res.users', required=True, readonly=True, ondelete='cascade', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', required=True, readonly=True, ondelete='cascade', default=lambda self: self.env.company)
    written = fields.Char(required=True, readonly=True)
    expires = fields.Datetime(required=True, readonly=True)

    _liwan_token_hash_unique = models.Constraint('UNIQUE(token_hash)', 'duplicate token')

    def _liwan_issue(self, customer, ttl):
        """A new token for ``customer`` as the caller; the raw value, shown once."""
        self.search([('expires', '<', fields.Datetime.now())]).unlink()
        token = secrets.token_urlsafe(TOKEN_BYTES)
        self.create({
            'token_hash': token_hash(token), 'partner_id': customer.id,
            'written': fields.Datetime.to_string(customer.write_date), 'expires': fields.Datetime.now() + ttl,
        })
        return token
