# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Parsing and validation of the campaign, audience, consent and policy bodies."""
from datetime import datetime

from odoo import fields
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import parse_positive_int
from odoo.addons.webvue_inbox.adapters import media_rules
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    find_ids,
    find_one,
    holds,
    parse_ids,
    parse_text,
    reject,
)
from odoo.addons.webvue_inbox.models.access_service import CAMPAIGNS
from odoo.addons.webvue_inbox.models.campaign import MAX_DAILY_CAP
from odoo.addons.webvue_inbox.models.campaign_constants import (
    CONSENT_POLICIES,
    PARAM_LOCATIONS,
    PARAM_SOURCES,
)
from odoo.addons.webvue_inbox.models.campaign_param import template_needs
from odoo.addons.webvue_inbox.models.normalization import normalize_text
from odoo.addons.webvue_inbox.models.settings_campaign import MAX_REPLY_LENGTH

UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'
MEDIA_HEADERS = ('image', 'video', 'document')
CAMPAIGN_FIELDS = {
    'name', 'channel_id', 'template_id', 'audience_id', 'params', 'header_attachment_id', 'scheduled_at', 'send_within_hours', 'daily_cap',
}
PAUSED_FIELDS = {'name', 'daily_cap', 'send_within_hours'}
PARAM_KEYS = {'location', 'position', 'source', 'value'}
AUDIENCE_FIELDS = {'name', 'tag_ids', 'tag_match', 'exclude_tag_ids', 'active_within_days'}
MAX_ACTIVE_DAYS = 3650
MAX_KEYWORDS = 30
KEYWORD_LENGTH = 64
SETTINGS_FIELDS = {
    'consent_policy', 'default_country_code', 'keyword_opt_out', 'stop_keywords', 'start_keywords', 'stop_reply', 'start_reply',
    'default_daily_cap',
}


def parse_bool(payload, key):
    if not isinstance(payload[key], bool):
        reject(f'{key} must be true or false', key)
    return payload[key]


def parse_int(payload, key, low, high):
    value = payload[key]
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        reject(f'{key} must be an integer between {low} and {high}', key)
    return value


def parse_choice(payload, key, choices):
    if payload[key] not in dict(choices):
        reject(f'{key} must be one of {[name for name, _label in choices]}', key)
    return payload[key]


def parse_utc(value, key):
    """The naive UTC datetime of a `YYYY-MM-DDTHH:MM:SSZ` string; 422 for anything else."""
    try:
        if isinstance(value, str):
            return datetime.strptime(value, UTC_FORMAT)
    except ValueError:
        pass
    return reject(f'{key} must be a UTC time like 2026-01-31T09:00:00Z', key)


# ---------------------------------------------------------------- audiences

def parse_audience(payload, partial=False):
    check_fields(payload, AUDIENCE_FIELDS, required=() if partial else sorted(AUDIENCE_FIELDS))
    values = {}
    if 'name' in payload:
        values['name'] = parse_text(payload, 'name', 128)
    for key, field in (('tag_ids', 'tag_ids'), ('exclude_tag_ids', 'exclude_tag_ids')):
        if key in payload:
            ids = parse_ids(payload[key], key)
            if len(ids) > 50:
                reject(f'{key} has at most 50 tags', key)
            values[field] = [(6, 0, find_ids('webvue.inbox.tag', ids, key).ids)]
    if 'tag_match' in payload:
        values['tag_match'] = parse_choice(payload, 'tag_match', [('any', ''), ('all', '')])
    if 'active_within_days' in payload:
        values['active_within_days'] = parse_int(payload, 'active_within_days', 0, MAX_ACTIVE_DAYS)
    return values


# ---------------------------------------------------------------- campaigns

def parse_params(value):
    """The list of placeholder fillers of a body, as (location, position, source, value) dicts; 422 on a bad entry."""
    if not isinstance(value, list) or len(value) > 25:
        reject('params must be a list of at most 25 parameters', 'params')
    params, slots = [], set()
    for item in value:
        if not isinstance(item, dict) or set(item) != PARAM_KEYS:
            reject(f'each parameter has exactly {sorted(PARAM_KEYS)}', 'params')
        text = item['value']
        if not isinstance(text, (str, type(None))) or (isinstance(text, str) and not 1 <= len(text) <= 1024):
            reject('a parameter value is null or 1 to 1024 characters', 'params')
        if item['source'] == 'static' and text is None:
            reject('a static parameter needs a value', 'params')
        slot = (parse_choice(item, 'location', PARAM_LOCATIONS), parse_int(item, 'position', 0, 20))
        if slot in slots:
            reject('a placeholder is filled once', 'params')
        slots.add(slot)
        params.append({'location': slot[0], 'position': slot[1], 'source': parse_choice(item, 'source', PARAM_SOURCES), 'value': text})
    return params


