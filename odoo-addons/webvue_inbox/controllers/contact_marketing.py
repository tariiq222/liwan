# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Marketing consent and segment tags of a contact, and the CSV contact import."""
import csv
import io
import re

from odoo import fields, http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.controllers.campaign_parsing import (
    in_company,
    parse_marketing_patch,
)
from odoo.addons.webvue_inbox.controllers.conversation_files import decode_upload
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    find_ids,
    not_found,
    parse_ids,
    parse_text,
    reject,
)
from odoo.addons.webvue_inbox.models.access_service import CAMPAIGNS, READ, REPLY
from odoo.addons.webvue_inbox.models.constants import CAMPAIGNS_FEATURE
from odoo.addons.webvue_inbox.serializers.campaigns import dump_contact_marketing

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ENCODED = 2_800_000
MAX_ROWS = 10_000
MAX_ROW_ERRORS = 50
NAME_LENGTH = 255
PHONE_DIGITS = re.compile(r'^\d{8,15}$')
PHONE_NOISE = re.compile(r'[\s\-().]')
IMPORT_FIELDS = {'name', 'data', 'tag_ids', 'consent', 'consent_note'}


def visible_contact(contact_id):
    """The contact: any contact of the company for a campaign manager, else one in a conversation the caller may see."""
    contact = get_record('webvue.inbox.contact', contact_id)
    holds_campaigns = request.env['webvue.access.service']._webvue_has_capability(request.env.user, CAMPAIGNS, company=request.env.company)
    if not holds_campaigns and not request.env['webvue.inbox.conversation']._webvue_search_visible(
        [('contact_id', '=', contact.id)], limit=1,
    ):
        raise not_found()
    return contact


def normalize_phone(raw, country_code):
    """(digits, None) of a phone cell, or (None, the reason it is refused)."""
    text = PHONE_NOISE.sub('', raw or '')
    if text.startswith('+'):
        digits = text[1:]
    elif text.startswith('00'):
        digits = text[2:]
    elif text.startswith('0'):
        if not country_code:
            return None, 'a local number needs the default country code in the campaign settings'
        digits = country_code + text[1:]
    else:
        digits = text
    return (digits, None) if PHONE_DIGITS.match(digits) else (None, 'the phone number must have 8 to 15 digits')


def parse_import(payload):
    check_fields(payload, IMPORT_FIELDS, required=('name', 'data', 'tag_ids', 'consent'))
    parse_text(payload, 'name', 255)
    if not isinstance(payload['data'], str) or len(payload['data']) > MAX_ENCODED:
        raise ApiError(413, 'payload_too_large', 'the file is too large')
    raw = decode_upload(payload['data'])
    if len(raw) > MAX_FILE_BYTES:
        raise ApiError(413, 'payload_too_large', 'the file is too large')
    tag_ids = parse_ids(payload['tag_ids'], 'tag_ids')
    if len(tag_ids) > 10:
        reject('tag_ids has at most 10 tags', 'tag_ids')
    if payload['consent'] not in ('unknown', 'opted_in'):
        reject('consent must be unknown or opted_in', 'consent')
    note = None
    if payload['consent'] == 'opted_in':
        if 'consent_note' not in payload:
            reject('consent_note is required for an opted_in import', 'consent_note')
        note = parse_text(payload, 'consent_note', 256)
    return raw, in_company(find_ids('webvue.inbox.tag', tag_ids, 'tag_ids'), 'tag_ids'), payload['consent'], note


def read_rows(raw):
    """The CSV rows as (line, {column: cell}); 422 for a file that is not UTF-8, lacks `phone` or has too many rows."""
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        reject('the file must be UTF-8 text', 'data')
    try:
        reader = csv.DictReader(io.StringIO(text), strict=True)
        reader.fieldnames = [(name or '').strip().lower() for name in reader.fieldnames or []]
        if 'phone' not in reader.fieldnames:
            reject('the CSV needs a phone column', 'data')
        rows = [
            (reader.line_num, {key: (value if isinstance(value, str) else '').strip() for key, value in row.items() if key}) for row in reader
        ]
    except csv.Error:
        reject('the file is not a readable CSV', 'data')
    if len(rows) > MAX_ROWS:
        reject(f'the CSV has more than {MAX_ROWS} rows', 'data')
    return rows


