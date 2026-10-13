# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import (
    entitlement_service,
    feature_registry,
    meeting_access,
    meeting_access_service,
    meeting_directory,
    meeting_links,
    meeting_mail_message,
    meeting_minute,
    meeting_notification_types,
    meeting_resolution,
    meeting_series,
)

# Load the history extension after the Cyan meeting model and the other
# mixins so its completion override remains the final layer in the model MRO.
# isort: split
from . import meeting_history, meeting_workspace
