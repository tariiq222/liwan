# Part of Odoo. See LICENSE file for full copyright and licensing details.
from pytz import UTC, timezone

from odoo import fields

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int


def dump_settings(row, company, user):
    company_timezone = company.resource_calendar_id.tz or 'UTC'
    reference = row.day_reference if row else 'company'
    effective_timezone = (user.tz or company_timezone) if reference == 'user' else company_timezone
    today = UTC.localize(fields.Datetime.now()).astimezone(timezone(effective_timezone)).date()
    return {
        'day_reference': reference,
        'company_timezone': company_timezone,
        'effective_timezone': effective_timezone,
        'today': today.isoformat(),
        'default_schedule': (
            {'id': company.resource_calendar_id.id, 'name': company.resource_calendar_id.name}
            if company.resource_calendar_id else None
        ),
        'revision': row.revision if row else 0,
    }


def parse_settings(payload):
    unknown = sorted(set(payload) - {'day_reference', 'revision', 'default_schedule_id'})
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    if payload.get('day_reference') not in ('company', 'user'):
        raise ApiError(422, 'invalid', 'choose company or user timezone', field='day_reference')
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    vals = {'day_reference': payload['day_reference'], 'revision': revision}
    if 'default_schedule_id' in payload:
        vals['default_schedule_id'] = parse_positive_int(payload['default_schedule_id'], 'default_schedule_id')
    return vals
