# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Every odoo-addons/*/tests/test_*.py must be collected by its addon's tests package.

Odoo runs only the ``test_*`` modules bound on the tests package, so a file the package
does not import silently never runs. ``tests/__init__.py`` either imports each file by
name or calls ``import_all_tests(__name__)`` (webvue_core.testing), which imports them all.
"""
import ast
import unittest
from pathlib import Path

ADDONS = Path(__file__).resolve().parent.parent / 'odoo-addons'
HELPER = 'import_all_tests'
# Addons whose tests/__init__.py may import each file by name: base_tier_validation is vendored
# OCA code and stays the single documented exception.
EXPLICIT_IMPORTS_ALLOWED = frozenset({'base_tier_validation'})


def collects_everything(init_source: str) -> bool:
    """``tests/__init__.py`` calls ``import_all_tests(__name__)``."""
    return any(
        isinstance(node, ast.Call) and getattr(node.func, 'id', None) == HELPER
        and [getattr(arg, 'id', None) for arg in node.args] == ['__name__']
        for node in ast.walk(ast.parse(init_source))
    )


def imported_names(init_source: str) -> set[str]:
    return {alias.name for node in ast.walk(ast.parse(init_source))
            if isinstance(node, ast.ImportFrom) for alias in node.names}


def uncollected(init_source: str, test_files: list[str]) -> list[str]:
    if collects_everything(init_source):
        return []
    imported = imported_names(init_source)
    return sorted(name for name in test_files if name not in imported)


class AddonTestImportTests(unittest.TestCase):
    def test_explicit_imports_must_name_every_test_file(self):
        source = 'from . import common, test_a\n'
        self.assertEqual(uncollected(source, ['test_a', 'test_b']), ['test_b'])

    def test_the_helper_collects_everything(self):
        source = 'from odoo.addons.webvue_core.testing import import_all_tests\n\nimport_all_tests(__name__)\n'
        self.assertEqual(uncollected(source, ['test_a', 'test_b']), [])

    def test_the_helper_must_receive_the_package_name(self):
        source = "from odoo.addons.webvue_core.testing import import_all_tests\n\nimport_all_tests('other')\n"
        self.assertEqual(uncollected(source, ['test_a']), ['test_a'])

    def test_every_addon_collects_all_its_test_files(self):
        problems = []
        for tests in sorted(ADDONS.glob('*/tests')):
            files = sorted(p.stem for p in tests.glob('test_*.py'))
            init = tests / '__init__.py'
            if not init.is_file():
                problems.append(f'{tests.relative_to(ADDONS)}: no __init__.py')
                continue
            problems.extend(f'{tests.relative_to(ADDONS)}/{name}.py is not imported by __init__.py'
                            for name in uncollected(init.read_text(encoding='utf-8'), files))
        self.assertEqual(problems, [])

    def test_converted_addons_use_the_helper(self):
        stale = [
            f'{init.parent.parent.name}: tests/__init__.py must call import_all_tests(__name__)'
            for init in sorted(ADDONS.glob('*/tests/__init__.py'))
            if init.parent.parent.name not in EXPLICIT_IMPORTS_ALLOWED
            and not collects_everything(init.read_text(encoding='utf-8'))
        ]
        self.assertEqual(stale, [])


if __name__ == '__main__':
    unittest.main()
