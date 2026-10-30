# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Exhaustive customer Vue inventory and post-migration legacy-consumer gate.

Specialist chart adapters are inventoried separately from the retired
components/ui tree. This is a source gate, not a visual/behavior acceptance
claim.
"""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'apps/web/app'
LAYER = ROOT / 'packages/ui/app'
SOURCES = (APP, LAYER)
UI = APP / 'components/ui'
CHARTS = APP / 'components/charts'
CHART_OWNER = 'apps/web/app/components/shared/data/DashboardChart.client.vue'
WRAPPERS = re.compile(r'\bliwan-(?:panel(?:-header|-body)?|metrics|metric(?:-title|-value|-foot)?|form-section-heading|settings-section-heading|project-toolbar|tabs|view-switch|settings-nav)\b')
COMMENT = re.compile(r'<!--[\s\S]*?-->|/\*[\s\S]*?\*/|^\s*//[^\n]*', re.M)


def inventory():
    names = {p.stem for p in UI.rglob('*.vue')}
    for p in UI.rglob('index.ts'):
        names.update(re.findall(r'default\s+as\s+(\w+)', p.read_text()))
    rows = []
    for p in sorted(vue for root in SOURCES for vue in root.rglob('*.vue')):
        if '__tests__' in p.parts:
            continue
        source = COMMENT.sub('', p.read_text())
        path = p.relative_to(ROOT).as_posix()
        retired = p.is_relative_to(UI)
        specialist = p.is_relative_to(CHARTS)
        template = re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', source)
        tags = set(re.findall(r'<([A-Z][\w]*)\b', template))
        legacy = sorted(tags & names)
        imports = re.findall(r'''(?:from\s*|import\s*)['"]([^'"]*(?:components/ui|vue-sonner)[^'"]*)['"]''', source)
        # Unovis chart container/tooltip adapters are specialist renderers, not
        # another button/card/control system. They inherit the shared tokens.
        if path == CHART_OWNER:
            legacy = [t for t in legacy if not t.startswith('Chart')]
            imports = [s for s in imports if not s.endswith('components/charts')]
        rows.append({
            'path': path,
            'kind': 'specialist-adapter' if specialist else 'retired-component' if retired else 'route' if p.is_relative_to(APP / 'pages') else 'component' if p.is_relative_to(APP / 'components') or p.is_relative_to(LAYER / 'components') else 'app-layout',
            'retired_component_tree': retired,
            'legacy_components': legacy if not retired else [],
            'legacy_imports': imports if not retired else [],
            'legacy_wrappers': sorted(set(WRAPPERS.findall(source))) if not retired else [],
            'native_controls': sorted(set(re.findall(r'<(button|input|select|textarea|table)\b', template))),
        })
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    rows = inventory()
    failures = [r for r in rows if r['retired_component_tree'] or r['legacy_components'] or r['legacy_imports'] or r['legacy_wrappers']]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for kind in ['route', 'component', 'specialist-adapter', 'retired-component', 'app-layout']:
            print(f'{kind}: {sum(r["kind"] == kind for r in rows)}')
        for r in failures:
            print(r['path'], r['legacy_components'], r['legacy_imports'], r['legacy_wrappers'])
        print(f'Legacy consumer files: {len(failures)}; every Vue source enumerated. Native controls need semantic review.')
    return 1 if args.check and failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
