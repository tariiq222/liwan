# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError

WRITABLE = {'name', 'parent_id', 'manager_id'}


def dump_department(dept, refs=None):
    if refs is None:
        refs = dept._liwan_serialized_relations()
    return {
        'id': dept.id,
        'name': dept.name,
        'parent_id': refs['parent_id'],
        'manager': refs['manager'],
        'child_ids': refs['child_ids'],
        'employee_count': refs['employee_count'],
    }


def dump_departments(depts):
    if not depts:
        return []
    refs_map = depts._liwan_serialized_relations_map()
    return [dump_department(dept, refs_map[dept.id]) for dept in depts]


def _optional_id(value, field):
    if value is None or value is False or (isinstance(value, str) and not value):
        return False
    if isinstance(value, bool):
        raise ApiError(422, 'invalid', f"{field} must be an integer", field=field)
    if isinstance(value, float):
        raise ApiError(422, 'invalid', f"{field} must be an integer", field=field)
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ApiError(422, 'invalid', f"{field} must be an integer", field=field) from None
    if parsed <= 0:
        raise ApiError(422, 'invalid', f"{field} must be a positive integer", field=field)
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
