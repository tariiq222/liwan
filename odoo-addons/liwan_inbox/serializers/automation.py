# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of the automation: channel messages and survey, and rules (packages/contracts/src/inbox)."""
from odoo.addons.liwan_inbox.serializers.conversation import dump_ref


def dump_content(auto_message):
    """The contract's automatic content of an automatic message, or null when there is none."""
    return auto_message._liwan_dump_content() if auto_message else None


def dump_channel_automation(channel):
    return {
        'welcome': {
            'enabled': channel.welcome_enabled, 'idle_days': channel.welcome_idle_days,
            'content': dump_content(channel._liwan_auto_message('welcome')),
        },
        'away': {
            'enabled': channel.away_enabled, 'repeat_hours': channel.away_repeat_hours,
            'content': dump_content(channel._liwan_auto_message('away')),
        },
        'csat': {
            'enabled': channel.csat_enabled, 'question': channel.csat_question,
            'good': channel.csat_good, 'neutral': channel.csat_neutral, 'bad': channel.csat_bad,
        },
    }


def dump_rule(rule):
    return {
        'id': rule.id,
        'sequence': rule.sequence,
        'channel': dump_ref(rule.channel_id),
        'name': rule.name,
        'active': rule.active,
        'match_kind': rule.match_kind,
        'keywords': rule.keyword_ids.mapped('value'),
        'option_id': rule.option_id or None,
        'flow': dump_ref(rule.flow_id),
        'hours': rule.hours_condition,
        'stop': rule.stop,
        'reply': dump_content(rule.reply_ids),
        'resolve': rule.resolve,
        'department': dump_ref(rule.department_id),
        'assignee': dump_ref(rule.assignee_id),
        'tags': [dump_ref(tag) for tag in rule.tag_ids],
        'priority': rule.priority or None,
    }
