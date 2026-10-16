# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Nasq AI tools of nasq_pmo, declared by the bridge nasq_pmo_ai: named tools over the PMO routes, each with the capability its route checks.

Numbers are computed by the routes, never by the model: the finance summary
tool returns the server-side totals as they are. The draft tool writes nothing;
it only shapes the payload the create page opens with (master plan contract ع5).
"""
from odoo import api, models

from odoo.addons.nasq_pmo.serializers.task import STATE_TO_API

TASK_STATES = list(STATE_TO_API.values())
PAGE = {'type': 'integer', 'minimum': 1, 'maximum': 50}
TEXT = {'type': 'string', 'maxLength': 4000}
DATE = {'type': 'string', 'pattern': r'^\d{4}-\d{2}-\d{2}$'}
PROJECT_ID = {
    'type': 'object',
    'properties': {'project_id': {'type': 'integer', 'minimum': 1}},
    'required': ['project_id'],
    'additionalProperties': False,
}


def _tool(name, kind, capability, description_ar, description_en, **extra):
    return {
        'name': name, 'owner': 'nasq_pmo', 'kind': kind, 'capability': capability,
        'feature_key': 'pmo.enabled', 'description_ar': description_ar, 'description_en': description_en,
        **extra,
    }


PMO_AI_TOOLS = (
    _tool(
        'pmo.list_my_tasks', 'read', 'pmo.tasks.read',
        'يعرض مهام المستخدم الحالي مع حالتها ومواعيدها وهل هي متأخرة',
        "List the current user's tasks with state, deadline and overdue flag",
        route={'method': 'GET', 'path': '/api/v1/tasks'},
        input_schema={
            'type': 'object',
            'properties': {'state': {'type': 'string', 'enum': TASK_STATES}, 'limit': PAGE},
            'additionalProperties': False,
        },
        input_map={'query': {'filter': 'mine', 'state': '$state', 'limit': '$limit'}},
        result_summary=['items[].id', 'items[].name', 'items[].state', 'items[].date_deadline',
                        'items[].is_overdue', 'items[].priority', 'items[].project.id', 'items[].project.name', 'total'],
    ),
    _tool(
        'pmo.list_projects', 'read', 'pmo.projects.read',
        'يعرض المشاريع التي يراها المستخدم مع حالتها ونسبة إنجازها',
        'List the projects visible to the user with status and progress',
        route={'method': 'GET', 'path': '/api/v1/projects'},
        input_schema={
            'type': 'object',
            'properties': {'q': {'type': 'string', 'maxLength': 120}, 'limit': PAGE},
            'additionalProperties': False,
        },
        input_map={'query': {'q': '$q', 'limit': '$limit'}},
        result_summary=['items[].id', 'items[].name', 'items[].status', 'items[].progress',
                        'items[].date_end', 'items[].manager.name', 'items[].task_count', 'total'],
    ),
    _tool(
        'pmo.get_project', 'read', 'pmo.projects.read',
        'يعرض تفاصيل مشروع واحد وميثاقه',
        'Show one project with its charter',
        route={'method': 'GET', 'path': '/api/v1/projects/{project_id}'},
        input_schema=PROJECT_ID,
        input_map={'path': {'project_id': '$project_id'}},
        result_summary=['id', 'name', 'status', 'progress', 'date_start', 'date_end', 'manager.name',
                        'task_count', 'closed_task_count', 'milestone_count', 'charter.code',
                        'charter.rationale', 'charter.objectives[]', 'charter.scope', 'charter.success'],
    ),
    _tool(
        'pmo.get_project_finance_summary', 'read', 'pmo.projects.read',
        'يعرض الميزانية والمصروف والمتبقي لمشروع واحد كما يحسبها النظام',
        "Show one project's budget, spent and remaining as computed by the server",
        route={'method': 'GET', 'path': '/api/v1/projects/{project_id}/finance/summary'},
        input_schema=PROJECT_ID,
        input_map={'path': {'project_id': '$project_id'}},
        result_summary=['planned', 'actual', 'remaining', 'utilization_percent', 'over_budget',
                        'budget_count', 'currency.name', 'currency.symbol'],
    ),
    _tool(
        'pmo.update_task_state', 'write_light', 'pmo.tasks.write',
        'ينقل مهمة إلى حالة أخرى بعد تأكيد المستخدم',
        'Move a task to another state after the user confirms',
        route={'method': 'POST', 'path': '/api/v1/tasks/{task_id}/transition'},
        input_schema={
            'type': 'object',
            'properties': {'task_id': {'type': 'integer', 'minimum': 1}, 'state': {'type': 'string', 'enum': TASK_STATES}},
            'required': ['task_id', 'state'],
            'additionalProperties': False,
        },
        input_map={'path': {'task_id': '$task_id'}, 'body': {'state': '$state'}},
        result_summary=['id', 'name', 'state', 'allowed_transitions[]'],
    ),
    _tool(
        'pmo.draft_project', 'draft', 'pmo.projects.create',
        'يجهّز مسودة مشروع تُفتح في صفحة الإنشاء الحقيقية؛ المستخدم يراجع ويرسل بنفسه',
        'Prepare a project draft that opens in the real create page; the user reviews and submits',
        draft_target='/projects/new',
        input_schema={
            'type': 'object',
            'properties': {
                'name': {'type': 'string', 'minLength': 1, 'maxLength': 255},
                'description': TEXT,
                'date_start': DATE,
                'date_end': DATE,
                'charter': {
                    'type': 'object',
                    'properties': {
                        'rationale': TEXT,
                        'objectives': {'type': 'array', 'items': {'type': 'string', 'maxLength': 500}, 'maxItems': 10},
                        'scope': TEXT, 'exclusions': TEXT, 'success': TEXT, 'assumptions': TEXT, 'constraints': TEXT,
                    },
                    'additionalProperties': False,
                },
            },
            'required': ['name'],
            'additionalProperties': False,
        },
    ),
)


class NasqPmoAiTools(models.AbstractModel):
    _inherit = 'nasq.ai.tool.registry'

    @api.model
    def _nasq_ai_tool_definitions(self):
        return super()._nasq_ai_tool_definitions() + PMO_AI_TOOLS
