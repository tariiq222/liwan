# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_hr.serializers.assets.common import ref, reject_unknown
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date
from odoo.addons.liwan_hr.serializers.insurance.common import (
    ApiError,
    money,
    optional_text,
    parse_revision,
    parse_state_filter,
    required_date,
)
from odoo.addons.liwan_hr.serializers.insurance.dependent import dump_dependent
from odoo.addons.liwan_hr.serializers.insurance.plan import dump_plan, ref_plan

STATES = ('active', 'lapsed', 'ended', 'cancelled')


def _core(row):
    return {
        'id': row.id,
        'employee': ref(row.employee_id),
        'member_number': row.member_number or None,
        'date_from': row.date_from.isoformat(),
        'date_to': row.date_to.isoformat() if row.date_to else None,
        'date_end': row.date_end_effective.isoformat(),
        'state': row.state_effective,
        'employee_share': row.employee_share or None,
        'company_share': row.company_share or None,
        'revision': row.revision,
    }


def dump_enrollment(row, detail=False, full=False):
    """An enrollment for the insurance readers; the detail adds the notes and the dependents.

    The dependents' identity numbers come whole only with ``full`` (the caller manages insurance).
    """
    data = {
        **_core(row),
        'plan': dump_plan(row.plan_id) if detail else ref_plan(row.plan_id),
        'dependents_count': len(row._liwan_active_dependents()),
    }
    if detail:
        data['notes'] = row.notes or None
        data['dependents'] = [dump_dependent(item, full=full) for item in row.dependent_ids]
    return data


def dump_own_enrollment(row, show_dependents):
    """The employee's own enrollment: no notes, and the dependents only when the company's policy shows them."""
    return {
        **_core(row),
        'plan': ref_plan(row.plan_id),
        'dependents_visible': show_dependents,
        'dependents': [dump_dependent(item) for item in row.dependent_ids] if show_dependents else [],
    }


def parse_enrollment_create(payload):
    reject_unknown(payload, (
        'employee_id', 'plan_id', 'member_number', 'date_from', 'date_to', 'employee_share', 'company_share', 'notes',
    ))
    return {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'plan_id': parse_positive_int(payload.get('plan_id'), 'plan_id'),
        'member_number': optional_text(payload, 'member_number', 40),
        'date_from': required_date(payload, 'date_from'),
        'date_to': parse_optional_date(payload.get('date_to'), 'date_to') or False,
        'employee_share': money(payload, 'employee_share'),
        'company_share': money(payload, 'company_share'),
        'notes': optional_text(payload, 'notes', 2000),
    }


def parse_enrollment_patch(payload):
    reject_unknown(payload, ('employee_share', 'company_share', 'notes', 'revision'))
    revision = parse_revision(payload)
    vals = {}
    for field in ('employee_share', 'company_share'):
        if field in payload:
            vals[field] = money(payload, field)
    if 'notes' in payload:
        vals['notes'] = optional_text(payload, 'notes', 2000)
    if not vals:
        raise ApiError(422, 'invalid', 'send at least one field to change', field='notes')
    return revision, vals


def parse_enrollment_state(value):
    return parse_state_filter(value, STATES)
