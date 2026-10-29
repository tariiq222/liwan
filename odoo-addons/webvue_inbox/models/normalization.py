# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The text normalization rule matching is done on: the same function normalizes keywords and inbound text."""
import re
import unicodedata

# Arabic diacritics (harakat, Quranic marks), the dagger alef and the tatweel.
DIACRITICS = re.compile(r'[\u0610-\u061a\u064b-\u065f\u0670\u0640]')
# Alef forms become a bare alef, alef maqsura becomes yaa and taa marbuta becomes haa.
LETTER_FORMS = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه'})


def normalize_text(text):
    """Case-folded text without Arabic diacritics or tatweel, with unified letter forms and single spaces."""
    text = DIACRITICS.sub('', unicodedata.normalize('NFKC', text or '')).translate(LETTER_FORMS).casefold()
    return ' '.join(text.split())
