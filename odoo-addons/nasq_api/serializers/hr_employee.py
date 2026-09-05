# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_employee(employee):
    """Serialize an hr.employee or hr.employee.public record. ``id`` is the employee id."""
    dept = employee.department_id
    return {
        'id': employee.id,
        'name': employee.name,
        'job_title': employee.job_title or '',
        'department': {'id': dept.id, 'name': dept.name} if dept else None,
        'work_email': employee.work_email or '',
        'work_phone': employee.work_phone or '',
        'user_id': employee.user_id.id or None,
    }
