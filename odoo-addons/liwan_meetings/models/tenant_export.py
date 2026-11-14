# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import REASON_LOG, model_dataset

APP = 'meetings'
# Settings are an explicit allowlist: a new field is not exported until someone decides it belongs in the export.
SETTINGS_FIELDS = (
    'id',
    'company_id',
    'create_date',
    'reference_prefix',
    'reminder_hours',
    'revision',
    'schedule_policy',
    'write_date',
)
DATASETS = (
    ('meetings', 'Meetings', 'calendar.event', True),
    ('meeting_series', 'Meeting series', 'liwan.meeting.series', False),
    ('meeting_minutes', 'Minutes', 'liwan.meeting.minute', True),
    ('meeting_minutes_versions', 'Minutes versions', 'liwan.meeting.minutes.version', False),
    ('meeting_resolutions', 'Resolutions', 'liwan.meeting.resolution', False),
)


class LiwanMeetingsTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            *(
                model_dataset(self.env, APP, key, title, model, attachments=files)
                for key, title, model, files in DATASETS
            ),
            model_dataset(self.env, APP, 'meeting_settings', 'Settings', 'liwan.meeting.settings', fields=SETTINGS_FIELDS),
        ]

    @api.model
    def _liwan_export_technical_models(self):
        return {**super()._liwan_export_technical_models(), 'liwan.meeting.event': REASON_LOG}
