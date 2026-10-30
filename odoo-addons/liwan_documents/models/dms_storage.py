# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class DmsStorage(models.Model):
    _inherit = 'dms.storage'

    liwan_documents_managed = fields.Boolean(default=False, readonly=True, index=True)
    _liwan_company_unique = models.UniqueIndex(
        '(company_id) WHERE liwan_documents_managed',
        'One managed document storage per company.',
    )

    @api.constrains(
        'liwan_documents_managed',
        'company_id',
        'save_type',
        'model_ids',
        'inherit_access_from_parent_record',
        'include_message_attachments',
    )
    def _liwan_check_configuration(self):
        for storage in self:
            models_set = set(storage.model_ids.mapped('model'))
            if storage.liwan_documents_managed:
                if (
                    not storage.company_id
                    or storage.save_type != 'attachment'
                    or not storage.inherit_access_from_parent_record
                    or storage.include_message_attachments
                    or models_set != {'liwan.document'}
                ):
                    msg = 'managed document storage configuration is immutable'
                    raise ValidationError(
                        msg,
                    )
            elif 'liwan.document' in models_set:
                msg = 'document attachments require their managed storage'
                raise ValidationError(
                    msg,
                )

    @api.model_create_multi
    def create(self, values):
        if not self.env.user._is_superuser() and any(
            item.get(
                'liwan_documents_managed',
                self.env.context.get('default_liwan_documents_managed'),
            )
            for item in values
        ):
            msg = 'document storage is operator-owned'
            raise AccessError(msg)
        return super().create(values)

    def write(self, values):
        if not self.env.user._is_superuser() and (
            any(self.mapped('liwan_documents_managed'))
            or 'liwan_documents_managed' in values
        ):
            msg = 'document storage is operator-owned'
            raise AccessError(msg)
        return super().write(values)

    def unlink(self):
        if not self.env.user._is_superuser() and any(
            self.mapped('liwan_documents_managed'),
        ):
            msg = 'document storage cannot be deleted'
            raise AccessError(msg)
        return super().unlink()

    def read(self, fields=None, load='_classic_read'):
        if not self.env.user._is_superuser():
            for storage in self:
                if storage.liwan_documents_managed and (
                    storage.company_id != self.env.company
                    or not self.env['liwan.document']._liwan_actor_allows('read')
                ):
                    msg = 'document storage is not accessible'
                    raise AccessError(msg)
        return super().read(fields, load=load)
