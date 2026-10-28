# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import secrets

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from . import secret_box
from .constants import WHATSAPP_FEATURE
from odoo.addons.webvue_inbox.adapters.whatsapp import Credentials

PROVIDER_ID = re.compile(r'^\d{5,32}$')
# The ciphertext columns are readable by the webhook identity and the channel managers only.
SECRET_GROUPS = 'webvue_inbox.group_inbox_hook,webvue_inbox.group_cap_inbox_channels_manage'


def _new_verify_token():
    return secrets.token_urlsafe(24)


class WebVueInboxChannel(models.Model):
    _name = 'webvue.inbox.channel'
    _description = 'Customer Inbox channel'
    _order = 'name, id'
    _webvue_scope = 'company'

    # Not named company_id on purpose: the webhook resolves a channel before any tenant context
    # exists, so it must reach channels of every company, which webvue_core's per-request company
    # fence (keyed on a field called company_id) would refuse. Staff isolation is the group rule
    # on this field (security/inbox_rules.xml).
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
    access_token_enc = fields.Char(groups=SECRET_GROUPS, copy=False)
    app_secret_enc = fields.Char(groups=SECRET_GROUPS, copy=False)
    verify_token = fields.Char(required=True, copy=False, default=lambda self: _new_verify_token())
    last_error = fields.Char()
    last_event_at = fields.Datetime()
    conversation_ids = fields.One2many('webvue.inbox.conversation', 'channel_id')

    _phone_number_unique = models.Constraint(
        'UNIQUE(phone_number_id)', 'This WhatsApp phone number id is already connected.',
    )

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
