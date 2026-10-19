# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError


def require_library(records):
    if records.env.user._is_superuser():
        return
    records.env['webvue.entitlement.service'].require('documents.enabled')
    records.env['webvue.access.service']._webvue_require_capability(
        'documents.library.manage',
    )
    if records and any(record.company_id != records.env.company for record in records):
        msg = 'document metadata belongs to another company'
        raise AccessError(msg)


def metadata_create(model, values, parent_create):
    require_library(model)
    if not model.env.user._is_superuser():
        values = [dict(item, company_id=model.env.company.id) for item in values]
        if any(
            set(item)
            & {
                'group_ids',
                'explicit_user_ids',
                'users',
                'directory_ids',
                'complete_directory_ids',
            }
            for item in values
        ):
            msg = 'document access is managed on the document, not DMS groups'
            raise AccessError(
                msg,
            )
    return parent_create(values)


def metadata_write(records, values, parent_write):
    require_library(records)
    if not records.env.user._is_superuser() and (
        set(values)
        & {
            'company_id',
            'group_ids',
            'explicit_user_ids',
            'users',
            'directory_ids',
            'complete_directory_ids',
        }
    ):
        msg = 'document metadata identity and memberships are protected'
        raise AccessError(msg)
    return parent_write(values)


class DmsTag(models.Model):
    _inherit = 'dms.tag'
    _check_company_auto = True
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )
    category_id = fields.Many2one(check_company=True)
    _name_uniq = models.Constraint(
        'UNIQUE(name,company_id)', 'Tag name already exists in this company.',
    )

    @api.model_create_multi
    def create(self, values):
        return metadata_create(self, values, super().create)

    def write(self, values):
        return metadata_write(self, values, super().write)

    def unlink(self):
        if not self.env.user._is_superuser():
            msg = 'document metadata cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()


class DmsCategory(models.Model):
    _inherit = 'dms.category'
    _check_company_auto = True
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )
    parent_id = fields.Many2one(check_company=True)
    _name_uniq = models.Constraint(
        'UNIQUE(name,company_id)', 'Category name already exists in this company.',
    )

    @api.model_create_multi
    def create(self, values):
        return metadata_create(self, values, super().create)

    def write(self, values):
        return metadata_write(self, values, super().write)

    def unlink(self):
        if not self.env.user._is_superuser():
            msg = 'document metadata cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()


class DmsAccessGroup(models.Model):
    _inherit = 'dms.access.group'
    _check_company_auto = True
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )
    parent_group_id = fields.Many2one(check_company=True)
    _name_uniq = models.Constraint(
        'UNIQUE(name,company_id)', 'Group name already exists in this company.',
    )

    @api.model_create_multi
    def create(self, values):
        return metadata_create(self, values, super().create)

    def write(self, values):
        return metadata_write(self, values, super().write)

    def unlink(self):
        if not self.env.user._is_superuser():
            msg = 'document metadata cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()
