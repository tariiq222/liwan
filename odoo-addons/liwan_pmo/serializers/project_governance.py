# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_api.serializers.common import ref


def dump_stakeholder(record):
    return {
        'id': record.id,
        'name': record.name,
        'user': ref(record.user_id),
        'organization': record.organization or '',
        'role': record.role or '',
        'contact': record.contact or '',
        'notes': record.notes or '',
    }


def dump_raci(record):
    return {
        'id': record.id,
        'task': ref(record.task_id),
        'stakeholder': {'id': record.stakeholder_id.id, 'name': record.stakeholder_id.name},
        'role': record.role,
    }


def dump_register(record, include_task=True):
    return {
        'id': record.id,
        'kind': record.kind,
        'title': record.title,
        'description': record.description or '',
        'priority': record.priority,
        'status': record.status,
        'owner': ref(record.owner_id),
        'due_date': fields.Date.to_string(record.due_date) if record.due_date else None,
        'response': record.response or '',
        'task': ref(record.task_id) if include_task and record.task_id else None,
        'probability': record.probability if record.kind == 'risk' else None,
        'impact': record.impact if record.kind == 'risk' else None,
        'score': record.score if record.kind == 'risk' else None,
    }
