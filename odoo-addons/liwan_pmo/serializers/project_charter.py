# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.http import request

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_pmo.models.project_project import (
    BUDGET_STATES,
    DELIVERABLE_KEYS,
    OBJECTIVE_KEYS,
    PRIORITY_VALUES,
)

CHARTER_WRITE_FIELDS = {
    'type_id', 'owning_unit_id', 'sponsor_id', 'authority', 'rationale',
    'objectives', 'benefits', 'scope', 'exclusions', 'high_level_requirements',
    'deliverables', 'success', 'budget_state', 'amount', 'priority',
    'assumptions', 'constraints', 'closure',
}
CHARTER_READONLY_FIELDS = {'code', 'type', 'owning_unit', 'sponsor', 'currency', 'state'}
TEXT_TO_ORM = {
    'authority': 'liwan_authority',
    'rationale': 'liwan_rationale',
    'benefits': 'liwan_benefits',
    'scope': 'liwan_scope',
    'exclusions': 'liwan_exclusions',
    'high_level_requirements': 'liwan_high_level_requirements',
    'success': 'liwan_success',
    'assumptions': 'liwan_assumptions',
    'constraints': 'liwan_constraints',
    'closure': 'liwan_closure',
}


def dump_currency(currency):
    if not currency:
        return None
    return {
        'id': currency.id,
        'name': currency.name,
        'symbol': currency.symbol,
        'decimal_places': currency.decimal_places,
    }


def dump_catalog_ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_type_ref(record):
    # The charter wizard derives its steps from the project type, so the type
    # reference carries them alongside the plain catalog identity.
    if not record:
        return None
    return {'id': record.id, 'name': record.name, 'charter_steps': record._liwan_charter_steps()}


def dump_user_ref(user):
    return {'id': user.id, 'name': user.name} if user else None


def dump_charter(project):
    amount = None if project.liwan_budget_state == 'unknown' else project.liwan_budget_amount
    return {
        'code': project.liwan_code or None,
        'type': dump_type_ref(project.liwan_type_id),
        'owning_unit': dump_catalog_ref(project.liwan_owning_unit_id),
        'sponsor': dump_user_ref(project.liwan_sponsor_id),
        'authority': project.liwan_authority or '',
        'rationale': project.liwan_rationale or '',
        'objectives': list(project.liwan_objectives or []),
        'benefits': project.liwan_benefits or '',
        'scope': project.liwan_scope or '',
        'exclusions': project.liwan_exclusions or '',
        'high_level_requirements': project.liwan_high_level_requirements or '',
        'deliverables': list(project.liwan_deliverables or []),
        'success': project.liwan_success or '',
        'budget_state': project.liwan_budget_state or 'unknown',
        'amount': amount,
        'currency': dump_currency(project.currency_id),
        'priority': project.liwan_priority or None,
        'assumptions': project.liwan_assumptions or '',
        'constraints': project.liwan_constraints or '',
        'closure': project.liwan_closure or '',
        'state': project.liwan_charter_state or 'draft',
        'approval_required': project._liwan_charter_approval_required(),
        'can_review': project._liwan_can_review_charter(),
        'submitted_by': dump_user_ref(project.liwan_charter_submitted_by_id),
        'submitted_at': iso(project.liwan_charter_submitted_at) if project.liwan_charter_submitted_at else None,
        'approved_by': dump_user_ref(project.liwan_charter_approved_by_id),
        'approved_at': iso(project.liwan_charter_approved_at) if project.liwan_charter_approved_at else None,
        'return_note': project.liwan_charter_return_note or '',
    }


def parse_charter_vals(payload, project=None):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "charter must be an object", field='charter')
    unknown = set(payload) - CHARTER_WRITE_FIELDS
    readonly = unknown & CHARTER_READONLY_FIELDS
    if readonly:
        field = sorted(readonly)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    vals = {}
    for key, value in payload.items():
        if key in TEXT_TO_ORM:
            if not isinstance(value, str):
                raise ApiError(422, 'invalid', f"{key} must be a string", field=key)
            vals[TEXT_TO_ORM[key]] = value
        elif key == 'objectives':
            vals['liwan_objectives'] = _parse_rows(value, 'objectives', OBJECTIVE_KEYS)
        elif key == 'deliverables':
            vals['liwan_deliverables'] = _parse_rows(value, 'deliverables', DELIVERABLE_KEYS)
        elif key == 'type_id':
            vals['liwan_type_id'] = _parse_catalog_id(
                value, 'liwan.project.type', 'type_id',
                current_id=project.liwan_type_id.id if project and project.liwan_type_id else None,
                project=project,
            )
        elif key == 'owning_unit_id':
            vals['liwan_owning_unit_id'] = _parse_catalog_id(
                value, 'liwan.project.owning.unit', 'owning_unit_id',
                current_id=project.liwan_owning_unit_id.id if project and project.liwan_owning_unit_id else None,
                project=project,
            )
        elif key == 'sponsor_id':
            vals['liwan_sponsor_id'] = _parse_sponsor_id(
                value,
                current_id=project.liwan_sponsor_id.id if project and project.liwan_sponsor_id else None,
            )
        elif key == 'priority':
            if value is None:
                vals['liwan_priority'] = False
            elif value not in PRIORITY_VALUES:
                raise ApiError(422, 'invalid', "priority is not a valid value", field='priority')
            else:
                vals['liwan_priority'] = value
        elif key == 'budget_state':
            if value not in BUDGET_STATES:
                raise ApiError(422, 'invalid', "budget_state must be 'unknown' or 'estimate'", field='budget_state')
            vals['liwan_budget_state'] = value
        elif key == 'amount':
            vals['liwan_budget_amount'] = _parse_amount(value)
    return _apply_budget_policy(vals, project)


