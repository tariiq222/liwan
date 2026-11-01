# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.models.insurance_settings import (
    DEFAULT_ALERT_DAYS,
    DEFAULT_REQUIRE_DEPENDENT_ID,
    DEFAULT_VISIBILITY,
    INSURANCE_VISIBILITY,
    MAX_ALERT_DAYS,
)
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown


def dump_settings(row):
    return {
        'insurance_visibility': row.insurance_visibility if row else DEFAULT_VISIBILITY,
        'insurance_expiry_alert_days': row.insurance_expiry_alert_days if row else DEFAULT_ALERT_DAYS,
        'insurance_require_dependent_id': row.insurance_require_dependent_id if row else DEFAULT_REQUIRE_DEPENDENT_ID,
        'revision': row.revision if row else 0,
    }


def parse_settings(payload):
    """The full policy plus the revision it was read at; a missing or unknown choice is a 422."""
    reject_unknown(payload, (
        'insurance_visibility', 'insurance_expiry_alert_days', 'insurance_require_dependent_id', 'revision',
    ))
    if payload.get('insurance_visibility') not in INSURANCE_VISIBILITY:
        raise ApiError(422, 'invalid', f"choose one of {', '.join(INSURANCE_VISIBILITY)}", field='insurance_visibility')
    days = payload.get('insurance_expiry_alert_days')
    if type(days) is not int or not 1 <= days <= MAX_ALERT_DAYS:
        raise ApiError(
            422, 'invalid', f'the alert window is 1 to {MAX_ALERT_DAYS} days', field='insurance_expiry_alert_days',
        )
    if type(payload.get('insurance_require_dependent_id')) is not bool:
        raise ApiError(422, 'invalid', 'choose true or false', field='insurance_require_dependent_id')
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    return {
        'insurance_visibility': payload['insurance_visibility'],
        'insurance_expiry_alert_days': days,
        'insurance_require_dependent_id': payload['insurance_require_dependent_id'],
    }, revision
