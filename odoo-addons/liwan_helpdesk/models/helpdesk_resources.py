# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The reference records a tenant shapes from the settings: teams, stages, categories, tags, channels, types.

Every save validates the company, the parent or member relations and the guards that keep the desk
operable: a team or a stage still used by tickets is archived instead of removed, and a stage or a team of
another company is out of reach.
"""
from odoo import api, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_helpdesk.hooks import ENGINE_STAGES

NAME_MAX = 64
INVALID = 'invalid'
FORBIDDEN = 'forbidden'
NOT_FOUND = 'not_found'


def invalid(message, field=None):
    return LiwanAccessRule(INVALID, message, field=field, status=422)


def forbidden(message='forbidden'):
    return LiwanAccessRule(FORBIDDEN, message, status=403)


class LiwanHelpdeskResources(models.AbstractModel):
    _name = 'liwan.helpdesk.resources'
    _description = 'LiwanOS Support Desk reference records'
    _liwan_scope = 'global'

    @api.model
    def _liwan_company(self):
        return self.env.company

    @api.model
    def _liwan_name(self, payload):
        name = payload.get('name')
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX:
            raise invalid(self.env._('name is required and at most %d characters' % NAME_MAX), field='name')
        return name.strip()

    @api.model
    def _liwan_bool(self, payload, key):
        value = payload.get(key, False)
        if value not in (True, False):
            raise invalid(self.env._('must be true or false'), field=key)
        return value

    @api.model
    def _liwan_sequence_value(self, payload):
        value = payload.get('sequence', 10)
        if type(value) is not int or value < 0 or value > 9999:
            raise invalid(self.env._('must be a sequence between 0 and 9999'), field='sequence')
        return value

    @api.model
    def _liwan_own(self, model, record_id):
        """The record of the working company, archived or not (a switch reactivates it); a shared or foreign row is not found."""
        record = self.env[model].with_context(active_test=False).search(
            [('id', '=', record_id), ('company_id', '=', self.env.company.id)], limit=1)
        if not record:
            code = NOT_FOUND
            raise LiwanAccessRule(code, self.env._('Record does not exist'), status=404)
        return record

    @api.model
    def _liwan_dump(self):
        """Every record the settings surface edits, the archived ones included: a switch on its row brings one back.

        The ticket pickers read ``/reference`` instead, which leaves archived rows out. The engine's own archived stages
        are not the tenant's and never listed.
        """
        company = self._liwan_company()
        shared = ['|', ('company_id', '=', False), ('company_id', '=', company.id)]
        every = self.with_context(active_test=False).env
        engine = [stage.id for stage in map(self.env.ref, ENGINE_STAGES) if stage]
        teams = every['helpdesk.ticket.team'].search([('company_id', '=', company.id)], order='sequence, name, id')
        stages = every['helpdesk.ticket.stage'].search([*shared, ('id', 'not in', engine)], order='sequence, name, id')
        return {
            'teams': [self._liwan_dump_team(team) for team in teams],
            'stages': [self._liwan_dump_stage(stage) for stage in stages],
            'categories': [self._liwan_dump_named(row, complete=True)
                           for row in every['helpdesk.ticket.category'].search(shared, order='sequence, name, id')],
            'tags': [self._liwan_dump_named(row) for row in every['helpdesk.ticket.tag'].search(shared, order='sequence, name, id')],
            'channels': [self._liwan_dump_named(row)
                         for row in every['helpdesk.ticket.channel'].search(shared, order='sequence, name, id')],
            'types': [self._liwan_dump_named(row) for row in every['helpdesk.ticket.type'].search([], order='name, id')],
        }

    def _liwan_dump_team(self, team):
        return {
            'id': team.id, 'name': team.name, 'active': team.active, 'sequence': team.sequence,
            'member_ids': [{'id': user.id, 'name': user.name} for user in team.user_ids],
            'leader_id': team.user_id.id or None,
            'calendar_id': team.resource_calendar_id.id or None,
        }

    def _liwan_dump_stage(self, stage):
        return {
            'id': stage.id, 'name': stage.name, 'active': stage.active, 'sequence': stage.sequence,
            'closed': bool(stage.closed), 'unattended': bool(stage.unattended), 'fold': bool(stage.fold),
            'team_ids': stage.team_ids.ids,
            'shared': not stage.company_id,
        }

    def _liwan_dump_named(self, record, complete=False):
        return {
            'id': record.id, 'name': record.complete_name if complete else record.name,
            'active': record.active,
            'sequence': record.sequence if 'sequence' in record._fields else 10,
            **({'parent_id': record.parent_id.id or None} if complete else {}),
        }

    @api.model
    def _liwan_members(self, payload):
        """The team members: internal users of the working company."""
        ids = payload.get('member_ids', [])
        if not isinstance(ids, list) or any(type(item) is not int or item <= 0 for item in ids):
            raise invalid(self.env._('must be a list of user ids'), field='member_ids')
        users = self.env['res.users'].search([('id', 'in', ids), ('share', '=', False)])
        if len(users) != len(set(ids)):
            raise invalid(self.env._('a member is not an internal user'), field='member_ids')
        return users

    @api.model
    def _liwan_calendar(self, payload):
        calendar_id = payload.get('calendar_id')
        if calendar_id in (None, False):
            return self.env['resource.calendar']
        if type(calendar_id) is not int or calendar_id <= 0:
            raise invalid(self.env._('must be a calendar id'), field='calendar_id')
        calendar = self.env['resource.calendar'].browse(calendar_id).exists()
        if not calendar or (calendar.company_id and calendar.company_id != self.env.company):
            raise invalid(self.env._('the calendar does not belong to the company'), field='calendar_id')
        return calendar

    @api.model
    def _liwan_open_tickets(self, domain):
        return self.env['helpdesk.ticket'].search_count([('stage_id.closed', '=', False), *domain])

    @api.model
    def _liwan_save_team(self, payload):
        model = self.env['helpdesk.ticket.team']
        record = self._liwan_own(model._name, payload['id']) if payload.get('id') else model.browse()
        values = {'name': self._liwan_name(payload)}
        members = self._liwan_members(payload) if 'member_ids' in payload else record.user_ids
        if 'member_ids' in payload:
            values['user_ids'] = [(6, 0, members.ids)]
        if 'leader_id' in payload:
            leader_id = payload['leader_id']
            if leader_id in (None, False):
                values['user_id'] = False
            else:
                if type(leader_id) is not int or leader_id not in members.ids:
                    raise invalid(self.env._('the leader must be a member of the team'), field='leader_id')
                values['user_id'] = leader_id
        if 'calendar_id' in payload:
            values['resource_calendar_id'] = self._liwan_calendar(payload).id or False
        if 'sequence' in payload:
            values['sequence'] = self._liwan_sequence_value(payload)
        if 'active' in payload:
            active = self._liwan_bool(payload, 'active')
            if not active and record and record.id == self.env['liwan.helpdesk.settings']._liwan_for(
                    self.env.company).default_team_id.id:
                raise invalid(self.env._('the default team cannot be archived; choose another default first'), field='active')
            if not active and record and self._liwan_open_tickets([('team_id', '=', record.id)]):
                raise invalid(self.env._('the team still has open tickets'), field='active')
            values['active'] = active
        if record:
            record.write(values)
            return record
        return model.create({'company_id': self.env.company.id, **values})

    @api.model
    def _liwan_save_stage(self, payload):
        model = self.env['helpdesk.ticket.stage']
        record = self._liwan_own(model._name, payload['id']) if payload.get('id') else model.browse()
        values = {'name': self._liwan_name(payload)}
        for key in ('closed', 'unattended', 'fold'):
            if key in payload:
                values[key] = self._liwan_bool(payload, key)
        if 'sequence' in payload:
            values['sequence'] = self._liwan_sequence_value(payload)
        if 'team_ids' in payload:
            ids = payload['team_ids']
            if not isinstance(ids, list) or any(type(item) is not int or item <= 0 for item in ids):
                raise invalid(self.env._('must be a list of team ids'), field='team_ids')
            teams = self.env['helpdesk.ticket.team'].search([
                ('id', 'in', ids), ('company_id', '=', self.env.company.id),
            ])
            if len(teams) != len(set(ids)):
                raise invalid(self.env._('a team is not a team of the company'), field='team_ids')
            values['team_ids'] = [(6, 0, teams.ids)]
        if 'active' in payload:
            active = self._liwan_bool(payload, 'active')
            if not active and record and self._liwan_open_tickets([('stage_id', '=', record.id)]):
                raise invalid(self.env._('the stage still holds open tickets'), field='active')
            values['active'] = active
        if record:
            record.write(values)
            return record
        return model.create({'company_id': self.env.company.id, **values})

    @api.model
    def _liwan_save_category(self, payload):
        model = self.env['helpdesk.ticket.category']
        record = self._liwan_own(model._name, payload['id']) if payload.get('id') else model.browse()
        values = {'name': self._liwan_name(payload)}
        if 'parent_id' in payload:
            parent_id = payload['parent_id']
            if parent_id in (None, False):
                values['parent_id'] = False
            else:
                if type(parent_id) is not int or parent_id <= 0:
                    raise invalid(self.env._('must be a category id'), field='parent_id')
                if record and parent_id == record.id:
                    raise invalid(self.env._('a category cannot be its own parent'), field='parent_id')
                parent = self.env[model._name].search([
                    ('id', '=', parent_id), ('company_id', 'in', [False, self.env.company.id]),
                ], limit=1)
                if not parent:
                    raise invalid(self.env._('the parent category does not exist'), field='parent_id')
                if record and parent.parent_path and record.parent_path and parent.parent_path.startswith(
                        record.parent_path):
                    raise invalid(self.env._('a category cannot move under its own child'), field='parent_id')
                values['parent_id'] = parent.id
        if 'sequence' in payload:
            values['sequence'] = self._liwan_sequence_value(payload)
        if 'active' in payload:
            values['active'] = self._liwan_bool(payload, 'active')
        if record:
            record.write(values)
            return record
        return model.create({'company_id': self.env.company.id, **values})

    @api.model
    def _liwan_save_named(self, model_name, payload):
        """A flat value list: tags, channels and types (which have no company column)."""
        model = self.env[model_name]
        record = model.browse()
        if payload.get('id'):
            domain = [('id', '=', payload['id'])]
            if 'company_id' in model._fields:
                domain.append(('company_id', '=', self.env.company.id))
            record = model.search(domain, limit=1)
            if not record:
                code = NOT_FOUND
                raise LiwanAccessRule(code, self.env._('Record does not exist'), status=404)
        values = {'name': self._liwan_name(payload)}
        if 'sequence' in payload:
            values['sequence'] = self._liwan_sequence_value(payload)
        if 'active' in payload:
            values['active'] = self._liwan_bool(payload, 'active')
        if record:
            record.write(values)
            return record
        create = {'company_id': self.env.company.id, **values} if 'company_id' in model._fields else values
        return model.create(create)
