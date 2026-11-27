# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A line: how a company's calls reach the outside world, and how they arrive.

Two technical modes (design section 5):

* mode ``a``: Liwan's Asterisk connects to the provider, and ``auth_method`` says how: an allowlisted address (``ip``)
  or a username and password (``credentials``).
* mode ``b``: a device at the company site (an FXO or GSM gateway) registers to Liwan.

The company's numbers on the line are rows of ``liwan.telephony.line.number``. No provider password is stored here.
"""
import re

from odoo import api, fields, models

KINDS = (
    ('sip_trunk', 'SIP trunk from a provider'),
    ('analog_gateway', 'Analog line through a gateway'),
    ('mobile_gateway', 'Mobile SIM through a gateway'),
)
MODES = (('a', 'Liwan connects to the provider'), ('b', 'The device registers to Liwan'))
AUTH_METHODS = (('ip', 'Provider allowlists our address'), ('credentials', 'Username and password'))
NAME_MAX_LENGTH = 120
HOST_MAX_LENGTH = 253
# A provider host is a lower or mixed case host name or an IPv4 address: letters, digits, dots and inner hyphens.
PROVIDER_HOST = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$')
PORT_MIN, PORT_MAX = 1, 65535
DEFAULT_PROVIDER_PORT = 5060
CONCURRENT_MIN, CONCURRENT_MAX = 1, 1000
DEFAULT_MAX_CONCURRENT = 1
# The digits the provider wants before every dialled number; none means it wants the number as dialled.
DIAL_PREFIX_MAX_DIGITS = 10
# E.164: a plus, a country code that does not start with zero, and at most fifteen digits in all.
E164 = re.compile(r'^\+[1-9][0-9]{6,14}$')


class LiwanTelephonyLine(models.Model):
    _name = 'liwan.telephony.line'
    _description = 'Telephony line'
    _liwan_scope = 'company'
    _order = 'name'
    _rec_name = 'name'

    name = fields.Char(required=True)
    kind = fields.Selection(KINDS, required=True, default='sip_trunk')
    mode = fields.Selection(MODES, compute='_compute_mode', store=True)
    auth_method = fields.Selection(AUTH_METHODS, default='credentials', required=True)
    provider_host = fields.Char()
    provider_port = fields.Integer(default=DEFAULT_PROVIDER_PORT, required=True)
    number_ids = fields.One2many('liwan.telephony.line.number', 'line_id')
    outbound_format = fields.Char(help='The digits the provider wants before every dialled number, for example 9665.')
    caller_id = fields.Char(help='The number shown to the called party.')
    max_concurrent = fields.Integer(default=DEFAULT_MAX_CONCURRENT, required=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )

    @api.depends('kind')
    def _compute_mode(self):
        for line in self:
            line.mode = 'a' if line.kind == 'sip_trunk' else 'b'


class LiwanTelephonyLineNumber(models.Model):
    _name = 'liwan.telephony.line.number'
    _description = 'Telephony line number'
    _liwan_scope = 'company'
    _order = 'line_id, number'

    line_id = fields.Many2one('liwan.telephony.line', required=True, ondelete='cascade', index=True)
    number = fields.Char(required=True)
    company_id = fields.Many2one('res.company', related='line_id.company_id', store=True, index=True)

    _number_unique = models.Constraint('unique(line_id, number)', 'A line lists each of its numbers once.')
    _number_e164 = models.Constraint(
        "CHECK(number ~ '^\\+[1-9][0-9]{6,14}$')", 'A line number is in E.164.',
    )
