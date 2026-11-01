# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_pmo.serializers.project_charter import (
    dump_currency,
    dump_user_ref,
)

CHANGE_WRITE_FIELDS = {
    'title', 'description', 'reason', 'category_id', 'impact_schedule_days', 'impact_cost', 'impact_scope',
}
TEXT_FIELDS = ('description', 'reason', 'impact_scope')


def dump_change(change):
    actions = change._liwan_allowed_actions()
    category = change.category_id
    return {
        'id': change.id,
        'project_id': change.project_id.id,
        'number': change.number,
        'title': change.title,
        'description': change.description or '',
        'reason': change.reason or '',
        'category': {'id': category.id, 'name': category.name} if category else None,
        'state': change.state,
        'requester': dump_user_ref(change.requester_id),
        'impact_schedule_days': change.impact_schedule_days,
        'impact_cost': change.impact_cost,
        'currency': dump_currency(change.currency_id),
        'impact_scope': change.impact_scope or '',
        'decided_by': dump_user_ref(change.decided_by_id),
        'decided_at': iso(change.decided_at),
        'decision_note': change.decision_note or '',
        'implemented_at': iso(change.implemented_at),
        'created_at': iso(change.create_date),
        'updated_at': change._liwan_updated_at(),
        'can_edit': 'edit' in actions,
        'can_submit': 'submit' in actions,
        'can_withdraw': 'withdraw' in actions,
        'can_decide': 'approve' in actions,
        'can_implement': 'implement' in actions,
    }


def parse_change_vals(payload, *, partial):
    """Typed values of a change request body; the model checks the rules that need records."""
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - CHANGE_WRITE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    if not partial and 'title' not in payload:
        raise ApiError(422, 'invalid', "title must not be empty", field='title')
    if partial and not payload:
        raise ApiError(422, 'invalid', "no fields to update")
    vals = {}
    if 'title' in payload:
        title = payload['title']
        if not isinstance(title, str) or not title.strip():
            raise ApiError(422, 'invalid', "title must not be empty", field='title')
        vals['title'] = title.strip()
    for field in TEXT_FIELDS:
        if field in payload:
            if payload[field] is not None and not isinstance(payload[field], str):
                raise ApiError(422, 'invalid', f"{field} must be a string", field=field)
            vals[field] = payload[field] or ''
    if 'category_id' in payload:
        vals['category_id'] = False if payload['category_id'] is None else parse_positive_int(payload['category_id'], 'category_id')
    if 'impact_schedule_days' in payload:
        days = payload['impact_schedule_days']
        if not isinstance(days, int) or isinstance(days, bool):
            raise ApiError(422, 'invalid', "impact_schedule_days must be a whole number", field='impact_schedule_days')
        vals['impact_schedule_days'] = days
    if 'impact_cost' in payload:
        cost = payload['impact_cost']
        if isinstance(cost, bool) or not isinstance(cost, int | float) or not math.isfinite(cost):
            raise ApiError(422, 'invalid', "impact_cost must be a number", field='impact_cost')
        vals['impact_cost'] = cost
    return vals
