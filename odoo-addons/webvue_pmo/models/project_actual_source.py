# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import MissingError


class WebVueProjectActualSource(models.AbstractModel):
    """Where a project's actual cost comes from, when it is not the manual expense entries.

    Extension point: a bridge to an accounting application overrides the hooks through ``super()``.
    The base answers "manual": every project keeps its manual expense entries, no account is linked, and
    nothing can be read or chosen. A project is *external* when ``_webvue_is_external`` says so, and
    ``_webvue_actual_totals`` then returns it.
    Every hook runs in the caller's own environment and the route layer has already checked that the
    caller may read the project.
    """
    _name = 'webvue.project.actual.source'
    _description = 'webvue project actual cost source'
    _webvue_scope = 'global'

    @api.model
    def _webvue_actual_totals(self, projects):
        """``{project_id: (amount, line_count)}`` of every external project among ``projects``.

        ``amount`` is a ``Decimal`` cost (negative for a net refund) and ``line_count`` the number of
        source lines behind it. Every external project is present, manual ones are absent.
        """
        return {}

    @api.model
    def _webvue_actual_account(self, project):
        """The cost center of an external project as ``{'id', 'name', 'code'}`` (code may be None), else None."""

    @api.model
    def _webvue_can_read_actual_lines(self, project):
        return False

    @api.model
    def _webvue_actual_lines(self, project, limit, offset):
        """``(rows, total)`` of the source lines behind an external project's actual cost."""
        raise MissingError(self.env._("This project has no external actual cost."))

    @api.model
    def _webvue_can_choose_actual_account(self, project):
        return False

    @api.model
    def _webvue_set_actual_account(self, project, account_id):
        """Link the project to the cost center ``account_id``, or unlink it with ``None``."""
        raise MissingError(self.env._("This project has no external actual cost."))

    @api.model
    def _webvue_is_external(self, project):
        """Whether the actual cost of ``project`` comes from the source and manual expenses are off."""
        return False
