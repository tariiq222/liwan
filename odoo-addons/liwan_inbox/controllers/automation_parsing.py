# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of the automation bodies (packages/contracts inbox automation schemas): every limit is checked here again."""
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import cache
from itertools import pairwise
from zoneinfo import available_timezones

from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    find_agent,
    find_ids,
    find_one,
    get_channel,
    parse_ids,
    reject,
)
from odoo.addons.liwan_inbox.controllers.reply_parsing import (
    MAX_BODY,
    MAX_OPTION_ID,
    parse_commerce,
    parse_interactive,
    parse_list,
    parse_object,
    parse_string,
)
from odoo.addons.liwan_inbox.models.access_service import MANAGE_AUTOMATION
from odoo.addons.liwan_inbox.models.rule import (
    HOURS_CONDITIONS,
    MATCH_KINDS,
    PRIORITIES,
)

CLOCK = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$|^24:00$')
UTC_DATETIME = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
MAX_DAYS = 42
MAX_HOLIDAYS = 100
MAX_KEYWORDS = 50
MAX_KEYWORD = 128
MAX_RULE_TAGS = 20
RULE_FIELDS = {
    'channel_id', 'name', 'active', 'match_kind', 'keywords', 'option_id', 'flow_id', 'hours', 'stop', 'reply', 'resolve',
    'department_id', 'assignee_id', 'tag_ids', 'priority',
}
TEXT_MATCH_KINDS = ('contains', 'exact', 'starts_with')


def parse_bool(value, key):
    if not isinstance(value, bool):
        reject(f'{key} must be true or false', key)
    return value


