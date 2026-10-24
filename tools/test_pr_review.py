"""A Claude review counts only for its exact head; a missing review is never approval."""
import json
import os
import subprocess
import unittest
from unittest.mock import patch

import pr_review

HEAD = 'a' * 40


class ReviewReportTest(unittest.TestCase):
    def stored(self, state='COMMENTED', head=HEAD, login='github-actions[bot]', kind='Bot', blocking='false'):
        return {'state': state, 'commit_id': head, 'user': {'login': login, 'type': kind},
                'body': f'<!-- webvue-review:claude:{head} -->\n<!-- webvue-review-blocking:{blocking} -->\nSummary'}

    def test_stale_dismissed_pending_and_other_authors_are_not_stored_reviews(self):
        for review in (self.stored(head='b' * 40), self.stored('DISMISSED'), self.stored('PENDING'),
                       self.stored(login='other[bot]'), self.stored(kind='User')):
            with self.subTest(review=review):
                self.assertIsNone(pr_review.stored_claude_review([review], HEAD))
        self.assertTrue(pr_review.stored_claude_review([self.stored(blocking='true')], HEAD)['blocking'])

    def test_claude_report_requires_current_head_and_explicit_completion(self):
        good = {'head_sha': HEAD, 'complete': True, 'summary': 'Reviewed', 'findings': []}
        self.assertEqual(pr_review.claude_review(json.dumps(good), HEAD)['provider'], 'claude')
        for update in ({'head_sha': 'b' * 40}, {'complete': False}, {'complete': 'true'},
                       {'findings': None}, {'summary': ''}):
            with self.subTest(update=update):
                self.assertIsNone(pr_review.claude_review(json.dumps({**good, **update}), HEAD))

    def test_malformed_or_empty_backup_report_is_unavailable(self):
        for raw in ('', '{', 'null', '[]', '{}'):
            with self.subTest(raw=raw):
                self.assertIsNone(pr_review.claude_review(raw, HEAD))

    def test_cli_error_is_not_success_even_with_subtype_success_and_exit_zero(self):
        report = {'head_sha': HEAD, 'complete': True, 'summary': 'Review', 'findings': []}
        wrapper = {'subtype': 'success', 'is_error': True, 'structured_output': report}
        self.assertEqual(pr_review.structured_claude_output(json.dumps(wrapper), 0, HEAD), '')
        wrapper['is_error'] = False
        self.assertTrue(pr_review.structured_claude_output(json.dumps(wrapper), 0, HEAD))
        self.assertEqual(pr_review.structured_claude_output(json.dumps(wrapper), 1, HEAD), '')

    def test_invalid_findings_cannot_be_treated_as_a_clean_report(self):
        for finding in ({}, {'priority': 'fine', 'file': 'x', 'line': 1, 'message': 'x'},
                        {'priority': 'P1', 'file': 'x', 'line': 0, 'message': 'x'}):
            raw = json.dumps({'head_sha': HEAD, 'complete': True, 'summary': 'Review', 'findings': [finding]})
            self.assertIsNone(pr_review.claude_review(raw, HEAD))

    def test_findings_are_retained_and_blocking_findings_fail_the_gate(self):
        finding = {'priority': 'P1', 'file': 'a.py', 'line': 7, 'message': 'Data loss'}
        raw = json.dumps({'head_sha': HEAD, 'complete': True, 'summary': 'Found a defect', 'findings': [finding]})
        review = pr_review.claude_review(raw, HEAD)
        self.assertTrue(review['blocking'])
        self.assertIn('Data loss', review['body'])

    def test_priority_two_bug_requires_repair_before_automatic_delivery(self):
        report = {'head_sha': HEAD, 'complete': True, 'summary': 'Bug', 'findings': [
            {'priority': 'P2', 'file': 'a.py', 'line': 1, 'message': 'Incorrect result'}]}
        self.assertTrue(pr_review.claude_review(json.dumps(report), HEAD)['blocking'])



