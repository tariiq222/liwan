# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""R7 gate: no sudo() without a recorded justification.

AGENTS.md owns the rule: R7 forbids a new `sudo()` outside the documented cases, and the sudo
paragraph of the product contracts says why each case exists and that adding one needs the owner's
approval. `tools/arch_policy.py` only compares per-file counts against `tools/arch_baseline.json`
and never reads a reason, so today a contributor can raise a documented count and the baseline
together. This tool closes that hole and runs inside `npm test`:

1. a `sudo()` site beyond its file's allowance (`arch_baseline.json` R7 plus the documented case
   count of `tools/arch_documented_sudo.json`) fails by `file:line`, so a call that nobody
   justified is reported where it is written;
2. a documented case must still exist in the code and be named in the AGENTS.md sudo paragraph
   (`arch_policy.documented_problems`);
3. every documented reason must name the elevating call and the blocking ACL, record rule, group
   or capability, and no two cases may share one reason (`arch_policy.documented_weakenings`);
4. a documented count that the code no longer reaches fails, and a documented count must not fall
   below what the reference allows (`arch_policy.documented_growth`, run when `--base` is given).

Owner decision 2026-10-25: adding a documented case no longer needs an
`Architecture-approved-by:` trailer. A reason is still mandatory and is still judged for
shape by this gate; the owner accepted that a weak reason can now be written without a
signature, and that the review of the actual diff is what catches it.

The allowance of rule 1 is per file, because the baseline records how many sites a file may keep,
not which lines they are. A file over its allowance therefore reports its last unaccounted sites:
the author sees the call they added, or a line of the same file that must be documented with it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from arch_policy import (
    BASELINE_FILE,
    DOCUMENTED_SUDO_FILE,
    LAYERS_FILE,
    ROOT,
    UnknownRef,
    collect,
    documented_counts,
    documented_growth,
    documented_problems,
    sudo_sites,
)

# A reason names the elevating call with a code token (a `backticked` name, a snake_case symbol, a
# dotted key of three or more segments, or a `name()` call), not just prose about needing sudo.
CALL_TOKEN = re.compile(
    r'`[^`\n]+`|\b[a-z][a-z0-9_]*_[a-z0-9_]+\b|\b[a-z][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){2,}\b|\b[a-z_][a-z0-9_]*\(\)',
)
# ... and names what blocks the caller. Three blocker classes count, because Odoo enforces access at
# three layers and a real reason must name the one that actually applies:
#   1. an ACL row or record rule (named, or as an id) or an Odoo access file;
#   2. a group, model or visibility domain of an addon, or a LiwanOS capability or feature key;
#   3. a **Python-level access filter** — the identity-, partner- or parent-based narrowing a model
#      applies inside `_search`/`_check_access`/`check_access`. It is not an ir.rule and cannot be
#      cited as one, so without this class `mail.message` (whose visibility is decided in Python) has
#      no honest way to be documented at all; the alternative was a false ACL citation.
ACCESS_TOKEN = re.compile(
    r'\b[a-z0-9_]*(?:rule|access)s?[a-z0-9_]*\b'
    r'|\b[a-z0-9_]*_(?:group|model|domain)[a-z0-9_]*\b|\b(?:group|model|domain)_[a-z0-9_]+\b'
    r'|\b[a-z0-9_]*_security\.(?:csv|xml)\b|security/|\.csv\b|\bACL\b'
    r'|\b[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*){2,}\b'
    r'|\b_search\b|\b_check_access\b|\bcheck_access\b|\bvisibility filter\b'
    r'|\bPython-level\b|\bpartner_ids\b|\bmessage_partner_ids\b',
)
REASON_MIN_WORDS = 8
REASON_MIN_CHARS = 40
UNREGISTERED_ADDON = 'unregistered addon'


