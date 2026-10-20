# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


def localized(ar, en):
    return {'ar': ar or '', 'en': en or None}


def role_ref(role):
    return {
        'id': role.id,
        'key': role.key,
        'name': localized(role.name_ar, role.name_en),
        'type': role.type,
        'protected': bool(role.protected),
    }


def assignment_ref(assignment):
    company = assignment.company_id
    return {
        'id': assignment.id,
        'role': role_ref(assignment.role_id),
        'scope': {'kind': 'company', 'id': company.id, 'name': company.name},
    }


def role_user_counts(roles):
    """Map role ids to assignment counts in the current company (one query)."""
    if not roles:
        return {}
    roles.env.cr.execute(
        '''SELECT role_id, COUNT(*)
             FROM webvue_access_assignment
            WHERE role_id IN %s AND company_id = %s
            GROUP BY role_id''',
        [tuple(roles.ids), roles.env.company.id],
    )
    counted = dict(roles.env.cr.fetchall())
    return {role_id: counted.get(role_id, 0) for role_id in roles.ids}


def role_user_count(role):
    return role_user_counts(role).get(role.id, 0)


def dump_role(role, detail=False, actor=None, user_count=None):
    service = role.env['webvue.access.service']
    if user_count is None:
        user_count = role_user_count(role)
    result = {
        **role_ref(role),
        'description': role.description or '',
        'active': bool(role.active),
        'assignable': bool(role.assignable),
        'user_count': user_count,
        'version': service._webvue_role_version(role),
    }
    if detail:
        can_manage = service._webvue_has_capability(actor or role.env.user, 'access.roles.manage')
        actions = ['read']
        if can_manage and not role.protected:
            actions.extend(['edit', 'clone'])
            actions.append('disable' if role.active else 'enable')
            if not user_count:
                actions.append('delete')
        result.update({
            'permissions': sorted(role.permission_ids.mapped('key')),
            'allowed_actions': actions,
        })
    return result


def dump_permission(permission, scope_kinds):
    """SCOPE_KINDS is webvue.access.service._webvue_scope_kind_map(); context kinds are read-only."""
    scopes = [{'kind': 'company', 'assignable': True}, *(
        {'kind': kind, 'assignable': False}
        for kind, spec in sorted(scope_kinds.items()) if permission.key in spec['permissions']
    )]
    return {
        'key': permission.key,
        'domain': permission.domain,
        'resource': permission.resource,
        'action': permission.action,
        'label': localized(permission.name_ar, permission.name_en),
        'description': localized(permission.description_ar, permission.description_en),
        'dependencies': sorted(permission.dependency_ids.mapped('key')),
        'scopes': scopes,
        'custom_role_allowed': bool(permission.custom_role_allowed),
        'sensitive': bool(permission.sensitive),
    }


def _capability_sources(user, assignments):
    sources = {}
    for assignment in assignments:
        role = role_ref(assignment.role_id)
        scope = {
            'kind': 'company',
            'id': assignment.company_id.id,
            'name': assignment.company_id.name,
        }
        source = {
            'role_assignment_id': assignment.id,
            'role': role,
            'scope': scope,
            'source': 'assignment',
        }
        for key in assignment.role_id.permission_ids.mapped('key'):
            sources.setdefault(key, []).append(source)
    return [{'key': key, 'sources': values} for key, values in sorted(sources.items())]


def dump_admin_user(user, extra=None, detail=False, actor=None):
    service = user.env['webvue.access.service']
    assignments = user.env['webvue.access.assignment'].search([
        ('user_id', '=', user.id), ('company_id', '=', user.company_id.id),
    ], order='id')
    protected = user.has_group('webvue_core.group_vendor_support')
    result = {
        'id': user.id,
        'name': user.name,
        'login': user.login,
        'active': bool(user.active),
        'protected': protected,
        'assignments': [assignment_ref(item) for item in assignments],
        'version': service._webvue_user_version(user),
        **(extra or {}),
    }
    if detail:
        actor = actor or user.env.user
        actions = ['read']
        if not protected:
            if service._webvue_has_capability(actor, 'access.users.assign_roles'):
                actions.append('assign_roles')
            if service._webvue_has_capability(actor, 'access.users.reset_password'):
                actions.append('reset_password')
            if service._webvue_has_capability(actor, 'access.users.disable') and user != actor:
                actions.append('disable' if user.active else 'reactivate')
        result.update({
            'capabilities': _capability_sources(user, assignments),
            'allowed_actions': actions,
        })
    return result


def dump_audit(event, detail=False):
    actor = event.actor_id
    result = {
        'id': event.id,
        'occurred_at': fields.Datetime.to_string(event.create_date).replace(' ', 'T') + 'Z',
        'actor': ({'id': actor.id, 'name': actor.name, 'login': actor.login} if actor else None),
        'action': event.action,
        'target': {'type': event.target_type, 'id': event.target_id, 'name': event.target_name},
        'result': event.result,
    }
    if detail:
        result.update({'before': event.before or None, 'after': event.after or None, 'reason': event.reason or None})
    return result
