# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_ai.models.tool_registry import TOOL_MODES


class LiwanAiToolSetting(models.Model):
    """The administrator's mode for one tool, tenant-wide: ``on`` (default, no row), ``approval`` or ``off``.

    ``approval`` makes even a read wait for the user's confirmation; every write needs it anyway (platform constant).
    """
    _name = 'liwan.ai.tool.setting'
    _description = 'LiwanOS AI tool setting'
    _liwan_scope = 'tenant'
    _order = 'tool_name'

    tool_name = fields.Char(required=True)
    mode = fields.Selection([(mode, mode) for mode in TOOL_MODES], required=True, default='on')

    _tool_name_unique = models.Constraint('UNIQUE(tool_name)', 'one setting per tool')

    @api.model
    def _liwan_ai_modes(self):
        return {row.tool_name: row.mode for row in self.search([])}
