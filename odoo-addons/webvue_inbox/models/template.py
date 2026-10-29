# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.webvue_inbox.adapters import whatsapp

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
    ('otp', 'One-time password'),
]
# Meta words for a template status; REINSTATED means approved again. DELETED removes the template (see _webvue_apply_update).
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


class WebVueInboxTemplate(models.Model):
    """A WhatsApp message template: written in WebVue and reviewed by Meta, or synchronised from Meta."""
    _name = 'webvue.inbox.template'
    _description = 'Customer Inbox message template'
    _order = 'name, language, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    channel_id = fields.Many2one('webvue.inbox.channel', required=True, index=True, ondelete='cascade')
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
    example_ids = fields.One2many('webvue.inbox.template.example', 'template_id')
    footer = fields.Char()
    button_ids = fields.One2many('webvue.inbox.template.button', 'template_id')
    # Authentication templates only: Meta writes the body; these are the options around it.
    add_security_recommendation = fields.Boolean()
    code_expiration_minutes = fields.Integer()
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

    @api.depends('status')
    def _compute_editable(self):
        for template in self:
            template.editable = template.status in EDITABLE_STATUSES

    def unlink(self):
        self.header_example_attachment_id.unlink()
        return super().unlink()

    def _webvue_render(self, params):
        """The template body with its positional placeholders replaced by `params`."""
        self.ensure_one()
        return PLACEHOLDER.sub(lambda match: params[int(match.group(1)) - 1], self.body or '')

    def _webvue_render_header(self, param):
        """The header text with its {{1}} replaced by `param` (a header without a variable is returned as it is)."""
        self.ensure_one()
        return PLACEHOLDER.sub(lambda _match: param or '', self.header_text or '') if self.header_type == 'text' else None

    def _webvue_button_needs(self):
        """The (position, kind) of every button that takes a value when the template is sent."""
        self.ensure_one()
        return [
            (position, button.kind) for position, button in enumerate(self.button_ids.sorted('sequence'))
            if button.kind == 'copy_code' or (button.kind == 'url' and button.url.endswith('{{1}}'))
        ]

    # Meta payloads

    def _webvue_meta_components(self, credentials):
        """The `components` of Meta's create and edit calls; a media header uploads its sample file first."""
        self.ensure_one()
        if self.category == 'authentication':
            return self._webvue_meta_otp_components()
        components = []
        header = self._webvue_meta_header(credentials)
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
            components.append({'type': 'BUTTONS', 'buttons': [button._webvue_meta() for button in self.button_ids.sorted('sequence')]})
        return components

    def _webvue_meta_otp_components(self):
        footer = [{'type': 'FOOTER', 'code_expiration_minutes': self.code_expiration_minutes}] if self.code_expiration_minutes else []
        return [
            {'type': 'BODY', 'add_security_recommendation': self.add_security_recommendation},
            *footer,
            {'type': 'BUTTONS', 'buttons': [button._webvue_meta() for button in self.button_ids]},
        ]

    def _webvue_meta_header(self, credentials):
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
                'example': {'header_handle': [self._webvue_header_handle(credentials)]},
            }
        return None

    def _webvue_header_handle(self, credentials):
        """Upload the sample file of a media header to Meta and return its handle."""
        attachment, app_id = self.header_example_attachment_id, self.channel_id.app_id
        if not (attachment and app_id):
            raise UserError(self.env._('A media header needs a sample file and the Meta app id of the channel.'))
        return whatsapp.upload_template_sample(credentials, app_id, attachment.name, attachment.mimetype, attachment.raw)

    def _webvue_apply_answer(self, answer):
        """Store Meta's answer to a create call: the template id, its first status and the category Meta decided."""
        values = {'provider_template_id': answer['id'], **self._webvue_status_values(answer.get('status') or 'PENDING', None)}
        category = (answer.get('category') or '').lower()
        if category in CATEGORY_NAMES:
            values['category'] = category
        self.write(values)

    # writes from the API

    @api.model
    def _webvue_create_remote(self, channel, values, allow_category_change=False):
        """Create the template and submit it to Meta; any provider error propagates and the caller rolls the create back."""
        template = self.create({'channel_id': channel.id, 'company_id': channel.owner_company_id.id, **values})
        template._webvue_own_example_attachment()
        credentials = channel._webvue_credentials()
        payload = {
            'name': template.name, 'language': template.language, 'category': template.category.upper(),
            'components': template._webvue_meta_components(credentials),
            **({'allow_category_change': True} if allow_category_change else {}),
        }
        template._webvue_apply_answer(whatsapp.create_template(credentials, payload))
        return template

    def _webvue_edit_remote(self, values):
        """Write `values` and submit the edit to Meta, which reviews the template again."""
        self.ensure_one()
        if not (self.editable and self.provider_template_id):
            raise UserError(self.env._('Meta accepts edits of approved, rejected and paused templates only.'))
        category_changed = values.get('category', self.category) != self.category
        self.write(values)
        self._webvue_own_example_attachment()
        credentials = self.channel_id._webvue_credentials()
        whatsapp.edit_template(
            credentials, self.provider_template_id, self._webvue_meta_components(credentials),
            self.category.upper() if category_changed else None,
        )
        self.write({'status': 'pending', 'status_reason': False})

    def _webvue_delete_remote(self):
        """Delete the template at Meta, fail the replies queued with it and remove it."""
        self.ensure_one()
        if self.provider_template_id:
            whatsapp.delete_template(self.channel_id._webvue_credentials(), self.provider_template_id, self.name)
        self._webvue_remove()

    def _webvue_remove(self):
        self.ensure_one()
        self._webvue_fail_queued_sends(self.channel_id, self)
        self.unlink()

    def _webvue_own_example_attachment(self):
        """Move the uploaded sample file from its channel slot onto this template."""
        self.ensure_one()
        attachment = self.header_example_attachment_id
        if attachment and (attachment.res_model, attachment.res_id) != (self._name, self.id):
            attachment.write({'res_model': self._name, 'res_id': self.id})

    # provider state

    @api.model
    def _webvue_status_values(self, word, reason):
        """The status fields for Meta's status word; an unknown word disables the template and keeps the word as its reason."""
        status = META_STATUS.get(word)
        if status:
            return {'status': status, 'status_reason': (reason or False) if status != 'approved' else False}
        return {'status': 'disabled', 'status_reason': word[:200]}

    @api.model
    def _webvue_apply_update(self, channel, update):
        """Apply a template webhook change to the channel's template it names; an unknown template waits for the next sync."""
        template = self.search([
            ('channel_id', '=', channel.id), ('provider_template_id', '=', update.template_id),
        ], limit=1) or self.search([
            ('channel_id', '=', channel.id), ('name', '=', update.name), ('language', '=', update.language),
        ], limit=1)
        if not template:
            return
        if isinstance(update, whatsapp.TemplateStatusUpdate):
            if update.event == DELETED:
                template._webvue_remove()
            else:
                template.write({'provider_template_id': update.template_id, **self._webvue_status_values(update.event, update.reason)})
        elif isinstance(update, whatsapp.TemplateCategoryUpdate):
            if update.category.lower() in CATEGORY_NAMES:
                template.category = update.category.lower()
        else:
            template.quality = self._webvue_quality(update.score)

    @api.model
    def _webvue_quality(self, score):
        score = (score or '').lower()
        return score if score in QUALITY_NAMES else 'unknown'

    # synchronisation

    @api.model
    def _webvue_values_from_meta(self, item):
        """The template fields of one entry of Meta's listing, structure included."""
        parts = {}
        for component in item.get('components') or []:
            if isinstance(component, dict) and isinstance(component.get('type'), str):
                parts.setdefault(component['type'].upper(), component)
        header, body, footer = parts.get('HEADER', {}), parts.get('BODY', {}), parts.get('FOOTER', {})
        header_type = str(header.get('format') or '').lower()
        header_type = header_type if header_type in dict(HEADER_TYPES) and header_type != 'none' else 'none'
        status = self._webvue_status_values(
            str(item.get('status') or ''), item.get('rejected_reason') if item.get('rejected_reason') != 'NONE' else None,
        )
        category = str(item.get('category') or '').lower()
        quality = item.get('quality_score') if isinstance(item.get('quality_score'), dict) else {}
        minutes = footer.get('code_expiration_minutes')
        return {
            'provider_template_id': str(item['id']) if item.get('id') else False,
            'category': category if category in CATEGORY_NAMES else 'utility',
            **status,
            'quality': self._webvue_quality(quality.get('score')),
            'header_type': header_type,
            'header_text': header.get('text') if header_type == 'text' and isinstance(header.get('text'), str) else False,
            'header_example': self._webvue_first_example(header.get('example'), 'header_text') if header_type == 'text' else False,
            'body': body['text'] if isinstance(body.get('text'), str) else '',
            'footer': footer['text'] if isinstance(footer.get('text'), str) else False,
            'add_security_recommendation': bool(body.get('add_security_recommendation')),
            'code_expiration_minutes': minutes if isinstance(minutes, int) and not isinstance(minutes, bool) else 0,
            'example_ids': [(5, 0, 0), *((0, 0, {'position': position, 'example': example}) for position, example in enumerate(
                self._webvue_body_examples(body.get('example')), start=1))],
            'button_ids': [(5, 0, 0), *((0, 0, button) for button in self._webvue_buttons_from_meta(parts.get('BUTTONS', {})))],
        }

    @api.model
    def _webvue_first_example(self, example, key):
        values = example.get(key) if isinstance(example, dict) else None
        return values[0] if isinstance(values, list) and values and isinstance(values[0], str) else False

    @api.model
    def _webvue_body_examples(self, example):
        rows = example.get('body_text') if isinstance(example, dict) else None
        first = rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], list) else []
        return [value for value in first if isinstance(value, str)]

    @api.model
    def _webvue_buttons_from_meta(self, component):
        """The supported buttons of Meta's BUTTONS component, in order; other button types are not stored."""
        buttons = []
        for raw in component.get('buttons') or []:
            kind = str(raw.get('type') or '').lower() if isinstance(raw, dict) else ''
            if kind not in dict(BUTTON_KINDS):
                continue
            example = raw.get('example')
            example = example[0] if isinstance(example, list) and example else example
            buttons.append({
                'sequence': len(buttons), 'kind': kind, 'text': raw.get('text') if isinstance(raw.get('text'), str) else False,
                'url': raw.get('url') if isinstance(raw.get('url'), str) else False,
                'phone_number': raw.get('phone_number') if isinstance(raw.get('phone_number'), str) else False,
                'example': example if isinstance(example, str) else False,
            })
        return buttons

    def _webvue_sync(self, channel):
        """Upsert the channel's templates from Meta and delete those Meta no longer lists."""
        remote = {}
        for item in whatsapp.list_templates(channel._webvue_credentials()):
            remote[item['name'], item['language']] = self._webvue_values_from_meta(item)
        current = self.search([('channel_id', '=', channel.id)])
        by_key = {(t.name, t.language): t for t in current}
        for key, values in remote.items():
            if key in by_key:
                by_key[key].write(values)
            else:
                self.create({'channel_id': channel.id, 'company_id': channel.owner_company_id.id,
                             'name': key[0], 'language': key[1], **values})
        removed = current.filtered(lambda t: (t.name, t.language) not in remote)
        self._webvue_fail_queued_sends(channel, removed)
        removed.unlink()
        return self.search([('channel_id', '=', channel.id)])

    @api.model
    def _webvue_fail_queued_sends(self, channel, templates):
        """Fail the queued replies of templates the provider no longer lists, with a clear error."""
        removed = {(template.name, template.language) for template in templates}
        queued = self.env['webvue.inbox.message'].search([
            ('conversation_id.channel_id', '=', channel.id), ('delivery_state', '=', 'queued'),
            ('template_name', '!=', False),
        ])
        queued.filtered(lambda message: (message.template_name, message.template_language) in removed).write({
            'delivery_state': 'failed', 'error': self.env._('The template was removed by the provider.'),
        })


class WebVueInboxTemplateExample(models.Model):
    """The sample value Meta reviews for one body placeholder."""
    _name = 'webvue.inbox.template.example'
    _description = 'Customer Inbox template body example'
    _order = 'position, id'
    _webvue_scope = 'company'

    template_id = fields.Many2one('webvue.inbox.template', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='template_id.company_id', store=True, index=True)
    position = fields.Integer(required=True)
    example = fields.Char(required=True)


class WebVueInboxTemplateButton(models.Model):
    """One button of a template."""
    _name = 'webvue.inbox.template.button'
    _description = 'Customer Inbox template button'
    _order = 'sequence, id'
    _webvue_scope = 'company'

    template_id = fields.Many2one('webvue.inbox.template', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='template_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    kind = fields.Selection(BUTTON_KINDS, required=True)
    text = fields.Char()
    # A link may end with the variable {{1}}; the example is then a full sample address (a copy-code button: a sample code).
    url = fields.Char()
    phone_number = fields.Char()
    example = fields.Char()

    def _webvue_meta(self):
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
        return {'type': 'QUICK_REPLY', 'text': self.text}
