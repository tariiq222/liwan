# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Select the newest release in the current product's upgrade lineage."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION_MANIFEST = 'odoo-addons/liwan_core/__manifest__.py'


def git(*arguments):
    return subprocess.run(['git', *arguments], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def compatible_release():
    for tag in git('tag', '--list', 'release/*', '--sort=-v:refname').splitlines():
        if git('ls-tree', '-r', '--name-only', tag, '--', FOUNDATION_MANIFEST) == FOUNDATION_MANIFEST:
            return tag
    return ''


if __name__ == '__main__':
    print(compatible_release())
