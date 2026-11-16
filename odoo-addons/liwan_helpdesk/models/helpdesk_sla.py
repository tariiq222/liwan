# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The service levels of the desk: who a policy covers, and how long a ticket may run.

The engine keeps the policy (`helpdesk.sla`) and the per-ticket rows it derives from it. This service
edits the parts a tenant shapes without code — the target stage, the days and hours, the teams,
categories, tags and the stages where the clock is paused — and refuses the values a screen cannot
express, so a broken policy never reaches the tickets it would freeze.
"""
from odoo import api, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

INVALID = 'invalid'
NOT_FOUND = 'not_found'
NAME_MAX = 120
TARGET_MAX_DAYS = 365
TARGET_MAX_HOURS = 23


def invalid(message, field=None):
    return LiwanAccessRule(INVALID, message, field=field, status=422)


def not_found():
    return LiwanAccessRule(NOT_FOUND, 'Record does not exist', status=404)


class LiwanHelpdeskSla(models.AbstractModel):
    _name = 'liwan.helpdesk.sla'
    _description = 'LiwanOS Support Desk service levels'
    _liwan_scope = 'global'

    @api.model
    def _liwan_dump(self):
        company = self.env.company
        policies = self.env['helpdesk.sla'].search([('company_id', '=', company.id)], order='name, id')
        return {
            'items': [self._liwan_dump_one(policy) for policy in policies],
            'targets': [
                {'code': 'first_response', 'label_key': 'helpdesk.settings.sla.firstResponse'},
                {'code': 'resolution', 'label_key': 'helpdesk.settings.sla.resolution'},
            ],
        }

    def _liwan_dump_one(self, policy):
        return {
            'id': policy.id, 'name': policy.name, 'active': policy.active,
            'days': policy.days, 'hours': policy.hours,
            'stage_id': policy.stage_id.id or None,
            'team_ids': policy.team_ids.ids,
            'category_ids': policy.category_ids.ids,
            'tag_ids': policy.tag_ids.ids,
            'ignore_stage_ids': policy.ignore_stage_ids.ids,
            'ticket_count': self.env['helpdesk.ticket.sla'].search_count([('sla_id', '=', policy.id)]),
        }

    @api.model
    def _liwan_own(self, policy_id):
        policy = self.env['helpdesk.sla'].search(
            [('id', '=', policy_id), ('company_id', '=', self.env.company.id)], limit=1)
        if not policy:
            raise not_found()
        return policy

    @api.model
    def _liwan_records(self, model, ids, field):
        if not isinstance(ids, list) or any(type(item) is not int or item <= 0 for item in ids):
            raise invalid(self.env._('must be a list of ids'), field=field)
        domain = [('id', 'in', ids)]
        if 'company_id' in self.env[model]._fields:
            domain.append(('company_id', 'in', [False, self.env.company.id]))
        records = self.env[model].search(domain)
        if len(records) != len(set(ids)):
            raise invalid(self.env._('a record does not exist in this company'), field=field)
        return records

    @api.model
    def _liwan_values(self, payload, policy=None):
        name = payload.get('name')
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX:
            raise invalid(self.env._('name is required and at most %d characters' % NAME_MAX), field='name')
        days = payload.get('days', 0)
        hours = payload.get('hours', 0)
        if type(days) is not int or not 0 <= days <= TARGET_MAX_DAYS:
            raise invalid(self.env._('days must be between 0 and %d' % TARGET_MAX_DAYS), field='days')
        if type(hours) is not int or not 0 <= hours <= TARGET_MAX_HOURS:
            raise invalid(self.env._('hours must be between 0 and %d' % TARGET_MAX_HOURS), field='hours')
        if days == 0 and hours == 0:
            raise invalid(self.env._('a service level needs a target longer than zero'), field='hours')
        stage_id = payload.get('stage_id')
        if type(stage_id) is not int or stage_id <= 0:
            raise invalid(self.env._('the target stage is required'), field='stage_id')
        stage = self.env['helpdesk.ticket.stage'].search([
            ('id', '=', stage_id), ('company_id', 'in', [False, self.env.company.id]),
        ], limit=1)
        if not stage:
            raise invalid(self.env._('the target stage does not exist'), field='stage_id')
        values = {
            'name': name.strip(), 'days': days, 'hours': hours, 'stage_id': stage.id,
            'team_ids': [(6, 0, self._liwan_records('helpdesk.ticket.team', payload.get('team_ids', []), 'team_ids').ids)],
            'category_ids': [(6, 0, self._liwan_records(
                'helpdesk.ticket.category', payload.get('category_ids', []), 'category_ids').ids)],
            'tag_ids': [(6, 0, self._liwan_records('helpdesk.ticket.tag', payload.get('tag_ids', []), 'tag_ids').ids)],
            'ignore_stage_ids': [(6, 0, self._liwan_records(
                'helpdesk.ticket.stage', payload.get('ignore_stage_ids', []), 'ignore_stage_ids').ids)],
        }
        if 'active' in payload:
            if payload['active'] not in (True, False):
                raise invalid(self.env._('must be true or false'), field='active')
            values['active'] = payload['active']
        return values

    @api.model
    def _liwan_save(self, payload):
        # A policy of another company is not found before its body is judged, so the refusal never reports
        # which of its values would have been acceptable.
        policy = self._liwan_own(payload['id']) if payload.get('id') else self.env['helpdesk.sla'].browse()
        values = self._liwan_values(payload)
        if policy:
            policy.write(values)
        else:
            policy = self.env['helpdesk.sla'].create({'company_id': self.env.company.id, **values})
        # Every ticket the policy now covers gets its row, and one it no longer covers loses it, so the
        # deadlines the screens show follow the policy at once instead of at the next stage change.
        if policy.active:
            self._liwan_refresh(policy)
        return policy

    @api.model
    def _liwan_refresh(self, policy):
        """Recompute the engine's per-ticket rows for the tickets this policy covers.

        The engine's ``refresh_sla`` works on one ticket at a time, so the batch is walked here; a policy
        edit is rare and a ticket count is bounded per team.
        """
        teams = policy.team_ids or self.env['helpdesk.ticket.team'].search([('company_id', '=', self.env.company.id)])
        tickets = self.env['helpdesk.ticket'].search([('team_id', 'in', teams.ids), ('company_id', '=', self.env.company.id)])
        for ticket in tickets:
            ticket.refresh_sla()

    @api.model
    def _liwan_archive(self, policy_id, active):
        if active not in (True, False):
            raise invalid(self.env._('must be true or false'), field='active')
        policy = self._liwan_own(policy_id)
        # The engine's per-ticket rows stay: they are the history of the deadlines the policy gave, and the
        # engine's own unlink check asks for a ticket unlink no support role holds. A ticket reads only the
        # rows of an active policy (serializers/ticket.py), so archiving stops the clock without a delete.
        policy.write({'active': active})
        return policy
