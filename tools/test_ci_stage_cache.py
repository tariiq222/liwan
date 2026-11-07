"""The stage-pass cache: input fingerprints, trusted keys, the cached-stage decision and the workflow wiring."""
import contextlib
import io
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import ci_scope
import ci_stage_cache

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    'docs/x.md': 'doc',
    'apps/web/app/a.vue': 'web',
    'odoo-addons/liwan_core/models/m.py': 'addon',
    '.github/workflows/ci.yml': 'ci',
    'package.json': '{}',
}
NON_STATIC = tuple(stage for stage in ci_scope.STAGES if stage != 'static')


def git(repo, *args):
    subprocess.run(['git', '-C', str(repo), '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false',
                    *args], check=True, capture_output=True)


class RepoTestCase(unittest.TestCase):
    def setUp(self):
        self.changes = 0
        self.repo = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ['rm', '-rf', str(self.repo)])
        git(self.repo, 'init', '-q')
        for path, text in FILES.items():
            self.write(path, text)
        self.commit()

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self):
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-q', '--allow-empty', '-m', 'c')

    def key(self, stage, extra=''):
        return ci_stage_cache.fingerprint(self.repo, stage, extra)

    def keys_after_change(self, path, stages):
        before = {stage: self.key(stage) for stage in stages}
        self.changes += 1
        self.write(path, f'changed {self.changes}')
        self.commit()
        return before, {stage: self.key(stage) for stage in stages}


class FingerprintTest(RepoTestCase):
    def test_same_tree_same_key(self):
        before = self.key('e2e-mock')
        self.commit()
        self.assertEqual(self.key('e2e-mock'), before)

    def test_file_outside_the_inputs_keeps_the_key(self):
        before, after = self.keys_after_change('docs/x.md', ('e2e-mock', 'odoo'))
        self.assertEqual(before, after)

    def test_addon_file_is_not_an_input_of_a_web_stage(self):
        before, after = self.keys_after_change('odoo-addons/liwan_core/models/m.py', ('e2e-mock', 'rtl-stories'))
        self.assertEqual(before, after)

    def test_addon_file_is_an_input_of_the_odoo_stages(self):
        stages = ci_scope.ODOO_STAGES
        before, after = self.keys_after_change('odoo-addons/liwan_core/models/m.py', stages)
        for stage in stages:
            self.assertNotEqual(before[stage], after[stage], stage)

    def test_input_file_changes_the_key(self):
        before, after = self.keys_after_change('apps/web/app/a.vue', ('e2e-mock',))
        self.assertNotEqual(before, after)
        before, after = self.keys_after_change('apps/web/app/a.vue', ('vendor-admin',))
        self.assertEqual(before, after)

    def test_workflow_file_changes_every_stage(self):
        before, after = self.keys_after_change('.github/workflows/ci.yml', ci_scope.STAGES)
        for stage in ci_scope.STAGES:
            self.assertNotEqual(before[stage], after[stage], stage)

    def test_static_reads_every_file(self):
        before, after = self.keys_after_change('docs/x.md', ('static',))
        self.assertNotEqual(before, after)

    def test_extra_and_stage_change_the_key(self):
        self.assertNotEqual(self.key('odoo', extra='1/3|'), self.key('odoo', extra='2/3|'))
        self.assertNotEqual(self.key('e2e-mock'), self.key('rtl-stories'))

    def test_unknown_stage_is_an_error(self):
        with self.assertRaises(ValueError):
            self.key('nope')

    def test_key_shape(self):
        digest = self.key('odoo', extra='1/3|')
        key = ci_stage_cache.cache_key('odoo', '1/3|', digest)
        self.assertRegex(key, r'^ci-pass-v2-odoo-[0-9a-f]{12}-[0-9a-f]{64}$')

    def test_key_command_prints_a_stable_key(self):
        original = Path.cwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, original)
        outputs = []
        for _ in range(2):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(ci_stage_cache.main(['key', '--stage', 'e2e-mock']), 0)
            outputs.append(out.getvalue())
        self.assertEqual(outputs[0], outputs[1])
        self.assertTrue(outputs[0].startswith('ci-pass-v2-e2e-mock-'))


