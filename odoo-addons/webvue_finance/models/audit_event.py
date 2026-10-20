# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError


class WebVueFinanceAuditEvent(models.Model):
    """The immutable audit trail of the elevated and irreversible finance actions.

    One row per action: who (``create_uid``), when (``create_date``), which company and record, the names
    of the fields written (never values, amounts or secrets) and the outcome. Rows are created by
    ``_webvue_log`` in the caller's own environment (the ACL grants create to the capability groups that
    perform the actions, no ``sudo()``) and can never be changed or deleted.
    """
    _name = 'webvue.finance.audit.event'
    _description = 'WebVue finance audit event'
    _webvue_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    action = fields.Selection([
        ('chart_loaded', 'Chart of accounts loaded'),
        ('account_created', 'Account created'),
        ('account_changed', 'Account changed'),
        ('account_archived', 'Account archived'),
        ('account_unarchived', 'Account unarchived'),
        ('payment_created', 'Payment created'),
        ('payment_changed', 'Payment changed'),
        ('payment_posted', 'Payment posted'),
        ('payment_allocated', 'Payment allocated'),
        ('payment_unallocated', 'Payment unallocated'),
        ('journal_created', 'Journal created'),
        ('journal_changed', 'Journal changed'),
        ('journal_archived', 'Journal archived'),
        ('journal_unarchived', 'Journal unarchived'),
        ('tax_created', 'Tax created'),
        ('tax_changed', 'Tax changed'),
        ('tax_archived', 'Tax archived'),
        ('tax_unarchived', 'Tax unarchived'),
        ('payment_term_created', 'Payment term created'),
        ('payment_term_changed', 'Payment term changed'),
        ('payment_term_archived', 'Payment term archived'),
        ('payment_term_unarchived', 'Payment term unarchived'),
        ('company_written', 'Company setup changed'),
        ('fiscal_year_closed', 'Fiscal year closed'),
        ('zatca_onboarded', 'ZATCA journal onboarded'),
        ('zatca_submitted', 'ZATCA submission'),
    ], required=True, index=True)
    res_model = fields.Char(required=True)
    res_id = fields.Integer(required=True)
    fields_written = fields.Char(help='Names of the fields written, comma separated; never their values.')
    outcome = fields.Char(help='The resulting state, for example the ZATCA submission state.')

    @api.model_create_multi
    def create(self, vals_list):
        msg = 'audit_is_immutable'
        raise AccessError(msg)

    def write(self, vals):
        msg = 'audit_is_immutable'
        raise AccessError(msg)

    def unlink(self):
        msg = 'audit_is_immutable'
        raise AccessError(msg)

    @api.model
    def _webvue_log(self, action, record, fields_written=(), outcome=False):
        """Record ``action`` on ``record`` (the only way a row is created)."""
        return super().create([{
            'company_id': self.env.company.id,
            'action': action,
            'res_model': record._name,
            'res_id': record.id,
            'fields_written': ', '.join(sorted(fields_written)) or False,
            'outcome': outcome,
        }])
