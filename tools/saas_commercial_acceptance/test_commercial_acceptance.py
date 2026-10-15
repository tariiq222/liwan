# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Unit tests (no Docker, no Playwright): case results come only from evidence JSON."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools.saas_commercial_acceptance import commercial_acceptance as A
from tools.saas_commercial_acceptance import commercial_lifecycle as L

RUN = 'unit-run'


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.here = Path(tmp.name)
        self.doc = self.here / 'doc.md'
        self.doc.write_text('| ID | a | b | Result | Linked | Reason |\n' + ''.join(f'| {c} | x | y | OLD | | old |\n' for c in A.CASES))
        for target, value in (('HERE', self.here), ('DOC', self.doc),
                              ('build_info', lambda: {'git_sha': 'abc', 'git_dirty': False, 'images': {}}),
                              ('guard', lambda: {})):
            patcher = mock.patch.object(A, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        quiet = mock.patch.object(A, 'print', create=True)
        quiet.start()
        self.addCleanup(quiet.stop)

    def evidence(self, case, result='PASS', at='2999-01-01T00:00:00+00:00', run_id=RUN):
        path = self.here / '.evidence' / RUN / f'{case}.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'case': case, 'run_id': run_id, 'result': result, 'reason': 'r', 'at': at}))

    def spec(self, code, writes=()):
        def fake(run_id, spec, grep):
            for case in writes:
                A.write_case(run_id, case, 'PASS', 'spec evidence')
            return code, ['npx', 'playwright']
        return mock.patch.object(A, 'playwright', side_effect=fake)


class LoadCaseTests(Base):
    def test_rejects_missing_foreign_and_stale(self):
        self.assertIsNone(A.load_case(RUN, 'E04'))
        self.evidence('E04', run_id='other')
        self.assertIsNone(A.load_case(RUN, 'E04'))
        self.evidence('E04', result='MAYBE')
        self.assertIsNone(A.load_case(RUN, 'E04'))
        self.evidence('E04', at='2000-01-01T00:00:00+00:00')
        self.assertIsNone(A.load_case(RUN, 'E04', since='2020-01-01T00:00:00+00:00'))
        self.assertEqual(A.load_case(RUN, 'E04')['result'], 'PASS')


class RunTests(Base):
    def test_unrun_journey_cases_are_never_pass(self):
        with self.spec(0, writes=['E04']):
            A.run_spec(RUN, 'journey')
        self.assertEqual(A.load_case(RUN, 'E04')['result'], 'PASS')
        for case in ('E05', 'E12'):
            self.assertIsNone(A.load_case(RUN, case))

    def test_crashed_spec_fails_cases_without_evidence(self):
        with self.spec(1, writes=['E04']):
            A.run_spec(RUN, 'journey')
        self.assertEqual(A.load_case(RUN, 'E04')['result'], 'PASS')
        self.assertEqual(A.load_case(RUN, 'E05')['result'], 'FAIL')

    def test_exit_zero_never_overrides_spec_evidence(self):
        def fake(run_id, spec, grep):
            A.write_case(run_id, 'E04', 'FAIL', 'caught inside the spec')
            return 0, ['npx']
        with mock.patch.object(A, 'playwright', side_effect=fake):
            A.run_spec(RUN, 'journey')
        self.assertEqual(A.load_case(RUN, 'E04')['result'], 'FAIL')

    def test_stale_evidence_from_an_earlier_invocation_is_ignored(self):
        self.evidence('E05', at='2000-01-01T00:00:00+00:00')
        with self.spec(0):
            A.run_spec(RUN, 'journey')
        # Not counted for this invocation and not rewritten either.
        self.assertIsNone(A.load_case(RUN, 'E05', since='2001-01-01T00:00:00+00:00'))
        self.assertEqual(A.load_case(RUN, 'E05')['at'], '2000-01-01T00:00:00+00:00')

    def test_cases_without_a_spec_run_nothing(self):
        with self.spec(0) as fake:
            for case in ('E01', 'E02', 'E03'):
                A.run_case(RUN, case)
        fake.assert_not_called()
        self.assertFalse((self.here / '.evidence' / RUN / 'E01.json').exists())

    def test_report_marks_missing_cases_not_run(self):
        self.evidence('E04', result='FAIL')
        A.report(RUN)
        text = (self.here / '.evidence' / RUN / 'report.md').read_text()
        self.assertIn('| E04 | FAIL |', text)
        self.assertIn('| E01 | NOT RUN |', text)
        self.assertNotIn('PASS', text)


class DocTests(Base):
    def test_write_case_leaves_the_tracked_doc_alone(self):
        before = self.doc.read_text()
        A.write_case(RUN, 'E04', 'PASS', 'x')
        self.assertEqual(self.doc.read_text(), before)

    def test_update_doc_copies_only_evidence(self):
        self.evidence('E06', result='FAIL')
        A.update_doc(RUN)
        rows = {line.split('|')[1].strip(): line.split('|')[4].strip() for line in self.doc.read_text().splitlines() if line.startswith('| E')}
        self.assertEqual(rows['E06'], 'FAIL')
        self.assertEqual(rows['E01'], 'OLD')
        self.assertIn('- E01: NOT RUN; no case evidence in this run.', self.doc.read_text())

    def test_update_doc_is_idempotent_and_keeps_linked_ids(self):
        self.doc.write_text(self.doc.read_text().replace('| E06 | x | y | OLD | |', '| E06 | x | y | OLD | keep |') + '\n## Later section\n- kept\n')
        self.evidence('E06', result='FAIL')
        A.update_doc(RUN)
        A.update_doc(RUN)
        text = self.doc.read_text()
        self.assertEqual(text.count(f'## Live run {RUN}'), 1)
        self.assertEqual(text.count('- E06: FAIL'), 1)
        self.assertIn('| E06 | x | y | FAIL | keep |', text)
        self.assertIn('## Later section\n- kept', text)


class ComposeTests(unittest.TestCase):
    def test_compose_accepts_check_override(self):
        state = {'projectName': 'p', 'envFile': 'e', 'composeFile': 'c'}
        with mock.patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, '', '')) as run:
            L.compose(state, ['exec', 'x'], capture_output=True, text=True, check=False)
            L.compose(state, ['ps'])
        self.assertIs(run.call_args_list[0].kwargs['check'], False)
        self.assertIs(run.call_args_list[1].kwargs['check'], True)

    def test_migrate_runs_without_type_error(self):
        with mock.patch.object(L, 'read_state', return_value={'projectName': 'p', 'envFile': 'e', 'composeFile': 'c'}), \
                mock.patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, 'out', 'err')):
            self.assertEqual(A.migrate('--dry-run', '/tmp/x.json')['exit'], 2)


if __name__ == '__main__':
    unittest.main()