class ContactImport:
    """One CSV import: validated rows become new contacts, or tags and consent on the contacts that already have the number."""

    def __init__(self, tags, consent, note):
        self.env = request.env
        self.tags, self.consent, self.note = tags, consent, note
        self.company = self.env.company
        self.settings = self.env['webvue.inbox.settings']._get_for_company()
        self.tag_by_name = {tag.name: tag for tag in self.env['webvue.inbox.tag'].search([('company_id', '=', self.company.id)])}
        self.created = self.updated = self.skipped = 0
        self.errors = []

    def refuse(self, line, message):
        self.skipped += 1
        if len(self.errors) < MAX_ROW_ERRORS:
            self.errors.append({'line': line, 'message': message})

    def parse_row(self, line, row):
        """(digits, name, tags) of a valid row, or None after recording why it was refused."""
        digits, problem = normalize_phone(row.get('phone'), self.settings.default_country_code)
        if problem:
            return self.refuse(line, problem)
        names = [name.strip() for name in row.get('tags', '').split(';') if name.strip()]
        unknown = [name for name in names if name not in self.tag_by_name]
        if unknown:
            return self.refuse(line, f'unknown tag: {unknown[0]}')
        return digits, row.get('name') or f'+{digits}', self.tags | self.env['webvue.inbox.tag'].concat(*(self.tag_by_name[n] for n in names))

    def run(self, rows):
        parsed, seen = [], set()
        for line, row in rows:
            item = self.parse_row(line, row)
            if item and item[0] in seen:
                self.refuse(line, 'the number appears twice in the file')
            elif item:
                seen.add(item[0])
                parsed.append(item)
        Identity = self.env['webvue.inbox.contact.identity']
        known = {identity.address: identity.contact_id for identity in Identity.search([
            ('company_id', '=', self.company.id), ('channel_kind', '=', 'whatsapp'), ('address', 'in', [item[0] for item in parsed]),
        ])}
        fresh = [item for item in parsed if item[0] not in known]
        contacts = self.env['webvue.inbox.contact'].create([{
            'name': name[:NAME_LENGTH], 'phone': f'+{digits}', 'company_id': self.company.id, 'tag_ids': [(6, 0, tags.ids)],
        } for digits, name, tags in fresh])
        Identity.create([
            {'contact_id': contact.id, 'company_id': self.company.id, 'channel_kind': 'whatsapp', 'address': item[0]} for contact, item in zip(contacts, fresh, strict=True)
        ])
        for digits, _name, tags in parsed:
            if digits in known:
                known[digits].write({'tag_ids': [(4, tag.id) for tag in tags], 'last_activity_at': fields.Datetime.now()})
        self.created, self.updated = len(contacts), len(parsed) - len(fresh)
        if self.consent == 'opted_in':
            for contact in contacts | self.env['webvue.inbox.contact'].concat(*known.values()):
                if contact.marketing_consent != 'opted_in':
                    contact._webvue_record_consent('opted_in', 'import', note=self.note)
        return {'created': self.created, 'updated': self.updated, 'skipped': self.skipped, 'errors': self.errors}


class ContactMarketingController(http.Controller):

    @http.route('/api/v1/inbox/contacts/<int:contact_id>/marketing', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='read')
    @requires_capability(READ, CAMPAIGNS, match='any')
    def read_marketing(self, contact_id, **_):
        return dump_contact_marketing(visible_contact(contact_id))

    @http.route('/api/v1/inbox/contacts/<int:contact_id>/marketing', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(REPLY, CAMPAIGNS, match='any')
    def patch_marketing(self, contact_id, **payload):
        contact = visible_contact(contact_id)
        consent, tag_ids = parse_marketing_patch(payload)
        if consent:
            state, note = consent
            contact._webvue_record_consent(state, 'agent', note=note, author=request.env.user)
        if tag_ids is not None:
            contact.write({'tag_ids': [(6, 0, tag_ids)]})
        return dump_contact_marketing(contact)

    @http.route('/api/v1/inbox/contacts/import', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CAMPAIGNS_FEATURE, operation='write')
    @requires_capability(CAMPAIGNS)
    def import_contacts(self, **payload):
        raw, tags, consent, note = parse_import(payload)
        return ContactImport(tags, consent, note).run(read_rows(raw))
