# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_approval_service.serializers.operations import (
    dump_request_steps,
    person,
)


def dump_approval(record):
    return {'request_id': record.id, 'revision': record.revision, 'can_review': record._operations_allowed_actions()['approve'], 'state': record.state, 'steps': dump_request_steps(record)}


def dump_approval_process(process, env):
    access = env['liwan.access.service']
    entitlement = env['liwan.entitlement.service']
    can_manage = entitlement._liwan_feature_write('hr.enabled') and access._liwan_has_capability(env.user, 'hr.leave.config')
    if not process:
        return {'process': None, 'href': None, 'can_manage': can_manage}
    steps = []
    for step in process.step_ids.sorted('sequence'):
        resolver = process._operations_reviewer_resolver(process.execution_kind, step.reviewer_resolver) if step.reviewer_resolver else None
        steps.append({
            'name': step.name, 'resolver': step.reviewer_resolver or None, 'resolver_label': resolver['label'] if resolver else None,
            'reviewers': [person(user) for user in step.reviewer_ids],
        })
    return {'process': {'id': process.id, 'name': process.name, 'revision': process.revision, 'steps': steps}, 'href': '/settings/apps/hr/leave-approval/edit' if can_manage else None, 'can_manage': can_manage}
