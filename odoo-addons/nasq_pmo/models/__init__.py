# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    access_service,
    directory,
    entitlement_service,
    feature_registry,
    mail_notification_nasq,
    meeting_access,
    meeting_minute,
    meeting_resolution,
    meeting_series,
    nasq_settings,
    project_charter_reference,
    project_finance,
    project_governance,
    project_milestone,
    project_project,
    project_task,
    project_template,
    res_company,
    task_attachments,
    task_notifications,
)

# Load the history extension after the Cyan meeting model and PMO mixins so
# its completion override remains the final layer in the model MRO.
# isort: split
from . import meeting_history, meeting_workspace
