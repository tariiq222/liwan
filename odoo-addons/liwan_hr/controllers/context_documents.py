# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http

from .employee_access import share_employee_document
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_document_service.controllers.context_documents import (
    document_for,
)


class EmployeeContextAccess(http.Controller):
    @http.route('/api/v1/document-contexts/employee/<int:subject_id>/<int:document_id>/employee-access', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled')
    @requires_capability('documents.access.manage', 'hr.employees.manage')
    def share_context_document(self, subject_id, document_id, **payload):
        return share_employee_document(document_for('employee', subject_id, document_id, write=True), payload)
