# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hand the application access records from nasq_core to the addon that now owns them.

The ir_model_data rows are renamed in place, so every record keeps its
database id: users keep their capability groups and roles keep their grants.
Without the rename, the upgrade would delete the rows nasq_core no longer
declares and the owning addon would then create duplicates.

Rows are renamed even when the receiving addon is not installed; that addon
adopts them when it is installed. Re-running the script changes nothing.

The meeting record rules call a helper that only nasq_pmo defines. Without
nasq_pmo they would raise on every read, so they are closed instead; installing
nasq_pmo rewrites the domain from its own data file.
"""

CLOSED_DOMAIN = "[(0, '=', 1)]"
MEETING_RULES = ('rule_meeting_capability_scope', 'rule_resolution_capability_scope')

MOVED_XMLIDS = {
    'nasq_hr': (
        'group_cap_hr_employees_read',
        'group_cap_hr_employees_manage',
        'group_cap_hr_employees_archive',
        'group_cap_hr_employees_access_status_read',
        'group_cap_hr_departments_read',
        'group_cap_hr_departments_manage',
        'group_cap_hr_documents_read',
        'group_cap_hr_documents_manage',
        'group_hr_manager',
        'permission_hr_employees_read',
        'permission_hr_employees_manage',
        'permission_hr_employees_archive',
        'permission_hr_employees_access_status_read',
        'permission_hr_departments_read',
        'permission_hr_departments_manage',
        'permission_hr_documents_read',
        'permission_hr_documents_manage',
        'role_hr_manager',
        'access_audit_hr_writer',
        'access_users_hr_archive',
    ),
    'nasq_pmo': (
        'group_cap_pmo_projects_read',
        'group_cap_pmo_projects_create',
        'group_cap_pmo_projects_manage',
        'group_cap_pmo_settings_manage',
        'group_cap_pmo_tasks_read',
        'group_cap_pmo_tasks_create',
        'group_cap_pmo_tasks_write',
        'group_cap_pmo_tasks_approve',
        'group_pmo_manager',
        'group_cap_meetings_read',
        'group_cap_meetings_create',
        'group_cap_meetings_manage',
        'permission_pmo_projects_read',
        'permission_pmo_projects_create',
        'permission_pmo_projects_manage',
        'permission_pmo_settings_manage',
        'permission_pmo_tasks_read',
        'permission_pmo_tasks_create',
        'permission_pmo_tasks_write',
        'permission_pmo_tasks_approve',
        'permission_meetings_read',
        'permission_meetings_create',
        'permission_meetings_manage',
        'role_pmo_manager',
        'rule_meeting_capability_scope',
        'rule_resolution_capability_scope',
    ),
}


def _clashes(cr, module, names):
    cr.execute(
        '''
            SELECT core.name
              FROM ir_model_data core
              JOIN ir_model_data target
                ON target.module = %s AND target.name = core.name
             WHERE core.module = 'nasq_core' AND core.name = ANY(%s)
             ORDER BY core.name
        ''',
        [module, list(names)],
    )
    return [row[0] for row in cr.fetchall()]


def migrate(cr, version):
    if not version:
        return
    for module, names in MOVED_XMLIDS.items():
        clashes = _clashes(cr, module, names)
        if clashes:
            msg = (
                f'nasq_core migration: both nasq_core.{clashes[0]} and {module}.{clashes[0]} exist. '
                f'Check which record users and roles reference, delete the other ir_model_data row, '
                f'then run the upgrade again.'
            )
            raise ValueError(msg)
    for module, names in MOVED_XMLIDS.items():
        cr.execute(
            "UPDATE ir_model_data SET module = %s WHERE module = 'nasq_core' AND name = ANY(%s)",
            [module, list(names)],
        )
        for name in names:
            if name.startswith('group_cap_'):
                cr.execute(
                    'UPDATE nasq_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
                    [f'{module}.{name}', f'nasq_core.{name}'],
                )
    cr.execute(
        "SELECT 1 FROM ir_module_module WHERE name = 'nasq_pmo' AND state IN ('installed', 'to upgrade', 'to install')",
    )
    if not cr.fetchone():
        cr.execute(
            """
                UPDATE ir_rule SET domain_force = %s
                 WHERE id IN (SELECT res_id FROM ir_model_data
                               WHERE module = 'nasq_pmo' AND model = 'ir.rule' AND name = ANY(%s))
            """,
            [CLOSED_DOMAIN, list(MEETING_RULES)],
        )
