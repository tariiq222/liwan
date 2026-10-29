# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from odoo import http
from odoo.http import request
from odoo.tools import email_normalize

from odoo.addons.webvue_api.controllers.common import (
    MIN_PASSWORD_LENGTH,
    ApiError,
    api_handler,
    clear_security_caches_after_commit,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
)
from odoo.addons.webvue_api.serializers.access import (
    dump_admin_user,
    dump_audit,
    dump_permission,
    dump_role,
    role_user_count,
    role_user_counts,
)
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule

MAX_PAGE = 200


def parse_query(allowed):
    args = request.httprequest.args.to_dict()
    unknown = set(args) - set(allowed)
    if unknown:
        raise ApiError(400, 'unsupported_filter', 'unsupported query parameter', field=sorted(unknown)[0])
    limit = min(parse_nonneg_int(args.pop('limit', 50), 'limit'), MAX_PAGE)
    offset = parse_nonneg_int(args.pop('offset', 0), 'offset')
    return args, limit, offset


def require_exact(payload, allowed, required=()):
    extra = set(payload) - set(allowed)
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', 'field is not accepted', field=field)
    missing = set(required) - set(payload)
    if missing:
        field = sorted(missing)[0]
        raise ApiError(422, 'invalid', 'field is required', field=field)


def parse_password(value, field='password'):
    if not isinstance(value, str) or len(value.strip()) < MIN_PASSWORD_LENGTH:
        raise ApiError(422, 'weak_password', 'password must be at least 8 characters', field=field)
    return value


def parse_assignments(value):
    if not isinstance(value, list) or not value:
        raise ApiError(422, 'invalid', 'assignments must not be empty', field='assignments')
    normalized = []
    seen = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {'role_id', 'scope'}:
            raise ApiError(422, 'invalid', 'invalid assignment shape', field='assignments')
        scope = item['scope']
        if not isinstance(scope, dict) or set(scope) != {'kind', 'id'} or scope.get('kind') != 'company':
            raise ApiError(422, 'unsupported_scope', 'only company scope is supported', field='assignments')
        role_id = parse_positive_int(item['role_id'], 'assignments')
        company_id = parse_positive_int(scope['id'], 'assignments')
        key = (role_id, company_id)
        if key in seen:
            raise ApiError(422, 'invalid', 'assignments must be unique', field='assignments')
        seen.add(key)
        normalized.append({'role_id': role_id, 'scope': {'kind': 'company', 'id': company_id}})
    return normalized


