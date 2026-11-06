# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanAiAgentSetting(models.Model):
    """The administrator's narrowing of one agent for the whole tenant (spec 2026-11-04 §6.7).

    No row means the default: enabled, every role, all of its tools. ``role_ids`` empty means every user who holds
    ``ai.use``; otherwise the user needs an assignment of one of these roles in the current company.
    """
    _name = 'liwan.ai.agent.setting'
    _description = 'LiwanOS AI agent setting'
    _liwan_scope = 'tenant'
    _order = 'agent_key'

    agent_key = fields.Char(required=True)
    enabled = fields.Boolean(required=True, default=True)
    read_only = fields.Boolean(required=True, default=False)
    # Whether the agent may save and read the employee's and the company's notes (spec 2026-11-04 §6.7).
    memory = fields.Boolean(required=True, default=True)
    role_ids = fields.Many2many('liwan.access.role', 'liwan_ai_agent_setting_role_rel', 'setting_id', 'role_id')
    # Bumped by every change of the agent or of its tools' modes; a save based on an older read answers 409.
    revision = fields.Integer(required=True, default=0)

    _agent_key_unique = models.Constraint('UNIQUE(agent_key)', 'one setting per agent')

    @api.model
    def _liwan_ai_effective(self, user):
        """``{agent_key: {'read_only': bool, 'memory': bool}}`` for the registered agents ``user`` may use in the current company.

        The role lists and the user's assignments are read in SQL, as ``liwan.access.service`` reads them: an
        employee holds no ACL on roles or assignments, and the restriction must hold for them all the same.
        """
        settings = {row.agent_key: row for row in self.search([])}
        restricted = self._liwan_ai_role_ids(settings.values())
        held = self._liwan_ai_user_role_ids(user) if restricted else set()
        agents = {}
        for key, agent in self.env['liwan.ai.agent.registry']._liwan_ai_agent_map().items():
            row = settings.get(key)
            if row and not row.enabled:
                continue
            roles = restricted.get(row.id) if row else None
            if roles and not roles & held:
                continue
            # An agent that declares ``memory: False`` never remembers, whatever a stored row says.
            agents[key] = {'read_only': bool(row and row.read_only), 'memory': agent.get('memory', True) and (not row or row.memory)}
        return agents

    @api.model
    def _liwan_ai_role_ids(self, rows):
        """``{setting_id: {role_id}}`` of the settings that restrict their agent to some roles."""
        ids = [row.id for row in rows]
        if not ids:
            return {}
        self.env.cr.execute(
            'SELECT setting_id, role_id FROM liwan_ai_agent_setting_role_rel WHERE setting_id = ANY(%s)', [ids],
        )
        restricted = {}
        for setting_id, role_id in self.env.cr.fetchall():
            restricted.setdefault(setting_id, set()).add(role_id)
        return restricted

    @api.model
    def _liwan_ai_user_role_ids(self, user):
        self.env.cr.execute(
            'SELECT role_id FROM liwan_access_assignment WHERE user_id = %s AND company_id = %s',
            [user.id, self.env.company.id],
        )
        return {row[0] for row in self.env.cr.fetchall()}
