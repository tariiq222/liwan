"""Delivery decisions fail closed before any model or repository write."""
import base64
import os
import unittest
from unittest.mock import patch

import pr_delivery as delivery

HEAD = 'a' * 40


class DeliveryTest(unittest.TestCase):
    def pr(self):
        return {'number': 9, 'state': 'open', 'draft': False, 'user': {'login': 'owner'},
                'head': {'sha': HEAD, 'ref': 'codex/web-fix', 'repo': {'full_name': 'owner/repo'}},
                'base': {'ref': 'main'}, 'changed_files': 1, 'mergeable_state': 'clean'}

    def file(self, path='apps/web/app/components/Card.vue', patch_text='+ fix layout'):
        return {'filename': path, 'status': 'modified', 'patch': patch_text}

    def test_safe_ui_is_eligible_but_governance_auth_and_deletions_require_owner(self):
        self.assertFalse(delivery.sensitive([self.file()]))
        for item in (self.file('AGENTS.md'), self.file('.github/workflows/ci.yml'),
                     self.file('apps/web/app/middleware/auth.ts'), self.file(patch_text='+ access_token = x'),
                     dict(self.file(), status='removed')):
            self.assertTrue(delivery.sensitive([item]), item)

    def test_only_owner_exact_head_approval_counts(self):
        comment = {'user': {'login': 'owner'}, 'body': f'/webvue approve {HEAD}'}
        self.assertTrue(delivery.approved([comment], 'owner', HEAD))
        self.assertFalse(delivery.approved([comment], 'owner', 'b' * 40))
        comment['user']['login'] = 'github-actions[bot]'
        self.assertFalse(delivery.approved([comment], 'owner', HEAD))

    def test_draft_fork_other_author_and_wrong_base_are_rejected(self):
        for mutate in (lambda p: p.update(draft=True),
                       lambda p: p['head']['repo'].update(full_name='fork/repo'),
                       lambda p: p['user'].update(login='stranger'),
                       lambda p: p['base'].update(ref='other')):
            pr = self.pr()
            mutate(pr)
            self.assertFalse(delivery.eligible(pr, 'owner/repo'))

    def test_unknown_or_unavailable_checks_never_merge_or_repair(self):
        for ci, review in [('pending', 'success'), ('success', 'error'), ('cancelled', 'failure')]:
            self.assertEqual(delivery.decide(ci, review, 0, False), 'wait')

    def test_three_cycles_total_not_reset_by_head_and_duplicate_head_not_repaired(self):
        self.assertEqual(delivery.decide('failure', 'success', 2, False), 'repair')
        self.assertEqual(delivery.decide('failure', 'success', 3, False), 'stop')
        self.assertEqual(delivery.decide('failure', 'success', 1, True), 'wait')
        self.assertEqual(delivery.decide('success', 'success', 3, True), 'merge')

    def test_attempt_history_only_accepts_authenticated_bot_and_valid_markers(self):
        marker = delivery.attempt_marker(HEAD, 1)
        self.assertEqual(delivery.attempts([{'user': {'login': 'owner'}, 'body': marker}]), [])
        row = {'user': {'login': 'github-actions[bot]'}, 'body': marker}
        self.assertEqual(delivery.attempts([row, row]), [(HEAD, 1)])

    def test_patch_rejects_extra_file_duplicates_empty_and_oversize(self):
        files = [self.file()]
        valid = {'head_sha': HEAD, 'summary': 'Fix layout', 'edits': [
            {'path': files[0]['filename'], 'content': 'fixed\n'}]}
        self.assertEqual(delivery.validate_patch(valid, HEAD, files)[0]['content'], 'fixed\n')
        for edits in ([], valid['edits'] * 2,
                      [{'path': '.github/workflows/ci.yml', 'content': 'bad'}],
                      [{'path': files[0]['filename'], 'content': 'x' * 200001}]):
            with self.assertRaises(ValueError):
                delivery.validate_patch(dict(valid, edits=edits), HEAD, files)

    def test_publish_refuses_moved_head_before_blob_or_ref_write(self):
        pr = self.pr()
        pr['head']['sha'] = 'b' * 40
        with patch.object(delivery, 'api', return_value=pr), patch.object(delivery, 'request') as writes:
            with self.assertRaises(RuntimeError):
                delivery.publish('owner/repo', 9, HEAD, {'head_sha': HEAD}, 1)
        writes.assert_not_called()

    def test_automatic_repair_cannot_rewrite_tests_or_policy(self):
        for name in ('apps/web/app/components/Card.test.ts', 'docs/UPDATE_POLICY.md',
                     'apps/web/app/components/AGENTS.md', 'apps/web/stories/AiRunList.stories.ts'):
            report = {'head_sha': HEAD, 'summary': 'fix', 'edits': [{'path': name, 'content': 'weaken'}]}
            with self.assertRaises(ValueError):
                delivery.validate_patch(report, HEAD, [self.file(name)])

    def test_existing_capability_guard_change_requires_sensitive_approval(self):
        changed = self.file('apps/web/app/pages/documents/new.vue',
                            '- v-if="!can(\'documents.items.manage\')"\n+ v-if="false"')
        self.assertTrue(delivery.sensitive([changed]))

    def test_repair_cannot_remove_guard_outside_original_pr_diff_or_embedded_test(self):
        self.assertTrue(delivery.protected_source_change("v-if=\"can('manage')\"", 'v-if="false"'))
        self.assertTrue(delivery.protected_source_change('play: async () => { expect(x).toBe(1) }', 'play: async () => {}'))
        self.assertFalse(delivery.protected_source_change('<p>old</p>', '<p>new</p>'))

    def test_nonmain_controller_execution_is_refused_before_any_api(self):
        with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/codex/candidate'}), patch.object(
                delivery, 'api') as api:
            with self.assertRaises(RuntimeError):
                delivery.require_main()
        api.assert_not_called()

    def test_api_job_inventory_includes_second_page_and_rejects_missing_results(self):
        first = {'total_count': 101, 'jobs': [{'id': n} for n in range(100)]}
        with patch.object(delivery, 'api', side_effect=[first, {'jobs': [{'id': 100}]}]):
            self.assertEqual(len(delivery.run_jobs('owner/repo', 1)), 101)
        with patch.object(delivery, 'api', return_value={'total_count': 2, 'jobs': []}):
            with self.assertRaises(RuntimeError):
                delivery.run_jobs('owner/repo', 1)

    def test_success_status_from_another_workflow_cannot_approve_review(self):
        status = {'context': 'code-review', 'state': 'success',
                  'creator': {'login': 'github-actions[bot]'},
                  'target_url': 'https://github.com/owner/repo/actions/runs/77'}
        run = {'workflow_id': 4, 'head_repository': {'full_name': 'owner/repo'},
               'display_title': 'pr-review #9', 'status': 'completed', 'event': 'workflow_dispatch'}
        with patch.object(delivery, 'api', side_effect=[[status], run, {'id': 5}]):
            self.assertEqual(delivery.review_state('owner/repo', HEAD, 9), 'pending')
        run['workflow_id'] = 5
        with patch.object(delivery, 'api', side_effect=[[status], run, {'id': 5}]):
            self.assertEqual(delivery.review_state('owner/repo', HEAD, 9), 'success')

    def test_plan_reserves_cycle_before_model_and_duplicate_cannot_reserve_again(self):
        calls = []

        def fake_api(endpoint, payload=None, pages=False):
            if endpoint.endswith('/comments'):
                if payload:
                    calls.append(payload['body'])
                return []
            return {}
        with patch.object(delivery, 'checked_pr', return_value=self.pr()), patch.object(
                delivery, 'files_for', return_value=[self.file()]), patch.object(
                delivery, 'ci_state', return_value='failure'), patch.object(
                delivery, 'review_state', return_value='success'), patch.object(
                delivery, 'policy_status'), patch.object(delivery, 'output') as out, patch.object(
                delivery, 'api', side_effect=fake_api):
            delivery.plan('owner/repo', 9)
            self.assertIn(delivery.attempt_marker(HEAD, 1), calls[0])
            self.assertEqual(out.call_args.kwargs['decision'], 'repair')

    def test_publisher_uses_nonforce_expected_parent_and_explicit_dispatches(self):
        path = self.file()['filename']
        report = {'head_sha': HEAD, 'summary': 'Fix', 'edits': [{'path': path, 'content': 'fixed\n'}]}

        def fake_api(endpoint, payload=None, pages=False):
            if endpoint.endswith('/comments'):
                return [{'user': {'login': 'github-actions[bot]'}, 'body': delivery.attempt_marker(HEAD, 1)}]
            if '/git/commits/' in endpoint:
                return {'tree': {'sha': 'oldtree'}}
            if '/git/trees/oldtree' in endpoint:
                return {'truncated': False, 'tree': [{'path': path, 'mode': '100644', 'sha': 'oldblob'}]}
            if '/git/blobs/oldblob' in endpoint:
                return {'encoding': 'base64', 'content': base64.b64encode(b'<p>old</p>').decode()}
            return {'sha': 'newsha'}
        with patch.object(delivery, 'checked_pr', return_value=self.pr()), patch.object(
                delivery, 'files_for', return_value=[self.file()]), patch.object(
                delivery, 'api', side_effect=fake_api) as api, patch.object(
                delivery, 'request') as write, patch.object(delivery, 'dispatch') as dispatch, patch.object(
                delivery, 'policy_status'):
            delivery.publish('owner/repo', 9, HEAD, report, 1)
        self.assertEqual(write.call_args.args[0], 'PATCH')
        self.assertFalse(write.call_args.args[2]['force'])
        parent = next(c.args[1]['parents'] for c in api.call_args_list if c.args[0].endswith('/git/commits'))
        self.assertEqual(parent, [HEAD])
        dispatch.assert_called_once_with('owner/repo', 9, 'newsha', 'codex/web-fix')

    def test_green_plan_uses_exact_sha_normal_merge_and_requests_full_main_ci(self):
        with patch.object(delivery, 'checked_pr', return_value=self.pr()), patch.object(
                delivery, 'files_for', return_value=[self.file()]), patch.object(
                delivery, 'ci_state', return_value='success'), patch.object(
                delivery, 'review_state', return_value='success'), patch.object(
                delivery, 'settle_outdated_bot_threads'), patch.object(delivery, 'policy_status'), patch.object(
                delivery, 'output'), patch.object(delivery, 'api', return_value=[]) as api, patch.object(
                delivery, 'request', return_value={'merged': True}) as merge:
            delivery.plan('owner/repo', 9)
        self.assertEqual(merge.call_args.args, ('PUT', 'repos/owner/repo/pulls/9/merge',
                                               {'sha': HEAD, 'merge_method': 'merge'}))
        self.assertEqual(api.call_args.args[1], {'ref': 'main', 'inputs': {'full': True}})

    def test_only_obsolete_bot_only_threads_resolve_after_current_clean_review(self):
        def thread(name, author='chatgpt-codex-connector', outdated=True):
            return {'id': name, 'isResolved': False, 'isOutdated': outdated, 'comments': {
                'pageInfo': {'hasNextPage': False}, 'nodes': [
                    {'author': {'login': author, '__typename': 'Bot' if author != 'owner' else 'User'},
                     'originalCommit': {'oid': 'b' * 40}}]}}

        threads = [thread('old-bot'), thread('human', author='owner'), thread('current-bot', outdated=False)]
        result = {'data': {'repository': {'pullRequest': {'headRefOid': HEAD, 'reviewThreads': {
            'pageInfo': {'hasNextPage': False}, 'nodes': threads}}}}}
        with patch.object(delivery, 'api', side_effect=[result, {}]) as api, patch.object(delivery, 'checked_pr'):
            delivery.settle_outdated_bot_threads('owner/repo', 9, HEAD)
        self.assertEqual(api.call_count, 2)
        self.assertEqual(api.call_args.args[1]['variables'], {'id': 'old-bot'})


if __name__ == '__main__':
    unittest.main()
