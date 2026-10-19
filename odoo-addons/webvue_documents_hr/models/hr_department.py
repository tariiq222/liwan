# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import ForeignKeyViolation

from odoo import models

from odoo.addons.webvue_hr.rules import WebVueHrRule


class HrDepartment(models.Model):
    _inherit = 'hr.department'

    def _webvue_usage(self):
        usage = super()._webvue_usage()
        documents = self.env['webvue.document']
        usage['documents'] = (documents.with_context(active_test=False).search_count([('department_id', '=', self.id)])
            if documents._webvue_actor_allows('read') else 0)
        return usage

    def _webvue_delete(self):
        try:
            with self.env.cr.savepoint():
                return super()._webvue_delete()
        except ForeignKeyViolation:
            # The FK includes hidden documents. Never inspect them with elevated
            # rights or reveal counts/names through the department delete API.
            msg = 'department_in_use'
            raise WebVueHrRule(msg, 'department is in use') from None
