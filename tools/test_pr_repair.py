import json
import subprocess
import unittest
from unittest.mock import patch

import pr_repair


class RepairBoundaryTest(unittest.TestCase):
    def test_model_has_no_tools_hooks_settings_or_write_credentials_in_prompt(self):
        report = {'head_sha': 'a' * 40, 'summary': 'Fix', 'edits': []}
        done = subprocess.CompletedProcess([], 0, json.dumps({'is_error': False, 'structured_output': report}), '')
        with patch.object(pr_repair.subprocess, 'run', return_value=done) as execute:
            self.assertEqual(pr_repair.model_report('untrusted diff', {'type': 'object'}), report)
        args = execute.call_args.args[0]
        self.assertEqual(args[0], 'claude')
        self.assertEqual(args[args.index('--tools') + 1], '')
        self.assertEqual(args[args.index('--setting-sources') + 1], '')
        self.assertEqual(json.loads(args[args.index('--settings') + 1]), {'disableAllHooks': True})
        self.assertEqual(execute.call_args.kwargs['input'], 'untrusted diff')
        self.assertNotIn('untrusted diff', args)

    def test_auth_error_is_not_a_valid_repair_and_secret_text_is_not_echoed(self):
        done = subprocess.CompletedProcess([], 1, json.dumps({'is_error': True, 'result': '401 OAuth token invalid'}), '')
        with patch.object(pr_repair.subprocess, 'run', return_value=done):
            with self.assertRaisesRegex(RuntimeError, 'authentication'):
                pr_repair.model_report('data', {})


if __name__ == '__main__':
    unittest.main()
