# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

KIND_REQUEST = 'request'
KIND_BUILT = 'built'
KIND_DOWNLOAD = 'download'


class LiwanTenantExportLog(models.Model):
    """The log of the tenant data export: who asked, when the archive was built and who downloaded it.

    A row holds ids and counts only, never a name or a value from the export. It is written once, in the transaction of
    the event, and nothing edits or deletes it: no ACL row grants ``write`` or ``unlink``, and the methods refuse both
    for everyone but the superuser of a migration.
    """
    _name = 'liwan.tenant.export.log'
    _description = 'LiwanOS tenant export log'
    _order = 'id desc'
    _liwan_scope = 'tenant'

    export_id = fields.Integer(required=True, index=True, readonly=True)
    kind = fields.Selection(
        [(KIND_REQUEST, 'Request'), (KIND_BUILT, 'Built'), (KIND_DOWNLOAD, 'Download')], required=True, readonly=True,
    )
    # The account is an id with no foreign key: removing the account is never blocked, and the row holds no name.
    actor_id = fields.Integer(string='Who', required=True, readonly=True, default=lambda self: self.env.user.id)
    counts = fields.Json(readonly=True)

    def write(self, vals):
        if not self.env.is_superuser():
            msg = 'export_log_immutable: an export log row is never edited'
            raise AccessError(msg)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            msg = 'export_log_immutable: an export log row is never deleted'
            raise AccessError(msg)
        return super().unlink()
