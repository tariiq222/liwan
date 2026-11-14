# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import REASON_LOG, model_dataset

APP = 'meetings'
DATASETS = (
    ('meetings', 'Meetings', 'calendar.event', True),
    ('meeting_series', 'Meeting series', 'liwan.meeting.series', False),
    ('meeting_minutes', 'Minutes', 'liwan.meeting.minute', True),
    ('meeting_minutes_versions', 'Minutes versions', 'liwan.meeting.minutes.version', False),
    ('meeting_resolutions', 'Resolutions', 'liwan.meeting.resolution', False),
    ('meeting_settings', 'Settings', 'liwan.meeting.settings', False),
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
        ]

    @api.model
    def _liwan_export_technical_models(self):
        return {**super()._liwan_export_technical_models(), 'liwan.meeting.event': REASON_LOG}
