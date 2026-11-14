# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_api.models.tenant_export_hooks import model_dataset

APP = 'tasks'
PROJECT_FIELDS = ('id', 'name', 'active', 'company_id', 'user_id', 'partner_id', 'date_start', 'date', 'create_date', 'write_date')
DATASETS = (
    ('tasks', 'Tasks', 'project.task', True),
    ('task_stages', 'Task stages', 'project.task.type', False),
    ('task_tags', 'Task tags', 'project.tags', False),
)


class LiwanTasksTenantExport(models.AbstractModel):
    _inherit = 'liwan.tenant.export.hooks'

    @api.model
    def _liwan_export_datasets(self):
        return [
            *super()._liwan_export_datasets(),
            *(
                model_dataset(self.env, APP, key, title, model, attachments=files)
                for key, title, model, files in DATASETS
            ),
            model_dataset(self.env, APP, 'task_projects', 'Projects', 'project.project', fields=PROJECT_FIELDS),
        ]
