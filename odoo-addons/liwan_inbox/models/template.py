# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import UserError

from .access_service import MANAGE_CHANNELS, MANAGE_TEMPLATES, READ
from .conversation import BUS_CHANNEL
from odoo.addons.liwan_inbox.adapters import whatsapp

PLACEHOLDER = re.compile(r'\{\{([1-9]\d*)\}\}')
APPROVED = 'approved'
CATEGORIES = [('marketing', 'Marketing'), ('utility', 'Utility'), ('authentication', 'Authentication')]
STATUSES = [
    ('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('paused', 'Paused'),
    ('disabled', 'Disabled'), ('in_appeal', 'In appeal'), ('flagged', 'Flagged'), ('pending_deletion', 'Pending deletion'),
]
QUALITIES = [('green', 'High'), ('yellow', 'Medium'), ('red', 'Low'), ('unknown', 'Unknown')]
HEADER_TYPES = [
    ('none', 'None'), ('text', 'Text'), ('image', 'Image'), ('video', 'Video'), ('document', 'Document'),
    ('location', 'Location'),
]
MEDIA_HEADERS = ('image', 'video', 'document')
BUTTON_KINDS = [
    ('quick_reply', 'Quick reply'), ('url', 'Link'), ('phone_number', 'Phone number'), ('copy_code', 'Copy code'),
    ('otp', 'One-time password'), ('flow', 'Form'),
]
# Meta words for a template status; REINSTATED means approved again. DELETED removes the template (see _liwan_apply_update).
META_STATUS = {
    'APPROVED': 'approved', 'REINSTATED': 'approved', 'PENDING': 'pending', 'REJECTED': 'rejected', 'PAUSED': 'paused',
    'DISABLED': 'disabled', 'IN_APPEAL': 'in_appeal', 'FLAGGED': 'flagged', 'PENDING_DELETION': 'pending_deletion',
}
DELETED = 'DELETED'
# What Meta lets an agent edit; a pending, flagged or disabled template waits for Meta.
EDITABLE_STATUSES = ('approved', 'rejected', 'paused')
CATEGORY_NAMES = {key for key, _label in CATEGORIES}
QUALITY_NAMES = {key for key, _label in QUALITIES}
# The placeholder body of an authentication template until Meta's fixed text arrives with the next sync.
OTP_BODY = '{{1}}'
# Parts of Meta's listing LiwanOS can neither show nor send: named variables, carousels, offers, ...
NAMED_VARIABLE = re.compile(r'\{\{\s*(?!\d+\s*\}\})[^}]*\}\}')
SUPPORTED_COMPONENTS = frozenset({'HEADER', 'BODY', 'FOOTER', 'BUTTONS'})


class LiwanInboxTemplate(models.Model):
    """A WhatsApp message template: written in LiwanOS and reviewed by Meta, or synchronised from Meta."""
    _name = 'liwan.inbox.template'
    _description = 'Customer Inbox message template'
    _order = 'name, language, id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    name = fields.Char(required=True)
    language = fields.Char(required=True)
    provider_template_id = fields.Char(index=True, copy=False)
    category = fields.Selection(CATEGORIES, required=True, default='utility')
    status = fields.Selection(STATUSES, required=True, default='pending', index=True)
    # Meta's reason for a rejection, pause or disable.
    status_reason = fields.Char()
    quality = fields.Selection(QUALITIES, required=True, default='unknown')
    header_type = fields.Selection(HEADER_TYPES, required=True, default='none')
    header_text = fields.Char()
    # The sample value of the header's {{1}}.
    header_example = fields.Char()
    # The sample file Meta reviews for a media header.
    header_example_attachment_id = fields.Many2one('ir.attachment', ondelete='set null')
    body = fields.Text()
    example_ids = fields.One2many('liwan.inbox.template.example', 'template_id')
    footer = fields.Char()
    button_ids = fields.One2many('liwan.inbox.template.button', 'template_id')
    # Authentication templates only: Meta writes the body; these are the options around it.
    add_security_recommendation = fields.Boolean()
    code_expiration_minutes = fields.Integer()
    # False for a template that has parts LiwanOS cannot represent (or whose structure is not synchronised yet):
    # it is listed but can be neither edited nor sent.
    supported = fields.Boolean(default=True)
    param_count = fields.Integer(compute='_compute_param_count')
    editable = fields.Boolean(compute='_compute_editable')

    _channel_name_language_unique = models.Constraint(
        'UNIQUE(channel_id, name, language)', 'A template is unique per channel, name and language.',
    )
    _channel_provider_template_unique = models.UniqueIndex(
        '(channel_id, provider_template_id) WHERE provider_template_id IS NOT NULL',
        'A provider template id is stored once per channel.',
    )

    @api.depends('body')
    def _compute_param_count(self):
        for template in self:
            template.param_count = max(map(int, PLACEHOLDER.findall(template.body or '')), default=0)

    @api.depends('status', 'supported')
    def _compute_editable(self):
        for template in self:
            template.editable = template.supported and template.status in EDITABLE_STATUSES

    def unlink(self):
        self.header_example_attachment_id.unlink()
        return super().unlink()

    def _liwan_render(self, params):
        """The template body with its positional placeholders replaced by `params`."""
        self.ensure_one()
        return PLACEHOLDER.sub(lambda match: params[int(match.group(1)) - 1], self.body or '')

    def _liwan_render_header(self, param):
        """The header text with its {{1}} replaced by `param` (a header without a variable is returned as it is)."""
        self.ensure_one()
        return PLACEHOLDER.sub(lambda _match: param or '', self.header_text or '') if self.header_type == 'text' else None

    def _liwan_button_needs(self):
        """The (WhatsApp button index, kind) of every button that takes a value when the template is sent."""
        self.ensure_one()
        return [
            (button.sequence, button.kind) for button in self.button_ids.sorted('sequence')
            if button.kind == 'copy_code' or (button.kind == 'url' and button.url.endswith('{{1}}'))
        ]

    # Meta payloads

    def _liwan_meta_components(self, credentials):
        """The `components` of Meta's create and edit calls; a media header uploads its sample file first."""
        self.ensure_one()
        if self.category == 'authentication':
            return self._liwan_meta_otp_components()
        components = []
        header = self._liwan_meta_header(credentials)
        if header:
            components.append(header)
        body = {'type': 'BODY', 'text': self.body}
        examples = [example.example for example in self.example_ids.sorted('position')]
        if examples:
            body['example'] = {'body_text': [examples]}
        components.append(body)
        if self.footer:
            components.append({'type': 'FOOTER', 'text': self.footer})
        if self.button_ids:
            components.append({'type': 'BUTTONS', 'buttons': [button._liwan_meta() for button in self.button_ids.sorted('sequence')]})
        return components

    def _liwan_meta_otp_components(self):
        footer = [{'type': 'FOOTER', 'code_expiration_minutes': self.code_expiration_minutes}] if self.code_expiration_minutes else []
        return [
            {'type': 'BODY', 'add_security_recommendation': self.add_security_recommendation},
            *footer,
            {'type': 'BUTTONS', 'buttons': [button._liwan_meta() for button in self.button_ids]},
        ]

    def _liwan_meta_header(self, credentials):
        if self.header_type == 'text':
            header = {'type': 'HEADER', 'format': 'TEXT', 'text': self.header_text}
            if self.header_example:
                header['example'] = {'header_text': [self.header_example]}
            return header
        if self.header_type == 'location':
            return {'type': 'HEADER', 'format': 'LOCATION'}
        if self.header_type in MEDIA_HEADERS:
            return {
                'type': 'HEADER', 'format': self.header_type.upper(),
                'example': {'header_handle': [self._liwan_header_handle(credentials)]},
            }
        return None

    def _liwan_header_handle(self, credentials):
        """Upload the sample file of a media header to Meta and return its handle."""
        attachment, app_id = self.header_example_attachment_id, self.channel_id.app_id
        if not (attachment and app_id):
            raise UserError(self.env._('A media header needs a sample file and the Meta app id of the channel.'))
        return whatsapp.upload_resumable(credentials, app_id, attachment.name, attachment.mimetype, attachment.raw)

    def _liwan_apply_answer(self, answer):
        """Store Meta's answer to a create call: the template id, its first status and the category Meta decided."""
        values = {'provider_template_id': answer['id'], **self._liwan_status_values(answer.get('status') or 'PENDING', None)}
        category = (answer.get('category') or '').lower()
        if category in CATEGORY_NAMES:
            values['category'] = category
        self.write(values)

    # writes from the API

    @api.model
    def _liwan_create_remote(self, channel, values, allow_category_change=False):
        """Create the template and submit it to Meta; any provider error propagates and the caller rolls the create back."""
        template = self.create({'channel_id': channel.id, 'company_id': channel.owner_company_id.id, **values})
        template._liwan_own_example_attachment()
        credentials = channel._liwan_credentials()
        payload = {
            'name': template.name, 'language': template.language, 'category': template.category.upper(),
            'components': template._liwan_meta_components(credentials),
            **({'allow_category_change': True} if allow_category_change else {}),
        }
        template._liwan_apply_answer(whatsapp.create_template(credentials, payload))
        return template

    def _liwan_edit_remote(self, values):
        """Write `values` and submit the edit to Meta, which reviews the template again."""
        self.ensure_one()
        if not (self.editable and self.provider_template_id):
            raise UserError(self.env._('Meta accepts edits of approved, rejected and paused templates only.'))
        category_changed = values.get('category', self.category) != self.category
        previous_sample = self.header_example_attachment_id
        self.write(values)
        if previous_sample != self.header_example_attachment_id:
            previous_sample.unlink()
        self._liwan_own_example_attachment()
        credentials = self.channel_id._liwan_credentials()
        whatsapp.edit_template(
            credentials, self.provider_template_id, self._liwan_meta_components(credentials),
            self.category.upper() if category_changed else None,
        )
        self.write({'status': 'pending', 'status_reason': False})

    def _liwan_delete_remote(self):
        """Delete the template at Meta, fail the replies queued with it and remove it."""
        self.ensure_one()
        if self.provider_template_id:
            whatsapp.delete_template(self.channel_id._liwan_credentials(), self.provider_template_id, self.name)
        self._liwan_remove()

    def _liwan_remove(self):
        """Remove the template; replies still queued with it fail when the outbox reaches them."""
        self.ensure_one()
        self.unlink()

    def _liwan_own_example_attachment(self):
        """Move the uploaded sample file from its channel slot onto this template."""
        self.ensure_one()
        attachment = self.header_example_attachment_id
        if attachment and (attachment.res_model, attachment.res_id) != (self._name, self.id):
            attachment.write({'res_model': self._name, 'res_id': self.id})

    # provider state

    @api.model
    def _liwan_status_values(self, word, reason):
        """The status fields for Meta's status word; an unknown word disables the template and keeps the word as its reason."""
        status = META_STATUS.get(word)
        if status:
            return {'status': status, 'status_reason': (reason or False) if status != 'approved' else False}
        return {'status': 'disabled', 'status_reason': word[:200]}

    @api.model
    def _liwan_apply_update(self, channel, update):
        """Apply a template webhook change to the channel's template it names; an unknown template waits for the next sync."""
        template = self.search([
            ('channel_id', '=', channel.id), ('provider_template_id', '=', update.template_id),
        ], limit=1) or self.search([
            ('channel_id', '=', channel.id), ('name', '=', update.name), ('language', '=', update.language),
        ], limit=1)
        if not template:
            return
        template_id, company = template.id, template.company_id
        if isinstance(update, whatsapp.TemplateStatusUpdate):
            if update.event == DELETED:
                template._liwan_remove()
            else:
                template.write({'provider_template_id': update.template_id, **self._liwan_status_values(update.event, update.reason)})
        elif isinstance(update, whatsapp.TemplateCategoryUpdate):
            if update.category.lower() in CATEGORY_NAMES:
                template.category = update.category.lower()
        else:
            template.quality = self._liwan_quality(update.score)
        self._liwan_notify_bus(template_id, company)

    @api.model
    def _liwan_notify_bus(self, template_id, company):
        """Tell every user who reads or manages the company's templates that one changed (id only, no content)."""
        service = self.with_company(company).env['liwan.access.service']
        groups = self.env.ref('liwan_inbox.group_cap_inbox_conversations_read') | self.env.ref(
            'liwan_inbox.group_cap_inbox_templates_manage') | self.env.ref('liwan_inbox.group_cap_inbox_channels_manage')
        for user in groups.all_user_ids.filtered('active'):
            if any(service._liwan_has_capability(user, key, company=company) for key in (READ, MANAGE_TEMPLATES, MANAGE_CHANNELS)):
                self.env['bus.bus']._sendone(user.partner_id, BUS_CHANNEL, {'event': 'template', 'id': template_id})

    @api.model
    def _liwan_quality(self, score):
        score = (score or '').lower()
        return score if score in QUALITY_NAMES else 'unknown'

    # synchronisation

    @api.model
    def _liwan_values_from_meta(self, item):
        """The template fields of one entry of Meta's listing, structure included."""
        parts = {}
        for component in item.get('components') or []:
            if isinstance(component, dict) and isinstance(component.get('type'), str):
                parts.setdefault(component['type'].upper(), component)
        header, body, footer = parts.get('HEADER', {}), parts.get('BODY', {}), parts.get('FOOTER', {})
        header_type = str(header.get('format') or '').lower()
        known_header = header_type in dict(HEADER_TYPES) and header_type != 'none'
        header_type = header_type if known_header else 'none'
        buttons, buttons_supported = self._liwan_buttons_from_meta(parts.get('BUTTONS', {}))
        status = self._liwan_status_values(
            str(item.get('status') or ''), item.get('rejected_reason') if item.get('rejected_reason') != 'NONE' else None,
        )
        category = str(item.get('category') or '').lower()
        quality = item.get('quality_score') if isinstance(item.get('quality_score'), dict) else {}
        minutes = footer.get('code_expiration_minutes')
        return {
            'provider_template_id': str(item['id']) if item.get('id') else False,
            'supported': buttons_supported and (known_header or not header) and self._liwan_is_positional(item),
            'category': category if category in CATEGORY_NAMES else 'utility',
            **status,
            'quality': self._liwan_quality(quality.get('score')),
            'header_type': header_type,
            'header_text': header.get('text') if header_type == 'text' and isinstance(header.get('text'), str) else False,
            'header_example': self._liwan_first_example(header.get('example'), 'header_text') if header_type == 'text' else False,
            'body': body['text'] if isinstance(body.get('text'), str) else '',
            'footer': footer['text'] if isinstance(footer.get('text'), str) else False,
            'add_security_recommendation': bool(body.get('add_security_recommendation')),
            'code_expiration_minutes': minutes if isinstance(minutes, int) and not isinstance(minutes, bool) else 0,
            'example_ids': [(5, 0, 0), *((0, 0, {'position': position, 'example': example}) for position, example in enumerate(
                self._liwan_body_examples(body.get('example')), start=1))],
            'button_ids': [(5, 0, 0), *((0, 0, button) for button in buttons)],
        }

    @api.model
    def _liwan_first_example(self, example, key):
        values = example.get(key) if isinstance(example, dict) else None
        return values[0] if isinstance(values, list) and values and isinstance(values[0], str) else False

    @api.model
    def _liwan_body_examples(self, example):
        rows = example.get('body_text') if isinstance(example, dict) else None
        first = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], list) else []
        return [value for value in first if isinstance(value, str)]

    @api.model
    def _liwan_is_positional(self, item):
        """True when the listing uses only components LiwanOS knows and numbered variables ({{1}}) in every text."""
        components = [c for c in item.get('components') or [] if isinstance(c, dict)]
        texts = [c.get('text') for c in components] + [
            b.get('url') for c in components for b in (c.get('buttons') or []) if isinstance(b, dict)
        ]
        return (
            {str(c.get('type') or '').upper() for c in components} <= SUPPORTED_COMPONENTS
            and item.get('parameter_format', 'POSITIONAL') != 'NAMED'
            and not any(NAMED_VARIABLE.search(text) for text in texts if isinstance(text, str))
        )

    @api.model
    def _liwan_buttons_from_meta(self, component):
        """(supported buttons keyed by Meta's own button index, whether every button is supported).

        WhatsApp addresses a button by its index in Meta's list, so an unsupported button leaves a gap.
        """
        buttons, all_supported = [], True
        for index, raw in enumerate(component.get('buttons') or []):
            kind = str(raw.get('type') or '').lower() if isinstance(raw, dict) else ''
            if kind not in dict(BUTTON_KINDS) or (kind == 'otp' and raw.get('otp_type', 'COPY_CODE') != 'COPY_CODE'):
                all_supported = False
                continue
            example = raw.get('example')
            example = example[0] if isinstance(example, list) and example else example
            buttons.append({
                'sequence': index, 'kind': kind, 'text': raw.get('text') if isinstance(raw.get('text'), str) else False,
                'url': raw.get('url') if isinstance(raw.get('url'), str) else False,
                'phone_number': raw.get('phone_number') if isinstance(raw.get('phone_number'), str) else False,
                'example': example if isinstance(example, str) else False,
                'provider_flow_id': str(raw['flow_id']) if kind == 'flow' and isinstance(raw.get('flow_id'), (str, int)) else False,
            })
        return buttons, all_supported

    def _liwan_sync(self, channel):
        """Upsert the channel's templates from Meta and delete those Meta no longer lists."""
        remote = {}
        for item in whatsapp.list_templates(channel._liwan_credentials()):
            remote[item['name'], item['language']] = self._liwan_values_from_meta(item)
        current = self.search([('channel_id', '=', channel.id)])
        by_key = {(t.name, t.language): t for t in current}
        for key, values in remote.items():
            if key in by_key:
                by_key[key].write(values)
            else:
                self.create({'channel_id': channel.id, 'company_id': channel.owner_company_id.id,
                             'name': key[0], 'language': key[1], **values})
        current.filtered(lambda t: (t.name, t.language) not in remote).unlink()
        return self.search([('channel_id', '=', channel.id)])


