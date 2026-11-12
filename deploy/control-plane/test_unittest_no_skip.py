#!/usr/bin/env python3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from unittest_no_skip import run

BODIES = {
    'passing': 'def test_a(self): pass',
    'skipping': 'def test_a(self): self.skipTest("no database")',
    'failing': 'def test_a(self): self.fail("x")',
    'empty': '',
}


class UnittestNoSkipTests(unittest.TestCase):
    def outcome(self, kind: str) -> int:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        module = f'gate_fixture_{kind}'
        body = BODIES[kind] or 'x = 1'
        (Path(temp.name) / f'{module}.py').write_text(f'import unittest\nclass T(unittest.TestCase):\n    {body}\n')
        sys.path.insert(0, temp.name)
        self.addCleanup(sys.path.remove, temp.name)
        self.addCleanup(sys.modules.pop, module, None)
        return run([module])

    def test_passing_module_is_clean(self):
        self.assertEqual(self.outcome('passing'), 0)

    def test_skip_failure_and_zero_tests_fail(self):
        for kind in ('skipping', 'failing', 'empty'):
            with self.subTest(kind=kind):
                self.assertEqual(self.outcome(kind), 1)


if __name__ == '__main__':
    unittest.main()
