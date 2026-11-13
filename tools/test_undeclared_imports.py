"""The undeclared-import gate: specifier reduction, import forms and the declared-set rule."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import undeclared_imports as gate


class PackageNameTest(unittest.TestCase):
    def test_reduces_to_package_name(self):
        self.assertEqual(gate.package_name('@nuxt/ui/runtime/x'), '@nuxt/ui')
        self.assertEqual(gate.package_name('ufo/sub'), 'ufo')
        self.assertEqual(gate.package_name('vue'), 'vue')

    def test_non_packages_are_ignored(self):
        for specifier in ('./a', '../a', '/abs', '~/a', '~~/a', '@/a', '@@/a', '#imports', '#app', 'virtual:x',
                          'node:fs', 'fs', 'path'):
            self.assertIsNone(gate.package_name(specifier), specifier)


class ImportsOfTest(unittest.TestCase):
    def test_every_import_form(self):
        text = "\n".join([
            "import a from 'one'",
            "import type { B } from '@s/two'",
            "export { c } from 'three'",
            "import 'four'",
            "const d = await import('five')",
            "const e = require('six')",
            "import f from './local'",
        ])
        self.assertEqual(list(gate.imports_of(text)),
                         [(1, 'one'), (2, '@s/two'), (3, 'three'), (4, 'four'), (5, 'five'), (6, 'six')])


class ProblemsTest(unittest.TestCase):
    def test_reports_only_undeclared_packages(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / 'packages' / 'demo'
            (workspace / 'src').mkdir(parents=True)
            (workspace / 'node_modules' / 'x').mkdir(parents=True)
            (workspace / 'package.json').write_text(json.dumps(
                {'name': '@liwan/demo', 'dependencies': {'vue': '1'}, 'devDependencies': {'vitest': '1'}}))
            (workspace / 'src' / 'a.ts').write_text(
                "import { ref } from 'vue'\nimport { it } from 'vitest'\nimport x from '@liwan/demo/src/b'\nimport u from 'ufo'\n")
            (workspace / 'node_modules' / 'x' / 'a.js').write_text("import z from 'ignored'\n")
            with mock.patch.object(gate, 'REPO', root):
                self.assertEqual(gate.problems(),
                                 ['packages/demo/src/a.ts:4: ufo is not declared in packages/demo/package.json'])


if __name__ == '__main__':
    unittest.main()
