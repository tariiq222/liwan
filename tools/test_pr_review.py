"""Review availability must never be confused with approval or a stale review."""
import json
import os
import subprocess
import unittest
from unittest.mock import patch

import pr_review

HEAD = 'a' * 40


class ReviewSelectionTest(unittest.TestCase):
    def native(self, state='COMMENTED', head=HEAD, login='chatgpt-codex-connector[bot]', kind='Bot'):
        return {'id': 17, 'state': state, 'commit_id': head,
                'user': {'login': login, 'type': kind}, 'html_url': 'https://github.com/o/r/pull/1#pullrequestreview-17'}

    def test_current_codex_review_is_complete_even_when_it_requests_changes(self):
        for state in ('COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'):
            with self.subTest(state=state):
                self.assertIsNotNone(pr_review.codex_review([self.native(state)], HEAD))

    def test_stale_dismissed_pending_and_other_authors_are_not_reviews(self):
        for review in (self.native(head='b' * 40), self.native('DISMISSED'), self.native('PENDING'),
                       self.native(login='other[bot]'), self.native(kind='User')):
            with self.subTest(review=review):
                self.assertIsNone(pr_review.codex_review([review], HEAD))

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

    def test_primary_findings_are_not_replaced_by_a_clean_backup(self):
        primary = {'provider': 'codex', 'blocking': True}
        backup = {'provider': 'claude', 'blocking': False}
        self.assertEqual(pr_review.choose_review(primary, backup), primary)

    def test_later_codex_comment_does_not_dismiss_an_earlier_change_request(self):
        reviews = [self.native('CHANGES_REQUESTED'), self.native('COMMENTED')]
        self.assertTrue(pr_review.codex_review(reviews, HEAD)['blocking'])

    def test_codex_inline_priority_one_blocks_even_when_review_is_commented(self):
        inline = self.native()
        inline['body'] = '**[P1] Fix lost data**'
        self.assertTrue(pr_review.codex_review([self.native()], HEAD, [inline])['blocking'])

    def test_priority_two_bug_requires_repair_before_automatic_delivery(self):
        report = {'head_sha': HEAD, 'complete': True, 'summary': 'Bug', 'findings': [
            {'priority': 'P2', 'file': 'a.py', 'line': 1, 'message': 'Incorrect result'}]}
        self.assertTrue(pr_review.claude_review(json.dumps(report), HEAD)['blocking'])

    def test_backup_covers_service_unavailability_but_neither_means_blocked(self):
        backup = {'provider': 'claude', 'blocking': False}
        self.assertEqual(pr_review.choose_review(None, backup), backup)
        self.assertIsNone(pr_review.choose_review(None, None))

    def test_confirmation_reaction_requires_the_bot_and_the_current_trigger(self):
        trigger = {'body': f'@codex review\n<!-- webvue-review-head:{HEAD} -->'}
        reaction = {'content': '+1', 'user': {'login': 'chatgpt-codex-connector[bot]', 'type': 'Bot'}}
        self.assertTrue(pr_review.codex_confirmation(trigger, [reaction], HEAD))
        self.assertFalse(pr_review.codex_confirmation(trigger, [{**reaction, 'content': 'eyes'}], HEAD))
        self.assertFalse(pr_review.codex_confirmation(trigger, [reaction], 'b' * 40))
        self.assertFalse(pr_review.codex_confirmation(trigger, [{**reaction, 'user': {'login': 'other', 'type': 'User'}}], HEAD))


class FinalizeReviewTest(unittest.TestCase):
    def run_gate(self, native=None, report=None, moved=False):
        self.calls = []

        def github(endpoint, payload=None, pages=False):
            self.calls.append((endpoint, payload))
            if endpoint == 'repos/o/r/pulls/1':
                return {'state': 'open', 'head': {'sha': 'b' * 40 if moved else HEAD,
                                                'repo': {'full_name': 'o/r'}}, 'base': {'ref': 'main'}}
            if endpoint.endswith('/reviews') and payload is None:
                return native or []
            return {}

        with patch.object(pr_review, 'api', side_effect=github), patch.dict(
                os.environ, {'CLAUDE_REVIEW': json.dumps(report) if report else ''}):
            return pr_review.finalize('o/r', 1, HEAD, 0)

    def backup(self, findings=None):
        return {'head_sha': HEAD, 'complete': True, 'summary': 'Reviewed this diff', 'findings': findings or []}

    def test_service_failover_publishes_standard_review_and_success_for_current_head(self):
        self.assertEqual(self.run_gate(report=self.backup()), 0)
        posted = [payload for endpoint, payload in self.calls if endpoint.endswith('/reviews') and payload]
        self.assertEqual(posted[0]['commit_id'], HEAD)
        self.assertEqual(posted[0]['event'], 'COMMENT')
        self.assertEqual(self.calls[-1][1]['state'], 'success')

    def test_two_unavailable_reviewers_publish_error_and_no_fake_review(self):
        self.assertEqual(self.run_gate(), 1)
        self.assertFalse(any(endpoint.endswith('/reviews') and payload for endpoint, payload in self.calls))
        self.assertEqual(self.calls[-1][1]['state'], 'error')

    def test_changed_head_is_rejected_before_any_result_is_published(self):
        with self.assertRaises(RuntimeError):
            self.run_gate(report=self.backup(), moved=True)
        self.assertFalse(any(payload for _, payload in self.calls))

    def test_late_primary_cannot_erase_backup_blocking_finding(self):
        native = ReviewSelectionTest().native()
        finding = {'priority': 'P1', 'file': 'a.py', 'line': 7, 'message': 'Data loss'}
        self.assertEqual(self.run_gate(native=[native], report=self.backup([finding])), 1)
        self.assertEqual(self.calls[-1][1]['state'], 'failure')

    def test_rerun_retains_persisted_claude_blocker_without_new_backup_output(self):
        previous = {'id': 16, 'state': 'CHANGES_REQUESTED', 'commit_id': HEAD,
                    'user': {'login': 'github-actions[bot]', 'type': 'Bot'},
                    'body': f'<!-- webvue-review:claude:{HEAD} -->\nP1: Data loss'}
        reviews = [previous, ReviewSelectionTest().native()]
        self.assertEqual(self.run_gate(native=reviews), 1)
        self.assertEqual(self.calls[-1][1]['state'], 'failure')


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