def reason_problems(cases: dict) -> list[str]:
    """R7: every documented case carries a specific reason, and no two cases share one.

    `cases` is the `cases` object of `tools/arch_documented_sudo.json`: `{file: {count, reason}}`.
    """
    problems = []
    seen: dict[str, str] = {}
    for rel, case in sorted(cases.items()):
        reason = case.get('reason') if isinstance(case, dict) else None
        if not isinstance(reason, str) or not reason.strip():
            problems.append(
                f'R7: {rel}: the documented sudo case has no reason in {DOCUMENTED_SUDO_FILE.name}; '
                'state what the call elevates and which ACL or rule blocks the caller',
            )
            continue
        missing = []
        if len(re.findall(r'\S+', reason)) < REASON_MIN_WORDS or len(reason) < REASON_MIN_CHARS:
            missing.append(f'at least {REASON_MIN_WORDS} words of justification')
        if not CALL_TOKEN.search(reason):
            missing.append('the elevating call (a `code` token, a snake_case name, a dotted key or a name())')
        if not ACCESS_TOKEN.search(reason):
            missing.append('the blocking ACL, record rule, group or capability')
        if missing:
            problems.append(
                f'R7: {rel}: the documented sudo reason in {DOCUMENTED_SUDO_FILE.name} is not specific '
                f'enough; it needs {"; ".join(missing)}',
            )
            continue
        key = ' '.join(reason.casefold().split())
        if key in seen:
            problems.append(
                f'R7: {rel}: the documented sudo reason in {DOCUMENTED_SUDO_FILE.name} duplicates the '
                f'reason of {seen[key]}; each case needs its own',
            )
        else:
            seen[key] = rel
    return problems


def sudo_lines(rel: str, text: str) -> list[int]:
    """The lines of the sudo sites of one addon file, with the same semantics as `collect`."""
    return [line for line, _kind in sudo_sites(text, superuser_id='migrations' not in Path(rel).parts)]


def site_lines(root: Path, found: dict, hard: list[str]) -> tuple[dict[str, list[int]], list[str]]:
    """The sudo sites of every counted file, plus the addons whose sites the scan cannot see.

    Of the hard findings of `collect`, only an unregistered addon is this gate's business: it is the one
    that hides sudo sites from the scan. Every other hard finding belongs to `arch_policy`.
    """
    sites = {}
    problems = []
    for rel, expected in sorted(found['R7'].items()):
        lines = sudo_lines(rel, (root / rel).read_text(encoding='utf-8', errors='replace'))
        if len(lines) != expected:
            problems.append(f'R7: {rel}: the line scan found {len(lines)} sudo sites, the count scan found {expected}')
        sites[rel] = lines
    problems += [f'R7: {problem} (its sudo() sites are unchecked)' for problem in hard if problem.startswith(UNREGISTERED_ADDON)]
    return sites, problems


def undocumented_sites(sites: dict[str, list[int]], allowed: dict[str, int]) -> list[str]:
    """R7: every sudo site of a file beyond its allowance (documented cases plus the baseline)."""
    problems = []
    for rel, lines in sorted(sites.items()):
        permitted = allowed.get(rel, 0)
        for line in lines[permitted:]:
            problems.append(
                f'R7: {rel}:{line}: sudo() has no documented justification '
                f'({len(lines)} found, {permitted} allowed by {DOCUMENTED_SUDO_FILE.name} '
                f'and {BASELINE_FILE.name}); add a reason to {DOCUMENTED_SUDO_FILE.name} or remove the call',
            )
    return problems


def allowances(baseline: dict[str, int], documented: dict[str, int]) -> dict[str, int]:
    """The sudo sites each file may keep: its baseline count plus its documented case count."""
    return {rel: baseline.get(rel, 0) + documented.get(rel, 0) for rel in set(baseline) | set(documented)}


def default_base() -> str | None:
    """The ref CI compares the change with; local runs pass `--base` explicitly."""
    return os.environ.get('CI_BASE_REF') or None


def main(
    argv: list[str] | None = None,
    root: Path = ROOT,
    layers_file: Path = LAYERS_FILE,
    baseline_file: Path = BASELINE_FILE,
    documented_file: Path | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--base', metavar='REF', default=default_base() if argv is None else None,
        help='also fail a documented count that the code no longer reaches (default: $CI_BASE_REF)',
    )
    args = parser.parse_args(argv)
    documented_file = documented_file or baseline_file.with_name(DOCUMENTED_SUDO_FILE.name)
    document = json.loads(documented_file.read_text(encoding='utf-8')) if documented_file.is_file() else {}
    documented = documented_counts(document)
    found, hard = collect(root, json.loads(layers_file.read_text(encoding='utf-8')))
    baseline = json.loads(baseline_file.read_text(encoding='utf-8')).get('R7', {}) if baseline_file.is_file() else {}
    sites, problems = site_lines(root, found, hard)
    problems += undocumented_sites(sites, allowances(baseline, documented))
    problems += reason_problems(document.get('cases', {}))
    problems += documented_problems(documented, found, root)
    try:
        if args.base:
            problems += documented_growth(args.base, root, documented_file)
    except UnknownRef as error:
        sys.stderr.write(f'{error}\n')
        return 2
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
