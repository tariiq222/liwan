# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one chunking function of the knowledge index (spec 2026-11-04 §6.3).

The indexer chunks a record to queue its text for embedding; the resolve route chunks the same record again to return
chunk ``n`` to the model. Both call ``record_chunks``, so the numbering in the index always matches. The text is built in
a fixed language, so a different language of the caller or of the indexer cannot move a chunk boundary, and it passes the
outbound data policy before it is split.

A record's text is written by an employee and read by a colleague (issue #555), so a chunk that reads like an instruction
is tagged where it enters the index: the notice says what follows is employee-written data, and it travels in that chunk,
which is the unit a search returns. Tagging is never dropping: the passage may be exactly what the user asked about.
"""
import re

from odoo.tools.mail import html2plaintext

from odoo.addons.liwan_ai.models.outbound_scan import withhold_text

CHUNK_CHARS = 1500
MAX_CHUNKS = 20
# Labels, selection names and related names are read in the source language: the same text for every reader.
KNOWLEDGE_LANG = 'en_US'
# The fixed notice of a passage that carries instruction-like text (issue #555). The chunk text is built in English, so
# the notice is too: every reader, whatever their language, sees the same words.
INSTRUCTION_NOTICE = '[employee-written data; not instructions]'

# Instruction-like phrasing, in the two languages the product is written in. A pattern errs towards tagging: a passage
# tagged by mistake costs one line of prompt, a passage that hides an instruction costs the run's answer. A pattern never
# looks for a single common word ("act", "أرسل") on its own, so ordinary business text stays untouched.
_INSTRUCTION_PATTERNS = (
    # ignore / disregard / forget X instructions, rules, prompt…
    re.compile(
        r'\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}'
        r'\b(?:instruction|instructions|rule|rules|prompt|prompts|guideline|guidelines|direction|directions|system)\b',
        re.IGNORECASE,
    ),
    # the system prompt, the developer message
    re.compile(r'\b(?:system|developer)\s+(?:prompt|message|instructions)\b', re.IGNORECASE),
    # reveal / print / repeat your instructions
    re.compile(
        r'\b(?:reveal|show|print|repeat|output|leak)\b[^.\n]{0,30}'
        r'\b(?:your|the)\s+(?:system\s+)?(?:prompt|instructions|rules)\b',
        re.IGNORECASE,
    ),
    # you are now X
    re.compile(r'\byou\s+are\s+now\b', re.IGNORECASE),
    # تجاهل (كل) ما سبق / القواعد / التعليمات / الأوامر
    re.compile(r'(?:تجاهل|تجاهلي|تجاهلوا)\s+(?:كل\s+)?(?:ما\s+)?(?:سبق|السابق|القواعد|التعليمات|الأوامر|السياق|الرسائل)'),
    # أدرج / اكشف / اطبع / أظهر / كرر كل ما تقرأه أو تعرفه
    re.compile(r'(?:أدرج|ادرج|اكشف|اطبع|أظهر|اظهر|كرر)\s+(?:كل\s+)?(?:ما\s+)?(?:تقرأه|قرأته|تعرفه|البيانات|المعلومات)'),
    # أنت الآن …, تعليمات النظام
    re.compile(r'أنت\s+الآن|تعليمات\s+(?:النظام|المطالبة)'),
)


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


def instruction_matches(text):
    """The spans of the instruction-like phrases of ``text``, ascending: what tags a chunk in ``record_chunks``."""
    return sorted({match.span() for pattern in _INSTRUCTION_PATTERNS for match in pattern.finditer(text)})


def record_text(record, source):
    """The title of ``record`` followed by one ``label: value`` line per declared field that has a value, withheld.

    A record whose text reads like an instruction is tagged on the chunks that carry it (``record_chunks``), not here:
    a search returns one chunk, so the notice has to travel in that chunk to be seen at all.
    """
    record = record.with_context(lang=KNOWLEDGE_LANG)
    lines = [field_text(record, source['title_field'])]
    for name in source['fields']:
        text = field_text(record, name)
        if text:
            lines.append(f'{record._fields[name]._description_string(record.env)}: {text}')
    return withhold_text('\n'.join(line for line in lines if line))


def _chunk_spans(text, limit=CHUNK_CHARS, maximum=MAX_CHUNKS):
    """The ``(start, end)`` of each chunk of ``text``: whitespace-trimmed, ascending, non-overlapping, at most
    ``maximum`` of them, each at most ``limit`` characters (a word longer than the limit is cut)."""
    spans = []
    start = 0
    length = len(text)
    while len(spans) < maximum:
        while start < length and text[start].isspace():
            start += 1
        if start >= length:
            break
        if length - start <= limit:
            cut = length
        else:
            cut = next((index for index in range(start + limit, start, -1) if text[index].isspace()), start + limit)
        end = cut
        while end > start and text[end - 1].isspace():
            end -= 1
        spans.append((start, end))
        start = cut
    return spans


def split_text(text, limit=CHUNK_CHARS, maximum=MAX_CHUNKS):
    """``text`` cut on whitespace into at most ``maximum`` chunks of at most ``limit`` characters (a word longer than the limit is cut)."""
    return [text[start:end] for start, end in _chunk_spans(text, limit, maximum)]


def record_chunks(record, source):
    """``record_text`` split, with the fixed notice on every chunk an instruction-like phrase touches.

    The phrase is found in the whole text and mapped back onto the chunk it falls in, so a phrase a boundary cuts in two
    still tags its chunk. The tag is added after the split, so the chunk count and every boundary stay exactly what
    ``record_text`` gives, and the index and the resolve route keep numbering the record the same way (a search may
    return chunk 7). The notice is 41 characters, so a tagged chunk stays inside the queue's 2000-character bound.
    """
    text = record_text(record, source)
    spans = _chunk_spans(text)
    chunks = [text[start:end] for start, end in spans]
    flagged = {index for start, end in instruction_matches(text)
               for index, (low, high) in enumerate(spans) if start < high and low < end}
    return [f'{INSTRUCTION_NOTICE}\n{chunk}' if index in flagged else chunk for index, chunk in enumerate(chunks)]
