"""The audit framework must never turn a broken environment or an unrun check into a pass.

These cases pin the two failure modes that made a security profile report "passed" while Semgrep never
scanned anything: a tool that aborts before scanning is Not Verified, and a composite probe whose part
did not run is Not Verified, not a pass from its sibling.
"""
import sys
import tempfile
import unittest
from pathlib import Path

AUDIT = Path(__file__).resolve().parent / 'audit'
sys.path.insert(0, str(AUDIT))

import engine  # noqa: E402
import stages  # noqa: E402


class CrashDetection(unittest.TestCase):
    def log(self, text):
        handle = tempfile.NamedTemporaryFile('w', suffix='.log', delete=False, encoding='utf-8')
        handle.write(text)
        handle.close()
        return Path(handle.name)

    def test_semgrep_trust_store_abort_is_a_crash(self):
        log = self.log('Fatal error: exception Failure("Failed to create system store X509 authenticator")')
        self.assertTrue(engine.crashed(log))

    def test_registry_dns_failure_is_a_crash(self):
        self.assertTrue(engine.crashed(self.log('npm error code ENOTFOUND\nnpm error syscall getaddrinfo')))

    def test_a_real_finding_is_not_a_crash(self):
        log = self.log('semgrep: 3 blocking findings in apps/web/server/api/x.ts')
        self.assertFalse(engine.crashed(log))

    def test_missing_log_is_not_a_crash(self):
        self.assertFalse(engine.crashed(Path('/nonexistent/audit.log')))

    def test_crashed_command_is_not_verified_not_failed(self):
        """The exit code alone cannot distinguish a broken tool from a code defect."""
        script = self.log('Fatal error: exception Failure("empty trust anchors")')
        command = engine.Command('broken scanner', ['sh', '-c', 'cat "%s"; exit 2' % script])
        with tempfile.TemporaryDirectory() as logs:
            result = engine.run_command(command, Path(logs))
        self.assertEqual(result['status'], 'not_verified')
        self.assertIn('crashed', result['reason'])


class CompositeProbes(unittest.TestCase):
    def test_passing_sibling_does_not_hide_an_unrun_part(self):
        combined = stages._combine('security', [
            stages.probe('passed', 'secret scan found nothing'),
            stages.probe('not_verified', 'semgrep crashed before scanning'),
        ])
        self.assertEqual(combined['status'], 'not_verified')
        self.assertIn('semgrep crashed', combined['reason'])

    def test_failure_still_dominates(self):
        combined = stages._combine('security', [
            stages.probe('passed', 'secret scan found nothing'),
            stages.probe('failed', '3 blocking findings'),
        ])
        self.assertEqual(combined['status'], 'failed')

    def test_all_parts_passed_is_a_pass(self):
        combined = stages._combine('security', [
            stages.probe('passed', 'secret scan found nothing'),
            stages.probe('passed', 'no blocking Semgrep result'),
        ])
        self.assertEqual(combined['status'], 'passed')


class ProbeFromChecks(unittest.TestCase):
    def test_a_crashed_check_keeps_its_probe_not_verified(self):
        probe = stages._probe_from_checks('deployment', [
            {'name': 'compose', 'status': 'not_verified', 'reason': 'docker is not installed'},
        ], ['compose'])
        self.assertEqual(probe['status'], 'not_verified')

    def test_a_failed_check_fails_its_probe(self):
        probe = stages._probe_from_checks('deployment', [
            {'name': 'compose', 'status': 'failed', 'reason': 'invalid service'},
        ], ['compose'])
        self.assertEqual(probe['status'], 'failed')

    def test_no_defined_check_is_not_verified(self):
        self.assertEqual(stages._probe_from_checks('supply-chain', [], ['npm audit'])['status'], 'not_verified')


