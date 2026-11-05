# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of a TikTok channel: its suggested questions and chat prompts, and its history import."""
from odoo.addons.liwan_api.serializers.common import iso


def dump_shortcut(shortcut):
    """One suggested question or chat prompt, with the audit status TikTok reports for it."""
    return {
        'id': shortcut.id,
        'kind': shortcut.kind,
        'sequence': shortcut.sequence,
        'question': shortcut.question or None,
        'answer': shortcut.answer or None,
        'title': shortcut.title or None,
        'content': shortcut.content or None,
        'provider_id': shortcut.provider_id or None,
        'audit': shortcut.audit,
        'sync_error': shortcut.sync_error or None,
    }


def dump_sync(job):
    """One history import: its state, its phase and its counters."""
    return {
        'id': job.id,
        'state': job.state,
        'phase': job.phase,
        'conversations_count': job.conversations_count,
        'messages_count': job.messages_count,
        'error': job.error or None,
        'started_at': iso(job.started_at),
        'finished_at': iso(job.finished_at),
        'created_at': iso(job.create_date),
    }
