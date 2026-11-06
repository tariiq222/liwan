# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.liwan_ai.controllers.settings import require_tenant_manager
from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE, AI_USE
from odoo.addons.liwan_ai.models.knowledge_chunker import (
    MAX_CHUNKS,
    record_chunks,
    record_title,
)
from odoo.addons.liwan_ai.models.knowledge_indexer import KNOWLEDGE_FEATURE
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

_logger = logging.getLogger(__name__)
MAX_REFS = 40
MAX_ITEMS = 8


def parse_refs(payload):
    """The candidate references of a resolve body, or a 422 naming what is wrong."""
    unknown = sorted(set(payload) - {'refs'})
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    refs = payload.get('refs')
    if not isinstance(refs, list) or not 1 <= len(refs) <= MAX_REFS:
        raise ApiError(422, 'invalid', f'refs must be a list of 1 to {MAX_REFS} references', field='refs')
    for index, ref in enumerate(refs):
        valid = (
            isinstance(ref, dict) and set(ref) == {'model', 'res_id', 'chunk_no'} and isinstance(ref['model'], str)
            and all(isinstance(ref[key], int) and not isinstance(ref[key], bool) for key in ('res_id', 'chunk_no'))
            and ref['res_id'] > 0 and 0 <= ref['chunk_no'] < MAX_CHUNKS
        )
        if not valid:
            raise ApiError(422, 'invalid', 'each reference is {model, res_id, chunk_no}', field=f'refs.{index}')
    return refs


def readable_records(env, refs, sources):
    """``{(model, id): record}`` of the candidates the caller may read in the current company.

    The search runs in the caller's environment, so Odoo's record rules decide; a source that is unknown or whose
    application is off, an archived or missing record, and a record of another company are simply absent.
    """
    entitlement = env['liwan.entitlement.service']
    ids_by_model = {}
    for ref in refs:
        source = sources.get(ref['model'])
        if source and entitlement._liwan_feature_read(source['feature_key']):
            ids_by_model.setdefault(ref['model'], set()).add(ref['res_id'])
    found = {}
    for model, ids in ids_by_model.items():
        for record in env[model].search([('id', 'in', sorted(ids))]):
            if record.company_id == env.company:
                found[model, record.id] = record
    return found


class AiKnowledgeController(http.Controller):

    @http.route('/api/v1/ai/knowledge/resolve', type='json2', auth='user', methods=['POST'], readonly=True)
    @api_handler
    @requires_feature(KNOWLEDGE_FEATURE, operation='read')
    @requires_capability(AI_USE)
    def resolve(self, **payload):
        """The text of the candidate chunks the caller may read, in the candidates' order (at most ``MAX_ITEMS``)."""
        env = request.env
        refs = parse_refs(payload)
        if not env['liwan.ai.settings']._liwan_current().knowledge_enabled:
            raise ApiError(403, 'forbidden', 'the knowledge search is turned off')
        sources = env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_map()
        records = readable_records(env, refs, sources)
        arabic = (env.lang or '').startswith('ar')
        chunks = {}
        items = []
        for ref in refs:
            key = (ref['model'], ref['res_id'])
            record = records.get(key)
            if record is None:
                continue
            source = sources[ref['model']]
            try:
                if key not in chunks:
                    chunks[key] = (record_title(record, source), record_chunks(record, source))
                title, texts = chunks[key]
            except AccessError:
                _logger.info('liwan_ai: knowledge record %s hides a declared field from the caller', key)
                records.pop(key)
                continue
            if ref['chunk_no'] < len(texts):
                items.append({
                    'model': ref['model'], 'res_id': ref['res_id'], 'chunk_no': ref['chunk_no'], 'title': title,
                    'source': source['label_ar'] if arabic else source['label_en'], 'text': texts[ref['chunk_no']],
                })
            if len(items) == MAX_ITEMS:
                break
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/ai/knowledge/rebuild', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(KNOWLEDGE_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def rebuild(self, **_):
        """Drop the whole knowledge index and read every source again (the indexer's next runs refill it)."""
        require_tenant_manager()
        if not request.env['liwan.ai.knowledge.indexer']._liwan_rebuild():
            raise ApiError(409, 'knowledge_unavailable', 'the knowledge index is not available in this deployment')
        return {'queued': True}
