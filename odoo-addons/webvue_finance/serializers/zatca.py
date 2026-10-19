# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only ZATCA e-invoicing readiness and submission state, derived from stock ``l10n_sa_edi`` data.

States, booleans and short ZATCA validation messages only: the private key, the CSR, the CSIDs and
their secrets, and raw ZATCA responses, are never read into these shapes.
"""
import html
import re
from collections import Counter

MAX_ITEMS = 20
MAX_TEXT = 500
# What the client sees instead of raw stock or ZATCA text for the failures that carry no ZATCA rule code.
UNAVAILABLE_MESSAGE = 'ZATCA could not be reached or answered unexpectedly; retry later'
UNAUTHORIZED_MESSAGE = 'ZATCA refused the journal certificate (expired or revoked); onboard the journal again'
BLOCKED_MESSAGE = 'The invoice could not be processed here; check the journal onboarding and the invoice data'
UNAUTHORIZED_STATUSES = frozenset({'401', '403'})
MAX_LOCAL_TEXT = 200
STATUS_MARKER = re.compile(r'\[(\d{3})\]')
ZATCA_FORMAT_CODE = 'sa_zatca'
# Stock logs one alert box per submission in the chatter; its warning lines read "<b>CODE</b> : message".
ALERT = re.compile(r"class=[\"']alert alert-(\w+)")
CODED_LINE = re.compile(r'^(?:\[\d+\]\s*)?([A-Z][A-Za-z0-9-]*-[A-Za-z0-9-]+)\s*:\s*(.+)$')
WARNING_LINE = re.compile(r'<b>([^<]+)</b>\s*:\s*([^<]+)')


def plain_text(value):
    """Visible text of a stock HTML message, truncated; tags are dropped and entities decoded."""
    text = html.unescape(re.sub(r'<[^>]+>', '', value or '')).strip()
    return text[:MAX_TEXT]


def _html_lines(value):
    pieces = re.split(r'<br\s*/?>|</p>|</li>|\n', value or '')
    return [line for line in (plain_text(piece) for piece in pieces) if line]


def _coded_message(line):
    match = CODED_LINE.match(line)
    return {'code': match.group(1), 'message': match.group(2)[:MAX_TEXT]} if match else {'code': None, 'message': line}


def _journal_state(journal):
    # The stock readiness helper is the authority: a reset clears the CSID but keeps the certificate link.
    if journal._l10n_sa_ready_to_submit_einvoices():
        return 'onboarded'
    return 'compliance_checked' if journal.l10n_sa_compliance_checks_passed else 'not_started'


def dump_zatca_journal(journal):
    state = _journal_state(journal)
    return {
        'journal': {'id': journal.id, 'name': journal.name},
        'onboarded': state == 'onboarded',
        'state': state,
    }


def dump_zatca_readiness(company):
    journals = company.env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'sale')])
    rows = [dump_zatca_journal(journal) for journal in journals]
    private_key_present = bool(company.l10n_sa_private_key_id)
    return {
        'api_mode': company.l10n_sa_api_mode,
        'private_key_present': private_key_present,
        'journals': rows,
        'onboarded': private_key_present and bool(rows) and all(row['onboarded'] for row in rows),
    }


def dump_zatca_backlog(company):
    """Counts of the posted ZATCA documents of ``company`` still waiting, read in the caller's environment.

    ``to_send`` has no blocking level yet; ``retry`` is blocked with a warning or info level (no verdict, the cron tries
    again); ``rejected`` and ``blocked`` are the two kinds of error-level documents, told apart by the same
    classification as a single submission.
    """
    waiting = [
        ('move_id.company_id', '=', company.id), ('move_id.state', '=', 'posted'),
        ('edi_format_id.code', '=', ZATCA_FORMAT_CODE), ('state', '=', 'to_send'),
    ]
    documents = company.env['account.edi.document']
    by_level = dict(documents._read_group(waiting, groupby=['blocking_level'], aggregates=['__count']))
    errors = documents.search([*waiting, ('blocking_level', '=', 'error')])
    kinds = Counter(_classify(document)[0] for document in errors)
    return {
        'to_send': by_level.get(False, 0), 'retry': by_level.get('warning', 0) + by_level.get('info', 0),
        'rejected': kinds['rejected'], 'blocked': kinds['blocked'],
    }


def zatca_document(move):
    return move.edi_document_ids.filtered(lambda document: document.edi_format_id.code == ZATCA_FORMAT_CODE)[:1]


def _local_message(lines):
    """Stock's own short text of a local failure; anything that looks like a dumped response is replaced."""
    text = ' '.join(lines)[:MAX_LOCAL_TEXT]
    return text if text and '{' not in text and '}' not in text else BLOCKED_MESSAGE


