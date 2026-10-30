# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The text normalization rule matching is done on: the same function normalizes keywords and inbound text."""
import re
import unicodedata

# Arabic diacritics (harakat, Quranic marks), the dagger alef and the tatweel.
DIACRITICS = re.compile(r'[\u0610-\u061a\u064b-\u065f\u0670\u0640]')
# Alef forms become a bare alef, alef maqsura becomes yaa and taa marbuta becomes haa.
LETTER_FORMS = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه'})
# Arabic-Indic (U+0660..0669) and Persian (U+06F0..06F9) digits become ASCII digits.
DIGITS = str.maketrans({chr(0x660 + digit): str(digit) for digit in range(10)} | {chr(0x6F0 + digit): str(digit) for digit in range(10)})
WORD = re.compile(r'\w+')


def normalize_text(text):
    """Case-folded text without Arabic diacritics or tatweel, with unified letter forms and single spaces."""
    text = DIACRITICS.sub('', unicodedata.normalize('NFKC', text or '')).translate(LETTER_FORMS).translate(DIGITS).casefold()
    return ' '.join(text.split())


def word_tokens(text):
    """The normalized words of `text` joined by single spaces (punctuation dropped), for whole-word matching."""
    return ' '.join(WORD.findall(normalize_text(text)))
