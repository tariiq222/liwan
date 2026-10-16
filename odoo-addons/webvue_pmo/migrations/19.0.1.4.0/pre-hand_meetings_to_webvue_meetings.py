# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Hand webvue_pmo's meeting records to webvue_meetings and webvue_meetings_pmo.

webvue_meetings is not a dependency of webvue_pmo, so upgrading webvue_pmo does not
install it by itself. This script runs before webvue_pmo loads and:

1. renames, in place, every ir_model_data row of the meetings application
   to webvue_meetings and every project/task link row to the bridge
   webvue_meetings_pmo, so each record keeps its database id: users keep their
   groups, roles keep their grants, tables and columns survive. When the
   receiving addon already holds the same xml id for the same record,
   webvue_pmo's duplicate is dropped; a holder pointing at another record
   stops the upgrade before anything changes;
2. re-points the matching ir_model_constraint and ir_model_relation rows,
   or drops webvue_pmo's copy when the receiving addon reflected its own;
3. rewrites the permissions' group_xmlid;
4. marks webvue_meetings and webvue_meetings_pmo 'to install' while they are
   uninstalled, so they load later in this run, before Odoo removes the
   rows webvue_pmo no longer declares.

When webvue_meetings cannot be installed (not on the addons path, or not
installable), the meeting record rules would call a helper nobody defines,
so they are closed; the rows still move and wait for webvue_meetings.

If the webvue_meetings install fails later in the same run, recovery needs
-i webvue_meetings,webvue_meetings_pmo.

LEFT_TO_ODOO lists rows webvue_pmo held only because it extended shared
models for meetings. Their owners keep their own xml ids, so Odoo drops
only webvue_pmo's; this script does not touch them.

