# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Deleting the recordings a company no longer keeps (design 4.4).

The agent holds the audio; Odoo holds the policy and the row's state. A daily run per company asks the agent to delete
one bounded batch of the company's recordings whose retention window has passed, and marks ``expired`` exactly the
calls the agent reported deleted or missing. A recording the agent still considers active stays ``available`` and is
reported, so the next run asks again rather than claiming a file the disk still holds.

The recording's honest timestamp is the call's end: the file exists once the call's legs ended. A finished call that
never recorded an end time falls back to the row's creation, never to a guess.
"""
import logging
from datetime import timedelta

from odoo import api, fields, models

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_telephony.models.telephony_call import TERMINAL_STATES

_logger = logging.getLogger(__name__)

# The most calls one agent request asks about: a bounded batch keeps a request and its answer small.
RETENTION_BATCH = 200
DELETE_RECORDINGS_PATH = '/recordings/delete'
NO_AGENT = 'liwan_telephony: no agent is configured; recordings past retention stay available and are asked again'


class LiwanTelephonyCron(models.AbstractModel):
    _name = 'liwan.telephony.cron'
    _description = 'LiwanOS telephony scheduled work'
    _liwan_scope = 'global'

    @api.model
    def _liwan_expire_recordings(self):
        """Expire every company's recordings past its retention window; returns how many rows were expired.

        The agent is the only one who can delete the file, so a deployment without one keeps its recordings rather
        than reporting an expiry that never happened on disk.
        """
        if not self.env['liwan.telephony.agent']._liwan_is_configured():
            _logger.warning(NO_AGENT)
            return 0
        expired_total = 0
        for company in self.env['res.company'].search([('active', '=', True)]):
            expired_total += self._liwan_expire_company(company)
        return expired_total

    @api.model
    def _liwan_expire_company(self, company):
        """Ask the agent to delete one batch of ``company``'s expired recordings and mark what it confirmed."""
        settings = self.env['liwan.telephony.settings']._liwan_for(company)
        cutoff = fields.Datetime.now() - timedelta(days=settings.recording_retention_days)
        domain = [
            ('company_id', '=', company.id),
            ('recording_state', '=', 'available'),
            ('state', 'in', TERMINAL_STATES),
            '|',
            '&', ('ended_at', '!=', False), ('ended_at', '<', cutoff),
            '&', ('ended_at', '=', False), ('create_date', '<', cutoff),
        ]
        calls = self.env['liwan.telephony.call'].with_company(company).search(
            domain, limit=RETENTION_BATCH, order='ended_at, id',
        )
        if not calls:
            return 0
        answer = self._liwan_delete(company, calls)
        if answer is None:
            return 0
        confirmed = self._liwan_confirmed(answer, calls)
        expired = calls.filtered(lambda call: call.linkedid in confirmed)
        if expired:
            expired.write({'recording_state': 'expired'})
        still_active = calls - expired
        if still_active:
            _logger.warning(
                'liwan_telephony: the agent still holds %s recording(s) of company %s past retention: %s',
                len(still_active), company.id, ', '.join(still_active.mapped('linkedid')),
            )
        return len(expired)

    @api.model
    def _liwan_delete(self, company, calls):
        """The agent's answer to deleting ``calls``' recordings, or None when it could not be read.

        A failed request leaves every one of them ``available``: the next run asks again, and nothing claims a
        deletion that did not happen.
        """
        try:
            return self.env['liwan.telephony.agent']._liwan_request('POST', DELETE_RECORDINGS_PATH, {
                'database': self.env.cr.dbname,
                'linkedids': calls.mapped('linkedid'),
            })
        except ApiError as error:
            _logger.warning(
                'liwan_telephony: deleting the recordings of company %s failed: %s', company.id, error.message,
            )
            return None

    @api.model
    def _liwan_confirmed(self, answer, calls):
        """The ``linkedid``s the agent reported deleted or missing, of the ones this batch asked about."""
        deleted, missing = answer.get('deleted'), answer.get('missing')
        if not isinstance(deleted, list) or not isinstance(missing, list):
            _logger.warning('liwan_telephony: the agent answered an unexpected recording deletion report')
            return frozenset()
        answered = {linkedid for linkedid in (*deleted, *missing) if isinstance(linkedid, str)}
        asked = set(calls.mapped('linkedid'))
        return frozenset(answered & asked)