class CoverageScoring(unittest.TestCase):
    def test_one_probe_is_never_a_full_score(self):
        import coverage
        axis = {'group': 'quality', 'key': 'security', 'name': 'Security', 'probes': ('security', 'static-analysis')}
        entry = coverage.coverage_entry(axis, {'security': {'status': 'passed'}})
        self.assertEqual(entry['score'], 2)
        self.assertEqual(entry['verified_probes'], ['security'])

    def test_no_probe_is_not_verified(self):
        import coverage
        axis = {'group': 'quality', 'key': 'security', 'name': 'Security', 'probes': ('security',)}
        entry = coverage.coverage_entry(axis, {})
        self.assertIsNone(entry['score'])
        self.assertTrue(entry['reason'].startswith('Not Verified'))

    def test_the_matrix_covers_all_forty_eight_axes(self):
        import coverage
        self.assertEqual(len(coverage.AXES), 48)
        self.assertEqual(len({axis['key'] for axis in coverage.AXES}), 48)
        for axis in coverage.AXES:
            for probe in axis['probes']:
                self.assertIn(probe, coverage.PROBE_SOURCES, '%s has no evidence source' % probe)


class DependencyGaps(unittest.TestCase):
    """A stale node_modules says nothing about the product; it must not read as a regression."""

    def test_missing_module_is_a_dependency_gap(self):
        check = {'name': 'apps/web tests', 'status': 'failed', 'tail':
                 'FAIL app/utils/__tests__/x.test.ts (0 test)\nError: ENOENT: no such file or directory, '
                 'open .../node_modules/moyasar-payment-form/dist/moyasar.css\nno tests'}
        self.assertTrue(stages.dependency_missing(check))

    def test_unresolved_import_is_a_dependency_gap(self):
        check = {'name': 'vendor tests', 'status': 'failed', 'tail': "Error: Cannot find module '@nuxt/test-utils'"}
        self.assertTrue(stages.dependency_missing(check))

    def test_python_resolution_failure_is_a_dependency_gap(self):
        check = {'name': 'ai service audit', 'status': 'failed',
                 'tail': 'ERROR: No matching distribution found for cachecontrol==0.14.4'}
        self.assertTrue(stages.dependency_missing(check))

    def test_a_heap_crash_is_an_environment_limit_not_a_type_error(self):
        check = {'name': 'web type check', 'status': 'failed', 'tail':
                 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - '
                 'JavaScript heap out of memory'}
        self.assertTrue(stages.dependency_missing(check))

    def test_a_rejected_npm_config_is_an_environment_gap(self):
        check = {'name': 'npm audit', 'status': 'failed', 'tail':
                 'npm error code EALLOWSCRIPTS\nnpm error --allow-scripts is not allowed in '
                 'project-scoped installs.'}
        self.assertTrue(stages.dependency_missing(check))

    def test_a_missing_python_pin_is_an_environment_gap(self):
        check = {'name': 'ai service audit', 'status': 'failed', 'tail':
                 'ERROR: Could not find a version that satisfies the requirement cachecontrol==0.14.4'}
        self.assertTrue(stages.dependency_missing(check))

    def test_a_real_audit_advisory_is_still_a_failure(self):
        check = {'name': 'npm audit', 'status': 'failed', 'tail':
                 'found 3 high severity vulnerabilities in production dependencies'}
        self.assertFalse(stages.dependency_missing(check))

    def test_a_real_assertion_failure_stays_a_failure(self):
        check = {'name': 'apps/web tests', 'status': 'failed', 'tail':
                 'Tests 1 failed | 6961 passed\nAssertionError: expected 2 to be 3'}
        self.assertFalse(stages.dependency_missing(check))

    def test_suites_that_fail_before_collecting_are_a_dependency_gap(self):
        check = {'name': 'vendor tests', 'status': 'failed', 'tail':
                 'Test Files 88 failed (88)\nTests no tests\n'
                 "Error: Cannot find module '@nuxt/test-utils/runtime'"}
        self.assertTrue(stages.dependency_missing(check))

    def test_a_suite_with_no_tests_and_no_import_error_is_not_a_dependency_gap(self):
        check = {'name': 'vendor tests', 'status': 'failed', 'tail': 'Test Files 88 failed (88)\nTests no tests'}
        self.assertFalse(stages.dependency_missing(check))


