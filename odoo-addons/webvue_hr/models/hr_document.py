# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools import SQL

DOCUMENT_SCOPE_ERROR = 'document is outside the current company'
ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'
ACCESS_USER_WRITE_MARKER = 'webvue_core.access_user_write'


class WebVueHrDocument(models.Model):
    _name = 'webvue.hr.document'
    _description = 'HR Document'
    _webvue_scope = 'company'
    _check_company_auto = True

    name = fields.Char(required=True)
    body = fields.Html()
    attachment_ids = fields.Many2many('ir.attachment')
    expiry_date = fields.Date(index=True)
    department_id = fields.Many2one(
        'hr.department',
        required=True,
        index=True,
        ondelete='restrict',
        check_company=True,
    )
    company_id = fields.Many2one(
        'res.company',
        required=True,
        default=lambda self: self.env.company,
        index=True,
    )

    def _webvue_document_attachments(self):
        """The files stored on this document itself; the one set both the url and the download route use."""
        self.ensure_one()
        return self.attachment_ids.filtered(
            lambda item: item.res_model == self._name and item.res_id == self.id,
        )

    def _webvue_require(self, capability):
        self.env['webvue.access.service']._webvue_require_capability(capability)

    def _webvue_validate_scope(self):
        if not self.ids:
            return
        self.env.cr.execute(SQL(
            'SELECT company_id FROM %s WHERE id = ANY(%s)',
            SQL.identifier(self._table), self.ids,
        ))
        if any(company_id != self.env.company.id for company_id, in self.env.cr.fetchall()):
            raise AccessError(DOCUMENT_SCOPE_ERROR)

    def _webvue_department_ref(self):
        self.ensure_one()
        self._webvue_validate_scope()
        self.env.cr.execute(
            '''
                SELECT department.id, department.name
                  FROM webvue_hr_document document
                  JOIN hr_department department ON department.id = document.department_id
                 WHERE document.id = %s AND document.company_id = %s
            ''',
            [self.id, self.env.company.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            raise AccessError(DOCUMENT_SCOPE_ERROR)
        return {
            'id': row[0],
            'name': self.env['webvue.access.service']._webvue_hr_text(row[1]),
        }

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            self._webvue_require('hr.documents.read')
            domain = Domain(domain) & Domain('company_id', '=', self.env.company.id)
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            self._webvue_require('hr.documents.read')
            self._webvue_validate_scope()
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            self._webvue_require('hr.documents.manage')
            for vals in vals_list:
                if vals.get('company_id', self.env.company.id) != self.env.company.id:
                    raise AccessError(DOCUMENT_SCOPE_ERROR)
                department = self.env['hr.department'].browse(vals.get('department_id')).exists()
                if not department or department.company_id != self.env.company:
                    raise AccessError(DOCUMENT_SCOPE_ERROR)
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            self._webvue_require('hr.documents.manage')
            self._webvue_validate_scope()
            if vals.get('company_id', self.env.company.id) != self.env.company.id:
                raise AccessError(DOCUMENT_SCOPE_ERROR)
            if vals.get('department_id'):
                department = self.env['hr.department'].browse(vals['department_id']).exists()
                if not department or department.company_id != self.env.company:
                    raise AccessError(DOCUMENT_SCOPE_ERROR)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            msg = 'HR documents cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()
