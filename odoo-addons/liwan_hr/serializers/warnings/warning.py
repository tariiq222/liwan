# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_hr.serializers.assets.common import ref, reject_unknown
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date

STATES = ('draft', 'issued', 'acknowledged', 'contested', 'withdrawn')


def dump_warning(row):
    """The whitelisted shape of one warning; the reason texts leave only through a route that authorized the read."""
    return {
        'id': row.id,
        'employee': ref(row.employee_id),
        'type': {'id': row.type_id.id, 'name': row.type_id.name, 'severity': row.type_id.severity},
        'date_issued': row.date_issued.isoformat(),
        'reason': row.reason,
        'corrective_action': row.corrective_action or None,
        'state': row.state,
        'acknowledgement': row.acknowledgement,
        'ack_pending': row.state == 'issued' and row.acknowledgement == 'required',
        'issued_by': ref(row.issued_by_id),
        'issued_at': iso(row.issued_at),
        'acknowledged_at': iso(row.acknowledged_at),
        'contested_at': iso(row.contested_at),
        'contest_note': row.contest_note or None,
        'withdrawn_by': ref(row.withdrawn_by_id),
        'withdrawn_at': iso(row.withdrawn_at),
        'withdraw_reason': row.withdraw_reason or None,
        'revision': row.revision,
    }


def dump_standing(standing):
    return {
        'employee_id': standing['employee_id'],
        'window_months': standing['window_months'],
        'active_count': standing['active_count'],
        'highest_severity': standing['highest_severity'],
    }


def parse_revision(payload):
    revision = payload.get('revision')
    if type(revision) is not int or revision < 1:
        raise ApiError(422, 'invalid', 'revision must be a positive integer', field='revision')
    return revision


def _required_text(payload, field):
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', f'{field} must not be empty', field=field)
    return value


def parse_create(payload):
    reject_unknown(payload, ('employee_id', 'type_id', 'date_issued', 'reason', 'corrective_action'))
    vals = {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'type_id': parse_positive_int(payload.get('type_id'), 'type_id'),
        'reason': _required_text(payload, 'reason'),
    }
    issued = parse_optional_date(payload.get('date_issued'), 'date_issued')
    if issued:
        vals['date_issued'] = issued
    corrective = payload.get('corrective_action')
    if corrective is not None and not isinstance(corrective, str):
        raise ApiError(422, 'invalid', 'corrective_action must be a string', field='corrective_action')
    vals['corrective_action'] = corrective or ''
    return vals


def parse_revision_only(payload):
    reject_unknown(payload, ('revision',))
    return parse_revision(payload)


def parse_withdraw(payload):
    reject_unknown(payload, ('revision', 'reason'))
    return parse_revision(payload), _required_text(payload, 'reason')


def parse_contest(payload):
    reject_unknown(payload, ('revision', 'note'))
    return parse_revision(payload), _required_text(payload, 'note')


def parse_state_filter(value):
    if value in (None, ''):
        return None
    if value not in STATES:
        raise ApiError(422, 'invalid', f"state must be one of {', '.join(STATES)}", field='state')
    return value