class ReviewedFalsePositives(unittest.TestCase):
    """A reviewed match is recorded with a reason; an unreviewed one still blocks."""

    def test_every_reviewed_entry_carries_a_real_reason(self):
        import json
        data = json.loads((AUDIT / 'semgrep-reviewed.json').read_text(encoding='utf-8'))
        for entry in data['reviewed']:
            for key in ('rule', 'path', 'reason'):
                self.assertTrue(entry.get(key), 'reviewed entry lacks %s' % key)
            self.assertGreater(len(entry['reason'].split()), 8, 'reason says nothing')

    def test_the_rule_key_is_path_independent(self):
        item = {'check_id': 'Users.x..cache.rules.python.lang.security.audit.thing.thing.rule-name'}
        self.assertEqual(stages.semgrep_rule(item), 'rule-name')

    def test_an_unknown_rule_has_no_review(self):
        self.assertNotIn(('not-reviewed-rule', 'x.py'), stages.semgrep_reviewed())


class EvidenceLocation(unittest.TestCase):
    """Evidence must outlive the lane that produced it."""

    def test_the_default_root_is_the_canonical_checkout_not_a_lane(self):
        root = engine.evidence_root()
        self.assertNotIn('/.worktrees/', str(root), 'evidence would die with the lane: %s' % root)
        self.assertEqual(root.name, '.audit')

    def test_an_override_wins(self):
        previous = __import__('os').environ.get('LIWAN_AUDIT_DIR')
        __import__('os').environ['LIWAN_AUDIT_DIR'] = '/tmp/liwan-audit-test'
        try:
            self.assertEqual(engine.evidence_root(), Path('/tmp/liwan-audit-test').resolve())
        finally:
            if previous is None:
                del __import__('os').environ['LIWAN_AUDIT_DIR']
            else:
                __import__('os').environ['LIWAN_AUDIT_DIR'] = previous

    def test_the_gitignore_keeps_evidence_out_of_the_tree(self):
        text = (AUDIT.parents[1] / '.gitignore').read_text(encoding='utf-8')
        self.assertIn('.audit/', text)


class ReportHonesty(unittest.TestCase):
    def test_a_not_verified_probe_is_never_scored(self):
        import coverage
        rows = coverage.matrix({'security': {'status': 'not_verified', 'reason': 'scanner crashed'}})
        self.assertEqual(rows['verified'], 0)

    def test_finding_ids_are_unique_and_stable(self):
        import report
        findings = report.number([
            report.finding('security', 'P1', 'a', 'd', 'r', 'e', 'i', 's', 't'),
            report.finding('security', 'P2', 'b', 'd', 'r', 'e', 'i', 's', 't'),
        ])
        self.assertEqual(len({item['id'] for item in findings}), 2)
        self.assertTrue(all(item['id'].startswith('AUD-') for item in findings))


class ToolLock(unittest.TestCase):
    """A missing scanner must be a recorded decision with a reason, not a silent gap."""

    def setUp(self):
        import json
        self.lock = json.loads((AUDIT / 'tools.lock.json').read_text(encoding='utf-8'))

    def test_every_tool_states_a_decision(self):
        for name, entry in self.lock['tools'].items():
            self.assertIn(entry.get('decision'), {'installed', 'optional', 'not-installed', 'deferred', 'not-applicable'},
                          '%s has no decision' % name)

    def test_a_tool_that_does_not_run_says_why(self):
        for name, entry in self.lock['tools'].items():
            if entry['decision'] != 'installed':
                self.assertTrue(entry.get('reason'), '%s is not installed and gives no reason' % name)
                self.assertGreater(len(entry['reason'].split()), 8, '%s reason says nothing' % name)

    def test_every_tool_states_its_license_and_scope(self):
        for name, entry in self.lock['tools'].items():
            self.assertTrue(entry.get('license'), '%s has no license' % name)
            self.assertTrue(entry.get('scope'), '%s has no scope' % name)

    def test_no_reason_is_boilerplate(self):
        boring = {'todo', 'tbd', 'n/a', 'later', 'skip', 'not needed', 'optional'}
        for name, entry in self.lock['tools'].items():
            reason = (entry.get('reason') or '').strip().lower()
            self.assertNotIn(reason, boring, '%s reason is boilerplate' % name)


if __name__ == '__main__':
    unittest.main()