def _parse_rows(value, field, keys):
    if not isinstance(value, list):
        raise ApiError(422, 'invalid', f"{field} must be a list", field=field)
    expected = set(keys)
    rows = []
    for row in value:
        if not isinstance(row, dict) or set(row) != expected:
            raise ApiError(422, 'invalid', f"{field} rows must use exactly {list(keys)}", field=field)
        if any(not isinstance(row[key], str) for key in keys):
            raise ApiError(422, 'invalid', f"{field} values must be strings", field=field)
        if not any(row[key].strip() for key in keys):
            raise ApiError(422, 'invalid', f"{field} rows must include a non-blank value", field=field)
        rows.append({key: row[key] for key in keys})
    return rows


def _parse_positive_id(value, field):
    if value is None:
        return False
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ApiError(422, 'invalid', f"{field} must be a positive integer or null", field=field)
    return value


def _parse_catalog_id(value, model, field, current_id=None, project=None):
    record_id = _parse_positive_id(value, field)
    if not record_id:
        return False
    if project is not None and not project.company_id:
        raise ApiError(422, 'invalid', f"{field} cannot be set on a company-less project", field=field)
    # Keep an already-assigned ref (including inactive) without browsing
    # foreign-company ids, which ir.rule would turn into a 403 leak.
    if record_id == current_id:
        return record_id
    record = request.env[model].with_context(active_test=False).search([
        ('id', '=', record_id),
        ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not record:
        raise ApiError(422, 'invalid', f"{field} must be an active catalog value in the current company", field=field)
    if project is not None and project.company_id and record.company_id != project.company_id:
        raise ApiError(422, 'invalid', f"{field} must belong to the project company", field=field)
    if not record.active:
        raise ApiError(422, 'invalid', f"{field} must be an active catalog value in the current company", field=field)
    return record.id


def _parse_sponsor_id(value, current_id=None):
    user_id = _parse_positive_id(value, 'sponsor_id')
    if not user_id:
        return False
    user = request.env['res.users'].with_context(active_test=False).browse(user_id).exists()
    Project = request.env['project.project']
    if not Project._liwan_eligible_user(user, current_id=current_id):
        raise ApiError(422, 'invalid', "sponsor_id must be an active internal user in the current company", field='sponsor_id')
    return user.id


def _parse_amount(value):
    if isinstance(value, bool | str):
        raise ApiError(422, 'invalid', "amount must be a finite non-negative number", field='amount')
    if value is None:
        return None
    if not isinstance(value, int | float) or not math.isfinite(value) or value < 0:
        raise ApiError(422, 'invalid', "amount must be a finite non-negative number", field='amount')
    return value


def _apply_budget_policy(vals, project):
    state = vals.get('liwan_budget_state')
    amount_set = 'liwan_budget_amount' in vals
    amount = vals.get('liwan_budget_amount')
    current_state = project.liwan_budget_state if project else 'unknown'
    if state == 'unknown':
        if amount_set and amount not in (None, 0, 0.0):
            raise ApiError(422, 'invalid', "unknown budget cannot include an amount", field='amount')
        vals['liwan_budget_amount'] = 0.0
        return vals
    if state == 'estimate':
        if not amount_set or amount is None:
            raise ApiError(422, 'invalid', "estimate budget requires a non-negative amount", field='amount')
        return vals
    if amount_set:
        if current_state == 'unknown':
            raise ApiError(422, 'invalid', "changing an unknown budget requires budget_state", field='budget_state')
        if amount is None:
            raise ApiError(422, 'invalid', "estimate budget requires a non-negative amount", field='amount')
    return vals
