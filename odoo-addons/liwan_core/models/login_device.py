# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import secrets
from datetime import timedelta

from odoo import api, fields, models

# A remembered device lasts 30 days from the moment the user asked for it.
DEVICE_TTL = timedelta(days=30)
MAX_DEVICE_TOKEN_LENGTH = 256
# The newest token is the one the browser presents; the label is what the user sees revoking it.
LABEL_MAX_LENGTH = 80
# A user recognises a handful of browsers; older ones fall away so the list stays readable.
MAX_DEVICES = 10


def hash_device_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


class LiwanLoginDevice(models.Model):
    """One browser the user chose to remember for 30 days.

    Only the SHA-256 of the token is stored; the plain token lives in the user's cookie. The table is
    system-only: ``liwan.login.device`` issues, validates and revokes it, and the account service
    revokes a user's devices when an administrator resets their second step.
    """
    _name = 'liwan.login.device'
    _description = 'LiwanOS Remembered Sign-in Device'
    _liwan_scope = 'tenant'
    _order = 'id desc'

    user_id = fields.Many2one('res.users', required=True, ondelete='cascade', index=True)
    token_hash = fields.Char(required=True)
    label = fields.Char(required=True)
    issued_at = fields.Datetime(required=True, default=fields.Datetime.now)
    expires_at = fields.Datetime(required=True)
    last_used_at = fields.Datetime()
    revoked_at = fields.Datetime()

    _token_hash_unique = models.Constraint('UNIQUE(token_hash)', 'A device token must be unique.')

    @api.model
    def _liwan_issue(self, user, label):
        """Remember USER's browser for 30 days and return ``(record, raw token)``; the raw token is never stored."""
        self._liwan_trim(user)
        raw = secrets.token_urlsafe(32)
        record = self.create({
            'user_id': user.id,
            'token_hash': hash_device_token(raw),
            'label': (label or '')[:LABEL_MAX_LENGTH] or 'device',
            'expires_at': fields.Datetime.now() + DEVICE_TTL,
        })
        return record, raw

    @api.model
    def _liwan_trim(self, user):
        """Keep at most MAX_DEVICES usable devices per user: the oldest ones are revoked, not deleted."""
        usable = self.search(
            [('user_id', '=', user.id), ('revoked_at', '=', False), ('expires_at', '>', fields.Datetime.now())],
            order='id desc', offset=MAX_DEVICES,
        )
        if usable:
            usable.write({'revoked_at': fields.Datetime.now()})

    @api.model
    def _liwan_usable(self, raw):
        """The unrevoked, unexpired device RAW names for an active user, else an empty recordset."""
        if not isinstance(raw, str) or not raw or len(raw) > MAX_DEVICE_TOKEN_LENGTH:
            return self.browse()
        digest = hash_device_token(raw)
        record = self.search([('token_hash', '=', digest), ('revoked_at', '=', False)], limit=1)
        if not record or not record.user_id.active or record.expires_at <= fields.Datetime.now():
            return self.browse()
        record.last_used_at = fields.Datetime.now()
        return record

    @api.model
    def _liwan_revoke_user(self, user, keep=None):
        """Revoke every device of USER except KEEP (the one the caller is using right now)."""
        domain = [('user_id', '=', user.id), ('revoked_at', '=', False)]
        if keep:
            domain.append(('id', '!=', keep.id))
        return self.search(domain).write({'revoked_at': fields.Datetime.now()})

    @api.model
    def _liwan_purge(self):
        """Cron: delete the devices revoked or expired more than 90 days ago."""
        cutoff = fields.Datetime.now() - DEVICE_TTL * 3
        self.search([
            '|', ('revoked_at', '<', cutoff), ('expires_at', '<', cutoff),
        ]).unlink()
