# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError


class DocumentPolicy(models.Model):
    """One MVCC fence per company; no duplicate capability or revision state.

    Advisory locks serialize execution but do not refresh an existing Odoo
    REPEATABLE READ snapshot. Touching this row on a role change makes a stale
    writer fail serialization, so Odoo retries its complete request and policy.
    """

    _name = 'liwan.document.policy'
    _description = 'Document policy transaction fence'
    _liwan_scope = 'company'

    company_id = fields.Many2one(
        'res.company', required=True, ondelete='cascade', index=True,
    )
    _company_unique = models.Constraint(
        'UNIQUE(company_id)', 'One document policy fence per company.',
    )

    @api.model_create_multi
    def create(self, values):
        if not self.env.user._is_superuser():
            msg = 'document policy fences are operator-owned'
            raise AccessError(msg)
        return super().create(values)

    def write(self, values):
        msg = 'document policy fences cannot be edited'
        raise AccessError(msg)

    def unlink(self):
        if not self.env.user._is_superuser():
            msg = 'document policy fences are operator-owned'
            raise AccessError(msg)
        return super().unlink()

    @api.model
    def _liwan_touch(self, companies):
        # The no-op UPDATE deliberately creates a new MVCC tuple. No business
        # fact is copied from core's policy counter and no customer ACL is bypassed.
        self.env.cr.execute(
            'UPDATE liwan_document_policy SET company_id=company_id WHERE company_id=ANY(%s)',
            [companies.ids],
        )

    @api.model
    def _liwan_lock(self, company, *, shared=False):
        self.env.cr.execute(
            ('SELECT id FROM liwan_document_policy WHERE company_id=%s FOR SHARE'
             if shared else 'SELECT id FROM liwan_document_policy WHERE company_id=%s FOR UPDATE'),
            [company.id],
        )
        if not self.env.cr.fetchone():
            msg = 'document library requires operator initialization'
            raise AccessError(msg)