class CachedStagesTest(RepoTestCase):
    SHARDS, E2E_SHARDS, APPS, BRIDGES = [1, 2, 3], [1, 2], ['a b', 'c'], ['d']

    def cached(self, existing, stages, modules=''):
        entries = ci_stage_cache.tree_entries(self.repo, 'HEAD')
        return ci_stage_cache.cached_stages(entries, stages, set(existing), self.SHARDS, self.E2E_SHARDS, self.APPS,
                                            self.BRIDGES, modules)

    def key_of(self, stage, extra=''):
        return ci_stage_cache.cache_key(stage, extra, self.key(stage, extra))

    def odoo_keys(self, shards=(1, 2, 3), modules=''):
        return [self.key_of('odoo', f'{shard}/3|{modules}') for shard in shards]

    def e2e_mock_keys(self, shards=(1, 2)):
        return [self.key_of('e2e-mock', f'{shard}/2') for shard in shards]

    def test_plain_stage_cached_when_its_key_exists(self):
        self.assertEqual(self.cached([self.key_of('rtl-stories')], ['static', 'e2e-mock', 'rtl-stories']),
                         ['rtl-stories'])

    def test_e2e_mock_is_cached_only_with_every_shard(self):
        self.assertEqual(self.cached(self.e2e_mock_keys(), ['e2e-mock']), ['e2e-mock'])
        self.assertEqual(self.cached(self.e2e_mock_keys(shards=(2,)), ['e2e-mock']), [])
        self.assertEqual(self.cached([self.key_of('e2e-mock')], ['e2e-mock']), [])

    def test_matrix_stage_cached_only_with_every_entry(self):
        self.assertEqual(self.cached(self.odoo_keys(), ['odoo']), ['odoo'])
        self.assertEqual(self.cached(self.odoo_keys(shards=(1, 2)), ['odoo']), [])

    def test_matrix_entries_include_modules_and_group(self):
        self.assertEqual(self.cached(self.odoo_keys(modules='liwan_crm'), ['odoo']), [])
        self.assertEqual(self.cached(self.odoo_keys(modules='liwan_crm'), ['odoo'], modules='liwan_crm'), ['odoo'])
        apps = [self.key_of('odoo-app-standalone', f'{group}|') for group in self.APPS]
        self.assertEqual(self.cached(apps, ['odoo-app-standalone']), ['odoo-app-standalone'])
        self.assertEqual(self.cached(apps[:1], ['odoo-app-standalone']), [])
        bridges = [self.key_of('odoo-bridge', 'd|')]
        self.assertEqual(self.cached(bridges, ['odoo-bridge']), ['odoo-bridge'])

    def test_empty_matrix_is_not_cached(self):
        entries = ci_stage_cache.tree_entries(self.repo, 'HEAD')
        self.assertEqual(ci_stage_cache.cached_stages(entries, ['odoo', 'e2e-mock', 'odoo-bridge'], set(),
                                                      [], [], [], [], ''), [])

    def test_static_is_never_cached(self):
        self.assertEqual(self.cached([self.key_of('static')], ['static']), [])

    def test_changed_inputs_miss(self):
        stale = self.e2e_mock_keys()
        self.write('apps/web/app/a.vue', 'changed')
        self.commit()
        self.assertEqual(self.cached(stale, ['e2e-mock']), [])

    def test_only_keys_of_the_current_ref_are_trusted(self):
        listing = [{'key': 'a', 'ref': 'refs/pull/1/merge'}, {'key': 'b', 'ref': 'refs/pull/2/merge'},
                   {'key': 'c', 'ref': 'refs/heads/main'}, {'key': 'd', 'ref': 'refs/heads/other'}]
        self.assertEqual(ci_stage_cache.trusted_keys(listing, 'refs/pull/1/merge'), {'a'})


class CachedCommandTest(RepoTestCase):
    ARGS = ['cached', '--stages', '["static","e2e-mock","odoo"]', '--odoo-shards', '[1]',
            '--e2e-mock-shards', '[1,2]', '--apps', '[]', '--bridges', '[]']

    def run_cached(self, lookup, env=None):
        original = Path.cwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, original)
        out, err = io.StringIO(), io.StringIO()
        environment = {'GITHUB_REPOSITORY': 'o/r', 'GITHUB_REF': 'refs/pull/7/merge', **(env or {})}
        with mock.patch.dict(os.environ, environment), contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(err):
            code = ci_stage_cache.main(self.ARGS, lookup=lookup)
        return code, json.loads(out.getvalue()), err.getvalue()

    def pass_key(self, stage, extra=''):
        return ci_stage_cache.cache_key(stage, extra, self.key(stage, extra))

    def test_prints_the_cached_stages_from_trusted_refs(self):
        code, cached, _ = self.run_cached(lambda repository: [
            {'key': self.pass_key('e2e-mock', '1/2'), 'ref': 'refs/pull/7/merge'},
            {'key': self.pass_key('e2e-mock', '2/2'), 'ref': 'refs/pull/7/merge'},
            {'key': self.pass_key('odoo', '1/1|'), 'ref': 'refs/pull/8/merge'}])
        self.assertEqual((code, cached), (0, ['e2e-mock']))

    def test_e2e_mock_shards_command_prints_the_matrix(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ci_stage_cache.main(['e2e-mock-shards']), 0)
        self.assertEqual(json.loads(out.getvalue()), ci_stage_cache.E2E_MOCK_SHARDS)

    def test_failed_lookup_caches_nothing_and_warns(self):
        def failing(repository):
            raise ci_stage_cache.CacheLookupError('boom')
        code, cached, err = self.run_cached(failing)
        self.assertEqual((code, cached), (0, []))
        self.assertIn('boom', err)

    def test_missing_github_environment_caches_nothing(self):
        code, cached, err = self.run_cached(lambda repository: [], env={'GITHUB_REF': ''})
        self.assertEqual((code, cached), (0, []))
        self.assertIn('GITHUB_REPOSITORY and GITHUB_REF', err)


