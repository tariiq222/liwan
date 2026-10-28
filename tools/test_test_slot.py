# Part of Odoo. See LICENSE file for full copyright and licensing details.
import io
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import test_slot

SCRIPT = Path(__file__).resolve().parent / 'test_slot.py'


class TestSlotTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        env = {'WEBVUE_TEST_SLOT_DIR': str(self.dir), 'WEBVUE_TEST_SLOTS': '2'}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop(test_slot.HELD_ENV, None)
        self._held = []

    def hold_in_child(self, seconds):
        command = [sys.executable, '-B', str(SCRIPT), '--', 'sleep', str(seconds)]
        child = subprocess.Popen(command, env={**os.environ})
        self.addCleanup(child.wait)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if len(test_slot.holders(self.dir, 2)) > len(self._held):
                self._held.append(child)
                return child
            time.sleep(0.05)
        message = 'child never took a slot'
        raise AssertionError(message)

    def test_queues_when_all_slots_are_held(self):
        self.hold_in_child(1)
        self.hold_in_child(1)
        self.assertIsNone(test_slot.try_slot(self.dir, 2, 'third'))
        started = time.monotonic()
        index, handle = test_slot.acquire(self.dir, 2, 'third', out=io.StringIO())
        handle.close()
        self.assertGreater(time.monotonic() - started, 0.3)
        self.assertIn(index, (0, 1))

    def test_hold_is_reentrant_and_exports_the_slot(self):
        with test_slot.hold('outer'):
            held = os.environ[test_slot.HELD_ENV]
            with test_slot.hold('inner'):
                self.assertEqual(len(test_slot.holders(self.dir, 2)), 1)
            self.assertEqual(os.environ[test_slot.HELD_ENV], held)
        self.assertNotIn(test_slot.HELD_ENV, os.environ)
        self.assertEqual(test_slot.holders(self.dir, 2), [])

    def test_crashed_holder_frees_its_slot(self):
        child = self.hold_in_child(30)
        child.kill()
        child.wait()
        self.assertEqual(test_slot.holders(self.dir, 2), [])

    def test_command_exit_code_is_returned(self):
        self.assertEqual(test_slot.main(['--', sys.executable, '-c', 'raise SystemExit(3)']), 3)

    def test_rejects_a_bad_slot_count(self):
        with mock.patch.dict(os.environ, {'WEBVUE_TEST_SLOTS': '0'}), self.assertRaises(SystemExit):
            test_slot.slot_count()


if __name__ == '__main__':
    unittest.main()
