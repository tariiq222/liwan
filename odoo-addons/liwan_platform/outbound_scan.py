# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The outbound data policy's content scan (spec 2026-11-04 §6.12, layer 2) for text that Odoo itself sends toward a
provider: a port of the patterns of ``apps/web/server/utils/ai/outbound.ts``, so the knowledge chunks that leave in the
indexing queue are scanned exactly as a tool result is. Keep the patterns of the two in step. Odoo holds no token key, so
here every kind is withheld with its marker; the Nuxt server turns mobile numbers and emails of a live run into tokens it
restores, which indexed text never needs.

Every value with a fixed shape that the policy withholds is replaced by a marker naming its kind. A pattern errs towards
withholding: a few extra characters withheld are better than a value sent.
"""
import re

MARKERS = {
    'national_id': '[national_id withheld]',
    'iban': '[iban withheld]',
    'phone': '[phone withheld]',
    'email': '[email withheld]',
}

# Arabic-Indic and Extended Arabic-Indic digits are scanned as their Latin digits: one character each, so indices stay put.
_ARABIC_DIGITS = re.compile(r'[\u0660-\u0669\u06f0-\u06f9]')
# A separator inside a written number: a space (no-break included), a dot or a hyphen.
_SEP = r'[\s.\-]?'
# The ASCII digit and the Unicode letter, as the TypeScript patterns spell them (\d and \p{L}); Python's \d is wider.
_DIGIT = '[0-9]'
_LETTER = r'[^\W\d_]'
_ALNUM = r'[^\W_]'

# Order matters: an IBAN contains digit runs and an email may contain one, so the longer shapes are withheld first. Every
# part of the email is bounded (RFC 5321 sizes), so a long run without a match costs linear time, not quadratic.
_PATTERNS = (
    ('email', re.compile(
        rf'(?:{_ALNUM}|[._%+\-]){{1,64}}@(?:{_ALNUM}|-){{1,63}}(?:\.(?:{_ALNUM}|-){{1,63}}){{0,8}}\.{_LETTER}{{2,24}}',
    )),
    ('iban', re.compile(rf'SA{_SEP}{_DIGIT}{_SEP}{_DIGIT}(?:{_SEP}[0-9A-Z]){{20}}', re.IGNORECASE)),
    ('phone', re.compile(
        rf'(?<![0-9+])(?:\(?(?:\+|00)?966\)?{_SEP}(?:\(?0\)?{_SEP})?|0)5{_SEP}{_DIGIT}(?:{_SEP}{_DIGIT}){{7}}(?!{_DIGIT})',
    )),
    ('national_id', re.compile(rf'(?<!{_DIGIT})[12](?:{_SEP}{_DIGIT}){{9}}(?!{_DIGIT})')),
)


def latin_digits(text):
    return _ARABIC_DIGITS.sub(lambda match: str(ord(match.group()) & 0xF), text)


def is_saudi_id(digits):
    """The check digit of a Saudi national ID or iqama number (the Luhn rule on ten digits): it keeps ordinary numbers through."""
    total = 0
    for index, char in enumerate(digits):
        digit = int(char)
        doubled = digit * 2 if index % 2 == 0 else digit
        total += doubled - 9 if doubled > 9 else doubled
    return total % 10 == 0


def _replace_spans(text, spans, marker):
    """``text`` with each span (ascending, non-overlapping) replaced by ``marker``, built in one pass whatever the number of spans."""
    parts = []
    cursor = 0
    for start, end in spans:
        parts.append(text[cursor:start])
        parts.append(marker)
        cursor = end
    parts.append(text[cursor:])
    return ''.join(parts)


def withhold_text(text):
    """One text with every withheld value replaced by its marker."""
    scanned = latin_digits(text)
    output = text
    for kind, pattern in _PATTERNS:
        if kind == 'email' and '@' not in scanned:
            continue
        spans = []
        for match in pattern.finditer(scanned):
            if kind == 'national_id' and not is_saudi_id(re.sub(r'\D', '', match.group())):
                continue
            spans.append(match.span())
        if not spans:
            continue
        # Both strings change together (same spans, same marker), so their indices stay aligned for the next pattern.
        output = _replace_spans(output, spans, MARKERS[kind])
        scanned = _replace_spans(scanned, spans, MARKERS[kind])
    return output
