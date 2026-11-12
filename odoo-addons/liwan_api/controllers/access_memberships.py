# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.access_admin import (
    parse_assignments,
    parse_login,
    parse_query,
    require_exact,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    chooses_company,
    clear_security_caches_after_commit,
    parse_positive_int,
)
from odoo.addons.liwan_api.serializers.access import dump_membership
from odoo.addons.liwan_platform.models.read_only_guard import assert_writable

MEMBERSHIPS = '/api/v1/admin/memberships'


def _company_id(value):
    """The optional ``company_id`` of a request: the company to act in when it is not the working company."""
    return None if value is None else parse_positive_int(value, 'company_id')


def _writable_company(service, company_id):
    """The company a membership write acts in, refused when it is a read-only branch or the caller is read-only."""
    company = service._liwan_membership_company(company_id)
    assert_writable(company, 'write')
    return company


class AccessMembershipsController(http.Controller):
    """Members of a company whose home is another company.

    ``company_id`` names a branch below the root company; only a holder of ``access.users.grant`` in the root
    company may send it, and the service decides, so the generic payload company check steps aside.
    """

    @http.route(MEMBERSHIPS, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def memberships(self):
        service = request.env['liwan.access.service']
        service._liwan_require_capability('access.users.grant')
        args, limit, offset = parse_query({'company_id', 'limit', 'offset'})
        company, users, total = service._liwan_list_memberships(_company_id(args.get('company_id')), limit, offset)
        return {'items': [dump_membership(user, company) for user in users], 'total': total}

    @http.route(MEMBERSHIPS, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @chooses_company
    def add(self, **payload):
        service = request.env['liwan.access.service']
        service._liwan_require_capability('access.users.grant')
        require_exact(payload, {'login', 'assignments', 'company_id', 'employee_id'}, {'login', 'assignments'})
        login = parse_login(payload['login'])
        assignments = parse_assignments(payload['assignments'], allow_empty=True)
        company_id = _company_id(payload.get('company_id'))
        employee_id = parse_positive_int(payload['employee_id'], 'employee_id') if 'employee_id' in payload else None
        company = _writable_company(service, company_id)
        user = service._liwan_add_membership(login, assignments, company_id, employee_id)
        clear_security_caches_after_commit(request.env)
        return request.make_json_response(dump_membership(user, company), status=201)

    @http.route(f'{MEMBERSHIPS}/<int:user_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @chooses_company
    def change_roles(self, user_id, **payload):
        service = request.env['liwan.access.service']
        service._liwan_require_capability('access.users.grant')
        require_exact(payload, {'expected_version', 'assignments', 'company_id'}, {'expected_version', 'assignments'})
        if not isinstance(payload['expected_version'], str):
            raise ApiError(422, 'invalid', 'expected_version must be a string', field='expected_version')
        assignments = parse_assignments(payload['assignments'], allow_empty=True)
        company_id = _company_id(payload.get('company_id'))
        company = _writable_company(service, company_id)
        user = service._liwan_replace_membership_roles(user_id, assignments, payload['expected_version'], company_id)
        clear_security_caches_after_commit(request.env)
        return dump_membership(user, company)

    @http.route(f'{MEMBERSHIPS}/<int:user_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @chooses_company
    def remove(self, user_id):
        service = request.env['liwan.access.service']
        service._liwan_require_capability('access.users.grant')
        args, _limit, _offset = parse_query({'company_id'})
        company_id = _company_id(args.get('company_id'))
        _writable_company(service, company_id)
        service._liwan_remove_membership(user_id, company_id)
        clear_security_caches_after_commit(request.env)
        return request.make_response('', status=204)
