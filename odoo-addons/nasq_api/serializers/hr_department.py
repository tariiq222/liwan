# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.nasq_api.controllers.common import ApiError

WRITABLE = {'name', 'parent_id', 'manager_id'}


def dump_department(dept):
    manager = None
    if dept.manager_id:
        public = dept.env['hr.employee.public'].browse(dept.manager_id.id)
        if public.exists():
            manager = {'id': public.id, 'name': public.name}
    return {
        'id': dept.id,
        'name': dept.name,
        'parent_id': dept.parent_id.id or None,
        'manager': manager,
        'child_ids': list(dept.child_ids.ids),
    }


def _optional_id(value, field):
    if value in (None, False, ''):
        return False
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ApiError(422, 'invalid', f"{field} must be an integer", field=field) from None
    if parsed < 0:
        raise ApiError(422, 'invalid', f"{field} must be an integer", field=field)
    return parsed


def parse_department_vals(payload):
    """Whitelist + coerce a department write payload into ORM vals."""
    vals = {}
    for key, value in payload.items():
        if key not in WRITABLE:
            raise ApiError(422, 'invalid', f"field {key!r} is not writable", field=key)
        if key == 'name':
            if not isinstance(value, str) or not value.strip():
                raise ApiError(422, 'invalid', "name must not be empty", field='name')
            vals['name'] = value.strip()
        elif key == 'parent_id':
            vals['parent_id'] = _optional_id(value, 'parent_id')
        else:
            vals['manager_id'] = _optional_id(value, 'manager_id')
    return vals
