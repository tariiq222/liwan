# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

KIND_EXPORT = 'export'
KIND_ERASE = 'erase'
REASON_MAX = 500


class LiwanCustomersPrivacyRequest(models.Model):
    """The log of a completed privacy request about one customer (PDPL): who asked, for which partner id and why, and
    what each application held or cleared.

    The row is written once, in the transaction of the operation, so it exists only for an operation that happened
    (its ``create_date`` is the time). It holds no personal data: the partner is an id, never a name, and the counts
    are numbers. The reason is the requester's own text. Nothing edits or deletes it: no ACL row grants ``write`` or
    ``unlink``, and the methods refuse both for everyone but the superuser of a migration.
    """
    _name = 'liwan.customers.privacy.request'
    _description = 'LiwanOS customer privacy request'
    _order = 'id desc'
    _liwan_scope = 'company'

    partner_id = fields.Integer(required=True, index=True, readonly=True)
    kind = fields.Selection([(KIND_EXPORT, 'Export'), (KIND_ERASE, 'Erase')], required=True, readonly=True)
    user_id = fields.Many2one('res.users', string='Requester', required=True, readonly=True, ondelete='restrict',
                              default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', required=True, readonly=True, ondelete='restrict', index=True,
                                 default=lambda self: self.env.company)
    reason = fields.Text(required=True, readonly=True)
    counts = fields.Json(readonly=True)

    _liwan_reason_length = models.Constraint(
        f'CHECK(char_length(reason) BETWEEN 1 AND {REASON_MAX})', 'the reason is 1 to 500 characters',
    )

    def write(self, vals):
        if not self.env.is_superuser():
            msg = 'privacy_request_immutable: a privacy request is never edited'
            raise AccessError(msg)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            msg = 'privacy_request_immutable: a privacy request is never deleted'
            raise AccessError(msg)
        return super().unlink()
