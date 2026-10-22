"""Exercise the actual aggregate workflow command with GitHub-shaped job results."""
from __future__ import annotations

import json
import os
import subprocess
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class CiResultTest(unittest.TestCase):
    def gate(self, selected, results=None, scope='success'):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        step = workflow.split('- name: Require every selected stage to pass\n', 1)[1]
        block = step.split('        run: |\n', 1)[1]
        lines = []
        for line in block.splitlines():
            if line and not line.startswith('          '):
                break
            lines.append(line)
        command = textwrap.dedent('\n'.join(lines))
        needs = {
            'scope': {'result': scope, 'outputs': {'stages': json.dumps(selected)}},
            'static': {'result': 'success', 'outputs': {}},
            'e2e-mock': {'result': 'skipped', 'outputs': {}},
        }
        for name, result in (results or {}).items():
            needs[name] = {'result': result, 'outputs': {}}
        return subprocess.run(
            ['bash', '-e', '-o', 'pipefail', '-c', command], cwd=ROOT,
            env={**os.environ, 'NEEDS': json.dumps(needs)}, capture_output=True, text=True, check=False)

    def test_unselected_stage_can_be_skipped(self):
        self.assertEqual(self.gate(['static']).returncode, 0)

    def test_selected_stage_must_not_be_skipped(self):
        self.assertNotEqual(self.gate(['static', 'e2e-mock']).returncode, 0)

    def test_selected_success_passes(self):
        self.assertEqual(self.gate(['static', 'e2e-mock'], {'e2e-mock': 'success'}).returncode, 0)

    def test_failure_or_cancellation_never_passes(self):
        for status in ('failure', 'cancelled'):
            with self.subTest(status=status):
                self.assertNotEqual(self.gate(['static', 'e2e-mock'], {'e2e-mock': status}).returncode, 0)

    def test_selected_missing_job_fails(self):
        self.assertNotEqual(self.gate(['static', 'missing-job']).returncode, 0)

    def test_scope_failure_fails(self):
        self.assertNotEqual(self.gate(['static'], scope='failure').returncode, 0)

    def test_static_failure_fails(self):
        self.assertNotEqual(self.gate(['static'], {'static': 'failure'}).returncode, 0)

    def test_selection_cannot_omit_static(self):
        self.assertNotEqual(self.gate([]).returncode, 0)

    def test_selection_must_be_an_array(self):
        self.assertNotEqual(self.gate('static').returncode, 0)

    def test_unexpected_running_stage_failure_is_not_ignored(self):
        self.assertNotEqual(self.gate(['static'], {'e2e-mock': 'failure'}).returncode, 0)


if __name__ == '__main__':
    unittest.main()