webvue_meetings' pre_init_hook renames MEETINGS_XMLIDS the same way when an
upgrade installs it before this script runs. Re-running changes nothing; a
fresh install skips it.
"""

SOURCE = 'webvue_pmo'
MEETINGS = 'webvue_meetings'
BRIDGE = 'webvue_meetings_pmo'
CLOSED_DOMAIN = "[(0, '=', 1)]"

GROUPS = ('group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage')
RULES = (
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
)
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)
SERIES_FIELDS = (
    'attendee_ids', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'location',
    'meeting_ids', 'meeting_url', 'name', 'organizer_id', 'recurrence', 'secretary_id',
    'until_count', 'until_date', 'write_date', 'write_uid',
)
EVENT_FIELDS = (
    'actor_id', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'kind',
    'meeting_id', 'occurred_at', 'summary', 'write_date', 'write_uid',
)
VERSION_FIELDS = (
    'actor_id', 'captured_at', 'company_id', 'create_date', 'create_uid', 'display_name', 'id',
    'meeting_id', 'number', 'snapshot', 'write_date', 'write_uid',
)
MINUTE_FIELDS = (
    'meeting_url', 'minutes_form', 'minutes_form_data', 'minutes_snapshot',
    'minutes_snapshot_at', 'minutes_snapshot_data', 'series_id',
)
MEETINGS_XMLIDS = (
    *GROUPS,
    'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
    *RULES,
    'access_webvue_meeting_series_read', 'access_webvue_meeting_series_create',
    'access_webvue_meeting_series_manage', 'access_webvue_meeting_event_read',
    'access_webvue_meeting_event_manage_read', 'access_webvue_meeting_minutes_version_read',
    'access_webvue_meeting_minutes_version_manage_read',
    'ir_cron_webvue_meeting_reminders', 'ir_cron_webvue_meeting_reminders_ir_actions_server',
    'webvue_meeting_minutes_landscape', 'report_meeting_minutes_document_history',
    'model_webvue_meeting_series', 'model_webvue_meeting_event', 'model_webvue_meeting_minutes_version',
    *(f'field_webvue_meeting_series__{name}' for name in SERIES_FIELDS),
    *(f'field_webvue_meeting_event__{name}' for name in EVENT_FIELDS),
    *(f'field_webvue_meeting_minutes_version__{name}' for name in VERSION_FIELDS),
    *(f'selection__webvue_meeting_series__recurrence__{value}' for value in ('none', 'weekly', 'biweekly', 'monthly')),
    'constraint_webvue_meeting_minutes_version_number_unique',
    *(f'field_cyan_meeting_minute__{name}' for name in MINUTE_FIELDS),
    'field_cyan_meeting_resolution__deadline', 'field_cyan_meeting_resolution__execution_period',
    'field_mail_message__webvue_meeting_id', 'field_mail_mail__webvue_meeting_id',
    *(f'selection__mail_message__webvue_notification_kind__{kind}' for kind in MEETING_KINDS),
)
BRIDGE_XMLIDS = (
    'field_cyan_meeting_minute__project_id', 'field_cyan_meeting_resolution__project_id',
    'field_webvue_meeting_series__project_id', 'field_project_task__meeting_id',
    'field_project_task__resolution_id', 'constraint_project_task_webvue_resolution_task_unique',
)
MEETINGS_CONSTRAINTS = (
    'webvue_meeting_minutes_version_number_unique', 'cyan_meeting_minute_series_id_fkey',
    *(f'webvue_meeting_event_{name}_fkey' for name in ('actor_id', 'company_id', 'create_uid', 'meeting_id', 'write_uid')),
    *(f'webvue_meeting_minutes_version_{name}_fkey' for name in ('actor_id', 'company_id', 'create_uid', 'meeting_id', 'write_uid')),
    'webvue_meeting_series_attendee_rel_series_id_fkey', 'webvue_meeting_series_attendee_rel_user_id_fkey',
    *(f'webvue_meeting_series_{name}_fkey' for name in ('company_id', 'create_uid', 'organizer_id', 'secretary_id', 'write_uid')),
)
BRIDGE_CONSTRAINTS = (
    'project_task_webvue_resolution_task_unique', 'cyan_meeting_minute_project_id_fkey',
    'cyan_meeting_resolution_project_id_fkey', 'webvue_meeting_series_project_id_fkey',
)
MEETINGS_RELATIONS = ('webvue_meeting_series_attendee_rel',)
LEFT_TO_ODOO = (
    'model_calendar_event', 'model_cyan_meeting_minute', 'model_cyan_meeting_resolution', 'model_res_users',
    'field_calendar_event__display_name', 'field_calendar_event__id',
    'field_cyan_meeting_minute__display_name', 'field_cyan_meeting_minute__id',
    'field_cyan_meeting_resolution__display_name', 'field_cyan_meeting_resolution__id',
    'field_res_users__display_name', 'field_res_users__id',
)


def _stop(problem):
    msg = (
        f'webvue_pmo migration: {problem}. The upgrade stopped before any meeting row moved. '
        f'Check which record users and roles reference, delete the other ir_model_data row, '
        f'then run the upgrade again.'
    )
    raise ValueError(msg)


def _xmlids(cr, module, names):
    cr.execute('SELECT name, model, res_id FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [module, list(names)])
    return {name: (model, res_id) for name, model, res_id in cr.fetchall()}


def _plan(cr, target, names):
    """``(rename, drop)`` name lists for ``target``; stops on a clash without changing anything."""
    source = _xmlids(cr, SOURCE, names)
    held = _xmlids(cr, target, source)
    rename, drop = [], []
    for name, row in sorted(source.items()):
        if name not in held:
            rename.append(name)
        elif held[name] == row:
            drop.append(name)
        else:
            _stop(f'both {SOURCE}.{name} and {target}.{name} exist and point at different records')
    return rename, drop


def _module(cr, name):
    cr.execute('SELECT id, state FROM ir_module_module WHERE name = %s', [name])
    return cr.fetchone()


def _hand_over(cr, table, names, source_id, target_id):
    """Re-point webvue_pmo's rows of ``table`` to the target, or drop them when the target reflected its own."""
    for name in names:
        cr.execute(f'SELECT 1 FROM {table} WHERE name = %s AND module = %s', [name, target_id])
        if cr.fetchone():
            cr.execute(f'DELETE FROM {table} WHERE name = %s AND module = %s', [name, source_id])
        else:
            cr.execute(f'UPDATE {table} SET module = %s WHERE name = %s AND module = %s', [target_id, name, source_id])


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        "SELECT 1 FROM ir_model_data WHERE module IN %s AND name = 'model_webvue_meeting_series'",
        [(SOURCE, MEETINGS)],
    )
    if not cr.fetchone():
        return
    plans = {MEETINGS: _plan(cr, MEETINGS, MEETINGS_XMLIDS), BRIDGE: _plan(cr, BRIDGE, BRIDGE_XMLIDS)}
    for target, (rename, drop) in plans.items():
        if drop:
            cr.execute('DELETE FROM ir_model_data WHERE module = %s AND name = ANY(%s)', [SOURCE, drop])
        if rename:
            cr.execute('UPDATE ir_model_data SET module = %s WHERE module = %s AND name = ANY(%s)', [target, SOURCE, rename])
    source = _module(cr, SOURCE)
    meetings = _module(cr, MEETINGS)
    bridge = _module(cr, BRIDGE)
    if meetings:
        _hand_over(cr, 'ir_model_constraint', MEETINGS_CONSTRAINTS, source[0], meetings[0])
        _hand_over(cr, 'ir_model_relation', MEETINGS_RELATIONS, source[0], meetings[0])
    if bridge:
        _hand_over(cr, 'ir_model_constraint', BRIDGE_CONSTRAINTS, source[0], bridge[0])
    for name in GROUPS:
        cr.execute(
            'UPDATE webvue_access_permission SET group_xmlid = %s WHERE group_xmlid = %s',
            [f'{MEETINGS}.{name}', f'{SOURCE}.{name}'],
        )
    if not meetings or meetings[1] == 'uninstallable':
        cr.execute(
            """
                UPDATE ir_rule SET domain_force = %s
                 WHERE id IN (SELECT res_id FROM ir_model_data
                               WHERE module = %s AND model = 'ir.rule' AND name = ANY(%s))
            """,
            [CLOSED_DOMAIN, MEETINGS, list(RULES)],
        )
        return
    cr.execute("UPDATE ir_module_module SET state = 'to install' WHERE name = %s AND state = 'uninstalled'", [MEETINGS])
    if bridge and bridge[1] != 'uninstallable':
        cr.execute("UPDATE ir_module_module SET state = 'to install' WHERE name = %s AND state = 'uninstalled'", [BRIDGE])