def parse_int(value, key, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        reject(f'{key} must be a whole number from {low} to {high}', key)
    return value


def parse_choice(value, key, choices):
    if value not in dict(choices):
        reject(f'{key} must be one of {[name for name, _label in choices]}', key)
    return value


def parse_date(value, key):
    try:
        return date.fromisoformat(parse_string(value, key, 10, minimum=10)).isoformat()
    except ValueError:
        reject(f'{key} must be a date as YYYY-MM-DD', key)


@cache
def known_timezones():
    return available_timezones()


def check_no_overlap(days):
    """422 when two ranges of the same weekday overlap (touching ranges are fine)."""
    ordered = sorted(days, key=lambda day: (day['weekday'], day['from']))
    for before, after in pairwise(ordered):
        if before['weekday'] == after['weekday'] and after['from'] < before['to']:
            reject('ranges of the same day must not overlap', 'days')


def parse_working_hours(value, key='working_hours'):
    """{timezone, days, holidays} of the contract."""
    value = parse_object(value, key, {'timezone', 'days', 'holidays'}, ('timezone', 'days', 'holidays'))
    zone = parse_string(value['timezone'], 'timezone', 64)
    if zone not in known_timezones():
        reject('timezone must be an IANA timezone name', 'timezone')
    days = []
    for day in parse_list(value['days'], 'days', 0, MAX_DAYS):
        day = parse_object(day, 'days', {'weekday', 'from', 'to'}, ('weekday', 'from', 'to'))
        start, end = (parse_string(day[name], name, 5) for name in ('from', 'to'))
        if not (CLOCK.match(start) and CLOCK.match(end)) or start >= end:
            reject('days need from and to as HH:MM, ending after they start', 'days')
        days.append({'weekday': parse_int(day['weekday'], 'weekday', 0, 6), 'from': start, 'to': end})
    check_no_overlap(days)
    holidays = []
    for holiday in parse_list(value['holidays'], 'holidays', 0, MAX_HOLIDAYS):
        holiday = parse_object(holiday, 'holidays', {'name', 'date_from', 'date_to'}, ('name', 'date_from', 'date_to'))
        start, end = parse_date(holiday['date_from'], 'date_from'), parse_date(holiday['date_to'], 'date_to')
        if start > end:
            reject('a holiday ends on or after its start', 'holidays')
        holidays.append({'name': parse_string(holiday['name'], 'name', 128), 'date_from': start, 'date_to': end})
    return {'timezone': zone, 'days': days, 'holidays': holidays}


def parse_content(value, key='content', channel=None):
    """Automatic content as model values: `{body}` for text, or the interactive fields (buttons, a list, a link or a form) or the commerce fields."""
    value = parse_object(value, key, {'body', 'interactive', 'commerce'})
    if len(value) != 1:
        reject(f'{key} carries exactly one of body, interactive, commerce', key)
    if 'body' in value:
        return {'body': parse_string(value['body'], 'body', MAX_BODY)}
    parsed = parse_interactive(value['interactive'], channel) if 'interactive' in value else parse_commerce(value['commerce'])
    parsed.pop('kind')
    return parsed


@dataclass
class ParsedAutomation:
    """The channel columns to write and the welcome/away content to store (a missing key is left alone, None removes)."""
    values: dict = field(default_factory=dict)
    contents: dict = field(default_factory=dict)


def parse_message_block(channel, payload, purpose, setting, low, high):
    """The `welcome` or `away` block: enabled, its repeat setting and its content (an enabled one needs content)."""
    block = parse_object(payload[purpose], purpose, {'enabled', setting, 'content'})
    values, contents = {}, {}
    if 'enabled' in block:
        values[f'{purpose}_enabled'] = parse_bool(block['enabled'], 'enabled')
    if setting in block:
        values[f'{purpose}_{setting}'] = parse_int(block[setting], setting, low, high)
    if 'content' in block:
        contents[purpose] = parse_content(block['content'], channel=channel) if block['content'] is not None else None
    enabled = values.get(f'{purpose}_enabled', channel[f'{purpose}_enabled'])
    has_content = contents[purpose] is not None if purpose in contents else bool(channel._liwan_auto_message(purpose))
    if enabled and not has_content:
        reject(f'{purpose} needs content to be enabled', purpose)
    return values, contents


def parse_survey_block(payload):
    block = parse_object(payload['csat'], 'csat', {'enabled', 'question', 'good', 'neutral', 'bad'})
    values = {}
    if 'enabled' in block:
        values['csat_enabled'] = parse_bool(block['enabled'], 'enabled')
    for key, maximum in (('question', 1024), ('good', 20), ('neutral', 20), ('bad', 20)):
        if key in block:
            values[f'csat_{key}'] = parse_string(block[key], key, maximum)
    return values


def parse_automation(channel, payload):
    check_fields(payload, {'welcome', 'away', 'csat'})
    parsed = ParsedAutomation()
    for purpose, setting, low, high in (('welcome', 'idle_days', 0, 365), ('away', 'repeat_hours', 1, 168)):
        if purpose in payload:
            values, contents = parse_message_block(channel, payload, purpose, setting, low, high)
            parsed.values.update(values)
            parsed.contents.update(contents)
    if 'csat' in payload:
        parsed.values.update(parse_survey_block(payload))
    return parsed


@dataclass
class ParsedRule:
    """A validated rule body: rule `values`, the keywords to store (None keeps them) and the reply (`set_reply`: store it)."""
    values: dict = field(default_factory=dict)
    keywords: list | None = None
    reply: dict | None = None
    set_reply: bool = False


def automation_channel(value):
    """A channel of the current company the caller automates; any other is a 422 naming channel_id."""
    try:
        channel = get_channel(parse_positive_int(value, 'channel_id'), MANAGE_AUTOMATION)
    except MissingError:
        reject('channel_id names a channel that does not exist', 'channel_id')
    if channel.owner_company_id != request.env.company:
        reject('channel_id names a channel of another company', 'channel_id')
    return channel


def rule_state(rule):
    """The facts of a stored rule that the shape and action checks need (a new rule has none)."""
    if not rule:
        return {'match_kind': None, 'keywords': [], 'option_id': None, 'flow_id': None, 'actions': set()}
    actions = {name for name, present in (
        ('reply', rule.reply_ids), ('department', rule.department_id), ('assignee', rule.assignee_id),
        ('tags', rule.tag_ids), ('priority', rule.priority), ('resolve', rule.resolve),
    ) if present}
    return {
        'match_kind': rule.match_kind, 'keywords': rule.keyword_ids.mapped('value'),
        'option_id': rule.option_id or None, 'flow_id': rule.flow_id.id or None, 'actions': actions,
    }


def check_rule_state(state):
    """A text match needs keywords only, an option match an option id only, a form match a form only, and a rule does something."""
    kind, keywords, option_id, flow_id = state['match_kind'], state['keywords'], state['option_id'], state['flow_id']
    if kind == 'option':
        valid = option_id is not None and not keywords and flow_id is None
    elif kind == 'flow':
        valid = flow_id is not None and not keywords and option_id is None
    elif kind in TEXT_MATCH_KINDS:
        valid = bool(keywords) and option_id is None and flow_id is None
    else:
        valid = not keywords and option_id is None and flow_id is None
    if not valid:
        reject('keywords go with contains, exact and starts_with; an option id goes with option; a form goes with flow', 'match_kind')
    if not state['actions']:
        reject('a rule needs at least one action')


def in_company(records, field):
    """`records` when all belong to the current company; otherwise 422 naming `field`."""
    if records and records.company_id != request.env.company:
        reject(f'{field} names a record of another company', field)
    return records


def parse_rule_references(payload, state):
    """The channel, department, assignee and tag references of a rule body, as column values."""
    values = {}
    if 'channel_id' in payload:
        values['channel_id'] = automation_channel(payload['channel_id']).id if payload['channel_id'] is not None else False
    if 'department_id' in payload:
        values['department_id'] = (
            in_company(find_one('liwan.inbox.department', payload['department_id'], 'department_id'), 'department_id').id
            if payload['department_id'] is not None else False
        )
    if 'assignee_id' in payload:
        values['assignee_id'] = find_agent(payload['assignee_id'], 'assignee_id') if payload['assignee_id'] is not None else False
    if 'tag_ids' in payload:
        ids = parse_ids(payload['tag_ids'], 'tag_ids')
        if len(ids) > MAX_RULE_TAGS:
            reject(f'tag_ids holds at most {MAX_RULE_TAGS} tags', 'tag_ids')
        values['tag_ids'] = [(6, 0, in_company(find_ids('liwan.inbox.tag', ids, 'tag_ids'), 'tag_ids').ids)]
    for name, key in (('department', 'department_id'), ('assignee', 'assignee_id'), ('tags', 'tag_ids')):
        if key in payload:
            state['actions'].discard(name)
            if values[key] and values[key] != [(6, 0, [])]:
                state['actions'].add(name)
    return values


def check_rule_flow(flow, channel_id, company):
    """The form of a rule belongs to the rule's company and, when the rule names a channel, to that channel."""
    if flow.company_id != company or (channel_id and flow.channel_id.id != channel_id):
        reject('flow_id names a form of another channel or company', 'flow_id')


def parse_rule(payload, rule=None):
    """The validated ParsedRule of a create (every field) or patch (any) body; `rule` is the stored rule of a patch."""
    check_fields(payload, RULE_FIELDS, required=RULE_FIELDS if rule is None else ())
    state = rule_state(rule)
    parsed = ParsedRule(values=parse_rule_references(payload, state))
    values = parsed.values
    if 'name' in payload:
        values['name'] = parse_string(payload['name'], 'name', 128)
    for key in ('active', 'stop', 'resolve'):
        if key in payload:
            values[key] = parse_bool(payload[key], key)
    if 'match_kind' in payload:
        state['match_kind'] = values['match_kind'] = parse_choice(payload['match_kind'], 'match_kind', MATCH_KINDS)
    if 'hours' in payload:
        values['hours_condition'] = parse_choice(payload['hours'], 'hours', HOURS_CONDITIONS)
    if 'keywords' in payload:
        parsed.keywords = [
            parse_string(keyword, 'keywords', MAX_KEYWORD) for keyword in parse_list(payload['keywords'], 'keywords', 0, MAX_KEYWORDS)
        ]
        state['keywords'] = parsed.keywords
        values['keyword_ids'] = [(5, 0, 0), *((0, 0, {'value': keyword}) for keyword in parsed.keywords)]
    if 'option_id' in payload:
        state['option_id'] = parse_string(payload['option_id'], 'option_id', MAX_OPTION_ID, nullable=True)
        values['option_id'] = state['option_id'] or False
    channel_id = values.get('channel_id', rule.channel_id.id if rule else False)
    channel = request.env['liwan.inbox.channel'].browse(channel_id)
    if 'flow_id' in payload:
        flow = find_one('liwan.inbox.flow', payload['flow_id'], 'flow_id') if payload['flow_id'] is not None else None
        state['flow_id'] = flow.id if flow else None
        values['flow_id'] = flow.id if flow else False
    if state['flow_id']:
        company = rule.company_id if rule else channel.owner_company_id or request.env.company
        check_rule_flow(request.env['liwan.inbox.flow'].browse(state['flow_id']), channel_id, company)
    if 'priority' in payload:
        values['priority'] = parse_choice(payload['priority'], 'priority', PRIORITIES) if payload['priority'] is not None else False
        state['actions'].discard('priority')
        if values['priority']:
            state['actions'].add('priority')
    if 'resolve' in values:
        state['actions'].discard('resolve')
        if values['resolve']:
            state['actions'].add('resolve')
    if 'reply' in payload:
        parsed.set_reply = True
        parsed.reply = parse_content(payload['reply'], 'reply', channel or None) if payload['reply'] is not None else None
        state['actions'].discard('reply')
        if parsed.reply:
            state['actions'].add('reply')
    check_rule_state(state)
    return parsed


def parse_test(payload):
    """The dry-run body: a channel, the text and/or chosen option, and the moment (UTC, default now)."""
    check_fields(payload, {'channel_id', 'text', 'option_id', 'flow_id', 'at'}, required=('channel_id', 'text', 'option_id', 'flow_id', 'at'))
    channel = automation_channel(payload['channel_id'])
    flow_id = find_one('liwan.inbox.flow', payload['flow_id'], 'flow_id').id if payload['flow_id'] is not None else None
    text = parse_string(payload['text'], 'text', MAX_BODY, minimum=0, nullable=True)
    option_id = parse_string(payload['option_id'], 'option_id', MAX_OPTION_ID, nullable=True)
    at = payload['at']
    if at is not None and not (isinstance(at, str) and UTC_DATETIME.match(at)):
        reject('at must be a UTC time as YYYY-MM-DDTHH:MM:SSZ', 'at')
    return channel, text, option_id, flow_id, datetime.strptime(at, '%Y-%m-%dT%H:%M:%SZ') if at else None
