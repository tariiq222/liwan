# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.attachment import dump_attachment
from odoo.addons.liwan_api.serializers.common import iso


def person(user):
    return {'id': user.id, 'user_id': user.id, 'name': user.name}


def dump_step(process, step):
    resolver = process._operations_reviewer_resolver(process.execution_kind, step.reviewer_resolver) if step.reviewer_resolver else None
    return {'name': step.name, 'reviewer_ids': step.reviewer_ids.ids, 'reviewers': [person(user) for user in step.reviewer_ids], 'ineligible_reviewer_ids': process._ineligible_reviewers(step.reviewer_ids).ids, 'resolver': step.reviewer_resolver or None, 'resolver_label': resolver['label'] if resolver else None}


def dump_process(process):
    return {'id': process.id, 'name': process.name, 'description': process.description or '', 'purpose': process.purpose, 'stage_approval_mode': process.stage_approval_mode, 'state': process.state, 'revision': process.revision, 'execution_kind': process.execution_kind, 'steps': [dump_step(process, step) for step in process.step_ids.sorted('sequence')]}


def dump_summary(record):
    return {'id': record.id, 'name': record.name, 'process': {'id': record.process_id.id, 'name': record.process_name or record.name}, 'process_revision': record.process_revision, 'purpose': record.purpose, 'state': record.state, 'revision': record.revision, 'cycle': record.cycle, 'requester': person(record.requester_id), 'created_at': iso(record.create_date), 'execution_count': record.execution_count}


# The engine keeps the last cycle's review rows after a return or withdrawal, but
# those decisions no longer apply: only an open, rejected or finished request has
# stages in effect.
STAGES_IN_EFFECT = ('pending', 'rejected', 'done')


def dump_request(record):
    reviews = {r.sequence: r for r in record.review_ids}
    steps = []
    for step in record.stage_snapshot or []:
        review = reviews.get(step['sequence'])
        users = record.env['res.users'].browse(step['reviewer_ids'])
        steps.append({'sequence': step['sequence'], 'name': step['name'], 'resolver': step['resolver'], 'reviewers': [person(user) for user in users], 'status': review.status if review and record.state in STAGES_IN_EFFECT else 'waiting'})
    attachments = record.env['ir.attachment'].search([('res_model', '=', record._name), ('res_id', '=', record.id), ('type', '=', 'binary')], order='id')
    return {**dump_summary(record), 'description': record.description or '', 'target': record._operations_target(), 'steps': steps, 'events': [{'id': event.id, 'kind': event.kind, 'actor': person(event.actor_id), 'comment': event.comment or '', 'cycle': event.cycle, 'created_at': iso(event.create_date)} for event in record.event_ids], 'attachments': [dump_attachment(a, f'/api/v1/operations/requests/{record.id}/attachments') for a in attachments], 'allowed_actions': record._operations_allowed_actions()}
