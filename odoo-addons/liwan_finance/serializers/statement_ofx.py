# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""OFX bank statements, version 1 (SGML) and version 2 (XML), read with no database and no Odoo import.

Both versions are a stream of ``<TAG>value`` leaves and ``<TAG>`` ... ``</TAG>`` aggregates; version 1 leaves have no
closing tag. The reader builds the tree from the tags alone (never an XML parser, so a file cannot declare entities)
and takes the account, the currency, the closing balance and every ``STMTTRN``. A structural problem raises
``OfxError``; a transaction that cannot be read is reported with its number so the file is accepted whole or not at all.
"""
import html
import re
from collections import Counter
from datetime import date

AGGREGATES = frozenset({
    'OFX', 'SIGNONMSGSRSV1', 'SONRS', 'STATUS', 'FI', 'BANKMSGSRSV1', 'CREDITCARDMSGSRSV1', 'STMTTRNRS', 'CCSTMTTRNRS',
    'STMTRS', 'CCSTMTRS', 'BANKACCTFROM', 'CCACCTFROM', 'BANKTRANLIST', 'STMTTRN', 'LEDGERBAL', 'AVAILBAL', 'PAYEE',
})
STATEMENTS = ('STMTRS', 'CCSTMTRS')
ACCOUNTS = ('BANKACCTFROM', 'CCACCTFROM')
ROOT = re.compile(r'<OFX\s*>', re.IGNORECASE)
TAG = re.compile(r'<(/?)([A-Za-z][A-Za-z0-9.]*)\s*(/?)>([^<]*)')
CDATA = re.compile(r'<!\[CDATA\[(.*?)\]\]>', re.DOTALL)
MAX_DEPTH = 12  # a statement nests about six deep; a deeper file is refused instead of walked
OFX_DATE = re.compile(r'(\d{4})(\d{2})(\d{2})')
OFX_NUMBER = re.compile(r'[+-]?(\d+([.,]\d+)?|[.,]\d+)')
MAX_REFERENCE = 255


class OfxError(ValueError):
    """The file is not an OFX statement we can read; the message says why."""


class _Node:
    __slots__ = ('children', 'name', 'value')

    def __init__(self, name, value=None):
        self.name, self.value, self.children = name, value, []

    def leaf(self, name):
        return next((child.value for child in self.children if child.name == name), None)

    def all(self, *names):
        for child in self.children:
            if child.name in names:
                yield child
            yield from child.all(*names)


def _tree(text):
    text = CDATA.sub(lambda section: html.escape(section.group(1)), text)
    root_tag = ROOT.search(text)
    if not root_tag:
        message = 'the file has no <OFX> element'
        raise OfxError(message)
    root = _Node('OFX')
    stack = [root]
    for tag in TAG.finditer(text, root_tag.end()):
        closing, name, selfclosed, value = tag.group(1), tag.group(2).upper(), tag.group(3), tag.group(4).strip()
        if closing:
            if any(node.name == name for node in stack[1:]):
                while stack.pop().name != name:
                    pass
            continue
        node = _Node(name, html.unescape(value) or None)
        stack[-1].children.append(node)
        if not value and not selfclosed and name in AGGREGATES:
            if len(stack) >= MAX_DEPTH:
                message = f'the file nests elements more than {MAX_DEPTH} levels deep'
                raise OfxError(message)
            stack.append(node)
    return root


def _amount(text):
    value = text.replace(' ', '')
    if not OFX_NUMBER.fullmatch(value):
        raise ValueError(text)
    return round(float(value.replace(',', '.')), 2)


def _day(text):
    match = OFX_DATE.match(text)
    if not match:
        raise ValueError(text)
    return date(*map(int, match.groups()))


def _reference(transaction):
    name, memo = transaction.leaf('NAME'), transaction.leaf('MEMO')
    parts = [part for part in (name, memo) if part]
    text = parts[0] if len(set(parts)) == 1 else ' - '.join(parts)
    return ' '.join(text.split())[:MAX_REFERENCE] if parts else '-'


def _unique_id(fitid, seen):
    """The id a transaction is remembered by, unique within the file by construction.

    The FITID is escaped (``%`` as ``%25``, ``#`` as ``%23``), so the escaped text never holds ``#``. Some banks repeat a
    FITID inside one file: the first use keeps the escaped id and the next ones get ``#2``, ``#3``... in file order. A
    literal ``BANK-ID#2`` is ``BANK-ID%232`` and cannot meet the second ``BANK-ID`` (``BANK-ID#2``). Importing the same
    file again yields the same ids, so it is caught as duplicates."""
    if not fitid:
        return None
    escaped = fitid.replace('%', '%25').replace('#', '%23')
    seen[escaped] += 1
    return escaped if seen[escaped] == 1 else f'{escaped}#{seen[escaped]}'


def _lines(statement):
    lines, errors, seen = [], [], Counter()
    for number, transaction in enumerate(statement.all('STMTTRN'), start=1):
        try:
            day = _day(transaction.leaf('DTPOSTED') or '')
        except ValueError:
            errors.append({'row': number, 'field': 'date', 'message': 'not a date'})
            continue
        try:
            amount = _amount(transaction.leaf('TRNAMT') or '')
        except ValueError:
            errors.append({'row': number, 'field': 'amount', 'message': 'not a number'})
            continue
        if not amount:
            errors.append({'row': number, 'field': 'amount', 'message': 'the amount is zero'})
            continue
        fitid = _unique_id(transaction.leaf('FITID'), seen)
        lines.append({'row': number, 'date': day, 'payment_ref': _reference(transaction), 'amount': amount, 'fitid': fitid})
    return lines, errors


def _closing_balance(statement):
    """The ledger balance, else the available one; ``None`` when the statement states neither."""
    for name in ('LEDGERBAL', 'AVAILBAL'):
        for balance in statement.all(name):
            try:
                return _amount(balance.leaf('BALAMT') or '')
            except ValueError:
                message = f'{name} has no readable amount'
                raise OfxError(message) from None
    return None


def parse_ofx(text):
    """The statements of an OFX file: ``{currency, account_number, balance_end, lines, errors}`` each, in file order."""
    statements = []
    for statement in _tree(text).all(*STATEMENTS):
        account = next(statement.all(*ACCOUNTS), None)
        lines, errors = _lines(statement)
        statements.append({
            'currency': statement.leaf('CURDEF'),
            'account_number': account.leaf('ACCTID') if account else None,
            'balance_end': _closing_balance(statement),
            'lines': lines,
            'errors': errors,
        })
    if not statements:
        message = 'the file has no bank or card statement'
        raise OfxError(message)
    return statements
