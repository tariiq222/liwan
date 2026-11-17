# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What an installation writes once: the ticket starter set and the engine behaviour LiwanOS owns.

The OCA engine ships one record rule that lets every internal user read the tickets they follow,
independently of the capability catalog. It is neutralised here, once, because its record is declared
``noupdate``: the rewrite survives later upgrades of the engine, and the application's own rule for the
requester takes its place.

The starter team and its Arabic stages make the application usable on the day it is installed. The engine's
own six English stages ship with no company and no team, and its ``_get_applicable_stages`` treats a stage with no
team as applicable to *every* team, so they are archived: left active they would sit in every picker and filter beside
the Arabic set, and a ticket could close in the engine's "Cancelled" instead of the tenant's own closed stage.
"""

DEFAULT_TEAM = {'name': 'الدعم الفني'}
STARTER_STAGES = (
    ('جديد', False, False),
    ('قيد المعالجة', False, False),
    ('بانتظار العميل', False, False),
    ('مغلق', False, True),
)
INTERNAL_USER_RULE = 'helpdesk_mgmt.helpdesk_ticket_rule_internal_user'
ENGINE_STAGES = tuple(
    f'helpdesk_mgmt.helpdesk_ticket_stage_{name}'
    for name in ('new', 'in_progress', 'awaiting', 'done', 'cancelled', 'rejected')
)


def _neutralise_engine_rule(env):
    rule = env.ref(INTERNAL_USER_RULE, raise_if_not_found=False)
    if rule:
        rule.write({'domain_force': "[('id', '=', 0)]"})


def _seeded_team(env, company):
    """The company's first team, if it has one."""
    return env['helpdesk.ticket.team'].search([('company_id', '=', company.id)], order='id', limit=1)


def _archive_engine_stages(env):
    """Archive the engine's six English stages: shared by every team and company, they are not the tenant's set."""
    for xmlid in ENGINE_STAGES:
        stage = env.ref(xmlid, raise_if_not_found=False)
        if stage and stage.active:
            stage.write({'active': False})


def _seed_company(env, company):
    if env['helpdesk.ticket.team'].search_count([('company_id', '=', company.id)]):
        return
    team = env['helpdesk.ticket.team'].create({'name': DEFAULT_TEAM['name'], 'company_id': company.id})
    stages = env['helpdesk.ticket.stage']
    for sequence, (name, unattended, closed) in enumerate(STARTER_STAGES, start=1):
        stages |= env['helpdesk.ticket.stage'].create({
            'name': name, 'sequence': sequence, 'company_id': company.id,
            'unattended': unattended, 'closed': closed, 'team_ids': [(6, 0, team.ids)],
        })
    env['liwan.helpdesk.settings'].create({
        'company_id': company.id,
        'default_team_id': team.id,
        'reference_prefix': 'HD',
    })


def post_init_hook(env):
    _neutralise_engine_rule(env)
    _archive_engine_stages(env)
    for company in env['res.company'].search([]):
        _seed_company(env, company)