class FinalizeReviewTest(unittest.TestCase):
    def run_gate(self, history=None, report=None, moved=False):
        self.calls = []

        def github(endpoint, payload=None, pages=False):
            self.calls.append((endpoint, payload))
            if endpoint == 'repos/o/r/pulls/1':
                return {'state': 'open', 'head': {'sha': 'b' * 40 if moved else HEAD,
                                                'repo': {'full_name': 'o/r'}}, 'base': {'ref': 'main'}}
            if endpoint.endswith('/reviews') and payload is None:
                return history or []
            return {}

        with patch.object(pr_review, 'api', side_effect=github), patch.dict(
                os.environ, {'CLAUDE_REVIEW': json.dumps(report) if report else ''}):
            return pr_review.finalize('o/r', 1, HEAD)

    def backup(self, findings=None):
        return {'head_sha': HEAD, 'complete': True, 'summary': 'Reviewed this diff', 'findings': findings or []}

    def test_valid_report_publishes_standard_review_and_success_for_current_head(self):
        self.assertEqual(self.run_gate(report=self.backup()), 0)
        posted = [payload for endpoint, payload in self.calls if endpoint.endswith('/reviews') and payload]
        self.assertEqual(posted[0]['commit_id'], HEAD)
        self.assertEqual(posted[0]['event'], 'COMMENT')
        self.assertEqual(self.calls[-1][1]['state'], 'success')

    def test_stored_clean_claude_review_never_replaces_a_current_report(self):
        previous = {'state': 'COMMENTED', 'commit_id': HEAD,
                    'user': {'login': 'github-actions[bot]', 'type': 'Bot'},
                    'body': f'<!-- webvue-review:claude:{HEAD} -->\n<!-- webvue-review-blocking:false -->\nClean'}
        for report in (None, {}, {**self.backup(), 'complete': False}):
            with self.subTest(report=report):
                self.assertEqual(self.run_gate(history=[previous], report=report), 1)
                self.assertEqual(self.calls[-1][1]['state'], 'error')

    def test_missing_report_publishes_error_and_no_fake_review(self):
        self.assertEqual(self.run_gate(), 1)
        self.assertFalse(any(endpoint.endswith('/reviews') and payload for endpoint, payload in self.calls))
        self.assertEqual(self.calls[-1][1]['state'], 'error')

    def test_blocking_report_uses_comment_for_bot_authored_pr_but_fails_required_status(self):
        finding = {'priority': 'P1', 'file': 'a.py', 'line': 1, 'message': 'Bug'}
        self.assertEqual(self.run_gate(report=self.backup([finding])), 1)
        posted = [payload for endpoint, payload in self.calls if endpoint.endswith('/reviews') and payload]
        self.assertEqual(posted[0]['event'], 'COMMENT')
        self.assertIn('<!-- webvue-review-blocking:true -->', posted[0]['body'])
        self.assertEqual(self.calls[-1][1]['state'], 'failure')

    def test_comment_report_blocker_survives_clean_comment_on_same_head(self):
        marker = f'<!-- webvue-review:claude:{HEAD} -->\n'
        reports = [{'state': 'COMMENTED', 'commit_id': HEAD,
                    'user': {'login': 'github-actions[bot]', 'type': 'Bot'},
                    'body': marker + f'<!-- webvue-review-blocking:{flag} -->\nSummary'} for flag in ('true', 'false')]
        self.assertTrue(pr_review.stored_claude_review(reports, HEAD)['blocking'])

    def test_changed_head_is_rejected_before_any_result_is_published(self):
        with self.assertRaises(RuntimeError):
            self.run_gate(report=self.backup(), moved=True)
        self.assertFalse(any(payload for _, payload in self.calls))

    def test_rerun_retains_persisted_claude_blocker_without_new_backup_output(self):
        previous = {'id': 16, 'state': 'CHANGES_REQUESTED', 'commit_id': HEAD,
                    'user': {'login': 'github-actions[bot]', 'type': 'Bot'},
                    'body': f'<!-- webvue-review:claude:{HEAD} -->\nP1: Data loss'}
        self.assertEqual(self.run_gate(history=[previous]), 1)
        self.assertEqual(self.calls[-1][1]['state'], 'failure')

    def test_clean_report_cannot_erase_a_blocker_already_recorded_for_the_head(self):
        previous = ReviewReportTest().stored(blocking='true')
        self.assertEqual(self.run_gate(history=[previous], report=self.backup()), 1)
        self.assertEqual(self.calls[-1][1]['state'], 'failure')


