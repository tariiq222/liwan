# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_documents.controllers.common import current_document
from odoo.addons.liwan_documents.serializers.document import parse_revision
from odoo.addons.liwan_documents.serializers.document_access import dump_access


class EmployeeDocumentAccess(http.Controller):
    @http.route('/api/v1/documents/<int:document_id>/employee-access', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('documents.enabled', 'hr.enabled', operation='write')
    @requires_capability('documents.access.manage', 'hr.employees.manage', match='all')
    def share_with_employee(self, document_id, **payload):
        """The explicit choice made when a document is linked to an employee: let the employee read it.

        Linking grants nothing by itself. This adds the employee's account as a reader and keeps every
        other grant as it is, so the caller does not have to restate the current editors.
        """
        revision = parse_revision(payload)
        document = current_document(document_id)
        document._liwan_require('access')
        employee = document.employee_id
        if not employee:
            raise ApiError(422, 'invalid', 'the document is not linked to an employee', field='context')
        if not employee.user_id:
            raise ApiError(422, 'employee_has_no_account', 'the employee has no account to share the document with', field='context')
        if document.visibility == 'company':
            # Everyone in the company already reads it: there is nothing to add, and no grant list to restate.
            return dump_access(document)
        grants = [{'user_id': grant.user_id.id, 'access': grant.access} for grant in document.grant_ids]
        if employee.user_id.id not in {grant['user_id'] for grant in grants}:
            grants.append({'user_id': employee.user_id.id, 'access': 'reader'})
        document._liwan_set_access(document.visibility, grants, revision)
        return dump_access(request.env['liwan.document'].with_context(active_test=False).browse(document.id))
