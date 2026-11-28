# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The database's telephony settings: whether calls are recorded, whether the answering party hears the notice, and how
long the recordings are kept.

Recording is a tenant-level control, because the effect is: one ``liwan_recording_config`` row in the pbx database and
one dialplan read one policy for the whole Odoo database. ``data/telephony_settings.xml`` installs the one record at the
declared defaults, and only a manager of the root company changes it. The agent is told a new policy once the save is
committed, and the retention cron is what removes the files.
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
RECORDING_CONFIG_PATH = '/recording/config'
MANAGE_CAPABILITY = 'telephony.manage'


class LiwanTelephonySettings(models.Model):
    _name = 'liwan.telephony.settings'
    _description = 'LiwanOS telephony settings'
    # Every company of the database reads the same policy, and the pbx enforces one.
    _liwan_scope = 'tenant'

    recording_policy = fields.Selection(
        RECORDING_POLICIES, required=True, default=DEFAULT_RECORDING_POLICY,
    )
    # Whether the notice plays to the party that answers, once it answers: the ``A()`` option ``[record-call]`` puts on
    # the ``Dial``, so the announcement is heard outside the recording rather than inside it.
    recording_announcement = fields.Boolean(default=DEFAULT_RECORDING_ANNOUNCEMENT)
    # How many days the agent keeps a call's recording file before the retention cron deletes it.
    recording_retention_days = fields.Integer(required=True, default=DEFAULT_RETENTION_DAYS)

    _retention_days_range = models.Constraint(
        'CHECK(recording_retention_days BETWEEN %d AND %d)' % RETENTION_DAYS_RANGE,
        'recording_retention_days must be between %d and %d' % RETENTION_DAYS_RANGE,
    )

    @api.model
    def _liwan_current(self):
        """The database's one settings record, installed with the declared defaults by
        ``data/telephony_settings.xml``, or an empty recordset when that record is missing."""
        return self.env.ref('liwan_telephony.telephony_settings', raise_if_not_found=False)

    def _liwan_queue_agent_push(self):
        """Queue telling the agent this database's recording policy, once this transaction has committed.

        The pbx must never hold a policy Odoo rolled back, so the request leaves after the commit: the pbx may lag
        Odoo by one save and never lead it. A push that fails is a logged warning naming the database, the row keeps
        the choice the manager made, and the next save sends the saved policy again.
        """
        self.ensure_one()
        database = self.env.cr.dbname
        agent = self.env['liwan.telephony.agent']
        config = agent._liwan_config()
        if not (config[0] and config[1]):
            return
        payload = {
            'database': database,
            'policy': self.recording_policy,
            'announce': self.recording_announcement,
        }

        def push():
            # The configuration was read inside the transaction, so the hook needs no ORM and no second cursor.
            try:
                agent._liwan_request('PUT', RECORDING_CONFIG_PATH, payload, config=config)
            except ApiError as error:
                _log_failed_push(database, error.message)
            except Exception as error:  # noqa: BLE001 - a postcommit hook must not raise after the commit
                _log_failed_push(database, type(error).__name__)

        self.env.cr.postcommit.add(push)


def _log_failed_push(database, reason):
    _logger.warning(
        'liwan_telephony: the agent did not take the recording policy of database %s: %s', database, reason,
    )