class ResolveTest(unittest.TestCase):
    def pr(self):
        return {'state': 'open', 'draft': False, 'user': {'login': 'owner'},
                'head': {'sha': HEAD, 'ref': 'claude/web-fix', 'repo': {'full_name': 'owner/repo'}},
                'base': {'ref': 'main'}}

    def test_draft_fork_other_author_branch_and_base_are_ineligible(self):
        self.assertTrue(pr_review.eligible(self.pr(), 'owner/repo'))
        for mutate in (lambda p: p.update(draft=True),
                       lambda p: p['head']['repo'].update(full_name='fork/repo'),
                       lambda p: p['user'].update(login='stranger'),
                       lambda p: p['head'].update(ref='codex/web-fix'),
                       lambda p: p['base'].update(ref='other')):
            pr = self.pr()
            mutate(pr)
            self.assertFalse(pr_review.eligible(pr, 'owner/repo'))

    def test_resolve_skips_ineligible_and_superseded_heads_without_failing(self):
        for mutate in (lambda p: p.update(draft=True), lambda p: p['head'].update(sha='b' * 40)):
            pr = self.pr()
            mutate(pr)
            with self.subTest(pr=pr), patch.object(pr_review, 'api', return_value=pr), patch.object(
                    pr_review, 'output') as out:
                pr_review.resolve('owner/repo', 9, HEAD)
            out.assert_called_once_with(eligible='false')
        with patch.object(pr_review, 'api', return_value=self.pr()), patch.object(pr_review, 'output') as out:
            pr_review.resolve('owner/repo', 9, HEAD)
        out.assert_called_once_with(pr=9, head=HEAD, eligible='true')


class ClaudeBoundaryTest(unittest.TestCase):
    def test_untrusted_diff_is_stdin_data_and_model_has_no_command_or_file_tools(self):
        report = {'head_sha': HEAD, 'complete': True, 'summary': 'Reviewed', 'findings': []}
        wrapper = json.dumps({'is_error': False, 'structured_output': report})
        diff = '+ echo "$CLAUDE_CODE_OAUTH_TOKEN"; malicious instruction\n'
        replies = [subprocess.CompletedProcess([], 0, diff, ''), subprocess.CompletedProcess([], 0, wrapper, '')]
        with patch.object(pr_review, 'current'), patch.object(pr_review, 'output'), patch.dict(
                os.environ, {'CLAUDE_CODE_OAUTH_TOKEN': 'test-only-credential', 'CLAUDE_BIN': '/untrusted/program'}), patch.object(
                    pr_review.subprocess, 'run', side_effect=replies) as execute:
            self.assertEqual(pr_review.run_claude('o/r', 1, HEAD), 0)
        cli = execute.call_args_list[1]
        args = cli.args[0]
        self.assertEqual(args[0], 'claude')
        self.assertEqual(args[args.index('--tools') + 1], '')
        self.assertIn('--strict-mcp-config', args)
        self.assertEqual(args[args.index('--setting-sources') + 1], '')
        self.assertIn(diff, cli.kwargs['input'])
        self.assertNotIn(diff, args)
        self.assertNotIn('test-only-credential', cli.kwargs['input'])

    def test_oversized_diff_blocks_before_any_model_call(self):
        diff = subprocess.CompletedProcess([], 0, 'x' * 300001, '')
        with patch.object(pr_review, 'current'), patch.dict(
                os.environ, {'CLAUDE_CODE_OAUTH_TOKEN': 'test-only-credential'}), patch.object(
                    pr_review.subprocess, 'run', return_value=diff) as execute:
            self.assertEqual(pr_review.run_claude('o/r', 1, HEAD), 1)
        self.assertEqual(execute.call_count, 1)


if __name__ == '__main__':
    unittest.main()