class LiwanInboxTemplateExample(models.Model):
    """The sample value Meta reviews for one body placeholder."""
    _name = 'liwan.inbox.template.example'
    _description = 'Customer Inbox template body example'
    _order = 'position, id'
    _liwan_scope = 'company'

    template_id = fields.Many2one('liwan.inbox.template', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='template_id.company_id', store=True, index=True)
    position = fields.Integer(required=True)
    example = fields.Char(required=True)


class LiwanInboxTemplateButton(models.Model):
    """One button of a template."""
    _name = 'liwan.inbox.template.button'
    _description = 'Customer Inbox template button'
    _order = 'sequence, id'
    _liwan_scope = 'company'

    template_id = fields.Many2one('liwan.inbox.template', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='template_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    kind = fields.Selection(BUTTON_KINDS, required=True)
    text = fields.Char()
    # A link may end with the variable {{1}}; the example is then a full sample address (a copy-code button: a sample code).
    url = fields.Char()
    phone_number = fields.Char()
    example = fields.Char()
    # A form button: Meta's id of the form it opens (also for a form LiwanOS does not know) and, when LiwanOS knows it, the form.
    provider_flow_id = fields.Char()
    flow_id = fields.Many2one('liwan.inbox.flow', compute='_compute_flow')

    @api.depends('provider_flow_id', 'template_id.channel_id')
    def _compute_flow(self):
        provider_ids = sorted({button.provider_flow_id for button in self if button.provider_flow_id})
        flows = self.env['liwan.inbox.flow'].search([('provider_flow_id', 'in', provider_ids)])
        for button in self:
            button.flow_id = flows.filtered(
                lambda flow: flow.provider_flow_id == button.provider_flow_id and flow.channel_id == button.template_id.channel_id,
            )[:1] if button.provider_flow_id else False

    def _liwan_meta(self):
        """The button in Meta's create and edit shape."""
        self.ensure_one()
        if self.kind == 'url':
            button = {'type': 'URL', 'text': self.text, 'url': self.url}
            if self.example:
                button['example'] = [self.example]
            return button
        if self.kind == 'phone_number':
            return {'type': 'PHONE_NUMBER', 'text': self.text, 'phone_number': self.phone_number}
        if self.kind == 'copy_code':
            return {'type': 'COPY_CODE', 'example': self.example}
        if self.kind == 'otp':
            return {'type': 'OTP', 'otp_type': 'COPY_CODE', 'text': self.text}
        if self.kind == 'flow':
            return {'type': 'FLOW', 'text': self.text, 'flow_id': self.provider_flow_id, 'flow_action': 'navigate'}
        return {'type': 'QUICK_REPLY', 'text': self.text}
