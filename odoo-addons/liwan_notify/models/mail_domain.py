# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import re
from datetime import timedelta
from email.utils import formataddr

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .mail_domain_provider import MailDomainTaken, MailProviderError

_logger = logging.getLogger(__name__)

FROM_FILTER_PARAM = 'mail.default.from_filter'
# A return path that is not active this long after its creation has failed at OCI and is recreated (spec 5.3 step 5).
RETURN_PATH_DEADLINE = timedelta(hours=72)
DOMAIN_PATTERN = re.compile(r'^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')
# The sender's local part: lower-case letters, digits and . _ - inside, no leading, trailing or doubled dot.
LOCAL_PART_PATTERN = re.compile(r'^[a-z0-9](?:[a-z0-9_-]|\.(?!\.)){0,62}[a-z0-9]$|^[a-z0-9]$')
# Public mailbox providers: nobody proves ownership of these, so no tenant sends as them. A subdomain is refused too.
PUBLIC_MAIL_DOMAINS = frozenset({
    'aol.com', 'gmail.com', 'googlemail.com', 'gmx.com', 'gmx.net', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
    'icloud.com', 'live.com', 'live.co.uk', 'mac.com', 'mail.com', 'mail.ru', 'me.com', 'msn.com', 'outlook.com',
    'outlook.sa', 'pm.me', 'proton.me', 'protonmail.com', 'rocketmail.com', 'tutanota.com', 'yahoo.com',
    'yahoo.co.uk', 'yandex.com', 'yandex.ru', 'ymail.com', 'zoho.com', 'zohomail.com', 'zohomail.sa',
})


class MailDomainInputError(ValidationError):
    """A refused domain or local part; ``field`` names the input."""

    def __init__(self, message, field):
        super().__init__(message)
        self.field = field


class MailDomainBusy(UserError):
    """Another transaction holds the tenant's domain row."""


class LiwanMailRefused(UserError):
    """Tenant mail may not leave now; ``code`` is the structured error the API returns with 422."""

    def __init__(self, message, code, reason=None):
        super().__init__(message)
        self.code = code
        self.reason = reason


def _within(domain, parent):
    return domain == parent or domain.endswith(f'.{parent}')


