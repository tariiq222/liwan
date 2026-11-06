# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import hmac
import secrets
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import LockError

TOKEN_TTL = {'invite': timedelta(hours=72), 'reset': timedelta(minutes=60)}
RESET_LINKS_PER_HOUR = 3
MAX_TOKEN_LENGTH = 128


def hash_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


class LiwanAccountToken(models.Model):
    """One emailed single-use link (invitation or password reset) of one account.

    Only the SHA-256 of the token is stored; the raw token exists in the outgoing email.
    The table is system-only: ``liwan.access.service`` is the single reader and writer.
    """
    _name = 'liwan.account.token'
    _description = 'LiwanOS Account Link Token'
    _liwan_scope = 'tenant'
    _order = 'id desc'

    user_id = fields.Many2one('res.users', required=True, ondelete='cascade', index=True)
    purpose = fields.Selection([('invite', 'Invitation'), ('reset', 'Password reset')], required=True)
    token_hash = fields.Char(required=True)
    expires_at = fields.Datetime(required=True)
    consumed_at = fields.Datetime()
    revoked_at = fields.Datetime()
    delivery = fields.Selection(
        [('pending', 'Pending'), ('sent', 'Sent'), ('failed', 'Failed')], required=True, default='pending',
    )
    sent_at = fields.Datetime()

    _token_hash_unique = models.Constraint('UNIQUE(token_hash)', 'A link token must be unique.')

    @api.model
    def _liwan_issue(self, user, purpose):
        """Revoke the unused links of PURPOSE for USER, then issue a new one: ``(record, raw token)``."""
        self._liwan_revoke(user, purpose)
        raw = secrets.token_urlsafe(32)
        record = self.create({
            'user_id': user.id,
            'purpose': purpose,
            'token_hash': hash_token(raw),
            'expires_at': fields.Datetime.now() + TOKEN_TTL[purpose],
        })
        return record, raw

    @api.model
    def _liwan_revoke(self, user, purpose=None):
        """Revoke every unused link of USER (of PURPOSE when given)."""
        domain = [('user_id', '=', user.id), ('consumed_at', '=', False), ('revoked_at', '=', False)]
        if purpose:
            domain.append(('purpose', '=', purpose))
        self.search(domain).write({'revoked_at': fields.Datetime.now()})

    @api.model
    def _liwan_usable(self, raw, purpose):
        """The unused, unexpired link of PURPOSE that RAW names for an active user, else an empty recordset."""
        if not isinstance(raw, str) or not raw or len(raw) > MAX_TOKEN_LENGTH:
            return self.browse()
        digest = hash_token(raw)
        record = self.search([('token_hash', '=', digest)], limit=1)
        if not record or not hmac.compare_digest(record.token_hash, digest):
            return self.browse()
        if (
            record.purpose != purpose or record.consumed_at or record.revoked_at
            or record.expires_at <= fields.Datetime.now() or not record.user_id.active
        ):
            return self.browse()
        return record

    def _liwan_consume(self):
        """Claim the link exactly once: False when a concurrent request already used or revoked it."""
        self.ensure_one()
        try:
            self.lock_for_update()
        except LockError:
            return False
        self.invalidate_recordset(['consumed_at', 'revoked_at'])
        if self.consumed_at or self.revoked_at:
            return False
        self.write({'consumed_at': fields.Datetime.now()})
        return True

    @api.model
    def _liwan_awaiting_user_ids(self, user_ids):
        """The ids among USER_IDS that were invited and have not accepted yet (never accepted, whatever the link state)."""
        invited = self.search([('user_id', 'in', list(user_ids)), ('purpose', '=', 'invite')])
        accepted = invited.filtered('consumed_at').user_id
        return set((invited.user_id - accepted).ids)

    @api.model
    def _liwan_latest_invitations(self, user_ids):
        """User id -> the newest invitation link of each awaiting user."""
        awaiting = self._liwan_awaiting_user_ids(user_ids)
        latest = {}
        for record in self.search([('user_id', 'in', list(awaiting)), ('purpose', '=', 'invite')], order='id desc'):
            latest.setdefault(record.user_id.id, record)
        return latest

    @api.model
    def _liwan_recent_count(self, user, purpose, window=timedelta(hours=1)):
        """How many links of PURPOSE were issued for USER within WINDOW, revoked ones included."""
        return self.search_count([
            ('user_id', '=', user.id), ('purpose', '=', purpose),
            ('create_date', '>=', fields.Datetime.now() - window),
        ])