def find_template(template_id, channel=None):
    """A template of the caller's company (and of `channel`); 422 otherwise."""
    template = find_one('webvue.inbox.template', template_id, 'template_id')
    if channel and template.channel_id != channel:
        reject('template_id names a template of another channel', 'template_id')
    if template.category == 'authentication':
        reject('an authentication template cannot be used in a campaign', 'template_id')
    if template.header_type == 'location':
        reject('a template with a location header cannot be used in a campaign', 'template_id')
    return template


def find_channel(channel_id):
    channel = request.env['webvue.inbox.channel'].search([('id', '=', parse_positive_int(channel_id, 'channel_id'))], limit=1)
    if not channel or channel.owner_company_id != request.env.company or not holds(CAMPAIGNS, channel.owner_company_id):
        reject('channel_id names a record that does not exist', 'channel_id')
    return channel


def find_header(attachment_id, template, campaign):
    """The uploaded header file (None for none); it must be an unused campaign upload (or the campaign's) that fits the header."""
    if attachment_id is None:
        return None
    attachment = request.env['ir.attachment'].search([('id', '=', parse_positive_int(attachment_id, 'header_attachment_id'))], limit=1)
    owner = campaign.id if campaign else 0
    if not attachment or attachment.res_model != 'webvue.inbox.campaign' or attachment.res_id not in (0, owner):
        reject('header_attachment_id names a record that does not exist', 'header_attachment_id')
    if template.header_type not in MEDIA_HEADERS:
        reject('the template has no file header', 'header_attachment_id')
    if media_rules.kind_of(attachment.mimetype) != template.header_type:
        reject(f'the header file must be {template.header_type}', 'header_attachment_id')
    return attachment


def parse_campaign(payload, campaign=None):
    """Validated campaign values of a create or patch body (params as ORM commands); 422 naming the field otherwise."""
    creating = campaign is None
    check_fields(payload, CAMPAIGN_FIELDS, required=sorted(CAMPAIGN_FIELDS) if creating else ())
    if campaign:
        if not campaign.can_edit:
            reject(f'a {campaign.state} campaign cannot be edited')
        if campaign.state == 'paused':
            locked = sorted(set(payload) - PAUSED_FIELDS)
            if locked:
                reject(f'{locked[0]} cannot change while the campaign is paused', locked[0])
    values = {}
    if 'name' in payload:
        values['name'] = parse_text(payload, 'name', 128)
    channel = find_channel(payload['channel_id']) if 'channel_id' in payload else (campaign.channel_id if campaign else None)
    if 'channel_id' in payload:
        values['channel_id'] = channel.id
    if 'audience_id' in payload:
        values['audience_id'] = find_one('webvue.inbox.audience', payload['audience_id'], 'audience_id').id
    if 'send_within_hours' in payload:
        values['send_within_hours'] = parse_bool(payload, 'send_within_hours')
    if 'daily_cap' in payload:
        values['daily_cap'] = parse_int(payload, 'daily_cap', 0, MAX_DAILY_CAP)
    if 'scheduled_at' in payload:
        moment = None if payload['scheduled_at'] is None else parse_utc(payload['scheduled_at'], 'scheduled_at')
        if moment and moment < fields.Datetime.now():
            reject('scheduled_at is in the past', 'scheduled_at')
        values['scheduled_at'] = moment or False
    values.update(parse_content(payload, campaign, channel))
    return values


def parse_content(payload, campaign, channel):
    """The template, parameter and header-file values, checked against each other (the set of parameters must equal the template's)."""
    if campaign and channel != campaign.channel_id and 'template_id' not in payload:
        reject('template_id is required with a new channel', 'template_id')
    if not ({'template_id', 'params', 'header_attachment_id'} & set(payload)):
        return {}
    template = find_template(payload['template_id'], channel) if 'template_id' in payload else campaign.template_id
    if not template:
        reject('template_id is required', 'template_id')
    changed = bool(campaign) and template != campaign.template_id
    if changed and 'params' not in payload:
        reject('params must be given with a new template', 'params')
    values = {}
    if 'template_id' in payload:
        values['template_id'] = template.id
    if 'params' in payload:
        params = parse_params(payload['params'])
        if {(item['location'], item['position']) for item in params} != template_needs(template):
            reject('params must fill exactly the placeholders of the template', 'params')
        values['param_ids'] = [(5, 0, 0), *((0, 0, item) for item in params)]
    if 'header_attachment_id' in payload:
        attachment = find_header(payload['header_attachment_id'], template, campaign)
        values['header_attachment_id'] = attachment.id if attachment else False
    elif changed:
        values['header_attachment_id'] = False
    if {'header_attachment_id', 'template_id'} & set(values):
        values['header_media_id'] = False
    return values


