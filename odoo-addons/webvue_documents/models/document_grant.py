# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.fields import Domain

from .document import CREATE_GRANTS, MUTATIONS


class DocumentGrant(models.Model):
    _name = 'webvue.document.grant'
    _description = 'Document access grant'
    _webvue_scope = 'company'
    _check_company_auto = True

    document_id = fields.Many2one(
        'webvue.document',
        required=True,
        ondelete='cascade',
        check_company=True,
        index=True,
    )
    user_id = fields.Many2one(
        'res.users', required=True, ondelete='cascade', index=True,
    )
    company_id = fields.Many2one(
        related='document_id.company_id', store=True, index=True,
    )
    access = fields.Selection(
        [('reader', 'Reader'), ('editor', 'Editor')], required=True,
    )
    _user_unique = models.Constraint(
        'UNIQUE(document_id,user_id)', 'A user has one document grant.',
    )

    @api.model
    def _search(
        self,
        domain,
        offset=0,
        limit=None,
        order=None,
        *,
        active_test=True,
        bypass_access=False,
    ):
        if not self.env.user._is_superuser():
            domain = Domain(domain) & Domain(
                'document_id',
                'in',
                self.env['webvue.document']._webvue_accessible_query('access'),
            )
        return super()._search(
            domain,
            offset=offset,
            limit=limit,
            order=order,
            active_test=active_test,
            bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if operation == 'read' and not self.env.user._is_superuser():
            self.document_id._webvue_require('access')
        return super().check_access(operation)

    def _webvue_require_mutation(self, document_ids):
        if self.env.user._is_superuser():
            return
        operations = self.env.cr.precommit.data.get(MUTATIONS, {})
        creating = self.env.cr.precommit.data.get(CREATE_GRANTS, set())
        if any(
            operations.get(i) != 'access' and i not in creating for i in document_ids
        ):
            msg = 'document grants require the protected access operation'
            raise AccessError(msg)

    @api.model_create_multi
    def create(self, values):
        self._webvue_require_mutation([item.get('document_id') for item in values])
        return super().create(values)

    def write(self, values):
        self._webvue_require_mutation(self.document_id.ids)
        if {'document_id', 'company_id', 'user_id'} & set(values):
            msg = 'grant identity cannot be changed'
            raise AccessError(msg)
        return super().write(values)

    def unlink(self):
        self._webvue_require_mutation(self.document_id.ids)
        return super().unlink()
