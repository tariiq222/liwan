# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import re

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.fields import Domain

from . import flow_json
from .access_service import READ
from .constants import FLOW_JSON_VERSION
from .flow_starters import FLOW_STARTERS
from odoo.addons.liwan_inbox.adapters import whatsapp

_logger = logging.getLogger(__name__)

CATEGORIES = [
    ('sign_up', 'Sign up'), ('sign_in', 'Sign in'), ('appointment_booking', 'Appointment booking'),
    ('lead_generation', 'Lead generation'), ('contact_us', 'Contact us'), ('customer_support', 'Customer support'),
    ('survey', 'Survey'), ('other', 'Other'),
]
STATUSES = [
    ('draft', 'Draft'), ('published', 'Published'), ('deprecated', 'Deprecated'), ('blocked', 'Blocked'),
    ('throttled', 'Throttled'),
]
HEALTHS = [('available', 'Available'), ('limited', 'Limited'), ('blocked', 'Blocked'), ('unknown', 'Unknown')]
FIELD_KINDS = [
    ('heading', 'Heading'), ('subheading', 'Subheading'), ('text', 'Text'), ('caption', 'Caption'),
    ('text_input', 'Text input'), ('text_area', 'Text area'), ('dropdown', 'Dropdown'), ('radio', 'Radio buttons'),
    ('checkbox', 'Checkboxes'), ('date', 'Date'), ('opt_in', 'Opt-in'),
]
DISPLAY_KINDS = ('heading', 'subheading', 'text', 'caption')
CHOICE_KINDS = ('dropdown', 'radio', 'checkbox')
INPUT_KINDS = flow_json.INPUT_KINDS
INPUT_TYPES = [('text', 'Text'), ('number', 'Number'), ('email', 'Email'), ('phone', 'Phone')]
# Meta's words for a form's status and for whether this phone number can send it now.
META_STATUS = {
    'DRAFT': 'draft', 'PUBLISHED': 'published', 'DEPRECATED': 'deprecated', 'BLOCKED': 'blocked', 'THROTTLED': 'throttled',
}
META_HEALTH = {'AVAILABLE': 'available', 'LIMITED': 'limited', 'BLOCKED': 'blocked'}
CATEGORY_NAMES = {key for key, _label in CATEGORIES}
# The statuses whose health Meta reports (a draft is not sent).
LIVE_STATUSES = ('published', 'blocked', 'throttled')
FIELD_KEY = re.compile(r'^[a-z][a-z0-9_]{0,39}$')
RESERVED_KEY = 'flow_token'
# Columns copied from a parsed field onto a field row; the options become option rows.
FIELD_COLUMNS = (
    'key', 'text', 'label', 'required', 'sensitive', 'input_type', 'helper_text', 'min_chars', 'max_chars',
    'max_length', 'min_selected', 'max_selected', 'min_date', 'max_date',
)