def parse_preview(payload):
    check_fields(payload, {'template_id', 'params', 'contact_id'}, required=('template_id', 'params'))
    template = find_template(payload['template_id'])
    contact = find_one('webvue.inbox.contact', payload['contact_id'], 'contact_id') if 'contact_id' in payload else None
    return template, parse_params(payload['params']), contact


# ---------------------------------------------------------------- consent and policy

def parse_marketing_patch(payload):
    """(consent write or None, tag ids or None) of a contact marketing patch."""
    check_fields(payload, {'consent', 'tag_ids'})
    consent = tags = None
    if 'consent' in payload:
        value = payload['consent']
        if not isinstance(value, dict) or set(value) - {'state', 'note'} or value.get('state') not in ('opted_in', 'opted_out'):
            reject('consent is {state: opted_in | opted_out, note}', 'consent')
        if 'note' in value or value['state'] == 'opted_in':
            if not isinstance(value.get('note'), str) or not 1 <= len(value['note'].strip()) <= 256:
                reject('the note is 1 to 256 characters (required for an opt-in: where and how it was given)', 'consent')
        consent = (value['state'], value['note'].strip() if value.get('note') else None)
    if 'tag_ids' in payload:
        ids = parse_ids(payload['tag_ids'], 'tag_ids')
        if len(ids) > 50:
            reject('tag_ids has at most 50 tags', 'tag_ids')
        tags = find_ids('webvue.inbox.tag', ids, 'tag_ids').ids
    return consent, tags


def parse_keywords(payload, key):
    words = payload[key]
    if not isinstance(words, list) or len(words) > MAX_KEYWORDS:
        reject(f'{key} is a list of at most {MAX_KEYWORDS} keywords', key)
    cleaned = []
    for word in words:
        text = word.strip() if isinstance(word, str) else ''
        if not 1 <= len(text) <= KEYWORD_LENGTH or not normalize_text(text):
            reject(f'a keyword is 1 to {KEYWORD_LENGTH} characters with at least one letter', key)
        cleaned.append(text)
    if len({normalize_text(word) for word in cleaned}) != len(cleaned):
        reject(f'{key} has a keyword twice', key)
    return cleaned


def parse_campaign_settings(payload):
    check_fields(payload, SETTINGS_FIELDS)
    values, keywords = {}, {}
    if 'consent_policy' in payload:
        values['consent_policy'] = parse_choice(payload, 'consent_policy', CONSENT_POLICIES)
    if 'default_country_code' in payload:
        code = payload['default_country_code']
        if code is not None and not (isinstance(code, str) and code.isascii() and code.isdigit() and not code.startswith('0') and len(code) <= 3):
            reject('default_country_code is one to three digits without a leading zero, or null', 'default_country_code')
        values['default_country_code'] = code or False
    if 'keyword_opt_out' in payload:
        values['keyword_opt_out'] = parse_bool(payload, 'keyword_opt_out')
    for key in ('stop_keywords', 'start_keywords'):
        if key in payload:
            keywords[key.split('_')[0]] = parse_keywords(payload, key)
    for key in ('stop_reply', 'start_reply'):
        if key in payload:
            text = payload[key]
            if text is not None and not (isinstance(text, str) and len(text.strip()) >= 1 and len(text) <= MAX_REPLY_LENGTH):
                reject(f'{key} is 1 to {MAX_REPLY_LENGTH} characters, or null for none', key)
            values[key] = text.strip() if text else False
    if 'default_daily_cap' in payload:
        values['default_daily_cap'] = parse_int(payload, 'default_daily_cap', 0, MAX_DAILY_CAP)
    stop, start = ({normalize_text(word) for word in keywords.get(kind, ())} for kind in ('stop', 'start'))
    if stop & start:
        reject('a keyword cannot both stop and resume marketing messages', 'stop_keywords')
    return values, keywords
