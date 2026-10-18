# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict
from datetime import timedelta

from odoo import api, fields, models

SAUDI_COUNTRY_CODE = 'SA'
# Employee-owned expiry sources: (kind, field on the employee's current version).
EMPLOYEE_EXPIRY_FIELDS = (
    ('contract_end', 'contract_date_end'),
    ('probation_end', 'trial_date_end'),
    ('identity', 'identification_expiration_date'),
)


class WebVueHrReport(models.AbstractModel):
    _name = 'webvue.hr.report'
    _description = 'HR Reports'

    @api.model
    def _webvue_expiring(self, within_days, *, documents):
        """Dated items due up to ``within_days`` days ahead, overdue ones first.

        An item already past its date stays listed with a negative ``days_left``.

        Reads run with the caller's access, so the models enforce capability and
        company scope; ``documents`` says whether the caller may read HR documents.
        """
        today = fields.Date.context_today(self)
        limit = today + timedelta(days=within_days)
        items = []
        for employee in self.env['hr.employee'].search([('company_id', '=', self.env.company.id)]):
            for kind, field in EMPLOYEE_EXPIRY_FIELDS:
                due = employee[field]
                if due and due <= limit:
                    items.append({
                        'kind': kind,
                        'employee': {'id': employee.id, 'name': employee.name},
                        'document': None,
                        'due_date': due,
                        'days_left': (due - today).days,
                    })
        if documents:
            for document in self.env['webvue.hr.document'].search([
                ('company_id', '=', self.env.company.id),
                ('expiry_date', '!=', False),
                ('expiry_date', '<=', limit),
            ]):
                items.append({
                    'kind': 'document',
                    'employee': None,
                    'document': {'id': document.id, 'name': document.name},
                    'due_date': document.expiry_date,
                    'days_left': (document.expiry_date - today).days,
                })
        return sorted(items, key=lambda item: (item['due_date'], item['kind']))

    @api.model
    def _webvue_saudization(self):
        """Headcount of active employees by nationality, overall and per department.

        ``saudi_percent`` is computed over employees with a known nationality only:
        ``unknown`` is excluded from its denominator (but counted in ``total``).
        """
        counts = defaultdict(lambda: {'saudi': 0, 'non_saudi': 0, 'unknown': 0})
        departments = {}
        for employee in self.env['hr.employee'].search([('company_id', '=', self.env.company.id)]):
            department = employee.department_id
            departments[department.id] = department
            country = employee.country_id
            bucket = 'unknown' if not country else (
                'saudi' if country.code == SAUDI_COUNTRY_CODE else 'non_saudi'
            )
            counts[department.id][bucket] += 1
        # Departments by name, the employees without one last.
        ordered = sorted(counts, key=lambda dept_id: (not dept_id, departments[dept_id].name or ''))
        rows = [
            {
                'department': {'id': dept_id, 'name': departments[dept_id].name} if dept_id else None,
                **self._webvue_saudization_row(counts[dept_id]),
            }
            for dept_id in ordered
        ]
        overall = {key: sum(c[key] for c in counts.values()) for key in ('saudi', 'non_saudi', 'unknown')}
        return {'overall': self._webvue_saudization_row(overall), 'items': rows, 'total': len(rows)}

    @api.model
    def _webvue_saudization_row(self, counts):
        known = counts['saudi'] + counts['non_saudi']
        return {
            'total': known + counts['unknown'],
            **counts,
            # Share of employees with a known nationality; None when there is none.
            'saudi_percent': round(counts['saudi'] * 100 / known, 2) if known else None,
        }
