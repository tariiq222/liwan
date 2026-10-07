# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Adopt the meeting records an older nasq_pmo created, before nasq_meetings loads.

When an upgrade from release/19.0.1.0.0 installs nasq_meetings with -i,
Odoo loads nasq_meetings in an earlier phase than nasq_pmo's upgrade
(nasq_pmo now depends on addons installed in the same run), so nasq_pmo's
19.0.1.4.0 pre-migration has not run yet. Without this hook nasq_meetings
would create a second copy of every group, permission, rule and cron. The
hook renames nasq_pmo's rows in place exactly like that migration does and
rewrites the permissions' group_xmlid. The project/task rows and the
constraint and relation rows stay for that migration. A fresh install finds
nothing to rename.
"""

SOURCE = 'nasq_pmo'
TARGET = 'nasq_meetings'
GROUPS = ('group_cap_meetings_read', 'group_cap_meetings_create', 'group_cap_meetings_manage')
_RULES = (
    'rule_meeting_capability_scope', 'rule_resolution_capability_scope',
    'rule_meeting_series_capability_scope', 'rule_meeting_event_current_company',
    'rule_meeting_minutes_version_current_company',
)
_MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)
_SERIES_FIELDS = (
    'attendee_ids', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'location',
    'meeting_ids', 'meeting_url', 'name', 'organizer_id', 'recurrence', 'secretary_id',
    'until_count', 'until_date', 'write_date', 'write_uid',
)
_EVENT_FIELDS = (
    'actor_id', 'company_id', 'create_date', 'create_uid', 'display_name', 'id', 'kind',
    'meeting_id', 'occurred_at', 'summary', 'write_date', 'write_uid',
)
_VERSION_FIELDS = (
    'actor_id', 'captured_at', 'company_id', 'create_date', 'create_uid', 'display_name', 'id',
    'meeting_id', 'number', 'snapshot', 'write_date', 'write_uid',
)
_MINUTE_FIELDS = (
    'meeting_url', 'minutes_form', 'minutes_form_data', 'minutes_snapshot',
    'minutes_snapshot_at', 'minutes_snapshot_data', 'series_id',
)
OWNED_XMLIDS = (
    *GROUPS,
    'permission_meetings_read', 'permission_meetings_create', 'permission_meetings_manage',
    *_RULES,
    'access_nasq_meeting_series_read', 'access_nasq_meeting_series_create',
    'access_nasq_meeting_series_manage', 'access_nasq_meeting_event_read',
    'access_nasq_meeting_event_manage_read', 'access_nasq_meeting_minutes_version_read',
    'access_nasq_meeting_minutes_version_manage_read',
    'ir_cron_nasq_meeting_reminders', 'ir_cron_nasq_meeting_reminders_ir_actions_server',
    'nasq_meeting_minutes_landscape', 'report_meeting_minutes_document_history',
    'model_nasq_meeting_series', 'model_nasq_meeting_event', 'model_nasq_meeting_minutes_version',
    *(f'field_nasq_meeting_series__{name}' for name in _SERIES_FIELDS),
    *(f'field_nasq_meeting_event__{name}' for name in _EVENT_FIELDS),
    *(f'field_nasq_meeting_minutes_version__{name}' for name in _VERSION_FIELDS),
    *(f'selection__nasq_meeting_series__recurrence__{value}' for value in ('none', 'weekly', 'biweekly', 'monthly')),
    'constraint_nasq_meeting_minutes_version_number_unique',
    *(f'field_cyan_meeting_minute__{name}' for name in _MINUTE_FIELDS),
    'field_cyan_meeting_resolution__deadline', 'field_cyan_meeting_resolution__execution_period',
    'field_mail_message__nasq_meeting_id', 'field_mail_mail__nasq_meeting_id',
    *(f'selection__mail_message__nasq_notification_kind__{kind}' for kind in _MEETING_KINDS),
)


def pre_init_hook(env):
    Data = env['ir.model.data']
    rows = Data.search([('module', '=', SOURCE), ('name', 'in', list(OWNED_XMLIDS))])
    if not rows:
        return
    held = {
        data.name: (data.model, data.res_id)
        for data in Data.search([('module', '=', TARGET), ('name', 'in', rows.mapped('name'))])
    }
    duplicates = Data.browse()
    for data in rows:
        if data.name not in held:
            continue
        if held[data.name] != (data.model, data.res_id):
            msg = (
                f'nasq_meetings install: both {SOURCE}.{data.name} and {TARGET}.{data.name} exist and '
                f'point at different records. Check which record users and roles reference, delete '
                f'the other ir_model_data row, then install again.'
            )
            raise ValueError(msg)
        duplicates |= data
    duplicates.unlink()
    (rows - duplicates).write({'module': TARGET})
    Permission = env['nasq.access.permission']
    for name in GROUPS:
        Permission.search([('group_xmlid', '=', f'{SOURCE}.{name}')]).write({'group_xmlid': f'{TARGET}.{name}'})
    env.flush_all()
