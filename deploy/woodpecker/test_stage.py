# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Run stage scripts with real shells and fake external programs."""
import json
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

HELPER = Path(__file__).with_name('stage.sh')


class StageReceiptTest(unittest.TestCase):
    def test_receipts_distinguish_success_failure_and_explicit_no_baseline(self):
        for command, name, code, result in (('true', 'static', 0, 'checked'),
                                           ('false', 'image', 1, 'checked'),
                                           ('CI_STAGE_RESULT=no_baseline; exit 0', 'upgrade', 0, 'no_baseline')):
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'stages').mkdir()
                (root / 'environment.sh').write_text('export WEBVUE_CI_RUN_ID=test-run WEBVUE_CI_COMMIT=abc\n')
                process = subprocess.run(['bash', '-c', 'set -euo pipefail; source ' + shlex.quote(str(HELPER))
                                          + ' ' + name + '; ' + command],
                                         env={**os.environ, 'WEBVUE_CI_RUN_DIR': directory}, capture_output=True, text=True, check=False)
                self.assertEqual(process.returncode, code, process.stderr)
                receipt = json.loads((root / 'stages' / (name + '.json')).read_text())
                self.assertEqual(receipt, {'name': name, 'exit_code': code, 'run_id': 'test-run',
                                           'commit': 'abc', 'result': result})

    def test_missing_runner_environment_fails_before_stage_body(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'should-not-exist'
            process = subprocess.run(['bash', '-c', 'set -euo pipefail; source ' + shlex.quote(str(HELPER))
                                      + ' static; touch ' + shlex.quote(str(marker))],
                                     env={**os.environ, 'WEBVUE_CI_RUN_DIR': directory}, capture_output=True, check=False)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
