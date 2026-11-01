# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_operations.serializers.operations import (
    STAGES_IN_EFFECT,
    person,
)


def dump_approval(record):
    reviews = {review.sequence: review for review in record.review_ids}
    steps = []
    for step in record.stage_snapshot or []:
        review = reviews.get(step['sequence'])
        users = record.env['res.users'].browse(step['reviewer_ids'])
        steps.append({
            'sequence': step['sequence'], 'name': step['name'], 'reviewers': [person(user) for user in users],
            'status': review.status if review and record.state in STAGES_IN_EFFECT else 'waiting',
        })
    return {'request_id': record.id, 'state': record.state, 'href': f'/operations/{record.id}', 'steps': steps}


def dump_approval_process(process, env):
    can_manage = env['liwan.access.service']._liwan_has_capability(env.user, 'operations.processes.manage')
    base = '/settings/apps/operations/processes'
    if not process:
        return {'process': None, 'href': f'{base}/new', 'can_manage': can_manage}
    steps = []
    for step in process.step_ids.sorted('sequence'):
        resolver = process._operations_reviewer_resolver(process.execution_kind, step.reviewer_resolver) if step.reviewer_resolver else None
        steps.append({
            'name': step.name, 'resolver': step.reviewer_resolver or None, 'resolver_label': resolver['label'] if resolver else None,
            'reviewers': [person(user) for user in step.reviewer_ids],
        })
    return {'process': {'id': process.id, 'name': process.name, 'revision': process.revision, 'steps': steps}, 'href': f'{base}/{process.id}', 'can_manage': can_manage}
