# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import ForeignKeyViolation

from odoo import models

from odoo.addons.liwan_hr.rules import LiwanHrRule


class HrDepartment(models.Model):
    _inherit = 'hr.department'

    def _liwan_usage(self):
        usage = super()._liwan_usage()
        documents = self.env['liwan.document']
        usage['documents'] = (documents.with_context(active_test=False).search_count([('department_id', '=', self.id)])
            if documents._liwan_actor_allows('read') else 0)
        return usage

    def _liwan_delete(self):
        try:
            with self.env.cr.savepoint():
                return super()._liwan_delete()
        except ForeignKeyViolation:
            # The FK includes hidden documents. Never inspect them with elevated
            # rights or reveal counts/names through the department delete API.
            msg = 'department_in_use'
            raise LiwanHrRule(msg, 'department is in use') from None
