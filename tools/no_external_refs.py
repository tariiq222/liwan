# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Customer-hosted deployments may have no internet: the web app must not load
anything from a third-party host at runtime (spec §2.1)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOTS = ('apps/web/app', 'apps/web/public', 'apps/web/nuxt.config.ts', 'apps/web/server',
         'packages/ui/app', 'packages/ui/public', 'packages/ui/nuxt.config.ts',
         'packages/commercial-ui/app', 'packages/commercial-ui/nuxt.config.ts',
         'apps/vendor-admin/app', 'apps/vendor-admin/public', 'apps/vendor-admin/nuxt.config.ts', 'apps/vendor-admin/server')
SUFFIXES = ('.vue', '.ts', '.js', '.mjs', '.css', '.scss', '.html')
URL_RE = re.compile(r'(?:https?:)?//([a-z0-9.-]+\.[a-z]{2,})', re.IGNORECASE)
# Existing fixture, local-base, and documentation references are intentional.
# debt: packages/ui/app/utils/sanitize.ts
# debt: apps/web/app/components/charts/utils.ts
ALLOWED_HOSTS = frozenset({
    'custom.example',
    'evil.com',
    'evil.example',
    'evil.test',
    'example.com',
    'example.invalid',
    'example.test',
    'html.spec.whatwg.org',
    'localhost',
    'meet.example',
    'meet.example.test',
    'liwan.local',
    'series.example',
    'unovis.dev',
    'www.openstreetmap.org',
    'www.w3.org',
    'x.test',
})


# RFC 2606/6761 reserve these TLDs/domains for documentation and testing; any
# host under them is a fixture by construction, never a runtime third party.
RESERVED_TEST_SUFFIXES = (
    '.example', '.example.com', '.example.net', '.example.org',
    '.example.test', '.example.invalid', '.test', '.invalid', '.localhost',
)


def find_external_refs(path: str, text: str) -> list[tuple[str, int]]:
    hits = []
    for number, line in enumerate(text.splitlines(), start=1):
        hosts = {h.lower().rstrip('.') for h in URL_RE.findall(line)}
        unknown = hosts - ALLOWED_HOSTS
        unknown = {h for h in unknown if not h.endswith(RESERVED_TEST_SUFFIXES)}
        if unknown:
            hits.append((path, number))
    return hits


def main() -> int:
    problems = []
    for root in ROOTS:
        base = Path(root)
        files = [base] if base.is_file() else [p for p in base.rglob('*') if p.suffix in SUFFIXES]
        for file in files:
            text = file.read_text(encoding='utf-8', errors='replace')
            problems += find_external_refs(str(file), text)
    for path, number in problems:
        print(f'external runtime reference: {path}:{number}', file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
