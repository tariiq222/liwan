# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib
import pkgutil
import sys


def import_all_tests(package_name):
    """Import every ``test_*`` module of a tests package, so no test file can be left out.

    Call it as ``import_all_tests(__name__)`` from an addon's ``tests/__init__.py``. Odoo
    collects an addon's tests from the ``test_*`` module attributes of its tests package,
    and importing a submodule binds it there. Support modules (``common``) are imported by
    the tests that use them.
    """
    package = sys.modules[package_name]
    for module in sorted(pkgutil.iter_modules(package.__path__), key=lambda info: info.name):
        if module.name.startswith('test_'):
            importlib.import_module(f'{package_name}.{module.name}')
