# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The numbers of the desk: first response, resolution, service-level compliance and each agent's load.

Every figure is read from the tickets the caller may see and computed with one pass over them, so two
people opening the page at the same moment never see different answers for the same period. The targets
come from the company's settings; a zero target disables that measure instead of reporting a zero.
"""
from datetime import timedelta

from odoo import api, fields, models

PERIODS = (('7', 'Last 7 days'), ('30', 'Last 30 days'), ('90', 'Last 90 days'), ('365', 'Last year'))
MAX_AGENTS = 20


def _hours(start, end):
    return (end - start).total_seconds() / 3600 if start and end else None


def _average(values):
    values = [value for value in values if value is not None]
    return round(sum(values) / len(values), 1) if values else None


def _percent(part, whole):
    return round(part * 100 / whole, 1) if whole else None


class LiwanHelpdeskReports(models.AbstractModel):
    _name = 'liwan.helpdesk.reports'
    _description = 'LiwanOS Support Desk reports'
    _liwan_scope = 'global'

    @api.model
    def _liwan_period(self, raw):
        if raw in dict(PERIODS):
            return int(raw)
        return 30

    @api.model
    def _liwan_report(self, period):
        """``{period, kpis, agents, stages}`` of the working company for the last ``period`` days."""
        settings = self.env['liwan.helpdesk.settings']._liwan_for(self.env.company)
        since = fields.Datetime.now() - timedelta(days=period)
        domain = [*self.env['liwan.helpdesk.visibility']._liwan_domain(), ('create_date', '>=', since)]
        tickets = self.env['helpdesk.ticket'].search(domain, order='create_date')
        now = fields.Datetime.now()
        response_hours, resolution_hours, met, late = [], [], 0, 0
        open_count = closed_count = first_response_given = 0
        agents = {}
        stages = {}
        for ticket in tickets:
            stages[ticket.stage_id.name] = stages.get(ticket.stage_id.name, 0) + 1
            agent = ticket.user_id.name or ''
            bucket = agents.setdefault(agent, {'name': agent, 'open': 0, 'closed': 0, 'overdue': 0,
                                               'first_response_hours': []})
            if ticket.stage_id.closed:
                closed_count += 1
                bucket['closed'] += 1
                resolution_hours.append(_hours(ticket.create_date, ticket.closed_date or ticket.write_date))
            else:
                open_count += 1
                bucket['open'] += 1
            if ticket.liwan_first_response_at:
                first_response_given += 1
                hours = _hours(ticket.create_date, ticket.liwan_first_response_at)
                response_hours.append(hours)
                bucket['first_response_hours'].append(hours)
            if any(row.sla_id.active and (row.state == 'expired' or (
                    row.state == 'in_progress' and row.deadline and row.deadline < now))
                   for row in ticket.ticket_sla_ids):
                bucket['overdue'] += 1
                late += 1
            elif any(row.sla_id.active and row.state == 'accomplished' for row in ticket.ticket_sla_ids):
                met += 1
        with_sla = met + late
        measured = len(tickets)
        return {
            'period': period,
            'periods': [{'value': value, 'label': label} for value, label in PERIODS],
            'total': measured,
            'open': open_count,
            'closed': closed_count,
            'kpis': {
                'first_response_hours': _average(response_hours),
                'first_response_target': settings.first_response_hours or None,
                'first_response_answered': first_response_given,
                'resolution_hours': _average(resolution_hours),
                'resolution_target': settings.resolution_hours or None,
                'sla_met': met,
                'sla_late': late,
                'sla_compliance_percent': _percent(met, with_sla),
                'open_percent': _percent(open_count, measured),
            },
            'agents': sorted(
                ({
                    'name': name, 'open': bucket['open'], 'closed': bucket['closed'], 'overdue': bucket['overdue'],
                    'first_response_hours': _average(bucket['first_response_hours']),
                } for name, bucket in agents.items()),
                key=lambda row: (-row['open'], -row['closed'], row['name']),
            )[:MAX_AGENTS],
            'stages': [{'name': name, 'count': count}
                       for name, count in sorted(stages.items(), key=lambda item: (-item[1], item[0]))],
        }
