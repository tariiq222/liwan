# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.controllers.common import (
    get_visible_record as get_any_visible_record,
)

READ_METHODS = ('GET', 'HEAD', 'OPTIONS')


def get_visible_record(model, rec_id, *, archived_write=False):
    """The one lookup of every project-scoped route.

    A record the caller cannot see is not-found. Whatever belongs to an archived project is
    read-only for its members and not-found for everyone else, so a write on it is refused
    (``archived_write`` is for the one route that restores the project).
    """
    record = get_any_visible_record(model, rec_id)
    if model == 'project.project':
        project = record
    elif 'project_id' in record._fields:
        # Only the id of the task's project is read, and the project is searched as the caller:
        # an assignee may see a task whose private project is hidden from them.
        project = request.env['project.project'].with_context(active_test=False).search(
            [('id', '=', record.project_id.id), ('active', '=', False)],
        )
    else:
        return record
    if project and not project.active:
        project._liwan_check_archived_readable()
        if not archived_write and request.httprequest.method not in READ_METHODS:
            raise ApiError(422, 'archived_project', request.env._("An archived project is read-only."))
    return record
