# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    MIN_PASSWORD_LENGTH,
    ApiError,
    api_handler,
    clear_security_caches_after_commit,
    parse_nonneg_int,
    parse_positive_int,
)
from odoo.addons.nasq_api.serializers.access import (
    dump_admin_user,
    dump_audit,
    dump_permission,
    dump_role,
    role_user_count,
    role_user_counts,
)
from odoo.addons.nasq_core.models.access_service import NasqAccessRule

MAX_PAGE = 200


def _query(allowed):
    args = request.httprequest.args.to_dict()
    unknown = set(args) - set(allowed)
    if unknown:
        raise ApiError(400, 'unsupported_filter', 'unsupported query parameter', field=sorted(unknown)[0])
    limit = min(parse_nonneg_int(args.pop('limit', 50), 'limit'), MAX_PAGE)
    offset = parse_nonneg_int(args.pop('offset', 0), 'offset')
    return args, limit, offset


def _exact(payload, allowed, required=()):
    extra = set(payload) - set(allowed)
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', 'field is not accepted', field=field)
    missing = set(required) - set(payload)
    if missing:
        field = sorted(missing)[0]
        raise ApiError(422, 'invalid', 'field is required', field=field)


def _password(value, field='password'):
    if not isinstance(value, str) or len(value.strip()) < MIN_PASSWORD_LENGTH:
        raise ApiError(422, 'weak_password', 'password must be at least 8 characters', field=field)
    return value


def _assignments(value):
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


def _employee_refs(users):
    return request.env['nasq.access.service']._nasq_hr_employee_refs(users.ids)


