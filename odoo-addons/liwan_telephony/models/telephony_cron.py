# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Deleting the recordings the database no longer keeps (design 4.4).

The agent holds the audio; Odoo holds the policy and the row's state. A daily run reads the database's one recording
policy and asks the agent to delete one bounded batch of the recordings whose retention window has passed, then marks
``expired`` exactly the calls the agent reported deleted or missing. A recording the agent still considers active stays
``available`` and is reported, so the next run asks again rather than claiming a file the disk still holds.

One row never stops the run: the agent refuses a whole delete request for one call id outside its call-id rule, so a
row stored under such an id is logged and skipped, and the rest of the batch is still asked about.

The recording's honest timestamp is the call's end: the file exists once the call's legs ended. A finished call that
never recorded an end time falls back to the row's creation, never to a guess.
"""
import logging
from datetime import timedelta

from odoo import api, fields, models

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_telephony.models.telephony_call import (
    LINKEDID_PATTERN,
    TERMINAL_STATES,
)

_logger = logging.getLogger(__name__)

# The most calls one agent request asks about: a bounded batch keeps a request and its answer small.
RETENTION_BATCH = 200
DELETE_RECORDINGS_PATH = '/recordings/delete'
NO_AGENT = 'liwan_telephony: no agent is configured; recordings past retention stay available and are asked again'
NO_SETTINGS = 'liwan_telephony: the recording settings record is missing; the retention run is skipped'


class LiwanTelephonyCron(models.AbstractModel):
    _name = 'liwan.telephony.cron'
    _description = 'LiwanOS telephony scheduled work'
    _liwan_scope = 'global'

    @api.model
    def _liwan_expire_recordings(self):
        """Expire the recordings past the database's retention window; returns how many rows were expired.

        The agent is the only one who can delete the file, so a deployment without one keeps its recordings rather
        than reporting an expiry that never happened on disk. A call whose id the agent's call-id rule refuses is
        reported and skipped: its row stays ``available``, and the batch it was selected in still runs.
        """
        if not self.env['liwan.telephony.agent']._liwan_is_configured():
            _logger.warning(NO_AGENT)
            return 0
        settings = self.env['liwan.telephony.settings']._liwan_current()
        if not settings:
            _logger.warning(NO_SETTINGS)
            return 0
        cutoff = fields.Datetime.now() - timedelta(days=settings.recording_retention_days)
        calls = self.env['liwan.telephony.call'].search([
            ('recording_state', '=', 'available'),
            ('state', 'in', TERMINAL_STATES),
            '|',
            '&', ('ended_at', '!=', False), ('ended_at', '<', cutoff),
            '&', ('ended_at', '=', False), ('create_date', '<', cutoff),
        ], limit=RETENTION_BATCH, order='ended_at, id')
        if not calls:
            return 0
        askable = calls.filtered(lambda call: LINKEDID_PATTERN.fullmatch(call.linkedid))
        refused = calls - askable
        if refused:
            _logger.warning(
                'liwan_telephony: the agent cannot delete %s recording(s) whose call id it refuses; skipped: %s',
                len(refused), ', '.join(refused.mapped('linkedid')),
            )
        if not askable:
            return 0
        answer = self._liwan_delete(askable)
        if answer is None:
            return 0
        confirmed = self._liwan_confirmed(answer, askable)
        expired = askable.filtered(lambda call: call.linkedid in confirmed)
        if expired:
            expired.write({'recording_state': 'expired'})
        still_active = askable - expired
        if still_active:
            _logger.warning(
                'liwan_telephony: the agent still holds %s recording(s) past retention: %s',
                len(still_active), ', '.join(still_active.mapped('linkedid')),
            )
        return len(expired)

    @api.model
    def _liwan_delete(self, calls):
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
            _logger.warning('liwan_telephony: deleting the recordings past retention failed: %s', error.message)
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
