# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/helpdesk``: the settings surface, the reference lists the screens pick from, and the counters."""
from odoo import http
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_helpdesk.models.helpdesk_settings import (
    INTEGER_RANGES,
    PRESET_VALUES,
    PRESETS,
    PRIORITIES,
    VISIBILITY,
)
from odoo.addons.liwan_helpdesk.serializers.ticket import PRIORITIES as PRIORITY_NAMES

SETTINGS_WRITE_FIELDS = frozenset({
    'revision', 'preset', 'visibility', 'default_team_id', 'default_priority', 'reference_prefix',
    'reopen_days', 'first_response_hours', 'resolution_hours', 'portal_enabled', 'auto_close_days',
    'auto_close_stage_ids',
})


def named(records):
    return [{'id': record.id, 'name': record.name} for record in records]


def settings_model():
    return request.env['liwan.helpdesk.settings']


def dump_settings(row):
    return {
        'revision': row.revision,
        'preset': row.preset,
        'visibility': row.visibility,
        'default_team_id': row.default_team_id.id or None,
        'default_priority': row.default_priority,
        'reference_prefix': row.reference_prefix,
        'reopen_days': row.reopen_days,
        'first_response_hours': row.first_response_hours,
        'resolution_hours': row.resolution_hours,
        'portal_enabled': row.portal_enabled,
        'auto_close_days': row.auto_close_days,
        'auto_close_stage_ids': row.auto_close_stage_ids.ids,
        'options': {
            'presets': [{'value': key, 'label': label} for key, label in PRESETS],
            'visibility': [{'value': key, 'label': label} for key, label in VISIBILITY],
            'priorities': [{'value': key, 'label': label} for key, label in PRIORITIES],
            'priority_names': PRIORITY_NAMES,
            'ranges': {name: list(bounds) for name, bounds in INTEGER_RANGES.items()},
        },
    }


def parse_settings(payload):
    extra = set(payload) - SETTINGS_WRITE_FIELDS
    if extra:
        raise ApiError(422, 'invalid', 'field %r is not writable' % sorted(extra)[0], field=sorted(extra)[0])
    values = dict(payload)
    revision = values.pop('revision', None)
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'must be a revision number', field='revision')
    preset = values.get('preset')
    if preset is not None:
        if preset not in dict(PRESETS):
            raise ApiError(422, 'invalid', 'unknown preset', field='preset')
        for key, value in PRESET_VALUES[preset].items():
            values.setdefault(key, value)
    if 'visibility' in values and values['visibility'] not in dict(VISIBILITY):
        raise ApiError(422, 'invalid', 'unknown visibility policy', field='visibility')
    if 'default_priority' in values and values['default_priority'] not in dict(PRIORITIES):
        raise ApiError(422, 'invalid', 'unknown priority', field='default_priority')
    for name, (low, high) in INTEGER_RANGES.items():
        if name not in values:
            continue
        value = values[name]
        if type(value) is not int or not low <= value <= high:
            raise ApiError(422, 'invalid', 'must be between %d and %d' % (low, high), field=name)
    if 'reference_prefix' in values:
        prefix = values['reference_prefix']
        if not isinstance(prefix, str) or not prefix.strip() or len(prefix.strip()) > 10:
            raise ApiError(422, 'invalid', 'must be 1 to 10 characters', field='reference_prefix')
        values['reference_prefix'] = prefix.strip()
    for key in ('portal_enabled',):
        if key in values and values[key] not in (True, False):
            raise ApiError(422, 'invalid', 'must be true or false', field=key)
    if 'auto_close_stage_ids' in values:
        ids = values['auto_close_stage_ids']
        if not isinstance(ids, list) or any(type(item) is not int or item <= 0 for item in ids):
            raise ApiError(422, 'invalid', 'must be a list of stage ids', field='auto_close_stage_ids')
        stages = request.env['helpdesk.ticket.stage'].search([
            ('id', 'in', ids), ('company_id', 'in', [False, request.env.company.id]),
        ])
        if len(stages) != len(set(ids)):
            raise ApiError(422, 'invalid', 'a stage does not exist', field='auto_close_stage_ids')
        values['auto_close_stage_ids'] = [(6, 0, stages.ids)]
    if 'default_team_id' in values:
        values['default_team_id'] = parse_positive_int(values['default_team_id'], 'default_team_id') \
            if values['default_team_id'] else None
    return revision, values


class HelpdeskSettingsController(http.Controller):

    @http.route('/api/v1/helpdesk/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability('helpdesk.settings.read')
    def get_settings(self, **_):
        return dump_settings(settings_model()._liwan_for(request.env.company))

    @http.route('/api/v1/helpdesk/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled')
    @requires_capability('helpdesk.settings.manage')
    def patch_settings(self, **_):
        payload = request.get_json_data()
        revision, values = parse_settings(payload)
        row = settings_model()._liwan_current()
        current = row.revision if row else 0
        if revision != current:
            raise ApiError(409, 'conflict', 'the Support Desk settings changed; reload before saving')
        if not row:
            row = settings_model().create({'company_id': request.env.company.id, **values})
            return dump_settings(row)
        if not values:
            return dump_settings(row)
        row.write({**values, 'revision': current + 1})
        return dump_settings(row)

    @http.route('/api/v1/helpdesk/reference', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability('helpdesk.tickets.read', 'helpdesk.requests.read', match='any')
    def reference(self, **_):
        company = request.env.company
        shared = ['|', ('company_id', '=', False), ('company_id', '=', company.id)]
        teams = request.env['helpdesk.ticket.team'].search([('company_id', '=', company.id)],
                                                           order='sequence, name, id')
        stages = request.env['helpdesk.ticket.stage'].search(shared, order='sequence, name, id')
        return {
            'teams': named(teams),
            'stages': [
                {'id': stage.id, 'name': stage.name, 'closed': bool(stage.closed)} for stage in stages
            ],
            'categories': named(request.env['helpdesk.ticket.category'].search(shared, order='name, id')),
            'types': named(request.env['helpdesk.ticket.type'].search([], order='name, id')),
            'channels': named(request.env['helpdesk.ticket.channel'].search(shared, order='name, id')),
            'tags': named(request.env['helpdesk.ticket.tag'].search(shared, order='name, id')),
        }

    @http.route('/api/v1/helpdesk/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', operation='read')
    @requires_capability('helpdesk.tickets.read', 'helpdesk.requests.read', match='any')
    def summary(self, **_):
        visible = request.env['liwan.helpdesk.visibility']._liwan_domain()
        model = request.env['helpdesk.ticket']
        open_domain = visible & Domain('stage_id.closed', '=', False)
        return {
            'open': model.search_count(open_domain),
            'unassigned': model.search_count(open_domain & Domain('user_id', '=', False)),
            'mine': model.search_count(open_domain & Domain('user_id', '=', request.env.user.id)),
            'overdue': model.search_count(open_domain & Domain('sla_expired', '=', True)),
        }