class AccessAdminUsersController(http.Controller):

    @http.route('/api/v1/admin/users', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def users(self):
        service = request.env['nasq.access.service']
        service._nasq_require_capability('access.users.read')
        filters, limit, offset = _query({'q', 'role_id', 'status', 'department_id', 'limit', 'offset'})
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
            domain.append(('nasq_access_assignment_ids.role_id', '=', role_id))
        if filters.get('department_id'):
            filters['department_id'] = parse_positive_int(filters['department_id'], 'department_id')
            domain += list(service._nasq_hr_user_domain(filters))
        users = request.env['res.users'].with_context(active_test=False).search(
            domain, order='name, id', limit=limit, offset=offset,
        )
        refs = _employee_refs(users)
        return {'items': [dump_admin_user(user, refs.get(user.id)) for user in users],
                'total': request.env['res.users'].with_context(active_test=False).search_count(domain)}

    @http.route('/api/v1/admin/users/candidates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def candidates(self):
        service = request.env['nasq.access.service']
        service._nasq_require_capability('access.users.grant')
        filters, limit, offset = _query({'q', 'employee_id', 'limit', 'offset'})
        if filters.get('employee_id'):
            filters['employee_id'] = parse_positive_int(filters['employee_id'], 'employee_id')
        return service._nasq_hr_account_candidates(filters, limit, offset)

    @http.route('/api/v1/admin/users/<int:user_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def user(self, user_id):
        service = request.env['nasq.access.service']
        service._nasq_require_capability('access.users.read')
        target = _target_user(user_id)
        return dump_admin_user(target, _employee_refs(target).get(target.id), detail=True)

    @http.route('/api/v1/admin/users', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def grant(self, **payload):
        _exact(payload, {'employee_id', 'password', 'assignments'}, {'employee_id', 'password', 'assignments'})
        service = request.env['nasq.access.service']
        service._nasq_require_capability('access.users.grant')
        employee_id = parse_positive_int(payload['employee_id'], 'employee_id')
        prepared = service._nasq_hr_prepare_account(employee_id, 'grant')
        if not prepared['employee_active']:
            msg = 'employee_archived'
            raise NasqAccessRule(msg, field='employee_id')
        if prepared['existing_user_id']:
            msg = 'account_exists'
            raise NasqAccessRule(msg, field='employee_id', status=409)
        if not prepared['login']:
            msg = 'work_email_required'
            raise NasqAccessRule(msg, field='employee_id')
        if not prepared['partner_id']:
            msg = 'employee_contact_required'
            raise NasqAccessRule(msg, field='employee_id')
        assignments = _assignments(payload['assignments'])
        user = request.env['res.users'].with_context(
            no_reset_password=True,
        )._nasq_access_create({
            'name': prepared['name'], 'login': prepared['login'],
            'email': prepared['login'], 'password': _password(payload['password']),
            'partner_id': prepared['partner_id'], 'company_id': prepared['company_id'],
            'company_ids': [(6, 0, [prepared['company_id']])],
            'group_ids': [(6, 0, [request.env.ref('base.group_user').id])],
        })
        service._nasq_hr_link_account(employee_id, user.id)
        service._nasq_replace_assignments(user, assignments)
        service._nasq_bump_policy(user.company_id)
        request.env['nasq.access.audit']._nasq_log(
            'user.granted', user, before=None,
            after={'employee_id': employee_id, 'active': True},
        )
        clear_security_caches_after_commit(request.env)
        return request.make_json_response(
            dump_admin_user(user, _employee_refs(user).get(user.id), detail=True), status=201,
        )

    @http.route('/api/v1/admin/users/<int:user_id>/access', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def access(self, user_id, **payload):
        _exact(payload, {'assignments', 'expected_version'}, {'assignments', 'expected_version'})
        service = request.env['nasq.access.service']
        target = _target_user(user_id)
        service._nasq_replace_assignments(
            target, _assignments(payload['assignments']), payload['expected_version'],
        )
        clear_security_caches_after_commit(request.env)
        return dump_admin_user(target, _employee_refs(target).get(target.id), detail=True)

    @http.route('/api/v1/admin/users/<int:user_id>/password', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def reset_password(self, user_id, **payload):
        _exact(payload, {'password', 'expected_version'}, {'password', 'expected_version'})
        service = request.env['nasq.access.service']
        service._nasq_require_capability('access.users.reset_password')
        target = _target_user(user_id)
        service._nasq_reset_password(
            target, _password(payload['password']), payload['expected_version'],
        )
        return dump_admin_user(target, _employee_refs(target).get(target.id), detail=True)

    @http.route('/api/v1/admin/users/<int:user_id>/disable', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def disable(self, user_id, **payload):
        _exact(payload, {'expected_version'}, {'expected_version'})
        target = _target_user(user_id)
        request.env['nasq.access.service']._nasq_disable_user(target, payload['expected_version'])
        return dump_admin_user(target, _employee_refs(target).get(target.id), detail=True)

    @http.route('/api/v1/admin/users/<int:user_id>/reactivate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def reactivate(self, user_id, **payload):
        _exact(payload, {'expected_version', 'password'}, {'expected_version', 'password'})
        service = request.env['nasq.access.service']
        service._nasq_require_capability('access.users.disable')
        target = _target_user(user_id)
        employee_ref = service._nasq_hr_employee_refs([target.id]).get(target.id)
        if not employee_ref:
            msg = 'not_found'
            raise NasqAccessRule(msg, status=404)
        service._nasq_reactivate_user(
            target, _password(payload['password']), payload['expected_version'], employee_ref['id'],
        )
        return dump_admin_user(target, _employee_refs(target).get(target.id), detail=True)


class AccessAdminRolesController(http.Controller):

    @http.route('/api/v1/admin/permissions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def permissions(self):
        request.env['nasq.access.service']._nasq_require_capability('access.roles.read')
        records = request.env['nasq.access.permission'].search([], order='key')
        return {'items': [dump_permission(item) for item in records], 'total': len(records), 'version': 'access-catalog-v1'}

    @http.route('/api/v1/admin/roles', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def roles(self):
        request.env['nasq.access.service']._nasq_require_capability('access.roles.read')
        filters, limit, offset = _query({'q', 'type', 'status', 'limit', 'offset'})
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
        Role = request.env['nasq.access.role'].with_context(active_test=False)
        records = Role.search(domain, limit=limit, offset=offset)
        counts = role_user_counts(records)
        return {
            'items': [dump_role(role, user_count=counts.get(role.id, 0)) for role in records],
            'total': Role.search_count(domain),
        }

    @http.route('/api/v1/admin/roles/<int:role_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def role(self, role_id):
        request.env['nasq.access.service']._nasq_require_capability('access.roles.read')
        return dump_role(self._role(role_id), detail=True)

    @http.route('/api/v1/admin/roles', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_role(self, **payload):
        _exact(payload, {'name', 'description', 'permissions'}, {'name', 'description', 'permissions'})
        self._require_manage()
        role = request.env['nasq.access.role']._nasq_access_create(self._role_vals(payload))
        request.env['nasq.access.audit']._nasq_log('role.created', role, after={'permissions': sorted(role.permission_ids.mapped('key'))})
        return request.make_json_response(dump_role(role, detail=True), status=201)

    @http.route('/api/v1/admin/roles/<int:role_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_role(self, role_id, **payload):
        _exact(payload, {'name', 'description', 'permissions', 'expected_version'}, {'expected_version'})
        self._require_manage()
        role = self._role(role_id)
        self._mutable(role)
        request.env['nasq.access.service']._nasq_check_role_version(role, payload.pop('expected_version'))
        self._require_manage()
        before = {'permissions': sorted(role.permission_ids.mapped('key'))}
        vals = self._role_vals(payload, partial=True)
        if not vals:
            raise ApiError(422, 'invalid', 'at least one field is required')
        role._nasq_access_write(vals)
        request.env['nasq.access.audit']._nasq_log('role.updated', role, before=before, after={'permissions': sorted(role.permission_ids.mapped('key'))})
        return dump_role(role, detail=True)

    @http.route('/api/v1/admin/roles/<int:role_id>/clone', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def clone_role(self, role_id, **payload):
        _exact(payload, {'name'}, {'name'})
        self._require_manage()
        source = self._role(role_id)
        role = request.env['nasq.access.role']._nasq_access_create({
            **self._name_vals(payload['name']), 'description': source.description,
            'permission_ids': [(6, 0, source.permission_ids.filtered('custom_role_allowed').ids)],
        })
        request.env['nasq.access.audit']._nasq_log('role.created', role, after={'permissions': sorted(role.permission_ids.mapped('key'))})
        return request.make_json_response(dump_role(role, detail=True), status=201)

    @http.route(['/api/v1/admin/roles/<int:role_id>/disable', '/api/v1/admin/roles/<int:role_id>/enable'], type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def role_state(self, role_id, **payload):
        _exact(payload, {'expected_version'}, {'expected_version'})
        self._require_manage()
        role = self._role(role_id)
        self._mutable(role)
        request.env['nasq.access.service']._nasq_check_role_version(role, payload['expected_version'])
        self._require_manage()
        active = request.httprequest.path.endswith('/enable')
        role._nasq_access_write({'active': active})
        request.env['nasq.access.audit']._nasq_log('role.enabled' if active else 'role.disabled', role, before={'active': not active}, after={'active': active})
        return dump_role(role, detail=True)

    @http.route('/api/v1/admin/roles/<int:role_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def delete_role(self, role_id):
        self._require_manage()
        args, _limit, _offset = _query({'expected_version'})
        if not args.get('expected_version'):
            raise ApiError(422, 'invalid', 'expected_version is required', field='expected_version')
        role = self._role(role_id)
        self._mutable(role)
        request.env['nasq.access.service']._nasq_check_role_version(role, args['expected_version'])
        self._require_manage()
        user_count = role_user_count(role)
        if user_count:
            msg = 'role_in_use'
            raise NasqAccessRule(msg, status=409, details={'user_count': user_count})
        request.env['nasq.access.audit']._nasq_log('role.deleted', role, before={'permissions': sorted(role.permission_ids.mapped('key'))})
        role._nasq_access_unlink()
        return request.make_response('', status=204)

    @staticmethod
    def _require_manage():
        request.env['nasq.access.service']._nasq_require_capability('access.roles.manage')

    @staticmethod
    def _role(role_id):
        role = request.env['nasq.access.role'].with_context(active_test=False).search([
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
            raise NasqAccessRule(msg, status=403)

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
            records = request.env['nasq.access.permission'].search([('key', 'in', permissions)])
            if len(records) != len(permissions):
                raise ApiError(422, 'invalid', 'unknown permission', field='permissions')
            forbidden = records.filtered(lambda item: not item.custom_role_allowed)
            if forbidden:
                msg = 'custom_role_permission_forbidden'
                raise NasqAccessRule(msg, field='permissions', details={'permission': forbidden[0].key})
            selected = set(records.mapped('key'))
            for permission in records:
                missing = set(permission.dependency_ids.mapped('key')) - selected
                if missing:
                    msg = 'missing_dependency'
                    raise NasqAccessRule(msg, field='permissions', details={'permission': permission.key, 'missing': sorted(missing)[0]})
            vals['permission_ids'] = [(6, 0, records.ids)]
        if not partial:
            vals.setdefault('type', 'custom')
        return vals


class AccessAdminAuditController(http.Controller):

    @http.route('/api/v1/admin/access-log', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def audit(self):
        request.env['nasq.access.service']._nasq_require_capability('access.audit.read')
        filters, limit, offset = _query({'from', 'to', 'actor_id', 'target_type', 'target_id', 'action', 'limit', 'offset'})
        domain = [('company_id', '=', request.env.company.id)]
        mappings = {'from': ('create_date', '>='), 'to': ('create_date', '<='), 'action': ('action', '=')}
        for key, (field, operator) in mappings.items():
            if filters.get(key):
                domain.append((field, operator, filters[key]))
        for key in ('actor_id', 'target_id'):
            if filters.get(key):
                domain.append((key, '=', parse_positive_int(filters[key], key)))
        if filters.get('target_type'):
            if filters['target_type'] not in ('user', 'role'):
                raise ApiError(422, 'invalid', 'unknown target type', field='target_type')
            domain.append(('target_type', '=', filters['target_type']))
        Event = request.env['nasq.access.audit']
        events = Event.search(domain, limit=limit, offset=offset)
        return {'items': [dump_audit(event) for event in events], 'total': Event.search_count(domain)}

    @http.route('/api/v1/admin/access-log/<int:event_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def event(self, event_id):
        request.env['nasq.access.service']._nasq_require_capability('access.audit.read')
        event = request.env['nasq.access.audit'].browse(event_id).exists()
        if not event or event.company_id != request.env.company:
            raise ApiError(404, 'not_found', 'event does not exist')
        return dump_audit(event, detail=True)
