# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/inbox automation: working hours, the channels' automatic messages and survey, and the rules."""
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    get_record,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.controllers.automation_parsing import (
    parse_automation,
    parse_rule,
    parse_test,
    parse_working_hours,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    get_channel,
    no_content,
    reject,
)
from odoo.addons.webvue_inbox.controllers.reply_parsing import parse_object
from odoo.addons.webvue_inbox.models.access_service import MANAGE_AUTOMATION
from odoo.addons.webvue_inbox.models.constants import AUTOMATION_FEATURE
from odoo.addons.webvue_inbox.serializers.automation import (
    dump_channel_automation,
    dump_rule,
)
from odoo.addons.webvue_inbox.serializers.conversation import dump_ref

HOURS = '/api/v1/inbox/working-hours'
SEQUENCE_STEP = 10


def hours_service():
    return request.env['webvue.inbox.working.hours']


def find_rule(rule_id):
    return get_record('webvue.inbox.rule', rule_id)


def rule_scope():
    """Rules including the switched-off ones: the settings list shows them all."""
    return request.env['webvue.inbox.rule'].with_context(active_test=False)


class AutomationController(http.Controller):

    # working hours

    @http.route(HOURS, type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def get_working_hours(self, **_):
        return hours_service()._webvue_dump(request.env['webvue.inbox.settings']._get_for_company().calendar_id)

    @http.route(HOURS, type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def put_working_hours(self, **payload):
        data = parse_working_hours(payload, 'body')
        settings = request.env['webvue.inbox.settings']._get_for_company()
        calendar = hours_service()._webvue_write(settings, request.env._('Inbox working hours of %s', settings.company_id.name), data)
        return hours_service()._webvue_dump(calendar)

    @http.route('/api/v1/inbox/departments/<int:department_id>/working-hours', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def get_department_hours(self, department_id, **_):
        calendar = get_record('webvue.inbox.department', department_id).calendar_id
        return {'working_hours': hours_service()._webvue_dump(calendar) if calendar else None}

    @http.route('/api/v1/inbox/departments/<int:department_id>/working-hours', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def put_department_hours(self, department_id, **payload):
        department = get_record('webvue.inbox.department', department_id)
        parse_object(payload, 'body', {'working_hours'}, ('working_hours',))
        if payload['working_hours'] is None:
            hours_service()._webvue_clear(department)
            return {'working_hours': None}
        data = parse_working_hours(payload['working_hours'])
        calendar = hours_service()._webvue_write(department, request.env._('Inbox working hours of %s', department.name), data)
        return {'working_hours': hours_service()._webvue_dump(calendar)}

    # channel automation

    @http.route('/api/v1/inbox/automation/channels', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def list_automation_channels(self, **_):
        """The channels the caller automates, as plain references (the channel list itself needs the channels capability)."""
        limit, offset = parse_page(request.httprequest.args)
        companies = request.env['webvue.access.service']._webvue_capability_company_ids((MANAGE_AUTOMATION,))
        domain = [('owner_company_id', 'in', companies)]
        Channel = request.env['webvue.inbox.channel']
        return {
            'items': [dump_ref(channel) for channel in Channel.search(domain, limit=limit, offset=offset)],
            'total': Channel.search_count(domain),
        }

    @http.route('/api/v1/inbox/channels/<int:channel_id>/automation', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def get_channel_automation(self, channel_id, **_):
        return dump_channel_automation(get_channel(channel_id, MANAGE_AUTOMATION))

    @http.route('/api/v1/inbox/channels/<int:channel_id>/automation', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def patch_channel_automation(self, channel_id, **payload):
        channel = get_channel(channel_id, MANAGE_AUTOMATION)
        parsed = parse_automation(channel, payload)
        channel.write(parsed.values)
        for purpose, content in parsed.contents.items():
            channel._webvue_set_auto_message(purpose, content)
        return dump_channel_automation(channel)

    # rules

    @http.route('/api/v1/inbox/rules', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def list_rules(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Rule = rule_scope()
        return {'items': [dump_rule(rule) for rule in Rule.search([], limit=limit, offset=offset)], 'total': Rule.search_count([])}

    @http.route('/api/v1/inbox/rules', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def create_rule(self, **payload):
        parsed = parse_rule(payload)
        Rule = rule_scope()
        last = Rule.search([], order='sequence desc, id desc', limit=1)
        channel = request.env['webvue.inbox.channel'].browse(parsed.values['channel_id'])
        company = channel.owner_company_id or request.env.company
        rule = Rule.with_company(company).create({
            **parsed.values, 'company_id': company.id, 'sequence': last.sequence + SEQUENCE_STEP,
        })
        rule._webvue_set_reply(parsed.reply)
        return request.make_json_response(dump_rule(rule), status=201)

    @http.route('/api/v1/inbox/rules/<int:rule_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def get_rule(self, rule_id, **_):
        return dump_rule(find_rule(rule_id))

    @http.route('/api/v1/inbox/rules/<int:rule_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def patch_rule(self, rule_id, **payload):
        rule = find_rule(rule_id)
        parsed = parse_rule(payload, rule)
        channel = request.env['webvue.inbox.channel'].browse(parsed.values.get('channel_id'))
        if channel and channel.owner_company_id != rule.company_id:
            reject('channel_id names a channel of another company', 'channel_id')
        rule.write(parsed.values)
        if parsed.set_reply:
            rule._webvue_set_reply(parsed.reply)
        return dump_rule(rule)

    @http.route('/api/v1/inbox/rules/<int:rule_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def delete_rule(self, rule_id, **_):
        find_rule(rule_id).unlink()
        return no_content()

    @http.route('/api/v1/inbox/rules/reorder', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def reorder_rules(self, **payload):
        """Evaluation order: `ids` lists every rule of the company, first to last; answers the rules in the new order."""
        check_fields(payload, {'ids'}, required=('ids',))
        if not isinstance(payload['ids'], list):
            reject('ids must be a list of ids', 'ids')
        ids = [parse_positive_int(rule_id, 'ids') for rule_id in payload['ids']]
        Rule = rule_scope()
        rules = Rule.search([])
        if sorted(ids) != sorted(rules.ids):
            reject('ids must list every rule exactly once', 'ids')
        for position, rule in enumerate(Rule.browse(ids), start=1):
            rule.sequence = position * SEQUENCE_STEP
        return {'items': [dump_rule(rule) for rule in Rule.search([])], 'total': len(rules)}

    @http.route('/api/v1/inbox/rules/test', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def test_rules(self, **payload):
        """Dry run: the rules and the automatic message a customer message would trigger. Nothing is written or sent."""
        channel, text, option_id, at = parse_test(payload)
        inside, greeting, rules = request.env['webvue.inbox.automation']._webvue_dry_run(channel, text, option_id, at)
        return {'inside_hours': inside, 'auto_message': greeting, 'rules': [dump_ref(rule) for rule in rules]}
