# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The main-alert job and script: when it runs and which issue calls it makes for each ci-result."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'deploy/ci/main-alert.sh'
RUN_URL = 'https://github.com/o/r/actions/runs/77'


class WorkflowWiringTest(unittest.TestCase):
    workflow = (ROOT / '.github/workflows/ci.yml').read_text()

    def job(self, name):
        return re.search(rf'(?ms)^  {re.escape(name)}:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|\Z)', self.workflow).group(1)

    def test_runs_after_ci_result_on_main_pushes_and_the_nightly_run_only(self):
        job = self.job('main-alert')
        self.assertIn('needs: ci-result\n', job)
        self.assertIn("if: always() && (github.event_name == 'schedule' || "
                      "(github.event_name == 'push' && github.ref == 'refs/heads/main'))", job)
        for event in ('pull_request', 'merge_group', 'workflow_dispatch'):
            self.assertNotIn(event, job)

    def test_has_only_the_permissions_the_script_needs(self):
        permissions = re.search(r'(?m)^    permissions:\n((?:      [a-z]+: [a-z]+\n)+)', self.job('main-alert')).group(1)
        self.assertEqual(permissions.split(), ['contents:', 'read', 'actions:', 'read', 'issues:', 'write'])

    def test_passes_the_token_and_the_ci_result_to_the_script(self):
        job = self.job('main-alert')
        self.assertIn('- run: deploy/ci/main-alert.sh\n', job)
        self.assertIn('GH_TOKEN: ${{ github.token }}', job)
        self.assertIn('CI_RESULT: ${{ needs.ci-result.result }}', job)

    def test_the_aggregate_does_not_depend_on_the_alert(self):
        ci_result = self.job('ci-result')
        self.assertNotIn('main-alert', ci_result)
        needs = re.search(r'(?m)^    needs: \[(.*)\]$', ci_result).group(1)
        self.assertNotIn('main-alert', needs)


class ScriptTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.calls = self.root / 'calls.jsonl'
        self.calls.touch()
        gh = self.root / 'gh'
        gh.write_text(f'#!{sys.executable}\nimport json, os, sys\n'
                      f'args = sys.argv[1:]\nopen({str(self.calls)!r}, "a").write(json.dumps(args) + "\\n")\n'
                      'if os.environ.get("GH_FAIL") == " ".join(args[:2]): sys.exit(1)\n'
                      'if args[:2] == ["issue", "list"]: print(os.environ.get("OPEN_ISSUE", ""))\n'
                      'if args[:2] == ["run", "view"]: print("odoo (shard 3), e2e-mock (shard 1)")\n')
        gh.chmod(0o755)

    def run_script(self, result, open_issue='', **extra):
        env = {**os.environ, 'PATH': f'{self.root}{os.pathsep}{os.environ["PATH"]}', 'GH_TOKEN': 'x',
               'GITHUB_REPOSITORY': 'o/r', 'GITHUB_RUN_ID': '77', 'GITHUB_SERVER_URL': 'https://github.com',
               'CI_RESULT': result, 'OPEN_ISSUE': open_issue, **extra}
        process = subprocess.run(['bash', str(SCRIPT)], env=env, capture_output=True, text=True, check=False)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        return process, calls

    @staticmethod
    def verbs(calls):
        return [' '.join(call[:2]) for call in calls]

    def test_red_run_without_an_open_issue_creates_the_label_and_the_issue(self):
        process, calls = self.run_script('failure')
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(self.verbs(calls), ['run view', 'issue list', 'label create', 'issue create'])
        label = next(call for call in calls if call[:2] == ['label', 'create'])
        self.assertIn('--force', label)
        create = next(call for call in calls if call[:2] == ['issue', 'create'])
        self.assertEqual(create[create.index('--title') + 1], 'CI is red on main')
        self.assertEqual(create[create.index('--label') + 1], 'ci-red')
        body = create[create.index('--body') + 1]
        self.assertIn(RUN_URL, body)
        self.assertIn('odoo (shard 3), e2e-mock (shard 1)', body)

    def test_red_run_with_an_open_issue_only_comments(self):
        process, calls = self.run_script('failure', open_issue='41')
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(self.verbs(calls), ['run view', 'issue list', 'issue comment'])
        comment = calls[-1]
        self.assertEqual(comment[2], '41')
        self.assertIn(RUN_URL, comment[comment.index('--body') + 1])

    def test_green_run_comments_and_closes_the_open_issue(self):
        process, calls = self.run_script('success', open_issue='41')
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(self.verbs(calls), ['issue list', 'issue comment', 'issue close'])
        self.assertIn(RUN_URL, calls[1][calls[1].index('--body') + 1])
        self.assertEqual(calls[2][2], '41')

    def test_green_run_without_an_open_issue_changes_nothing(self):
        process, calls = self.run_script('success')
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(self.verbs(calls), ['issue list'])

    def test_any_other_result_makes_no_call(self):
        for result in ('cancelled', 'skipped'):
            with self.subTest(result=result):
                process, calls = self.run_script(result)
                self.assertEqual((process.returncode, calls), (0, []))

    def test_a_failing_issue_call_fails_the_script(self):
        process, _ = self.run_script('failure', GH_FAIL='issue create')
        self.assertNotEqual(process.returncode, 0)

    def test_missing_input_is_refused(self):
        process, _ = self.run_script('failure', GH_TOKEN='')
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(self.calls.read_text(), '')


if __name__ == '__main__':
    unittest.main()
