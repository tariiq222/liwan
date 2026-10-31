# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
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
        # Odoo archives a project's tasks with it, so an active task has no archived project and a
        # task-only role pays no project lookup. For an inactive task the project is searched as the
        # caller: one who cannot read projects, or whose private project is hidden, sees it as not archived.
        if record.active:
            return record
        try:
            project = request.env['project.project'].with_context(active_test=False).search(
                [('id', '=', record.project_id.id), ('active', '=', False)],
            )
        except AccessError:
            return record
    else:
        return record
    if project and not project.active:
        project._liwan_check_archived_readable()
        if not archived_write and request.httprequest.method not in READ_METHODS:
            raise ApiError(422, 'archived_project', request.env._("An archived project is read-only."))
    return record