class LiwanInboxFlow(models.Model):
    """A WhatsApp form (Meta Flow): built in LiwanOS, published to Meta, sent in a conversation and answered by the customer."""
    _name = 'liwan.inbox.flow'
    _description = 'Customer Inbox WhatsApp form'
    _order = 'name, id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', compute='_compute_company', store=True, index=True)
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    name = fields.Char(required=True)
    category = fields.Selection(CATEGORIES, required=True, default='other')
    # The language of the texts (a Meta language code): it only sets the direction of Meta's preview.
    language = fields.Char(required=True, default='ar')
    status = fields.Selection(STATUSES, required=True, default='draft', index=True)
    health = fields.Selection(HEALTHS, required=True, default='unknown')
    provider_flow_id = fields.Char(index=True, copy=False)
    json_version = fields.Char()
    # Hash of the Flow JSON Meta holds, so an identical save uploads nothing.
    uploaded_hash = fields.Char(copy=False)
    # False for a form made in WhatsApp Manager: LiwanOS sends it and stores its answers but cannot show its screens.
    supported = fields.Boolean(default=True)
    # Sent automatically to the customer after each submission.
    completion_message = fields.Text()
    published_at = fields.Datetime()
    version_warning = fields.Char()
    # Why the last step after Meta published the form failed (reading its state back, or taking over the form it replaces);
    # the next synchronisation retries it.
    last_error = fields.Char()
    # The published form this copy takes over (rules and automatic messages move to it) when it is published.
    replaces_id = fields.Many2one('liwan.inbox.flow', ondelete='set null', copy=False)
    screen_ids = fields.One2many('liwan.inbox.flow.screen', 'flow_id')
    error_ids = fields.One2many('liwan.inbox.flow.error', 'flow_id')
    submission_ids = fields.One2many('liwan.inbox.flow.submission', 'flow_id')
    editable = fields.Boolean(compute='_compute_state')
    sendable = fields.Boolean(compute='_compute_state')
    submission_count = fields.Integer(compute='_compute_submission_count')

    _channel_name_unique = models.Constraint('UNIQUE(channel_id, name)', 'A form is unique per channel and name.')
    _channel_provider_flow_unique = models.UniqueIndex(
        '(channel_id, provider_flow_id) WHERE provider_flow_id IS NOT NULL',
        'A provider form id is stored once per channel.',
    )

    @api.depends('channel_id.owner_company_id')
    def _compute_company(self):
        for flow in self:
            flow.company_id = flow.channel_id.owner_company_id

    @api.depends('status', 'health', 'supported')
    def _compute_state(self):
        for flow in self:
            flow.editable = flow.supported and flow.status == 'draft'
            flow.sendable = flow.status == 'published' and flow.health != 'blocked'

    def _compute_submission_count(self):
        """How many answers each form has among the conversations the caller may see (0 without the read capability)."""
        counts = {}
        if self.env['liwan.access.service']._liwan_has_capability(self.env.user, READ):
            visible = self.env['liwan.inbox.conversation']._liwan_visible_domain()
            counts = {
                flow.id: count for flow, count in self.env['liwan.inbox.flow.submission']._read_group(
                    Domain.AND([Domain('flow_id', 'in', self.ids), Domain('conversation_id', 'any', visible)]),
                    ['flow_id'], ['__count'],
                )
            }
        for flow in self:
            flow.submission_count = counts.get(flow.id, 0)

    @api.constrains('category', 'language')
    def _check_meta_values(self):
        for flow in self:
            if flow.category not in CATEGORY_NAMES or not re.match(r'^[a-z]{2,3}(_[A-Z]{2})?$', flow.language or ''):
                raise ValidationError(self.env._('The form needs one of Meta\'s categories and a Meta language code such as ar or en_US.'))

    def unlink(self):
        if self.filtered(lambda flow: flow.status != 'draft'):
            raise UserError(self.env._('Only a draft form can be deleted; deprecate a published one instead.'))
        return super().unlink()

    # structure

    @api.model
    def _liwan_screen_commands(self, screens):
        """The o2m create commands of parsed screens (a list of {'title', 'footer_label', 'fields'}); option keys are generated."""
        return [
            (0, 0, {
                'sequence': position, 'title': screen['title'], 'footer_label': screen['footer_label'],
                'field_ids': [(0, 0, self._liwan_field_values(order, field)) for order, field in enumerate(screen['fields'])],
            })
            for position, screen in enumerate(screens)
        ]

    @api.model
    def _liwan_field_values(self, sequence, field):
        return {
            'sequence': sequence, 'kind': field['kind'],
            **{name: field.get(name) or False for name in FIELD_COLUMNS},
            'option_ids': [
                (0, 0, {'sequence': order, 'key': f'o{order + 1}', 'title': option['title'], 'description': option.get('description') or False})
                for order, option in enumerate(field.get('options', ()))
            ],
        }

    def _liwan_structure(self):
        """The screens as plain dicts, the input of the Flow JSON generator (and of a copy)."""
        self.ensure_one()
        return {'screens': [{
            'title': screen.title, 'footer_label': screen.footer_label,
            'fields': [field._liwan_plain() for field in screen.field_ids.sorted('sequence')],
        } for screen in self.screen_ids.sorted('sequence')]}

    def _liwan_input_fields(self):
        """The fields that collect an answer, in screen order."""
        self.ensure_one()
        return self.screen_ids.sorted('sequence').field_ids.filtered(lambda field: field.kind in INPUT_KINDS)

    # Meta

    @api.model
    def _liwan_create_remote(self, channel, values, screens):
        """Create a draft form (screens given as parsed dicts) and upload it to Meta; a provider error propagates and the caller rolls back."""
        flow = self.create({
            'channel_id': channel.id, **values, 'json_version': FLOW_JSON_VERSION,
            'screen_ids': self._liwan_screen_commands(screens),
        })
        flow._liwan_push(metadata_changed=False)
        return flow

    def _liwan_update_remote(self, values, screens):
        """Replace the draft's settings and screens and upload them to Meta."""
        self.ensure_one()
        self._liwan_require_editable()
        metadata_changed = values['name'] != self.name or values['category'] != self.category
        self.write({**values, 'screen_ids': [(5, 0, 0), *self._liwan_screen_commands(screens)]})
        self._liwan_push(metadata_changed)

    def _liwan_push(self, metadata_changed):
        """Send the generated Flow JSON to Meta (creating the draft there first) and replace the error rows with Meta's answer."""
        self.ensure_one()
        credentials = self.channel_id._liwan_credentials()
        text = flow_json.serialize(self._liwan_structure())
        digest = flow_json.digest(text)
        if not self.provider_flow_id:
            answer = whatsapp.create_flow(credentials, self.name, self.category, text)
            self.write({'provider_flow_id': answer['id'], 'uploaded_hash': digest})
            self._liwan_set_errors(answer['validation_errors'])
            return
        if metadata_changed:
            whatsapp.update_flow_metadata(credentials, self.provider_flow_id, self.name, self.category)
        if digest != self.uploaded_hash:
            self._liwan_set_errors(whatsapp.upload_flow_json(credentials, self.provider_flow_id, text))
            self.uploaded_hash = digest

    def _liwan_set_errors(self, errors):
        self.error_ids = [(5, 0, 0), *((0, 0, error) for error in errors)]

    def _liwan_require_editable(self):
        if not self.editable:
            raise UserError(self.env._('A published form cannot be changed; copy it to change it.'))

    def _liwan_publish_remote(self):
        """Publish the draft (irreversible), read back its state and, for a copy that replaces a form, take that form over."""
        self.ensure_one()
        if not self.editable:
            raise UserError(self.env._('Only a draft form can be published.'))
        if not self.provider_flow_id:
            self._liwan_push(metadata_changed=False)
        if self.error_ids:
            raise UserError(self.env._('Fix the problems Meta found before publishing the form.'))
        blockers = self._liwan_replace_blockers()
        if blockers:
            raise UserError(self.env._('Approved templates still open the form this copy replaces: %s', ', '.join(blockers.mapped('name'))))
        credentials = self.channel_id._liwan_credentials()
        whatsapp.publish_flow(credentials, self.provider_flow_id)
        # Meta published it: that is kept whatever happens next.
        self.write({'status': 'published', 'published_at': fields.Datetime.now()})
        self._liwan_settle(credentials)

    def _liwan_replace_blockers(self):
        """The approved templates whose form button opens the form this copy replaces (they would keep opening the old form)."""
        self.ensure_one()
        original = self.replaces_id
        if original.status != 'published' or not original.provider_flow_id:
            return self.env['liwan.inbox.template']
        return self.env['liwan.inbox.template'].search([
            ('channel_id', '=', self.channel_id.id), ('status', '=', 'approved'),
            ('button_ids.provider_flow_id', '=', original.provider_flow_id),
        ])

    def _liwan_settle(self, credentials):
        """After Meta published the form: read its state back and finish a pending replace.

        A provider failure is recorded in `last_error` and retried by the next synchronisation; it never undoes the publish.
        """
        self.ensure_one()
        try:
            self._liwan_refresh(credentials)
            if self.replaces_id:
                self._liwan_take_over(credentials)
        except whatsapp.ProviderError as error:
            _logger.warning('form %s: finishing the publish failed: %s', self.id, error)
            self.last_error = str(error)[:200]
        else:
            self.last_error = False

    def _liwan_refresh(self, credentials):
        """Read the status, Flow JSON version and health of the form from Meta."""
        self.ensure_one()
        details = whatsapp.flow_details(credentials, self.provider_flow_id)
        values = {'health': META_HEALTH.get(details['health'], 'unknown')}
        if details['status'] in META_STATUS:
            values['status'] = META_STATUS[details['status']]
        if details['json_version']:
            values['json_version'] = details['json_version']
        self.write(values)

    def _liwan_take_over(self, credentials):
        """Move the rules and automatic messages of the form this copy replaces to the copy, then deprecate the original.

        Repeating it is safe: `replaces_id` is cleared only when every step is done. The caller's forms capability writes
        the rules and automatic messages here (see MANAGE_FLOWS).
        """
        original = self.replaces_id
        if original.status == 'published':
            self.env['liwan.inbox.rule'].with_context(active_test=False).search([('flow_id', '=', original.id)]).write({'flow_id': self.id})
            self.env['liwan.inbox.auto.message'].search([('flow_id', '=', original.id)]).write({'flow_id': self.id})
            original._liwan_deprecate_remote(credentials)
        self.replaces_id = False

    def _liwan_deprecate_remote(self, credentials=None):
        self.ensure_one()
        if self.status != 'published':
            raise UserError(self.env._('Only a published form can be deprecated.'))
        whatsapp.deprecate_flow(credentials or self.channel_id._liwan_credentials(), self.provider_flow_id)
        self.write({'status': 'deprecated', 'health': 'unknown'})

    def _liwan_delete_remote(self):
        """Delete a draft at Meta and here; a form that a rule or an automatic message still uses stays."""
        self.ensure_one()
        if self.status != 'draft':
            raise UserError(self.env._('Only a draft form can be deleted; deprecate a published one instead.'))
        if self._liwan_is_used():
            raise UserError(self.env._('A rule or an automatic message still uses this form.'))
        if self.provider_flow_id:
            whatsapp.delete_flow(self.channel_id._liwan_credentials(), self.provider_flow_id)
        self.unlink()

    def _liwan_is_used(self):
        self.ensure_one()
        return bool(
            self.env['liwan.inbox.rule'].with_context(active_test=False).search_count([('flow_id', '=', self.id)])
            or self.env['liwan.inbox.auto.message'].search_count([('flow_id', '=', self.id)]),
        )

    def _liwan_copy(self, name, replace):
        """A new draft with this form's settings and screens (the way to change a published form)."""
        self.ensure_one()
        if not self.supported:
            raise UserError(self.env._('A form made in WhatsApp Manager cannot be copied.'))
        if replace and self.status != 'published':
            raise UserError(self.env._('Only a published form can be replaced by its copy.'))
        values = {
            'name': name, 'category': self.category, 'language': self.language,
            'completion_message': self.completion_message or False, 'replaces_id': self.id if replace else False,
        }
        return self._liwan_create_remote(self.channel_id, values, self._liwan_structure()['screens'])

    def _liwan_preview(self):
        self.ensure_one()
        if not self.provider_flow_id:
            raise UserError(self.env._('The form is not on Meta yet.'))
        return whatsapp.flow_preview(self.channel_id._liwan_credentials(), self.provider_flow_id)

    # sending

    def _liwan_sendable_in(self, channel):
        """True when this form (an empty one never is) may be sent on `channel` now: published, not blocked and of that channel."""
        return bool(self) and self.sendable and self.channel_id == channel

    def _liwan_message_values(self):
        """The fields of the outbound message that says the completion message (read like an automatic message)."""
        self.ensure_one()
        return {'kind': 'text', 'body': self.completion_message}

    @api.model
    def _liwan_seed_starters(self, company, key):
        """Add the sector's starter forms as local drafts to each channel of the company that lacks them; idempotent.

        A starter is never published, and reaches Meta only when its owner first saves it.
        """
        for channel in self.env['liwan.inbox.channel'].search([('owner_company_id', '=', company.id)]):
            names = set(self.search([('channel_id', '=', channel.id)]).mapped('name'))
            for starter in FLOW_STARTERS.get(key, ()):
                if starter['name'] not in names:
                    self.create({
                        'channel_id': channel.id, 'name': starter['name'], 'category': starter['category'],
                        'language': starter['language'], 'completion_message': starter['completion_message'],
                        'json_version': FLOW_JSON_VERSION, 'screen_ids': self._liwan_screen_commands(starter['screens']),
                    })

    # synchronisation and webhook

    @api.model
    def _liwan_unique_name(self, channel, name):
        taken = set(self.search([('channel_id', '=', channel.id)]).mapped('name'))
        candidate, number = name, 1
        while candidate in taken:
            number += 1
            candidate = f'{name} ({number})'
        return candidate

    @api.model
    def _liwan_sync(self, channel):
        """Update the status and health of the channel's forms from Meta, import the forms made in WhatsApp Manager as
        unsupported ones and remove the unused local drafts that Meta no longer lists."""
        credentials = channel._liwan_credentials()
        remote = {item['id']: item for item in whatsapp.list_flows(credentials)}
        current = self.search([('channel_id', '=', channel.id)])
        known = {flow.provider_flow_id: flow for flow in current if flow.provider_flow_id}
        for provider_id, item in remote.items():
            status = META_STATUS.get(item['status'], 'draft')
            flow = known.get(provider_id)
            if not flow:
                flow = self.create({
                    'channel_id': channel.id, 'provider_flow_id': provider_id, 'supported': False, 'status': status,
                    'name': self._liwan_unique_name(channel, item['name']),
                    'category': item['category'] if item['category'] in CATEGORY_NAMES else 'other',
                })
            elif flow.status != status:
                flow.status = status
            if flow.status == 'draft':
                flow._liwan_set_errors(item['validation_errors'])
        current.filtered(
            lambda flow: flow.status == 'draft' and flow.provider_flow_id and flow.provider_flow_id not in remote
            and not flow._liwan_is_used(),
        ).unlink()
        flows = self.search([('channel_id', '=', channel.id)])
        for flow in flows.filtered(lambda flow: flow.status in LIVE_STATUSES):
            if flow.status == 'published' and flow.replaces_id:
                flow._liwan_settle(credentials)
            else:
                flow._liwan_refresh(credentials)
        return flows

    @api.model
    def _liwan_apply_update(self, channel, update):
        """Apply a form webhook change to the channel's form it names; an unknown form waits for the next sync."""
        flow = self.search([('channel_id', '=', channel.id), ('provider_flow_id', '=', update.flow_id)], limit=1)
        if not flow:
            return
        if isinstance(update, whatsapp.FlowStatusUpdate):
            if update.new_status in META_STATUS:
                flow.status = META_STATUS[update.new_status]
        else:
            flow.version_warning = update.warning


