# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Measured architecture facts: the one command an audit quotes its counts from.

Ad-hoc greps used to report different numbers for the same tree (128 or 145 sudo sites, 101 or
48 direct-SQL sites). This command reads the inputs `tools/arch_policy.py` already enforces and
prints the figure each one holds, next to the name of the file it comes from:

- R7 sudo sites and files from `arch_policy.collect()` (per addon, and by documented kind);
- R3 bridge models and bridge size, and R9 direct SQL and access overrides, each with its
  `sub_entries` so a count of one kind never sums into another;
- the total and file count of every other rule recorded in the baseline;
- the addon count at each rank of `tools/arch_layers.json`.

`build_facts` is the pure part: it takes the loaded documents and returns the facts dict, while
`main` only reads the files and renders it.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from arch_policy import (
    BASELINE_FILE,
    DOCUMENTED_SUDO_FILE,
    LAYERS_FILE,
    ROOT,
    collect,
    documented_counts,
)

# A repository path inside a baseline key: R10 keys append `:<route>`, R3 bridge keys prefix a kind word.
REPO_PATH = re.compile(r'(?:apps|deploy|docs|e2e|odoo-addons|packages|tools)/[^\s:,()]+')


def load_json(path: Path) -> dict:
    """The JSON document at PATH, or an empty object when the file is absent (as `arch_policy` reads its files)."""
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}


def addon_of(rel: str) -> str | None:
    """The addon of an `odoo-addons/<addon>/...` path; None for a file outside `odoo-addons`."""
    parts = rel.split('/')
    return parts[1] if len(parts) > 2 and parts[0] == 'odoo-addons' else None


def per_addon_sites(counts: dict[str, int]) -> list[dict]:
    """R7: the sudo sites of each addon, the biggest first."""
    totals: dict[str, int] = {}
    for rel, sites in counts.items():
        addon = addon_of(rel)
        if addon:
            totals[addon] = totals.get(addon, 0) + sites
    return [
        {'addon': addon, 'sites': sites}
        for addon, sites in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    ]


def kind_sites(cases: dict) -> list[dict]:
    """The documented sudo cases grouped by their `kind`, the biggest first; empty when no case carries one."""
    totals: dict[str, int] = {}
    for case in cases.values():
        kind = case.get('kind') if isinstance(case, dict) else None
        if isinstance(kind, str):
            totals[kind] = totals.get(kind, 0) + case['count']
    return [
        {'kind': kind, 'sites': sites}
        for kind, sites in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    ]


def sudo_facts(counts: dict[str, int], documented: dict) -> dict:
    """R7: every sudo site `collect()` found, plus the documented registry that covers them."""
    document = documented_counts(documented)
    facts = {
        'source': 'collect()',
        'sites': sum(counts.values()),
        'files': len(counts),
        'per_addon': per_addon_sites(counts),
        'documented': {'source': DOCUMENTED_SUDO_FILE.name, 'sites': sum(document.values()), 'files': len(document)},
    }
    kinds = kind_sites(documented.get('cases', {}))
    if kinds:
        facts['kinds'] = {'source': DOCUMENTED_SUDO_FILE.name, 'totals': kinds}
    return facts


def baseline_paths(entries: dict[str, int]) -> set[str]:
    """The repository paths the keys of one baseline rule name; R1, R4 and R10 messages may name none."""
    paths = set()
    for key in entries:
        match = REPO_PATH.search(key)
        if match:
            paths.add(match.group(0))
    return paths


def sub_entries(entries: dict[str, int]) -> list[dict]:
    """A baseline rule grouped by the first word of its keys, which is the sub-entry the rule records.

    R9 holds `sql <path>` and `override <path>`; R3 holds `bridge-model <addon>` and `bridge-size <addon>`.
    Nothing is assumed: a key with no kind word is grouped under `total`.
    """
    groups: dict[str, dict[str, int]] = {}
    for key, count in entries.items():
        kind, _, path = key.partition(' ')
        if not path:
            kind, path = 'total', key
        groups.setdefault(kind, {})[path] = count
    return [
        {'kind': kind, 'entries': sum(paths.values()), 'files': len(paths)}
        for kind, paths in sorted(groups.items())
    ]


