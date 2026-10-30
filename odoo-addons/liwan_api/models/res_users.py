# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

APPEARANCE_MODES = ('light', 'cream', 'dark')
FONT_SIZES = ('small', 'medium', 'large')
# Personal display preferences: each user writes their own through
# /api/v1/me/appearance, so they are self-writable and never part of the
# access-managed identity.
APPEARANCE_FIELDS = ('liwan_appearance_mode', 'liwan_font_size')


class LiwanApiResUsers(models.Model):
    _inherit = 'res.users'

    liwan_appearance_mode = fields.Selection(
        [('light', 'Light'), ('cream', 'Cream'), ('dark', 'Dark')],
        default='light',
        required=True,
    )
    liwan_font_size = fields.Selection(
        [('small', 'Small'), ('medium', 'Medium'), ('large', 'Large')],
        default='small',
        required=True,
    )

    @property
    def SELF_READABLE_FIELDS(self):
        return super().SELF_READABLE_FIELDS + list(APPEARANCE_FIELDS)

    @property
    def SELF_WRITEABLE_FIELDS(self):
        return super().SELF_WRITEABLE_FIELDS + list(APPEARANCE_FIELDS)

    def _liwan_unversioned_fields(self):
        # A display preference is not an access change; it must not bump the
        # user's access version that administrators lock against.
        return super()._liwan_unversioned_fields() | set(APPEARANCE_FIELDS)
