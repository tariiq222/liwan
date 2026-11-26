# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A line: how a company's calls reach the outside world, and how they arrive.

Two technical modes (design section 5):

* mode ``a``: Liwan's Asterisk connects to the provider. ``auth_method`` says how: an allowlisted address (``ip``)
  or a username and password (``credentials``).
* mode ``b``: a device at the company site (an FXO or GSM gateway, later an existing PBX) registers to Liwan.

The password never lives in this table. It travels once to ``pbx-agent``, which keeps it in the Asterisk realtime
database of the company's package, and Odoo keeps only the fact that one exists.
"""
from odoo import api, fields, models


class LiwanTelephonyLine(models.Model):
    _name = 'liwan.telephony.line'
    _description = 'Telephony line'
    _liwan_scope = 'company'
    _order = 'name'
    _rec_name = 'name'

    name = fields.Char(required=True)
    kind = fields.Selection(
        [
            ('sip_trunk', 'SIP trunk from a provider'),
            ('analog_gateway', 'Analog line through a gateway'),
            ('mobile_gateway', 'Mobile SIM through a gateway'),
            ('existing_pbx', 'Existing PBX at the company'),
        ],
        required=True, default='sip_trunk',
    )
    mode = fields.Selection(
        [('a', 'Liwan connects to the provider'), ('b', 'The device registers to Liwan')],
        compute='_compute_mode', store=True,
    )
    auth_method = fields.Selection(
        [('ip', 'Provider allowlists our address'), ('credentials', 'Username and password')],
        default='credentials',
    )
    provider_host = fields.Char()
    provider_port = fields.Integer(default=5060)
    numbers = fields.Char(help='The company numbers on this line, comma separated, in E.164.')
    outbound_format = fields.Char(help='How the provider wants the dialled number, for example 9665 or 05.')
    caller_id = fields.Char(help='The number shown to the called party.')
    max_concurrent = fields.Integer(default=1)
    state = fields.Selection(
        [
            ('unknown', 'Not tested'),
            ('connected', 'Connected'),
            ('not_registered', 'Not registered'),
            ('failed', 'Failed'),
        ],
        default='unknown', readonly=True,
    )
    state_detail = fields.Char(readonly=True, help='The provider reply when the last test failed.')
    has_password = fields.Boolean(readonly=True, help='A password was delivered to the PBX. It is never read back.')
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )

    @api.depends('kind')
    def _compute_mode(self):
        for line in self:
            line.mode = 'a' if line.kind in ('sip_trunk',) else 'b'

    @api.constrains('kind')
    def _check_kind_is_selectable(self):
        """An existing PBX is decided later (D7): the option shows disabled, and the server refuses it too."""
        for line in self:
            if line.kind == 'existing_pbx':
                message = 'Connecting an existing PBX is not available yet.'
                raise models.ValidationError(message)
