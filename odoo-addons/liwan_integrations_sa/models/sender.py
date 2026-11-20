# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.liwan_integrations_sa import providers

CHANNELS = [('sms', 'SMS'), ('whatsapp', 'WhatsApp'), ('voice', 'Voice')]
KINDS = [('alphanumeric', 'Alphanumeric sender ID'), ('number', 'Phone number'), ('service', 'Messaging service')]
# The kinds each channel accepts, and the provider capability a channel needs from the connection.
CHANNEL_KINDS = {
    'sms': ('alphanumeric', 'number', 'service'),
    'whatsapp': ('number', 'service'),
    'voice': ('number',),
}
CHANNEL_CAPABILITIES = {'sms': 'messaging.send', 'whatsapp': 'messaging.send', 'voice': 'voice.call'}
# A number of these channels must be one of the account's own numbers with the matching capability.
ACCOUNT_NUMBER_CHANNELS = ('sms', 'voice')
KIND_PATTERNS = {
    'alphanumeric': re.compile(r'(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}'),
    'number': re.compile(r'\+[1-9]\d{6,14}'),
    'service': re.compile(r'MG[0-9a-f]{32}'),
}
CHECKED_FIELDS = ('connection_id', 'channel', 'kind', 'value', 'active')


class LiwanIntegrationSender(models.Model):
    """One sender a company sends messages or places calls from, on one of its provider connections.

    A sender is archived, never deleted, while its connection lives: the log rows keep a snapshot of its value.
    Archived senders go away with their connection.
    """
    _name = 'liwan.integration.sender'
    _description = 'LiwanOS integration sender'
    _liwan_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    connection_id = fields.Many2one('liwan.integration.connection', required=True, index=True, ondelete='cascade')
    channel = fields.Selection(CHANNELS, required=True)
    value = fields.Char(required=True)
    kind = fields.Selection(KINDS, required=True)
    is_default = fields.Boolean(default=False)
    active = fields.Boolean(default=True)

    _active_value_unique = models.UniqueIndex(
        '(company_id, connection_id, channel, value) WHERE active IS TRUE',
        'This sender is already added for this channel.',
    )
    _active_default_unique = models.UniqueIndex(
        '(company_id, channel) WHERE is_default IS TRUE AND active IS TRUE',
        'A channel has one default sender.',
    )

    @api.constrains('company_id', 'connection_id', 'channel', 'kind', 'value')
    def _check_channel_rules(self):
        for sender in self:
            if sender.connection_id.company_id != sender.company_id:
                raise ValidationError(self.env._('The sender and its connection belong to different companies.'))
            if sender.kind not in CHANNEL_KINDS[sender.channel]:
                raise ValidationError(self.env._(
                    'A %(channel)s sender cannot be of kind %(kind)s.', channel=sender.channel, kind=sender.kind,
                ))
            if not KIND_PATTERNS[sender.kind].fullmatch(sender.value or ''):
                raise ValidationError(self.env._('%(value)s is not a valid %(kind)s sender.', value=sender.value, kind=sender.kind))
            capability = CHANNEL_CAPABILITIES[sender.channel]
            if capability not in sender.connection_id._liwan_definition()['capabilities']:
                raise ValidationError(self.env._(
                    'The provider of this connection cannot be used for %(channel)s.', channel=sender.channel,
                ))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('is_default') and vals.get('active', True):
                self._liwan_release_default(vals.get('company_id') or self.env.company.id, vals.get('channel'))
        senders = super().create(vals_list)
        senders._liwan_check_on_account()
        return senders

    def write(self, vals):
        if vals.get('active') is False:
            vals = {**vals, 'is_default': False}
        if vals.get('is_default'):
            for sender in self:
                self._liwan_release_default(sender.company_id.id, vals.get('channel', sender.channel), keep=self)
        result = super().write(vals)
        if set(vals) & set(CHECKED_FIELDS):
            self._liwan_check_on_account()
        return result

    @api.model
    def _liwan_release_default(self, company_id, channel, keep=None):
        """The current default of a company's channel steps down, so a new one can take its place."""
        previous = self.search([
            ('company_id', '=', company_id), ('channel', '=', channel), ('is_default', '=', True),
            ('id', 'not in', (keep or self.browse()).ids),
        ])
        if previous:
            previous.write({'is_default': False})
            previous.flush_recordset(['is_default'])

    def _liwan_check_on_account(self):
        """An active number sender of SMS or voice must be one of the account's numbers with that capability."""
        for sender in self.filtered(lambda row: row.active and row.kind == 'number' and row.channel in ACCOUNT_NUMBER_CHANNELS):
            available = sender.connection_id._liwan_account_numbers()
            if not any(number['value'] == sender.value and number[sender.channel] for number in available):
                raise ValidationError(self.env._(
                    '%(value)s is not a number of this account that can be used for %(channel)s.',
                    value=sender.value, channel=sender.channel,
                ))

    def _liwan_archive(self):
        """The DELETE of a sender: archived, so the logs that name it keep their snapshot."""
        self.write({'active': False})


class LiwanIntegrationConnectionNumbers(models.Model):
    _inherit = 'liwan.integration.connection'

    def _liwan_account_numbers(self):
        """``[{'value', 'label', 'sms', 'voice'}]`` of the account behind the connection, read from the provider.

        Needs the provider's ``senders.list`` capability; a provider failure is raised as is.
        """
        self.ensure_one()
        if 'senders.list' not in self._liwan_definition()['capabilities']:
            raise ValidationError(self.env._('This provider cannot list the numbers of its account.'))
        return providers.MODULES[self.provider].list_numbers(self.external_id, self._liwan_provider_credentials())