def _classify(document):
    """``(state, errors)`` of a ZATCA EDI document, from what stock stored on it.

    Stock stores, with ``blocking_level`` ``error``: a ZATCA rejection (coded validation lines) or a failure
    that never reached a verdict (signing, certificate, chain-head block, undecodable answer) and with
    ``warning``: ZATCA answering with warnings only, a non-400 HTTP status (``[401]``...) or no answer at all.
    """
    if document.state == 'sent':
        return 'accepted', []
    if document.state != 'to_send':
        return 'not_applicable', []
    level = document.blocking_level
    if not level:
        return 'pending', []
    lines = _html_lines(document.error)
    marker = STATUS_MARKER.search(plain_text(document.error))
    status = marker.group(1) if marker else None
    verdict = status is None or status == '400' or status.startswith('2')  # other statuses carry a raw body
    coded = [m for m in map(_coded_message, lines) if m['code']][:MAX_ITEMS] if verdict else []
    if level == 'error':
        return ('rejected', coded) if coded else ('blocked', [{'code': None, 'message': _local_message(lines)}])
    if coded:
        return 'retry', coded
    if status in UNAUTHORIZED_STATUSES:
        return 'unauthorized', [{'code': None, 'message': UNAUTHORIZED_MESSAGE}]
    return 'retry', [{'code': None, 'message': UNAVAILABLE_MESSAGE}]


def _chatter_warnings(move):
    """The warning lines ZATCA attached to the acceptance, from the newest alert box in the chatter.

    Stock keeps them nowhere else. The alert class (not its translated title) identifies the box; the sanitizer drops its ``role``.
    """
    for message in move.message_ids:
        body = message.body or ''
        alert = ALERT.search(body)
        if alert:
            if alert.group(1) != 'warning':
                return []
            return [
                {'code': html.unescape(code).strip(), 'message': html.unescape(text).strip()[:MAX_TEXT]}
                for code, text in WARNING_LINE.findall(body)
            ][:MAX_ITEMS]
    return []


def dump_zatca_submission(move):
    """Where a document stands with ZATCA.

    ``not_applicable``, ``pending``, ``accepted`` (with ``warnings``), ``rejected`` (ZATCA's validation
    errors), ``retry`` (no verdict yet: ZATCA unreachable, 5xx, or warnings only; a retry is safe, and stock
    keeps the chain index only when ZATCA may have received the document), ``blocked`` (a local failure
    before any verdict) and ``unauthorized`` (ZATCA refused the journal certificate: onboard again).
    ``mode`` is ``clearance`` for a standard (B2B) invoice and ``reporting`` for a simplified (B2C) one.
    """
    document = zatca_document(move)
    state, errors = _classify(document) if document else ('not_applicable', [])
    return {
        'state': state,
        'mode': ('reporting' if move._l10n_sa_is_simplified() else 'clearance') if state != 'not_applicable' else None,
        'errors': errors,
        'warnings': _chatter_warnings(move) if state == 'accepted' else [],
        'qr_present': bool(move.l10n_sa_qr_code_str),
    }
