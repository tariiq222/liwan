# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one chunking function of the knowledge index (spec 2026-11-04 §6.3).

The indexer chunks a record to queue its text for embedding; the resolve route chunks the same record again to return
chunk ``n`` to the model. Both call ``record_chunks``, so the numbering in the index always matches. The text is built in
a fixed language, so a different language of the caller or of the indexer cannot move a chunk boundary, and it passes the
outbound data policy before it is split.
"""
from odoo.tools.mail import html2plaintext

from odoo.addons.liwan_ai.models.outbound_scan import withhold_text

CHUNK_CHARS = 1500
MAX_CHUNKS = 20
# Labels, selection names and related names are read in the source language: the same text for every reader.
KNOWLEDGE_LANG = 'en_US'


def field_text(record, name):
    """The plain text of one declared field of ``record``, or ``''`` when it is empty."""
    field = record._fields[name]
    value = record[name]
    if not value:
        return ''
    if field.type == 'html':
        return html2plaintext(value).strip()
    if field.type == 'selection':
        return dict(field._description_selection(record.env)).get(value, '')
    if field.type == 'many2one':
        return value.display_name or ''
    return str(value).strip()


def record_title(record, source):
    return withhold_text(field_text(record.with_context(lang=KNOWLEDGE_LANG), source['title_field']))


def record_text(record, source):
    """The title of ``record`` followed by one ``label: value`` line per declared field that has a value, withheld."""
    record = record.with_context(lang=KNOWLEDGE_LANG)
    lines = [field_text(record, source['title_field'])]
    for name in source['fields']:
        text = field_text(record, name)
        if text:
            lines.append(f'{record._fields[name]._description_string(record.env)}: {text}')
    return withhold_text('\n'.join(line for line in lines if line))


def split_text(text, limit=CHUNK_CHARS, maximum=MAX_CHUNKS):
    """``text`` cut on whitespace into at most ``maximum`` chunks of at most ``limit`` characters (a word longer than the limit is cut)."""
    chunks = []
    rest = text.strip()
    while rest and len(chunks) < maximum:
        if len(rest) <= limit:
            chunks.append(rest)
            break
        cut = next((index for index in range(limit, 0, -1) if rest[index].isspace()), limit)
        chunks.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    return chunks


def record_chunks(record, source):
    return split_text(record_text(record, source))