class LiwanMailDomain(models.Model):
    """The tenant's own sending domain (D4): one row for the tenant root, verified at the provider before any mail leaves.

    Routes reach it through the ``mail.domain.manage`` capability group's ACL; the send contract reads it through
    ``_liwan_tenant_domain`` only. Provider ids are references to OCI resources, never secrets.
    """
    _name = 'liwan.mail.domain'
    _description = 'LiwanOS tenant mail domain'
    _liwan_scope = 'tenant'
    # The provider model; a test replaces it on the class.
    _liwan_provider_model = 'liwan.mail.domain.provider.oci'

    company_id = fields.Many2one('res.company', required=True, ondelete='cascade', index=True)
    domain = fields.Char(required=True)
    from_local_part = fields.Char(required=True)
    state = fields.Selection(
        [('not_started', 'Not started'), ('pending_dns', 'Waiting for DNS'), ('verified', 'Verified'), ('failed', 'Failed')],
        required=True, default='not_started',
    )
    records = fields.Json(help='[{kind: dkim|spf|return_path, type: CNAME|TXT, name, value}]')
    provider_domain_id = fields.Char()
    provider_dkim_id = fields.Char()
    provider_return_path_id = fields.Char()
    provider_sender_id = fields.Char()
    provider_log_id = fields.Char()
    return_path_created_at = fields.Datetime()
    return_path_recreated_at = fields.Datetime()
    verified_at = fields.Datetime()
    last_error = fields.Char()
    paused = fields.Boolean(default=False, required=True)
    pause_reason = fields.Char()
    paused_at = fields.Datetime()
    resumed_at = fields.Datetime(help='The operator resumed the domain after review; the pause rates count from here.')

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a tenant has one mail domain')

    # --- reading ---------------------------------------------------------------------------------------------

    @api.model
    def _liwan_root(self):
        return self.env['liwan.entitlement.service']._liwan_profile().root_company_id

    @api.model
    def _liwan_current(self):
        """The tenant's row, read with the caller's own access (the routes)."""
        return self.search([('company_id', '=', self._liwan_root().id)], limit=1)

    @api.model
    def _liwan_tenant_domain(self):
        """The tenant's row for the send contract, whose callers hold no right on this model."""
        return self.sudo().search([('company_id', '=', self._liwan_root().id)], limit=1)

    @api.model
    def _liwan_provider(self):
        return self.env[self._liwan_provider_model]

    @api.model
    def _liwan_provider_configured(self):
        return self._liwan_provider()._liwan_configured()

    @api.model
    def _liwan_platform_domain(self):
        sender = self.env['liwan.outbound.mail']._liwan_sender()
        return sender.rsplit('@', 1)[-1].rstrip('>').strip().lower() if sender else None

    def _liwan_address(self):
        self.ensure_one()
        return f'{self.from_local_part}@{self.domain}'

    def _liwan_sender(self):
        """``"<Company name>" <local@domain>``, or a ``LiwanMailRefused`` when the domain may not send now."""
        if not self or self.state != 'verified':
            raise LiwanMailRefused(self.env._('The sending domain is not verified.'), 'mail_domain_unverified')
        if self.paused:
            raise LiwanMailRefused(
                self.env._('Sending is paused: %(reason)s', reason=self.pause_reason or ''), 'mail_paused', self.pause_reason,
            )
        return formataddr((self.company_id.name, self._liwan_address()))

    # --- the flow ----------------------------------------------------------------------------------------------

    @api.model
    def _liwan_normalize(self, domain, local_part):
        """``(domain, local_part)`` lower-cased, or a ``MailDomainInputError`` naming the refused input."""
        domain = (domain or '').strip().lower().rstrip('.') if isinstance(domain, str) else ''
        local_part = (local_part or '').strip().lower() if isinstance(local_part, str) else ''
        if not DOMAIN_PATTERN.match(domain):
            raise MailDomainInputError(self.env._('Enter a domain name such as example.com.'), 'domain')
        if any(_within(domain, public) for public in PUBLIC_MAIL_DOMAINS):
            raise MailDomainInputError(self.env._('A public mailbox domain cannot be used: enter a domain you own.'), 'domain')
        platform = self._liwan_platform_domain()
        if platform and _within(domain, platform):
            raise MailDomainInputError(self.env._('The platform domain cannot be used.'), 'domain')
        if not LOCAL_PART_PATTERN.match(local_part):
            raise MailDomainInputError(self.env._('The sender name may use lower-case letters, digits, dot, dash and underscore.'), 'from_local_part')
        return domain, local_part

    @api.model
    def _liwan_start(self, domain, local_part):
        """Register ``domain`` at the provider for the tenant root and return the row in ``pending_dns``.

        A held domain raises ``MailDomainTaken`` and leaves nothing behind. The provider creates its resources
        asynchronously and writes each id on the row as it gets it, so this call stops where the provider is not
        ready or fails (the failure is kept on the row, the request still commits) and the verify cron carries on.
        """
        domain, local_part = self._liwan_normalize(domain, local_part)
        if self._liwan_current():
            raise MailDomainInputError(self.env._('Remove the current domain before starting another.'), 'domain')
        row = self.create({
            'company_id': self._liwan_root().id, 'domain': domain, 'from_local_part': local_part, 'state': 'pending_dns',
        })
        try:
            row._liwan_progress()
        except MailDomainTaken:
            row.unlink()
            raise
        return row

    def _liwan_progress(self):
        """Create the provider resources still missing, then refresh the records; a provider failure is kept on the row.

        The ids the provider already returned stay written, so a later call resumes; ``MailDomainTaken`` is raised.
        """
        self.ensure_one()
        try:
            self._liwan_provider().create_domain(self)
            self._liwan_refresh_records()
        except MailDomainTaken:
            raise
        except MailProviderError as error:
            self._liwan_provider_failed(error)
            return False
        return True

    def _liwan_refresh_records(self):
        self.write({'records': self._liwan_provider().read_records(self)})

    def _liwan_provider_failed(self, error):
        _logger.warning('mail domain %s: provider call failed: %s', self.id, type(error).__name__)
        self.last_error = self.env._('The mail provider did not answer; the check is retried automatically.')

    def _liwan_lock(self):
        """Lock the row for this transaction, or raise ``MailDomainBusy`` when another one (the cron, a route) holds it."""
        self.ensure_one()
        if not self.try_lock_for_update():
            raise MailDomainBusy(self.env._('The mail domain is being updated; try again in a moment.'))

    def _liwan_check(self):
        """Ask the provider for the state and move the row: verified, back to pending, failed, or a new return path."""
        self._liwan_lock()
        if self.state == 'pending_dns' and not self._liwan_progress():
            return
        try:
            status = self._liwan_provider().check(self)
        except MailProviderError as error:
            self._liwan_provider_failed(error)
            return
        now = fields.Datetime.now()
        path_state = status.get('return_path')
        if self.provider_return_path_id and self.state != 'verified' and (
            path_state == 'FAILED'
            or (path_state != 'ACTIVE' and self.return_path_created_at
                and now - self.return_path_created_at > RETURN_PATH_DEADLINE)
        ):
            self._liwan_recreate_return_path()
            return
        ready = status.get('dkim') == 'ACTIVE' and status.get('spf') and path_state == 'ACTIVE' and self.provider_sender_id
        if ready:
            if self.state != 'verified':
                self.write({'state': 'verified', 'verified_at': now, 'last_error': False})
                self._liwan_write_from_filter()
            return
        if self.state == 'verified':
            self.write({'state': 'failed', 'last_error': self.env._(
                'The domain no longer validates: check that its DNS records are still in place.',
            )})
            self._liwan_write_from_filter()

    def _liwan_recreate_return_path(self):
        """Replace the return path at the provider, store its new record and wait for DNS again."""
        self._liwan_lock()
        try:
            path_id = self._liwan_provider().recreate_return_path(self)
            now = fields.Datetime.now()
            self.write({
                'provider_return_path_id': path_id, 'return_path_created_at': now, 'return_path_recreated_at': now,
                'state': 'pending_dns', 'last_error': False,
            })
            self._liwan_refresh_records()
        except MailProviderError as error:
            self._liwan_provider_failed(error)
            return False
        self._liwan_write_from_filter()
        return True

    def _liwan_remove(self):
        """Delete the provider resources, then the row, then take the domain out of the filter; a provider failure raises."""
        self._liwan_lock()
        self._liwan_provider().delete_domain(self)
        self.unlink()
        self._liwan_write_from_filter()

    @api.model
    def _liwan_offboard(self):
        """Delete the tenant's provider resources before its database is dropped; a failure raises and is never ignored.

        The tenant lifecycle (deletion) calls this first, as the superuser, and stops the deletion when it raises.
        """
        for row in self.search([]):
            row._liwan_remove()

    def _liwan_resume(self):
        """Clear a pause after the operator's review (server shell); the pause rates then count from now.

        No tenant route clears a pause: the cause (a bad list, a spam complaint) is reviewed first.
        """
        self.write({'paused': False, 'pause_reason': False, 'paused_at': False, 'resumed_at': fields.Datetime.now()})

    @api.model
    def _liwan_cron_verify(self):
        """Every 15 minutes: carry on the pending domains and check that the verified ones still validate.

        One row's failure is recorded on that row and never stops the loop; each row runs in its own savepoint, so a
        database error on one row rolls back that row only.
        """
        for row in self.search([('state', 'in', ('pending_dns', 'verified'))]):
            try:
                with self.env.cr.savepoint():
                    row._liwan_check()
            except MailDomainBusy:
                _logger.info('mail domain %s: busy, checked on the next run', row.id)
            except MailDomainTaken:
                _logger.warning('mail domain %s: the domain is held by another tenant', row.id)
                row.write({'state': 'failed', 'last_error': self.env._('This domain is already registered.')})
            except MailProviderError as error:
                row._liwan_provider_failed(error)

    @api.model
    def _liwan_write_from_filter(self):
        """Write this database's ``mail.default.from_filter``: the platform domain plus the verified tenant domain."""
        verified = self.search([('state', '=', 'verified')]).mapped('domain')
        allowed = [domain for domain in (self._liwan_platform_domain(), *verified) if domain]
        self.env['ir.config_parameter'].sudo().set_param(FROM_FILTER_PARAM, ','.join(allowed) or False)

    def _liwan_return_path_expires_at(self):
        if self.state != 'pending_dns' or not self.return_path_created_at:
            return None
        return self.return_path_created_at + RETURN_PATH_DEADLINE
