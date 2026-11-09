# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_pmo.models.project_project import STATUS_VALUES


def project_status_domain(status):
    """The domain for the `status` query value of the project list and its reports.

    `status` is one project status, a comma list of them (a project matches any of the listed ones), or
    `unset` for a project that has no status yet. Anything else is a 422; an absent value filters nothing.
    """
    if status is None:
        return []
    if status == 'unset':
        return [('last_update_status', '=', 'to_define')]
    names = list(dict.fromkeys(name.strip() for name in status.split(',')))
    if any(name not in STATUS_VALUES for name in names):
        raise ApiError(
            422, 'invalid',
            f"status must be one of {sorted(STATUS_VALUES)} (a comma list is allowed) or 'unset'",
            field='status',
        )
    return [('last_update_status', 'in', names)]
