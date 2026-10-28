# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueCrmImportBatch(models.Model):
    """One processed import: who ran it, from which source, and what became of its rows.

    The uploaded file is not kept; the counts are the commit's real outcome.
    """

    _name = 'webvue.crm.import.batch'
    _description = 'WebVue CRM import batch'
    _order = 'create_date desc, id desc'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', ondelete='set null')
    file_name = fields.Char(required=True)
    source_id = fields.Many2one('utm.source', ondelete='set null')
    created_count = fields.Integer(default=0)
    duplicate_count = fields.Integer(default=0)
    invalid_count = fields.Integer(default=0)
    unassigned_count = fields.Integer(default=0)


class WebVueCrmImportMapping(models.Model):
    """A saved column map: which file column feeds which customer field."""

    _name = 'webvue.crm.import.mapping'
    _description = 'WebVue CRM import mapping profile'
    _order = 'name, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    name = fields.Char(required=True)
    name_column = fields.Char(required=True)
    phone_column = fields.Char(required=True)
    email_column = fields.Char()
    notes_column = fields.Char()
    package_column = fields.Char()

    _company_name_unique = models.Constraint('UNIQUE(company_id, name)', 'a mapping profile with this name already exists')
