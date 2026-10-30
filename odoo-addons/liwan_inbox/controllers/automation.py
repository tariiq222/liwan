# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/inbox automation: working hours, the channels' automatic messages and survey, and the rules."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    get_record,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.controllers.automation_parsing import (
    parse_automation,
    parse_rule,
    parse_test,
    parse_working_hours,
)
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    get_channel,
    no_content,
    reject,
)
from odoo.addons.liwan_inbox.controllers.reply_parsing import parse_object
from odoo.addons.liwan_inbox.models.access_service import CAMPAIGNS, MANAGE_AUTOMATION
from odoo.addons.liwan_inbox.models.constants import (
    AUTOMATION_FEATURE,
    CAMPAIGNS_FEATURE,
)
from odoo.addons.liwan_inbox.serializers.automation import (
    dump_channel_automation,
    dump_rule,
)
from odoo.addons.liwan_inbox.serializers.conversation import dump_ref

HOURS = '/api/v1/inbox/working-hours'
SEQUENCE_STEP = 10


def hours_service():
    return request.env['liwan.inbox.working.hours']


def find_rule(rule_id):
    return get_record('liwan.inbox.rule', rule_id)


def rule_scope():
    """Rules including the switched-off ones: the settings list shows them all."""
    return request.env['liwan.inbox.rule'].with_context(active_test=False)


# The rules page is read whole (the reorder sends every id), so its cap is the reorder's: InboxRuleReorderSchema max.
MAX_RULES = 500


class AutomationController(http.Controller):

    # working hours

    @http.route(HOURS, type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def get_working_hours(self, **_):
        return hours_service()._liwan_dump(request.env['liwan.inbox.settings']._get_for_company())

    @http.route(HOURS, type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def put_working_hours(self, **payload):
        data = parse_working_hours(payload, 'body')
        settings = request.env['liwan.inbox.settings']._get_for_company()
        hours_service()._liwan_write(settings, data)
        return hours_service()._liwan_dump(settings)

    @http.route('/api/v1/inbox/departments/<int:department_id>/working-hours', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def get_department_hours(self, department_id, **_):
        department = get_record('liwan.inbox.department', department_id)
        return {'working_hours': hours_service()._liwan_dump(department) if department.hours_own else None}

    @http.route('/api/v1/inbox/departments/<int:department_id>/working-hours', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='write')
    @requires_capability(MANAGE_AUTOMATION)
    def put_department_hours(self, department_id, **payload):
        department = get_record('liwan.inbox.department', department_id)
        parse_object(payload, 'body', {'working_hours'}, ('working_hours',))
        if payload['working_hours'] is None:
            hours_service()._liwan_clear(department)
            return {'working_hours': None}
        data = parse_working_hours(payload['working_hours'])
        hours_service()._liwan_write(department, data)
        return {'working_hours': hours_service()._liwan_dump(department)}

    # channel automation

    @http.route('/api/v1/inbox/automation/channels', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_feature(AUTOMATION_FEATURE, CAMPAIGNS_FEATURE, operation='read', match='any')
    @requires_capability(MANAGE_AUTOMATION, CAMPAIGNS, match='any')
    def list_automation_channels(self, **_):
        """The channels the caller automates or sends campaigns on, as plain references (the channel list itself needs the channels capability)."""
        limit, offset = parse_page(request.httprequest.args)
        service, entitlement = request.env['liwan.access.service'], request.env['liwan.entitlement.service']
        companies = {
            company
            for capability, feature in ((MANAGE_AUTOMATION, AUTOMATION_FEATURE), (CAMPAIGNS, CAMPAIGNS_FEATURE))
            if entitlement._liwan_feature_read(feature)
            for company in service._liwan_capability_company_ids((capability,))
        }
        domain = [('owner_company_id', 'in', sorted(companies))]
        Channel = request.env['liwan.inbox.channel']
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
            channel._liwan_set_auto_message(purpose, content)
        return dump_channel_automation(channel)

    # rules

    @http.route('/api/v1/inbox/rules', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', AUTOMATION_FEATURE, operation='read')
    @requires_capability(MANAGE_AUTOMATION)
    def list_rules(self, **_):
        limit, offset = parse_page(request.httprequest.args, maximum=MAX_RULES)
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
        rule = Rule.create({**parsed.values, 'sequence': last.sequence + SEQUENCE_STEP})
        rule._liwan_set_reply(parsed.reply)
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
        rule.write(parsed.values)
        if parsed.set_reply:
            rule._liwan_set_reply(parsed.reply)
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
        channel, text, option_id, flow_id, at = parse_test(payload)
        inside, greeting, rules = request.env['liwan.inbox.automation']._liwan_dry_run(channel, text, option_id, at, flow_id)
        return {'inside_hours': inside, 'auto_message': greeting, 'rules': [dump_ref(rule) for rule in rules]}
