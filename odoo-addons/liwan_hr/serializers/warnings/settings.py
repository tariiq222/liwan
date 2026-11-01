# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.models.warning_settings import (
    DEFAULT_ACKNOWLEDGEMENT,
    DEFAULT_ISSUED_BY,
    DEFAULT_WINDOW_MONTHS,
    EMPLOYEE_ACKNOWLEDGEMENT,
    MAX_WINDOW_MONTHS,
    WARNINGS_ISSUED_BY,
)
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown


def dump_settings(row):
    return {
        'warnings_issued_by': row.warnings_issued_by if row else DEFAULT_ISSUED_BY,
        'warnings_employee_acknowledgement': (
            row.warnings_employee_acknowledgement if row else DEFAULT_ACKNOWLEDGEMENT
        ),
        'warnings_escalation_window_months': (
            row.warnings_escalation_window_months if row else DEFAULT_WINDOW_MONTHS
        ),
        'revision': row.revision if row else 0,
    }


def parse_settings(payload):
    """The full policy plus the revision it was read at; a missing or unknown choice is a 422."""
    reject_unknown(payload, (
        'warnings_issued_by', 'warnings_employee_acknowledgement', 'warnings_escalation_window_months', 'revision',
    ))
    if payload.get('warnings_issued_by') not in WARNINGS_ISSUED_BY:
        raise ApiError(422, 'invalid', f"choose one of {', '.join(WARNINGS_ISSUED_BY)}", field='warnings_issued_by')
    if payload.get('warnings_employee_acknowledgement') not in EMPLOYEE_ACKNOWLEDGEMENT:
        raise ApiError(
            422, 'invalid', f"choose one of {', '.join(EMPLOYEE_ACKNOWLEDGEMENT)}",
            field='warnings_employee_acknowledgement',
        )
    months = payload.get('warnings_escalation_window_months')
    if type(months) is not int or not 1 <= months <= MAX_WINDOW_MONTHS:
        raise ApiError(
            422, 'invalid', f'the window is 1 to {MAX_WINDOW_MONTHS} months',
            field='warnings_escalation_window_months',
        )
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    return {
        'warnings_issued_by': payload['warnings_issued_by'],
        'warnings_employee_acknowledgement': payload['warnings_employee_acknowledgement'],
        'warnings_escalation_window_months': months,
    }, revision
