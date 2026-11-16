# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The bridges liwan_access_hr, liwan_documents_hr and liwan_hr_operations were folded into liwan_hr. liwan_access_hr and
# liwan_documents_hr own no data record; liwan_hr_operations owns the access rows of the leave approval workflow. Take them
# over before security/ir.model.access.csv loads, so the same rows are updated and liwan_api's end migration can forget the bridges.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import hand_over_xml_ids

LEAVE_APPROVAL_ACCESS = [
    'access_liwan_operation_request_hr_leave_read',
    'access_liwan_operation_request_hr_leave_request',
    'access_liwan_operation_request_hr_leave_approve',
    'access_liwan_operation_request_hr_leave_manage',
    'access_liwan_operation_process_hr_leave_config',
    'access_liwan_operation_process_step_hr_leave_config',
    'access_liwan_operation_event_hr_leave_request',
    'access_liwan_operation_process_hr_leave_request',
    'access_liwan_operation_process_step_hr_leave_request',
    'access_liwan_operation_event_hr_leave_approve',
    'access_operations_definitions_hr_leave_config',
]


def migrate(cr, version):
    if not version:
        return
    hand_over_xml_ids(api.Environment(cr, SUPERUSER_ID, {}), 'liwan_hr_operations', 'liwan_hr', LEAVE_APPROVAL_ACCESS)
