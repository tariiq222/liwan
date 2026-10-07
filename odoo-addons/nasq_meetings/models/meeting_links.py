# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hooks that link meetings to the records of other applications.

The meetings application knows no other application. A bridge addon (for
projects and tasks: nasq_meetings_pmo) inherits this model and fills the
hooks; without one every meeting has no project and no linked task, and
the API keeps its payload shape with null values (ruling H.1). Every hook
runs in the caller's environment.
"""
from odoo import api, models
from odoo.exceptions import ValidationError

from odoo.addons.nasq_api.controllers.common import ApiError

UNSUPPORTED_PROJECT = 'project_id is not supported: the projects application is not installed'


class NasqMeetingLinks(models.AbstractModel):
    _name = 'nasq.meeting.links'
    _description = 'Meeting links to other applications'
    _nasq_scope = 'global'

    @api.model
    def _nasq_link_fields(self):
        """Fields the bridges add to meetings; they follow the content edits of a scope."""
        return frozenset()

    @api.model
    def _nasq_project_id(self, record):
        """The id of the project linked to a meeting, series or recommendation, or None."""
        return

    @api.model
    def _nasq_project_ref(self, record):
        """``{'id', 'name'}`` of the linked project when the caller may read it, else None."""
        return

    @api.model
    def _nasq_project_ref_by_id(self, record, project_id):
        """Like ``_nasq_project_ref`` for a stored project id (minutes topics, snapshots)."""
        return

    @api.model
    def _nasq_project_domain(self, project_id):
        """Domain of a list's ``?project_id=`` filter; without projects the filter is ignored."""
        return []

    @api.model
    def _nasq_check_project(self, project_id):
        """Validate the project requested for a recommendation and return its id."""
        raise ApiError(422, 'invalid', UNSUPPORTED_PROJECT, field='project_id')

    @api.model
    def _nasq_project_vals(self, project_id):
        """Values that link a record to ``project_id`` (an id) or clear the link (False)."""
        if not project_id:
            return {}
        raise ApiError(422, 'invalid', UNSUPPORTED_PROJECT, field='project_id')

    @api.model
    def _nasq_check_topic_project(self, project_id):
        """Validate the project of a minutes topic; raise ValidationError when it is not usable."""
        raise ValidationError(self.env._('Minutes topic projects need the projects application.'))

    @api.model
    def _nasq_linked_resolution_ids(self, resolutions):
        """Ids of ``resolutions`` followed on a linked record of another application, archived links included."""
        return set()

    @api.model
    def _nasq_readable_links(self, meeting, resolutions):
        """``{resolution_id: {'task_id', 'state', 'company_id', 'project_id'}}`` of links the caller can read now."""
        return {}
