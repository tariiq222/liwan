# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import logging
from datetime import timedelta

from odoo import api, fields, models
from odoo.tools import escape_psql

_logger = logging.getLogger(__name__)

# The first failures are free; each further one is refused until last_failure + delay, doubling up to the cap.
FREE_FAILURES = 5
BASE_DELAY = 30
MAX_DELAY = 900
MAX_DOUBLINGS = 10  # keeps the exponent small; 30 * 2**5 already passes the cap
# A row idle for a day holds a counter long forgotten, so a failure restarts it and the daily vacuum drops it.
IDLE_ROW_AGE = timedelta(days=1)
NOTICE_PURPOSE = 'login_throttled'
AUDIT_ACTION = 'login_throttled'


def _now():
    return fields.Datetime.now()


def delay_after(failures):
    """How long an account stays closed after FAILURES consecutive wrong attempts."""
    if failures < FREE_FAILURES:
        return timedelta(0)
    doublings = min(failures - FREE_FAILURES, MAX_DOUBLINGS)
    return timedelta(seconds=min(BASE_DELAY * 2 ** doublings, MAX_DELAY))


class LiwanApiLoginThrottle(models.Model):
    """The per-account counter of consecutive wrong sign-in attempts.

    Odoo's own cooldown counts per client address, which behind the proxy is one address for every client of the
    tenant, and the edge limit counts addresses, which a spread-out guess never repeats. The account is the only key
    that fits: the row is the SHA-256 of the normalized login, so no login is stored, and an unknown login gets a row
    like a known one so the answer never tells them apart. A failure is written on its own cursor and committed at
    once, because the refused sign-in rolls back the request that carries it.
    """
    _name = 'liwan.login.throttle'
    _description = 'Sign-in failure counter'
    # A counter of one login's failures before any session exists, not company data.
    _liwan_scope = 'global'

    key = fields.Char(required=True)
    failures = fields.Integer(required=True, default=0)
    last_failure_at = fields.Datetime(required=True)
    notified_at = fields.Datetime()

    _key_unique = models.Constraint('UNIQUE(key)', 'a login has one failure counter')

    @api.model
    def _liwan_elevated(self, cr=None):
        """An elevated environment, on CR when given: the sign-in has no session, so no user could read these rows."""
        return self.env(cr=cr or self.env.cr, su=True)

    @api.model
    def _liwan_login_of(self, user):
        """The login a core call names: a login as it is, a user id through its user."""
        if isinstance(user, int):
            record = self._liwan_elevated()['res.users'].browse(user).exists()
            return record.login if record else f'uid:{user}'
        return user or ''

    @api.model
    def _liwan_key(self, login):
        return hashlib.sha256(login.strip().casefold().encode()).hexdigest()

    @api.model
    def _liwan_state(self, key):
        """``(failures, last_failure_at)`` of KEY, or None when it has no failures."""
        self.env.cr.execute(
            'SELECT failures, last_failure_at FROM liwan_login_throttle WHERE key = %s', [key],
        )
        return self.env.cr.fetchone()

    @api.model
    def _liwan_delayed(self, state):
        failures, last_failure_at = state or (0, None)
        return bool(failures) and _now() < last_failure_at + delay_after(failures)

    @api.model
    def _liwan_record_failure(self, key, login):
        """Count one failure of KEY on its own committed cursor; mail and audit the first time the cap is reached.

        One statement counts, so parallel failures of one account are all counted and a counter idle for a day
        starts again at one with its notice re-armed.
        """
        now = _now()
        stale = now - IDLE_ROW_AGE
        with self.env.registry.cursor() as cr:
            cr.execute(
                """
                INSERT INTO liwan_login_throttle AS t (key, failures, last_failure_at)
                VALUES (%s, 1, %s)
                ON CONFLICT (key) DO UPDATE
                SET failures = CASE WHEN t.last_failure_at <= %s THEN 1 ELSE t.failures + 1 END,
                    notified_at = CASE WHEN t.last_failure_at <= %s THEN NULL ELSE t.notified_at END,
                    last_failure_at = %s
                RETURNING failures
                """,
                [key, now, stale, stale, now],
            )
            failures = cr.fetchone()[0]
            if delay_after(failures) < timedelta(seconds=MAX_DELAY):
                return
            try:
                # The claim and the notice commit together: a failed notice leaves the claim open for a later failure.
                with cr.savepoint():
                    self._liwan_claim_and_notify(cr, key, login, failures, now)
            except Exception as error:  # noqa: BLE001 - the notice must not change the answer of the refused sign-in
                _logger.warning('sign-in throttle notice not sent: %s', type(error).__name__)

    @api.model
    def _liwan_claim_and_notify(self, cr, key, login, failures, now):
        # Only the failure that finds the notice unsent sends it; the row lock keeps it to one under concurrency.
        cr.execute(
            'UPDATE liwan_login_throttle SET notified_at = %s WHERE key = %s AND notified_at IS NULL RETURNING id',
            [now, key],
        )
        if cr.fetchone():
            self._liwan_notify(cr, login, failures)

    @api.model
    def _liwan_notify(self, cr, login, failures):
        """Audit the cap and mail the account's owner; nobody is told unless exactly one internal account matches.

        The counter key ignores case and padding, so the account is found the same way; a login that matches no
        account or several never gets a notice, rather than a wrong person.
        """
        env = self._liwan_elevated(cr)
        users = env['res.users']
        user = users.search([('login', '=ilike', escape_psql(login.strip())), ('share', '=', False)], limit=2)
        if len(user) != 1:
            return
        env['liwan.access.audit']._liwan_log(
            AUDIT_ACTION, user, after={'failures': failures, 'delay_seconds': MAX_DELAY}, actor=users,
        )
        env['liwan.account.mail']._liwan_send_notice(user.login, user.name, NOTICE_PURPOSE)

    @api.model
    def _liwan_clear(self, key):
        """A successful sign-in forgets the failures of KEY, on its own committed cursor."""
        with self.env.registry.cursor() as cr:
            cr.execute('DELETE FROM liwan_login_throttle WHERE key = %s', [key])

    @api.autovacuum
    def _gc_idle_throttles(self):
        self.search([('last_failure_at', '<', _now() - IDLE_ROW_AGE)]).unlink()
