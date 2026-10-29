# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import secrets

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from . import secret_box
from .constants import WHATSAPP_FEATURE
from odoo.addons.webvue_inbox.adapters.whatsapp import Credentials

PROVIDER_ID = re.compile(r'^\d{5,32}$')
# The ciphertext columns are readable by the webhook identity, the channel managers and the template managers
# (who call Meta with the channel's token) only.
SECRET_GROUPS = (
    'webvue_inbox.group_inbox_hook,webvue_inbox.group_cap_inbox_channels_manage,'
    'webvue_inbox.group_cap_inbox_templates_manage'
)


def _new_verify_token():
    return secrets.token_urlsafe(24)


class WebVueInboxChannel(models.Model):
    _name = 'webvue.inbox.channel'
    _description = 'Customer Inbox channel'
    _order = 'name, id'
    # Tenant scope: the channel is the tenant's webhook routing record (phone_number_id is unique in
    # the database) and the webhook resolves it before any company context exists, so it must reach
    # channels of every company, which webvue_core's per-request company fence (keyed on a field
    # called company_id) would refuse. Each channel still has an owning company: staff reach only
    # their companies' channels through the group rule on owner_company_id (security/inbox_rules.xml)
    # and the per-company capability check in controllers/helpers.py.
    _webvue_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                       default=lambda self: self.env.company)
    name = fields.Char(required=True)
    kind = fields.Selection([('whatsapp', 'WhatsApp')], required=True, default='whatsapp')
    state = fields.Selection(
        [('draft', 'Draft'), ('connected', 'Connected'), ('error', 'Error'), ('disabled', 'Disabled')],
        required=True, default='draft', index=True,
    )
    department_id = fields.Many2one('webvue.inbox.department', ondelete='set null')
    phone_number_id = fields.Char(required=True)
    business_account_id = fields.Char(required=True)
    # The Meta app id: needed only to upload the sample file of a media-header template (not a secret).
    app_id = fields.Char()
    access_token_enc = fields.Char(groups=SECRET_GROUPS, copy=False)
    app_secret_enc = fields.Char(groups=SECRET_GROUPS, copy=False)
    verify_token = fields.Char(required=True, copy=False, default=lambda self: _new_verify_token())
    last_error = fields.Char()
    last_event_at = fields.Datetime()
    conversation_ids = fields.One2many('webvue.inbox.conversation', 'channel_id')
    # Automation: the welcome and away messages (auto_message_ids) and the satisfaction survey.
    auto_message_ids = fields.One2many('webvue.inbox.auto.message', 'channel_id')
    welcome_enabled = fields.Boolean(default=False)
    welcome_idle_days = fields.Integer(default=0)
    away_enabled = fields.Boolean(default=False)
    away_repeat_hours = fields.Integer(default=12)
    csat_enabled = fields.Boolean(default=False)
    csat_question = fields.Char(required=True, default='كيف كانت تجربتك معنا؟')
    csat_good = fields.Char(required=True, default='ممتاز')
    csat_neutral = fields.Char(required=True, default='مقبول')
    csat_bad = fields.Char(required=True, default='سيئ')

    _phone_number_unique = models.Constraint(
        'UNIQUE(phone_number_id)', 'This WhatsApp phone number id is already connected.',
    )

    @api.constrains('welcome_idle_days', 'away_repeat_hours')
    def _check_automation_ranges(self):
        for channel in self:
            if not 0 <= channel.welcome_idle_days <= 365 or not 1 <= channel.away_repeat_hours <= 168:
                raise ValidationError(self.env._('welcome_idle_days must be 0 to 365 and away_repeat_hours 1 to 168.'))

    @api.constrains('csat_question', 'csat_good', 'csat_neutral', 'csat_bad')
    def _check_survey_texts(self):
        for channel in self:
            if len(channel.csat_question) > 1024 or any(
                not 1 <= len(label) <= 20 for label in (channel.csat_good, channel.csat_neutral, channel.csat_bad)
            ):
                raise ValidationError(self.env._('The survey question is at most 1024 characters and each answer 1 to 20.'))

    @api.constrains('app_id')
    def _check_app_id(self):
        for channel in self.filtered('app_id'):
            if not PROVIDER_ID.match(channel.app_id):
                raise ValidationError(self.env._('The Meta app id must be 5 to 32 digits.'))

    @api.constrains('phone_number_id', 'business_account_id')
    def _check_provider_ids(self):
        for channel in self:
            if not (PROVIDER_ID.match(channel.phone_number_id or '') and PROVIDER_ID.match(channel.business_account_id or '')):
                raise ValidationError(self.env._('Phone number id and business account id must be 5 to 32 digits.'))

    @api.model_create_multi
    def create(self, vals_list):
        entitlement = self.env['webvue.entitlement.service']
        entitlement.require(WHATSAPP_FEATURE)
        entitlement._webvue_claim_channels(len(vals_list))
        return super().create(vals_list)

    def unlink(self):
        if self.conversation_ids:
            raise UserError(self.env._('A channel with conversations cannot be deleted; disable it instead.'))
        self.env['webvue.entitlement.service']._webvue_claim_channels(-len(self))
        return super().unlink()

    @api.model
    def _webvue_secret_values(self, access_token=None, app_secret=None):
        """The ciphertext column values for the given plain secrets (only those given)."""
        values = {}
        if access_token is not None:
            values['access_token_enc'] = secret_box.encrypt(self.env, access_token)
        if app_secret is not None:
            values['app_secret_enc'] = secret_box.encrypt(self.env, app_secret)
        return values

    def _webvue_credentials(self):
        self.ensure_one()
        if not self.access_token_enc:
            raise UserError(self.env._('The channel has no access token.'))
        return Credentials(
            phone_number_id=self.phone_number_id,
            business_account_id=self.business_account_id,
            access_token=secret_box.decrypt(self.env, self.access_token_enc),
        )

    def _webvue_app_secret(self):
        self.ensure_one()
        return secret_box.decrypt(self.env, self.app_secret_enc) if self.app_secret_enc else None

    def _webvue_auto_message(self, purpose):
        """The welcome or away message of the channel (empty when none is set)."""
        self.ensure_one()
        return self.auto_message_ids.filtered(lambda message: message.purpose == purpose)

    def _webvue_set_auto_message(self, purpose, content):
        """Store the welcome or away content (model values; None removes it)."""
        self.ensure_one()
        self.env['webvue.inbox.auto.message']._webvue_upsert(
            self._webvue_auto_message(purpose), {'purpose': purpose, 'channel_id': self.id}, content,
        )

    def _webvue_fill_automation(self, welcome, away):
        """Set the welcome and away messages that the channel does not have yet (a sector preset); they stay as switched."""
        self.ensure_one()
        for purpose, content in (('welcome', welcome), ('away', away)):
            if content and not self._webvue_auto_message(purpose):
                self._webvue_set_auto_message(purpose, content)
