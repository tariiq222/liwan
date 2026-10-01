# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.nasq_pmo.serializers.project_template import (
    dump_applied_project,
    dump_project_template,
    parse_project_template_apply,
    parse_project_template_vals,
)

MAX_TEMPLATES = 200


class ProjectTemplateController(http.Controller):

    @http.route('/api/v1/project-templates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_templates(self, **_):
        args = request.httprequest.args
        unknown = set(args) - {'q', 'limit', 'offset'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        Template = request.env['nasq.project.template']
        limit = min(parse_nonneg_int(args.get('limit', MAX_TEMPLATES), 'limit') or MAX_TEMPLATES, MAX_TEMPLATES)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = [('company_id', '=', request.env.company.id)]
        q = (args.get('q') or '').strip()
        if q:
            domain.append(('name', 'ilike', q))
        templates = Template.search(domain, order='name, id', limit=limit, offset=offset)
        return {
            'items': [dump_project_template(template) for template in templates],
            'total': Template.search_count(domain),
            'can_manage': bool(Template._nasq_can_manage()),
            'can_apply': bool(Template._nasq_can_apply()),
        }

    @http.route('/api/v1/project-templates', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_template(self, **payload):
        values = parse_project_template_vals(payload)
        try:
            template = request.env['nasq.project.template'].create(values)
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        except (ValidationError, UserError) as error:
            raise ApiError(422, 'invalid', str(error)) from error
        return request.make_json_response(dump_project_template(template), status=201)

    @http.route('/api/v1/project-templates/<int:template_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_template(self, template_id):
        return dump_project_template(get_record('nasq.project.template', template_id))

    @http.route('/api/v1/project-templates/<int:template_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_template(self, template_id, **payload):
        template = get_record('nasq.project.template', template_id)
        values = parse_project_template_vals(payload, partial=True)
        try:
            template.write(values)
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        except (ValidationError, UserError) as error:
            raise ApiError(422, 'invalid', str(error)) from error
        return dump_project_template(template)

    @http.route('/api/v1/project-templates/<int:template_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_template(self, template_id):
        template = get_record('nasq.project.template', template_id)
        try:
            template.unlink()
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        return request.make_json_response('', status=204)

    @http.route('/api/v1/project-templates/<int:template_id>/apply', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def apply_template(self, template_id, **payload):
        template = get_record('nasq.project.template', template_id)
        name, start_date = parse_project_template_apply(payload)
        try:
            result = template._nasq_apply(name, start_date, serialize=dump_applied_project)
        except NasqAccessRule:
            raise
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        except (ValidationError, UserError) as error:
            raise ApiError(422, 'invalid', str(error)) from error
        return request.make_json_response(result, status=201)