def _target_user(user_id):
    user = request.env['res.users'].with_context(active_test=False).search([
        ('id', '=', user_id), ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not user:
        raise ApiError(404, 'not_found', 'user does not exist')
    return user


def _extra(users):
    return request.env['webvue.access.service']._webvue_account_extra_fields(users.ids)


def _dump(user, extra, detail=True):
    return dump_admin_user(user, extra.get(user.id), detail=detail)


def _name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', 'name is required', field='name')
    return value.strip()


def _login(value):
    login = email_normalize(value.strip()) if isinstance(value, str) else False
    if not login:
        raise ApiError(422, 'invalid', 'login must be an email address', field='login')
    return login


class AccessAdminUsersController(http.Controller):

    @http.route('/api/v1/admin/users', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def users(self):
        service = request.env['webvue.access.service']
        service._webvue_require_capability('access.users.read')
        filters, limit, offset = parse_query(
            {'q', 'role_id', 'status', 'limit', 'offset'} | service._webvue_account_filter_keys(),
        )
        domain = [('company_id', '=', request.env.company.id), ('share', '=', False)]
        if filters.get('q'):
            domain += ['|', ('name', 'ilike', filters['q']), ('login', 'ilike', filters['q'])]
        status = filters.get('status')
        if status and status not in ('active', 'stopped'):
            raise ApiError(422, 'invalid', 'unknown status', field='status')
        if status:
            domain.append(('active', '=', status == 'active'))
        if filters.get('role_id'):
            role_id = parse_positive_int(filters['role_id'], 'role_id')
            domain.append(('webvue_access_assignment_ids.role_id', '=', role_id))
        domain += list(service._webvue_account_user_domain(filters))
        users = request.env['res.users'].with_context(active_test=False).search(
            domain, order='name, id', limit=limit, offset=offset,
        )
        extra = _extra(users)
        return {'items': [_dump(user, extra, detail=False) for user in users],
                'total': request.env['res.users'].with_context(active_test=False).search_count(domain)}

    @http.route('/api/v1/admin/users/<int:user_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def user(self, user_id):
        request.env['webvue.access.service']._webvue_require_capability('access.users.read')
        target = _target_user(user_id)
        return _dump(target, _extra(target))

    @http.route('/api/v1/admin/users', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create(self, **payload):
        require_exact(payload, {'name', 'login', 'password', 'assignments'}, {'name', 'login', 'password', 'assignments'})
        service = request.env['webvue.access.service']
        service._webvue_require_capability('access.users.grant')
        user = service._webvue_create_account(
            _name(payload['name']), _login(payload['login']),
            parse_password(payload['password']), parse_assignments(payload['assignments']),
        )
        clear_security_caches_after_commit(request.env)
        return request.make_json_response(_dump(user, _extra(user)), status=201)

    @http.route('/api/v1/admin/users/<int:user_id>/access', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def access(self, user_id, **payload):
        require_exact(payload, {'assignments', 'expected_version'}, {'assignments', 'expected_version'})
        service = request.env['webvue.access.service']
        target = _target_user(user_id)
        service._webvue_replace_assignments(
            target, parse_assignments(payload['assignments']), payload['expected_version'],
        )
        clear_security_caches_after_commit(request.env)
        return _dump(target, _extra(target))

    @http.route('/api/v1/admin/users/<int:user_id>/password', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def reset_password(self, user_id, **payload):
        require_exact(payload, {'password', 'expected_version'}, {'password', 'expected_version'})
        service = request.env['webvue.access.service']
        service._webvue_require_capability('access.users.reset_password')
        target = _target_user(user_id)
        service._webvue_reset_password(
            target, parse_password(payload['password']), payload['expected_version'],
        )
        return _dump(target, _extra(target))

    @http.route('/api/v1/admin/users/<int:user_id>/disable', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def disable(self, user_id, **payload):
        require_exact(payload, {'expected_version'}, {'expected_version'})
        target = _target_user(user_id)
        request.env['webvue.access.service']._webvue_disable_user(target, payload['expected_version'])
        return _dump(target, _extra(target))

    @http.route('/api/v1/admin/users/<int:user_id>/reactivate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def reactivate(self, user_id, **payload):
        require_exact(payload, {'expected_version', 'password'}, {'expected_version', 'password'})
        service = request.env['webvue.access.service']
        service._webvue_require_capability('access.users.disable')
        target = _target_user(user_id)
        service._webvue_reactivate_user(
            target, parse_password(payload['password']), payload['expected_version'],
        )
        return _dump(target, _extra(target))


class AccessAdminRolesController(http.Controller):

    @http.route('/api/v1/admin/permissions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def permissions(self):
        service = request.env['webvue.access.service']
        service._webvue_require_capability('access.roles.read')
        records = request.env['webvue.access.permission'].search([], order='key')
        scope_kinds = service._webvue_scope_kind_map()
        return {'items': [dump_permission(item, scope_kinds) for item in records], 'total': len(records), 'version': 'access-catalog-v1'}

    @http.route('/api/v1/admin/roles', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def roles(self):
        request.env['webvue.access.service']._webvue_require_capability('access.roles.read')
        filters, limit, offset = parse_query({'q', 'type', 'status', 'limit', 'offset'})
        domain = [
            '|', ('company_id', '=', False),
            ('company_id', '=', request.env.company.id),
        ]
        if filters.get('q'):
            domain += ['|', ('name_ar', 'ilike', filters['q']), ('name_en', 'ilike', filters['q'])]
        if filters.get('type'):
            if filters['type'] not in ('built_in', 'custom'):
                raise ApiError(422, 'invalid', 'unknown role type', field='type')
            domain.append(('type', '=', filters['type']))
        if filters.get('status'):
            if filters['status'] not in ('active', 'disabled'):
                raise ApiError(422, 'invalid', 'unknown role status', field='status')
            domain.append(('active', '=', filters['status'] == 'active'))
        Role = request.env['webvue.access.role'].with_context(active_test=False)
        records = Role.search(domain, limit=limit, offset=offset)
        counts = role_user_counts(records)
        return {
            'items': [dump_role(role, user_count=counts.get(role.id, 0)) for role in records],
            'total': Role.search_count(domain),
        }

    @http.route('/api/v1/admin/roles/<int:role_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def role(self, role_id):
        request.env['webvue.access.service']._webvue_require_capability('access.roles.read')
        return dump_role(self._role(role_id), detail=True)

    @http.route('/api/v1/admin/roles', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_role(self, **payload):
        require_exact(payload, {'name', 'description', 'permissions'}, {'name', 'description', 'permissions'})
        self._require_manage()
        role = request.env['webvue.access.role']._webvue_access_create(self._role_vals(payload))
        request.env['webvue.access.audit']._webvue_log('role.created', role, after={'permissions': sorted(role.permission_ids.mapped('key'))})
        return request.make_json_response(dump_role(role, detail=True), status=201)

    @http.route('/api/v1/admin/roles/<int:role_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_role(self, role_id, **payload):
        require_exact(payload, {'name', 'description', 'permissions', 'expected_version'}, {'expected_version'})
        self._require_manage()
        role = self._role(role_id)
        self._mutable(role)
        request.env['webvue.access.service']._webvue_check_role_version(role, payload.pop('expected_version'))
        self._require_manage()
        before = {'permissions': sorted(role.permission_ids.mapped('key'))}
        vals = self._role_vals(payload, partial=True)
        if not vals:
            raise ApiError(422, 'invalid', 'at least one field is required')
        role._webvue_access_write(vals)
        request.env['webvue.access.audit']._webvue_log('role.updated', role, before=before, after={'permissions': sorted(role.permission_ids.mapped('key'))})
        return dump_role(role, detail=True)

    @http.route('/api/v1/admin/roles/<int:role_id>/clone', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def clone_role(self, role_id, **payload):
        require_exact(payload, {'name'}, {'name'})
        self._require_manage()
        source = self._role(role_id)
        role = request.env['webvue.access.role']._webvue_access_create({
            **self._name_vals(payload['name']), 'description': source.description,
            'permission_ids': [(6, 0, source.permission_ids.filtered('custom_role_allowed').ids)],
        })
        request.env['webvue.access.audit']._webvue_log('role.created', role, after={'permissions': sorted(role.permission_ids.mapped('key'))})
        return request.make_json_response(dump_role(role, detail=True), status=201)

    @http.route(['/api/v1/admin/roles/<int:role_id>/disable', '/api/v1/admin/roles/<int:role_id>/enable'], type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def role_state(self, role_id, **payload):
        require_exact(payload, {'expected_version'}, {'expected_version'})
        self._require_manage()
        role = self._role(role_id)
        self._mutable(role)
        request.env['webvue.access.service']._webvue_check_role_version(role, payload['expected_version'])
        self._require_manage()
        active = request.httprequest.path.endswith('/enable')
        if role.active == active:
            msg = 'role_state_unchanged'
            raise WebVueAccessRule(msg, status=409)
        role._webvue_access_write({'active': active})
        request.env['webvue.access.audit']._webvue_log('role.enabled' if active else 'role.disabled', role, before={'active': not active}, after={'active': active})
        return dump_role(role, detail=True)

    @http.route('/api/v1/admin/roles/<int:role_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def delete_role(self, role_id):
        self._require_manage()
        args, _limit, _offset = parse_query({'expected_version'})
        if not args.get('expected_version'):
            raise ApiError(422, 'invalid', 'expected_version is required', field='expected_version')
        role = self._role(role_id)
        self._mutable(role)
        request.env['webvue.access.service']._webvue_check_role_version(role, args['expected_version'])
        self._require_manage()
        user_count = role_user_count(role)
        if user_count:
            msg = 'role_in_use'
            raise WebVueAccessRule(msg, status=409, details={'user_count': user_count})
        request.env['webvue.access.audit']._webvue_log('role.deleted', role, before={'permissions': sorted(role.permission_ids.mapped('key'))})
        role._webvue_access_unlink()
        return request.make_response('', status=204)

    @staticmethod
    def _require_manage():
        request.env['webvue.access.service']._webvue_require_capability('access.roles.manage')

    @staticmethod
    def _role(role_id):
        role = request.env['webvue.access.role'].with_context(active_test=False).search([
            ('id', '=', role_id),
            '|', ('company_id', '=', False), ('company_id', '=', request.env.company.id),
        ], limit=1)
        if not role:
            raise ApiError(404, 'not_found', 'role does not exist')
        return role

    @staticmethod
    def _mutable(role):
        if role.protected:
            msg = 'protected_role'
            raise WebVueAccessRule(msg, status=403)

    @staticmethod
    def _name_vals(name):
        if not isinstance(name, dict) or not isinstance(name.get('ar'), str) or not name['ar'].strip():
            raise ApiError(422, 'invalid', 'Arabic name is required', field='name')
        en = name.get('en')
        if en is not None and not isinstance(en, str):
            raise ApiError(422, 'invalid', 'English name must be a string', field='name')
        return {'name_ar': name['ar'].strip(), 'name_en': en.strip() if en else False}

    @classmethod
    def _role_vals(cls, payload, partial=False):
        vals = {}
        if 'name' in payload:
            vals.update(cls._name_vals(payload['name']))
        if 'description' in payload:
            if not isinstance(payload['description'], str):
                raise ApiError(422, 'invalid', 'description must be a string', field='description')
            vals['description'] = payload['description']
        if 'permissions' in payload:
            permissions = payload['permissions']
            if (
                not isinstance(permissions, list)
                or any(not isinstance(item, str) for item in permissions)
                or len(set(permissions)) != len(permissions)
            ):
                raise ApiError(422, 'invalid', 'permissions must be unique', field='permissions')
            records = request.env['webvue.access.permission'].search([('key', 'in', permissions)])
            if len(records) != len(permissions):
                raise ApiError(422, 'invalid', 'unknown permission', field='permissions')
            forbidden = records.filtered(lambda item: not item.custom_role_allowed)
            if forbidden:
                msg = 'custom_role_permission_forbidden'
                raise WebVueAccessRule(msg, field='permissions', details={'permission': forbidden[0].key})
            selected = set(records.mapped('key'))
            for permission in records:
                missing = set(permission.dependency_ids.mapped('key')) - selected
                if missing:
                    msg = 'missing_dependency'
                    raise WebVueAccessRule(msg, field='permissions', details={'permission': permission.key, 'missing': sorted(missing)[0]})
            vals['permission_ids'] = [(6, 0, records.ids)]
        if not partial:
            vals.setdefault('type', 'custom')
        return vals


def _audit_bound(value, key, end):
    """The UTC moment a `from`/`to` filter names: a day (in the user's timezone, `to` inclusive) or an ISO datetime."""
    try:
        day = date.fromisoformat(value)
    except ValueError:
        day = None
    if day:
        zone = ZoneInfo(request.env.user.tz or request.env.company.partner_id.tz or 'UTC')
        start = datetime.combine(day + timedelta(days=1) if end else day, time.min, zone)
        return start.astimezone(timezone.utc).replace(tzinfo=None) - (timedelta(microseconds=1) if end else timedelta())
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise ApiError(422, 'invalid', f'{key} must be a date (YYYY-MM-DD) or an ISO 8601 datetime', field=key) from None
    return moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment


class AccessAdminAuditController(http.Controller):

    @http.route('/api/v1/admin/access-log', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def audit(self):
        request.env['webvue.access.service']._webvue_require_capability('access.audit.read')
        filters, limit, offset = parse_query({'from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'limit', 'offset'})
        domain = [('company_id', '=', request.env.company.id)]
        for key, operator in (('from', '>='), ('to', '<=')):
            if filters.get(key):
                domain.append(('create_date', operator, _audit_bound(filters[key], key, end=key == 'to')))
        if filters.get('action'):
            domain.append(('action', '=', filters['action']))
        for key in ('actor_id', 'target_id'):
            if filters.get(key):
                domain.append((key, '=', parse_positive_int(filters[key], key)))
        if filters.get('target_type'):
            if filters['target_type'] not in ('user', 'role', 'company'):
                raise ApiError(422, 'invalid', 'unknown target type', field='target_type')
            domain.append(('target_type', '=', filters['target_type']))
        Event = request.env['webvue.access.audit']
        events = Event.search(domain, limit=limit, offset=offset)
        return {'items': [dump_audit(event) for event in events], 'total': Event.search_count(domain)}

    @http.route('/api/v1/admin/access-log/<int:event_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def event(self, event_id):
        request.env['webvue.access.service']._webvue_require_capability('access.audit.read')
        # get_record answers another company's event with the same not-found as a
        # missing id, before the audit rule would raise a 403 that marks it real.
        event = get_record('webvue.access.audit', event_id)
        return dump_audit(event, detail=True)
