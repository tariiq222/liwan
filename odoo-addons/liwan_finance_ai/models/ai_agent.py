# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The finance (read only) agent of the LiwanOS AI and its tools: read tools over existing liwan_finance routes, each with the
capability its route already checks. Fields that are sensitive never appear in a result summary."""
from odoo import api, models

from odoo.addons.liwan_ai.models.tool_registry import (
    DATE_SCHEMA,
    PAGE_SCHEMA,
    QUERY_SCHEMA,
    read_tool,
)

OWNER = 'liwan_finance'
FEATURE = 'finance.enabled'

FINANCE_AGENT = {
    'key': 'finance',
    'owner': OWNER,
    'feature_key': FEATURE,
    'name_ar': 'وكيل المالية',
    'name_en': 'Finance agent',
    'description_ar': 'الفواتير والدفعات ومبالغها المستحقة، للقراءة فقط',
    'description_en': 'Invoices, payments and amounts due, read only',
    'instructions_ar': 'أنت وكيل المالية وتقرأ فقط. اعرض المبالغ والعملات كما أعادها النظام دون جمع أو حساب، واذكر الفترة التي قرأتها.',
    'instructions_en': 'You are the finance agent and you only read. Show amounts and currencies exactly as the system returned them, without adding or computing, and state the period you read.',
    'pages': ['finance'],
    'sensitive_fields': ['partner_bank_id'],
}


FINANCE_AI_TOOLS = (
    read_tool(
        OWNER, FEATURE, 'finance.list_invoices', 'finance.invoices.read',
        ('يعرض الفواتير مع حالتها ومبالغها والمتبقي منها', 'List invoices with state, amounts and amount due'),
        '/api/v1/finance/invoices',
        {'move_type': {'type': 'string', 'enum': ['out_invoice', 'out_refund', 'in_invoice', 'in_refund']}, 'state': {'type': 'string', 'enum': ['draft', 'posted', 'cancel']}, 'date_from': DATE_SCHEMA, 'date_to': DATE_SCHEMA, 'q': QUERY_SCHEMA, 'limit': PAGE_SCHEMA},
        {'move_type': '$move_type', 'state': '$state', 'date_from': '$date_from', 'date_to': '$date_to', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].name', 'items[].move_type', 'items[].state', 'items[].payment_state', 'items[].partner.name', 'items[].invoice_date', 'items[].invoice_date_due', 'items[].currency', 'items[].amount_total', 'items[].amount_residual', 'total'],
    ),
    read_tool(
        OWNER, FEATURE, 'finance.list_payments', 'finance.payments.read',
        ('يعرض الدفعات الواردة والصادرة مع مبالغها', 'List incoming and outgoing payments with their amounts'),
        '/api/v1/finance/payments',
        {'payment_type': {'type': 'string', 'enum': ['inbound', 'outbound']}, 'date_from': DATE_SCHEMA, 'date_to': DATE_SCHEMA, 'q': QUERY_SCHEMA, 'limit': PAGE_SCHEMA},
        {'payment_type': '$payment_type', 'date_from': '$date_from', 'date_to': '$date_to', 'q': '$q', 'limit': '$limit'},
        ['items[].id', 'items[].name', 'items[].payment_type', 'items[].state', 'items[].partner.name', 'items[].date', 'items[].currency', 'items[].amount', 'total'],
    ),
)


class LiwanFinanceAiAgent(models.AbstractModel):
    _inherit = 'liwan.ai.agent.registry'

    @api.model
    def _liwan_ai_agent_definitions(self):
        return (*super()._liwan_ai_agent_definitions(), FINANCE_AGENT)


class LiwanFinanceAiTools(models.AbstractModel):
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_tool_definitions(self):
        return super()._liwan_ai_tool_definitions() + FINANCE_AI_TOOLS
