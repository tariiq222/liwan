# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    find_ids,
    holds,
    no_content,
    parse_ids,
    parse_text,
    reject,
    unique_as_invalid,
)
from odoo.addons.webvue_inbox.models.access_service import (
    CAMPAIGNS,
    MANAGE_AUTOMATION,
    MANAGE_FLOWS,
    MANAGE_SETTINGS,
    READ,
)
from odoo.addons.webvue_inbox.models.constants import FLOWS_FEATURE
from odoo.addons.webvue_inbox.models.presets import PRESETS
from odoo.addons.webvue_inbox.models.settings import (
    ASSIGNMENT_POLICIES,
    MAX_ALERT_MINUTES,
    MAX_AUTO_CLOSE_HOURS,
    MAX_RETENTION_MONTHS,
    VISIBILITY_POLICIES,
)
from odoo.addons.webvue_inbox.serializers.settings import (
    dump_canned_reply,
    dump_department,
    dump_settings,
    dump_tag,
)

SETTINGS_FIELDS = {
    'visibility_policy', 'auto_close_hours', 'retention_months', 'assignment_policy', 'first_response_alert_minutes',
}


def list_page(model, dump):
    limit, offset = parse_page(request.httprequest.args)
    Model = request.env[model]
    return {'items': [dump(r) for r in Model.search([], limit=limit, offset=offset)], 'total': Model.search_count([])}


def parse_settings(payload):
    check_fields(payload, SETTINGS_FIELDS)
    values = dict(payload)
    policy = values.get('visibility_policy')
    if 'visibility_policy' in values and policy not in dict(VISIBILITY_POLICIES):
        reject(f'visibility_policy must be one of {[key for key, _ in VISIBILITY_POLICIES]}', 'visibility_policy')
    if 'assignment_policy' in values and values['assignment_policy'] not in dict(ASSIGNMENT_POLICIES):
        reject(f'assignment_policy must be one of {[key for key, _ in ASSIGNMENT_POLICIES]}', 'assignment_policy')
    for key, low, high in (
        ('auto_close_hours', 0, MAX_AUTO_CLOSE_HOURS), ('retention_months', 1, MAX_RETENTION_MONTHS),
        ('first_response_alert_minutes', 0, MAX_ALERT_MINUTES),
    ):
        if key in values and not (
            isinstance(values[key], int) and not isinstance(values[key], bool) and low <= values[key] <= high
        ):
            reject(f'{key} must be an integer between {low} and {high}', key)
    return values


def parse_department(payload, partial=False):
    check_fields(payload, {'name', 'member_ids'}, required=() if partial else ('name', 'member_ids'))
    values = {}
    if 'name' in payload:
        values['name'] = parse_text(payload, 'name', 128)
    if 'member_ids' in payload:
        members = find_ids('res.users', parse_ids(payload['member_ids'], 'member_ids'), 'member_ids')
        if not all(members.mapped('active')):
            reject('member_ids must name active users', 'member_ids')
        values['member_ids'] = [(6, 0, members.ids)]
    return values


class SettingsController(http.Controller):

    @http.route('/api/v1/settings/inbox', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(MANAGE_SETTINGS)
    def get_settings(self, **_):
        return dump_settings(request.env['webvue.inbox.settings']._get_for_company())

    @http.route('/api/v1/settings/inbox', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def patch_settings(self, **payload):
        settings = request.env['webvue.inbox.settings']._get_for_company()
        settings.write(parse_settings(payload))
        return dump_settings(settings)

    @http.route('/api/v1/settings/inbox/presets/<string:key>', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def apply_preset(self, key, **_):
        if key not in PRESETS:
            raise ApiError(404, 'not_found', 'preset does not exist')
        settings = request.env['webvue.inbox.settings']._get_for_company()
        automation = holds(MANAGE_AUTOMATION, request.env.company)
        flows = holds(MANAGE_FLOWS, request.env.company) and request.env['webvue.entitlement.service']._webvue_feature_write(FLOWS_FEATURE)
        return dump_settings(settings._webvue_apply_preset(key, automation=automation, flows=flows))

    # departments

    @http.route('/api/v1/inbox/departments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ, MANAGE_SETTINGS, MANAGE_AUTOMATION, match='any')
    def list_departments(self, **_):
        return list_page('webvue.inbox.department', dump_department)

    @http.route('/api/v1/inbox/departments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def create_department(self, **payload):
        values = parse_department(payload)
        with unique_as_invalid('name', 'a department with this name exists'):
            department = request.env['webvue.inbox.department'].create(values)
        return dump_department(department)

    @http.route('/api/v1/inbox/departments/<int:department_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def patch_department(self, department_id, **payload):
        department = get_record('webvue.inbox.department', department_id)
        values = parse_department(payload, partial=True)
        with unique_as_invalid('name', 'a department with this name exists'):
            department.write(values)
        return dump_department(department)

    @http.route('/api/v1/inbox/departments/<int:department_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def delete_department(self, department_id, **_):
        get_record('webvue.inbox.department', department_id).unlink()
        return no_content()

    # tags

    @http.route('/api/v1/inbox/tags', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ, MANAGE_SETTINGS, MANAGE_AUTOMATION, CAMPAIGNS, match='any')
    def list_tags(self, **_):
        return list_page('webvue.inbox.tag', dump_tag)

    @http.route('/api/v1/inbox/tags', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def create_tag(self, **payload):
        check_fields(payload, {'name'}, required=('name',))
        with unique_as_invalid('name', 'a tag with this name exists'):
            tag = request.env['webvue.inbox.tag'].create({'name': parse_text(payload, 'name', 64)})
        return dump_tag(tag)

    @http.route('/api/v1/inbox/tags/<int:tag_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def patch_tag(self, tag_id, **payload):
        tag = get_record('webvue.inbox.tag', tag_id)
        check_fields(payload, {'name'}, required=('name',))
        with unique_as_invalid('name', 'a tag with this name exists'):
            tag.write({'name': parse_text(payload, 'name', 64)})
        return dump_tag(tag)

    @http.route('/api/v1/inbox/tags/<int:tag_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def delete_tag(self, tag_id, **_):
        get_record('webvue.inbox.tag', tag_id).unlink()
        return no_content()

    # canned replies (the read side is in conversations.py)

    @http.route('/api/v1/inbox/canned-replies', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def create_canned_reply(self, **payload):
        values = self._parse_canned(payload, required=True)
        with unique_as_invalid('shortcut', 'a canned reply with this shortcut exists'):
            reply = request.env['webvue.inbox.canned.reply'].create(values)
        return dump_canned_reply(reply)

    @http.route('/api/v1/inbox/canned-replies/<int:reply_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def patch_canned_reply(self, reply_id, **payload):
        reply = get_record('webvue.inbox.canned.reply', reply_id)
        values = self._parse_canned(payload, required=False)
        with unique_as_invalid('shortcut', 'a canned reply with this shortcut exists'):
            reply.write(values)
        return dump_canned_reply(reply)

    @http.route('/api/v1/inbox/canned-replies/<int:reply_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(MANAGE_SETTINGS)
    def delete_canned_reply(self, reply_id, **_):
        get_record('webvue.inbox.canned.reply', reply_id).unlink()
        return no_content()

    @staticmethod
    def _parse_canned(payload, required):
        check_fields(payload, {'shortcut', 'body'}, required=('shortcut', 'body') if required else ())
        limits = {'shortcut': 32, 'body': 4096}
        return {key: parse_text(payload, key, limits[key]) for key in payload}
