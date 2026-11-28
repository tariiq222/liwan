# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One company's telephony settings: whether calls are recorded, whether the answering party hears the notice, and how
long the recordings are kept.

The row is written the first time a manager saves the settings page; until then ``_liwan_for`` answers the declared
defaults, so a company that never opened the page still has one exact policy. The agent is told a new policy on save,
and the retention cron is what removes the files.
"""
import logging

from odoo import api, fields, models

from odoo.addons.liwan_api.controllers.common import ApiError

_logger = logging.getLogger(__name__)

RECORDING_POLICIES = (('always', 'Always'), ('off', 'Off'))
# Inclusive (min, max) retention window in days; the database CHECK and the API parser read this one pair.
RETENTION_DAYS_RANGE = (1, 3650)
DEFAULT_RECORDING_POLICY = 'off'
DEFAULT_RECORDING_ANNOUNCEMENT = True
DEFAULT_RETENTION_DAYS = 90
# The declared defaults every reader falls back to while the company never saved a row.
DEFAULTS = {
    'recording_policy': DEFAULT_RECORDING_POLICY,
    'recording_announcement': DEFAULT_RECORDING_ANNOUNCEMENT,
    'recording_retention_days': DEFAULT_RETENTION_DAYS,
}
RECORDING_CONFIG_PATH = '/recording/config'


class LiwanTelephonySettings(models.Model):
    _name = 'liwan.telephony.settings'
    _description = 'LiwanOS telephony settings'
    _liwan_scope = 'company'
    _rec_name = 'company_id'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    recording_policy = fields.Selection(
        RECORDING_POLICIES, required=True, default=DEFAULT_RECORDING_POLICY,
    )
    # Whether the notice plays to the party that answers, once it answers: the ``A()`` option ``[record-call]`` puts on
    # the ``Dial``, so the announcement is heard outside the recording rather than inside it.
    recording_announcement = fields.Boolean(default=DEFAULT_RECORDING_ANNOUNCEMENT)
    # How many days the agent keeps a call's recording file before the retention cron deletes it.
    recording_retention_days = fields.Integer(required=True, default=DEFAULT_RETENTION_DAYS)

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one telephony settings record')
    _retention_days_range = models.Constraint(
        'CHECK(recording_retention_days BETWEEN %d AND %d)' % RETENTION_DAYS_RANGE,
        'recording_retention_days must be between %d and %d' % RETENTION_DAYS_RANGE,
    )

    @api.model
    def _liwan_current(self):
        """The current company's row, or an empty recordset when it was never saved."""
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_for(self, company):
        """The settings of ``company``, or a record carrying the declared defaults when it never saved one.

        Used by the retention cron for every company, so the reader is never the row's owner.
        """
        row = self.search([('company_id', '=', company.id)], limit=1)
        if row:
            return row
        return self.new({**DEFAULTS, 'company_id': company.id})

    def _liwan_push_agent(self):
        """Tell the agent this row's recording policy, once.

        A non-2xx answer is a logged warning and not a rollback: the row is the record of the choice the manager
        made, and the agent keeps the previous policy until the next save pushes this one again. The retention cron
        retries only the disk side, never this push.
        """
        self.ensure_one()
        agent = self.env['liwan.telephony.agent']
        if not agent._liwan_is_configured():
            return
        try:
            agent._liwan_request('PUT', RECORDING_CONFIG_PATH, {
                'database': self.env.cr.dbname,
                'policy': self.recording_policy,
                'announce': self.recording_announcement,
            })
        except ApiError as error:
            _logger.warning(
                'liwan_telephony: the agent did not take the recording policy of company %s: %s',
                self.company_id.id, error.message,
            )
