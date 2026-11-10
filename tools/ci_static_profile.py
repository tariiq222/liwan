"""Select the cheaper static check only for a proven documentation-only PR diff."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys

# The UI policy reads the design system, and API artifacts have their own gate.
FULL_DOC_TREES = (b'docs/api/', b'docs/design-system/')
# Root instruction documents: no build, test or tool reads them as input, and the light profile's
# tools/docs_policy.py checks the ones it lists as fully as the full profile does.
ROOT_DOCS = (b'AGENTS.md', b'CLAUDE.md', b'DESIGN.md', b'README.md', b'REVIEW.md')
MAX_DOC_BYTES = 1024 * 1024
BINARY_CONTROL = re.compile(rb'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def git(*args: str) -> bytes:
    return subprocess.check_output(['git', *args], stderr=subprocess.PIPE)


def is_prose_path(path: bytes) -> bool:
    if path in ROOT_DOCS:
        return True
    return path.startswith(b'docs/') and path.endswith(b'.md') and not path.startswith(FULL_DOC_TREES)


def is_prose_blob(object_id: bytes) -> bool:
    oid = object_id.decode('ascii')
    if int(git('cat-file', '-s', oid)) > MAX_DOC_BYTES:
        return False
    content = git('cat-file', 'blob', oid)
    content.decode('utf-8')  # A decode failure makes the caller use the full profile.
    return BINARY_CONTROL.search(content) is None


def static_profile(base: str) -> str:
    try:
        ancestor = git('merge-base', base, 'HEAD').decode('ascii').strip()
        diff = ('diff', '--no-renames', '--no-ext-diff', '--no-textconv',
                '--ignore-submodules=none', '--no-abbrev', '-z')
        raw = git(*diff, '--raw', ancestor, 'HEAD', '--').split(b'\0')[:-1]
        if not raw or len(raw) % 2:
            return 'full'
        objects = set()
        for header, path in zip(raw[::2], raw[1::2]):
            old_mode, new_mode, old_oid, new_oid, status = header.split()
            if (not is_prose_path(path) or new_mode != b'100644'
                    or (old_mode, status) not in ((b':000000', b'A'), (b':100644', b'M'))):
                return 'full'

            objects.add(new_oid)
            if status == b'M':
                objects.add(old_oid)

        if not all(is_prose_blob(oid) for oid in objects):
            return 'full'
    except (OSError, subprocess.CalledProcessError, ValueError):
        print('Cannot verify the documentation-only diff; using full static checks.', file=sys.stderr)
        return 'full'
    return 'docs'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    print(static_profile(parser.parse_args().base))
