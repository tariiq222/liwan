# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    access_service,
    directory,
    entitlement_service,
    feature_registry,
    mail_notification_nasq,
    meeting_access,
    meeting_access_service,
    meeting_directory,
    meeting_feature_registry,
    meeting_links,
    meeting_links_pmo,
    meeting_mail_message,
    meeting_minute,
    meeting_notification_types,
    meeting_resolution,
    meeting_series,
    nasq_settings,
    notification_types,
    project_charter_reference,
    project_finance,
    project_governance,
    project_milestone,
    project_project,
    project_task,
    project_task_meeting,
    project_template,
    res_company,
    task_attachments,
    task_notifications,
)

# Load the history extension after the Cyan meeting model and PMO mixins so
# its completion override remains the final layer in the model MRO.
# isort: split
from . import meeting_history, meeting_workspace

# The project link extends the workspace's content and decision field sets.
# isort: split
from . import meeting_convert, meeting_project
