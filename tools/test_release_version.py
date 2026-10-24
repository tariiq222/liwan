import unittest
from unittest.mock import patch

import release_version as release


class ReleaseVersionTest(unittest.TestCase):
    def test_numeric_next_version(self):
        self.assertEqual(release.next_tag(['release/19.0.1.0.9', 'release/19.0.1.0.10']),
                         'release/19.0.1.0.11')
        self.assertEqual(release.next_tag(['release/19.0.1.0.1']), 'release/19.0.1.0.2')
        with self.assertRaises(ValueError):
            release.next_tag(['random'])

    def jobs(self):
        return [{'name': name, 'conclusion': 'success'} for name in release.STAGES] + [
            {'name': 'ci-result', 'conclusion': 'success'}]

    def test_all_twelve_groups_and_aggregate_must_actually_succeed(self):
        self.assertTrue(release.full_success(self.jobs()))
        for bad in ('skipped', 'failure', 'cancelled', None):
            jobs = self.jobs()
            jobs[3]['conclusion'] = bad
            self.assertFalse(release.full_success(jobs))
        self.assertFalse(release.full_success(self.jobs()[1:]))

    def test_matrix_shard_failure_cannot_be_hidden_by_successful_sibling(self):
        jobs = [j for j in self.jobs() if j['name'] != 'odoo']
        jobs += [{'name': 'odoo (shard 1)', 'conclusion': 'success'},
                 {'name': 'odoo (shard 2)', 'conclusion': 'failure'}]
        self.assertFalse(release.full_success(jobs))

    def api(self, head='a' * 40, existing=False):
        self.writes = []

        def fake(endpoint, payload=None):
            if payload:
                self.writes.append(payload)
                return {}
            if endpoint.endswith('/runs/7'):
                return {'workflow_id': 5, 'head_repository': {'full_name': 'owner/repo'},
                        'head_branch': 'main', 'head_sha': 'a' * 40, 'status': 'completed',
                        'conclusion': 'success', 'event': 'workflow_dispatch'}
            if endpoint.endswith('/workflows/ci.yml'):
                return {'id': 5}
            if endpoint.endswith('/heads/main'):
                return {'object': {'sha': head}}
            return [{'ref': 'refs/tags/release/19.0.1.0.1',
                     'object': {'type': 'commit', 'sha': 'a' * 40 if existing else 'b' * 40}}]
        return fake

    def test_current_full_main_gets_exact_sha_and_repeat_event_is_idempotent(self):
        with patch.object(release, 'api', side_effect=self.api()), patch.object(
                release, 'run_jobs', return_value=self.jobs()):
            self.assertEqual(release.tag_run('owner/repo', 7), 'release/19.0.1.0.2')
        self.assertEqual(self.writes, [{'ref': 'refs/tags/release/19.0.1.0.2', 'sha': 'a' * 40}])
        with patch.object(release, 'api', side_effect=self.api(existing=True)), patch.object(
                release, 'run_jobs', return_value=self.jobs()):
            self.assertEqual(release.tag_run('owner/repo', 7), 'release/19.0.1.0.1')
        self.assertFalse(self.writes)

    def test_stale_main_or_scoped_run_never_writes_tag(self):
        for stale, jobs in [(True, self.jobs()), (False, self.jobs()[1:])]:
            with patch.object(release, 'api', side_effect=self.api(head='b' * 40 if stale else 'a' * 40)), patch.object(
                    release, 'run_jobs', return_value=jobs):
                with self.assertRaises(RuntimeError):
                    release.tag_run('owner/repo', 7)
            self.assertFalse(self.writes)


    def test_job_inventory_includes_second_page_and_rejects_missing_results(self):
        first = {'total_count': 101, 'jobs': [{'id': n} for n in range(100)]}
        with patch.object(release, 'api', side_effect=[first, {'jobs': [{'id': 100}]}]):
            self.assertEqual(len(release.run_jobs('owner/repo', 1)), 101)
        with patch.object(release, 'api', return_value={'total_count': 2, 'jobs': []}):
            with self.assertRaises(RuntimeError):
                release.run_jobs('owner/repo', 1)

if __name__ == '__main__':
    unittest.main()