def sub_entry_facts(entries: dict[str, int]) -> dict:
    """A baselined rule grouped by its sub-entries (R3 bridges, R9 SQL and overrides), never summed across kinds."""
    return {
        'source': BASELINE_FILE.name,
        'entries': sum(entries.values()),
        'files': len(baseline_paths(entries)),
        'sub_entries': sub_entries(entries),
    }


def rule_facts(rule: str, entries: dict[str, int]) -> dict:
    """One baselined rule: its total and the number of repository paths it names."""
    return {
        'rule': rule,
        'source': BASELINE_FILE.name,
        'entries': sum(entries.values()),
        'files': len(baseline_paths(entries)),
    }


def rank_facts(ranks: dict[str, int]) -> list[dict]:
    """The addons of each rank, lowest rank first."""
    totals: dict[int, int] = {}
    for rank in ranks.values():
        totals[rank] = totals.get(rank, 0) + 1
    return [{'rank': rank, 'addons': addons} for rank, addons in sorted(totals.items())]


def build_facts(violations: dict, documented: dict, baseline: dict, ranks: dict[str, int]) -> dict:
    """The facts dict from loaded inputs: the `collect()` violations, documented cases, baseline and ranks."""
    return {
        'sudo': sudo_facts(violations.get('R7', {}), documented),
        'r3': sub_entry_facts(baseline.get('R3', {})),
        'r9': sub_entry_facts(baseline.get('R9', {})),
        'baseline_rules': [
            rule_facts(rule, entries) for rule, entries in sorted(baseline.items()) if rule not in ('R3', 'R9')
        ],
        'ranks': rank_facts(ranks),
    }


def render_sudo(sudo: dict) -> list[str]:
    rows = [
        f"sudo (R7) [{sudo['source']}]: sites {sudo['sites']}, files {sudo['files']}",
        f"  per addon [{sudo['source']}]:",
    ]
    rows += [f"    {entry['addon']} {entry['sites']}" for entry in sudo['per_addon']]
    rows.append(
        f"  documented [{sudo['documented']['source']}]: sites {sudo['documented']['sites']}, "
        f"files {sudo['documented']['files']}",
    )
    if 'kinds' in sudo:
        rows.append(f"  by kind [{sudo['kinds']['source']}]:")
        rows += [f"    {entry['kind']} {entry['sites']}" for entry in sudo['kinds']['totals']]
    return rows


def render_sub_entries(title: str, rule: dict) -> list[str]:
    """One baselined rule with its sub-entry breakdown, each figure next to its source file."""
    return [
        f"{title} [{rule['source']}]: entries {rule['entries']}, files {rule['files']}",
        *[f"  {sub['kind']}: entries {sub['entries']}, files {sub['files']}" for sub in rule['sub_entries']],
    ]


def render(facts: dict) -> str:
    """The compact text table of FACTS, each figure next to its source file."""
    lines = ['architecture facts (measured inputs only)', '', *render_sudo(facts['sudo'])]
    lines += ['', *render_sub_entries('R3 bridge models and bridge size', facts['r3'])]
    lines += ['', *render_sub_entries('R9 direct SQL and overrides', facts['r9'])]
    lines += ['', f"baseline rules [{BASELINE_FILE.name}]"]
    lines += [
        f"  {rule['rule']:<4} entries {rule['entries']}, files {rule['files']}" for rule in facts['baseline_rules']
    ]
    lines += ['', f"addon ranks [{LAYERS_FILE.name}]"]
    lines += [f"  rank {rank['rank']}: addons {rank['addons']}" for rank in facts['ranks']]
    return '\n'.join(lines)


def main(
    argv: list[str] | None = None,
    root: Path = ROOT,
    layers_file: Path = LAYERS_FILE,
    baseline_file: Path = BASELINE_FILE,
    documented_file: Path | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='print the same facts as JSON')
    args = parser.parse_args(argv)
    documented_file = documented_file or baseline_file.with_name(DOCUMENTED_SUDO_FILE.name)
    layers = load_json(layers_file)
    violations, _ = collect(root, layers)
    facts = build_facts(violations, load_json(documented_file), load_json(baseline_file), layers['ranks'])
    print(json.dumps(facts, indent=2) if args.json else render(facts))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