class WorkflowWiringTest(unittest.TestCase):
    workflow = (ROOT / '.github/workflows/ci.yml').read_text()
    PIN = 'actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0'

    def jobs(self):
        body = self.workflow.split('\njobs:\n', 1)[1]
        chunks = re.split(r'(?m)^  ([a-z][a-z0-9-]*):\n', body)
        return dict(zip(chunks[1::2], chunks[2::2]))

    def last_step(self, job):
        lines = [line for line in job.splitlines() if not line.lstrip().startswith('#')]
        return re.split(r'(?m)^      - ', '\n'.join(lines))[-1]

    def test_every_stage_job_ends_with_the_stage_pass_step(self):
        jobs = self.jobs()
        for stage in NON_STATIC:
            with self.subTest(stage=stage):
                step = self.last_step(jobs[stage])
                self.assertTrue(step.startswith('uses: ./.github/actions/stage-pass\n'), step)
                self.assertIn('if: success()', step)
                self.assertRegex(step, rf'(?m)^          stage: {re.escape(stage)}$')

    def test_static_and_the_aggregate_save_no_pass(self):
        jobs = self.jobs()
        self.assertNotIn('stage-pass', jobs['static'])
        self.assertNotIn('stage-pass', jobs['ci-result'])

    def test_matrix_extras_match_the_scope_job(self):
        jobs = self.jobs()
        shard = '${{ matrix.shard }}/${{ strategy.job-total }}|${{ needs.scope.outputs.odoo-modules }}'
        e2e_shard = '${{ matrix.shard }}/${{ strategy.job-total }}'
        group = '${{ matrix.group }}|${{ needs.scope.outputs.odoo-modules }}'
        self.assertIn(f'extra: {shard}', jobs['odoo'])
        self.assertIn(f'extra: {e2e_shard}', jobs['e2e-mock'])
        self.assertIn(f'extra: {group}', jobs['odoo-app-standalone'])
        self.assertIn(f'extra: {group}', jobs['odoo-bridge'])

    def test_scope_job_reads_the_cache_list(self):
        scope = self.jobs()['scope']
        self.assertRegex(scope, r'(?m)^      actions: read$')
        self.assertIn('stages: ${{ steps.cache.outputs.stages }}', scope)
        self.assertIn('cached: ${{ steps.cache.outputs.cached }}', scope)

    def test_e2e_mock_is_a_matrix_over_the_scope_shard_list(self):
        scope, job = self.jobs()['scope'], self.jobs()['e2e-mock']
        self.assertIn('e2e-mock-shards: ${{ steps.select.outputs.e2e-mock-shards }}', scope)
        self.assertIn('ci_stage_cache.py e2e-mock-shards', scope)
        self.assertIn('--e2e-mock-shards "$E2E_MOCK_SHARDS"', scope)
        self.assertIn('shard: ${{ fromJSON(needs.scope.outputs.e2e-mock-shards) }}', job)
        self.assertIn('name: e2e-mock (shard ${{ matrix.shard }})', job)
        self.assertIn('deploy/ci/e2e-mock.sh --shard ${{ matrix.shard }}/${{ strategy.job-total }}', job)
        self.assertIn('name: e2e-mock-diagnostics-${{ matrix.shard }}', job)

    def test_scope_job_skips_only_for_pull_requests_and_merge_queue(self):
        run = self.jobs()['scope'].split('id: cache', 1)[1]
        for event in ('push', 'schedule', 'workflow_dispatch'):
            self.assertNotIn(event, run)
        self.assertIn('if [ "$EVENT_NAME" = pull_request ] || [ "$EVENT_NAME" = merge_group ]; then', run)
        self.assertEqual(run.count('ci_stage_cache.py cached'), 1)

    def test_composite_action_saves_a_pinned_cache(self):
        action = (ROOT / '.github/actions/stage-pass/action.yml').read_text()
        self.assertIn(f'uses: {self.PIN}', action)
        self.assertIn('tools/ci_stage_cache.py key', action)

    def test_composite_action_does_nothing_outside_pull_requests_and_merge_queue(self):
        action = (ROOT / '.github/actions/stage-pass/action.yml').read_text()
        condition = "if: github.event_name == 'pull_request' || github.event_name == 'merge_group'"
        self.assertEqual(action.count(condition), 2)
        self.assertEqual(action.count('      - name:') + action.count('    - name:'), 2)


if __name__ == '__main__':
    unittest.main()
