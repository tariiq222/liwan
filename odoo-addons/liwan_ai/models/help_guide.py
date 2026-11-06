# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The LiwanOS user guide the help agent answers from (spec 2026-11-04 §6.13).

The guide is Markdown shipped with this addon, ``data/help/<lang>/<app>.md``, one file per application section::

    # <section title>
    pages: <page names the section answers for>

    ## <task>
    page: </route that does the task>
    1. <step>

``search_sections`` ranks the sections for a question by plain term matching over normalized Arabic and English text (no
embeddings); the guide holds no tenant record, so searching it needs no access beyond the assistant's own capability.
"""
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from odoo import api, models
from odoo.tools import file_path

GUIDE_DIR = 'liwan_ai/data/help'
GUIDE_LANGS = ('ar', 'en')
MAX_ITEMS = 3
MAX_SECTION_CHARS = 1500
MAX_TEXT_CHARS = 4000
PAGE_LINE = re.compile(r'^page:\s*(\S+)\s*$')
PAGES_LINE = re.compile(r'^pages:\s*(.+)$')
PAGE_PATH = re.compile(r'^/[A-Za-z0-9_\-/]*$')
WORD = re.compile(r'\w+')

TITLE_WEIGHT = 4
GUIDE_TITLE_WEIGHT = 2
BODY_WEIGHT = 1
BODY_REPEAT_CAP = 3
# A word that only shares its consonants with a title word (أضيف / إضافة) counts for half a stem match.
SKELETON_TITLE_WEIGHT = 2
SKELETON_BODY_WEIGHT = 1
MIN_SKELETON = 2
PAGE_BOOST = 3

# Tashkeel, the dagger alef and the tatweel are dropped; the alef, hamza, yeh and teh-marbuta variants fold to one letter.
_FOLD = {
    **dict.fromkeys([*range(0x064B, 0x0660), 0x0670, 0x0640]),
    **{ord(letter): folded for letter, folded in {'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه'}.items()},
    **{ord(digit): str(index) for index, digit in enumerate('٠١٢٣٤٥٦٧٨٩')},
}
_WEAK_LETTERS = str.maketrans('', '', 'اويء')
_ARABIC_PREFIXES = ('وال', 'بال', 'كال', 'فال', 'لل', 'ال')
_ARABIC_SUFFIXES = ('ات', 'ين', 'ون', 'ان')
MIN_STEM = 2


def normalize(text):
    """Lower-cased text with Arabic diacritics removed and letter variants folded."""
    return text.casefold().translate(_FOLD)


def stem(word):
    """A light stem of one normalized word: the Arabic article and plural endings, an English plural ``s``."""
    if word.isascii():
        if word.endswith('ies') and len(word) > 4:
            return word[:-3] + 'y'
        return word[:-1] if word.endswith('s') and not word.endswith('ss') and len(word) > 3 else word
    for prefix in _ARABIC_PREFIXES:
        if word.startswith(prefix) and len(word) - len(prefix) > MIN_STEM:
            word = word[len(prefix):]
            break
    for suffix in _ARABIC_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) > MIN_STEM:
            return word[:-len(suffix)]
    if word.endswith(('ه', 'ا')) and len(word) - 1 > MIN_STEM:
        # The teh marbuta (folded to heh) and the accusative alef (جديدا, موظفا).
        return word[:-1]
    return word


def skeleton(word):
    """The consonants of an Arabic stem, so a verb and its noun (أضيف, إضافة) meet; empty for any other word."""
    return '' if word.isascii() else word.translate(_WEAK_LETTERS)


def stems(text):
    return [stem(word) for word in WORD.findall(normalize(text))]


STOPWORDS = frozenset(stems(
    'كيف ما ماذا هل اين متى لماذا من في على الى عن لي لا انا اريد ابغى ممكن اقدر يمكن هذا هذه ذلك التي الذي مع او ثم هو هي نحن '
    'كل بعد قبل how do does did i can to the a an of in on for my me is are what where when why which with and or it this '
    'that be should would',
))


def _section(app_title, pages, title, lines):
    page = None
    body = []
    for line in lines:
        match = PAGE_LINE.match(line)
        if match and page is None:
            page = match.group(1) if PAGE_PATH.match(match.group(1)) else None
        else:
            body.append(line)
    text = '\n'.join(body).strip()
    return {
        'app': app_title, 'title': title, 'text': text, 'page': page, 'pages': pages,
        '_title_stems': frozenset(stems(title)), '_guide_stems': frozenset(stems(app_title)),
        '_body_stems': Counter(stems(f'{title} {text}')),
        '_title_skeletons': frozenset(skeleton(word) for word in stems(title)) - {''},
        '_body_skeletons': frozenset(skeleton(word) for word in stems(f'{title} {text}')) - {''},
    }


def parse_guide(source):
    """The sections of one guide file: ``app`` (the file's title), ``title``, ``text``, ``page`` (a route or ``None``) and
    ``pages`` (the page names the file answers for). Text before the first ``##`` belongs to no section."""
    app_title, pages, title, lines, sections = '', (), None, [], []
    for line in source.splitlines():
        if line.startswith('## '):
            if title is not None:
                sections.append(_section(app_title, pages, title, lines))
            title, lines = line[3:].strip(), []
        elif line.startswith('# ') and title is None:
            app_title = line[2:].strip()
        elif title is None:
            match = PAGES_LINE.match(line)
            pages = tuple(match.group(1).split()) if match else pages
        else:
            lines.append(line)
    if title is not None:
        sections.append(_section(app_title, pages, title, lines))
    return sections


@lru_cache(maxsize=len(GUIDE_LANGS))
def load_guide(directory):
    """Every section of the guide files in ``directory``, in file-name order (the files ship with a release)."""
    return tuple(section for path in sorted(Path(directory).glob('*.md')) for section in parse_guide(path.read_text(encoding='utf-8')))


def _score(section, query, page):
    """``query`` is a list of ``(stem, weight)``: a word found in few sections weighs more than a common one."""
    score = 0
    for word, weight in query:
        if word in section['_title_stems']:
            score += weight * TITLE_WEIGHT
        elif len(skeleton(word)) >= MIN_SKELETON and skeleton(word) in section['_title_skeletons']:
            score += weight * SKELETON_TITLE_WEIGHT
        if word in section['_guide_stems']:
            score += weight * GUIDE_TITLE_WEIGHT
        if section['_body_stems'][word]:
            score += weight * BODY_WEIGHT * min(section['_body_stems'][word], BODY_REPEAT_CAP)
        elif len(skeleton(word)) >= MIN_SKELETON and skeleton(word) in section['_body_skeletons']:
            score += weight * SKELETON_BODY_WEIGHT
    return score + PAGE_BOOST if score and page in section['pages'] else score


def _weighted(sections, words):
    """The query words with their rarity across the guide (inverse document frequency)."""
    return [
        (word, math.log(1 + len(sections) / (1 + sum(word in section['_body_stems'] for section in sections))))
        for word in dict.fromkeys(words)
    ]


def _bounded(sections):
    """The answer for the best ``sections``: at most ``MAX_ITEMS`` of them, each text cut hard (no ellipsis) at
    ``MAX_SECTION_CHARS`` and the sections after the first dropped once the total passes ``MAX_TEXT_CHARS``. The shipped guide
    keeps every section within the cut, so a truncated text only ever comes from a section written too long."""
    items, spent = [], 0
    for section in sections[:MAX_ITEMS]:
        text = section['text'][:MAX_SECTION_CHARS]
        if items and spent + len(text) > MAX_TEXT_CHARS:
            break
        spent += len(text)
        items.append({'app': section['app'], 'title': section['title'], 'text': text, 'page': section['page']})
    return items


def search_sections(sections, query, page=None):
    """The best matching sections for ``query`` (at most ``MAX_ITEMS``, within ``MAX_TEXT_CHARS`` of text), best first.

    Question words carry no meaning and are ignored. With no query, a ``page`` returns the sections written for that page.
    A section none of whose words match is never returned.
    """
    words = [word for word in stems(query or '') if word not in STOPWORDS]
    if not words:
        return _bounded([section for section in sections if page and page in section['pages']])
    query = _weighted(sections, words)
    ranked = sorted(((_score(section, query, page), index) for index, section in enumerate(sections)), key=lambda hit: (-hit[0], hit[1]))
    return _bounded([sections[index] for score, index in ranked if score > 0])


class LiwanAiHelpGuide(models.AbstractModel):
    """Searches the shipped user guide in the caller's language, then in the other one when it finds nothing."""
    _name = 'liwan.ai.help.guide'
    _description = 'LiwanOS user guide search'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_guide_languages(self):
        primary = 'ar' if (self.env.lang or 'ar').startswith('ar') else 'en'
        return [primary, *(lang for lang in GUIDE_LANGS if lang != primary)]

    @api.model
    def _liwan_ai_help_search(self, query, page=None):
        for lang in self._liwan_ai_guide_languages():
            try:
                directory = file_path(f'{GUIDE_DIR}/{lang}')
            except FileNotFoundError:
                continue
            items = search_sections(load_guide(directory), query, page)
            if items:
                return items
        return []