class LiwanInboxFlowScreen(models.Model):
    """One screen of a form: a title, its fields in order and a footer button (next, or submit on the last)."""
    _name = 'liwan.inbox.flow.screen'
    _description = 'Customer Inbox form screen'
    _order = 'sequence, id'
    _liwan_scope = 'company'

    flow_id = fields.Many2one('liwan.inbox.flow', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='flow_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    title = fields.Char(required=True)
    footer_label = fields.Char(required=True)
    field_ids = fields.One2many('liwan.inbox.flow.field', 'screen_id')
    # Meta's screen id (SCREEN_A, SCREEN_B, ...), from the position.
    key = fields.Char(compute='_compute_key')

    @api.depends('flow_id.screen_ids.sequence', 'sequence')
    def _compute_key(self):
        for screen in self:
            screens = screen.flow_id.screen_ids.sorted('sequence')
            screen.key = flow_json.screen_id(screens.ids.index(screen.id)) if screen.id in screens.ids else False


class LiwanInboxFlowField(models.Model):
    """A component of a screen: a text to show, or an input that collects one answer under its `key`."""
    _name = 'liwan.inbox.flow.field'
    _description = 'Customer Inbox form field'
    _order = 'sequence, id'
    _liwan_scope = 'company'

    screen_id = fields.Many2one('liwan.inbox.flow.screen', required=True, index=True, ondelete='cascade')
    flow_id = fields.Many2one(related='screen_id.flow_id', store=True, index=True)
    company_id = fields.Many2one(related='screen_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    kind = fields.Selection(FIELD_KINDS, required=True)
    # The name of the answer; input kinds only.
    key = fields.Char()
    text = fields.Text()
    label = fields.Char()
    required = fields.Boolean()
    sensitive = fields.Boolean()
    input_type = fields.Selection(INPUT_TYPES)
    helper_text = fields.Char()
    # 0 leaves Meta's default.
    min_chars = fields.Integer()
    max_chars = fields.Integer()
    max_length = fields.Integer()
    min_selected = fields.Integer()
    max_selected = fields.Integer()
    min_date = fields.Date()
    max_date = fields.Date()
    option_ids = fields.One2many('liwan.inbox.flow.option', 'field_id')

    _flow_key_unique = models.UniqueIndex('(flow_id, key) WHERE key IS NOT NULL', 'An answer key is unique in a form.')

    @api.constrains('kind', 'key', 'text', 'label', 'option_ids')
    def _check_shape(self):
        for field in self:
            if field.kind in DISPLAY_KINDS:
                valid = bool(field.text) and not field.key
            else:
                valid = bool(field.label) and bool(FIELD_KEY.match(field.key or '')) and field.key != RESERVED_KEY
                valid = valid and (bool(field.option_ids) == (field.kind in CHOICE_KINDS))
            if not valid:
                raise ValidationError(self.env._('A form field needs the parts of its kind: a text, or a label, a key and (for choices) options.'))

    def _liwan_plain(self):
        """The field as the plain dict of the generator."""
        self.ensure_one()
        return {
            'kind': self.kind, 'key': self.key or None, 'text': self.text or None, 'label': self.label or None,
            'required': self.required, 'sensitive': self.sensitive, 'input_type': self.input_type or None,
            'helper_text': self.helper_text or None, 'min_chars': self.min_chars or None, 'max_chars': self.max_chars or None,
            'max_length': self.max_length or None, 'min_selected': self.min_selected or None,
            'max_selected': self.max_selected or None,
            'min_date': self.min_date.isoformat() if self.min_date else None,
            'max_date': self.max_date.isoformat() if self.max_date else None,
            'options': [
                {'key': option.key, 'title': option.title, 'description': option.description or None}
                for option in self.option_ids.sorted('sequence')
            ],
        }


class LiwanInboxFlowOption(models.Model):
    """A choice of a dropdown, radio or checkbox field; its key (o1, o2, ...) is generated."""
    _name = 'liwan.inbox.flow.option'
    _description = 'Customer Inbox form choice'
    _order = 'sequence, id'
    _liwan_scope = 'company'

    field_id = fields.Many2one('liwan.inbox.flow.field', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='field_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    key = fields.Char(required=True)
    title = fields.Char(required=True)
    description = fields.Char()


class LiwanInboxFlowError(models.Model):
    """A problem Meta found in the uploaded form; publishing waits until there are none."""
    _name = 'liwan.inbox.flow.error'
    _description = 'Customer Inbox form validation error'
    _order = 'id'
    _liwan_scope = 'company'

    flow_id = fields.Many2one('liwan.inbox.flow', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='flow_id.company_id', store=True, index=True)
    message = fields.Char(required=True)
    path = fields.Char()
    line = fields.Integer()
    column = fields.Integer()
